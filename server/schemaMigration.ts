import {
  chmodSync,
  closeSync,
  constants as fileConstants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  BackupInspectionError,
  databaseMatchesFrozenSchema37Contract,
  inspectLockedBackupDatabase,
} from "./backupInspection.ts";
import {
  applyPendingSchemaMigrationsInTransaction,
  backfillLegacyMediaStrict,
  currentSchemaVersion,
  databaseHasCompleteLegacyMediaMetadata,
  databaseMatchesMigrationManifest,
  databaseMatchesSchemaContract,
  migrationIncompleteMarker,
  revalidateLegacyMediaBackfillEvidence,
  verifyCommittedMigrationMediaStrict,
  type LegacyMediaDurationProbe,
  type LegacyMediaBackfillSummary,
} from "./database.ts";
import {
  createRuntimeRoleCoordinator,
  RuntimeRoleError,
  type RuntimeRoleCoordinator,
} from "./runtimeRole.ts";
import {
  acquireLegacyChildGuardian,
  LegacyChildGuardianError,
  type LegacyChildGuardian,
} from "./legacyChildGuardian.ts";

const sourceSchemaVersion = 37;
const requiredDrainMilliseconds = 60_000;
const markerContract = "unboundry-schema37-to39-v1";
const sha256Pattern = /^[a-f0-9]{64}$/;
// An indeterminate DB/guardian/main release must not be left to native handle
// finalization. Keep the owner reachable until process exit so no successor can
// infer that an unsafe migration handed off its writer authority.
const indeterminateMigrationOwners = new Set<object>();

type MigrationMarker = Readonly<{
  contract: typeof markerContract;
  databaseDev: string;
  databaseIno: string;
  expectedSourceLogicalSha256: string;
  operationId: string;
  sourceVersion: typeof sourceSchemaVersion;
  targetVersion: number;
}>;

type OwnedDataDirectory = Readonly<{
  details: NonNullable<ReturnType<typeof lstatSync>>;
  path: string;
}>;

type MigrationMarkerIdentity = Readonly<{
  ctimeMs: number;
  dev: number;
  ino: number;
  mode: number;
  mtimeMs: number;
  nlink: number;
  size: number;
  uid: number;
}>;

type PinnedMigrationMarker = Readonly<{
  document: MigrationMarker;
  identity: MigrationMarkerIdentity;
}>;

type UnexpectedMigrationStage =
  | "commit"
  | "complete"
  | "drain"
  | "marker-clear"
  | "media-backfill"
  | "media-backfill-probe"
  | "media-full-verify"
  | "media-full-verify-probe"
  | "post-commit-verify"
  | "preflight"
  | "schema-38-apply"
  | "schema-39-apply"
  | "schema-40-apply"
  | "schema-41-apply"
  | "schema-42-apply"
  | "target-logical-inspection"
  | "target-validation";

export type SchemaMigrationCheckpoint =
  | "source-locked"
  | "drain-complete"
  | "schema-38-applied"
  | "schema-39-applied"
  | "schema-40-applied"
  | "schema-41-applied"
  | "schema-42-applied"
  | "schema-committed"
  | "duration-probe-complete"
  | "backfill-row"
  | "complete";

export type SchemaMigrationResult = Readonly<{
  backfilledChecksums: number;
  backfilledDurations: number;
  drainMilliseconds: number;
  expectedSourceLogicalSha256: string;
  mode: "apply" | "dry-run";
  nativeDurationProbeAuditSha256: string;
  nativeDurationProbes: number;
  recovered: boolean;
  sourceVersion: typeof sourceSchemaVersion;
  status: "complete" | "ready";
  targetLogicalSha256: string | null;
  targetVersion: number;
}>;

export type SchemaMigrationOptions = Readonly<{
  busyTimeoutMilliseconds?: number;
  dataDirectory: string;
  expectedSourceLogicalSha256: string;
  mode: "apply" | "dry-run";
  onCheckpoint?: (checkpoint: SchemaMigrationCheckpoint) => void;
  runtimeDirectory?: string;
  scratchRoot?: string;
  testClock?: Readonly<{
    drainMilliseconds: number;
    sleep: (milliseconds: number) => Promise<void>;
  }>;
  testDurationProbe?: Readonly<{
    auditPath: string;
    executable: string;
  }>;
}>;

export class SchemaMigrationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "SchemaMigrationError";
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new SchemaMigrationError(code, message);
}

function failUnexpectedMigration(stage: UnexpectedMigrationStage): never {
  switch (stage) {
    case "commit":
      fail("SCHEMA_MIGRATION_FAILED_COMMIT", "Schema migration commit failed");
    case "complete":
      fail("SCHEMA_MIGRATION_FAILED_RESULT", "Schema migration result failed");
    case "drain":
      fail("SCHEMA_MIGRATION_FAILED_DRAIN", "Schema migration drain failed");
    case "marker-clear":
      fail(
        "SCHEMA_MIGRATION_FAILED_MARKER_CLEAR",
        "Schema migration marker clear failed",
      );
    case "media-backfill":
      fail(
        "SCHEMA_MIGRATION_FAILED_MEDIA_BACKFILL",
        "Schema migration media backfill failed",
      );
    case "media-backfill-probe":
      fail(
        "SCHEMA_MIGRATION_FAILED_MEDIA_BACKFILL_PROBE",
        "Schema migration media backfill probe failed",
      );
    case "media-full-verify":
      fail(
        "SCHEMA_MIGRATION_FAILED_MEDIA_FULL_VERIFY",
        "Schema migration full media verification failed",
      );
    case "media-full-verify-probe":
      fail(
        "SCHEMA_MIGRATION_FAILED_MEDIA_FULL_VERIFY_PROBE",
        "Schema migration full media verification probe failed",
      );
    case "post-commit-verify":
      fail(
        "SCHEMA_MIGRATION_FAILED_POST_COMMIT_VERIFY",
        "Schema migration post-commit verification failed",
      );
    case "preflight":
      fail(
        "SCHEMA_MIGRATION_FAILED_PREFLIGHT",
        "Schema migration preflight failed",
      );
    case "schema-38-apply":
      fail(
        "SCHEMA_MIGRATION_FAILED_SCHEMA38_APPLY",
        "Schema 38 migration application failed",
      );
    case "schema-39-apply":
      fail(
        "SCHEMA_MIGRATION_FAILED_SCHEMA39_APPLY",
        "Schema 39 migration application failed",
      );
    case "schema-40-apply":
      fail(
        "SCHEMA_MIGRATION_FAILED_SCHEMA40_APPLY",
        "Schema 40 migration application failed",
      );
    case "schema-41-apply":
      fail(
        "SCHEMA_MIGRATION_FAILED_SCHEMA41_APPLY",
        "Schema 41 migration application failed",
      );
    case "schema-42-apply":
      fail(
        "SCHEMA_MIGRATION_FAILED_SCHEMA42_APPLY",
        "Schema 42 migration application failed",
      );
    case "target-logical-inspection":
      fail(
        "SCHEMA_MIGRATION_FAILED_TARGET_LOGICAL_INSPECTION",
        "Schema migration target logical inspection failed",
      );
    case "target-validation":
      fail(
        "SCHEMA_MIGRATION_FAILED_TARGET_VALIDATION",
        "Schema migration target validation failed",
      );
  }
}

