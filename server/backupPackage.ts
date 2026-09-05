import {
  constants as cryptoConstants,
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  hkdfSync,
  privateDecrypt,
  publicEncrypt,
  randomBytes,
  randomUUID,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";
import {
  constants as fileConstants,
  type BigIntStats,
} from "node:fs";
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  realpath,
  rename,
  rm,
  rmdir,
  unlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  posix,
  relative,
  resolve,
  sep,
} from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import {
  BackupInspectionError,
  inspectBackupDatabase,
  inspectLockedBackupDatabase,
  validateBackupSecretsWithContext,
  type BackupDatabaseInspection,
  type BackupSecretValidation,
} from "./backupInspection.ts";
import {
  inspectMediaIntegrity,
  summarizeMediaIntegrity,
  type MediaIntegrityFileEvidence,
  type MediaIntegrityOssEvidence,
  type MediaIntegrityReport,
  type MediaIntegrityIssueCode,
  type MediaIntegritySummary,
} from "./mediaIntegrity.ts";
import {
  createFakeOssRecoveryIndex,
  ossRecoveryIndexFileName,
} from "./fakeOssRecovery.ts";
import { generationReadinessQuery } from "./generationReadinessQuery.ts";
import { validateLibraryBackupDatabase } from "./libraryBackup.ts";

export const backupPackageFormatVersion = 2 as const;
const backupPackageFormat = "unboundry-encrypted-backup" as const;
const manifestMaximumBytes = 64 * 1024 * 1024;
const envelopeMaximumBytes = 128 * 1024;
const ioChunkBytes = 256 * 1024;
const reservationMarkerMaximumBytes = 64 * 1024;
const secretDocumentLockMaximumBytes = 1024 * 1024;
const backupIncompleteMarker = ".unboundry-backup-incomplete";
const restoreIncompleteMarker = ".unboundry-restore-incomplete";
const supportedBackupSchemaVersions = new Set([37, 38, 39, 40, 41, 42, 43]);
const currentBackupSchemaVersion = 43 as const;
const minimumProviderQuietMilliseconds = 60_000;
const restorableSecretFiles = new Set([
  "config-master.key",
  "provider-profiles.enc.json",
  "storage-profiles.enc.json",
]);
const transientSecretFiles = new Set([
  "provider-profile-write-lock.sqlite",
  "provider-profile-write-lock.sqlite-shm",
  "provider-profile-write-lock.sqlite-wal",
]);

export type BackupKeyInput = KeyObject | string | Buffer;

export type BackupSchemaVersion = 37 | 38 | 39 | 40 | 41 | 42 | 43;

export type BackupCapturePurpose =
  | "current-schema43"
  | "historical-recovery";

export type BackupCheckpointName =
  | "after-backup-reservation"
  | "after-database-snapshot"
  | "after-media-encryption"
  | "after-package-seal"
  | "after-restore-database"
  | "after-restore-media"
  | "after-restore-reservation"
  | "after-restore-secrets"
  | "after-secrets-encryption"
  | "before-backup-publish"
  | "before-restore-publish";

export type BackupCheckpoint = (
  checkpoint: BackupCheckpointName,
) => Promise<void> | void;

export type BackupOssMirror = Readonly<{
  filePath: string;
  objectKey: string;
  versionId: string;
}>;

export type BackupFreezeEvidence = Readonly<{
  generationFrozenAt: string;
  lastProviderAdmissionAt: string | null;
  sourceDatabaseLogicalSha256: string;
}>;

export type BackupFrozenSourceContract = Readonly<{
  expectedDatabaseLogicalSha256: string;
  expectedSchemaVersion: BackupSchemaVersion;
  freezeEvidence: BackupFreezeEvidence;
}>;

export type CreateEncryptedBackupOptions = Readonly<{
  backupRoot: string;
  capturePurpose?: BackupCapturePurpose;
  onCheckpoint?: BackupCheckpoint;
  ossMirrors?: readonly BackupOssMirror[];
  recoveryPublicKey: BackupKeyInput;
  retryBackupId?: string;
  scratchRoot?: string;
  signingPrivateKey: BackupKeyInput;
  sourceDirectory: string;
  sourceFrozen: true;
  frozenSourceContract?: BackupFrozenSourceContract;
  mediaWarningAllowlist?: readonly MediaIntegrityIssueCode[];
}>;

export type VerifyEncryptedBackupOptions = Readonly<{
  onCheckpoint?: BackupCheckpoint;
  packageDirectory: string;
  recoveryPrivateKey: BackupKeyInput;
  scratchRoot?: string;
  trustedSigningPublicKey: BackupKeyInput;
}>;

export type RestoreEncryptedBackupOptions = VerifyEncryptedBackupOptions &
  Readonly<{ targetDirectory: string }>;

export type InspectFrozenMediaIntegrityOptions = Readonly<{
  capturePurpose?: BackupCapturePurpose;
  onCheckpoint?: BackupCheckpoint;
  ossMirrors?: readonly BackupOssMirror[];
  scratchRoot?: string;
  sourceDirectory: string;
  sourceFrozen: true;
  frozenSourceContract?: BackupFrozenSourceContract;
  mediaWarningAllowlist?: readonly MediaIntegrityIssueCode[];
}>;

export type BackupPackageSummary = Readonly<{
  backupId: string;
  captureMode: "external-unverified" | "locked-exact";
  databaseLogicalSha256: string;
  finalCandidate: boolean;
  mediaFiles: number;
  mediaIntegrity: MediaIntegritySummary;
  ossMirrors: number;
  packageDirectory: string;
  schemaVersion: number;
  secretFiles: number;
}>;

type ReservationMarkerKind = "backup" | "restore";

type ReservationMarker = Readonly<{
  backupId: string;
  databaseLogicalSha256: string;
  format: "unboundry-incomplete-reservation";
  kind: ReservationMarkerKind;
  stagingDev: string;
  stagingIno: string;
  stagingName: string;
  targetName: string;
  version: 1;
}>;

export type QuarantineIncompleteReservationOptions = Readonly<{
  expectedBackupId: string;
  expectedDatabaseLogicalSha256: string;
  kind: ReservationMarkerKind;
  targetDirectory: string;
}>;

export type QuarantinedReservation = Readonly<{
  backupId: string;
  quarantineDirectory: string;
}>;

export class BackupPackageError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "BackupPackageError";
    this.code = code;
  }
}

function rethrowPackageFailure(
  error: unknown,
  fallbackCode: string,
  fallbackMessage: string,
): never {
  if (error instanceof BackupPackageError) throw error;
  if (error instanceof BackupInspectionError) {
    throw new BackupPackageError(error.code, error.message);
  }
  const wrapped = new BackupPackageError(fallbackCode, fallbackMessage) as
    BackupPackageError & { cause?: unknown };
  wrapped.cause = error;
  throw wrapped;
}

type TreeEntry = Readonly<{
  ctimeNs: string;
  dev: string;
  ino: string;
  kind: "directory" | "file";
  mode: number;
  mtimeNs: string;
  path: string;
  sha256?: string;
  size?: number;
}>;

type TreeSnapshot = Readonly<{
  entries: readonly TreeEntry[];
  present: boolean;
  sha256: string;
}>;

type EncryptedEntryKind = "database" | "library" | "media" | "oss" | "secret";

type EncryptedEntry = Readonly<{
  ciphertextBytes: number;
  ciphertextSha256: string;
  entryId: string;
  iv: string;
  kind: EncryptedEntryKind;
  logicalPath: string;
  objectFile: string;
  plaintextBytes: number;
  plaintextSha256: string;
  tag: string;
}>;

type LocalMediaBinding = Readonly<{
  byteSize: number;
  checksumSha256: string;
  id: string;
  kind: string;
  logicalPath: string;
  metadataChecksumPresent: boolean;
  storageName: string;
}>;

type OssMediaBinding = Readonly<{
  byteSize: number;
  checksumSha256: string;
  id: string;
  kind: string;
  logicalPath: string;
  objectKey: string;
  storageProfileId: string | null;
  versionId: string;
}>;

type MediaValidation = Readonly<{
  localReady: readonly LocalMediaBinding[];
  ossReady: readonly OssMediaBinding[];
}>;

type BackupManifest = Readonly<{
  backupId: string;
  captureMode: BackupPackageSummary["captureMode"];
  createdAt: string;
  database: Readonly<{
    entryId: string;
    inspection: BackupDatabaseInspection;
  }>;
  entries: readonly EncryptedEntry[];
  format: typeof backupPackageFormat;
  media: MediaValidation;
  secrets: Readonly<{
    fileCount: number;
    validation: BackupSecretValidation;
  }>;
  source: Readonly<{
    databaseAfter: TreeSnapshot;
    databaseBefore: TreeSnapshot;
    mediaAfter: TreeSnapshot;
    mediaBefore: TreeSnapshot;
    secretsAfter: TreeSnapshot;
    secretsBefore: TreeSnapshot;
  }>;
  version: typeof backupPackageFormatVersion;
}>;

type UnsignedEnvelope = Readonly<{
  backupId: string;
  encryption: "AES-256-GCM-HKDF-SHA256";
  format: typeof backupPackageFormat;
  keyWrap: "RSA-OAEP-SHA256";
  manifest: Readonly<{
    ciphertextBytes: number;
    ciphertextSha256: string;
    entryId: "manifest";
    iv: string;
    tag: string;
  }>;
  recipientKeySha256: string;
  signingKeySha256: string;
  version: typeof backupPackageFormatVersion;
  wrappedKey: string;
}>;

type SignedEnvelope = UnsignedEnvelope & Readonly<{ signature: string }>;

type MirrorEvidence = Readonly<{
  evidence: TreeEntry;
  filePath: string;
  objectKey: string;
  versionId: string;
}>;

type MediaRow = Readonly<{
  byte_size: bigint;
  checksum_sha256: string | null;
  id: string;
  kind: string;
  object_key: string | null;
  storage_backend: string;
  storage_name: string;
  storage_profile_id: string | null;
  storage_status: string;
}>;

function fail(code: string, message: string): never {
  throw new BackupPackageError(code, message);
}

async function checkpoint(
  callback: BackupCheckpoint | undefined,
  name: BackupCheckpointName,
) {
  await callback?.(name);
}

function normalizedAbsolute(path: string, label: string) {
  if (!path || !isAbsolute(path) || resolve(path) !== path) {
    fail("BACKUP_PATH_INVALID", `${label} must be an absolute normalized path`);
  }
  return path;
}

function containsPath(parent: string, child: string) {
  const difference = relative(parent, child);
  return difference === "" ||
    (!isAbsolute(difference) &&
      !difference.startsWith(`..${sep}`) && difference !== "..");
}

function assertDisjointPaths(left: string, right: string) {
  if (containsPath(left, right) || containsPath(right, left)) {
    fail("BACKUP_PATH_OVERLAP", "Backup paths must be disjoint");
  }
}

async function canonicalPotentialPath(path: string) {
  let current = path;
  const missing: string[] = [];
  for (;;) {
    try {
      return resolve(await realpath(current), ...missing);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
      const parent = dirname(current);
      if (parent === current) throw error;
      missing.unshift(basename(current));
      current = parent;
    }
  }
}

function safeLogicalPath(path: string) {
  if (
    !path ||
    path.length > 1_024 ||
    path.includes("\0") ||
    path.includes("\\") ||
    posix.isAbsolute(path) ||
    posix.normalize(path) !== path
  ) {
    fail("BACKUP_ENTRY_PATH_INVALID", "Backup entry path is invalid");
  }
  const parts = path.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    fail("BACKUP_ENTRY_PATH_INVALID", "Backup entry path is invalid");
  }
  return path;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("BACKUP_JSON_INVALID", "Non-finite JSON number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  fail("BACKUP_JSON_INVALID", "Unsupported JSON value");
}

function sha256(value: Buffer | string) {
  return createHash("sha256").update(value).digest("hex");
}

function exactUtcTimestamp(value: string, label: string) {
  const milliseconds = Date.parse(value);
  if (
    !Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString() !== value
  ) {
    fail("BACKUP_FREEZE_EVIDENCE_INVALID", `${label} must be an exact UTC timestamp`);
  }
  return milliseconds;
}

function capturePurposeFor(
  value: BackupCapturePurpose | undefined,
  contractPresent: boolean,
): BackupCapturePurpose {
  const purpose = value ?? "current-schema43";
  if (
    (purpose !== "current-schema43" && purpose !== "historical-recovery") ||
    (purpose === "historical-recovery" && !contractPresent)
  ) {
    fail(
      "BACKUP_CAPTURE_PURPOSE_INVALID",
      "Backup capture purpose is invalid",
    );
  }
  return purpose;
}

function validateFrozenSourceContract(
  contract: BackupFrozenSourceContract,
  capturedNow: number,
  capturePurpose: BackupCapturePurpose,
) {
  const schemaPurposeMatches = Boolean(contract && typeof contract === "object") &&
    (capturePurpose === "current-schema43"
      ? contract.expectedSchemaVersion === currentBackupSchemaVersion
      : supportedBackupSchemaVersions.has(contract.expectedSchemaVersion) &&
        contract.expectedSchemaVersion !== currentBackupSchemaVersion);
  if (
    !contract ||
    typeof contract !== "object" ||
    !schemaPurposeMatches ||
    !/^[a-f0-9]{64}$/.test(contract.expectedDatabaseLogicalSha256) ||
    !contract.freezeEvidence ||
    typeof contract.freezeEvidence !== "object" ||
    !/^[a-f0-9]{64}$/.test(
      contract.freezeEvidence.sourceDatabaseLogicalSha256,
    ) ||
    contract.freezeEvidence.sourceDatabaseLogicalSha256 !==
      contract.expectedDatabaseLogicalSha256
  ) {
    fail(
      "BACKUP_FROZEN_SOURCE_CONTRACT_INVALID",
      "Frozen source contract is incomplete or invalid",
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
      "BACKUP_FREEZE_EVIDENCE_INVALID",
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
      "BACKUP_FREEZE_QUIET_PERIOD_INCOMPLETE",
      "Generation must stay frozen for at least 60 seconds after the last possible Provider admission",
    );
  }
  return Object.freeze({ generationFrozenAt, lastProviderAdmissionAt });
}

function validateLockedSourceContract(
  database: DatabaseSync,
  inspection: BackupDatabaseInspection,
  contract: BackupFrozenSourceContract,
  capturedNow: number,
  capturePurpose: BackupCapturePurpose,
) {
  const times = validateFrozenSourceContract(
    contract,
    capturedNow,
    capturePurpose,
  );
  if (inspection.userVersion !== contract.expectedSchemaVersion) {
    fail(
      "BACKUP_SOURCE_SCHEMA_MISMATCH",
      "Locked backup source does not have the expected schema version",
    );
  }
  if (inspection.logicalSha256 !== contract.expectedDatabaseLogicalSha256) {
    fail(
      "BACKUP_SOURCE_LOGICAL_SHA_MISMATCH",
      "Locked backup source does not have the expected logical fingerprint",
    );
  }
  const currentQuietSnapshot = inspection.userVersion >= 39
    ? generationReadinessQuery.operationalQuietSnapshot(database)
    : undefined;
  const activeTasks = currentQuietSnapshot?.activeTasks ?? Number(
    (database.prepare(`
      SELECT COUNT(*) AS count
      FROM generation_tasks
      WHERE state IN ('queued', 'running', 'retrying', 'recovering')
    `).get() as { count?: number | bigint } | undefined)?.count ?? 0,
  );
  if (activeTasks !== 0) {
    fail(
      "BACKUP_ACTIVE_GENERATION_TASKS",
      "Locked backup source still contains active generation tasks",
    );
  }
  if (inspection.userVersion < 39) {
    // Schema 37/38 have no durable Provider outcome column. Reconstruct the
    // attempt associated with the task exactly as the one-shot bridge
    // migration does, and reject every Provider-boundary row that cannot be
    // proven settled from the terminal task state.
    const unsettledProviderBoundary = database.prepare(`
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
    `);
    unsettledProviderBoundary.setReadBigInts(true);
    const unsettledProviderBoundaryRow = unsettledProviderBoundary.get() as
      | { count?: bigint }
      | undefined;
    if (unsettledProviderBoundaryRow?.count !== 0n) {
      fail(
        "BACKUP_UNSETTLED_PROVIDER_ATTEMPTS",
        "Provider-boundary attempts are not definitively settled",
      );
    }
  } else {
    // Current schemas persist the outcome and local settlement timestamp.
    // A locked backup must block live billing ambiguity, while preserving
    // terminal historical evidence exactly. In particular, an old accepted or
    // response-received attempt attached to an already terminal task is data to
    // back up, not a reason to rewrite production before a backup can exist.
    if (
      currentQuietSnapshot!.currentUnknownBillingTasks !== 0 ||
      currentQuietSnapshot!.unsettledCurrentProviderBoundaries !== 0
    ) {
      fail(
        "BACKUP_UNSETTLED_PROVIDER_ATTEMPTS",
        "Locked backup source still contains current unknown Provider evidence",
      );
    }
  }
  const safety = database.prepare(`
    SELECT id, global_enabled, emergency_stop, updated_at
    FROM generation_safety_settings
    ORDER BY id
  `);
  safety.setReadBigInts(true);
  const safetyRows = safety.all() as Array<{
    emergency_stop?: bigint;
    global_enabled?: bigint;
    id?: bigint;
    updated_at?: unknown;
  }>;
  if (
    safetyRows.length !== 1 ||
    safetyRows[0]?.id !== 1n ||
    (safetyRows[0]?.global_enabled !== 0n &&
      safetyRows[0]?.emergency_stop !== 1n)
  ) {
    fail(
      "BACKUP_GENERATION_NOT_FROZEN",
      "Locked backup source does not prove that generation is globally frozen",
    );
  }
  const safetyUpdatedAt = safetyRows[0]?.updated_at;
  if (
    typeof safetyUpdatedAt !== "string" ||
    exactUtcTimestamp(safetyUpdatedAt, "Generation safety update time") !==
      times.generationFrozenAt
  ) {
    fail(
      "BACKUP_FREEZE_EVIDENCE_STALE",
      "Generation freeze evidence does not match the locked safety setting",
    );
  }
  const safetyAudit = database.prepare(`
    SELECT details
    FROM admin_audit_events
    WHERE action = 'generation_safety.update'
    ORDER BY id DESC
    LIMIT 1
  `).get() as { details?: unknown } | undefined;
  let auditedAfter: Record<string, unknown> | undefined;
  try {
    if (typeof safetyAudit?.details === "string") {
      const details = JSON.parse(safetyAudit.details) as unknown;
      if (details && typeof details === "object" && !Array.isArray(details)) {
        const after = (details as Record<string, unknown>).after;
        if (after && typeof after === "object" && !Array.isArray(after)) {
          auditedAfter = after as Record<string, unknown>;
        }
      }
    }
  } catch {
    // The deterministic failure below does not expose audit contents.
  }
  if (
    !auditedAfter ||
    auditedAfter.updatedAt !== safetyUpdatedAt ||
    auditedAfter.globalEnabled !== (safetyRows[0]?.global_enabled === 1n) ||
    auditedAfter.emergencyStop !== (safetyRows[0]?.emergency_stop === 1n)
  ) {
    fail(
      "BACKUP_FREEZE_AUDIT_MISSING",
      "Locked generation freeze has no matching administrator audit",
    );
  }
  if (inspection.userVersion >= 38) {
    const publications = database.prepare(`
      SELECT COUNT(*) AS count
      FROM media_publication_attempts
      WHERE state IN ('reserved', 'staged', 'external-ready', 'compensating')
    `);
    publications.setReadBigInts(true);
    const publicationRow = publications.get() as { count?: bigint } | undefined;
    if (publicationRow?.count !== 0n) {
      fail(
        "BACKUP_ACTIVE_MEDIA_PUBLICATIONS",
        "Locked backup source still contains active media publications",
      );
    }
  }
  const lastAttempt = database.prepare(`
    SELECT created_at
    FROM generation_provider_attempts
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `).get() as { created_at?: unknown } | undefined;
  if (lastAttempt) {
    if (typeof lastAttempt.created_at !== "string") {
      fail(
        "BACKUP_FREEZE_EVIDENCE_INVALID",
        "Provider attempt time is invalid",
      );
    }
    const lastRecordedAttemptAt = exactUtcTimestamp(
      lastAttempt.created_at,
      "Last Provider attempt time",
    );
    if (
      !Number.isFinite(lastRecordedAttemptAt) ||
      times.lastProviderAdmissionAt === undefined ||
      times.lastProviderAdmissionAt < lastRecordedAttemptAt
    ) {
      fail(
        "BACKUP_FREEZE_EVIDENCE_STALE",
        "Freeze evidence does not cover the last recorded Provider attempt",
      );
    }
  }
}

