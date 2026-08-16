import { createHash } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
  type BigIntStats,
} from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import {
  createLegacyRuntimeLauncher,
  LegacyRuntimeTerminationUnknownError,
  type LegacyRuntimeLauncher,
  type LegacyRuntimeProcess,
  type LegacyRuntimeTarget,
} from "./legacyRuntimeLauncher.ts";

const defaultShutdownDeadlineMs = 10_000;
const generationDrainPollMs = 100;
const maximumStableWalBytes = 256 * 1_024 * 1_024;
const stableWalHashDeadlineMs = 5_000;
const stableWalHashBufferBytes = 1 * 1_024 * 1_024;

export type LegacyRuntimeSupervisorState =
  | "failed"
  | "idle"
  | "ready"
  | "starting"
  | "stopped"
  | "stopping";

export type LegacyActiveTaskObservationPhase =
  | "ACTIVE_POST_WARMUP"
  | "ACTIVE_PRELAUNCH"
  | "ACTIVE_SHUTDOWN"
  | "ACTIVE_STANDALONE";

export type LegacyMediaObservationPhase =
  | "MEDIA_POST_WARMUP"
  | "MEDIA_STANDALONE";

type LegacyDatabaseObservationPhase =
  | LegacyActiveTaskObservationPhase
  | LegacyMediaObservationPhase;

export type LegacyRuntimeSupervisorOptions = Readonly<{
  activeGenerationTasks?: (
    phase: LegacyActiveTaskObservationPhase,
    inspection?: LegacyActiveTaskInspectionOptions,
  ) => number;
  dataDirectory: string;
  legacyMediaMetadataComplete?: (phase: LegacyMediaObservationPhase) => boolean;
  launcher?: LegacyRuntimeLauncher;
  legacyRoot: string;
  runtimeDirectory: string;
  shutdownDeadlineMs?: number;
}>;

export type LegacyActiveTaskInspectionOptions = Readonly<{
  settleStableWalTimestamp?: boolean;
  stableWalDeadlineAt?: number;
}>;