function migrationRuntimeLeaseFailure(error: unknown): never {
  if (error instanceof RuntimeRoleError) {
    if (
      error.code === "RUNTIME_ROLE_PATH_UNSAFE" ||
      error.code === "RUNTIME_ACTIVE_LEASE_LOST" ||
      error.code === "RUNTIME_ACTIVE_LEASE_RELEASE_UNKNOWN"
    ) {
      fail(
        "SCHEMA_MIGRATION_RUNTIME_LEASE_UNSAFE",
        "Migration runtime active lease is unsafe",
      );
    }
    fail(
      "SCHEMA_MIGRATION_RUNTIME_LEASE_UNAVAILABLE",
      "Another runtime already owns the migration writer lease",
    );
  }
  throw error;
}

function assertMigrationRuntimeLease(coordinator: RuntimeRoleCoordinator) {
  try {
    coordinator.assertActive("writer");
  } catch (error) {
    migrationRuntimeLeaseFailure(error);
  }
}

function acquireMigrationRuntimeLease(
  dataDirectory: string,
  runtimeDirectory: string | undefined,
): RuntimeRoleCoordinator {
  let coordinator: RuntimeRoleCoordinator | undefined;
  try {
    // The migration has no HTTP surface, but it is the maintenance writer and
    // therefore must own the same exclusive active lease as the HTTP runtime.
    coordinator = createRuntimeRoleCoordinator({
      dataDirectory,
      role: "active",
      ...(runtimeDirectory ? { runtimeDirectory } : {}),
    });
    assertMigrationRuntimeLease(coordinator);
    return coordinator;
  } catch (error) {
    try {
      coordinator?.close();
    } catch {
      // A failed acquisition never hands an indeterminate lease to migration.
    }
    if (error instanceof SchemaMigrationError) throw error;
    if (error instanceof RuntimeRoleError) migrationRuntimeLeaseFailure(error);
    fail(
      "SCHEMA_MIGRATION_RUNTIME_LEASE_UNAVAILABLE",
      "Migration runtime active lease is unavailable",
    );
  }
}

function migrationGuardianFailure(error: unknown): never {
  if (error instanceof LegacyChildGuardianError) {
    const unsafe = new Set([
      "LEGACY_CHILD_GUARDIAN_LOST",
      "LEGACY_CHILD_GUARDIAN_RELEASE_UNKNOWN",
      "LEGACY_CHILD_GUARDIAN_UNSAFE",
    ]).has(error.code);
    fail(
      unsafe
        ? "SCHEMA_MIGRATION_GUARDIAN_UNSAFE"
        : "SCHEMA_MIGRATION_GUARDIAN_UNAVAILABLE",
      unsafe
        ? "Migration legacy-child guardian is unsafe"
        : "A legacy child already owns the migration guardian",
    );
  }
  throw error;
}

function assertMigrationGuardian(guardian: LegacyChildGuardian) {
  try {
    guardian.assertHeld();
  } catch (error) {
    migrationGuardianFailure(error);
  }
}

function normalizedAbsolute(path: string, label: string) {
  if (!path || resolve(path) !== path) {
    fail("SCHEMA_MIGRATION_PATH_INVALID", `${label} must be normalized and absolute`);
  }
  return path;
}

function containsPath(parent: string, child: string) {
  const difference = relative(parent, child);
  return difference === "" ||
    (!isAbsolute(difference) && difference !== ".." &&
      !difference.startsWith(`..${sep}`));
}

function currentUid() {
  if (typeof process.getuid !== "function") {
    fail("SCHEMA_MIGRATION_PLATFORM_UNSUPPORTED", "Migration ownership cannot be verified");
  }
  return BigInt(process.getuid());
}

function assertOwnedDataDirectory(dataDirectory: string) {
  let details: ReturnType<typeof lstatSync>;
  try {
    details = lstatSync(dataDirectory);
  } catch {
    fail("SCHEMA_MIGRATION_DATA_DIRECTORY_INVALID", "Data directory is unavailable");
  }
  if (
    details.isSymbolicLink() ||
    !details.isDirectory() ||
    BigInt(details.uid) !== currentUid() ||
    (details.mode & 0o022) !== 0
  ) {
    fail(
      "SCHEMA_MIGRATION_DATA_DIRECTORY_INVALID",
      "Data directory must be an owned, write-protected physical directory",
    );
  }
  try {
    return Object.freeze({
      details,
      path: realpathSync(dataDirectory),
    }) satisfies OwnedDataDirectory;
  } catch (error) {
    if (error instanceof SchemaMigrationError) throw error;
    fail("SCHEMA_MIGRATION_DATA_DIRECTORY_INVALID", "Data directory is unavailable");
  }
}

function assertSameOwnedDataDirectory(
  dataDirectory: string,
  expected: NonNullable<ReturnType<typeof lstatSync>>,
) {
  let actual: NonNullable<ReturnType<typeof lstatSync>>;
  try {
    actual = lstatSync(dataDirectory);
  } catch {
    fail(
      "SCHEMA_MIGRATION_DATA_DIRECTORY_CHANGED",
      "Application data directory changed during migration",
    );
  }
  let canonical: string;
  try {
    canonical = realpathSync(dataDirectory);
  } catch {
    fail(
      "SCHEMA_MIGRATION_DATA_DIRECTORY_CHANGED",
      "Application data directory changed during migration",
    );
  }
  if (
    actual.isSymbolicLink() || !actual.isDirectory() ||
    canonical !== dataDirectory || actual.dev !== expected.dev ||
    actual.ino !== expected.ino || actual.uid !== expected.uid ||
    actual.mode !== expected.mode ||
    BigInt(actual.uid) !== currentUid() || (actual.mode & 0o022) !== 0
  ) {
    fail(
      "SCHEMA_MIGRATION_DATA_DIRECTORY_CHANGED",
      "Application data directory changed during migration",
    );
  }
}

function assertOwnedDatabase(databasePath: string) {
  let details: NonNullable<ReturnType<typeof lstatSync>>;
  try {
    details = lstatSync(databasePath);
  } catch {
    fail("SCHEMA_MIGRATION_DATABASE_INVALID", "Application database is unavailable");
  }
  if (
    details.isSymbolicLink() ||
    !details.isFile() ||
    details.size < 1 ||
    details.nlink !== 1 ||
    BigInt(details.uid) !== currentUid() ||
    (details.mode & 0o022) !== 0
  ) {
    fail(
      "SCHEMA_MIGRATION_DATABASE_INVALID",
      "Application database must be an owned, write-protected regular file",
    );
  }
  return details;
}

function assertSameOwnedDatabase(
  databasePath: string,
  expected: NonNullable<ReturnType<typeof lstatSync>>,
) {
  let actual: NonNullable<ReturnType<typeof lstatSync>>;
  try {
    actual = lstatSync(databasePath);
  } catch {
    fail(
      "SCHEMA_MIGRATION_DATABASE_CHANGED",
      "Application database path changed during migration",
    );
  }
  if (
    actual.isSymbolicLink() || !actual.isFile() || actual.nlink !== 1 ||
    actual.dev !== expected.dev || actual.ino !== expected.ino ||
    actual.uid !== expected.uid || actual.mode !== expected.mode ||
    actual.nlink !== expected.nlink || BigInt(actual.uid) !== currentUid() ||
    (actual.mode & 0o022) !== 0
  ) {
    fail(
      "SCHEMA_MIGRATION_DATABASE_CHANGED",
      "Application database path changed during migration",
    );
  }
}