function sameLogicalDatabaseInspection(
  locked: BackupDatabaseInspection,
  snapshot: BackupDatabaseInspection,
) {
  return locked.userVersion === snapshot.userVersion &&
    locked.logicalSha256 === snapshot.logicalSha256 &&
    locked.integrityCheck === snapshot.integrityCheck &&
    locked.foreignKeyViolations === snapshot.foreignKeyViolations &&
    stableJson(locked.migrationLedger) === stableJson(snapshot.migrationLedger) &&
    stableJson(locked.schema) === stableJson(snapshot.schema) &&
    stableJson(locked.tables) === stableJson(snapshot.tables) &&
    new Set(["delete", "wal"]).has(locked.journalMode) &&
    snapshot.journalMode === "delete";
}

async function withOptionalFrozenSourceWriteLock<T>(
  sourceDirectory: string,
  inspectionRoot: string,
  contract: BackupFrozenSourceContract | undefined,
  capturePurpose: BackupCapturePurpose,
  callback: (inspection: BackupDatabaseInspection | undefined) => Promise<T>,
) {
  if (!contract) return callback(undefined);
  const databasePath = join(sourceDirectory, "unboundry.sqlite");
  await inspectRegularFile(databasePath, "unboundry.sqlite");
  let secretLease: FrozenSecretDocumentLease | undefined;
  let database: DatabaseSync | undefined;
  let transactionOpen = false;
  let primaryError: unknown;
  try {
    // All Provider and storage document writers take this lease before the app
    // database writer lock. Preserve that order to avoid ABBA deadlocks and to
    // cover every secret rename through the complete final-source capture.
    secretLease = await acquireFrozenSecretDocumentLease(sourceDirectory);
    database = new DatabaseSync(databasePath, { timeout: 1_000 });
    database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 1000");
    try {
      database.exec("BEGIN IMMEDIATE");
      transactionOpen = true;
    } catch {
      fail(
        "BACKUP_SOURCE_WRITE_LOCK_UNAVAILABLE",
        "Frozen source write lock could not be acquired",
      );
    }
    const capturedNow = Date.now();
    const inspection = inspectLockedBackupDatabase(database, inspectionRoot);
    validateLockedSourceContract(
      database,
      inspection,
      contract,
      capturedNow,
      capturePurpose,
    );
    return await callback(inspection);
  } catch (error) {
    primaryError = error;
    if (error instanceof BackupPackageError || error instanceof BackupInspectionError) {
      throw error;
    }
    fail(
      "BACKUP_SOURCE_WRITE_LOCK_FAILED",
      "Frozen source write lock validation failed",
    );
  } finally {
    let releaseFailed = false;
    if (transactionOpen && database?.isTransaction) {
      try {
        database.exec("ROLLBACK");
      } catch {
        releaseFailed = true;
      }
    }
    try {
      database?.close();
    } catch {
      releaseFailed = true;
    }
    if (secretLease) {
      try {
        await releaseFrozenSecretDocumentLease(secretLease);
      } catch {
        releaseFailed = true;
      }
    }
    if (primaryError === undefined && releaseFailed) {
      fail(
        "BACKUP_SOURCE_LOCK_RELEASE_FAILED",
        "Final source locks could not be safely released; this process must exit",
      );
    }
  }
  fail("BACKUP_SOURCE_WRITE_LOCK_FAILED", "Frozen source write lock validation failed");
}

function requireMediaIntegrityPolicy(
  report: MediaIntegrityReport,
  warningAllowlist: readonly MediaIntegrityIssueCode[] | undefined,
) {
  requireCompleteMediaIntegrity(report);
  if (warningAllowlist === undefined) return report;
  const allowed = new Set<MediaIntegrityIssueCode>();
  for (const code of warningAllowlist) {
    if (typeof code !== "string" || allowed.has(code)) {
      fail(
        "BACKUP_MEDIA_WARNING_POLICY_INVALID",
        "Media warning allowlist is invalid or duplicated",
      );
    }
    allowed.add(code);
  }
  if (report.issues.some((issue) =>
    issue.severity !== "warning" || !allowed.has(issue.code))) {
    fail(
      "BACKUP_MEDIA_WARNING_NOT_ALLOWED",
      "Media integrity contains an error or a warning not explicitly allowed",
    );
  }
  return report;
}

type FrozenSecretDocumentLease = Readonly<{
  database: DatabaseSync;
  dev: bigint;
  ino: bigint;
  path: string;
}>;

function strictPrivateSourceIdentity(
  details: BigIntStats,
  kind: "directory" | "file",
) {
  const uid = typeof process.getuid === "function"
    ? BigInt(process.getuid())
    : undefined;
  return uid !== undefined && details.uid === uid &&
    !details.isSymbolicLink() &&
    (kind === "directory" ? details.isDirectory() : details.isFile()) &&
    (details.mode & 0o777n) === (kind === "directory" ? 0o700n : 0o600n) &&
    (kind === "directory" || details.nlink === 1n);
}

async function assertSecretLockHasNoSidecars(lockPath: string) {
  for (const suffix of ["-journal", "-shm", "-wal"]) {
    try {
      await lstat(`${lockPath}${suffix}`);
      fail(
        "BACKUP_SECRET_DOCUMENT_LOCK_INVALID",
        "Secret document lock has an unexpected SQLite sidecar",
      );
    } catch (error) {
      if (
        error instanceof BackupPackageError ||
        !(error instanceof Error && "code" in error && error.code === "ENOENT")
      ) throw error;
    }
  }
}

async function acquireFrozenSecretDocumentLease(
  sourceDirectory: string,
): Promise<FrozenSecretDocumentLease> {
  const secretsDirectory = join(sourceDirectory, "secrets");
  const lockPath = join(secretsDirectory, "provider-profile-write-lock.sqlite");
  let directoryDetails: BigIntStats;
  let lockDetails: BigIntStats;
  try {
    [directoryDetails, lockDetails] = await Promise.all([
      lstat(secretsDirectory, { bigint: true }),
      lstat(lockPath, { bigint: true }),
    ]);
  } catch {
    fail(
      "BACKUP_SECRET_DOCUMENT_LOCK_MISSING",
      "Final-candidate backup requires an existing secret document lock",
    );
  }
  if (
    !strictPrivateSourceIdentity(directoryDetails, "directory") ||
    !strictPrivateSourceIdentity(lockDetails, "file") ||
    lockDetails.size <= 0n ||
    lockDetails.size > BigInt(secretDocumentLockMaximumBytes)
  ) {
    fail(
      "BACKUP_SECRET_DOCUMENT_LOCK_INVALID",
      "Secret document lock is not a private trusted SQLite file",
    );
  }

  let database: DatabaseSync | undefined;
  let transactionOpen = false;
  try {
    database = new DatabaseSync(lockPath, { timeout: 1_000 });
    database.exec("PRAGMA busy_timeout = 1000");
    try {
      database.exec("BEGIN IMMEDIATE");
      transactionOpen = true;
    } catch {
      fail(
        "BACKUP_SECRET_DOCUMENT_LOCK_UNAVAILABLE",
        "Secret document write lease could not be acquired",
      );
    }
    const current = await lstat(lockPath, { bigint: true });
    if (
      !strictPrivateSourceIdentity(current, "file") ||
      current.dev !== lockDetails.dev ||
      current.ino !== lockDetails.ino ||
      current.size > BigInt(secretDocumentLockMaximumBytes)
    ) {
      fail(
        "BACKUP_SECRET_DOCUMENT_LOCK_CHANGED",
        "Secret document lock changed while it was acquired",
      );
    }
    const integrity = database.prepare("PRAGMA integrity_check").get() as
      | { integrity_check?: unknown }
      | undefined;
    const journal = database.prepare("PRAGMA journal_mode").get() as
      | { journal_mode?: unknown }
      | undefined;
    const schema = database.prepare(`
      SELECT type, name
      FROM sqlite_schema
      WHERE name NOT LIKE 'sqlite_%'
      ORDER BY type, name
    `).all() as Array<{ name?: unknown; type?: unknown }>;
    const columns = database.prepare(`
      PRAGMA table_info(provider_profile_write_lock)
    `).all() as Array<{
      name?: unknown;
      notnull?: unknown;
      pk?: unknown;
      type?: unknown;
    }>;
    const rows = database.prepare(`
      SELECT id, marker
      FROM provider_profile_write_lock
      ORDER BY id
    `);
    rows.setReadBigInts(true);
    const values = rows.all() as Array<{ id?: bigint; marker?: bigint }>;
    if (
      integrity?.integrity_check !== "ok" ||
      journal?.journal_mode !== "delete" ||
      schema.length !== 1 ||
      schema[0]?.type !== "table" ||
      schema[0]?.name !== "provider_profile_write_lock" ||
      columns.length !== 2 ||
      columns[0]?.name !== "id" ||
      String(columns[0]?.type).toUpperCase() !== "INTEGER" ||
      Number(columns[0]?.pk) !== 1 ||
      columns[1]?.name !== "marker" ||
      String(columns[1]?.type).toUpperCase() !== "INTEGER" ||
      Number(columns[1]?.notnull) !== 1 ||
      values.length !== 1 ||
      values[0]?.id !== 1n ||
      typeof values[0]?.marker !== "bigint" ||
      values[0].marker < 0n
    ) {
      fail(
        "BACKUP_SECRET_DOCUMENT_LOCK_INVALID",
        "Secret document lock schema or state is invalid",
      );
    }
    await assertSecretLockHasNoSidecars(lockPath);
    return Object.freeze({
      database,
      dev: current.dev,
      ino: current.ino,
      path: lockPath,
    });
  } catch (error) {
    if (transactionOpen && database?.isTransaction) {
      try {
        database.exec("ROLLBACK");
      } catch {
        // Closing below releases a failed acquisition.
      }
    }
    try {
      database?.close();
    } catch {
      // Preserve the deterministic primary failure.
    }
    if (error instanceof BackupPackageError) throw error;
    fail(
      "BACKUP_SECRET_DOCUMENT_LOCK_INVALID",
      "Secret document lock could not be validated",
    );
  }
}

async function releaseFrozenSecretDocumentLease(
  lease: FrozenSecretDocumentLease,
) {
  let changed = false;
  try {
    const current = await lstat(lease.path, { bigint: true });
    changed = !strictPrivateSourceIdentity(current, "file") ||
      current.dev !== lease.dev || current.ino !== lease.ino;
  } catch {
    changed = true;
  }
  try {
    if (lease.database.isTransaction) lease.database.exec("ROLLBACK");
  } finally {
    lease.database.close();
  }
  if (changed) {
    fail(
      "BACKUP_SECRET_DOCUMENT_LOCK_CHANGED",
      "Secret document lock changed while final source data was captured",
    );
  }
}

function canonicalBase64(value: unknown, label: string) {
  if (
    typeof value !== "string" ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) fail("BACKUP_ENCODING_INVALID", `${label} is invalid`);
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) {
    decoded.fill(0);
    fail("BACKUP_ENCODING_INVALID", `${label} is invalid`);
  }
  return decoded;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail("BACKUP_FORMAT_INVALID", "Backup object fields are invalid");
  }
}

function keyFingerprint(key: KeyObject) {
  const publicKey = key.type === "public" ? key : createPublicKey(key);
  const der = publicKey.export({ format: "der", type: "spki" });
  return sha256(Buffer.isBuffer(der) ? der : Buffer.from(der));
}

function isKeyObject(input: BackupKeyInput): input is KeyObject {
  return typeof input === "object" && input !== null &&
    typeof (input as KeyObject).export === "function" &&
    ["private", "public", "secret"].includes((input as KeyObject).type);
}

function recoveryPublicKey(input: BackupKeyInput) {
  let key: KeyObject;
  try {
    key = isKeyObject(input)
      ? (input.type === "public" ? input : createPublicKey(input))
      : createPublicKey(input);
  } catch {
    fail("BACKUP_RECOVERY_KEY_INVALID", "Recovery public key is invalid");
  }
  if (
    key.asymmetricKeyType !== "rsa" ||
    Number(key.asymmetricKeyDetails?.modulusLength ?? 0) < 3_072
  ) fail("BACKUP_RECOVERY_KEY_WEAK", "Recovery RSA key must be at least 3072 bits");
  return key;
}

function privateKey(input: BackupKeyInput, purpose: "recovery" | "signing") {
  let key: KeyObject;
  try {
    if (isKeyObject(input)) {
      if (input.type !== "private") {
        fail("BACKUP_PRIVATE_KEY_INVALID", `${purpose} private key is invalid`);
      }
      key = input;
    } else {
      key = createPrivateKey(input);
    }
  } catch {
    fail("BACKUP_PRIVATE_KEY_INVALID", `${purpose} private key is invalid`);
  }
  if (key.type !== "private") {
    fail("BACKUP_PRIVATE_KEY_INVALID", `${purpose} private key is invalid`);
  }
  return key;
}

function signingPrivateKey(input: BackupKeyInput) {
  const key = privateKey(input, "signing");
  if (key.asymmetricKeyType !== "ed25519") {
    fail("BACKUP_SIGNING_KEY_INVALID", "Signing key must be Ed25519");
  }
  return key;
}

function signingPublicKey(input: BackupKeyInput) {
  let key: KeyObject;
  try {
    key = isKeyObject(input) && input.type === "public"
      ? input
      : createPublicKey(input);
  } catch {
    fail("BACKUP_SIGNING_KEY_INVALID", "Trusted signing key is invalid");
  }
  if (key.type !== "public" || key.asymmetricKeyType !== "ed25519") {
    fail("BACKUP_SIGNING_KEY_INVALID", "Trusted signing key must be Ed25519");
  }
  return key;
}

function recoveryPrivateKey(input: BackupKeyInput) {
  const key = privateKey(input, "recovery");
  if (
    key.asymmetricKeyType !== "rsa" ||
    Number(key.asymmetricKeyDetails?.modulusLength ?? 0) < 3_072
  ) fail("BACKUP_RECOVERY_KEY_WEAK", "Recovery RSA key must be at least 3072 bits");
  return key;
}

function entryKey(dek: Buffer, backupId: string, entryId: string) {
  return Buffer.from(hkdfSync(
    "sha256",
    dek,
    Buffer.from(backupId, "utf8"),
    Buffer.from(`unboundry-backup-v2:${entryId}`, "utf8"),
    32,
  ));
}

function entryAad(
  backupId: string,
  entryId: string,
  kind: EncryptedEntryKind | "manifest",
  logicalPath: string,
) {
  return Buffer.from(stableJson({
    backupId,
    entryId,
    format: backupPackageFormat,
    kind,
    logicalPath,
    version: backupPackageFormatVersion,
  }), "utf8");
}

function statsIdentity(details: Awaited<ReturnType<typeof lstat>> & { mtimeNs?: bigint; ctimeNs?: bigint }) {
  const bigint = details as unknown as {
    ctimeNs?: bigint;
    dev: bigint | number;
    ino: bigint | number;
    mode: bigint | number;
    mtimeNs?: bigint;
  };
  return {
    ctimeNs: bigint.ctimeNs?.toString() ?? String(details.ctimeMs),
    dev: String(bigint.dev),
    ino: String(bigint.ino),
    mode: Number(bigint.mode) & 0o7777,
    mtimeNs: bigint.mtimeNs?.toString() ?? String(details.mtimeMs),
  };
}

function assertTrustedBackupEntry(
  details: BigIntStats,
  kind: "directory" | "file",
) {
  const currentUid = typeof process.getuid === "function"
    ? BigInt(process.getuid())
    : undefined;
  const trustedOwner = currentUid !== undefined &&
    (details.uid === 0n || details.uid === currentUid);
  const writableByAnotherIdentity = (details.mode & 0o022n) !== 0n;
  const unexpectedHardLink = kind === "file" && details.nlink !== 1n;
  if (!trustedOwner || writableByAnotherIdentity || unexpectedHardLink) {
    fail(
      "BACKUP_SOURCE_PERMISSIONS_INVALID",
      "Backup input permissions are unsafe",
    );
  }
}