function boundedDeadline(value: number | undefined, allowZero = false) {
  if (!Number.isFinite(value)) return defaultShutdownDeadlineMs;
  return Math.min(
    120_000,
    Math.max(allowZero ? 0 : 1_000, Math.trunc(value!)),
  );
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function childHasExited(runtime: LegacyRuntimeProcess) {
  return runtime.child.exitCode !== null || runtime.child.signalCode !== null;
}

/**
 * The exact runtime starts Provider work outside the lifetime of its enqueue
 * HTTP response. Its durable task state is therefore the conservative drain
 * boundary: the parent freezes HTTP first, then waits until no active task is
 * left before asking Vite to close and releasing the active lease.
 */
type LegacyFileFingerprint = Readonly<{
  ctimeNs: bigint;
  dev: bigint;
  ino: bigint;
  mode: bigint;
  mtimeNs: bigint;
  nlink: bigint;
  size: bigint;
  uid: bigint;
}>;

type LegacyDatabaseFingerprint = Readonly<{
  database: LegacyFileFingerprint;
  directory: LegacyFileFingerprint;
  shm?: LegacyFileFingerprint;
  wal?: LegacyFileFingerprint;
  walContentSha256?: string;
}>;

type LegacyObservationCleanup = Readonly<{
  admitStableWalTimestamp?: boolean;
  close: () => void;
  dataDirectory: string;
  fingerprint: LegacyDatabaseFingerprint;
  phase: LegacyDatabaseObservationPhase;
  stableWalDeadlineAt?: number;
}>;

export type LegacyFingerprintComponent =
  | "DATABASE"
  | "DIRECTORY"
  | "JOURNAL"
  | "SHM"
  | "WAL";

export type LegacyFingerprintChangeClass =
  | "CONTENT_METADATA"
  | "IDENTITY"
  | "PRESENCE";

type LegacyFingerprintDifference = Readonly<{
  changeClass: LegacyFingerprintChangeClass;
  component: LegacyFingerprintComponent;
}>;

export class LegacyRuntimeDatabaseChangedError extends Error {
  readonly changeClass: LegacyFingerprintChangeClass;
  readonly component: LegacyFingerprintComponent;
  readonly phase: LegacyDatabaseObservationPhase;

  constructor(
    phase: LegacyDatabaseObservationPhase,
    difference: LegacyFingerprintDifference,
  ) {
    super(
      `LEGACY_RUNTIME_DATABASE_CHANGED:${phase}:${difference.component}:${difference.changeClass}`,
    );
    this.name = "LegacyRuntimeDatabaseChangedError";
    this.phase = phase;
    this.component = difference.component;
    this.changeClass = difference.changeClass;
  }
}

class LegacyFingerprintMissingError extends Error {
  constructor() {
    super("LEGACY_RUNTIME_FINGERPRINT_MISSING");
    this.name = "LegacyFingerprintMissingError";
  }
}

type LegacyTaggedFingerprint = Readonly<
  | { state: "MISSING" }
  | { fingerprint: LegacyFileFingerprint; state: "PRESENT" }
  | { state: "UNSAFE" }
>;

function fixedFingerprint(path: string, kind: "directory" | "file") {
  let details: BigIntStats;
  try {
    details = lstatSync(path, { bigint: true });
  } catch (error) {
    if (
      error && typeof error === "object" && "code" in error &&
      error.code === "ENOENT"
    ) throw new LegacyFingerprintMissingError();
    // Native filesystem errors include the inspected path. The supervisor's
    // public failure is deliberately bounded and path-free.
    throw new Error("LEGACY_RUNTIME_DATABASE_UNSAFE");
  }
  if (
    details.isSymbolicLink() ||
    (kind === "directory" ? !details.isDirectory() : !details.isFile()) ||
    (kind === "file" && details.nlink !== 1n) ||
    typeof process.getuid !== "function" ||
    details.uid !== BigInt(process.getuid()) || (details.mode & 0o022n) !== 0n
  ) throw new Error("LEGACY_RUNTIME_DATABASE_UNSAFE");
  return Object.freeze({
    ctimeNs: details.ctimeNs,
    dev: details.dev,
    ino: details.ino,
    mode: details.mode,
    mtimeNs: details.mtimeNs,
    nlink: details.nlink,
    size: details.size,
    uid: details.uid,
  });
}

function optionalFingerprint(path: string) {
  try {
    return fixedFingerprint(path, "file");
  } catch (error) {
    if (error instanceof LegacyFingerprintMissingError) return undefined;
    if (error instanceof Error && error.message === "LEGACY_RUNTIME_DATABASE_UNSAFE") {
      throw error;
    }
    throw new Error("LEGACY_RUNTIME_DATABASE_UNSAFE");
  }
}

function taggedFingerprint(
  path: string,
  kind: "directory" | "file" = "file",
): LegacyTaggedFingerprint {
  try {
    const fingerprint = kind === "directory"
      ? fixedFingerprint(path, "directory")
      : optionalFingerprint(path);
    return fingerprint
      ? Object.freeze({ fingerprint, state: "PRESENT" } as const)
      : Object.freeze({ state: "MISSING" } as const);
  } catch {
    return Object.freeze({ state: "UNSAFE" } as const);
  }
}

function fingerprintChangeClass(
  left: LegacyFileFingerprint | undefined,
  right: LegacyFileFingerprint | undefined,
  contentMetadata = true,
): LegacyFingerprintChangeClass | undefined {
  if (Boolean(left) !== Boolean(right)) return "PRESENCE";
  if (!left || !right) return undefined;
  if (
    left.dev !== right.dev || left.ino !== right.ino ||
    left.uid !== right.uid || left.mode !== right.mode ||
    left.nlink !== right.nlink
  ) return "IDENTITY";
  if (
    contentMetadata && (
      left.size !== right.size || left.mtimeNs !== right.mtimeNs ||
      left.ctimeNs !== right.ctimeNs
    )
  ) return "CONTENT_METADATA";
  return undefined;
}

function sameExactFingerprint(
  left: LegacyFileFingerprint | undefined,
  right: LegacyFileFingerprint | undefined,
) {
  return Boolean(left) === Boolean(right) && (!left || !right || (
    left.ctimeNs === right.ctimeNs && left.dev === right.dev &&
    left.ino === right.ino && left.mode === right.mode &&
    left.mtimeNs === right.mtimeNs && left.nlink === right.nlink &&
    left.size === right.size && left.uid === right.uid
  ));
}

function stableWalSha256(
  path: string,
  expected: LegacyFileFingerprint,
  requestedDeadlineAt?: number,
) {
  if (expected.size <= 0n || expected.size > BigInt(maximumStableWalBytes)) {
    throw new Error("LEGACY_RUNTIME_DATABASE_UNSAFE");
  }
  const startedAt = Date.now();
  const deadlineAt = Number.isFinite(requestedDeadlineAt)
    ? Math.min(
        startedAt + stableWalHashDeadlineMs,
        Math.trunc(requestedDeadlineAt!),
      )
    : startedAt + stableWalHashDeadlineMs;
  if (deadlineAt <= startedAt) {
    throw new Error("LEGACY_RUNTIME_DATABASE_UNSAFE");
  }
  let descriptor: number | undefined;
  let result: string | undefined;
  let failure: unknown;
  try {
    descriptor = openSync(
      path,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK,
    );
    const opened = fstatSync(descriptor, { bigint: true });
    const openedFingerprint = Object.freeze({
      ctimeNs: opened.ctimeNs,
      dev: opened.dev,
      ino: opened.ino,
      mode: opened.mode,
      mtimeNs: opened.mtimeNs,
      nlink: opened.nlink,
      size: opened.size,
      uid: opened.uid,
    });
    if (
      !opened.isFile() || opened.isSymbolicLink() ||
      !sameExactFingerprint(openedFingerprint, expected)
    ) throw new Error("LEGACY_RUNTIME_DATABASE_UNSAFE");
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(stableWalHashBufferBytes);
    let position = 0;
    const expectedBytes = Number(expected.size);
    while (position < expectedBytes) {
      if (Date.now() >= deadlineAt) {
        throw new Error("LEGACY_RUNTIME_DATABASE_UNSAFE");
      }
      const bytesRead = readSync(
        descriptor,
        buffer,
        0,
        Math.min(buffer.length, expectedBytes - position),
        position,
      );
      if (bytesRead <= 0) throw new Error("LEGACY_RUNTIME_DATABASE_UNSAFE");
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    if (Date.now() >= deadlineAt) {
      throw new Error("LEGACY_RUNTIME_DATABASE_UNSAFE");
    }
    const descriptorAfter = fstatSync(descriptor, { bigint: true });
    const pathAfter = fixedFingerprint(path, "file");
    const descriptorAfterFingerprint = Object.freeze({
      ctimeNs: descriptorAfter.ctimeNs,
      dev: descriptorAfter.dev,
      ino: descriptorAfter.ino,
      mode: descriptorAfter.mode,
      mtimeNs: descriptorAfter.mtimeNs,
      nlink: descriptorAfter.nlink,
      size: descriptorAfter.size,
      uid: descriptorAfter.uid,
    });
    if (
      !sameExactFingerprint(descriptorAfterFingerprint, expected) ||
      !sameExactFingerprint(pathAfter, expected)
    ) throw new Error("LEGACY_RUNTIME_DATABASE_UNSAFE");
    result = hash.digest("hex");
  } catch {
    failure = new Error("LEGACY_RUNTIME_DATABASE_UNSAFE");
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        failure ??= new Error("LEGACY_RUNTIME_DATABASE_UNSAFE");
      }
    }
  }
  if (failure || !result) throw failure ?? new Error("LEGACY_RUNTIME_DATABASE_UNSAFE");
  return result;
}