function syncDirectory(path: string) {
  const descriptor = openSync(path, fileConstants.O_RDONLY);
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function markerDocument(
  expectedSourceLogicalSha256: string,
  identity: Readonly<{
    dev: number | bigint | string;
    ino: number | bigint | string;
  }>,
  operationId: string,
): MigrationMarker {
  return Object.freeze({
    contract: markerContract,
    databaseDev: String(identity.dev),
    databaseIno: String(identity.ino),
    expectedSourceLogicalSha256,
    operationId,
    sourceVersion: sourceSchemaVersion,
    targetVersion: currentSchemaVersion,
  });
}

function markerIdentity(
  details: NonNullable<ReturnType<typeof fstatSync>>,
): MigrationMarkerIdentity {
  return Object.freeze({
    ctimeMs: Number(details.ctimeMs),
    dev: Number(details.dev),
    ino: Number(details.ino),
    mode: Number(details.mode),
    mtimeMs: Number(details.mtimeMs),
    nlink: Number(details.nlink),
    size: Number(details.size),
    uid: Number(details.uid),
  });
}

function sameMarkerIdentity(
  left: MigrationMarkerIdentity,
  right: MigrationMarkerIdentity,
) {
  return left.ctimeMs === right.ctimeMs && left.dev === right.dev &&
    left.ino === right.ino && left.mode === right.mode &&
    left.mtimeMs === right.mtimeMs && left.nlink === right.nlink &&
    left.size === right.size && left.uid === right.uid;
}

function sameMarkerDocument(left: MigrationMarker, right: MigrationMarker) {
  return left.contract === right.contract &&
    left.databaseDev === right.databaseDev &&
    left.databaseIno === right.databaseIno &&
    left.expectedSourceLogicalSha256 === right.expectedSourceLogicalSha256 &&
    left.operationId === right.operationId &&
    left.sourceVersion === right.sourceVersion &&
    left.targetVersion === right.targetVersion;
}

function readMarker(markerPath: string): PinnedMigrationMarker | undefined {
  let lexical;
  try {
    lexical = lstatSync(markerPath);
  } catch (error) {
    if (
      error && typeof error === "object" && "code" in error &&
      error.code === "ENOENT"
    ) return undefined;
    fail("SCHEMA_MIGRATION_MARKER_INVALID", "Migration marker is unavailable");
  }
  if (lexical.isSymbolicLink()) {
    fail("SCHEMA_MIGRATION_MARKER_INVALID", "Migration marker is invalid");
  }
  let descriptor: number;
  try {
    descriptor = openSync(
      markerPath,
      fileConstants.O_RDONLY | (fileConstants.O_NOFOLLOW ?? 0),
    );
  } catch {
    fail("SCHEMA_MIGRATION_MARKER_INVALID", "Migration marker is unavailable");
  }
  try {
    const before = fstatSync(descriptor);
    if (
      !before.isFile() || before.nlink !== 1 ||
      BigInt(before.uid) !== currentUid() || (before.mode & 0o077) !== 0 ||
      before.size < 2 || before.size > 4_096
    ) fail("SCHEMA_MIGRATION_MARKER_INVALID", "Migration marker is invalid");
    const buffer = Buffer.alloc(4_097);
    let total = 0;
    while (total < buffer.length) {
      const bytesRead = readSync(
        descriptor,
        buffer,
        total,
        buffer.length - total,
        total,
      );
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    const after = fstatSync(descriptor);
    if (
      after.dev !== before.dev || after.ino !== before.ino ||
      after.size !== before.size || after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs || total !== before.size ||
      total > 4_096
    ) fail("SCHEMA_MIGRATION_MARKER_INVALID", "Migration marker changed while reading");
    let parsed: Partial<MigrationMarker>;
    try {
      parsed = JSON.parse(buffer.toString("utf8", 0, total)) as
        Partial<MigrationMarker>;
    } finally {
      buffer.fill(0);
    }
    if (
      parsed.contract !== markerContract ||
      parsed.sourceVersion !== sourceSchemaVersion ||
      parsed.targetVersion !== currentSchemaVersion ||
      typeof parsed.databaseDev !== "string" || !/^\d+$/.test(parsed.databaseDev) ||
      typeof parsed.databaseIno !== "string" || !/^\d+$/.test(parsed.databaseIno) ||
      typeof parsed.expectedSourceLogicalSha256 !== "string" ||
      !sha256Pattern.test(parsed.expectedSourceLogicalSha256) ||
      typeof parsed.operationId !== "string" ||
      !/^[a-f0-9-]{36}$/.test(parsed.operationId)
    ) fail("SCHEMA_MIGRATION_MARKER_INVALID", "Migration marker is invalid");
    let pathDetails: NonNullable<ReturnType<typeof lstatSync>>;
    try {
      pathDetails = lstatSync(markerPath);
    } catch {
      fail("SCHEMA_MIGRATION_MARKER_CHANGED", "Migration marker changed while reading");
    }
    const pinnedIdentity = markerIdentity(after);
    if (
      pathDetails.isSymbolicLink() || !pathDetails.isFile() ||
      !sameMarkerIdentity(pinnedIdentity, markerIdentity(pathDetails))
    ) fail("SCHEMA_MIGRATION_MARKER_CHANGED", "Migration marker changed while reading");
    return Object.freeze({
      document: markerDocument(
        parsed.expectedSourceLogicalSha256,
        { dev: parsed.databaseDev, ino: parsed.databaseIno },
        parsed.operationId,
      ),
      identity: pinnedIdentity,
    });
  } catch (error) {
    if (error instanceof SchemaMigrationError) throw error;
    fail("SCHEMA_MIGRATION_MARKER_INVALID", "Migration marker is invalid");
  } finally {
    closeSync(descriptor);
  }
}

function createMarker(markerPath: string, marker: MigrationMarker) {
  let descriptor: number;
  let createdIdentity: MigrationMarkerIdentity | undefined;
  try {
    descriptor = openSync(
      markerPath,
      fileConstants.O_CREAT | fileConstants.O_EXCL | fileConstants.O_WRONLY |
        (fileConstants.O_NOFOLLOW ?? 0),
      0o600,
    );
  } catch {
    fail("SCHEMA_MIGRATION_MARKER_CONFLICT", "Migration marker already exists");
  }
  try {
    writeFileSync(descriptor, `${JSON.stringify(marker)}\n`, "utf8");
    fsyncSync(descriptor);
    createdIdentity = markerIdentity(fstatSync(descriptor));
  } finally {
    closeSync(descriptor);
  }
  syncDirectory(resolve(markerPath, ".."));
  const published = readMarker(markerPath);
  if (
    !createdIdentity || !published ||
    !sameMarkerIdentity(published.identity, createdIdentity) ||
    !sameMarkerDocument(published.document, marker)
  ) fail("SCHEMA_MIGRATION_MARKER_CHANGED", "Migration marker changed while publishing");
  return published;
}

function assertSameMigrationMarker(
  markerPath: string,
  expected: PinnedMigrationMarker,
) {
  const actual = readMarker(markerPath);
  if (
    !actual || !sameMarkerIdentity(actual.identity, expected.identity) ||
    !sameMarkerDocument(actual.document, expected.document)
  ) fail("SCHEMA_MIGRATION_MARKER_CHANGED", "Migration marker changed during migration");
}

function ensureMigrationMarkerFailClosed(
  markerPath: string,
  marker: MigrationMarker,
) {
  try {
    if (readMarker(markerPath)) return;
  } catch {
    // An invalid or conflicting entry is already a fail-closed runtime marker.
    return;
  }
  try {
    createMarker(markerPath, marker);
  } catch {
    // A concurrent or conflicting entry still keeps ordinary runtime closed.
  }
}

function exactSchemaVersion(database: DatabaseSync) {
  const row = database.prepare("PRAGMA user_version").get() as
    | { user_version?: unknown }
    | undefined;
  return Number(row?.user_version);
}

function assertFrozenSourceDrain(database: DatabaseSync) {
  const active = database.prepare(`
    SELECT COUNT(*) AS count
    FROM generation_tasks
    WHERE state IN ('queued', 'running', 'retrying', 'recovering')
  `).get() as { count?: unknown } | undefined;
  if (Number(active?.count) !== 0) {
    fail(
      "SCHEMA_MIGRATION_ACTIVE_GENERATION_TASKS",
      "Active generation tasks must drain before migration",
    );
  }
  const unsettledPaidBoundary = database.prepare(`
    WITH associated_attempts AS (
      SELECT
        task.id AS task_id,
        COALESCE(
          CASE WHEN task.provider_task_id IS NOT NULL THEN (
            SELECT paid.id
            FROM generation_provider_attempts AS paid
            WHERE paid.task_id = task.id
            ORDER BY paid.execution_attempt DESC, paid.id DESC
            LIMIT 1
          ) END,
          (
            SELECT current_attempt.id
            FROM generation_provider_attempts AS current_attempt
            WHERE current_attempt.task_id = task.id
              AND current_attempt.execution_attempt = task.attempt
            ORDER BY current_attempt.id DESC
            LIMIT 1
          )
        ) AS attempt_id
      FROM generation_tasks AS task
    )
    SELECT COUNT(*) AS count
    FROM generation_provider_attempts AS attempt
    JOIN generation_tasks AS task ON task.id = attempt.task_id
    JOIN associated_attempts AS associated ON associated.task_id = task.id
    WHERE attempt.evidence = 'provider-boundary'
      AND NOT (
        associated.attempt_id = attempt.id
        AND (
          task.state = 'success'
          OR task.error_code IN (
            'AUTH', 'PERMISSION', 'RATE_LIMIT', 'PROVIDER_FAILED'
          )
        )
      )
  `).get() as { count?: unknown } | undefined;
  if (Number(unsettledPaidBoundary?.count) !== 0) {
    fail(
      "SCHEMA_MIGRATION_UNSETTLED_PROVIDER_ATTEMPTS",
      "Provider-boundary attempts must be definitively settled before migration",
    );
  }
  const safety = database.prepare(`
    SELECT global_enabled, emergency_stop
    FROM generation_safety_settings
    WHERE id = 1
  `).get() as
    | { emergency_stop?: unknown; global_enabled?: unknown }
    | undefined;
  if (
    !safety ||
    (Number(safety.global_enabled) !== 0 && Number(safety.emergency_stop) !== 1)
  ) {
    fail(
      "SCHEMA_MIGRATION_GENERATION_NOT_FROZEN",
      "Generation must be globally frozen before migration",
    );
  }
  const pendingMedia = database.prepare(`
    SELECT COUNT(*) AS count
    FROM media_assets
    WHERE storage_status = 'pending'
  `).get() as { count?: unknown } | undefined;
  if (Number(pendingMedia?.count) !== 0) {
    fail(
      "SCHEMA_MIGRATION_ACTIVE_MEDIA",
      "Pending media operations must drain before migration",
    );
  }
}

function assertExactCurrent(database: DatabaseSync) {
  if (
    !databaseMatchesMigrationManifest(database) ||
    !databaseMatchesSchemaContract(database) ||
    database.prepare("PRAGMA foreign_key_check").all().length !== 0
  ) fail("SCHEMA_MIGRATION_TARGET_INVALID", "Migrated database is not exact current schema");
}

function safeTestClockAllowed(dataDirectory: string) {
  if (
    process.env.UNBOUNDRY_SAFE_TEST !== "1" ||
    process.env.UNBOUNDRY_SCHEMA_MIGRATION_TEST_CLOCK !== "1"
  ) return false;
  try {
    const systemTemporaryRoot = realpathSync(String(
      process.env.UNBOUNDRY_SYSTEM_TEMPORARY_ROOT ?? "",
    ));
    const testRoot = realpathSync(String(process.env.UNBOUNDRY_TEST_ROOT ?? ""));
    const repositoryRoot = realpathSync(String(
      process.env.UNBOUNDRY_TEST_REPOSITORY_ROOT ?? "",
    ));
    const originalRepositoryRoot = resolve(String(
      process.env.UNBOUNDRY_ORIGINAL_REPOSITORY_ROOT ?? "",
    ));
    const sentinelPath = realpathSync(String(
      process.env.UNBOUNDRY_SAFE_RUN_SENTINEL ?? "",
    ));
    const sentinel = lstatSync(sentinelPath);
    const nonce = String(process.env.UNBOUNDRY_SAFE_RUN_NONCE ?? "");
    const expectedNodeOptions = `--import=${join(
      repositoryRoot,
      "scripts/offline-network-guard.mjs",
    )}`;
    const sentinelDescriptor = openSync(
      sentinelPath,
      fileConstants.O_RDONLY | (fileConstants.O_NOFOLLOW ?? 0),
    );
    let sentinelSource = "";
    try {
      const buffer = Buffer.alloc(256);
      const bytesRead = readSync(
        sentinelDescriptor,
        buffer,
        0,
        buffer.length,
        0,
      );
      if (bytesRead === buffer.length) return false;
      sentinelSource = buffer.toString("utf8", 0, bytesRead).trim();
      buffer.fill(0);
    } finally {
      closeSync(sentinelDescriptor);
    }
    return nonce.length >= 16 && sentinelSource === nonce &&
      sentinel.isFile() && !sentinel.isSymbolicLink() && sentinel.nlink === 1 &&
      BigInt(sentinel.uid) === currentUid() && (sentinel.mode & 0o077) === 0 &&
      containsPath(systemTemporaryRoot, testRoot) &&
      containsPath(testRoot, realpathSync(dataDirectory)) &&
      containsPath(systemTemporaryRoot, repositoryRoot) &&
      repositoryRoot !== originalRepositoryRoot &&
      containsPath(testRoot, sentinelPath) &&
      process.env.NODE_OPTIONS === expectedNodeOptions;
  } catch {
    return false;
  }
}

type NativeDurationProbeAuditEvent = Readonly<{
  argumentsSha256: string;
  operationId: string;
  phase: "complete" | "start";
  sequence: number;
}>;

type NativeDurationProbeControl = Readonly<{
  close: () => void;
  probe: LegacyMediaDurationProbe;
  summary: () => Readonly<{
    nativeDurationProbeAuditSha256: string;
    nativeDurationProbes: number;
  }>;
}>;

function nativeDurationProbeControl(
  options: SchemaMigrationOptions,
): NativeDurationProbeControl {
  const events: NativeDurationProbeAuditEvent[] = [];
  const operationId = randomUUID();
  let auditDescriptor: number | undefined;
  let executable = "ffprobe";
  if (options.testDurationProbe) {
    if (!safeTestClockAllowed(options.dataDirectory)) {
      fail(
        "SCHEMA_MIGRATION_TEST_DURATION_PROBE_FORBIDDEN",
        "Test duration probe is forbidden",
      );
    }
    const requestedExecutable = normalizedAbsolute(
      options.testDurationProbe.executable,
      "Test duration probe executable",
    );
    const requestedAuditPath = normalizedAbsolute(
      options.testDurationProbe.auditPath,
      "Test duration probe audit",
    );
    try {
      const testRoot = realpathSync(String(process.env.UNBOUNDRY_TEST_ROOT ?? ""));
      const executablePath = realpathSync(requestedExecutable);
      const auditPath = realpathSync(requestedAuditPath);
      const executableDetails = lstatSync(requestedExecutable);
      const auditDetails = lstatSync(requestedAuditPath);
      if (
        executablePath !== requestedExecutable || auditPath !== requestedAuditPath ||
        !containsPath(testRoot, executablePath) || !containsPath(testRoot, auditPath) ||
        executableDetails.isSymbolicLink() || !executableDetails.isFile() ||
        executableDetails.nlink !== 1 || BigInt(executableDetails.uid) !== currentUid() ||
        (executableDetails.mode & 0o022) !== 0 ||
        (executableDetails.mode & 0o100) === 0 ||
        auditDetails.isSymbolicLink() || !auditDetails.isFile() ||
        auditDetails.nlink !== 1 || BigInt(auditDetails.uid) !== currentUid() ||
        (auditDetails.mode & 0o077) !== 0 || auditDetails.size > 1_048_576
      ) {
        fail(
          "SCHEMA_MIGRATION_TEST_DURATION_PROBE_FORBIDDEN",
          "Test duration probe is unsafe",
        );
      }
      auditDescriptor = openSync(
        auditPath,
        fileConstants.O_WRONLY | fileConstants.O_APPEND |
          (fileConstants.O_NOFOLLOW ?? 0),
      );
      const openedAudit = fstatSync(auditDescriptor);
      if (
        !openedAudit.isFile() || openedAudit.nlink !== 1 ||
        openedAudit.dev !== auditDetails.dev || openedAudit.ino !== auditDetails.ino ||
        openedAudit.uid !== auditDetails.uid || openedAudit.mode !== auditDetails.mode
      ) {
        fail(
          "SCHEMA_MIGRATION_TEST_DURATION_PROBE_FORBIDDEN",
          "Test duration probe audit changed while opening",
        );
      }
      executable = executablePath;
    } catch (error) {
      if (auditDescriptor !== undefined) {
        try {
          closeSync(auditDescriptor);
        } catch {
          // Preserve the deterministic configuration failure.
        }
        auditDescriptor = undefined;
      }
      if (error instanceof SchemaMigrationError) throw error;
      fail(
        "SCHEMA_MIGRATION_TEST_DURATION_PROBE_FORBIDDEN",
        "Test duration probe is unavailable",
      );
    }
  }

  const argumentsSha256 = (arguments_: readonly string[]) =>
    createHash("sha256").update(JSON.stringify(arguments_), "utf8").digest("hex");
  const probe: LegacyMediaDurationProbe = Object.freeze({
    executable,
    onEvent: (event) => {
      const auditEvent = Object.freeze({
        argumentsSha256: argumentsSha256(event.arguments),
        operationId,
        phase: event.phase,
        sequence: events.length + 1,
      }) satisfies NativeDurationProbeAuditEvent;
      events.push(auditEvent);
      if (auditDescriptor !== undefined) {
        writeFileSync(auditDescriptor, `${JSON.stringify(auditEvent)}\n`, {
          encoding: "utf8",
        });
        fsyncSync(auditDescriptor);
      }
      if (event.phase === "complete") {
        options.onCheckpoint?.("duration-probe-complete");
      }
    },
  });
  return Object.freeze({
    close: () => {
      if (auditDescriptor === undefined) return;
      closeSync(auditDescriptor);
      auditDescriptor = undefined;
    },
    probe,
    summary: () => {
      const starts = events.filter(({ phase }) => phase === "start").length;
      const completes = events.filter(({ phase }) => phase === "complete").length;
      if (starts !== completes) {
        fail(
          "SCHEMA_MIGRATION_NATIVE_DURATION_PROBE_INCOMPLETE",
          "Native duration probe audit is incomplete",
        );
      }
      return Object.freeze({
        nativeDurationProbeAuditSha256: createHash("sha256")
          .update(JSON.stringify(events), "utf8")
          .digest("hex"),
        nativeDurationProbes: completes,
      });
    },
  });
}

function migrationClock(options: SchemaMigrationOptions) {
  if (options.testClock) {
    if (
      !safeTestClockAllowed(options.dataDirectory) ||
      !Number.isInteger(options.testClock.drainMilliseconds) ||
      options.testClock.drainMilliseconds < 0 ||
      options.testClock.drainMilliseconds > requiredDrainMilliseconds
    ) fail("SCHEMA_MIGRATION_TEST_CLOCK_FORBIDDEN", "Test migration clock is forbidden");
    return options.testClock;
  }
  const environmentOverride = process.env.UNBOUNDRY_SCHEMA_MIGRATION_TEST_CLOCK_MS;
  if (environmentOverride !== undefined) {
    const milliseconds = Number(environmentOverride);
    if (
      !safeTestClockAllowed(options.dataDirectory) ||
      !Number.isInteger(milliseconds) || milliseconds < 0 ||
      milliseconds > requiredDrainMilliseconds
    ) fail("SCHEMA_MIGRATION_TEST_CLOCK_FORBIDDEN", "Test migration clock is forbidden");
    return {
      drainMilliseconds: milliseconds,
      sleep: (duration: number) => new Promise<void>((resolveSleep) => {
        setTimeout(resolveSleep, duration);
      }),
    };
  }
  return {
    drainMilliseconds: requiredDrainMilliseconds,
    sleep: (duration: number) => new Promise<void>((resolveSleep) => {
      setTimeout(resolveSleep, duration);
    }),
  };
}

function createInspectionRoot(scratchRoot: string) {
  let root: string;
  try {
    root = mkdtempSync(join(scratchRoot, ".unboundry-schema-migration-"));
    chmodSync(root, 0o700);
  } catch {
    fail("SCHEMA_MIGRATION_SCRATCH_INVALID", "Private migration scratch is unavailable");
  }
  return root;
}

function sourceInspection(
  database: DatabaseSync,
  inspectionRoot: string,
  expectedSourceLogicalSha256: string,
) {
  let inspection;
  try {
    inspection = inspectLockedBackupDatabase(database, inspectionRoot);
  } catch (error) {
    if (error instanceof BackupInspectionError) {
      fail("SCHEMA_MIGRATION_SOURCE_INVALID", "Migration source contract is invalid");
    }
    throw error;
  }
  if (
    inspection.userVersion !== sourceSchemaVersion ||
    !databaseMatchesFrozenSchema37Contract(database) ||
    !databaseMatchesMigrationManifest(database, sourceSchemaVersion)
  ) fail("SCHEMA_MIGRATION_SOURCE_INVALID", "Migration requires exact schema 37");
  if (inspection.logicalSha256 !== expectedSourceLogicalSha256) {
    fail(
      "SCHEMA_MIGRATION_SOURCE_SHA_MISMATCH",
      "Locked migration source does not match the expected logical SHA-256",
    );
  }
  return inspection;
}

/**
 * Exact-v37 to v39 one-shot migration. It never starts an HTTP listener and
 * never admits schema 38 as a source. Apply mode holds BEGIN IMMEDIATE across
 * the full quiet gate and commits both schema migrations atomically.
 */
export async function migrateSchema37To39(
  options: SchemaMigrationOptions,
): Promise<SchemaMigrationResult> {
  const requestedDataDirectory = normalizedAbsolute(
    options.dataDirectory,
    "Data directory",
  );
  const scratchRoot = normalizedAbsolute(
    options.scratchRoot ?? resolve(tmpdir()),
    "Scratch root",
  );
  const runtimeDirectory = options.runtimeDirectory === undefined
    ? undefined
    : normalizedAbsolute(options.runtimeDirectory, "Runtime directory");
  if (!sha256Pattern.test(options.expectedSourceLogicalSha256)) {
    fail("SCHEMA_MIGRATION_ARGUMENT_INVALID", "Expected logical SHA-256 is invalid");
  }
  if (options.mode !== "apply" && options.mode !== "dry-run") {
    fail("SCHEMA_MIGRATION_ARGUMENT_INVALID", "Migration mode is invalid");
  }
  const ownedDataDirectory = assertOwnedDataDirectory(requestedDataDirectory);
  const dataDirectory = ownedDataDirectory.path;
  // Do not let a lexical alias change which child path is subsequently used.
  // The requested directory must itself be the canonical physical directory.
  if (dataDirectory !== requestedDataDirectory) {
    fail(
      "SCHEMA_MIGRATION_DATA_DIRECTORY_INVALID",
      "Data directory must be a canonical physical path",
    );
  }
  const databasePath = join(dataDirectory, "unboundry.sqlite");
  const before = assertOwnedDatabase(databasePath);
  const markerPath = join(dataDirectory, migrationIncompleteMarker);
  const clock = migrationClock(options);
  const inspectionRoot = createInspectionRoot(scratchRoot);
  let migrationRuntime: RuntimeRoleCoordinator | undefined;
  let migrationGuardian: LegacyChildGuardian | undefined;
  try {
    migrationRuntime = acquireMigrationRuntimeLease(
      dataDirectory,
      runtimeDirectory,
    );
    const heldRuntimeDirectory = migrationRuntime.snapshot().runtimeDirectory;
    if (!heldRuntimeDirectory) {
      fail(
        "SCHEMA_MIGRATION_RUNTIME_LEASE_UNSAFE",
        "Migration runtime active lease has no physical runtime directory",
      );
    }
    migrationGuardian = acquireLegacyChildGuardian({
      dataDirectory,
      runtimeDirectory: heldRuntimeDirectory,
    });
    assertMigrationRuntimeLease(migrationRuntime);
    assertMigrationGuardian(migrationGuardian);
  } catch (error) {
    let guardianReleaseError: unknown;
    try {
      migrationGuardian?.release();
    } catch (releaseError) {
      guardianReleaseError = releaseError;
      if (migrationGuardian) indeterminateMigrationOwners.add(migrationGuardian);
      if (migrationRuntime) indeterminateMigrationOwners.add(migrationRuntime);
    }
    let runtimeReleaseError: unknown;
    if (!guardianReleaseError) {
      try {
        migrationRuntime?.close();
      } catch (releaseError) {
        runtimeReleaseError = releaseError;
        if (migrationRuntime) indeterminateMigrationOwners.add(migrationRuntime);
      }
    }
    let scratchCleanupError: unknown;
    try {
      rmSync(inspectionRoot, { force: true, recursive: true });
    } catch (cleanupError) {
      scratchCleanupError = cleanupError;
    }
    if (guardianReleaseError) {
      if (guardianReleaseError instanceof SchemaMigrationError) {
        throw guardianReleaseError;
      }
      if (guardianReleaseError instanceof LegacyChildGuardianError) {
        migrationGuardianFailure(guardianReleaseError);
      }
      fail(
        "SCHEMA_MIGRATION_FAILED_OWNER_RELEASE",
        "Schema migration owner release failed",
      );
    }
    if (runtimeReleaseError) {
      if (runtimeReleaseError instanceof SchemaMigrationError) {
        throw runtimeReleaseError;
      }
      if (runtimeReleaseError instanceof RuntimeRoleError) {
        migrationRuntimeLeaseFailure(runtimeReleaseError);
      }
      fail(
        "SCHEMA_MIGRATION_FAILED_OWNER_RELEASE",
        "Schema migration owner release failed",
      );
    }
    if (scratchCleanupError) {
      fail(
        "SCHEMA_MIGRATION_FAILED_SCRATCH_CLEANUP",
        "Schema migration scratch cleanup failed",
      );
    }
    if (error instanceof SchemaMigrationError) throw error;
    if (error instanceof LegacyChildGuardianError) {
      migrationGuardianFailure(error);
    }
    if (error instanceof RuntimeRoleError) migrationRuntimeLeaseFailure(error);
    fail(
      "SCHEMA_MIGRATION_FAILED_OWNER_ACQUIRE",
      "Schema migration owner acquisition failed",
    );
  }
  const assertPinnedPaths = () => {
    assertSameOwnedDataDirectory(dataDirectory, ownedDataDirectory.details);
    assertSameOwnedDatabase(databasePath, before);
    assertMigrationRuntimeLease(migrationRuntime);
    assertMigrationGuardian(migrationGuardian);
  };
  let existingMarkerState: PinnedMigrationMarker | undefined;
  let existingMarker: MigrationMarker | undefined;
  let activeMarker: MigrationMarker | undefined;
  let pinnedMarker: PinnedMigrationMarker | undefined;
  const assertPinnedMarker = () => {
    if (!pinnedMarker) {
      fail("SCHEMA_MIGRATION_MARKER_CHANGED", "Migration marker is unavailable");
    }
    assertSameMigrationMarker(markerPath, pinnedMarker);
  };
  const emitCheckpoint = (checkpoint: SchemaMigrationCheckpoint) => {
    assertPinnedPaths();
    options.onCheckpoint?.(checkpoint);
    assertPinnedPaths();
  };
  let durationProbe: NativeDurationProbeControl | undefined;
  let database: DatabaseSync | undefined;
  let transactionOpen = false;
  let schemaCommitted = false;
  let unexpectedStage: UnexpectedMigrationStage = "preflight";
  const stagedDurationProbe = (
    parentStage: "media-backfill" | "media-full-verify",
    stage: "media-backfill-probe" | "media-full-verify-probe",
  ): LegacyMediaDurationProbe => {
    if (!durationProbe) {
      fail(
        "SCHEMA_MIGRATION_NATIVE_DURATION_PROBE_INCOMPLETE",
        "Native duration probe is unavailable",
      );
    }
    const probe = durationProbe.probe;
    return Object.freeze({
      ...probe,
      onEvent: (event) => {
        unexpectedStage = stage;
        probe.onEvent?.(event);
        if (event.phase === "complete") unexpectedStage = parentStage;
      },
    });
  };
  try {
    assertPinnedPaths();
    try {
      lstatSync(join(dataDirectory, ".unboundry-restore-incomplete"));
      fail("SCHEMA_MIGRATION_RESTORE_INCOMPLETE", "Restore maintenance is incomplete");
    } catch (error) {
      if (
        error instanceof SchemaMigrationError || !error ||
        typeof error !== "object" || !("code" in error) || error.code !== "ENOENT"
      ) throw error;
    }
    assertPinnedPaths();
    existingMarkerState = readMarker(markerPath);
    existingMarker = existingMarkerState?.document;
    activeMarker = existingMarker;
    pinnedMarker = existingMarkerState;
    if (
      existingMarker &&
      existingMarker.expectedSourceLogicalSha256 !==
        options.expectedSourceLogicalSha256
    ) fail("SCHEMA_MIGRATION_MARKER_MISMATCH", "Migration marker contract does not match");
    if (
      existingMarker && (
        existingMarker.databaseDev !== String(before.dev) ||
        existingMarker.databaseIno !== String(before.ino)
      )
    ) {
      fail(
        "SCHEMA_MIGRATION_DATABASE_CHANGED",
        "Migration marker belongs to a different application database",
      );
    }
    assertPinnedPaths();
    durationProbe = nativeDurationProbeControl({
      ...options,
      onCheckpoint: emitCheckpoint,
    });
    const busyTimeoutMilliseconds = options.busyTimeoutMilliseconds ?? 5_000;
    if (
      !Number.isInteger(busyTimeoutMilliseconds) ||
      busyTimeoutMilliseconds < 0 || busyTimeoutMilliseconds > 120_000
    ) fail("SCHEMA_MIGRATION_ARGUMENT_INVALID", "Migration lock timeout is invalid");
    database = new DatabaseSync(databasePath, {
      timeout: busyTimeoutMilliseconds,
    });
    database.exec(
      `PRAGMA foreign_keys = ON; PRAGMA busy_timeout = ${busyTimeoutMilliseconds};`,
    );
    try {
      database.exec(options.mode === "apply" ? "BEGIN IMMEDIATE" : "BEGIN");
      transactionOpen = true;
    } catch {
      fail("SCHEMA_MIGRATION_LOCK_UNAVAILABLE", "Migration source lock is unavailable");
    }
    assertPinnedPaths();

    const version = exactSchemaVersion(database);
    if (version === 38) {
      fail("SCHEMA_MIGRATION_SCHEMA38_REJECTED", "Schema 38 is not an admitted migration source");
    }
    let backfill: LegacyMediaBackfillSummary = Object.freeze({
      checksums: 0,
      durations: 0,
      evidence: Object.freeze([]),
    });
    let recoveryEvidence = Object.freeze([]) as LegacyMediaBackfillSummary["evidence"];
    if (version === currentSchemaVersion) {
      if (!existingMarker || options.mode === "dry-run") {
        fail(
          existingMarker
            ? "SCHEMA_MIGRATION_RECOVERY_REQUIRED"
            : "SCHEMA_MIGRATION_NOT_REQUIRED",
          existingMarker
            ? "Committed migration requires apply-mode recovery"
            : "Application database is already current",
        );
      }
      unexpectedStage = "target-validation";
      assertExactCurrent(database);
      // The preceding process may have committed schema/media metadata and then
      // detected a physical replacement before clearing the marker. Rebuild
      // evidence from every ready local object; an empty incremental backfill
      // must never make that post-COMMIT failure self-heal.
      unexpectedStage = "media-full-verify";
      recoveryEvidence = verifyCommittedMigrationMediaStrict(
        database,
        dataDirectory,
        {
          durationProbe: stagedDurationProbe(
            "media-full-verify",
            "media-full-verify-probe",
          ),
        },
      );
    } else {
      unexpectedStage = "preflight";
      sourceInspection(
        database,
        inspectionRoot,
        options.expectedSourceLogicalSha256,
      );
      assertFrozenSourceDrain(database);
      emitCheckpoint("source-locked");
      if (options.mode === "dry-run") {
        assertPinnedPaths();
        database.exec("ROLLBACK");
        transactionOpen = false;
        assertPinnedPaths();
        if (existingMarker) {
          fail(
            "SCHEMA_MIGRATION_RECOVERY_REQUIRED",
            "Incomplete migration requires apply-mode recovery",
          );
        }
        return Object.freeze({
          backfilledChecksums: 0,
          backfilledDurations: 0,
          drainMilliseconds: requiredDrainMilliseconds,
          expectedSourceLogicalSha256: options.expectedSourceLogicalSha256,
          mode: "dry-run",
          ...durationProbe.summary(),
          recovered: Boolean(existingMarker),
          sourceVersion: sourceSchemaVersion,
          status: "ready",
          targetLogicalSha256: null,
          targetVersion: currentSchemaVersion,
        });
      }

      if (!existingMarker) {
        activeMarker = markerDocument(
          options.expectedSourceLogicalSha256,
          before,
          randomUUID(),
        );
        pinnedMarker = createMarker(
          markerPath,
          activeMarker,
        );
      }
      unexpectedStage = "drain";
      assertPinnedPaths();
      assertPinnedMarker();
      await clock.sleep(clock.drainMilliseconds);
      assertPinnedPaths();
      assertPinnedMarker();
      sourceInspection(
        database,
        inspectionRoot,
        options.expectedSourceLogicalSha256,
      );
      assertFrozenSourceDrain(database);
      emitCheckpoint("drain-complete");
      assertPinnedPaths();
      assertPinnedMarker();
      unexpectedStage = "schema-38-apply";
      applyPendingSchemaMigrationsInTransaction(database, {
        sourceVersion: sourceSchemaVersion,
        onMigrationApplied: ({ version: migratedVersion }) => {
          if (migratedVersion === 38) {
            emitCheckpoint("schema-38-applied");
            unexpectedStage = "schema-39-apply";
          }
          if (migratedVersion === 39) {
            emitCheckpoint("schema-39-applied");
            unexpectedStage = "schema-40-apply";
          }
          if (migratedVersion === 40) {
            emitCheckpoint("schema-40-applied");
            unexpectedStage = "schema-41-apply";
          }
          if (migratedVersion === 41) {
            emitCheckpoint("schema-41-applied");
            unexpectedStage = "schema-42-apply";
          }
          if (migratedVersion === 42) emitCheckpoint("schema-42-applied");
          assertPinnedPaths();
          assertPinnedMarker();
        },
      });
      unexpectedStage = "target-validation";
      assertExactCurrent(database);
    }

    unexpectedStage = "media-backfill";
    backfill = backfillLegacyMediaStrict(database, dataDirectory, {
      callerOwnsTransaction: true,
      durationProbe: stagedDurationProbe(
        "media-backfill",
        "media-backfill-probe",
      ),
      onRow: () => {
        unexpectedStage = "media-backfill";
        emitCheckpoint("backfill-row");
        assertPinnedPaths();
        assertPinnedMarker();
      },
    });
    unexpectedStage = "media-full-verify";
    const fullMediaEvidence = verifyCommittedMigrationMediaStrict(
      database,
      dataDirectory,
      {
        durationProbe: stagedDurationProbe(
          "media-full-verify",
          "media-full-verify-probe",
        ),
      },
    );
    const mediaEvidence = Object.freeze([
      ...recoveryEvidence,
      ...backfill.evidence,
      ...fullMediaEvidence,
    ]);
    unexpectedStage = "target-validation";
    if (
      !databaseMatchesMigrationManifest(database) ||
      !databaseMatchesSchemaContract(database) ||
      database.prepare("PRAGMA foreign_key_check").all().length !== 0
    ) fail("SCHEMA_MIGRATION_TARGET_INVALID", "Migrated database is not exact current schema");
    if (!databaseHasCompleteLegacyMediaMetadata(database)) {
      fail(
        "SCHEMA_MIGRATION_BACKFILL_INCOMPLETE",
        "Legacy media metadata remains incomplete",
      );
    }
    const finalCheck = database.prepare("PRAGMA integrity_check").all() as
      Array<{ integrity_check?: unknown }>;
    if (
      finalCheck.length !== 1 ||
      String(finalCheck[0]?.integrity_check) !== "ok"
    ) fail("SCHEMA_MIGRATION_TARGET_INVALID", "Migrated database integrity failed");
    revalidateLegacyMediaBackfillEvidence(database, mediaEvidence);
    assertPinnedPaths();
    assertPinnedMarker();
    unexpectedStage = "commit";
    database.exec("COMMIT");
    transactionOpen = false;
    schemaCommitted = true;
    unexpectedStage = "post-commit-verify";
    emitCheckpoint("schema-committed");
    assertPinnedPaths();
    assertPinnedMarker();
    revalidateLegacyMediaBackfillEvidence(database, mediaEvidence);
    // Commit ended the writer transaction. Start a fresh read snapshot on the
    // same still-identified connection and compute the exact logical target
    // hash before removing the recovery marker. Final orchestration can then
    // bind startup inspection to the bytes this migration actually published.
    unexpectedStage = "target-logical-inspection";
    database.exec("BEGIN");
    transactionOpen = true;
    assertPinnedPaths();
    assertPinnedMarker();
    const targetLogicalSha256 = inspectLockedBackupDatabase(
      database,
      inspectionRoot,
    ).logicalSha256;
    revalidateLegacyMediaBackfillEvidence(database, mediaEvidence);
    assertPinnedPaths();
    assertPinnedMarker();
    database.exec("ROLLBACK");
    transactionOpen = false;
    assertPinnedPaths();
    assertPinnedMarker();
    revalidateLegacyMediaBackfillEvidence(database, mediaEvidence);
    unexpectedStage = "marker-clear";
    unlinkSync(markerPath);
    syncDirectory(dataDirectory);
    try {
      if (readMarker(markerPath)) {
        fail("SCHEMA_MIGRATION_MARKER_CHANGED", "Migration marker changed while clearing");
      }
      assertPinnedPaths();
      revalidateLegacyMediaBackfillEvidence(database, mediaEvidence);
    } catch (error) {
      // Cross-file marker removal cannot be one syscall with the database
      // identity check. If the final narrow window detects a replacement,
      // restore the exact marker contract before surfacing failure so ordinary
      // runtime remains fail-closed. A conflicting marker is also fail-closed.
      if (activeMarker) {
        ensureMigrationMarkerFailClosed(markerPath, activeMarker);
      }
      throw error;
    }
    unexpectedStage = "complete";
    emitCheckpoint("complete");
    return Object.freeze({
      backfilledChecksums: backfill.checksums,
      backfilledDurations: backfill.durations,
      drainMilliseconds: clock.drainMilliseconds,
      expectedSourceLogicalSha256: options.expectedSourceLogicalSha256,
      mode: "apply",
      ...durationProbe.summary(),
      recovered: Boolean(existingMarker) || schemaCommitted && version === currentSchemaVersion,
      sourceVersion: sourceSchemaVersion,
      status: "complete",
      targetLogicalSha256,
      targetVersion: currentSchemaVersion,
    });
  } catch (error) {
    if (transactionOpen && database?.isTransaction) {
      try {
        database.exec("ROLLBACK");
      } catch {
        // Closing releases the lock; keep the marker after any apply failure.
      }
    }
    if (options.mode === "apply" && activeMarker) {
      try {
        assertSameOwnedDataDirectory(dataDirectory, ownedDataDirectory.details);
        ensureMigrationMarkerFailClosed(markerPath, activeMarker);
      } catch {
        // Never create a marker inside a replaced data directory. The original
        // pinned directory retains its own marker and a rolled-back source stays
        // non-current at any newly published path.
      }
    }
    if (error instanceof SchemaMigrationError) throw error;
    failUnexpectedMigration(unexpectedStage);
  } finally {
    let databaseCloseError: unknown;
    try {
      database?.close();
    } catch (error) {
      databaseCloseError = error;
    }
    try {
      durationProbe?.close();
    } catch {
      // Audit events are synchronously fsynced before the database marker can
      // be removed. Avoid manufacturing an unmarked database failure on close.
    }
    let guardianReleaseError: unknown;
    if (!databaseCloseError) {
      try {
        assertMigrationGuardian(migrationGuardian);
        migrationGuardian.release();
      } catch (error) {
        guardianReleaseError = error;
      }
    }
    let runtimeReleaseError: unknown;
    if (!databaseCloseError && !guardianReleaseError) {
      try {
        assertMigrationRuntimeLease(migrationRuntime);
        migrationRuntime.close();
      } catch (error) {
        runtimeReleaseError = error;
      }
    }
    let scratchCleanupError: unknown;
    try {
      rmSync(inspectionRoot, { force: true, recursive: true });
    } catch (error) {
      scratchCleanupError = error;
    }
    if (databaseCloseError) {
      indeterminateMigrationOwners.add(migrationGuardian);
      indeterminateMigrationOwners.add(migrationRuntime);
      fail(
        "SCHEMA_MIGRATION_DATABASE_CLOSE_UNKNOWN",
        "Migration database close is indeterminate; writer lease remains held",
      );
    }
    if (guardianReleaseError) {
      indeterminateMigrationOwners.add(migrationGuardian);
      indeterminateMigrationOwners.add(migrationRuntime);
      if (guardianReleaseError instanceof SchemaMigrationError) {
        throw guardianReleaseError;
      }
      if (guardianReleaseError instanceof LegacyChildGuardianError) {
        migrationGuardianFailure(guardianReleaseError);
      }
      fail(
        "SCHEMA_MIGRATION_FAILED_OWNER_RELEASE",
        "Schema migration owner release failed",
      );
    }
    if (runtimeReleaseError) {
      indeterminateMigrationOwners.add(migrationRuntime);
      if (runtimeReleaseError instanceof SchemaMigrationError) {
        throw runtimeReleaseError;
      }
      if (runtimeReleaseError instanceof RuntimeRoleError) {
        migrationRuntimeLeaseFailure(runtimeReleaseError);
      }
      fail(
        "SCHEMA_MIGRATION_FAILED_OWNER_RELEASE",
        "Schema migration owner release failed",
      );
    }
    if (scratchCleanupError) {
      fail(
        "SCHEMA_MIGRATION_FAILED_SCRATCH_CLEANUP",
        "Schema migration scratch cleanup failed",
      );
    }
  }
  fail("SCHEMA_MIGRATION_FAILED", "Schema migration failed");
}