async function inspectRegularFile(
  path: string,
  logicalPath: string,
  maximumBytes = Number.MAX_SAFE_INTEGER,
): Promise<TreeEntry> {
  safeLogicalPath(logicalPath);
  const before = await lstat(path, { bigint: true });
  if (before.isSymbolicLink() || !before.isFile()) {
    fail("BACKUP_SPECIAL_FILE_REJECTED", "Backup source contains a non-regular file");
  }
  assertTrustedBackupEntry(before, "file");
  if (before.size > BigInt(maximumBytes)) {
    fail("BACKUP_FILE_TOO_LARGE", "Backup source file is too large");
  }
  const noFollow = "O_NOFOLLOW" in fileConstants ? fileConstants.O_NOFOLLOW : 0;
  const handle = await open(path, fileConstants.O_RDONLY | noFollow);
  let buffer: Buffer | undefined;
  try {
    const opened = await handle.stat({ bigint: true });
    if (
      !opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino ||
      opened.size !== before.size || opened.mtimeNs !== before.mtimeNs ||
      opened.ctimeNs !== before.ctimeNs
    ) fail("BACKUP_SOURCE_CHANGED", "Backup source changed while opening");
    assertTrustedBackupEntry(opened, "file");
    const hash = createHash("sha256");
    buffer = Buffer.allocUnsafe(ioChunkBytes);
    let position = 0;
    while (position < Number(opened.size)) {
      const { bytesRead } = await handle.read(
        buffer,
        0,
        Math.min(buffer.length, Number(opened.size) - position),
        position,
      );
      if (!bytesRead) fail("BACKUP_SOURCE_CHANGED", "Backup source ended unexpectedly");
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    if (
      after.size !== opened.size || after.mtimeNs !== opened.mtimeNs ||
      after.ctimeNs !== opened.ctimeNs || after.dev !== opened.dev || after.ino !== opened.ino
    ) fail("BACKUP_SOURCE_CHANGED", "Backup source changed while reading");
    assertTrustedBackupEntry(after, "file");
    return Object.freeze({
      ...statsIdentity(before as never),
      kind: "file" as const,
      path: logicalPath,
      sha256: hash.digest("hex"),
      size: Number(before.size),
    });
  } finally {
    buffer?.fill(0);
    await handle.close();
  }
}

async function fingerprintTree(directory: string, required: boolean): Promise<TreeSnapshot> {
  let root;
  try {
    root = await lstat(directory, { bigint: true });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT" && !required) {
      return Object.freeze({ entries: Object.freeze([]), present: false, sha256: sha256("absent") });
    }
    throw error;
  }
  if (root.isSymbolicLink() || !root.isDirectory()) {
    fail("BACKUP_DIRECTORY_INVALID", "Backup source directory is invalid");
  }
  assertTrustedBackupEntry(root, "directory");
  const entries: TreeEntry[] = [];
  async function visit(current: string, parts: string[]): Promise<void> {
    const children = await readdir(current, { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      const path = join(current, child.name);
      const logicalPath = safeLogicalPath([...parts, child.name].join("/"));
      const details = await lstat(path, { bigint: true });
      if (details.isSymbolicLink()) {
        fail("BACKUP_LINK_REJECTED", "Backup source may not contain symbolic links");
      }
      if (details.isDirectory()) {
        assertTrustedBackupEntry(details, "directory");
        entries.push(Object.freeze({
          ...statsIdentity(details as never),
          kind: "directory" as const,
          path: logicalPath,
        }));
        await visit(path, [...parts, child.name]);
      } else if (details.isFile()) {
        entries.push(await inspectRegularFile(path, logicalPath));
      } else {
        fail("BACKUP_SPECIAL_FILE_REJECTED", "Backup source contains a special file");
      }
    }
  }
  await visit(directory, []);
  entries.sort((left, right) => left.path.localeCompare(right.path));
  return Object.freeze({
    entries: Object.freeze(entries),
    present: true,
    sha256: sha256(stableJson(entries)),
  });
}

function sameSnapshot(left: TreeSnapshot, right: TreeSnapshot) {
  return stableJson(left) === stableJson(right);
}

function restorableSecretsSnapshot(snapshot: TreeSnapshot): TreeSnapshot {
  if (!snapshot.present) return snapshot;
  const entries: TreeEntry[] = [];
  for (const entry of snapshot.entries) {
    if (entry.kind !== "file") {
      fail("BACKUP_SECRET_FILE_UNKNOWN", "Secrets directory contains an unexpected directory");
    }
    if (restorableSecretFiles.has(entry.path)) {
      entries.push(entry);
    } else if (!transientSecretFiles.has(entry.path)) {
      fail("BACKUP_SECRET_FILE_UNKNOWN", "Secrets directory contains an unexpected file");
    }
  }
  entries.sort((left, right) => left.path.localeCompare(right.path));
  return Object.freeze({
    entries: Object.freeze(entries),
    present: true,
    sha256: sha256(stableJson(entries)),
  });
}

async function databaseFilesSnapshot(sourceDirectory: string): Promise<TreeSnapshot> {
  const known = new Set([
    "unboundry.sqlite",
    "unboundry.sqlite-journal",
    "unboundry.sqlite-shm",
    "unboundry.sqlite-wal",
  ]);
  const root = await lstat(sourceDirectory, { bigint: true });
  if (root.isSymbolicLink() || !root.isDirectory()) {
    fail("BACKUP_SOURCE_INVALID", "Backup source must be a regular directory");
  }
  assertTrustedBackupEntry(root, "directory");
  const names = await readdir(sourceDirectory);
  for (const name of names) {
    if (name.startsWith("unboundry.sqlite") && !known.has(name)) {
      fail("BACKUP_DATABASE_SIDECAR_UNKNOWN", "Unknown SQLite sidecar exists");
    }
  }
  const entries: TreeEntry[] = [];
  for (const name of [...known].sort()) {
    try {
      entries.push(await inspectRegularFile(join(sourceDirectory, name), name));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") continue;
      throw error;
    }
  }
  if (!entries.some((entry) => entry.path === "unboundry.sqlite")) {
    fail("BACKUP_DATABASE_MISSING", "Source database is missing");
  }
  if (
    entries.some((entry) => entry.path.endsWith("-wal")) &&
    entries.some((entry) => entry.path.endsWith("-journal"))
  ) fail("BACKUP_DATABASE_STATE_INVALID", "WAL and rollback journal cannot coexist");
  return Object.freeze({
    entries: Object.freeze(entries),
    present: true,
    sha256: sha256(stableJson(entries)),
  });
}

async function libraryDatabaseSnapshot(
  sourceDirectory: string,
): Promise<TreeSnapshot> {
  const known = new Set([
    "library.sqlite",
    "library.sqlite-journal",
    "library.sqlite-shm",
    "library.sqlite-wal",
  ]);
  const names = await readdir(sourceDirectory);
  for (const name of names) {
    if (name.startsWith("library.sqlite") && !known.has(name)) {
      fail("BACKUP_LIBRARY_SIDECAR_UNKNOWN", "Unknown Library SQLite sidecar exists");
    }
  }
  const entries: TreeEntry[] = [];
  for (const name of [...known].sort()) {
    try {
      entries.push(await inspectRegularFile(join(sourceDirectory, name), name));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        continue;
      }
      throw error;
    }
  }
  if (entries.length === 0) {
    return Object.freeze({
      entries: Object.freeze([]),
      present: false,
      sha256: sha256("absent"),
    });
  }
  if (!entries.some((entry) => entry.path === "library.sqlite") ||
      entries.some((entry) => entry.path !== "library.sqlite")) {
    fail(
      "BACKUP_LIBRARY_STATE_INVALID",
      "Library database must be checkpointed before backup",
    );
  }
  return Object.freeze({
    entries: Object.freeze(entries),
    present: true,
    sha256: sha256(stableJson(entries)),
  });
}

async function ensureDirectory(path: string, create = false) {
  if (create) await mkdir(path, { mode: 0o700, recursive: true });
  const details = await lstat(path);
  if (details.isSymbolicLink() || !details.isDirectory()) {
    fail("BACKUP_DIRECTORY_INVALID", "Backup directory is invalid");
  }
}

function trustedDirectoryMetadata(details: BigIntStats) {
  const currentUid = typeof process.getuid === "function"
    ? BigInt(process.getuid())
    : undefined;
  const mode = details.mode & 0o7777n;
  const trustedOwner = currentUid !== undefined &&
    (details.uid === 0n || details.uid === currentUid);
  const nonWritableByOthers = (mode & 0o022n) === 0n;
  const stickySharedRoot = currentUid !== undefined &&
    (mode & 0o1000n) !== 0n &&
    (details.uid === 0n || details.uid === currentUid);
  return trustedOwner && (nonWritableByOthers || stickySharedRoot);
}

