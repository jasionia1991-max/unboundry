import { backup, DatabaseSync } from "node:sqlite";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import {
  inspectBackupDatabase,
  inspectLockedBackupDatabase,
} from "./backupInspection";
import {
  applyPendingSchemaMigrationsInTransaction,
  databaseMatchesMigrationManifest,
  databaseMatchesSchema42Contract,
  databaseMatchesSchema43Contract,
} from "./database";
import { createRuntimeRoleCoordinator } from "./runtimeRole";

const sourceSchemaVersion = 42;
const targetSchemaVersion = 43;
const sha256Pattern = /^[a-f0-9]{64}$/;

export class Schema42To43MigrationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "Schema42To43MigrationError";
  }
}

function fail(code: string, message: string): never {
  throw new Schema42To43MigrationError(code, message);
}

function normalizedAbsolute(value: string, label: string) {
  if (!isAbsolute(value) || resolve(value) !== value) {
    fail("SCHEMA_MIGRATION_ARGUMENT_INVALID", `${label} must be normalized and absolute`);
  }
  return value;
}

function assertPrivateRegularFile(path: string) {
  let details;
  try {
    details = lstatSync(path);
  } catch {
    fail("SCHEMA_MIGRATION_SOURCE_INVALID", "Migration database is unavailable");
  }
  const owned = typeof process.getuid !== "function" || details.uid === process.getuid();
  if (
    !details.isFile() || details.isSymbolicLink() || details.nlink !== 1 ||
    !owned || (details.mode & 0o022) !== 0
  ) {
    fail(
      "SCHEMA_MIGRATION_SOURCE_INVALID",
      "Migration database must be a private owned regular file",
    );
  }
}

function scalarCount(database: DatabaseSync, sql: string) {
  const row = database.prepare(sql).get() as { count?: unknown } | undefined;
  return Number(row?.count);
}

function assertQuiescentSource(database: DatabaseSync) {
  if (scalarCount(database, `
    SELECT COUNT(*) AS count FROM generation_tasks
    WHERE state IN ('queued', 'running', 'retrying', 'recovering')
  `) !== 0) {
    fail(
      "SCHEMA_MIGRATION_ACTIVE_GENERATION_TASKS",
      "Active generation tasks must drain before migration",
    );
  }
  if (scalarCount(database, `
    SELECT COUNT(*) AS count FROM workflow_runs
    WHERE state IN ('running', 'stopping')
  `) !== 0) {
    fail(
      "SCHEMA_MIGRATION_ACTIVE_WORKFLOW_RUNS",
      "Active workflow runs must drain before migration",
    );
  }
  // A terminal task can intentionally retain accepted, response-received, or
  // outcome-unknown Provider evidence forever. Those rows are billing and
  // recovery history, not live work, and migration must preserve them exactly.
  // The active-task gate above is the execution-quiescence boundary; neither
  // this DDL-only migration nor the schema 43 runtime re-admits terminal tasks.
  if (scalarCount(database, `
    SELECT COUNT(*) AS count FROM media_publication_attempts
    WHERE state IN ('reserved', 'staged', 'external-ready', 'compensating')
  `) !== 0) {
    fail(
      "SCHEMA_MIGRATION_ACTIVE_MEDIA",
      "Media publication attempts must settle before migration",
    );
  }
  if (scalarCount(database, `
    SELECT COUNT(*) AS count FROM media_capacity_reservations
    WHERE state = 'active'
  `) !== 0) {
    fail(
      "SCHEMA_MIGRATION_ACTIVE_MEDIA_CAPACITY",
      "Active media reservations must release before migration",
    );
  }
  const safety = database.prepare(`
    SELECT global_enabled, emergency_stop FROM generation_safety_settings
    WHERE id = 1
  `).get() as { emergency_stop?: unknown; global_enabled?: unknown } | undefined;
  if (!safety || (Number(safety.global_enabled) !== 0 && Number(safety.emergency_stop) !== 1)) {
    fail(
      "SCHEMA_MIGRATION_GENERATION_NOT_FROZEN",
      "Generation must be globally frozen before migration",
    );
  }
}

function assertExactSource(
  database: DatabaseSync,
  inspectionRoot: string,
  expectedSha: string,
) {
  const inspection = inspectLockedBackupDatabase(database, inspectionRoot);
  if (
    inspection.userVersion !== sourceSchemaVersion ||
    !databaseMatchesMigrationManifest(database, sourceSchemaVersion) ||
    !databaseMatchesSchema42Contract(database) ||
    database.prepare("PRAGMA foreign_key_check").all().length !== 0
  ) fail("SCHEMA_MIGRATION_SOURCE_INVALID", "Migration requires exact schema 42");
  if (inspection.logicalSha256 !== expectedSha) {
    fail(
      "SCHEMA_MIGRATION_SOURCE_SHA_MISMATCH",
      "Locked migration source does not match the expected logical SHA-256",
    );
  }
  assertQuiescentSource(database);
  return inspection;
}