function databaseFingerprint(
  dataDirectory: string,
  requireSidecarPair = true,
  captureStableWalContent = false,
  stableWalDeadlineAt?: number,
): LegacyDatabaseFingerprint {
  let canonicalDirectory: string;
  try {
    canonicalDirectory = realpathSync(dataDirectory);
  } catch {
    throw new Error("LEGACY_RUNTIME_DATABASE_UNSAFE");
  }
  if (canonicalDirectory !== dataDirectory) {
    throw new Error("LEGACY_RUNTIME_DATABASE_UNSAFE");
  }
  const databasePath = join(dataDirectory, "unboundry.sqlite");
  if (requireSidecarPair && optionalFingerprint(`${databasePath}-journal`)) {
    throw new Error("LEGACY_RUNTIME_DATABASE_UNSAFE");
  }
  const wal = optionalFingerprint(`${databasePath}-wal`);
  const shm = optionalFingerprint(`${databasePath}-shm`);
  if (requireSidecarPair && Boolean(wal) !== Boolean(shm)) {
    throw new Error("LEGACY_RUNTIME_DATABASE_UNSAFE");
  }
  const fingerprint = Object.freeze({
    database: (() => {
      try {
        return fixedFingerprint(databasePath, "file");
      } catch {
        // A mandatory initial database is either safely admitted or rejected by
        // one path-free public error. The missing sentinel never escapes here.
        throw new Error("LEGACY_RUNTIME_DATABASE_UNSAFE");
      }
    })(),
    directory: (() => {
      try {
        return fixedFingerprint(dataDirectory, "directory");
      } catch {
        throw new Error("LEGACY_RUNTIME_DATABASE_UNSAFE");
      }
    })(),
    ...(shm ? { shm } : {}),
    ...(wal ? { wal } : {}),
  });
  if (!captureStableWalContent || !wal || wal.size === 0n) return fingerprint;
  const walContentSha256 = stableWalSha256(
    `${databasePath}-wal`,
    wal,
    stableWalDeadlineAt,
  );
  const revalidated = databaseFingerprint(dataDirectory, requireSidecarPair);
  if (
    !sameExactFingerprint(fingerprint.database, revalidated.database) ||
    !sameExactFingerprint(fingerprint.directory, revalidated.directory) ||
    !sameExactFingerprint(fingerprint.shm, revalidated.shm) ||
    !sameExactFingerprint(fingerprint.wal, revalidated.wal)
  ) throw new Error("LEGACY_RUNTIME_DATABASE_UNSAFE");
  return Object.freeze({ ...fingerprint, walContentSha256 });
}