async function validatePhysicalDirectoryChain(
  path: string,
  allowTrustedLinks: boolean,
) {
  const currentUid = typeof process.getuid === "function"
    ? BigInt(process.getuid())
    : undefined;
  let current = path;
  for (;;) {
    const details = await lstat(current, { bigint: true });
    const trustedLink = allowTrustedLinks && currentUid !== undefined &&
      details.isSymbolicLink() &&
      (details.uid === 0n || details.uid === currentUid);
    const trustedDirectory = details.isDirectory() &&
      trustedDirectoryMetadata(details);
    if (!trustedLink && !trustedDirectory) {
      fail(
        "BACKUP_DIRECTORY_PERMISSIONS_INVALID",
        "Backup work root ancestry is unsafe",
      );
    }
    const parent = dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

async function validateTrustedDirectoryChain(path: string) {
  await validatePhysicalDirectoryChain(path, true);
  await validatePhysicalDirectoryChain(await realpath(path), false);
}

async function ensureTrustedWorkRoot(path: string, create = false) {
  let existing = path;
  for (;;) {
    try {
      await lstat(existing);
      break;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
      const parent = dirname(existing);
      if (parent === existing) throw error;
      existing = parent;
    }
  }
  await validateTrustedDirectoryChain(existing);
  if (create) await mkdir(path, { mode: 0o700, recursive: true });
  try {
    await validateTrustedDirectoryChain(path);
  } catch (error) {
    if (error instanceof BackupPackageError) throw error;
    fail(
      "BACKUP_DIRECTORY_INVALID",
      "Backup work root is invalid",
    );
  }
}

async function ensureTrustedDataRoot(path: string) {
  await ensureTrustedWorkRoot(path);
  const details = await lstat(path, { bigint: true });
  const currentUid = typeof process.getuid === "function"
    ? BigInt(process.getuid())
    : undefined;
  if (
    currentUid === undefined || details.isSymbolicLink() || !details.isDirectory() ||
    (details.uid !== 0n && details.uid !== currentUid) ||
    (details.mode & 0o022n) !== 0n
  ) {
    fail(
      "BACKUP_DIRECTORY_PERMISSIONS_INVALID",
      "Backup data root permissions are unsafe",
    );
  }
}

type OwnedPathIdentity = Readonly<{ dev: bigint; ino: bigint }>;

async function directoryIdentity(
  path: string,
  code = "BACKUP_RESTORE_TARGET_CHANGED",
): Promise<OwnedPathIdentity> {
  let details: BigIntStats;
  try {
    details = await lstat(path, { bigint: true });
  } catch {
    fail(code, "Published directory identity changed");
  }
  if (details.isSymbolicLink() || !details.isDirectory()) {
    fail(code, "Published directory identity changed");
  }
  return Object.freeze({ dev: details.dev, ino: details.ino });
}

async function optionalDirectoryIdentity(
  path: string,
  code: string,
): Promise<OwnedPathIdentity | undefined> {
  let details: BigIntStats;
  try {
    details = await lstat(path, { bigint: true });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    fail(code, "Published directory identity changed");
  }
  if (details.isSymbolicLink() || !details.isDirectory()) {
    fail(code, "Published directory identity changed");
  }
  return Object.freeze({ dev: details.dev, ino: details.ino });
}

async function regularFileIdentity(
  path: string,
  code = "BACKUP_RESTORE_TARGET_CHANGED",
): Promise<OwnedPathIdentity> {
  let details: BigIntStats;
  try {
    details = await lstat(path, { bigint: true });
  } catch {
    fail(code, "Publish marker identity changed");
  }
  if (details.isSymbolicLink() || !details.isFile()) {
    fail(code, "Publish marker identity changed");
  }
  return Object.freeze({ dev: details.dev, ino: details.ino });
}

function sameIdentity(left: OwnedPathIdentity, right: OwnedPathIdentity) {
  return left.dev === right.dev && left.ino === right.ino;
}

async function assertPublishReservation(
  targetDirectory: string,
  markerName: string,
  targetIdentity: OwnedPathIdentity,
  markerIdentity: OwnedPathIdentity,
  code: string,
) {
  const [currentTarget, currentMarker] = await Promise.all([
    directoryIdentity(targetDirectory, code),
    regularFileIdentity(join(targetDirectory, markerName), code),
  ]);
  if (
    !sameIdentity(currentTarget, targetIdentity) ||
    !sameIdentity(currentMarker, markerIdentity)
  ) {
    fail(code, "Publish reservation was replaced");
  }
}

async function syncDirectory(path: string) {
  const handle = await open(path, fileConstants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncDirectoryTree(root: string): Promise<void> {
  const details = await lstat(root);
  if (details.isSymbolicLink() || !details.isDirectory()) {
    fail("BACKUP_DIRECTORY_INVALID", "Restore staging directory is invalid");
  }
  const children = await readdir(root, { withFileTypes: true });
  children.sort((left, right) => left.name.localeCompare(right.name));
  for (const child of children) {
    const path = join(root, child.name);
    const childDetails = await lstat(path);
    if (childDetails.isSymbolicLink()) {
      fail("BACKUP_LINK_REJECTED", "Restore staging tree contains a symbolic link");
    }
    if (childDetails.isDirectory()) {
      await syncDirectoryTree(path);
    } else if (!childDetails.isFile()) {
      fail("BACKUP_SPECIAL_FILE_REJECTED", "Restore staging tree contains a special file");
    }
  }
  await syncDirectory(root);
}

async function writePrivateFile(path: string, value: Buffer | string) {
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(value);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function reservationMarker(
  kind: ReservationMarkerKind,
  backupId: string,
  databaseLogicalSha256: string,
  targetDirectory: string,
  stagingDirectory: string,
  stagingIdentity: OwnedPathIdentity,
): ReservationMarker {
  return Object.freeze({
    backupId,
    databaseLogicalSha256,
    format: "unboundry-incomplete-reservation" as const,
    kind,
    stagingDev: stagingIdentity.dev.toString(),
    stagingIno: stagingIdentity.ino.toString(),
    stagingName: basename(stagingDirectory),
    targetName: basename(targetDirectory),
    version: 1 as const,
  });
}

async function writeReservationMarker(
  markerPath: string,
  marker: ReservationMarker,
) {
  await writePrivateFile(markerPath, `${stableJson(marker)}\n`);
}

async function readReservationMarker(
  targetDirectory: string,
  kind: ReservationMarkerKind,
) {
  const markerName = kind === "backup"
    ? backupIncompleteMarker
    : restoreIncompleteMarker;
  const { value } = await readBoundedRegularFile(
    join(targetDirectory, markerName),
    markerName,
    reservationMarkerMaximumBytes,
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(value));
  } catch {
    fail(
      "BACKUP_RESERVATION_MARKER_INVALID",
      "Incomplete reservation marker is invalid",
    );
  } finally {
    value.fill(0);
  }
  const marker = jsonObject(parsed, "BACKUP_RESERVATION_MARKER_INVALID");
  exactKeys(marker, [
    "backupId",
    "databaseLogicalSha256",
    "format",
    "kind",
    "stagingDev",
    "stagingIno",
    "stagingName",
    "targetName",
    "version",
  ]);
  if (
    marker.format !== "unboundry-incomplete-reservation" ||
    marker.version !== 1 ||
    marker.kind !== kind ||
    !validUuid(marker.backupId) ||
    !validSha(marker.databaseLogicalSha256) ||
    typeof marker.stagingDev !== "string" ||
    !/^[1-9][0-9]*$/.test(marker.stagingDev) ||
    typeof marker.stagingIno !== "string" ||
    !/^[1-9][0-9]*$/.test(marker.stagingIno) ||
    typeof marker.stagingName !== "string" ||
    basename(marker.stagingName) !== marker.stagingName ||
    !marker.stagingName.startsWith(
      kind === "backup" ? `.partial-${marker.backupId}-` : `.${marker.targetName}.restore-`,
    ) ||
    marker.targetName !== basename(targetDirectory)
  ) {
    fail(
      "BACKUP_RESERVATION_MARKER_INVALID",
      "Incomplete reservation marker provenance does not match its target",
    );
  }
  return Object.freeze({
    backupId: marker.backupId,
    databaseLogicalSha256: marker.databaseLogicalSha256,
    format: marker.format,
    kind: marker.kind,
    stagingDev: marker.stagingDev,
    stagingIno: marker.stagingIno,
    stagingName: marker.stagingName,
    targetName: marker.targetName,
    version: marker.version,
  }) as ReservationMarker;
}

/**
 * Atomically moves a trusted incomplete reservation aside so the exact target
 * can be retried. The whole directory is preserved verbatim: unexpected files
 * are quarantined with it and are never recursively deleted by this operation.
 */
export async function quarantineIncompleteReservation(
  options: QuarantineIncompleteReservationOptions,
): Promise<QuarantinedReservation> {
  const targetDirectory = normalizedAbsolute(
    options.targetDirectory,
    "Incomplete reservation target",
  );
  if (
    !validUuid(options.expectedBackupId) ||
    !validSha(options.expectedDatabaseLogicalSha256) ||
    (options.kind !== "backup" && options.kind !== "restore")
  ) {
    fail(
      "BACKUP_QUARANTINE_ARGUMENT_INVALID",
      "Incomplete reservation identity is invalid",
    );
  }
  await ensureTrustedDataRoot(targetDirectory);
  const parent = dirname(targetDirectory);
  await ensureTrustedWorkRoot(parent);
  const markerName = options.kind === "backup"
    ? backupIncompleteMarker
    : restoreIncompleteMarker;
  const [targetIdentity, markerIdentity, marker] = await Promise.all([
    directoryIdentity(targetDirectory, "BACKUP_QUARANTINE_TARGET_CHANGED"),
    regularFileIdentity(
      join(targetDirectory, markerName),
      "BACKUP_QUARANTINE_TARGET_CHANGED",
    ),
    readReservationMarker(targetDirectory, options.kind),
  ]);
  if (
    marker.backupId !== options.expectedBackupId ||
    marker.databaseLogicalSha256 !== options.expectedDatabaseLogicalSha256
  ) {
    fail(
      "BACKUP_QUARANTINE_PROVENANCE_MISMATCH",
      "Incomplete reservation does not match the expected backup",
    );
  }
  await assertPublishReservation(
    targetDirectory,
    markerName,
    targetIdentity,
    markerIdentity,
    "BACKUP_QUARANTINE_TARGET_CHANGED",
  );
  const stagingDirectory = join(parent, marker.stagingName);
  const stagingIdentity = await optionalDirectoryIdentity(
    stagingDirectory,
    "BACKUP_QUARANTINE_STAGING_CHANGED",
  );
  if (
    stagingIdentity &&
    (stagingIdentity.dev.toString() !== marker.stagingDev ||
      stagingIdentity.ino.toString() !== marker.stagingIno)
  ) {
    fail(
      "BACKUP_QUARANTINE_STAGING_CHANGED",
      "Incomplete reservation staging directory changed",
    );
  }
  const quarantineDirectory = join(
    parent,
    `.${basename(targetDirectory)}.quarantine-${randomUUID()}`,
  );
  try {
    await lstat(quarantineDirectory);
    fail(
      "BACKUP_QUARANTINE_TARGET_EXISTS",
      "Incomplete reservation quarantine target already exists",
    );
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }
  await rename(targetDirectory, quarantineDirectory);
  const [quarantinedTarget, quarantinedMarker] = await Promise.all([
    directoryIdentity(
      quarantineDirectory,
      "BACKUP_QUARANTINE_TARGET_CHANGED",
    ),
    regularFileIdentity(
      join(quarantineDirectory, markerName),
      "BACKUP_QUARANTINE_TARGET_CHANGED",
    ),
  ]);
  if (
    !sameIdentity(targetIdentity, quarantinedTarget) ||
    !sameIdentity(markerIdentity, quarantinedMarker)
  ) {
    fail(
      "BACKUP_QUARANTINE_TARGET_CHANGED",
      "Incomplete reservation changed during quarantine",
    );
  }
  if (stagingIdentity) {
    const quarantinedStage = join(
      quarantineDirectory,
      ".unboundry-staging-residue",
    );
    try {
      await lstat(quarantinedStage);
      fail(
        "BACKUP_QUARANTINE_STAGING_CHANGED",
        "Quarantine already contains a staging residue",
      );
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
    }
    await rename(stagingDirectory, quarantinedStage);
    const movedStage = await directoryIdentity(
      quarantinedStage,
      "BACKUP_QUARANTINE_STAGING_CHANGED",
    );
    if (!sameIdentity(stagingIdentity, movedStage)) {
      fail(
        "BACKUP_QUARANTINE_STAGING_CHANGED",
        "Incomplete reservation staging changed during quarantine",
      );
    }
    await syncDirectory(quarantineDirectory);
  }
  await syncDirectory(parent);
  return Object.freeze({
    backupId: marker.backupId,
    quarantineDirectory,
  });
}

async function writeAll(
  handle: Awaited<ReturnType<typeof open>>,
  value: Buffer,
  position: number,
) {
  let offset = 0;
  while (offset < value.length) {
    const { bytesWritten } = await handle.write(
      value,
      offset,
      value.length - offset,
      position + offset,
    );
    if (bytesWritten <= 0) {
      fail("BACKUP_FILE_WRITE_FAILED", "Backup file write made no progress");
    }
    offset += bytesWritten;
  }
  return position + value.length;
}

async function copyExpectedFile(source: string, target: string, expected: TreeEntry) {
  await mkdir(dirname(target), { mode: 0o700, recursive: true });
  const before = await inspectRegularFile(source, expected.path);
  if (stableJson(before) !== stableJson(expected)) {
    fail("BACKUP_SOURCE_CHANGED", "Backup source changed before copy");
  }
  const noFollow = "O_NOFOLLOW" in fileConstants ? fileConstants.O_NOFOLLOW : 0;
  const input = await open(source, fileConstants.O_RDONLY | noFollow);
  let output: Awaited<ReturnType<typeof open>> | undefined;
  let buffer: Buffer | undefined;
  try {
    output = await open(target, "wx", 0o600);
    buffer = Buffer.allocUnsafe(ioChunkBytes);
    let position = 0;
    const hash = createHash("sha256");
    while (position < (expected.size ?? 0)) {
      const { bytesRead } = await input.read(buffer, 0, Math.min(buffer.length, (expected.size ?? 0) - position), position);
      if (!bytesRead) fail("BACKUP_SOURCE_CHANGED", "Backup source ended during copy");
      const chunk = buffer.subarray(0, bytesRead);
      hash.update(chunk);
      await writeAll(output, chunk, position);
      position += bytesRead;
    }
    if (hash.digest("hex") !== expected.sha256) {
      fail("BACKUP_SOURCE_CHANGED", "Backup source checksum changed during copy");
    }
    await output.sync();
  } finally {
    buffer?.fill(0);
    await output?.close().catch(() => undefined);
    await input.close().catch(() => undefined);
  }
  await chmod(target, 0o600);
}

async function copyTree(sourceRoot: string, targetRoot: string, snapshot: TreeSnapshot) {
  if (!snapshot.present) return;
  await mkdir(targetRoot, { mode: 0o700, recursive: true });
  for (const entry of snapshot.entries) {
    const target = join(targetRoot, ...entry.path.split("/"));
    if (entry.kind === "directory") {
      await mkdir(target, { mode: 0o700, recursive: true });
      await chmod(target, 0o700);
    } else {
      await copyExpectedFile(
        join(sourceRoot, ...entry.path.split("/")),
        target,
        entry,
      );
    }
  }
}

async function encryptFile(
  sourcePath: string,
  expected: TreeEntry,
  kind: EncryptedEntryKind,
  logicalPath: string,
  objectsDirectory: string,
  dek: Buffer,
  backupId: string,
): Promise<EncryptedEntry> {
  safeLogicalPath(logicalPath);
  const current = await inspectRegularFile(sourcePath, expected.path);
  if (stableJson(current) !== stableJson(expected)) {
    fail("BACKUP_SOURCE_CHANGED", "Backup source changed before encryption");
  }
  const entryId = randomUUID();
  const objectFile = `objects/${entryId}.bin`;
  const destination = join(objectsDirectory, `${entryId}.bin`);
  const noFollow = "O_NOFOLLOW" in fileConstants ? fileConstants.O_NOFOLLOW : 0;
  let input: Awaited<ReturnType<typeof open>> | undefined;
  let output: Awaited<ReturnType<typeof open>> | undefined;
  let key: Buffer | undefined;
  let iv: Buffer | undefined;
  let tag: Buffer | undefined;
  let buffer: Buffer | undefined;
  try {
    key = entryKey(dek, backupId, entryId);
    iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
    cipher.setAAD(entryAad(backupId, entryId, kind, logicalPath));
    input = await open(sourcePath, fileConstants.O_RDONLY | noFollow);
    output = await open(destination, "wx", 0o600);
    const plaintextHash = createHash("sha256");
    const ciphertextHash = createHash("sha256");
    buffer = Buffer.allocUnsafe(ioChunkBytes);
    let plaintextBytes = 0;
    let ciphertextBytes = 0;
    let outputPosition = 0;
    const opened = await input.stat({ bigint: true });
    if (
      !opened.isFile() || String(opened.dev) !== expected.dev ||
      String(opened.ino) !== expected.ino || Number(opened.size) !== expected.size ||
      opened.mtimeNs.toString() !== expected.mtimeNs ||
      opened.ctimeNs.toString() !== expected.ctimeNs
    ) fail("BACKUP_SOURCE_CHANGED", "Backup source changed while opening encryption input");
    let position = 0;
    while (position < (expected.size ?? 0)) {
      const { bytesRead } = await input.read(
        buffer,
        0,
        Math.min(buffer.length, (expected.size ?? 0) - position),
        position,
      );
      if (!bytesRead) fail("BACKUP_SOURCE_CHANGED", "Backup source ended during encryption");
      const plain = buffer.subarray(0, bytesRead);
      plaintextHash.update(plain);
      plaintextBytes += bytesRead;
      const encrypted = cipher.update(plain);
      if (encrypted.length) {
        outputPosition = await writeAll(output, encrypted, outputPosition);
        ciphertextHash.update(encrypted);
        ciphertextBytes += encrypted.length;
      }
      position += bytesRead;
    }
    const final = cipher.final();
    if (final.length) {
      outputPosition = await writeAll(output, final, outputPosition);
      ciphertextHash.update(final);
      ciphertextBytes += final.length;
    }
    const after = await input.stat({ bigint: true });
    if (
      after.size !== opened.size || after.mtimeNs !== opened.mtimeNs ||
      after.ctimeNs !== opened.ctimeNs || after.dev !== opened.dev || after.ino !== opened.ino
    ) fail("BACKUP_SOURCE_CHANGED", "Backup source changed during encryption");
    const plaintextSha256 = plaintextHash.digest("hex");
    if (
      plaintextBytes !== expected.size || plaintextSha256 !== expected.sha256 ||
      outputPosition !== ciphertextBytes
    ) {
      fail("BACKUP_SOURCE_CHANGED", "Backup source checksum changed during encryption");
    }
    await output.sync();
    await chmod(destination, 0o600);
    tag = cipher.getAuthTag();
    return Object.freeze({
      ciphertextBytes,
      ciphertextSha256: ciphertextHash.digest("hex"),
      entryId,
      iv: iv.toString("base64"),
      kind,
      logicalPath,
      objectFile,
      plaintextBytes,
      plaintextSha256,
      tag: tag.toString("base64"),
    });
  } finally {
    buffer?.fill(0);
    key?.fill(0);
    iv?.fill(0);
    tag?.fill(0);
    await input?.close().catch(() => undefined);
    await output?.close().catch(() => undefined);
  }
}

async function encryptBuffer(
  plaintext: Buffer,
  destination: string,
  dek: Buffer,
  backupId: string,
) {
  const entryId = "manifest" as const;
  const key = entryKey(dek, backupId, entryId);
  const iv = randomBytes(12);
  let updated: Buffer | undefined;
  let final: Buffer | undefined;
  let ciphertext: Buffer | undefined;
  let tag: Buffer | undefined;
  try {
    const cipher = createCipheriv("aes-256-gcm", key, iv, {
      authTagLength: 16,
    });
    cipher.setAAD(entryAad(backupId, entryId, "manifest", "manifest"));
    updated = cipher.update(plaintext);
    final = cipher.final();
    ciphertext = Buffer.concat([updated, final]);
    await writePrivateFile(destination, ciphertext);
    tag = cipher.getAuthTag();
    const result = Object.freeze({
      ciphertextBytes: ciphertext.length,
      ciphertextSha256: sha256(ciphertext),
      entryId,
      iv: iv.toString("base64"),
      tag: tag.toString("base64"),
    });
    return result;
  } finally {
    updated?.fill(0);
    final?.fill(0);
    ciphertext?.fill(0);
    tag?.fill(0);
    key.fill(0);
    iv.fill(0);
  }
}

function* mediaRows(databasePath: string): Generator<MediaRow> {
  const database = new DatabaseSync(databasePath, { readOnly: true, timeout: 5_000 });
  try {
    const table = database.prepare(`
      SELECT COUNT(*) AS count
      FROM sqlite_schema
      WHERE type = 'table' AND name = 'media_assets'
    `);
    table.setReadBigInts(true);
    const count = table.get() as { count?: bigint } | undefined;
    if (count?.count !== 1n) fail("BACKUP_MEDIA_TABLE_MISSING", "media_assets table is missing");
    const statement = database.prepare(`
      SELECT
        kind, id, storage_name, byte_size, storage_backend, object_key,
        checksum_sha256, storage_status, storage_profile_id
      FROM media_assets
      ORDER BY kind, id
    `);
    statement.setReadBigInts(true);
    for (const row of statement.iterate() as Iterable<MediaRow>) yield row;
  } catch (error) {
    if (error instanceof BackupPackageError) throw error;
    fail("BACKUP_MEDIA_METADATA_INVALID", "Media metadata could not be inspected");
  } finally {
    database.close();
  }
}

function safeByteSize(value: bigint) {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    fail("BACKUP_MEDIA_METADATA_INVALID", "Media byte size is invalid");
  }
  return Number(value);
}

async function mirrorEvidence(input: BackupOssMirror): Promise<MirrorEvidence> {
  const filePath = normalizedAbsolute(input.filePath, "OSS mirror path");
  if (!input.objectKey || input.objectKey.length > 1_024 || input.objectKey.includes("\0")) {
    fail("BACKUP_OSS_MIRROR_INVALID", "OSS mirror object key is invalid");
  }
  const versionId = input.versionId.trim();
  if (!versionId || versionId.length > 1_024 || versionId.includes("\0")) {
    fail("BACKUP_OSS_MIRROR_INVALID", "OSS mirror version is invalid");
  }
  const evidence = await inspectRegularFile(filePath, basename(filePath));
  return Object.freeze({
    evidence,
    filePath,
    objectKey: input.objectKey,
    versionId,
  });
}

function mediaIntegrityFiles(
  snapshot: TreeSnapshot,
): readonly MediaIntegrityFileEvidence[] {
  return Object.freeze(snapshot.entries.flatMap((entry) =>
    entry.kind === "file" && entry.sha256 !== undefined &&
      entry.size !== undefined
      ? [Object.freeze({
          logicalPath: entry.path,
          sha256: entry.sha256,
          size: entry.size,
        })]
      : []));
}

function mediaIntegrityOssEvidence(
  mirrors: readonly MirrorEvidence[],
): readonly MediaIntegrityOssEvidence[] {
  return Object.freeze(mirrors.map((mirror) => {
    if (
      mirror.evidence.sha256 === undefined ||
      mirror.evidence.size === undefined
    ) fail("BACKUP_OSS_MIRROR_INVALID", "OSS mirror evidence is incomplete");
    return Object.freeze({
      byteSize: mirror.evidence.size,
      checksumSha256: mirror.evidence.sha256,
      objectKey: mirror.objectKey,
      versionId: mirror.versionId,
    });
  }));
}

function inspectBackupMediaIntegrity(
  databasePath: string,
  databaseInspection: BackupDatabaseInspection,
  mediaSnapshot: TreeSnapshot,
  mirrors: readonly MirrorEvidence[],
  storageProfileIds: readonly string[],
) {
  return inspectMediaIntegrity({
    databaseLogicalSha256: databaseInspection.logicalSha256,
    databasePath,
    files: mediaIntegrityFiles(mediaSnapshot),
    ossEvidence: mediaIntegrityOssEvidence(mirrors),
    storageProfileIds,
  });
}

function requireCompleteMediaIntegrity(report: MediaIntegrityReport) {
  if (!report.backupComplete) {
    fail(
      "BACKUP_MEDIA_INTEGRITY_INCOMPLETE",
      "Media integrity has backup-blocking issues",
    );
  }
  return report;
}

async function validateMedia(
  databasePath: string,
  mediaDirectory: string,
  mediaSnapshot: TreeSnapshot,
  mirrors: readonly MirrorEvidence[],
  mirrorLogicalPaths?: ReadonlyMap<string, string>,
): Promise<MediaValidation> {
  const files = new Map(
    mediaSnapshot.entries
      .filter((entry) => entry.kind === "file")
      .map((entry) => [entry.path, entry]),
  );
  const mirrorMap = new Map<string, MirrorEvidence>();
  for (const mirror of mirrors) {
    if (mirrorMap.has(mirror.objectKey)) {
      fail("BACKUP_OSS_MIRROR_DUPLICATE", "OSS mirror object key is duplicated");
    }
    mirrorMap.set(mirror.objectKey, mirror);
  }
  const usedMirrors = new Set<string>();
  const localReady: LocalMediaBinding[] = [];
  const ossReady: OssMediaBinding[] = [];
  for (const row of mediaRows(databasePath)) {
    if (
      row.storage_backend === "oss" && row.object_key !== null &&
      row.storage_status !== "ready"
    ) {
      fail(
        "BACKUP_OSS_STATE_UNRECOVERABLE",
        "OSS media with a remote object is not ready for a complete backup",
      );
    }
    if (row.storage_status !== "ready") continue;
    const byteSize = safeByteSize(row.byte_size);
    if (row.storage_backend === "local") {
      if (
        !row.storage_name || basename(row.storage_name) !== row.storage_name ||
        row.storage_name.includes("\\")
      ) fail("BACKUP_MEDIA_PATH_INVALID", "Local media storage name is invalid");
      const file = files.get(row.storage_name);
      if (!file || file.size !== byteSize || !file.sha256) {
        fail("BACKUP_MEDIA_MISSING", "Ready local media is missing or has the wrong size");
      }
      const metadataChecksumPresent = row.checksum_sha256 !== null;
      if (
        metadataChecksumPresent &&
        (!/^[a-f0-9]{64}$/i.test(row.checksum_sha256 ?? "") ||
          row.checksum_sha256?.toLowerCase() !== file.sha256)
      ) fail("BACKUP_MEDIA_CHECKSUM_MISMATCH", "Local media checksum does not match metadata");
      localReady.push(Object.freeze({
        byteSize,
        checksumSha256: file.sha256,
        id: row.id,
        kind: row.kind,
        logicalPath: `media/${row.storage_name}`,
        metadataChecksumPresent,
        storageName: row.storage_name,
      }));
    } else if (row.storage_backend === "oss") {
      const objectKey = row.object_key ?? "";
      const mirror = mirrorMap.get(objectKey);
      if (!mirror || !mirror.evidence.sha256 || mirror.evidence.size !== byteSize) {
        fail("BACKUP_OSS_MIRROR_MISSING", "Ready OSS media has no matching local mirror");
      }
      if (
        !row.checksum_sha256 || !/^[a-f0-9]{64}$/i.test(row.checksum_sha256) ||
        row.checksum_sha256.toLowerCase() !== mirror.evidence.sha256
      ) fail("BACKUP_OSS_MIRROR_CHECKSUM_MISMATCH", "OSS mirror checksum does not match metadata");
      usedMirrors.add(objectKey);
      ossReady.push(Object.freeze({
        byteSize,
        checksumSha256: mirror.evidence.sha256,
        id: row.id,
        kind: row.kind,
        logicalPath: mirrorLogicalPaths?.get(objectKey) ?? "",
        objectKey,
        storageProfileId: row.storage_profile_id,
        versionId: mirror.versionId,
      }));
    } else {
      fail("BACKUP_MEDIA_BACKEND_INVALID", "Ready media uses an unknown storage backend");
    }
  }
  if (usedMirrors.size !== mirrorMap.size) {
    fail("BACKUP_OSS_MIRROR_UNUSED", "An OSS mirror does not match ready media metadata");
  }
  localReady.sort((left, right) => `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`));
  ossReady.sort((left, right) => `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`));
  return Object.freeze({
    localReady: Object.freeze(localReady),
    ossReady: Object.freeze(ossReady),
  });
}

async function rawDatabaseSnapshot(
  sourceDirectory: string,
  sourceSnapshot: TreeSnapshot,
  scratchDirectory: string,
) {
  const rawDirectory = join(scratchDirectory, "raw-database");
  await mkdir(rawDirectory, { mode: 0o700 });
  for (const entry of sourceSnapshot.entries) {
    if (entry.path.endsWith("-shm")) continue;
    await copyExpectedFile(
      join(sourceDirectory, entry.path),
      join(rawDirectory, entry.path),
      entry,
    );
  }
  const rawPath = join(rawDirectory, "unboundry.sqlite");
  const snapshotDirectory = join(scratchDirectory, "snapshot");
  await mkdir(snapshotDirectory, { mode: 0o700 });
  const snapshotPath = join(snapshotDirectory, "unboundry.sqlite");
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(rawPath, { timeout: 5_000 });
    await backup(database, snapshotPath);
  } catch {
    fail("BACKUP_DATABASE_SNAPSHOT_FAILED", "SQLite snapshot could not be created");
  } finally {
    database?.close();
  }
  let normalized: DatabaseSync | undefined;
  try {
    normalized = new DatabaseSync(snapshotPath, { timeout: 5_000 });
    const mode = normalized.prepare("PRAGMA journal_mode = DELETE").get() as
      { journal_mode?: unknown } | undefined;
    if (String(mode?.journal_mode ?? "").toLowerCase() !== "delete") {
      fail(
        "BACKUP_DATABASE_SNAPSHOT_FAILED",
        "SQLite snapshot journal mode could not be normalized",
      );
    }
  } catch (error) {
    if (error instanceof BackupPackageError) throw error;
    fail("BACKUP_DATABASE_SNAPSHOT_FAILED", "SQLite snapshot could not be normalized");
  } finally {
    normalized?.close();
  }
  await Promise.all([
    rm(`${snapshotPath}-journal`, { force: true }),
    rm(`${snapshotPath}-shm`, { force: true }),
    rm(`${snapshotPath}-wal`, { force: true }),
  ]);
  await chmod(snapshotPath, 0o600);
  const evidence = await inspectRegularFile(snapshotPath, "unboundry.sqlite");
  const inspection = inspectBackupDatabase(snapshotPath, snapshotDirectory);
  return { evidence, inspection, snapshotPath };
}