function migrateLocked(database: DatabaseSync) {
  applyPendingSchemaMigrationsInTransaction(database, {
    sourceVersion: sourceSchemaVersion,
    targetVersion: targetSchemaVersion,
  });
  if (
    !databaseMatchesMigrationManifest(database, targetSchemaVersion) ||
    !databaseMatchesSchema43Contract(database) ||
    database.prepare("PRAGMA foreign_key_check").all().length !== 0
  ) fail("SCHEMA_MIGRATION_TARGET_INVALID", "Migrated database is not exact schema 43");
}

export type Schema42To43MigrationOptions = Readonly<{
  dataDirectory: string;
  expectedSourceLogicalSha256: string;
  mode: "apply" | "dry-run";
  runtimeDirectory: string;
  scratchRoot?: string;
}>;

export async function migrateSchema42To43(options: Schema42To43MigrationOptions) {
  const dataDirectory = normalizedAbsolute(options.dataDirectory, "Data directory");
  const runtimeDirectory = normalizedAbsolute(options.runtimeDirectory, "Runtime directory");
  const scratchRoot = normalizedAbsolute(options.scratchRoot ?? resolve(tmpdir()), "Scratch root");
  if (!sha256Pattern.test(options.expectedSourceLogicalSha256)) {
    fail("SCHEMA_MIGRATION_ARGUMENT_INVALID", "Expected logical SHA-256 is invalid");
  }
  if (options.mode !== "apply" && options.mode !== "dry-run") {
    fail("SCHEMA_MIGRATION_ARGUMENT_INVALID", "Migration mode is invalid");
  }
  const databasePath = join(dataDirectory, "unboundry.sqlite");
  assertPrivateRegularFile(databasePath);
  let runtime: ReturnType<typeof createRuntimeRoleCoordinator> | undefined;
  let workRoot: string | undefined;
  try {
    runtime = createRuntimeRoleCoordinator({ dataDirectory, role: "active", runtimeDirectory });
    runtime.assertActive("writer");
    workRoot = mkdtempSync(join(scratchRoot, ".unboundry-schema42-to43-"));
    chmodSync(workRoot, 0o700);
    const inspectionRoot = join(workRoot, "inspection");
    mkdirSync(inspectionRoot, { mode: 0o700 });
    const source = new DatabaseSync(databasePath, { timeout: 5_000 });
    let sourceTransaction = false;
    try {
      source.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; BEGIN IMMEDIATE");
      sourceTransaction = true;
      const before = assertExactSource(
        source,
        inspectionRoot,
        options.expectedSourceLogicalSha256,
      );
      if (options.mode === "dry-run") {
        const rehearsalPath = join(workRoot, "rehearsal.sqlite");
        const snapshotSource = new DatabaseSync(databasePath, {
          readOnly: true,
          timeout: 5_000,
        });
        try {
          await backup(snapshotSource, rehearsalPath);
        } finally {
          snapshotSource.close();
        }
        source.exec("ROLLBACK");
        sourceTransaction = false;
        const rehearsal = new DatabaseSync(rehearsalPath, { timeout: 5_000 });
        try {
          rehearsal.exec("PRAGMA foreign_keys = ON; BEGIN IMMEDIATE");
          migrateLocked(rehearsal);
          rehearsal.exec("COMMIT");
        } catch (error) {
          if (rehearsal.isTransaction) rehearsal.exec("ROLLBACK");
          throw error;
        } finally {
          rehearsal.close();
        }
        const after = inspectBackupDatabase(rehearsalPath, workRoot);
        return Object.freeze({
          mode: options.mode,
          sourceLogicalSha256: before.logicalSha256,
          sourceVersion: sourceSchemaVersion,
          status: "verified" as const,
          targetLogicalSha256: after.logicalSha256,
          targetVersion: targetSchemaVersion,
        });
      }
      migrateLocked(source);
      const after = inspectLockedBackupDatabase(source, inspectionRoot);
      source.exec("COMMIT");
      sourceTransaction = false;
      return Object.freeze({
        mode: options.mode,
        sourceLogicalSha256: before.logicalSha256,
        sourceVersion: sourceSchemaVersion,
        status: "complete" as const,
        targetLogicalSha256: after.logicalSha256,
        targetVersion: targetSchemaVersion,
      });
    } catch (error) {
      if (sourceTransaction && source.isTransaction) source.exec("ROLLBACK");
      throw error;
    } finally {
      source.close();
    }
  } catch (error) {
    if (error instanceof Schema42To43MigrationError) throw error;
    fail("SCHEMA_MIGRATION_FAILED", "Schema 42 to 43 migration failed");
  } finally {
    runtime?.close();
    if (workRoot) rmSync(workRoot, { force: true, recursive: true });
  }
}