function databaseFingerprintDifference(
  before: LegacyDatabaseFingerprint,
  after: LegacyDatabaseFingerprint,
): LegacyFingerprintDifference | undefined {
  // SQLite may update lock/WAL-index bytes in an existing SHM file during a
  // coordinated read. Its physical identity remains pinned; DB and WAL content
  // metadata must remain unchanged for the active-task observation itself.
  const comparisons = [
    {
      after: after.database,
      before: before.database,
      component: "DATABASE",
      contentMetadata: true,
    },
    {
      after: after.wal,
      before: before.wal,
      component: "WAL",
      contentMetadata: true,
    },
    {
      after: after.shm,
      before: before.shm,
      component: "SHM",
      contentMetadata: !before.wal || before.wal.size === 0n,
    },
    {
      after: after.directory,
      before: before.directory,
      component: "DIRECTORY",
      contentMetadata: true,
    },
  ] as const;
  // Report one fixed-priority enum tuple. Presence and identity changes are
  // more specific than parent-directory timestamp fallout, and the bound never
  // grows with attacker-controlled filesystem state.
  for (const expectedClass of [
    "PRESENCE",
    "IDENTITY",
    "CONTENT_METADATA",
  ] as const) {
    for (const comparison of comparisons) {
      const changeClass = fingerprintChangeClass(
        comparison.before,
        comparison.after,
        comparison.contentMetadata,
      );
      if (changeClass === expectedClass) {
        return Object.freeze({
          changeClass,
          component: comparison.component,
        });
      }
    }
  }
  return undefined;
}

export function legacyRuntimeFingerprintDifferenceForTest(
  before: LegacyDatabaseFingerprint,
  after: LegacyDatabaseFingerprint,
) {
  if (process.env.UNBOUNDRY_SAFE_TEST !== "1") {
    throw new Error("LEGACY_RUNTIME_TEST_HOOK_FORBIDDEN");
  }
  return databaseFingerprintDifference(before, after);
}

function taggedFingerprintDifference(
  component: LegacyFingerprintComponent,
  before: LegacyFileFingerprint | undefined,
  after: LegacyTaggedFingerprint,
  contentMetadata = true,
): LegacyFingerprintDifference | undefined {
  if (after.state === "UNSAFE") {
    return Object.freeze({ changeClass: "IDENTITY", component });
  }
  const changeClass = fingerprintChangeClass(
    before,
    after.state === "PRESENT" ? after.fingerprint : undefined,
    contentMetadata,
  );
  return changeClass ? Object.freeze({ changeClass, component }) : undefined;
}