function summaryFromManifest(
  manifest: BackupManifest,
  packageDirectory: string,
  mediaIntegrity: MediaIntegrityReport,
): BackupPackageSummary {
  return Object.freeze({
    backupId: manifest.backupId,
    captureMode: manifest.captureMode,
    databaseLogicalSha256: manifest.database.inspection.logicalSha256,
    finalCandidate: manifest.captureMode === "locked-exact" &&
      manifest.database.inspection.userVersion === currentBackupSchemaVersion,
    mediaFiles: manifest.entries.filter((entry) => entry.kind === "media").length,
    mediaIntegrity: summarizeMediaIntegrity(mediaIntegrity),
    ossMirrors: manifest.entries.filter((entry) => entry.kind === "oss").length,
    packageDirectory,
    schemaVersion: manifest.database.inspection.userVersion,
    secretFiles: manifest.entries.filter((entry) => entry.kind === "secret").length,
  });
}

/**
 * Builds a media-integrity report from a stable private SQLite snapshot and a
 * frozen media-tree fingerprint. Source data is only read; all writable work
 * stays in the private scratch directory and is removed before return.
 */
export async function inspectFrozenMediaIntegrity(
  options: InspectFrozenMediaIntegrityOptions,
): Promise<MediaIntegrityReport> {
  if (options.sourceFrozen !== true) {
    fail("BACKUP_SOURCE_NOT_FROZEN", "Media inspection source must be explicitly frozen");
  }
  const capturePurpose = capturePurposeFor(
    options.capturePurpose,
    Boolean(options.frozenSourceContract),
  );
  const sourceDirectory = normalizedAbsolute(
    options.sourceDirectory,
    "Source directory",
  );
  const scratchRoot = normalizedAbsolute(
    options.scratchRoot ?? resolve(tmpdir()),
    "Scratch root",
  );
  if (containsPath(sourceDirectory, scratchRoot)) {
    fail("BACKUP_PATH_OVERLAP", "Inspection scratch root may not be inside source data");
  }
  const mirrorOptions = (options.ossMirrors ?? []).map((input) => Object.freeze({
    ...input,
    filePath: normalizedAbsolute(input.filePath, "OSS mirror path"),
  }));
  for (const mirror of mirrorOptions) {
    assertDisjointPaths(sourceDirectory, mirror.filePath);
  }
  const [canonicalSource, canonicalScratchRoot, ...canonicalMirrors] =
    await Promise.all([
      canonicalPotentialPath(sourceDirectory),
      canonicalPotentialPath(scratchRoot),
      ...mirrorOptions.map((mirror) => canonicalPotentialPath(mirror.filePath)),
    ]);
  if (containsPath(canonicalSource, canonicalScratchRoot)) {
    fail("BACKUP_PATH_OVERLAP", "Inspection scratch root aliases source data");
  }
  for (const mirror of canonicalMirrors) {
    assertDisjointPaths(canonicalSource, mirror);
  }
  await ensureTrustedDataRoot(sourceDirectory);
  await ensureTrustedWorkRoot(scratchRoot, true);
  const sourceIdentity = await directoryIdentity(
    sourceDirectory,
    "BACKUP_SOURCE_CHANGED",
  );
  try {
    await lstat(join(sourceDirectory, restoreIncompleteMarker));
    fail("BACKUP_SOURCE_INCOMPLETE", "An incomplete restore cannot be inspected");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }

  let scratch: string | undefined;
  try {
    scratch = await mkdtemp(join(scratchRoot, "unboundry-media-report-"));
    await chmod(scratch, 0o700);
    const canonicalScratch = await canonicalPotentialPath(scratch);
    assertDisjointPaths(canonicalSource, canonicalScratch);
    for (const mirror of canonicalMirrors) {
      assertDisjointPaths(canonicalScratch, mirror);
    }
    return await withOptionalFrozenSourceWriteLock(
      sourceDirectory,
      scratch,
      options.frozenSourceContract,
      capturePurpose,
      async (lockedInspection) => {
        const databaseBefore = await databaseFilesSnapshot(sourceDirectory);
        const mediaDirectory = join(sourceDirectory, "media");
        const secretsDirectory = join(sourceDirectory, "secrets");
        const mediaBefore = await fingerprintTree(mediaDirectory, false);
        const observedSecretsBefore = await fingerprintTree(secretsDirectory, false);
        const secretsBefore = restorableSecretsSnapshot(observedSecretsBefore);
        const databaseSnapshot = await rawDatabaseSnapshot(
          sourceDirectory,
          databaseBefore,
          scratch!,
        );
        if (!supportedBackupSchemaVersions.has(
          databaseSnapshot.inspection.userVersion,
        )) {
          fail(
            "BACKUP_SCHEMA_UNSUPPORTED",
            "Media inspection requires a supported backup schema",
          );
        }
        if (
          lockedInspection &&
          !sameLogicalDatabaseInspection(
            lockedInspection,
            databaseSnapshot.inspection,
          )
        ) {
          fail(
            "BACKUP_SOURCE_LOGICAL_SHA_MISMATCH",
            "Private database snapshot differs from the locked source contract",
          );
        }
        await checkpoint(options.onCheckpoint, "after-database-snapshot");
        const copiedSecrets = join(scratch!, "secrets");
        await copyTree(secretsDirectory, copiedSecrets, secretsBefore);
        const secretContext = await validateBackupSecretsWithContext(
          databaseSnapshot.snapshotPath,
          copiedSecrets,
          scratch!,
          { requireDatabaseAlignment: Boolean(lockedInspection) },
        );
        const mirrors = await Promise.all(mirrorOptions.map(mirrorEvidence));
        const report = inspectBackupMediaIntegrity(
          databaseSnapshot.snapshotPath,
          databaseSnapshot.inspection,
          mediaBefore,
          mirrors,
          secretContext.storageProfileIds,
        );
        if (options.mediaWarningAllowlist !== undefined) {
          requireMediaIntegrityPolicy(report, options.mediaWarningAllowlist);
        }
        for (const mirror of mirrors) {
          const after = await inspectRegularFile(
            mirror.filePath,
            mirror.evidence.path,
          );
          if (stableJson(after) !== stableJson(mirror.evidence)) {
            fail("BACKUP_SOURCE_CHANGED", "OSS mirror changed during media inspection");
          }
        }
        const databaseAfter = await databaseFilesSnapshot(sourceDirectory);
        const mediaAfter = await fingerprintTree(mediaDirectory, false);
        const observedSecretsAfter = await fingerprintTree(secretsDirectory, false);
        const secretsAfter = restorableSecretsSnapshot(observedSecretsAfter);
        const finalSourceIdentity = await directoryIdentity(
          sourceDirectory,
          "BACKUP_SOURCE_CHANGED",
        );
        if (
          !sameIdentity(sourceIdentity, finalSourceIdentity) ||
          !sameSnapshot(databaseBefore, databaseAfter) ||
          !sameSnapshot(mediaBefore, mediaAfter) ||
          !sameSnapshot(observedSecretsBefore, observedSecretsAfter) ||
          !sameSnapshot(secretsBefore, secretsAfter)
        ) fail("BACKUP_SOURCE_CHANGED", "Media inspection source changed during snapshot");
        return report;
      },
    );
  } catch (error) {
    return rethrowPackageFailure(
      error,
      "MEDIA_REPORT_FAILED",
      "Media integrity inspection failed",
    );
  } finally {
    if (scratch) {
      try {
        await rm(scratch, { force: true, recursive: true });
      } catch {
        fail("BACKUP_CLEANUP_FAILED", "Media inspection cleanup failed");
      }
    }
  }
}

export async function createEncryptedBackup(
  options: CreateEncryptedBackupOptions,
): Promise<BackupPackageSummary> {
  if (options.sourceFrozen !== true) {
    fail("BACKUP_SOURCE_NOT_FROZEN", "Backup source must be explicitly frozen");
  }
  const capturePurpose = capturePurposeFor(
    options.capturePurpose,
    Boolean(options.frozenSourceContract),
  );
  const sourceDirectory = normalizedAbsolute(options.sourceDirectory, "Source directory");
  const backupRoot = normalizedAbsolute(options.backupRoot, "Backup root");
  const scratchRoot = normalizedAbsolute(options.scratchRoot ?? resolve(tmpdir()), "Scratch root");
  assertDisjointPaths(sourceDirectory, backupRoot);
  if (containsPath(sourceDirectory, scratchRoot) || containsPath(backupRoot, scratchRoot)) {
    fail("BACKUP_PATH_OVERLAP", "Scratch root may not be inside source or backup storage");
  }
  const mirrorOptions = (options.ossMirrors ?? []).map((input) => Object.freeze({
    ...input,
    filePath: normalizedAbsolute(input.filePath, "OSS mirror path"),
  }));
  for (const mirror of mirrorOptions) {
    assertDisjointPaths(sourceDirectory, mirror.filePath);
    assertDisjointPaths(backupRoot, mirror.filePath);
  }
  const [canonicalSource, canonicalBackup, canonicalScratchRoot, ...canonicalMirrors] =
    await Promise.all([
      canonicalPotentialPath(sourceDirectory),
      canonicalPotentialPath(backupRoot),
      canonicalPotentialPath(scratchRoot),
      ...mirrorOptions.map((mirror) => canonicalPotentialPath(mirror.filePath)),
    ]);
  assertDisjointPaths(canonicalSource, canonicalBackup);
  if (
    containsPath(canonicalSource, canonicalScratchRoot) ||
    containsPath(canonicalBackup, canonicalScratchRoot)
  ) fail("BACKUP_PATH_OVERLAP", "Scratch root aliases source or backup storage");
  canonicalMirrors.forEach((mirror) => {
    assertDisjointPaths(canonicalSource, mirror);
    assertDisjointPaths(canonicalBackup, mirror);
  });
  await ensureTrustedDataRoot(sourceDirectory);
  await ensureTrustedWorkRoot(backupRoot, true);
  await ensureTrustedWorkRoot(scratchRoot, true);
  const sourceIdentity = await directoryIdentity(
    sourceDirectory,
    "BACKUP_SOURCE_CHANGED",
  );
  try {
    await lstat(join(sourceDirectory, restoreIncompleteMarker));
    fail("BACKUP_SOURCE_INCOMPLETE", "An incomplete restore cannot be backed up");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }

  const recipient = recoveryPublicKey(options.recoveryPublicKey);
  const signer = signingPrivateKey(options.signingPrivateKey);
  if (
    options.retryBackupId !== undefined &&
    (!validUuid(options.retryBackupId) ||
      options.retryBackupId !== options.retryBackupId.toLowerCase())
  ) {
    fail("BACKUP_RETRY_ID_INVALID", "Backup retry id is invalid");
  }
  const backupId = options.retryBackupId ?? randomUUID();
  const finalDirectory = join(backupRoot, `${backupId}.ubbackup`);
  const stage = await mkdtemp(join(backupRoot, `.partial-${backupId}-`));
  let scratch: string | undefined;
  let dek: Buffer | undefined;
  let published = false;
  try {
    await chmod(stage, 0o700);
    scratch = await mkdtemp(join(scratchRoot, "unboundry-backup-"));
    const canonicalScratch = await canonicalPotentialPath(scratch);
    assertDisjointPaths(canonicalSource, canonicalScratch);
    assertDisjointPaths(canonicalBackup, canonicalScratch);
    for (const mirror of canonicalMirrors) assertDisjointPaths(canonicalScratch, mirror);
    await chmod(scratch, 0o700);
    dek = randomBytes(32);
    const objectsDirectory = join(stage, "objects");
    await mkdir(objectsDirectory, { mode: 0o700 });
    const captured = await withOptionalFrozenSourceWriteLock(
      sourceDirectory,
      scratch,
      options.frozenSourceContract,
      capturePurpose,
      async (lockedInspection) => {
        const databaseBefore = await databaseFilesSnapshot(sourceDirectory);
        const libraryBefore = await libraryDatabaseSnapshot(sourceDirectory);
        const mediaDirectory = join(sourceDirectory, "media");
        const secretsDirectory = join(sourceDirectory, "secrets");
        const mediaBefore = await fingerprintTree(mediaDirectory, false);
        const observedSecretsBefore = await fingerprintTree(secretsDirectory, false);
        const secretsBefore = restorableSecretsSnapshot(observedSecretsBefore);

        const databaseSnapshot = await rawDatabaseSnapshot(
          sourceDirectory,
          databaseBefore,
          scratch!,
        );
        if (!supportedBackupSchemaVersions.has(
          databaseSnapshot.inspection.userVersion,
        )) {
          fail(
            "BACKUP_SCHEMA_UNSUPPORTED",
            "Encrypted package creation requires a supported backup schema",
          );
        }
        if (
          lockedInspection &&
          !sameLogicalDatabaseInspection(
            lockedInspection,
            databaseSnapshot.inspection,
          )
        ) {
          fail(
            "BACKUP_SOURCE_LOGICAL_SHA_MISMATCH",
            "Private database snapshot differs from the locked source contract",
          );
        }
        await checkpoint(options.onCheckpoint, "after-database-snapshot");

        const copiedSecrets = join(scratch!, "secrets");
        await copyTree(secretsDirectory, copiedSecrets, secretsBefore);
        const secretContext = await validateBackupSecretsWithContext(
          databaseSnapshot.snapshotPath,
          copiedSecrets,
          scratch!,
          { requireDatabaseAlignment: Boolean(lockedInspection) },
        );
        const secretValidation = secretContext.validation;
        const mirrorInputs = await Promise.all(mirrorOptions.map(mirrorEvidence));
        const provisionalMedia = await validateMedia(
          databaseSnapshot.snapshotPath,
          mediaDirectory,
          mediaBefore,
          mirrorInputs,
        );
        const mediaIntegrity = requireMediaIntegrityPolicy(
          inspectBackupMediaIntegrity(
            databaseSnapshot.snapshotPath,
            databaseSnapshot.inspection,
            mediaBefore,
            mirrorInputs,
            secretContext.storageProfileIds,
          ),
          options.mediaWarningAllowlist,
        );

        const entries: EncryptedEntry[] = [];
        const databaseEntry = await encryptFile(
          databaseSnapshot.snapshotPath,
          databaseSnapshot.evidence,
          "database",
          "unboundry.sqlite",
          objectsDirectory,
          dek!,
          backupId,
        );
        entries.push(databaseEntry);
        if (libraryBefore.present) {
          const libraryEvidence = libraryBefore.entries.find(
            (entry) => entry.path === "library.sqlite",
          );
          if (!libraryEvidence) {
            fail("BACKUP_LIBRARY_MISSING", "Library database is missing");
          }
          const libraryPath = join(sourceDirectory, "library.sqlite");
          try {
            validateLibraryBackupDatabase(libraryPath);
          } catch {
            fail("BACKUP_LIBRARY_INVALID", "Library database is invalid");
          }
          entries.push(await encryptFile(
            libraryPath,
            libraryEvidence,
            "library",
            "library.sqlite",
            objectsDirectory,
            dek!,
            backupId,
          ));
        }
        for (const file of mediaBefore.entries.filter((entry) => entry.kind === "file")) {
          entries.push(await encryptFile(
            join(mediaDirectory, ...file.path.split("/")),
            file,
            "media",
            `media/${file.path}`,
            objectsDirectory,
            dek!,
            backupId,
          ));
        }
        const mirrorLogicalPaths = new Map<string, string>();
        for (const mirror of mirrorInputs) {
          const logicalPath = `oss-mirrors/${randomUUID()}`;
          const encrypted = await encryptFile(
            mirror.filePath,
            mirror.evidence,
            "oss",
            logicalPath,
            objectsDirectory,
            dek!,
            backupId,
          );
          entries.push(encrypted);
          mirrorLogicalPaths.set(mirror.objectKey, logicalPath);
          const after = await inspectRegularFile(mirror.filePath, mirror.evidence.path);
          if (stableJson(after) !== stableJson(mirror.evidence)) {
            fail("BACKUP_SOURCE_CHANGED", "OSS mirror changed during backup");
          }
        }
        const media = Object.freeze({
          localReady: provisionalMedia.localReady,
          ossReady: Object.freeze(provisionalMedia.ossReady.map((binding) => Object.freeze({
            ...binding,
            logicalPath: mirrorLogicalPaths.get(binding.objectKey) ?? "",
          }))),
        });
        await checkpoint(options.onCheckpoint, "after-media-encryption");
        for (const file of secretsBefore.entries.filter((entry) => entry.kind === "file")) {
          entries.push(await encryptFile(
            join(secretsDirectory, ...file.path.split("/")),
            file,
            "secret",
            `secrets/${file.path}`,
            objectsDirectory,
            dek!,
            backupId,
          ));
        }
        await checkpoint(options.onCheckpoint, "after-secrets-encryption");

        const databaseAfter = await databaseFilesSnapshot(sourceDirectory);
        const libraryAfter = await libraryDatabaseSnapshot(sourceDirectory);
        const mediaAfter = await fingerprintTree(mediaDirectory, false);
        const observedSecretsAfter = await fingerprintTree(secretsDirectory, false);
        const secretsAfter = restorableSecretsSnapshot(observedSecretsAfter);
        const finalSourceIdentity = await directoryIdentity(
          sourceDirectory,
          "BACKUP_SOURCE_CHANGED",
        );
        if (
          !sameIdentity(sourceIdentity, finalSourceIdentity) ||
          !sameSnapshot(databaseBefore, databaseAfter) ||
          !sameSnapshot(libraryBefore, libraryAfter) ||
          !sameSnapshot(mediaBefore, mediaAfter) ||
          !sameSnapshot(observedSecretsBefore, observedSecretsAfter) ||
          !sameSnapshot(secretsBefore, secretsAfter)
        ) fail("BACKUP_SOURCE_CHANGED", "Backup source changed during frozen snapshot");
        return Object.freeze({
          databaseAfter,
          databaseBefore,
          databaseEntry,
          databaseInspection: databaseSnapshot.inspection,
          entries,
          media,
          mediaAfter,
          mediaBefore,
          mediaIntegrity,
          secretValidation,
          secretsAfter,
          secretsBefore,
        });
      },
    );
    const {
      databaseAfter,
      databaseBefore,
      databaseEntry,
      databaseInspection,
      entries,
      media,
      mediaAfter,
      mediaBefore,
      mediaIntegrity,
      secretValidation,
      secretsAfter,
      secretsBefore,
    } = captured;

    entries.sort((left, right) => left.logicalPath.localeCompare(right.logicalPath));
    const manifest: BackupManifest = Object.freeze({
      backupId,
      captureMode: options.frozenSourceContract
        ? "locked-exact"
        : "external-unverified",
      createdAt: new Date().toISOString(),
      database: Object.freeze({
        entryId: databaseEntry.entryId,
        inspection: databaseInspection,
      }),
      entries: Object.freeze(entries),
      format: backupPackageFormat,
      media,
      secrets: Object.freeze({
        fileCount: entries.filter((entry) => entry.kind === "secret").length,
        validation: secretValidation,
      }),
      source: Object.freeze({
        databaseAfter,
        databaseBefore,
        mediaAfter,
        mediaBefore,
        secretsAfter,
        secretsBefore,
      }),
      version: backupPackageFormatVersion,
    });
    const manifestPlaintext = Buffer.from(stableJson(manifest), "utf8");
    if (manifestPlaintext.length === 0 || manifestPlaintext.length > manifestMaximumBytes) {
      manifestPlaintext.fill(0);
      fail("BACKUP_MANIFEST_TOO_LARGE", "Encrypted backup manifest exceeds its safe limit");
    }
    let encryptedManifest: UnsignedEnvelope["manifest"];
    try {
      encryptedManifest = await encryptBuffer(
        manifestPlaintext,
        join(stage, "manifest.bin"),
        dek,
        backupId,
      );
    } finally {
      manifestPlaintext.fill(0);
    }
    const wrappedKey = publicEncrypt({
      key: recipient,
      oaepHash: "sha256",
      oaepLabel: Buffer.from(backupId, "utf8"),
      padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING,
    }, dek);
    const unsigned: UnsignedEnvelope = Object.freeze({
      backupId,
      encryption: "AES-256-GCM-HKDF-SHA256",
      format: backupPackageFormat,
      keyWrap: "RSA-OAEP-SHA256",
      manifest: encryptedManifest,
      recipientKeySha256: keyFingerprint(recipient),
      signingKeySha256: keyFingerprint(signer),
      version: backupPackageFormatVersion,
      wrappedKey: wrappedKey.toString("base64"),
    });
    wrappedKey.fill(0);
    const signature = sign(null, Buffer.from(stableJson(unsigned), "utf8"), signer);
    const envelope: SignedEnvelope = Object.freeze({
      ...unsigned,
      signature: signature.toString("base64"),
    });
    signature.fill(0);
    await writePrivateFile(join(stage, "envelope.json"), `${stableJson(envelope)}\n`);
    await syncDirectory(objectsDirectory);
    await syncDirectory(stage);
    await checkpoint(options.onCheckpoint, "after-package-seal");
    await checkpoint(options.onCheckpoint, "before-backup-publish");
    try {
      await mkdir(finalDirectory, { mode: 0o700 });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EEXIST") {
        fail("BACKUP_TARGET_EXISTS", "Backup target already exists");
      }
      throw error;
    }
    const targetIdentity = await directoryIdentity(
      finalDirectory,
      "BACKUP_TARGET_CHANGED",
    );
    const markerPath = join(finalDirectory, backupIncompleteMarker);
    const stageIdentity = await directoryIdentity(
      stage,
      "BACKUP_TARGET_CHANGED",
    );
    await writeReservationMarker(
      markerPath,
      reservationMarker(
        "backup",
        backupId,
        databaseInspection.logicalSha256,
        finalDirectory,
        stage,
        stageIdentity,
      ),
    );
    const markerIdentity = await regularFileIdentity(
      markerPath,
      "BACKUP_TARGET_CHANGED",
    );
    await syncDirectory(finalDirectory);
    await checkpoint(options.onCheckpoint, "after-backup-reservation");
    await assertPublishReservation(
      finalDirectory,
      backupIncompleteMarker,
      targetIdentity,
      markerIdentity,
      "BACKUP_TARGET_CHANGED",
    );
    const stagedInventory = publishPayloadInventory(
      await fingerprintTree(stage, true),
      backupIncompleteMarker,
    );
    await publishTreeNoReplace(stage, finalDirectory, "BACKUP_TARGET_CHANGED");
    await rmdir(stage);
    await assertPublishReservation(
      finalDirectory,
      backupIncompleteMarker,
      targetIdentity,
      markerIdentity,
      "BACKUP_TARGET_CHANGED",
    );
    const finalInventory = publishPayloadInventory(
      await fingerprintTree(finalDirectory, true),
      backupIncompleteMarker,
    );
    if (stableJson(finalInventory) !== stableJson(stagedInventory)) {
      fail("BACKUP_TARGET_CHANGED", "Backup target contains foreign paths");
    }
    await syncDirectoryTree(finalDirectory);
    await unlink(markerPath);
    published = true;
    await syncDirectory(finalDirectory);
    await syncDirectory(backupRoot);
    return summaryFromManifest(manifest, finalDirectory, mediaIntegrity);
  } catch (error) {
    return rethrowPackageFailure(
      error,
      "BACKUP_CREATE_FAILED",
      "Encrypted backup creation failed",
    );
  } finally {
    dek?.fill(0);
    let cleanupFailed = false;
    if (scratch) {
      try {
        await rm(scratch, { force: true, recursive: true });
      } catch {
        cleanupFailed = true;
      }
    }
    if (!published) {
      try {
        await rm(stage, { force: true, recursive: true });
      } catch {
        cleanupFailed = true;
      }
    }
    if (cleanupFailed) {
      fail("BACKUP_CLEANUP_FAILED", "Encrypted backup cleanup failed");
    }
  }
}

