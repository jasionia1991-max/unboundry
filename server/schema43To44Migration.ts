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
  assertSchema43QuiescedTaskEvidence,
  type BackupQuiescedSourceContract,
} from "./backupPackage";
import {
  applyPendingSchemaMigrationsInTransaction,
  databaseMatchesMigrationManifest,
  databaseMatchesSchema43Contract,
  databaseMatchesSchemaContract,
} from "./database";
import {
  assertStoppedProcessProof,
  createRuntimeRoleCoordinator,
} from "./runtimeRole";

const sourceSchemaVersion = 43;
const targetSchemaVersion = 44;
const sha256Pattern = /^[a-f0-9]{64}$/;
const minimumProviderQuietMilliseconds = 60_000;
const quiescedDrainDeadlineMilliseconds = 120_000;

export class Schema43To44MigrationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "Schema43To44MigrationError";
  }
}

function fail(code: string, message: string): never {
  throw new Schema43To44MigrationError(code, message);
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

function exactUtcTimestamp(value: unknown, label: string) {
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(Date.parse(value)).toISOString() !== value
  ) {
    fail("SCHEMA_MIGRATION_FREEZE_EVIDENCE_INVALID", `${label} must be an exact UTC timestamp`);
  }
  return Date.parse(value);
}

function assertFrozenSourceEvidence(
  database: DatabaseSync,
  contract: BackupQuiescedSourceContract,
  expectedSha: string,
  capturedNow: number,
) {
  if (
    contract.expectedSchemaVersion !== sourceSchemaVersion ||
    contract.expectedDatabaseLogicalSha256 !== expectedSha ||
    !sha256Pattern.test(contract.expectedDatabaseLogicalSha256) ||
    !contract.freezeEvidence ||
    contract.freezeEvidence.sourceDatabaseLogicalSha256 !== expectedSha ||
    !sha256Pattern.test(contract.freezeEvidence.sourceDatabaseLogicalSha256)
  ) {
    fail(
      "SCHEMA_MIGRATION_QUIESCED_CONTRACT_INVALID",
      "Quiesced preservation contract is not bound to schema 43 and the expected source SHA",
    );
  }
  const generationFrozenAt = exactUtcTimestamp(
    contract.freezeEvidence.generationFrozenAt,
    "Generation freeze time",
  );
  const lastProviderAdmissionAt = contract.freezeEvidence.lastProviderAdmissionAt === null
    ? undefined
    : exactUtcTimestamp(
        contract.freezeEvidence.lastProviderAdmissionAt,
        "Last Provider admission time",
      );
  if (
    lastProviderAdmissionAt !== undefined &&
    lastProviderAdmissionAt > generationFrozenAt
  ) {
    fail(
      "SCHEMA_MIGRATION_FREEZE_EVIDENCE_INVALID",
      "Provider admission evidence is later than the generation freeze",
    );
  }
  const quietSince = Math.max(
    generationFrozenAt,
    lastProviderAdmissionAt ?? Number.NEGATIVE_INFINITY,
  );
  if (
    quietSince > capturedNow ||
    capturedNow - quietSince < minimumProviderQuietMilliseconds
  ) {
    fail(
      "SCHEMA_MIGRATION_FREEZE_QUIET_PERIOD_INCOMPLETE",
      "Generation must stay frozen for at least 60 seconds after the last possible Provider admission",
    );
  }

  const safety = database.prepare(`
    SELECT id, global_enabled, emergency_stop, updated_at
    FROM generation_safety_settings
    ORDER BY id
  `).all() as Array<{
    emergency_stop?: number | bigint;
    global_enabled?: number | bigint;
    id?: number | bigint;
    updated_at?: unknown;
  }>;
  if (
    safety.length !== 1 ||
    Number(safety[0]?.id) !== 1 ||
    (Number(safety[0]?.global_enabled) !== 0 &&
      Number(safety[0]?.emergency_stop) !== 1) ||
    safety[0]?.updated_at !== contract.freezeEvidence.generationFrozenAt
  ) {
    fail(
      "SCHEMA_MIGRATION_GENERATION_NOT_FROZEN",
      "Locked migration source does not prove that generation is globally frozen",
    );
  }

  let auditedAfter: Record<string, unknown> | undefined;
  const safetyAudit = database.prepare(`
    SELECT details
    FROM admin_audit_events
    WHERE action = 'generation_safety.update'
    ORDER BY id DESC
    LIMIT 1
  `).get() as { details?: unknown } | undefined;
  try {
    const details = typeof safetyAudit?.details === "string"
      ? JSON.parse(safetyAudit.details) as unknown
      : undefined;
    if (details && typeof details === "object" && !Array.isArray(details)) {
      const after = (details as Record<string, unknown>).after;
      if (after && typeof after === "object" && !Array.isArray(after)) {
        auditedAfter = after as Record<string, unknown>;
      }
    }
  } catch {
    // The contract failure below is intentionally generic and fail closed.
  }
  if (
    !auditedAfter ||
    auditedAfter.updatedAt !== safety[0]?.updated_at ||
    auditedAfter.globalEnabled !== (Number(safety[0]?.global_enabled) === 1) ||
    auditedAfter.emergencyStop !== (Number(safety[0]?.emergency_stop) === 1)
  ) {
    fail(
      "SCHEMA_MIGRATION_FREEZE_AUDIT_MISSING",
      "Locked generation freeze has no matching administrator audit",
    );
  }

  const lastAttempt = database.prepare(`
    SELECT created_at
    FROM generation_provider_attempts
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `).get() as { created_at?: unknown } | undefined;
  if (lastAttempt) {
    const lastRecordedAttemptAt = exactUtcTimestamp(
      lastAttempt.created_at,
      "Last Provider attempt time",
    );
    if (
      lastProviderAdmissionAt === undefined ||
      lastProviderAdmissionAt < lastRecordedAttemptAt
    ) {
      fail(
        "SCHEMA_MIGRATION_FREEZE_EVIDENCE_STALE",
        "Freeze evidence does not cover the last recorded Provider attempt",
      );
    }
  }
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
  // this DDL-only migration nor the schema 44 runtime re-admits terminal tasks.
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

function assertQuiescedSource(
  database: DatabaseSync,
  contract: BackupQuiescedSourceContract,
  expectedSha: string,
  capturedNow: number,
) {
  assertFrozenSourceEvidence(database, contract, expectedSha, capturedNow);
  assertSchema43QuiescedTaskEvidence(database, contract);

  // The preservation path may carry an existing publication ledger for the
  // named recovering task, but it must never silently adopt an unrelated live
  // publication.  The DDL below copies every row byte-for-byte and does not
  // settle, delete, or publish any asset.
  const preserved = contract.preservedTask;
  const activePublications = database.prepare(`
    SELECT task_id, task_execution_attempt
    FROM media_publication_attempts
    WHERE state IN ('reserved', 'staged', 'external-ready', 'compensating')
    ORDER BY attempt_id
  `).all() as Array<{
    task_execution_attempt?: number | bigint;
    task_id?: unknown;
  }>;
  if (activePublications.some((row) =>
    row.task_id !== preserved.taskId ||
    Number(row.task_execution_attempt) !== preserved.executionAttempt
  )) {
    fail(
      "SCHEMA_MIGRATION_QUIESCED_UNLISTED_MEDIA",
      "The source contains an active publication outside the explicitly preserved task",
    );
  }
  if (scalarCount(database, `
    SELECT COUNT(*) AS count FROM media_capacity_reservations
    WHERE state = 'active'
  `) !== 0) {
    fail(
      "SCHEMA_MIGRATION_QUIESCED_ACTIVE_MEDIA_CAPACITY",
      "Active media reservations must be released before schema preservation migration",
    );
  }
}

function assertExactSource(
  database: DatabaseSync,
  inspectionRoot: string,
  expectedSha: string,
  quiescedSourceContract: BackupQuiescedSourceContract | undefined,
  capturedNow: number,
) {
  const inspection = inspectLockedBackupDatabase(database, inspectionRoot);
  if (
    inspection.userVersion !== sourceSchemaVersion ||
    !databaseMatchesMigrationManifest(database, sourceSchemaVersion) ||
    !databaseMatchesSchema43Contract(database) ||
    database.prepare("PRAGMA foreign_key_check").all().length !== 0
  ) fail("SCHEMA_MIGRATION_SOURCE_INVALID", "Migration requires exact schema 43");
  if (inspection.logicalSha256 !== expectedSha) {
    fail(
      "SCHEMA_MIGRATION_SOURCE_SHA_MISMATCH",
      "Locked migration source does not match the expected logical SHA-256",
    );
  }
  if (quiescedSourceContract) {
    assertQuiescedSource(
      database,
      quiescedSourceContract,
      expectedSha,
      capturedNow,
    );
  } else {
    assertQuiescentSource(database);
  }
  return inspection;
}

function migrateLocked(database: DatabaseSync) {
  applyPendingSchemaMigrationsInTransaction(database, {
    sourceVersion: sourceSchemaVersion,
    targetVersion: targetSchemaVersion,
  });
  if (
    !databaseMatchesMigrationManifest(database, targetSchemaVersion) ||
    !databaseMatchesSchemaContract(database) ||
    database.prepare("PRAGMA foreign_key_check").all().length !== 0
  ) fail("SCHEMA_MIGRATION_TARGET_INVALID", "Migrated database is not exact schema 44");
}

export type Schema43To44MigrationOptions = Readonly<{
  dataDirectory: string;
  expectedSourceLogicalSha256: string;
  mode: "apply" | "dry-run";
  runtimeDirectory: string;
  scratchRoot?: string;
  quiescedSourceContract?: BackupQuiescedSourceContract;
}>;

export async function migrateSchema43To44(options: Schema43To44MigrationOptions) {
  const dataDirectory = normalizedAbsolute(options.dataDirectory, "Data directory");
  const runtimeDirectory = normalizedAbsolute(options.runtimeDirectory, "Runtime directory");
  const scratchRoot = normalizedAbsolute(options.scratchRoot ?? resolve(tmpdir()), "Scratch root");
  if (!sha256Pattern.test(options.expectedSourceLogicalSha256)) {
    fail("SCHEMA_MIGRATION_ARGUMENT_INVALID", "Expected logical SHA-256 is invalid");
  }
  if (options.mode !== "apply" && options.mode !== "dry-run") {
    fail("SCHEMA_MIGRATION_ARGUMENT_INVALID", "Migration mode is invalid");
  }
  const quiescedSourceContract = options.quiescedSourceContract;
  if (
    quiescedSourceContract &&
    quiescedSourceContract.runtimeDirectory !== runtimeDirectory
  ) {
    fail(
      "SCHEMA_MIGRATION_QUIESCED_CONTRACT_INVALID",
      "Quiesced preservation runtime directory must match the migration runtime directory",
    );
  }
  const databasePath = join(dataDirectory, "unboundry.sqlite");
  assertPrivateRegularFile(databasePath);
  let runtime: ReturnType<typeof createRuntimeRoleCoordinator> | undefined;
  let workRoot: string | undefined;
  try {
    if (quiescedSourceContract) {
      // Prove the old runtime is gone before taking over its existing lease.
      // The existing lease is held through the DDL transaction and prevents a
      // new worker from entering while the recovering ledger is preserved.
      assertStoppedProcessProof(quiescedSourceContract.stoppedProcess);
      runtime = createRuntimeRoleCoordinator({
        dataDirectory,
        requireExistingLease: true,
        role: "active",
        runtimeDirectory,
      });
      const drained = await runtime.beginDrain(quiescedDrainDeadlineMilliseconds);
      if (!drained.drained || drained.activeExecutions !== 0) {
        fail(
          "SCHEMA_MIGRATION_DRAIN_TIMEOUT",
          "The existing active runtime did not complete its drain",
        );
      }
      runtime.assertLeaseHeldForBackup();
    } else {
      runtime = createRuntimeRoleCoordinator({ dataDirectory, role: "active", runtimeDirectory });
      runtime.assertActive("writer");
    }
    workRoot = mkdtempSync(join(scratchRoot, ".unboundry-schema43-to44-"));
    chmodSync(workRoot, 0o700);
    const inspectionRoot = join(workRoot, "inspection");
    mkdirSync(inspectionRoot, { mode: 0o700 });
    const source = new DatabaseSync(databasePath, { timeout: 5_000 });
    let sourceTransaction = false;
    try {
      source.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; BEGIN IMMEDIATE");
      sourceTransaction = true;
      if (quiescedSourceContract) runtime.assertLeaseHeldForBackup();
      const before = assertExactSource(
        source,
        inspectionRoot,
        options.expectedSourceLogicalSha256,
        quiescedSourceContract,
        Date.now(),
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
        if (quiescedSourceContract) runtime.assertLeaseHeldForBackup();
        const after = inspectBackupDatabase(rehearsalPath, workRoot);
        return Object.freeze({
          mode: options.mode,
          preservationMode: quiescedSourceContract
            ? "quiesced-active-preservation" as const
            : "strict" as const,
          sourceLogicalSha256: before.logicalSha256,
          sourceVersion: sourceSchemaVersion,
          status: "verified" as const,
          targetLogicalSha256: after.logicalSha256,
          targetVersion: targetSchemaVersion,
        });
      }
      migrateLocked(source);
      if (quiescedSourceContract) runtime.assertLeaseHeldForBackup();
      const after = inspectLockedBackupDatabase(source, inspectionRoot);
      source.exec("COMMIT");
      sourceTransaction = false;
      return Object.freeze({
        mode: options.mode,
        preservationMode: quiescedSourceContract
          ? "quiesced-active-preservation" as const
          : "strict" as const,
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
    if (error instanceof Schema43To44MigrationError) throw error;
    fail("SCHEMA_MIGRATION_FAILED", "Schema 43 to 44 migration failed");
  } finally {
    runtime?.close();
    if (workRoot) rmSync(workRoot, { force: true, recursive: true });
  }
}