function observationFingerprintDifference(
  dataDirectory: string,
  before: LegacyDatabaseFingerprint,
  phase?: LegacyDatabaseObservationPhase,
  afterStableWalHashForTest?: () => void,
  admitStableWalTimestamp =
    phase === "ACTIVE_POST_WARMUP" || phase === "MEDIA_POST_WARMUP",
  stableWalDeadlineAt?: number,
): LegacyFingerprintDifference | undefined {
  const databasePath = join(dataDirectory, "unboundry.sqlite");
  const observations = [
    {
      after: taggedFingerprint(databasePath),
      before: before.database,
      component: "DATABASE",
      contentMetadata: true,
    },
    {
      after: taggedFingerprint(`${databasePath}-journal`),
      before: undefined,
      component: "JOURNAL",
      contentMetadata: true,
    },
    {
      after: taggedFingerprint(`${databasePath}-wal`),
      before: before.wal,
      component: "WAL",
      contentMetadata: true,
    },
    {
      after: taggedFingerprint(`${databasePath}-shm`),
      before: before.shm,
      component: "SHM",
      contentMetadata: !before.wal || before.wal.size === 0n,
    },
    {
      after: taggedFingerprint(dataDirectory, "directory"),
      before: before.directory,
      component: "DIRECTORY",
      contentMetadata: true,
    },
  ] as const;
  const differences: LegacyFingerprintDifference[] = [];
  for (const expectedClass of [
    "PRESENCE",
    "IDENTITY",
    "CONTENT_METADATA",
  ] as const) {
    for (const observation of observations) {
      const difference = taggedFingerprintDifference(
        observation.component,
        observation.before,
        observation.after,
        observation.contentMetadata,
      );
      if (difference?.changeClass === expectedClass) differences.push(difference);
    }
  }
  const difference = differences[0];
  const stableWalTimestampCandidate =
    admitStableWalTimestamp && differences.length === 1 &&
    difference?.component === "WAL" &&
    difference.changeClass === "CONTENT_METADATA" && before.wal &&
    before.wal.size > 0n && before.walContentSha256 &&
    observations[2].after.state === "PRESENT" &&
    observations[2].after.fingerprint.size === before.wal.size;
  if (stableWalTimestampCandidate && observations[2].after.state === "PRESENT") {
    try {
      if (
        stableWalSha256(
          `${databasePath}-wal`,
          observations[2].after.fingerprint,
          stableWalDeadlineAt,
        ) ===
          before.walContentSha256
      ) {
        afterStableWalHashForTest?.();
        const revalidation = [
          {
            after: taggedFingerprint(databasePath),
            before: before.database,
            component: "DATABASE",
            contentMetadata: true,
          },
          {
            after: taggedFingerprint(`${databasePath}-journal`),
            before: undefined,
            component: "JOURNAL",
            contentMetadata: true,
          },
          {
            after: taggedFingerprint(`${databasePath}-wal`),
            before: observations[2].after.fingerprint,
            component: "WAL",
            contentMetadata: true,
          },
          {
            after: taggedFingerprint(`${databasePath}-shm`),
            before: before.shm,
            component: "SHM",
            contentMetadata: false,
          },
          {
            after: taggedFingerprint(dataDirectory, "directory"),
            before: before.directory,
            component: "DIRECTORY",
            contentMetadata: true,
          },
        ] as const;
        for (const expectedClass of [
          "PRESENCE",
          "IDENTITY",
          "CONTENT_METADATA",
        ] as const) {
          for (const observation of revalidation) {
            const postHashDifference = taggedFingerprintDifference(
              observation.component,
              observation.before,
              observation.after,
              observation.contentMetadata,
            );
            if (postHashDifference?.changeClass === expectedClass) {
              return postHashDifference;
            }
          }
        }
        return undefined;
      }
    } catch {
      // A changing, oversized, unreadable or otherwise unstable WAL retains the
      // original bounded CONTENT_METADATA failure instead of widening admission.
    }
  }
  return difference;
}

export function legacyRuntimeObservationDifferenceForTest(
  dataDirectory: string,
  before: LegacyDatabaseFingerprint,
  phase?: LegacyDatabaseObservationPhase,
  afterStableWalHashForTest?: () => void,
  options: Readonly<{
    admitStableWalTimestamp?: boolean;
    stableWalDeadlineAt?: number;
  }> = {},
) {
  if (process.env.UNBOUNDRY_SAFE_TEST !== "1") {
    throw new Error("LEGACY_RUNTIME_TEST_HOOK_FORBIDDEN");
  }
  return observationFingerprintDifference(
    dataDirectory,
    before,
    phase,
    afterStableWalHashForTest,
    options.admitStableWalTimestamp ??
      (phase === "ACTIVE_POST_WARMUP" || phase === "MEDIA_POST_WARMUP"),
    options.stableWalDeadlineAt,
  );
}

function legacyObservationFailure(
  phase: LegacyDatabaseObservationPhase,
  dataDirectory: string,
  before: LegacyDatabaseFingerprint,
  primaryError?: unknown,
  options: Readonly<{
    admitStableWalTimestamp?: boolean;
    stableWalDeadlineAt?: number;
  }> = {},
) {
  const difference = observationFingerprintDifference(
    dataDirectory,
    before,
    phase,
    undefined,
    options.admitStableWalTimestamp ??
      (phase === "ACTIVE_POST_WARMUP" || phase === "MEDIA_POST_WARMUP"),
    options.stableWalDeadlineAt,
  );
  return difference
    ? new LegacyRuntimeDatabaseChangedError(phase, difference)
    : primaryError;
}

function finalizeLegacyObservation(
  cleanup: LegacyObservationCleanup,
  primaryError?: unknown,
) {
  let closeError: unknown;
  try {
    cleanup.close();
  } catch (error) {
    closeError = error;
  }
  // Closing is attempted first, but it can never suppress the independent
  // post-observation. The final priority is fingerprint > close > query.
  const failure = legacyObservationFailure(
    cleanup.phase,
    cleanup.dataDirectory,
    cleanup.fingerprint,
    closeError ?? primaryError,
    {
      admitStableWalTimestamp: cleanup.admitStableWalTimestamp,
      stableWalDeadlineAt: cleanup.stableWalDeadlineAt,
    },
  );
  if (failure) throw failure;
}