async function readBoundedRegularFile(
  path: string,
  logicalPath: string,
  maximumBytes: number,
) {
  const evidence = await inspectRegularFile(path, logicalPath, maximumBytes);
  const noFollow = "O_NOFOLLOW" in fileConstants ? fileConstants.O_NOFOLLOW : 0;
  const handle = await open(path, fileConstants.O_RDONLY | noFollow);
  let value: Buffer | undefined;
  let overflowProbe: Buffer | undefined;
  try {
    const opened = await handle.stat({ bigint: true });
    if (
      !opened.isFile() || String(opened.dev) !== evidence.dev ||
      String(opened.ino) !== evidence.ino || Number(opened.size) !== evidence.size ||
      opened.mtimeNs.toString() !== evidence.mtimeNs ||
      opened.ctimeNs.toString() !== evidence.ctimeNs
    ) fail("BACKUP_PACKAGE_CHANGED", "Backup package changed before metadata read");
    if (opened.size > BigInt(maximumBytes)) {
      fail("BACKUP_FILE_TOO_LARGE", "Backup metadata exceeds its size limit");
    }
    value = Buffer.alloc(Number(opened.size));
    let position = 0;
    while (position < value.length) {
      const { bytesRead } = await handle.read(
        value,
        position,
        value.length - position,
        position,
      );
      if (!bytesRead) {
        fail("BACKUP_PACKAGE_CHANGED", "Backup package ended while reading");
      }
      position += bytesRead;
    }
    overflowProbe = Buffer.allocUnsafe(1);
    if ((await handle.read(overflowProbe, 0, 1, value.length)).bytesRead !== 0) {
      fail("BACKUP_FILE_TOO_LARGE", "Backup metadata expanded past its size limit");
    }
    const after = await handle.stat({ bigint: true });
    if (
      after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size ||
      after.mtimeNs !== opened.mtimeNs || after.ctimeNs !== opened.ctimeNs ||
      value.length !== evidence.size || sha256(value) !== evidence.sha256
    ) {
      fail("BACKUP_PACKAGE_CHANGED", "Backup package changed while reading");
    }
    return { evidence, value };
  } catch (error) {
    value?.fill(0);
    throw error;
  } finally {
    overflowProbe?.fill(0);
    await handle.close();
  }
}

function jsonObject(value: unknown, code = "BACKUP_FORMAT_INVALID") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(code, "Backup JSON object is invalid");
  }
  return value as Record<string, unknown>;
}

function validUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validSha(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function safeJsonInteger(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    fail("BACKUP_FORMAT_INVALID", `${label} is invalid`);
  }
  return value;
}

async function readSignedEnvelope(
  packageDirectory: string,
  trustedSigningKeyInput: BackupKeyInput,
) {
  const { value } = await readBoundedRegularFile(
    join(packageDirectory, "envelope.json"),
    "envelope.json",
    envelopeMaximumBytes,
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(value));
  } catch {
    value.fill(0);
    fail("BACKUP_ENVELOPE_INVALID", "Backup envelope is invalid");
  }
  value.fill(0);
  const envelope = jsonObject(parsed, "BACKUP_ENVELOPE_INVALID");
  exactKeys(envelope, [
    "backupId", "encryption", "format", "keyWrap", "manifest",
    "recipientKeySha256", "signature", "signingKeySha256", "version",
    "wrappedKey",
  ]);
  if (
    envelope.format !== backupPackageFormat ||
    envelope.version !== backupPackageFormatVersion ||
    envelope.encryption !== "AES-256-GCM-HKDF-SHA256" ||
    envelope.keyWrap !== "RSA-OAEP-SHA256" ||
    !validUuid(envelope.backupId) ||
    !validSha(envelope.recipientKeySha256) ||
    !validSha(envelope.signingKeySha256)
  ) fail("BACKUP_ENVELOPE_INVALID", "Backup envelope contract is invalid");
  const manifestObject = jsonObject(envelope.manifest, "BACKUP_ENVELOPE_INVALID");
  exactKeys(manifestObject, [
    "ciphertextBytes", "ciphertextSha256", "entryId", "iv", "tag",
  ]);
  if (
    manifestObject.entryId !== "manifest" ||
    !validSha(manifestObject.ciphertextSha256) ||
    safeJsonInteger(manifestObject.ciphertextBytes, "Manifest size") === 0 ||
    (manifestObject.ciphertextBytes as number) > manifestMaximumBytes
  ) fail("BACKUP_ENVELOPE_INVALID", "Encrypted manifest metadata is invalid");
  const iv = canonicalBase64(manifestObject.iv, "Manifest IV");
  const tag = canonicalBase64(manifestObject.tag, "Manifest tag");
  const wrappedKey = canonicalBase64(envelope.wrappedKey, "Wrapped backup key");
  const signature = canonicalBase64(envelope.signature, "Backup signature");
  try {
    if (iv.length !== 12 || tag.length !== 16 || !wrappedKey.length || signature.length !== 64) {
      fail("BACKUP_ENVELOPE_INVALID", "Backup envelope cryptography is invalid");
    }
    const unsigned: UnsignedEnvelope = Object.freeze({
      backupId: envelope.backupId,
      encryption: "AES-256-GCM-HKDF-SHA256",
      format: backupPackageFormat,
      keyWrap: "RSA-OAEP-SHA256",
      manifest: Object.freeze({
        ciphertextBytes: manifestObject.ciphertextBytes as number,
        ciphertextSha256: manifestObject.ciphertextSha256 as string,
        entryId: "manifest",
        iv: manifestObject.iv as string,
        tag: manifestObject.tag as string,
      }),
      recipientKeySha256: envelope.recipientKeySha256,
      signingKeySha256: envelope.signingKeySha256,
      version: backupPackageFormatVersion,
      wrappedKey: envelope.wrappedKey as string,
    });
    const trusted = signingPublicKey(trustedSigningKeyInput);
    if (keyFingerprint(trusted) !== unsigned.signingKeySha256) {
      fail("BACKUP_SIGNING_KEY_MISMATCH", "Backup signing key is not trusted");
    }
    if (!verify(
      null,
      Buffer.from(stableJson(unsigned), "utf8"),
      trusted,
      signature,
    )) fail("BACKUP_SIGNATURE_INVALID", "Backup envelope signature is invalid");
    return { envelope: unsigned, iv: Buffer.from(iv), tag: Buffer.from(tag) };
  } finally {
    iv.fill(0);
    tag.fill(0);
    wrappedKey.fill(0);
    signature.fill(0);
  }
}

function validTreeSnapshot(value: unknown): value is TreeSnapshot {
  const snapshot = jsonObject(value);
  if (typeof snapshot.present !== "boolean" || !Array.isArray(snapshot.entries) || !validSha(snapshot.sha256)) {
    fail("BACKUP_MANIFEST_INVALID", "Source tree fingerprint is invalid");
  }
  const seen = new Set<string>();
  let previousPath = "";
  for (const raw of snapshot.entries) {
    const entry = jsonObject(raw);
    if (
      (entry.kind !== "file" && entry.kind !== "directory") ||
      typeof entry.path !== "string" || typeof entry.ctimeNs !== "string" ||
      typeof entry.mtimeNs !== "string" || typeof entry.dev !== "string" ||
      typeof entry.ino !== "string" || typeof entry.mode !== "number"
    ) fail("BACKUP_MANIFEST_INVALID", "Source tree entry is invalid");
    safeLogicalPath(entry.path);
    if (seen.has(entry.path) || (previousPath && previousPath.localeCompare(entry.path) >= 0)) {
      fail("BACKUP_MANIFEST_INVALID", "Source tree paths are duplicated or unsorted");
    }
    seen.add(entry.path);
    previousPath = entry.path;
    safeJsonInteger(entry.mode, "Source entry mode");
    if (entry.kind === "file") {
      safeJsonInteger(entry.size, "Source file size");
      if (!validSha(entry.sha256)) fail("BACKUP_MANIFEST_INVALID", "Source file checksum is invalid");
    }
  }
  if (!snapshot.present && snapshot.entries.length !== 0) {
    fail("BACKUP_MANIFEST_INVALID", "Absent source tree has entries");
  }
  const aggregate = snapshot.present
    ? sha256(stableJson(snapshot.entries))
    : sha256("absent");
  if (snapshot.sha256 !== aggregate) {
    fail("BACKUP_MANIFEST_INVALID", "Source tree aggregate checksum is invalid");
  }
  return true;
}

function validateManifest(
  value: unknown,
  envelope: UnsignedEnvelope,
): BackupManifest {
  const manifest = jsonObject(value, "BACKUP_MANIFEST_INVALID");
  if (
    manifest.format !== backupPackageFormat ||
    manifest.version !== backupPackageFormatVersion ||
    manifest.backupId !== envelope.backupId ||
    typeof manifest.createdAt !== "string" ||
    !Number.isFinite(Date.parse(manifest.createdAt)) ||
    !Array.isArray(manifest.entries)
  ) fail("BACKUP_MANIFEST_INVALID", "Encrypted backup manifest is invalid");
  const captureMode = manifest.captureMode === "locked-exact"
    ? "locked-exact"
    : manifest.captureMode === "external-unverified" ||
        manifest.captureMode === undefined
      ? "external-unverified"
      : fail("BACKUP_MANIFEST_INVALID", "Backup capture mode is invalid");
  if (manifest.entries.length > 1_000_000) {
    fail("BACKUP_MANIFEST_INVALID", "Encrypted backup has too many entries");
  }
  const entryIds = new Set<string>();
  const paths = new Set<string>();
  const entries: EncryptedEntry[] = manifest.entries.map((raw) => {
    const entry = jsonObject(raw, "BACKUP_MANIFEST_INVALID");
    if (
      !validUuid(entry.entryId) ||
      !["database", "library", "media", "oss", "secret"].includes(
        String(entry.kind),
      ) ||
      typeof entry.logicalPath !== "string" ||
      entry.objectFile !== `objects/${entry.entryId}.bin` ||
      !validSha(entry.ciphertextSha256) || !validSha(entry.plaintextSha256)
    ) fail("BACKUP_MANIFEST_INVALID", "Encrypted entry metadata is invalid");
    safeLogicalPath(entry.logicalPath);
    const secretName = entry.kind === "secret"
      ? entry.logicalPath.slice("secrets/".length)
      : "";
    const ossName = entry.kind === "oss"
      ? entry.logicalPath.slice("oss-mirrors/".length)
      : "";
    const allowedPath =
      (entry.kind === "database" && entry.logicalPath === "unboundry.sqlite") ||
      (entry.kind === "library" && entry.logicalPath === "library.sqlite") ||
      (entry.kind === "media" && entry.logicalPath.startsWith("media/")) ||
      (entry.kind === "secret" && entry.logicalPath === `secrets/${secretName}` &&
        restorableSecretFiles.has(secretName)) ||
      (entry.kind === "oss" && entry.logicalPath === `oss-mirrors/${ossName}` &&
        validUuid(ossName));
    if (!allowedPath || entryIds.has(entry.entryId) || paths.has(entry.logicalPath)) {
      fail("BACKUP_MANIFEST_INVALID", "Encrypted entry identity is invalid");
    }
    entryIds.add(entry.entryId);
    paths.add(entry.logicalPath);
    safeJsonInteger(entry.plaintextBytes, "Plaintext size");
    safeJsonInteger(entry.ciphertextBytes, "Ciphertext size");
    if (entry.plaintextBytes !== entry.ciphertextBytes) {
      fail("BACKUP_MANIFEST_INVALID", "Encrypted entry size is invalid");
    }
    const iv = canonicalBase64(entry.iv, "Entry IV");
    const tag = canonicalBase64(entry.tag, "Entry tag");
    try {
      if (iv.length !== 12 || tag.length !== 16) {
        fail("BACKUP_MANIFEST_INVALID", "Encrypted entry cryptography is invalid");
      }
    } finally {
      iv.fill(0);
      tag.fill(0);
    }
    return Object.freeze({
      ciphertextBytes: entry.ciphertextBytes as number,
      ciphertextSha256: entry.ciphertextSha256 as string,
      entryId: entry.entryId,
      iv: entry.iv as string,
      kind: entry.kind as EncryptedEntryKind,
      logicalPath: entry.logicalPath,
      objectFile: entry.objectFile as string,
      plaintextBytes: entry.plaintextBytes as number,
      plaintextSha256: entry.plaintextSha256 as string,
      tag: entry.tag as string,
    });
  });
  const database = jsonObject(manifest.database, "BACKUP_MANIFEST_INVALID");
  const databaseEntries = entries.filter((entry) => entry.kind === "database");
  const libraryEntries = entries.filter((entry) => entry.kind === "library");
  if (
    !validUuid(database.entryId) ||
    databaseEntries.length !== 1 ||
    databaseEntries[0]?.entryId !== database.entryId
  ) fail("BACKUP_MANIFEST_INVALID", "Backup database entry is invalid");
  if (libraryEntries.length > 1) {
    fail("BACKUP_MANIFEST_INVALID", "Backup Library entry is duplicated");
  }
  const inspection = jsonObject(database.inspection, "BACKUP_MANIFEST_INVALID");
  if (
    typeof inspection.userVersion !== "number" ||
    !supportedBackupSchemaVersions.has(inspection.userVersion) ||
    !validSha(inspection.logicalSha256) ||
    !Array.isArray(inspection.tables) || !Array.isArray(inspection.migrationLedger)
  ) fail("BACKUP_MANIFEST_INVALID", "Backup database inspection is invalid");
  const source = jsonObject(manifest.source, "BACKUP_MANIFEST_INVALID");
  for (const name of [
    "databaseAfter", "databaseBefore", "mediaAfter", "mediaBefore",
    "secretsAfter", "secretsBefore",
  ]) validTreeSnapshot(source[name]);
  if (
    stableJson(source.databaseAfter) !== stableJson(source.databaseBefore) ||
    stableJson(source.mediaAfter) !== stableJson(source.mediaBefore) ||
    stableJson(source.secretsAfter) !== stableJson(source.secretsBefore)
  ) fail("BACKUP_MANIFEST_INVALID", "Backup source was not stable");
  const sourceValue = source as BackupManifest["source"];
  const expectedMediaFiles = new Map(sourceValue.mediaBefore.entries
    .filter((entry) => entry.kind === "file")
    .map((entry) => [`media/${entry.path}`, entry]));
  const expectedSecretFiles = new Map(sourceValue.secretsBefore.entries
    .filter((entry) => entry.kind === "file")
    .map((entry) => [`secrets/${entry.path}`, entry]));
  if (sourceValue.secretsBefore.entries.some((entry) =>
    entry.kind !== "file" || !restorableSecretFiles.has(entry.path))) {
    fail("BACKUP_MANIFEST_INVALID", "Backup contains a non-restorable secret path");
  }
  const encryptedMedia = entries.filter((entry) => entry.kind === "media");
  const encryptedSecrets = entries.filter((entry) => entry.kind === "secret");
  if (
    encryptedMedia.length !== expectedMediaFiles.size ||
    encryptedSecrets.length !== expectedSecretFiles.size
  ) fail("BACKUP_MANIFEST_INVALID", "Backup file inventory is incomplete");
  for (const entry of [...encryptedMedia, ...encryptedSecrets]) {
    const expected = entry.kind === "media"
      ? expectedMediaFiles.get(entry.logicalPath)
      : expectedSecretFiles.get(entry.logicalPath);
    if (
      !expected || expected.size !== entry.plaintextBytes ||
      expected.sha256 !== entry.plaintextSha256
    ) fail("BACKUP_MANIFEST_INVALID", "Backup file fingerprint is inconsistent");
  }
  const media = jsonObject(manifest.media, "BACKUP_MANIFEST_INVALID");
  if (!Array.isArray(media.localReady) || !Array.isArray(media.ossReady)) {
    fail("BACKUP_MANIFEST_INVALID", "Backup media evidence is invalid");
  }
  const entryByPath = new Map(entries.map((entry) => [entry.logicalPath, entry]));
  const localReady: LocalMediaBinding[] = [];
  const localIdentities = new Set<string>();
  for (const raw of media.localReady) {
    const binding = jsonObject(raw, "BACKUP_MANIFEST_INVALID");
    exactKeys(binding, [
      "byteSize", "checksumSha256", "id", "kind", "logicalPath",
      "metadataChecksumPresent", "storageName",
    ]);
    const byteSize = safeJsonInteger(binding.byteSize, "Local media size");
    if (
      !validSha(binding.checksumSha256) || typeof binding.id !== "string" || !binding.id ||
      typeof binding.kind !== "string" || !binding.kind ||
      typeof binding.logicalPath !== "string" ||
      typeof binding.storageName !== "string" || !binding.storageName ||
      typeof binding.metadataChecksumPresent !== "boolean" ||
      basename(binding.storageName) !== binding.storageName ||
      binding.logicalPath !== `media/${binding.storageName}`
    ) fail("BACKUP_MANIFEST_INVALID", "Local media evidence is invalid");
    safeLogicalPath(binding.logicalPath);
    const encrypted = entryByPath.get(binding.logicalPath);
    if (
      encrypted?.kind !== "media" || encrypted.plaintextBytes !== byteSize ||
      encrypted.plaintextSha256 !== binding.checksumSha256
    ) fail("BACKUP_MANIFEST_INVALID", "Local media evidence does not match its object");
    const identity = `${binding.kind}:${binding.id}`;
    if (localIdentities.has(identity)) {
      fail("BACKUP_MANIFEST_INVALID", "Local media evidence is duplicated");
    }
    localIdentities.add(identity);
    localReady.push(Object.freeze({
      byteSize,
      checksumSha256: binding.checksumSha256,
      id: binding.id,
      kind: binding.kind,
      logicalPath: binding.logicalPath,
      metadataChecksumPresent: binding.metadataChecksumPresent,
      storageName: binding.storageName,
    }));
  }
  const ossReady: OssMediaBinding[] = [];
  const ossIdentities = new Set<string>();
  const mirrorByObjectKey = new Map<string, Readonly<{
    checksumSha256: string;
    logicalPath: string;
    size: number;
    versionId: string;
  }>>();
  const usedOssPaths = new Set<string>();
  for (const raw of media.ossReady) {
    const binding = jsonObject(raw, "BACKUP_MANIFEST_INVALID");
    exactKeys(binding, [
      "byteSize", "checksumSha256", "id", "kind", "logicalPath", "objectKey",
      "storageProfileId", "versionId",
    ]);
    const byteSize = safeJsonInteger(binding.byteSize, "OSS media size");
    if (
      !validSha(binding.checksumSha256) || typeof binding.id !== "string" || !binding.id ||
      typeof binding.kind !== "string" || !binding.kind ||
      typeof binding.logicalPath !== "string" || typeof binding.objectKey !== "string" ||
      !binding.objectKey || binding.objectKey.length > 1_024 || binding.objectKey.includes("\0") ||
      (binding.storageProfileId !== null && typeof binding.storageProfileId !== "string") ||
      typeof binding.versionId !== "string" || !binding.versionId ||
      binding.versionId.length > 1_024 || binding.versionId.includes("\0")
    ) fail("BACKUP_MANIFEST_INVALID", "OSS media evidence is invalid");
    safeLogicalPath(binding.logicalPath);
    const encrypted = entryByPath.get(binding.logicalPath);
    if (
      encrypted?.kind !== "oss" || encrypted.plaintextBytes !== byteSize ||
      encrypted.plaintextSha256 !== binding.checksumSha256
    ) fail("BACKUP_MANIFEST_INVALID", "OSS media evidence does not match its object");
    const identity = `${binding.kind}:${binding.id}`;
    if (ossIdentities.has(identity)) {
      fail("BACKUP_MANIFEST_INVALID", "OSS media evidence is duplicated");
    }
    ossIdentities.add(identity);
    const mirror = Object.freeze({
      checksumSha256: binding.checksumSha256,
      logicalPath: binding.logicalPath,
      size: byteSize,
      versionId: binding.versionId,
    });
    const prior = mirrorByObjectKey.get(binding.objectKey);
    if (prior && stableJson(prior) !== stableJson(mirror)) {
      fail("BACKUP_MANIFEST_INVALID", "OSS object key has conflicting mirror evidence");
    }
    mirrorByObjectKey.set(binding.objectKey, mirror);
    usedOssPaths.add(binding.logicalPath);
    ossReady.push(Object.freeze({
      byteSize,
      checksumSha256: binding.checksumSha256,
      id: binding.id,
      kind: binding.kind,
      logicalPath: binding.logicalPath,
      objectKey: binding.objectKey,
      storageProfileId: binding.storageProfileId,
      versionId: binding.versionId,
    }));
  }
  const encryptedOssPaths = entries
    .filter((entry) => entry.kind === "oss")
    .map((entry) => entry.logicalPath);
  if (
    encryptedOssPaths.length !== usedOssPaths.size ||
    mirrorByObjectKey.size !== usedOssPaths.size ||
    encryptedOssPaths.some((path) => !usedOssPaths.has(path))
  ) fail("BACKUP_MANIFEST_INVALID", "Backup contains an unbound OSS mirror object");
  const secrets = jsonObject(manifest.secrets, "BACKUP_MANIFEST_INVALID");
  const secretFileCount = safeJsonInteger(secrets.fileCount, "Secret file count");
  const secretValidation = jsonObject(secrets.validation, "BACKUP_MANIFEST_INVALID");
  exactKeys(secretValidation, [
    "accountCredentials", "masterKeyPresent", "providerDocumentProfiles",
    "storageDocumentProfiles",
  ]);
  if (
    secretFileCount !== encryptedSecrets.length ||
    typeof secretValidation.masterKeyPresent !== "boolean"
  ) fail("BACKUP_MANIFEST_INVALID", "Backup secret evidence is invalid");
  for (const name of [
    "accountCredentials", "providerDocumentProfiles", "storageDocumentProfiles",
  ]) safeJsonInteger(secretValidation[name], "Secret validation count");
  return Object.freeze({
    backupId: manifest.backupId as string,
    captureMode,
    createdAt: manifest.createdAt,
    database: Object.freeze({
      entryId: database.entryId,
      inspection: database.inspection as BackupDatabaseInspection,
    }),
    entries: Object.freeze(entries),
    format: backupPackageFormat,
    media: Object.freeze({
      localReady: Object.freeze(localReady),
      ossReady: Object.freeze(ossReady),
    }),
    secrets: Object.freeze({
      fileCount: secretFileCount,
      validation: Object.freeze({
        accountCredentials: secretValidation.accountCredentials as number,
        masterKeyPresent: secretValidation.masterKeyPresent,
        providerDocumentProfiles: secretValidation.providerDocumentProfiles as number,
        storageDocumentProfiles: secretValidation.storageDocumentProfiles as number,
      }),
    }),
    source: sourceValue,
    version: backupPackageFormatVersion,
  });
}

async function validatePackageInventory(
  packageDirectory: string,
  manifest: BackupManifest,
) {
  const root = await lstat(packageDirectory);
  if (
    root.isSymbolicLink() || !root.isDirectory() ||
    (root.mode & 0o077) !== 0
  ) fail("BACKUP_PACKAGE_INVENTORY_INVALID", "Backup package directory is not private");
  const topLevel = (await readdir(packageDirectory)).sort((left, right) =>
    left.localeCompare(right));
  const expectedTopLevel = ["envelope.json", "manifest.bin", "objects"];
  if (
    topLevel.length !== expectedTopLevel.length ||
    topLevel.some((name, index) => name !== expectedTopLevel[index])
  ) fail("BACKUP_PACKAGE_INVENTORY_INVALID", "Backup package has extra or missing entries");
  for (const name of ["envelope.json", "manifest.bin"]) {
    const details = await lstat(join(packageDirectory, name));
    if (
      details.isSymbolicLink() || !details.isFile() ||
      (details.mode & 0o077) !== 0
    ) fail("BACKUP_PACKAGE_INVENTORY_INVALID", "Backup package metadata is not a private file");
  }
  const objectsDirectory = join(packageDirectory, "objects");
  const objectsDetails = await lstat(objectsDirectory);
  if (
    objectsDetails.isSymbolicLink() || !objectsDetails.isDirectory() ||
    (objectsDetails.mode & 0o077) !== 0
  ) fail("BACKUP_PACKAGE_INVENTORY_INVALID", "Backup object directory is not private");
  const expectedObjects = new Map(manifest.entries.map((entry) => [
    basename(entry.objectFile),
    entry,
  ]));
  const objectNames = (await readdir(objectsDirectory)).sort((left, right) =>
    left.localeCompare(right));
  if (
    objectNames.length !== expectedObjects.size ||
    objectNames.some((name) => !expectedObjects.has(name))
  ) fail("BACKUP_PACKAGE_INVENTORY_INVALID", "Backup package has missing or extra objects");
  for (const name of objectNames) {
    const entry = expectedObjects.get(name);
    if (!entry) fail("BACKUP_PACKAGE_INVENTORY_INVALID", "Backup object is unrecognized");
    const details = await lstat(join(objectsDirectory, name), { bigint: true });
    if (
      details.isSymbolicLink() || !details.isFile() ||
      (Number(details.mode) & 0o077) !== 0 ||
      details.size !== BigInt(entry.ciphertextBytes)
    ) fail("BACKUP_PACKAGE_INVENTORY_INVALID", "Backup object metadata is invalid");
  }
}

async function openEncryptedPackage(options: VerifyEncryptedBackupOptions) {
  const packageDirectory = normalizedAbsolute(options.packageDirectory, "Package directory");
  await ensureTrustedDataRoot(packageDirectory);
  try {
    const marker = await lstat(join(packageDirectory, backupIncompleteMarker));
    if (marker) {
      fail("BACKUP_PACKAGE_INCOMPLETE", "Backup package publication is incomplete");
    }
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }
  const signed = await readSignedEnvelope(packageDirectory, options.trustedSigningPublicKey);
  const encryptedManifest = await inspectRegularFile(
    join(packageDirectory, "manifest.bin"),
    "manifest.bin",
    manifestMaximumBytes,
  );
  if (
    encryptedManifest.size !== signed.envelope.manifest.ciphertextBytes ||
    encryptedManifest.sha256 !== signed.envelope.manifest.ciphertextSha256
  ) fail("BACKUP_MANIFEST_CIPHERTEXT_INVALID", "Encrypted manifest checksum is invalid");
  const recipient = recoveryPrivateKey(options.recoveryPrivateKey);
  if (keyFingerprint(recipient) !== signed.envelope.recipientKeySha256) {
    fail("BACKUP_RECOVERY_KEY_MISMATCH", "Recovery key does not match this backup");
  }
  const wrapped = canonicalBase64(signed.envelope.wrappedKey, "Wrapped backup key");
  let dek: Buffer;
  try {
    dek = privateDecrypt({
      key: recipient,
      oaepHash: "sha256",
      oaepLabel: Buffer.from(signed.envelope.backupId, "utf8"),
      padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING,
    }, wrapped);
  } catch {
    wrapped.fill(0);
    fail("BACKUP_KEY_UNWRAP_FAILED", "Backup data key could not be unwrapped");
  }
  wrapped.fill(0);
  if (dek.length !== 32) {
    dek.fill(0);
    fail("BACKUP_KEY_UNWRAP_FAILED", "Backup data key has the wrong length");
  }
  let key: Buffer | undefined;
  let plaintext: Buffer | undefined;
  try {
    key = entryKey(dek, signed.envelope.backupId, "manifest");
    const { value: ciphertext } = await readBoundedRegularFile(
      join(packageDirectory, "manifest.bin"),
      "manifest.bin",
      manifestMaximumBytes,
    );
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, signed.iv, {
        authTagLength: 16,
      });
      decipher.setAAD(entryAad(signed.envelope.backupId, "manifest", "manifest", "manifest"));
      decipher.setAuthTag(signed.tag);
      let updated: Buffer | undefined;
      let final: Buffer | undefined;
      try {
        updated = decipher.update(ciphertext);
        final = decipher.final();
        plaintext = Buffer.concat([updated, final]);
      } finally {
        updated?.fill(0);
        final?.fill(0);
      }
    } catch {
      fail("BACKUP_MANIFEST_AUTHENTICATION_FAILED", "Encrypted manifest authentication failed");
    } finally {
      ciphertext.fill(0);
    }
    let value: unknown;
    try {
      value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext));
    } catch {
      fail("BACKUP_MANIFEST_INVALID", "Encrypted backup manifest is invalid");
    }
    const manifest = validateManifest(value, signed.envelope);
    await validatePackageInventory(packageDirectory, manifest);
    return { dek, manifest, packageDirectory };
  } catch (error) {
    dek.fill(0);
    throw error;
  } finally {
    key?.fill(0);
    plaintext?.fill(0);
    signed.iv.fill(0);
    signed.tag.fill(0);
  }
}