export function legacyRuntimeFinalizeObservationForTest(
  cleanup: LegacyObservationCleanup,
  primaryError?: unknown,
) {
  if (process.env.UNBOUNDRY_SAFE_TEST !== "1") {
    throw new Error("LEGACY_RUNTIME_TEST_HOOK_FORBIDDEN");
  }
  return finalizeLegacyObservation(cleanup, primaryError);
}

export function legacyRuntimeObservationFailureForTest(
  phase: LegacyDatabaseObservationPhase,
  dataDirectory: string,
  before: LegacyDatabaseFingerprint,
  primaryError?: unknown,
) {
  if (process.env.UNBOUNDRY_SAFE_TEST !== "1") {
    throw new Error("LEGACY_RUNTIME_TEST_HOOK_FORBIDDEN");
  }
  return legacyObservationFailure(phase, dataDirectory, before, primaryError);
}

export function inspectLegacyActiveGenerationTasks(
  dataDirectory: string,
  phase: LegacyActiveTaskObservationPhase = "ACTIVE_STANDALONE",
  options: LegacyActiveTaskInspectionOptions = {},
) {
  const databasePath = join(dataDirectory, "unboundry.sqlite");
  const settleStableWalTimestamp = phase === "ACTIVE_POST_WARMUP" ||
    (phase === "ACTIVE_SHUTDOWN" &&
      options.settleStableWalTimestamp === true);
  const before = databaseFingerprint(
    dataDirectory,
    true,
    settleStableWalTimestamp,
    options.stableWalDeadlineAt,
  );
  const location = before.wal && before.wal.size > 0n
    ? databasePath
    : `${pathToFileURL(databasePath).href}?immutable=1`;
  const database = new DatabaseSync(location, { readOnly: true, timeout: 1_000 });
  let primaryError: unknown;
  let result: number | undefined;
  try {
    database.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 1000;");
    const version = database.prepare("PRAGMA user_version").get() as
      | { user_version?: unknown }
      | undefined;
    if (Number(version?.user_version) !== 37) {
      throw new Error("LEGACY_RUNTIME_SCHEMA_CHANGED");
    }
    const row = database.prepare(`
      SELECT COUNT(*) AS active
      FROM generation_tasks
      WHERE state IN ('queued', 'running', 'recovering', 'retrying')
    `).get() as { active?: unknown } | undefined;
    const active = Number(row?.active);
    if (!Number.isSafeInteger(active) || active < 0) {
      throw new Error("LEGACY_RUNTIME_TASK_STATE_INVALID");
    }
    result = active;
  } catch (error) {
    primaryError = error;
  } finally {
    finalizeLegacyObservation({
      close: () => database.close(),
      dataDirectory,
      fingerprint: before,
      phase,
      ...(settleStableWalTimestamp
        ? {
            admitStableWalTimestamp: true,
            stableWalDeadlineAt: options.stableWalDeadlineAt,
          }
        : {}),
    }, primaryError);
  }
  return result!;
}

export function inspectLegacyMediaMetadataComplete(
  dataDirectory: string,
  phase: LegacyMediaObservationPhase = "MEDIA_STANDALONE",
) {
  const databasePath = join(dataDirectory, "unboundry.sqlite");
  const before = databaseFingerprint(
    dataDirectory,
    true,
    phase === "MEDIA_POST_WARMUP",
  );
  const location = before.wal && before.wal.size > 0n
    ? databasePath
    : `${pathToFileURL(databasePath).href}?immutable=1`;
  const database = new DatabaseSync(location, { readOnly: true, timeout: 1_000 });
  let primaryError: unknown;
  let result: boolean | undefined;
  try {
    database.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 1000;");
    const version = database.prepare("PRAGMA user_version").get() as
      | { user_version?: unknown }
      | undefined;
    if (Number(version?.user_version) !== 37) {
      throw new Error("LEGACY_RUNTIME_SCHEMA_CHANGED");
    }
    const row = database.prepare(`
      SELECT COUNT(*) AS incomplete
      FROM media_assets
      WHERE storage_status = 'ready'
        AND (
          checksum_sha256 IS NULL
          OR length(checksum_sha256) != 64
          OR checksum_sha256 GLOB '*[^0-9a-f]*'
        )
    `).get() as { incomplete?: unknown } | undefined;
    const incomplete = Number(row?.incomplete);
    if (!Number.isSafeInteger(incomplete) || incomplete < 0) {
      throw new Error("LEGACY_RUNTIME_MEDIA_METADATA_INVALID");
    }
    result = incomplete === 0;
  } catch (error) {
    primaryError = error;
  } finally {
    finalizeLegacyObservation({
      close: () => database.close(),
      dataDirectory,
      fingerprint: before,
      phase,
    }, primaryError);
  }
  return result!;
}