async function decryptEntry(
  entry: EncryptedEntry,
  packageDirectory: string,
  destinationRoot: string,
  dek: Buffer,
  backupId: string,
) {
  const sourcePath = join(packageDirectory, ...entry.objectFile.split("/"));
  const sourceEvidence = await inspectRegularFile(
    sourcePath,
    entry.objectFile,
    entry.ciphertextBytes,
  );
  if (
    sourceEvidence.size !== entry.ciphertextBytes ||
    sourceEvidence.sha256 !== entry.ciphertextSha256
  ) fail("BACKUP_OBJECT_CHECKSUM_INVALID", "Encrypted backup object checksum is invalid");
  const destination = join(destinationRoot, ...entry.logicalPath.split("/"));
  await mkdir(dirname(destination), { mode: 0o700, recursive: true });
  const noFollow = "O_NOFOLLOW" in fileConstants ? fileConstants.O_NOFOLLOW : 0;
  const input = await open(sourcePath, fileConstants.O_RDONLY | noFollow);
  let output: Awaited<ReturnType<typeof open>> | undefined;
  let key: Buffer | undefined;
  let iv: Buffer | undefined;
  let tag: Buffer | undefined;
  let buffer: Buffer | undefined;
  let final: Buffer | undefined;
  try {
    const opened = await input.stat({ bigint: true });
    if (
      !opened.isFile() || String(opened.dev) !== sourceEvidence.dev ||
      String(opened.ino) !== sourceEvidence.ino || Number(opened.size) !== sourceEvidence.size ||
      opened.mtimeNs.toString() !== sourceEvidence.mtimeNs ||
      opened.ctimeNs.toString() !== sourceEvidence.ctimeNs
    ) fail("BACKUP_PACKAGE_CHANGED", "Backup object changed while opening");
    output = await open(destination, "wx", 0o600);
    key = entryKey(dek, backupId, entry.entryId);
    iv = canonicalBase64(entry.iv, "Entry IV");
    tag = canonicalBase64(entry.tag, "Entry tag");
    const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
    decipher.setAAD(entryAad(backupId, entry.entryId, entry.kind, entry.logicalPath));
    decipher.setAuthTag(tag);
    const cipherHash = createHash("sha256");
    const plainHash = createHash("sha256");
    let cipherBytes = 0;
    let plainBytes = 0;
    let outputPosition = 0;
    buffer = Buffer.allocUnsafe(ioChunkBytes);
    let position = 0;
    while (position < entry.ciphertextBytes) {
      const { bytesRead } = await input.read(
        buffer,
        0,
        Math.min(buffer.length, entry.ciphertextBytes - position),
        position,
      );
      if (!bytesRead) fail("BACKUP_OBJECT_TRUNCATED", "Encrypted backup object is truncated");
      const encrypted = buffer.subarray(0, bytesRead);
      cipherHash.update(encrypted);
      cipherBytes += bytesRead;
      const plain = decipher.update(encrypted);
      try {
        if (plain.length) {
          outputPosition = await writeAll(output, plain, outputPosition);
          plainHash.update(plain);
          plainBytes += plain.length;
        }
      } finally {
        plain.fill(0);
      }
      position += bytesRead;
    }
    try {
      final = decipher.final();
    } catch {
      fail("BACKUP_OBJECT_AUTHENTICATION_FAILED", "Encrypted backup object authentication failed");
    }
    try {
      if (final.length) {
        outputPosition = await writeAll(output, final, outputPosition);
        plainHash.update(final);
        plainBytes += final.length;
      }
    } finally {
      final.fill(0);
      final = undefined;
    }
    const after = await input.stat({ bigint: true });
    if (
      !after.isFile() || after.dev !== opened.dev || after.ino !== opened.ino ||
      after.size !== opened.size || after.mtimeNs !== opened.mtimeNs ||
      after.ctimeNs !== opened.ctimeNs
    ) fail("BACKUP_PACKAGE_CHANGED", "Backup object changed while decrypting");
    if (
      cipherBytes !== entry.ciphertextBytes || plainBytes !== entry.plaintextBytes ||
      outputPosition !== entry.plaintextBytes ||
      cipherHash.digest("hex") !== entry.ciphertextSha256 ||
      plainHash.digest("hex") !== entry.plaintextSha256
    ) fail("BACKUP_OBJECT_CHECKSUM_INVALID", "Backup object plaintext does not match its manifest");
    await output.sync();
    await chmod(destination, 0o600);
  } finally {
    buffer?.fill(0);
    final?.fill(0);
    key?.fill(0);
    iv?.fill(0);
    tag?.fill(0);
    await output?.close().catch(() => undefined);
    await input.close().catch(() => undefined);
  }
}

function contentInventory(snapshot: TreeSnapshot) {
  return snapshot.entries.map((entry) => entry.kind === "file"
    ? { kind: entry.kind, path: entry.path, sha256: entry.sha256, size: entry.size }
    : { kind: entry.kind, path: entry.path });
}

function publishPayloadInventory(snapshot: TreeSnapshot, markerName: string) {
  return snapshot.entries
    .filter((entry) => entry.path !== markerName)
    .map((entry) => entry.kind === "file"
      ? {
          kind: entry.kind,
          mode: entry.mode & 0o777,
          path: entry.path,
          sha256: entry.sha256,
          size: entry.size,
        }
      : {
          kind: entry.kind,
          mode: entry.mode & 0o777,
          path: entry.path,
        });
}

async function publishTreeNoReplace(
  sourceDirectory: string,
  targetDirectory: string,
  conflictCode: string,
): Promise<void> {
  const entries = (await readdir(sourceDirectory)).sort((left, right) =>
    left.localeCompare(right));
  for (const name of entries) {
    const source = join(sourceDirectory, name);
    const target = join(targetDirectory, name);
    const details = await lstat(source);
    if (details.isSymbolicLink()) {
      fail(conflictCode, "Publish staging tree contains a link");
    }
    if (details.isDirectory()) {
      try {
        await mkdir(target, { mode: details.mode & 0o777 });
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "EEXIST") {
          fail(conflictCode, "Publish destination already contains a path");
        }
        throw error;
      }
      await chmod(target, details.mode & 0o777);
      await publishTreeNoReplace(source, target, conflictCode);
      await rmdir(source);
      continue;
    }
    if (!details.isFile()) {
      fail(conflictCode, "Publish staging tree contains a special file");
    }
    try {
      await link(source, target);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EEXIST") {
        fail(conflictCode, "Publish destination already contains a path");
      }
      throw error;
    }
    await unlink(source);
  }
}

async function createRecordedDirectories(
  destinationRoot: string,
  prefix: "media" | "secrets",
  snapshot: TreeSnapshot,
) {
  await mkdir(join(destinationRoot, prefix), { mode: 0o700, recursive: true });
  for (const entry of snapshot.entries) {
    if (entry.kind === "directory") {
      await mkdir(join(destinationRoot, prefix, ...entry.path.split("/")), {
        mode: 0o700,
        recursive: true,
      });
    }
  }
}

/**
 * Applies the exact database gate used immediately after package decryption.
 * Kept as one boundary so supported historic packages and current packages
 * cannot diverge between direct inspection and verify/restore materialization.
 */
export function validateMaterializedBackupDatabase(
  databasePath: string,
  destinationRoot: string,
  expectedInspection: BackupDatabaseInspection,
) {
  const actualInspection = inspectBackupDatabase(databasePath, destinationRoot);
  if (stableJson(actualInspection) !== stableJson(expectedInspection)) {
    fail(
      "BACKUP_DATABASE_FINGERPRINT_MISMATCH",
      "Restored database fingerprint does not match",
    );
  }
  return actualInspection;
}

async function materializeAndValidate(
  opened: Awaited<ReturnType<typeof openEncryptedPackage>>,
  destinationRoot: string,
  callback: BackupCheckpoint | undefined,
) {
  const { dek, manifest, packageDirectory } = opened;
  try {
    await createRecordedDirectories(destinationRoot, "media", manifest.source.mediaBefore);
    await createRecordedDirectories(destinationRoot, "secrets", manifest.source.secretsBefore);
    await mkdir(join(destinationRoot, "oss-mirrors"), { mode: 0o700, recursive: true });
    const databaseEntry = manifest.entries.find((entry) => entry.kind === "database");
    if (!databaseEntry) fail("BACKUP_MANIFEST_INVALID", "Backup database entry is missing");
    await decryptEntry(databaseEntry, packageDirectory, destinationRoot, dek, manifest.backupId);
    const databasePath = join(destinationRoot, "unboundry.sqlite");
    const databaseInspection = validateMaterializedBackupDatabase(
      databasePath,
      destinationRoot,
      manifest.database.inspection,
    );
    const libraryEntry = manifest.entries.find((entry) =>
      entry.kind === "library"
    );
    if (libraryEntry) {
      await decryptEntry(
        libraryEntry,
        packageDirectory,
        destinationRoot,
        dek,
        manifest.backupId,
      );
      try {
        validateLibraryBackupDatabase(join(destinationRoot, "library.sqlite"));
      } catch {
        fail(
          "BACKUP_LIBRARY_FINGERPRINT_MISMATCH",
          "Restored Library database is invalid",
        );
      }
    }
    await checkpoint(callback, "after-restore-database");

    for (const entry of manifest.entries.filter((candidate) =>
      candidate.kind === "media" || candidate.kind === "oss")) {
      await decryptEntry(entry, packageDirectory, destinationRoot, dek, manifest.backupId);
    }
    const restoredMedia = await fingerprintTree(join(destinationRoot, "media"), false);
    if (
      stableJson(contentInventory(restoredMedia)) !==
      stableJson(contentInventory(manifest.source.mediaBefore))
    ) fail("BACKUP_MEDIA_INVENTORY_MISMATCH", "Restored media inventory does not match");
    const mirrorInputs: MirrorEvidence[] = [];
    const mirrorLogicalPaths = new Map<string, string>();
    for (const binding of manifest.media.ossReady) {
      if (mirrorLogicalPaths.has(binding.objectKey)) continue;
      const filePath = join(destinationRoot, ...binding.logicalPath.split("/"));
      mirrorInputs.push(Object.freeze({
        evidence: await inspectRegularFile(filePath, basename(filePath)),
        filePath,
        objectKey: binding.objectKey,
        versionId: binding.versionId,
      }));
      mirrorLogicalPaths.set(binding.objectKey, binding.logicalPath);
    }
    const restoredMediaValidation = await validateMedia(
      databasePath,
      join(destinationRoot, "media"),
      restoredMedia,
      mirrorInputs,
      mirrorLogicalPaths,
    );
    if (stableJson(restoredMediaValidation) !== stableJson(manifest.media)) {
      fail("BACKUP_MEDIA_FINGERPRINT_MISMATCH", "Restored media evidence does not match");
    }
    await checkpoint(callback, "after-restore-media");

    for (const entry of manifest.entries.filter((candidate) => candidate.kind === "secret")) {
      await decryptEntry(entry, packageDirectory, destinationRoot, dek, manifest.backupId);
    }
    const restoredSecrets = await fingerprintTree(join(destinationRoot, "secrets"), false);
    if (
      stableJson(contentInventory(restoredSecrets)) !==
      stableJson(contentInventory(manifest.source.secretsBefore))
    ) fail("BACKUP_SECRET_INVENTORY_MISMATCH", "Restored secret inventory does not match");
    const secretContext = await validateBackupSecretsWithContext(
      databasePath,
      join(destinationRoot, "secrets"),
      destinationRoot,
    );
    const secretValidation = secretContext.validation;
    if (
      stableJson(secretValidation) !== stableJson(manifest.secrets.validation) ||
      manifest.secrets.fileCount !==
        manifest.entries.filter((entry) => entry.kind === "secret").length
    ) fail("BACKUP_SECRET_VALIDATION_MISMATCH", "Restored secret validation does not match");
    const mediaIntegrity = requireCompleteMediaIntegrity(inspectBackupMediaIntegrity(
      databasePath,
      databaseInspection,
      restoredMedia,
      mirrorInputs,
      secretContext.storageProfileIds,
    ));
    const recoveryEntries = new Map<string, {
      byteSize: number;
      checksumSha256: string;
      logicalPath: string;
      objectKey: string;
      storageProfileId: string | null;
      versionId: string;
    }>();
    for (const binding of manifest.media.ossReady) {
      const recoveryEntry = Object.freeze({
        byteSize: binding.byteSize,
        checksumSha256: binding.checksumSha256,
        logicalPath: binding.logicalPath,
        objectKey: binding.objectKey,
        storageProfileId: binding.storageProfileId,
        versionId: binding.versionId,
      });
      const prior = recoveryEntries.get(binding.logicalPath);
      if (prior && stableJson(prior) !== stableJson(recoveryEntry)) {
        fail(
          "BACKUP_OSS_RECOVERY_INDEX_CONFLICT",
          "OSS recovery index contains conflicting bindings",
        );
      }
      recoveryEntries.set(binding.logicalPath, recoveryEntry);
    }
    const recoveryIndex = createFakeOssRecoveryIndex({
      backupId: manifest.backupId,
      databaseLogicalSha256: databaseInspection.logicalSha256,
      entries: [...recoveryEntries.values()],
    });
    await writePrivateFile(
      join(destinationRoot, ossRecoveryIndexFileName),
      `${stableJson(recoveryIndex)}\n`,
    );
    await checkpoint(callback, "after-restore-secrets");
    await syncDirectory(destinationRoot);
    return summaryFromManifest(manifest, packageDirectory, mediaIntegrity);
  } finally {
    dek.fill(0);
  }
}

export async function verifyEncryptedBackup(
  options: VerifyEncryptedBackupOptions,
): Promise<BackupPackageSummary> {
  const packageDirectory = normalizedAbsolute(options.packageDirectory, "Package directory");
  const scratchRoot = normalizedAbsolute(options.scratchRoot ?? resolve(tmpdir()), "Scratch root");
  const canonicalPackage = await canonicalPotentialPath(packageDirectory);
  const canonicalScratchRoot = await canonicalPotentialPath(scratchRoot);
  if (containsPath(canonicalPackage, canonicalScratchRoot)) {
    fail("BACKUP_PATH_OVERLAP", "Verification scratch root may not be inside the package");
  }
  await ensureTrustedWorkRoot(scratchRoot, true);
  const scratch = await mkdtemp(join(scratchRoot, "unboundry-verify-"));
  try {
    assertDisjointPaths(canonicalPackage, await canonicalPotentialPath(scratch));
    await chmod(scratch, 0o700);
    const opened = await openEncryptedPackage(options);
    return await materializeAndValidate(opened, scratch, options.onCheckpoint);
  } catch (error) {
    return rethrowPackageFailure(
      error,
      "BACKUP_VERIFY_FAILED",
      "Encrypted backup verification failed",
    );
  } finally {
    try {
      await rm(scratch, { force: true, recursive: true });
    } catch {
      fail("BACKUP_CLEANUP_FAILED", "Backup verification cleanup failed");
    }
  }
}

export async function restoreEncryptedBackup(
  options: RestoreEncryptedBackupOptions,
): Promise<BackupPackageSummary> {
  const packageDirectory = normalizedAbsolute(options.packageDirectory, "Package directory");
  const targetDirectory = normalizedAbsolute(options.targetDirectory, "Restore target");
  assertDisjointPaths(packageDirectory, targetDirectory);
  assertDisjointPaths(
    await canonicalPotentialPath(packageDirectory),
    await canonicalPotentialPath(targetDirectory),
  );
  const parent = dirname(targetDirectory);
  await ensureTrustedWorkRoot(parent);
  try {
    await lstat(targetDirectory);
    fail("BACKUP_RESTORE_TARGET_EXISTS", "Restore target must not exist");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  let stage: string | undefined;
  let targetIdentity: OwnedPathIdentity | undefined;
  let markerIdentity: OwnedPathIdentity | undefined;
  try {
    stage = await mkdtemp(join(parent, `.${basename(targetDirectory)}.restore-`));
    await chmod(stage, 0o700);
    const opened = await openEncryptedPackage(options);
    const result = await materializeAndValidate(opened, stage, options.onCheckpoint);
    await syncDirectoryTree(stage);
    await checkpoint(options.onCheckpoint, "before-restore-publish");
    try {
      await mkdir(targetDirectory, { mode: 0o700 });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EEXIST") {
        fail("BACKUP_RESTORE_TARGET_EXISTS", "Restore target appeared during restore");
      }
      throw error;
    }
    targetIdentity = await directoryIdentity(targetDirectory);
    const markerPath = join(targetDirectory, restoreIncompleteMarker);
    const stageIdentity = await directoryIdentity(
      stage,
      "BACKUP_RESTORE_TARGET_CHANGED",
    );
    await writeReservationMarker(
      markerPath,
      reservationMarker(
        "restore",
        result.backupId,
        result.databaseLogicalSha256,
        targetDirectory,
        stage,
        stageIdentity,
      ),
    );
    markerIdentity = await regularFileIdentity(
      markerPath,
      "BACKUP_RESTORE_TARGET_CHANGED",
    );
    await syncDirectory(targetDirectory);
    await checkpoint(options.onCheckpoint, "after-restore-reservation");
    await assertPublishReservation(
      targetDirectory,
      restoreIncompleteMarker,
      targetIdentity,
      markerIdentity,
      "BACKUP_RESTORE_TARGET_CHANGED",
    );
    const stagedInventory = publishPayloadInventory(
      await fingerprintTree(stage, true),
      restoreIncompleteMarker,
    );
    const topLevelEntries = (await readdir(stage)).sort((left, right) =>
      left.localeCompare(right));
    if (topLevelEntries.includes(restoreIncompleteMarker)) {
      fail("BACKUP_RESTORE_TARGET_CHANGED", "Restore payload contains its commit marker");
    }
    await publishTreeNoReplace(
      stage,
      targetDirectory,
      "BACKUP_RESTORE_TARGET_CHANGED",
    );
    await rmdir(stage);
    stage = undefined;
    await assertPublishReservation(
      targetDirectory,
      restoreIncompleteMarker,
      targetIdentity,
      markerIdentity,
      "BACKUP_RESTORE_TARGET_CHANGED",
    );
    const restoredInventory = publishPayloadInventory(
      await fingerprintTree(targetDirectory, true),
      restoreIncompleteMarker,
    );
    if (stableJson(restoredInventory) !== stableJson(stagedInventory)) {
      fail("BACKUP_RESTORE_TARGET_CHANGED", "Restore target contains foreign paths");
    }
    await syncDirectoryTree(targetDirectory);
    await unlink(markerPath);
    markerIdentity = undefined;
    await syncDirectory(targetDirectory);
    await syncDirectory(parent);
    return result;
  } catch (error) {
    return rethrowPackageFailure(
      error,
      "BACKUP_RESTORE_FAILED",
      "Encrypted backup restore failed",
    );
  } finally {
    if (stage) {
      try {
        await rm(stage, { force: true, recursive: true });
      } catch {
        fail("BACKUP_CLEANUP_FAILED", "Backup restore staging cleanup failed");
      }
    }
    // Once the exclusive target reservation exists, failure deliberately
    // leaves its marker in place. This avoids any check-then-delete race with
    // a foreign path and makes every partial restore fail closed at readiness.
  }
}