export function createLegacyRuntimeSupervisor(
  options: LegacyRuntimeSupervisorOptions,
) {
  const launcher = options.launcher ?? createLegacyRuntimeLauncher();
  const inspectActiveGenerationTasks = options.activeGenerationTasks ?? (
    (phase, inspection) => inspectLegacyActiveGenerationTasks(
      options.dataDirectory,
      phase,
      inspection,
    )
  );
  const inspectMediaMetadataComplete = options.legacyMediaMetadataComplete ??
    ((phase) => inspectLegacyMediaMetadataComplete(options.dataDirectory, phase));
  const shutdownDeadlineMs = boundedDeadline(options.shutdownDeadlineMs);
  let runtime: LegacyRuntimeProcess | undefined;
  let state: LegacyRuntimeSupervisorState = "idle";
  let startPromise: Promise<LegacyRuntimeTarget> | undefined;
  let stopPromise: Promise<void> | undefined;
  let startupTerminationKnown = true;

  function markUnexpectedExit() {
    if (state === "stopping" || state === "stopped") return;
    state = "failed";
  }

  function start() {
    if (startPromise) return startPromise;
    if (state !== "idle") {
      return Promise.reject(new Error(
        "LEGACY_RUNTIME_STATE_INVALID: legacy supervisor cannot restart",
      ));
    }
    state = "starting";
    try {
      if (inspectActiveGenerationTasks("ACTIVE_PRELAUNCH") !== 0) {
        state = "failed";
        return Promise.reject(new Error(
          "LEGACY_RUNTIME_ACTIVE_TASKS_PRESENT: drain generation tasks on the exact old runtime before switching to the bridge",
        ));
      }
    } catch (error) {
      state = "failed";
      return Promise.reject(error);
    }
    startPromise = launcher.launch(options.legacyRoot, {
      dataDirectory: options.dataDirectory,
      runtimeDirectory: options.runtimeDirectory,
    }).then(async (launched) => {
      runtime = launched;
      launched.child.once("exit", markUnexpectedExit);
      if (childHasExited(launched)) {
        markUnexpectedExit();
        throw new Error("LEGACY_RUNTIME_EXITED: legacy child exited at readiness");
      }
      if (
        launched.warmup.expectedDatabaseMutation !==
          "legacy-media-checksum-backfill" ||
        launched.warmup.providerRequests !== 0
      ) {
        await abortStartup();
        state = "failed";
        throw new Error(
          "LEGACY_RUNTIME_WARMUP_INVALID: child did not attest the bounded startup write",
        );
      }
      try {
        if (inspectActiveGenerationTasks("ACTIVE_POST_WARMUP") !== 0) {
          throw new Error(
            "LEGACY_RUNTIME_ACTIVE_TASKS_PRESENT: legacy startup changed the durable active-task boundary",
          );
        }
        if (!inspectMediaMetadataComplete("MEDIA_POST_WARMUP")) {
          throw new Error(
            "LEGACY_RUNTIME_MEDIA_METADATA_INCOMPLETE: deterministic legacy checksum backfill did not complete",
          );
        }
      } catch (error) {
        try {
          await abortStartup();
        } finally {
          state = "failed";
        }
        throw error;
      }
      state = "ready";
      return launched.target;
    }, (error) => {
      startupTerminationKnown =
        !(error instanceof LegacyRuntimeTerminationUnknownError);
      state = "failed";
      throw error;
    });
    return startPromise;
  }

  function isReady() {
    return state === "ready" && Boolean(runtime) && !childHasExited(runtime!);
  }

  function target() {
    if (!isReady() || !runtime) {
      throw new Error("LEGACY_RUNTIME_UNAVAILABLE: legacy child is not ready");
    }
    return runtime.target;
  }

  function stopChild(
    launched: LegacyRuntimeProcess,
    deadlineAt: number,
  ): Promise<void> {
    if (childHasExited(launched)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      let settled = false;
      let killIssued = false;
      let confirmationTimeout: NodeJS.Timeout | undefined;
      const complete = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (confirmationTimeout) clearTimeout(confirmationTimeout);
        launched.child.removeListener("exit", onExit);
        launched.child.removeListener("error", onError);
        if (error) reject(error);
        else resolve();
      };
      const onExit = (code: number | null) => {
        if (code === 0 && !killIssued) complete();
        else complete(new Error(
          "LEGACY_RUNTIME_STOP_FAILED: legacy child did not drain cleanly",
        ));
      };
      const onError = () => complete(new Error(
        "LEGACY_RUNTIME_STOP_FAILED: legacy child process failed during shutdown",
      ));
      const remaining = Math.max(1, deadlineAt - Date.now());
      const timeout = setTimeout(() => {
        killIssued = true;
        try {
          launched.child.kill("SIGKILL");
        } catch {
          complete(new Error(
            "LEGACY_RUNTIME_DRAIN_TIMEOUT: legacy child termination could not be requested",
          ));
        }
        // Do not settle until the exit event confirms the OS released the
        // guardian and every exact-old database descriptor.
      }, remaining);
      confirmationTimeout = setTimeout(() => complete(new Error(
        "LEGACY_RUNTIME_TERMINATION_UNKNOWN: killed legacy child exit was not confirmed",
      )), remaining + 5_000);
      confirmationTimeout.unref?.();
      launched.child.once("exit", onExit);
      launched.child.once("error", onError);
      try {
        launched.child.send({ nonce: launched.nonce, type: "shutdown" }, (error) => {
          if (error) complete(new Error(
            "LEGACY_RUNTIME_STOP_FAILED: legacy shutdown IPC failed",
          ));
        });
      } catch {
        complete(new Error(
          "LEGACY_RUNTIME_STOP_FAILED: legacy shutdown IPC was unavailable",
        ));
      }
    });
  }

  function shutdown(deadlineMs = shutdownDeadlineMs) {
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      if (state === "stopped") return;
      state = "stopping";
      const deadlineAt = Date.now() + boundedDeadline(deadlineMs, true);
      let launched = runtime;
      if (!launched && startPromise) {
        try {
          await startPromise;
          launched = runtime;
        } catch {
          state = "failed";
          throw new Error(
            "LEGACY_RUNTIME_STOP_FAILED: legacy startup did not complete cleanly",
          );
        }
      }
      if (!launched) {
        state = "stopped";
        return;
      }
      if (childHasExited(launched)) {
        // An unexpected exit already removed the only legacy writer. HTTP has
        // remained fail-closed since the exit event; lease handoff is now safe
        // even though the durable task rows may need crash recovery next time.
        state = "stopped";
        return;
      }
      // Pin the first shutdown observation before its query. A non-empty WAL
      // costs one bounded hash, plus at most one comparison hash if SQLite
      // changes only its timestamps during that exact window. If work remains,
      // every later 100ms poll is strict and hash-free; no later change can be
      // admitted against a baseline captured after the fact.
      let firstShutdownObservation = true;
      while (Date.now() < deadlineAt) {
        if (childHasExited(launched)) break;
        const inspection = firstShutdownObservation
          ? Object.freeze({
              settleStableWalTimestamp: true,
              stableWalDeadlineAt: deadlineAt,
            })
          : undefined;
        firstShutdownObservation = false;
        let activeTasks: number;
        try {
          activeTasks = inspectActiveGenerationTasks(
            "ACTIVE_SHUTDOWN",
            inspection,
          );
        } catch (error) {
          state = "failed";
          throw error;
        }
        if (activeTasks === 0) break;
        await wait(Math.min(generationDrainPollMs, deadlineAt - Date.now()));
      }
      if (childHasExited(launched)) {
        state = "stopped";
        return;
      }
      if (Date.now() >= deadlineAt) {
        state = "failed";
        throw new Error(
          "LEGACY_RUNTIME_DRAIN_TIMEOUT: active generation tasks did not settle; active lease must remain held",
        );
      }
      await stopChild(launched, deadlineAt);
      state = "stopped";
    })();
    return stopPromise;
  }

  function abortStartup(deadlineMs = shutdownDeadlineMs) {
    if (!runtime) {
      if (!startupTerminationKnown) {
        return Promise.reject(new Error(
          "LEGACY_RUNTIME_TERMINATION_UNKNOWN: active lease must remain held",
        ));
      }
      state = "stopped";
      return Promise.resolve();
    }
    if (childHasExited(runtime)) {
      state = "stopped";
      return Promise.resolve();
    }
    const launched = runtime;
    state = "stopping";
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const complete = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        launched.child.removeListener("exit", onExit);
        if (error) {
          state = "failed";
          reject(error);
        } else {
          state = "stopped";
          resolve();
        }
      };
      const onExit = () => complete();
      const timeout = setTimeout(() => complete(new Error(
        "LEGACY_RUNTIME_ABORT_TIMEOUT: legacy child exit was not confirmed",
      )), boundedDeadline(deadlineMs));
      launched.child.once("exit", onExit);
      try {
        launched.child.kill("SIGKILL");
      } catch {
        complete(new Error(
          "LEGACY_RUNTIME_ABORT_FAILED: legacy child could not be stopped",
        ));
      }
      if (childHasExited(launched)) complete();
    });
  }

  return Object.freeze({
    abortStartup,
    isReady,
    shutdown,
    start,
    state: () => state,
    target,
  });
}

export type LegacyRuntimeSupervisor = ReturnType<
  typeof createLegacyRuntimeSupervisor
>;
