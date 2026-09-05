import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  constants as fileConstants,
  fsyncSync,
  openSync,
} from "node:fs";
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";

const FORMAT = "unboundry-synthetic-release-rehearsal-v2";
const STATE_FORMAT = "unboundry-release-data-state-v1";
const BACKUP_FORMAT = "unboundry-frozen-backup-receipt-v1";
const SEQUENCING_FORMAT = "unboundry-synthetic-sequencing-receipt-v1";
const RESERVATION_FORMAT = "unboundry-synthetic-operation-reservation-v1";
const RELEASE_FORMAT = "unboundry-immutable-release";
const RELEASE_MANIFEST_SCHEMA = 3;
const releaseVersionByRole = Object.freeze({
  bridge: "0.5.2",
  final: "0.6.0",
});
const exactMigrationScriptPaths = Object.freeze([
  "scripts/migrate-schema37-to39.mjs",
  "scripts/migrate-schema39-to40.mjs",
  "scripts/migrate-schema40-to41.mjs",
  "scripts/migrate-schema41-to42.mjs",
  "scripts/migrate-schema42-to43.mjs",
]);
const exactLegacyRuntimeContract = Object.freeze({
  archiveSha256: "e7a619c4d9dbaca14d1032ef18f83f81dcfb36c9402976debc4f8f546c8bb5d0",
  commitTree: "0990690bd9828757b82f59861f950ce6ff9ed4f8",
  originalInventorySha256:
    "cd98d90aaae56de756164fa0434dfb6bb144598183536c6d91067308e8d24517",
  peeledCommit: "7f7d6177a564056a6f41ff83dfb7ba913b21603b",
  trackedFiles: 371,
});
const exactLegacyProductionDependencies = Object.freeze({
  "@xyflow/react": Object.freeze({ requested: "12.11.2", version: "12.11.2" }),
  "ali-oss": Object.freeze({ requested: "^6.23.0", version: "6.23.0" }),
  archiver: Object.freeze({ requested: "^8.0.0", version: "8.0.0" }),
  react: Object.freeze({ requested: "19.2.8", version: "19.2.8" }),
  "react-dom": Object.freeze({ requested: "19.2.8", version: "19.2.8" }),
});
const exactLegacyBuildSteps = Object.freeze([
  Object.freeze({
    arguments: Object.freeze(["node_modules/typescript/bin/tsc", "--noEmit"]),
    command: "node",
  }),
  Object.freeze({
    arguments: Object.freeze([
      "node_modules/vite/bin/vite.js",
      "build",
      "--configLoader",
      "runner",
    ]),
    command: "node",
  }),
]);
const exactLegacySourceLockSha256 =
  "79612b35753b970b10223f50adc396c0a064c41bfa8779bb9698b40f9ce0296e";
const exactMigrationArguments = Object.freeze([
  "scripts/migrate-schema37-to39.mjs",
  "--apply",
  "--data-dir",
  "${UNBOUNDRY_DATA_DIR}",
  "--runtime-dir",
  "${UNBOUNDRY_RUNTIME_DIR}",
  "--expected-logical-sha256",
  "${UNBOUNDRY_EXPECTED_SCHEMA37_LOGICAL_SHA256}",
  "--scratch-root",
  "${UNBOUNDRY_MIGRATION_SCRATCH_ROOT}",
]);
const exactMigrationPlaceholders = Object.freeze({
  UNBOUNDRY_DATA_DIR: "absolute-private-data-directory",
  UNBOUNDRY_EXPECTED_SCHEMA37_LOGICAL_SHA256: "lowercase-sha256",
  UNBOUNDRY_MIGRATION_SCRATCH_ROOT: "absolute-private-migration-scratch-directory",
  UNBOUNDRY_RUNTIME_DIR: "absolute-private-runtime-directory-shared-with-service",
});
const REQUIRED_QUIET_MILLISECONDS = 60_000;
const MAXIMUM_FIXED_FILE_BYTES = 512 * 1024 * 1024;
const MAXIMUM_MANIFEST_BYTES = 16 * 1024 * 1024;
const MAXIMUM_CONTROL_FILE_BYTES = 1024 * 1024;
const MAXIMUM_STATIC_HEALTH_BYTES = 64 * 1024 * 1024;
const MAXIMUM_TREE_BYTES = 8 * 1024 * 1024 * 1024;
const MAXIMUM_TREE_ENTRIES = 500_000;
const MAXIMUM_TREE_DEPTH = 64;
const MAXIMUM_PATH_BYTES = 4096;
const sha256Pattern = /^[0-9a-f]{64}$/;
const commitPattern = /^[0-9a-f]{40}$/;
const releaseIdPattern = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const scriptPath = fileURLToPath(import.meta.url);
const operationReservationName = ".unboundry-m95-operation-reservation";
const safeCheckpointReachedName = ".unboundry-m95-safe-checkpoint-reached";
const safeCheckpointResumeName = ".unboundry-m95-safe-checkpoint-resume";
const allowedSafeCheckpoints = new Set([
  "none",
  "crash-after-reservation",
  "current-race-before-rename",
  "hold-after-reservation",
  "post-rename-publication-failure",
  "receipt-post-link-commit",
  "sequence-expires-at-publication",
  "state-race-before-rename",
]);
const allowedFailures = new Set([
  "none",
  "build",
  "manifest",
  "static-health",
  "live-health",
  "ready-health",
  "migration",
  "nginx-validate",
  "nginx-switch",
  "post-publication-health",
]);
const exactForbiddenEnvironment = Object.freeze([
  "LD_LIBRARY_PATH",
  "LD_PRELOAD",
  "NODE_OPTIONS",
  "NODE_PATH",
  "UNBOUNDRY_EXPLICIT_SCHEMA_MIGRATION",
  "UNBOUNDRY_MAINTENANCE_MODE",
  "UNBOUNDRY_SAFE_TEST",
]);
const formalForbiddenEnvironment = Object.freeze([
  "LD_LIBRARY_PATH",
  "LD_PRELOAD",
  "NODE_OPTIONS",
  "NODE_PATH",
  "UNBOUNDRY_EXPLICIT_SCHEMA_MIGRATION",
  "UNBOUNDRY_LEGACY_RUNTIME_ROOT",
  "UNBOUNDRY_MAINTENANCE_MODE",
  "UNBOUNDRY_RELEASE_ROLE",
  "UNBOUNDRY_SAFE_TEST",
]);
const exactPlaceholders = Object.freeze({
  UNBOUNDRY_DATA_DIR: "absolute-private-data-directory",
  UNBOUNDRY_PORT: "loopback-port",
  UNBOUNDRY_RUNTIME_HOME: "absolute-private-runtime-home-directory",
  UNBOUNDRY_RUNTIME_DIR: "absolute-private-runtime-directory",
  UNBOUNDRY_RUNTIME_ROLE: "active-or-non-active-runtime-role",
  UNBOUNDRY_RUNTIME_TEMP: "absolute-private-runtime-temporary-directory",
  UNBOUNDRY_VITE_CACHE_DIR: "absolute-private-cache-directory",
});

class RehearsalError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "RehearsalError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new RehearsalError(code, message);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function containsPath(parent, child) {
  const difference = relative(parent, child);
  return difference === "" || (
    difference !== ".." && !difference.startsWith(`..${sep}`) &&
    !isAbsolute(difference)
  );
}

function exactAbsolutePath(value, label) {
  if (
    !value || !isAbsolute(value) || resolve(value) !== value ||
    value !== value.normalize("NFC") || /[\0\r\n]/.test(value)
  ) fail("REHEARSAL_ARGUMENT_INVALID", `${label} must be a normalized absolute path`);
  return value;
}

function parseArguments(argv) {
  const values = new Map();
  const allowed = new Set([
    "--backup-receipt",
    "--sequencing-receipt",
    "--candidate-id",
    "--current-link",
    "--database-state",
    "--failure",
    "--operation",
    "--receipt-path",
    "--rehearsal-root",
    "--release-root",
  ]);
  if (argv.length % 2 !== 0) {
    fail("REHEARSAL_ARGUMENT_INVALID", "Every rehearsal option requires one value");
  }
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(name) || !value || value.startsWith("--") || values.has(name)) {
      fail("REHEARSAL_ARGUMENT_INVALID", "Rehearsal arguments are missing, duplicated, or unknown");
    }
    values.set(name, value);
  }
  for (const name of allowed) {
    if (!values.has(name)) fail("REHEARSAL_ARGUMENT_INVALID", `Missing required option ${name}`);
  }
  const operation = values.get("--operation");
  if (!new Set(["bridge-switch", "migrate-switch", "rollback"]).has(operation)) {
    fail("REHEARSAL_ARGUMENT_INVALID", "Operation must be bridge-switch, migrate-switch, or rollback");
  }
  const failure = values.get("--failure");
  if (!allowedFailures.has(failure)) {
    fail("REHEARSAL_ARGUMENT_INVALID", "Unknown failure injection stage");
  }
  const candidateId = values.get("--candidate-id");
  if (!releaseIdPattern.test(candidateId) || candidateId === "." || candidateId === "..") {
    fail("REHEARSAL_ARGUMENT_INVALID", "Candidate release id is unsafe");
  }
  const safeCheckpoint = process.env.UNBOUNDRY_M95_SAFE_CHECKPOINT ?? "none";
  if (!allowedSafeCheckpoints.has(safeCheckpoint)) {
    fail("REHEARSAL_ARGUMENT_INVALID", "Unknown synthetic safe-test checkpoint");
  }
  if (safeCheckpoint !== "none" && process.env.UNBOUNDRY_SAFE_TEST !== "1") {
    fail(
      "REHEARSAL_ARGUMENT_INVALID",
      "Synthetic deterministic checkpoints require the explicit safe-test gate",
    );
  }
  return Object.freeze({
    sequencingReceipt: exactAbsolutePath(
      values.get("--sequencing-receipt"),
      "synthetic sequencing receipt",
    ),
    backupReceipt: exactAbsolutePath(values.get("--backup-receipt"), "backup receipt"),
    candidateId,
    currentLink: exactAbsolutePath(values.get("--current-link"), "current link"),
    databaseState: exactAbsolutePath(values.get("--database-state"), "database state"),
    failure,
    operation,
    receiptPath: exactAbsolutePath(values.get("--receipt-path"), "output receipt"),
    rehearsalRoot: exactAbsolutePath(values.get("--rehearsal-root"), "rehearsal root"),
    releaseRoot: exactAbsolutePath(values.get("--release-root"), "release root"),
    safeCheckpoint,
  });
}

function currentUid() {
  if (typeof process.getuid !== "function") {
    fail("REHEARSAL_PATH_UNSAFE", "Release rehearsal requires POSIX ownership checks");
  }
  return process.getuid();
}

async function assertPrivateDirectory(path, label) {
  const details = await lstat(path).catch(() => undefined);
  if (
    !details?.isDirectory() || details.isSymbolicLink() || details.uid !== currentUid() ||
    (details.mode & 0o777) !== 0o700
  ) fail("REHEARSAL_PATH_UNSAFE", `${label} must be a private current-user directory`);
  return directoryIdentity(details);
}

function directoryIdentity(details) {
  return Object.freeze({
    ctimeMs: details.ctimeMs,
    dev: details.dev,
    ino: details.ino,
    mode: details.mode,
    mtimeMs: details.mtimeMs,
    uid: details.uid,
  });
}

function fileIdentity(details) {
  return Object.freeze({
    ctimeMs: details.ctimeMs,
    dev: details.dev,
    ino: details.ino,
    mode: details.mode,
    mtimeMs: details.mtimeMs,
    nlink: details.nlink,
    size: details.size,
    uid: details.uid,
  });
}

function sameDirectoryIdentity(details, identity) {
  return details?.isDirectory() && !details.isSymbolicLink() &&
    details.dev === identity.dev && details.ino === identity.ino &&
    details.uid === identity.uid && details.mode === identity.mode;
}

function sameStrictDirectoryIdentity(details, identity) {
  return sameDirectoryIdentity(details, identity) &&
    details.mtimeMs === identity.mtimeMs && details.ctimeMs === identity.ctimeMs;
}

function sameFileIdentity(details, identity) {
  return details?.isFile() && !details.isSymbolicLink() &&
    details.dev === identity.dev && details.ino === identity.ino &&
    details.uid === identity.uid && details.mode === identity.mode &&
    details.nlink === identity.nlink && details.size === identity.size &&
    details.mtimeMs === identity.mtimeMs && details.ctimeMs === identity.ctimeMs;
}

function samePinnedFileIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino &&
    left.uid === right.uid && left.mode === right.mode &&
    left.nlink === right.nlink && left.size === right.size &&
    left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

function sameRenamedFileIdentity(details, identity) {
  return details?.isFile() && !details.isSymbolicLink() &&
    details.dev === identity.dev && details.ino === identity.ino &&
    details.uid === identity.uid && details.mode === identity.mode &&
    details.nlink === identity.nlink && details.size === identity.size &&
    details.mtimeMs === identity.mtimeMs;
}

function sameUnlinkedDescriptorIdentity(details, identity) {
  return details?.isFile() &&
    details.dev === identity.dev && details.ino === identity.ino &&
    details.uid === identity.uid && details.mode === identity.mode &&
    details.nlink === 0 && details.size === identity.size &&
    details.mtimeMs === identity.mtimeMs;
}

async function assertPinnedDirectory(path, identity, label) {
  const details = await lstat(path).catch(() => undefined);
  if (!sameDirectoryIdentity(details, identity)) {
    fail("REHEARSAL_INPUT_CHANGED", `${label} changed during the rehearsal`);
  }
}

async function assertSafeRoots(options) {
  const canonicalTemporaryRoot = await realpath(tmpdir());
  const canonicalRoot = await realpath(options.rehearsalRoot).catch(() => undefined);
  if (
    !canonicalRoot || canonicalRoot === canonicalTemporaryRoot ||
    !containsPath(canonicalTemporaryRoot, canonicalRoot) ||
    !basename(canonicalRoot).startsWith("unboundry-m95-")
  ) {
    fail(
      "REHEARSAL_PATH_UNSAFE",
      "Rehearsal root must be a dedicated unboundry-m95-* system temporary directory",
    );
  }
  const rehearsalIdentity = await assertPrivateDirectory(canonicalRoot, "Rehearsal root");
  for (const [label, path] of [
    ["release root", options.releaseRoot],
    ["current link parent", dirname(options.currentLink)],
    ["database state parent", dirname(options.databaseState)],
    ["backup receipt parent", dirname(options.backupReceipt)],
    ["sequencing receipt parent", dirname(options.sequencingReceipt)],
    ["output receipt parent", dirname(options.receiptPath)],
  ]) {
    const canonicalParent = await realpath(path).catch(() => undefined);
    if (!canonicalParent || !containsPath(canonicalRoot, canonicalParent)) {
      fail("REHEARSAL_PATH_UNSAFE", `${label} must remain inside the rehearsal root`);
    }
  }
  const releaseIdentity = await assertPrivateDirectory(options.releaseRoot, "Release root");
  const receiptParentIdentity = await assertPrivateDirectory(
    dirname(options.receiptPath),
    "Receipt parent",
  );
  const outputBefore = await lstat(options.receiptPath).catch(() => undefined);
  if (outputBefore) fail("REHEARSAL_PATH_UNSAFE", "Output receipt already exists");
  const reservationPath = join(canonicalRoot, operationReservationName);
  if (
    new Set([
      options.backupReceipt,
      options.currentLink,
      options.databaseState,
      options.receiptPath,
      options.sequencingReceipt,
      reservationPath,
    ]).size !== 6
  ) fail("REHEARSAL_PATH_UNSAFE", "Rehearsal control paths must be distinct");
  return Object.freeze({
    canonicalRoot,
    receiptParentIdentity,
    rehearsalIdentity,
    releaseIdentity,
    reservationPath,
  });
}

async function acquireOperationReservation(roots) {
  let descriptor;
  let identity;
  try {
    descriptor = await open(
      roots.reservationPath,
      fileConstants.O_CREAT | fileConstants.O_EXCL | fileConstants.O_RDWR |
        (fileConstants.O_NOFOLLOW ?? 0),
      0o600,
    );
  } catch (error) {
    if (error?.code === "EEXIST") {
      fail(
        "OPERATION_RESERVED",
        "A pinned synthetic release operation reservation already exists; concurrent or crash-residue execution is refused",
      );
    }
    fail("OPERATION_RESERVATION_FAILED", "Synthetic operation reservation could not be created");
  }
  try {
    const token = sha256(Buffer.concat([
      randomBytes(32),
      Buffer.from(`${process.pid}:${Date.now()}:${roots.canonicalRoot}`, "utf8"),
    ]));
    const bytes = Buffer.from(`${JSON.stringify({
      evidenceClass: "synthetic",
      format: RESERVATION_FORMAT,
      ownerPid: process.pid,
      token,
    })}\n`, "utf8");
    await descriptor.writeFile(bytes);
    await descriptor.sync();
    const [descriptorDetails, pathDetails] = await Promise.all([
      descriptor.stat(),
      lstat(roots.reservationPath).catch(() => undefined),
    ]);
    if (
      !descriptorDetails.isFile() || descriptorDetails.nlink !== 1 ||
      descriptorDetails.uid !== currentUid() || (descriptorDetails.mode & 0o777) !== 0o600 ||
      !pathDetails?.isFile() || pathDetails.isSymbolicLink() ||
      pathDetails.dev !== descriptorDetails.dev || pathDetails.ino !== descriptorDetails.ino
    ) fail("OPERATION_RESERVATION_CHANGED", "Synthetic operation reservation was not pinned safely");
    identity = fileIdentity(descriptorDetails);
    const reservation = Object.freeze({
      bytesSha256: sha256(bytes),
      descriptor,
      identity,
      path: roots.reservationPath,
      rootIdentity: roots.rehearsalIdentity,
      rootPath: roots.canonicalRoot,
    });
    syncDirectory(roots.canonicalRoot);
    await assertOperationReservation(reservation);
    return reservation;
  } catch (error) {
    await descriptor.close().catch(() => {});
    const current = await lstat(roots.reservationPath).catch(() => undefined);
    if (identity && sameFileIdentity(current, identity)) {
      await rm(roots.reservationPath, { force: true }).catch(() => {});
    }
    throw error;
  }
}

async function assertOperationReservation(reservation) {
  await assertPinnedDirectory(
    reservation.rootPath,
    reservation.rootIdentity,
    "Rehearsal root",
  );
  const [descriptorDetails, snapshot] = await Promise.all([
    reservation.descriptor.stat().catch(() => undefined),
    fixedFileSnapshot(reservation.path, "Synthetic operation reservation", {
      maximumBytes: MAXIMUM_CONTROL_FILE_BYTES,
      mode: 0o600,
    }).catch(() => undefined),
  ]);
  if (
    !descriptorDetails || !sameFileIdentity(descriptorDetails, reservation.identity) ||
    !snapshot || snapshot.sha256 !== reservation.bytesSha256 ||
    !samePinnedFileIdentity(snapshot.identity, reservation.identity)
  ) {
    fail(
      "OPERATION_RESERVATION_CHANGED",
      "Pinned synthetic operation reservation changed or disappeared",
    );
  }
}

async function releaseOperationReservation(reservation) {
  await assertOperationReservation(reservation);
  const before = await lstat(reservation.path).catch(() => undefined);
  if (!sameFileIdentity(before, reservation.identity)) {
    fail(
      "OPERATION_RESERVATION_CHANGED",
      "Synthetic operation reservation identity changed before release",
    );
  }
  const quarantine = `${reservation.path}.release-${process.pid}-${randomBytes(8).toString("hex")}`;
  try {
    await rename(reservation.path, quarantine);
    syncDirectory(reservation.rootPath);
    const quarantined = await lstat(quarantine).catch(() => undefined);
    // Renaming and unlinking the pinned inode legitimately change ctime (and
    // unlinking changes nlink). Keep every other immutable/content field bound
    // instead of comparing the pre-rename ctime snapshot after the mutation.
    if (!sameRenamedFileIdentity(quarantined, reservation.identity)) {
      if (!await lstat(reservation.path).then(() => true, () => false)) {
        await rename(quarantine, reservation.path).catch(() => {});
        syncDirectory(reservation.rootPath);
      }
      fail(
        "OPERATION_RESERVATION_CHANGED",
        "A foreign path won the operation-reservation release race and was preserved",
      );
    }
    await rm(quarantine);
    syncDirectory(reservation.rootPath);
    const releasedDescriptor = await reservation.descriptor.stat().catch(() => undefined);
    if (!sameUnlinkedDescriptorIdentity(releasedDescriptor, reservation.identity)) {
      fail(
        "OPERATION_RESERVATION_CHANGED",
        "Synthetic operation reservation inode changed during release",
      );
    }
    const replacement = await lstat(reservation.path).catch(() => undefined);
    if (replacement) {
      fail(
        "OPERATION_RESERVATION_CHANGED",
        "A foreign operation reservation appeared during identity-safe release",
      );
    }
  } finally {
    await reservation.descriptor.close().catch(() => {});
  }
}

async function publishSafeCheckpointMarker(options) {
  const path = join(options.rehearsalRoot, safeCheckpointReachedName);
  await writeFile(path, `${options.safeCheckpoint}\n`, { flag: "wx", mode: 0o600 });
  syncDirectory(options.rehearsalRoot);
  return path;
}

async function runSafeCheckpoint(options, checkpoint, context = {}) {
  if (options.safeCheckpoint !== checkpoint) return;
  if (checkpoint === "crash-after-reservation") {
    await publishSafeCheckpointMarker(options);
    process.kill(process.pid, "SIGKILL");
    await new Promise(() => {});
    return;
  }
  if (checkpoint === "hold-after-reservation") {
    const reachedPath = await publishSafeCheckpointMarker(options);
    const resumePath = join(options.rehearsalRoot, safeCheckpointResumeName);
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const resumed = await fixedFile(resumePath, "Synthetic safe checkpoint resume", {
        maximumBytes: MAXIMUM_CONTROL_FILE_BYTES,
        mode: 0o600,
      }).catch(() => undefined);
      if (resumed) {
        await rm(resumePath);
        await rm(reachedPath);
        syncDirectory(options.rehearsalRoot);
        return;
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
    }
    fail("SAFE_CHECKPOINT_TIMEOUT", "Synthetic reservation hold checkpoint timed out");
  }
  if (checkpoint === "state-race-before-rename") {
    const bytes = await fixedFile(context.path, "Synthetic database state", {
      maximumBytes: MAXIMUM_CONTROL_FILE_BYTES,
      mode: 0o600,
    });
    const document = parseDocument(bytes, "Synthetic database state");
    const temporary = `${context.path}.safe-race-${process.pid}-${randomBytes(8).toString("hex")}`;
    try {
      await writeFile(temporary, `${JSON.stringify({
        ...document,
        syntheticOutsideWriterCheckpoint: sha256(randomBytes(32)),
      }, null, 2)}\n`, { flag: "wx", mode: 0o600 });
      const descriptor = openSync(
        temporary,
        fileConstants.O_RDONLY | (fileConstants.O_NOFOLLOW ?? 0),
      );
      try {
        fsyncSync(descriptor);
      } finally {
        closeSync(descriptor);
      }
      await rename(temporary, context.path);
      syncDirectory(dirname(context.path));
    } finally {
      await rm(temporary, { force: true }).catch(() => {});
    }
    return;
  }
  if (checkpoint === "current-race-before-rename") {
    const temporary = `${options.currentLink}.safe-race-${process.pid}-${randomBytes(8).toString("hex")}`;
    try {
      await symlink(context.competitorId, temporary);
      await rename(temporary, options.currentLink);
      syncDirectory(dirname(options.currentLink));
    } finally {
      await rm(temporary, { force: true }).catch(() => {});
    }
    return;
  }
  if (checkpoint === "receipt-post-link-commit") {
    fail(
      "RECEIPT_POST_LINK_SYNTHETIC_FAILURE",
      "Injected failure after the receipt hard-link commit point",
    );
  }
  if (checkpoint === "post-rename-publication-failure") {
    fail(
      "SAFE_POST_RENAME_FAILURE",
      "Injected safe-test failure after pointer rename and before sync/readback",
    );
  }
}

async function fixedFile(
  path,
  label,
  { allowRootOwner = false, maximumBytes = MAXIMUM_FIXED_FILE_BYTES, mode } = {},
) {
  const descriptor = await open(
    path,
    fileConstants.O_RDONLY | (fileConstants.O_NOFOLLOW ?? 0),
  ).catch(() => undefined);
  if (!descriptor) fail("REHEARSAL_PATH_UNSAFE", `${label} is unavailable`);
  try {
    const before = await descriptor.stat();
    const pathBefore = await lstat(path).catch(() => undefined);
    if (
      !before.isFile() || before.isSymbolicLink() || before.nlink !== 1 ||
      (before.uid !== currentUid() && !(allowRootOwner && before.uid === 0)) ||
      (before.mode & 0o022) !== 0 ||
      before.size > maximumBytes ||
      (mode !== undefined && (before.mode & 0o777) !== mode) ||
      !pathBefore?.isFile() || pathBefore.isSymbolicLink() ||
      pathBefore.dev !== before.dev || pathBefore.ino !== before.ino
    ) fail("REHEARSAL_PATH_UNSAFE", `${label} is not a fixed trusted file`);
    const bytes = await descriptor.readFile();
    const after = await descriptor.stat();
    const pathAfter = await lstat(path).catch(() => undefined);
    if (
      after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs ||
      !pathAfter?.isFile() || pathAfter.dev !== before.dev || pathAfter.ino !== before.ino ||
      pathAfter.mtimeMs !== before.mtimeMs || pathAfter.ctimeMs !== before.ctimeMs
    ) fail("REHEARSAL_INPUT_CHANGED", `${label} changed while it was read`);
    return bytes;
  } finally {
    await descriptor.close();
  }
}

async function fixedFileSnapshot(path, label, options = {}) {
  const bytes = await fixedFile(path, label, options);
  const details = await lstat(path).catch(() => undefined);
  if (!details?.isFile() || details.isSymbolicLink()) {
    fail("REHEARSAL_INPUT_CHANGED", `${label} changed after it was read`);
  }
  const identity = fileIdentity(details);
  const confirmed = await fixedFile(path, label, options);
  const confirmedDetails = await lstat(path).catch(() => undefined);
  if (!confirmed.equals(bytes) || !sameFileIdentity(confirmedDetails, identity)) {
    fail("REHEARSAL_INPUT_CHANGED", `${label} changed while its identity was pinned`);
  }
  return Object.freeze({ bytes, identity, sha256: sha256(bytes) });
}

function parseDocument(bytes, label) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    fail("REHEARSAL_INPUT_INVALID", `${label} is not valid JSON`);
  }
}

function normalizedRelativePath(value, label) {
  if (
    !value || value !== value.normalize("NFC") || value.startsWith("/") ||
    value.includes("\\") || /[\0\r\n]/.test(value)
  ) fail("RELEASE_MANIFEST_INVALID", `${label} has an unsafe path`);
  const parts = value.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    fail("RELEASE_MANIFEST_INVALID", `${label} has an unsafe path segment`);
  }
  return parts;
}

function validateRuntimeContract(runtime, releaseRole = "legacy") {
  const bridge = releaseRole === "bridge";
  const formal = bridge || releaseRole === "final";
  const expectedPlaceholders = formal
    ? Object.freeze({
        UNBOUNDRY_DATA_DIR: "absolute-private-data-directory",
        UNBOUNDRY_PORT: "loopback-port",
        UNBOUNDRY_RUNTIME_HOME: "absolute-private-runtime-home-directory",
        UNBOUNDRY_RUNTIME_DIR: "absolute-private-runtime-directory",
        UNBOUNDRY_RUNTIME_ROLE: "active-or-non-active-runtime-role",
        UNBOUNDRY_RUNTIME_TEMP: "absolute-private-runtime-temporary-directory",
        UNBOUNDRY_VITE_CACHE_DIR: "absolute-private-cache-directory",
      })
    : exactPlaceholders;
  if (
    !runtime || typeof runtime !== "object" || !isAbsolute(runtime.command) ||
    runtime.cwd !== "." || !Array.isArray(runtime.arguments) ||
    JSON.stringify(runtime.arguments) !== JSON.stringify([
      "node_modules/vite/bin/vite.js",
      "preview",
      "--configLoader",
      "runner",
      "--host",
      "127.0.0.1",
      "--port",
      "${UNBOUNDRY_PORT}",
      "--strictPort",
    ]) ||
    JSON.stringify(runtime.forbiddenEnvironment) !== JSON.stringify(
      formal ? formalForbiddenEnvironment : exactForbiddenEnvironment,
    ) ||
    JSON.stringify(runtime.forbiddenEnvironmentPrefixes) !== JSON.stringify(["UNBOUNDRY_TEST_"]) ||
    JSON.stringify(runtime.placeholders) !== JSON.stringify(expectedPlaceholders)
  ) fail("RELEASE_MANIFEST_INVALID", "Release runtime contract is incomplete or unexpected");
  const environment = runtime.environment;
  const placeholderVariables = Object.freeze({
    HOME: "UNBOUNDRY_RUNTIME_HOME",
    TEMP: "UNBOUNDRY_RUNTIME_TEMP",
    TMP: "UNBOUNDRY_RUNTIME_TEMP",
    TMPDIR: "UNBOUNDRY_RUNTIME_TEMP",
    UNBOUNDRY_DATA_DIR: "UNBOUNDRY_DATA_DIR",
    UNBOUNDRY_RUNTIME_DIR: "UNBOUNDRY_RUNTIME_DIR",
    UNBOUNDRY_RUNTIME_ROLE: "UNBOUNDRY_RUNTIME_ROLE",
    UNBOUNDRY_VITE_CACHE_DIR: "UNBOUNDRY_VITE_CACHE_DIR",
  });
  const expectedKeys = [
    ...Object.keys(placeholderVariables),
    "NODE_ENV",
    "PATH",
    "UNBOUNDRY_SECURE_COOKIES",
    "UNBOUNDRY_TRUST_PROXY",
  ].sort();
  if (!environment || JSON.stringify(Object.keys(environment).sort()) !== JSON.stringify(expectedKeys)) {
    fail("RELEASE_MANIFEST_INVALID", "Release runtime environment mapping is incomplete");
  }
  for (const [name, placeholder] of Object.entries(placeholderVariables)) {
    if (JSON.stringify(environment[name]) !== JSON.stringify({
      placeholder,
      required: true,
      source: "placeholder",
    })) fail("RELEASE_MANIFEST_INVALID", `Release runtime environment ${name} is invalid`);
  }
  for (const [name, value] of Object.entries({
    NODE_ENV: "production",
    UNBOUNDRY_SECURE_COOKIES: "1",
    UNBOUNDRY_TRUST_PROXY: "1",
  })) {
    if (JSON.stringify(environment[name]) !== JSON.stringify({
      required: true,
      source: "literal",
      value,
    })) fail("RELEASE_MANIFEST_INVALID", `Release runtime literal ${name} is invalid`);
  }
  if (
    environment.PATH?.required !== true || environment.PATH?.source !== "literal" ||
    environment.PATH?.value !== "/opt/node22/bin:/usr/bin:/bin"
  ) fail("RELEASE_MANIFEST_INVALID", "Release runtime PATH is invalid");
  const health = runtime.health;
  if (
    health?.livePath !== "/api/health/live" ||
    health?.readyPath !== "/api/health/ready" ||
    health?.versionPath !== "/api/version" ||
    typeof health.version !== "string" || !health.version ||
    health.staticAsset?.url !== "/" ||
    health.staticAsset?.path !== "dist/client/index.html" ||
    !sha256Pattern.test(health.staticAsset?.sha256 ?? "") ||
    !Number.isSafeInteger(health.staticAsset?.size) || health.staticAsset.size <= 0 ||
    health.staticAsset.size > MAXIMUM_STATIC_HEALTH_BYTES
  ) fail("RELEASE_MANIFEST_INVALID", "Release three-layer health contract is invalid");
  normalizedRelativePath(health.staticAsset.path, "Static health asset");
  const legacyStatic = health.legacySchema37StaticAsset;
  if (
    bridge
      ? legacyStatic?.url !== "/" ||
        legacyStatic?.path !== "legacy-runtime/dist/client/index.html" ||
        !sha256Pattern.test(legacyStatic?.sha256 ?? "") ||
        !Number.isSafeInteger(legacyStatic?.size) || legacyStatic.size <= 0 ||
        legacyStatic.size > MAXIMUM_STATIC_HEALTH_BYTES
      : legacyStatic !== undefined
  ) {
    fail(
      "RELEASE_MANIFEST_INVALID",
      "Release schema-37 static health contract is invalid",
    );
  }
  if (bridge) {
    normalizedRelativePath(
      legacyStatic.path,
      "Schema-37 static health asset",
    );
    if (legacyStatic.path === health.staticAsset.path) {
      fail("RELEASE_MANIFEST_INVALID", "Schema-37 and current static health assets must differ");
    }
  }
}

function validatePrerequisites(manifest) {
  const entries = manifest.hostPrerequisites?.executables;
  if (
    !Array.isArray(entries) || entries.length !== 3 ||
    JSON.stringify(entries.map((entry) => entry.name).sort()) !==
      JSON.stringify(["ffmpeg", "ffprobe", "node"])
  ) fail("RELEASE_MANIFEST_INVALID", "Release host prerequisites are incomplete");
  const exact = Object.freeze({
    ffmpeg: Object.freeze({
      arguments: ["-version"],
      path: "/usr/bin/ffmpeg",
      versionPattern: "^ffmpeg version [^\\r\\n]+(?:\\r?\\n[\\s\\S]*)?$",
    }),
    ffprobe: Object.freeze({
      arguments: ["-version"],
      path: "/usr/bin/ffprobe",
      versionPattern: "^ffprobe version [^\\r\\n]+(?:\\r?\\n[\\s\\S]*)?$",
    }),
    node: Object.freeze({
      arguments: ["--version"],
      path: "/opt/node22/bin/node",
      versionPattern: "^v22\\.23\\.1$",
    }),
  });
  for (const entry of entries) {
    const expected = exact[entry.name];
    if (!expected) fail("RELEASE_MANIFEST_INVALID", "Release executable prerequisite name is unknown");
    if (
      entry.required !== true || entry.path !== expected.path ||
      JSON.stringify(entry.arguments) !== JSON.stringify(expected.arguments) ||
      !sha256Pattern.test(entry.sha256 ?? "") ||
      !sha256Pattern.test(entry.versionOutputSha256 ?? "") ||
      entry.versionPattern !== expected.versionPattern
    ) fail("RELEASE_MANIFEST_INVALID", "Release executable prerequisite is malformed");
    try {
      new RegExp(entry.versionPattern);
    } catch {
      fail("RELEASE_MANIFEST_INVALID", `${entry.name} version pattern is invalid`);
    }
  }
  const sandbox = manifest.hostPrerequisites?.sandbox;
  if (
    sandbox?.name !== "bwrap" || sandbox?.path !== "/usr/bin/bwrap" ||
    sandbox?.required !== true ||
    JSON.stringify(sandbox.arguments) !== JSON.stringify(["--version"]) ||
    !sha256Pattern.test(sandbox.sha256 ?? "") ||
    !sha256Pattern.test(sandbox.versionOutputSha256 ?? "") ||
    sandbox.versionPattern !== "^bubblewrap [0-9]+\\.[0-9]+(?:\\.[0-9]+)?$"
  ) fail("RELEASE_MANIFEST_INVALID", "Production sandbox prerequisite is malformed");
}

async function inventoryRelease(releaseDirectory) {
  const inventory = [];
  const budget = { bytes: 0, entries: 0 };
  async function visit(directory, prefix = "", depth = 0) {
    if (depth > MAXIMUM_TREE_DEPTH) {
      fail("RELEASE_MANIFEST_INVALID", "Release inventory is too deep");
    }
    const directoryBefore = await lstat(directory).catch(() => undefined);
    if (!directoryBefore?.isDirectory() || directoryBefore.isSymbolicLink()) {
      fail("RELEASE_MANIFEST_INVALID", "Release inventory directory is unsafe");
    }
    const pinnedDirectory = directoryIdentity(directoryBefore);
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => Buffer.compare(Buffer.from(left.name), Buffer.from(right.name)));
    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (relativePath === "release-manifest.json") continue;
      normalizedRelativePath(relativePath, "Release inventory");
      budget.entries += 1;
      if (
        budget.entries > MAXIMUM_TREE_ENTRIES ||
        Buffer.byteLength(relativePath, "utf8") > MAXIMUM_PATH_BYTES
      ) fail("RELEASE_MANIFEST_INVALID", "Release inventory exceeds its bounded entry budget");
      if (
        relativePath === ".incomplete" || /(^|\/)(\.env(?:\.|$)|data|backups|secrets|test-results|playwright-report)(\/|$)/.test(relativePath)
      ) fail("RELEASE_MANIFEST_INVALID", "Release contains a forbidden mutable or sensitive path");
      const path = join(directory, entry.name);
      const details = await lstat(path);
      if (
        details.isSymbolicLink() || details.uid !== currentUid() ||
        (details.mode & 0o022) !== 0 || (details.isFile() && details.nlink !== 1)
      ) fail("RELEASE_MANIFEST_INVALID", "Release contains unsafe ownership, mode, or links");
      if (details.isDirectory()) {
        inventory.push({ mode: details.mode & 0o777, path: relativePath, type: "directory" });
        await visit(path, relativePath, depth + 1);
      } else if (details.isFile()) {
        budget.bytes += details.size;
        if (details.size > MAXIMUM_FIXED_FILE_BYTES || budget.bytes > MAXIMUM_TREE_BYTES) {
          fail("RELEASE_MANIFEST_INVALID", "Release inventory exceeds its bounded byte budget");
        }
        const bytes = await fixedFile(path, `Release file ${relativePath}`);
        inventory.push({
          mode: details.mode & 0o777,
          path: relativePath,
          sha256: sha256(bytes),
          size: bytes.length,
          type: "file",
        });
      } else fail("RELEASE_MANIFEST_INVALID", "Release contains a special file");
    }
    const directoryAfter = await lstat(directory).catch(() => undefined);
    if (
      !sameDirectoryIdentity(directoryAfter, pinnedDirectory) ||
      directoryAfter.mtimeMs !== pinnedDirectory.mtimeMs ||
      directoryAfter.ctimeMs !== pinnedDirectory.ctimeMs
    ) fail("REHEARSAL_INPUT_CHANGED", "Release directory changed during inventory traversal");
  }
  await visit(releaseDirectory);
  return inventory;
}

async function validateRelease(
  releaseRoot,
  releaseId,
  { allowExactLegacy = false, injectedManifestFailure = false } = {},
) {
  const releaseRootBefore = await lstat(releaseRoot).catch(() => undefined);
  if (!releaseRootBefore?.isDirectory() || releaseRootBefore.isSymbolicLink()) {
    fail("RELEASE_MANIFEST_INVALID", "Release root is unavailable");
  }
  const releaseRootIdentity = directoryIdentity(releaseRootBefore);
  const directory = join(releaseRoot, releaseId);
  const canonicalDirectory = await realpath(directory).catch(() => undefined);
  const root = await realpath(releaseRoot);
  const details = await lstat(directory).catch(() => undefined);
  if (
    canonicalDirectory !== directory || !containsPath(root, directory) ||
    !details?.isDirectory() || details.isSymbolicLink() || details.uid !== currentUid() ||
    (details.mode & 0o777) !== 0o500
  ) fail("RELEASE_MANIFEST_INVALID", "Release directory is not an admitted immutable directory");
  const manifestBytes = await fixedFile(join(directory, "release-manifest.json"), "Release manifest", {
    maximumBytes: MAXIMUM_MANIFEST_BYTES,
    mode: 0o400,
  });
  const manifest = parseDocument(manifestBytes, "Release manifest");
  const exactLegacy = allowExactLegacy && manifest.schemaVersion === 2;
  const releaseRole = exactLegacy ? "legacy" : manifest.releaseRole;
  const expectedVersion = releaseVersionByRole[releaseRole];
  if (
    injectedManifestFailure || manifest.format !== RELEASE_FORMAT ||
    (!exactLegacy && manifest.schemaVersion !== RELEASE_MANIFEST_SCHEMA) ||
    manifest.artifactClass !== "production" || manifest.buildPlatform !== "linux" ||
    manifest.buildArch !== "x64" || manifest.buildLibc !== "glibc" ||
    manifest.releaseId !== releaseId || !commitPattern.test(manifest.commit ?? "") ||
    !commitPattern.test(manifest.sourceTree ?? "") ||
    manifest.nodeVersion !== "22.23.1" || manifest.npmVersion !== "10.9.8" ||
    (exactLegacy
      ? manifest.packageVersion !== "0.5.1" || releaseId !== "v0.5.1"
      : !expectedVersion || releaseId !== `v${expectedVersion}` ||
        manifest.packageVersion !== expectedVersion ||
        manifest.expectedVersion !== expectedVersion ||
        manifest.releaseStage !== releaseRole || manifest.formalReleaseCommit !== true) ||
    manifest.runtime?.health?.version !== manifest.packageVersion ||
    manifest.admission?.directoryMode !== "0500" ||
    manifest.admission?.manifestInventoryVerified !== true ||
    !new Set([
      "marker-absent-directory-0500-manifest-verified",
      "atomic-staging-rename-manifest-verified",
    ]).has(manifest.admission?.rule)
  ) fail("RELEASE_MANIFEST_INVALID", "Release manifest identity or admission is invalid");
  if (!exactLegacy) {
    const expectedCompatibility = releaseRole === "bridge"
      ? {
          activeSchemaVersions: [37, 43],
          migrationMode: "external-one-shot-only",
          rollbackTargetForSchemaVersion: 43,
        }
      : {
          activeSchemaVersions: [43],
          migrationMode: "forbidden-from-final-runtime",
          standbySchemaVersions: [37],
        };
    if (JSON.stringify(manifest.databaseCompatibility) !== JSON.stringify(expectedCompatibility)) {
      fail("RELEASE_MANIFEST_INVALID", "Release database compatibility does not match its role");
    }
  }
  if (
    manifest.build?.networkSandboxVerified !== true ||
    manifest.build?.networkAudit?.blockedAttempts !== 0 ||
    !Number.isSafeInteger(manifest.build?.networkAudit?.guardLoads) ||
    manifest.build.networkAudit.guardLoads < 2 ||
    !sha256Pattern.test(manifest.build?.lockSha256 ?? "") ||
    !sha256Pattern.test(manifest.build?.sandboxProfileSha256 ?? "") ||
    JSON.stringify(manifest.build?.executedSteps) !== JSON.stringify([
      { arguments: ["node_modules/typescript/bin/tsc", "--noEmit"], command: "node" },
      {
        arguments: [
          "node_modules/vite/bin/vite.js",
          "build",
          "--configLoader",
          "runner",
        ],
        command: "node",
      },
    ])
  ) fail("RELEASE_MANIFEST_INVALID", "Release build attestation is incomplete");
  validateRuntimeContract(manifest.runtime, releaseRole);
  if (manifest.runtime.command !== "/opt/node22/bin/node") {
    fail("RELEASE_MANIFEST_INVALID", "Production runtime command is not the pinned Node executable");
  }
  validatePrerequisites(manifest);
  const inventory = await inventoryRelease(directory);
  if (JSON.stringify(inventory) !== JSON.stringify(manifest.files)) {
    fail("RELEASE_MANIFEST_INVALID", "Release inventory does not match its immutable manifest");
  }
  const expectedRuntimeRoots = exactLegacy
    ? [
        "dist",
        "node_modules",
        "client",
        "server",
        "types",
        "vite.config.ts",
        "spec/unboundry-state-fixtures.json",
        "package.json",
        "package-lock.json",
      ]
    : [
        "client",
        "dist",
        ...(releaseRole === "bridge" ? ["legacy-runtime"] : []),
        "node_modules",
        "package-lock.json",
        "package.json",
        ...(releaseRole === "bridge"
          ? [
              ...exactMigrationScriptPaths,
              "scripts/node-typescript-runtime.mjs",
            ]
          : []),
        "server",
        "spec/unboundry-state-fixtures.json",
        "types",
        "vite.config.ts",
      ].sort();
  if (JSON.stringify(manifest.runtimeRoots) !== JSON.stringify(expectedRuntimeRoots)) {
    fail("RELEASE_MANIFEST_INVALID", "Release runtime roots differ from the production contract");
  }
  const inventoryPaths = new Set(inventory.map((entry) => entry.path));
  if (
    expectedRuntimeRoots.some((path) => !inventoryPaths.has(path)) ||
    !inventoryPaths.has("node_modules/vite/bin/vite.js") ||
    !inventoryPaths.has("node_modules/@vitejs/plugin-react/dist/index.js") ||
    [...inventoryPaths].some((path) =>
      path === "node_modules/typescript" || path.startsWith("node_modules/typescript/") ||
      path === "node_modules/@playwright" || path.startsWith("node_modules/@playwright/")
    )
  ) fail("RELEASE_MANIFEST_INVALID", "Release runtime dependency closure is invalid");
  let migrationArtifactSha256;
  if (releaseRole === "bridge") {
    const migrationEntries = exactMigrationScriptPaths.map((path) =>
      inventory.find((entry) => entry.type === "file" && entry.path === path)
    );
    const migrationEntry = migrationEntries[0];
    if (
      manifest.migration?.command !== "/opt/node22/bin/node" ||
      JSON.stringify(manifest.migration?.arguments) !== JSON.stringify(exactMigrationArguments) ||
      manifest.migration?.httpListener !== false ||
      manifest.migration?.permittedReleaseRole !== "bridge" ||
      JSON.stringify(manifest.migration?.placeholders) !==
        JSON.stringify(exactMigrationPlaceholders) ||
      migrationEntries.some((entry) => !entry?.sha256)
    ) fail("RELEASE_MANIFEST_INVALID", "Release migration is not artifact-bound");
    migrationArtifactSha256 = migrationEntry.sha256;
    const legacyEntries = inventory.filter((entry) =>
      entry.path.startsWith("legacy-runtime/")
    ).map((entry) => ({
      ...entry,
      path: entry.path.slice("legacy-runtime/".length),
    }));
    const legacyIndex = legacyEntries.find((entry) =>
      entry.type === "file" && entry.path === "dist/client/index.html"
    );
    const legacyPackage = legacyEntries.find((entry) =>
      entry.type === "file" && entry.path === "package.json"
    );
    const legacyLock = legacyEntries.find((entry) =>
      entry.type === "file" && entry.path === "package-lock.json"
    );
    const legacy = manifest.legacyRuntime;
    if (
      legacy?.tag !== "v0.5.1" || legacy?.version !== "0.5.2" ||
      legacy?.runtimeDependencyResolution !== "parent-release-node_modules" ||
      legacy?.peeledCommit !== exactLegacyRuntimeContract.peeledCommit ||
      legacy?.commitTree !== exactLegacyRuntimeContract.commitTree ||
      legacy?.trackedFiles !== exactLegacyRuntimeContract.trackedFiles ||
      legacy?.archiveSha256 !== exactLegacyRuntimeContract.archiveSha256 ||
      legacy?.originalLockSha256 !== exactLegacySourceLockSha256 ||
      legacy?.originalInventorySha256 !==
        exactLegacyRuntimeContract.originalInventorySha256 ||
      !sha256Pattern.test(legacy?.inventorySha256 ?? "") ||
      !sha256Pattern.test(legacy?.clientIndexSha256 ?? "") ||
      !sha256Pattern.test(legacy?.overlay?.["package.json"] ?? "") ||
      !sha256Pattern.test(legacy?.overlay?.["package-lock.json"] ?? "") ||
      JSON.stringify(Object.keys(legacy?.overlay ?? {}).sort()) !==
        JSON.stringify(["package-lock.json", "package.json"]) ||
      legacy.overlay["package.json"] !== legacyPackage?.sha256 ||
      legacy.overlay["package-lock.json"] !== legacyLock?.sha256 ||
      JSON.stringify(legacy.productionDependencies) !==
        JSON.stringify(exactLegacyProductionDependencies) ||
      legacyEntries.some((entry) =>
        entry.path === "node_modules" || entry.path.startsWith("node_modules/")
      ) ||
      legacy.clientIndexSha256 !== legacyIndex?.sha256 ||
      legacy.inventorySha256 !== sha256(Buffer.from(JSON.stringify(legacyEntries))) ||
      legacy.build?.networkSandboxVerified !== true ||
      legacy.build?.networkAudit?.blockedAttempts !== 0 ||
      !Number.isSafeInteger(legacy.build?.networkAudit?.guardLoads) ||
      legacy.build.networkAudit.guardLoads < 6 ||
      JSON.stringify(legacy.build.networkAudit) !==
        JSON.stringify(manifest.build.networkAudit) ||
      legacy.build?.sourceLockSha256 !== exactLegacySourceLockSha256 ||
      legacy.build?.lockSha256 !== legacy.overlay["package-lock.json"] ||
      !sha256Pattern.test(legacy.build?.dependencyInventorySha256 ?? "") ||
      legacy.build?.sandboxProfileSha256 !== manifest.build.sandboxProfileSha256 ||
      legacy.build?.parentDependencyConfigLoadSmoke !== true ||
      legacy.build?.workingDirectory !== "exact-v0.5.1-version-overlay" ||
      JSON.stringify(legacy.build?.executedSteps) !== JSON.stringify(exactLegacyBuildSteps)
    ) fail("RELEASE_MANIFEST_INVALID", "Bridge legacy runtime is incomplete or unbound");
  } else if (releaseRole === "final") {
    if (
      manifest.migration !== undefined || manifest.legacyRuntime !== undefined ||
      [...inventoryPaths].some((path) =>
        path === "legacy-runtime" || path.startsWith("legacy-runtime/") ||
        path === "scripts" || path.startsWith("scripts/")
      )
    ) fail("RELEASE_MANIFEST_INVALID", "Final release must not publish bridge-only artifacts");
  }
  const staticEntry = inventory.find((entry) =>
    entry.type === "file" && entry.path === manifest.runtime.health.staticAsset.path
  );
  if (
    staticEntry?.sha256 !== manifest.runtime.health.staticAsset.sha256 ||
    staticEntry?.size !== manifest.runtime.health.staticAsset.size
  ) fail("RELEASE_MANIFEST_INVALID", "Static health artifact is not bound to the manifest");
  if (releaseRole === "bridge") {
    const legacyStatic = manifest.runtime.health.legacySchema37StaticAsset;
    const legacyStaticEntry = inventory.find((entry) =>
      entry.type === "file" && entry.path === legacyStatic.path
    );
    if (
      legacyStaticEntry?.sha256 !== legacyStatic.sha256 ||
      legacyStaticEntry?.size !== legacyStatic.size
    ) {
      fail(
        "RELEASE_MANIFEST_INVALID",
        "Schema-37 static health artifact is not bound to the manifest",
      );
    }
  }
  const directoryAfter = await lstat(directory).catch(() => undefined);
  const releaseRootAfter = await lstat(releaseRoot).catch(() => undefined);
  if (
    !sameDirectoryIdentity(directoryAfter, directoryIdentity(details)) ||
    directoryAfter.mtimeMs !== details.mtimeMs || directoryAfter.ctimeMs !== details.ctimeMs ||
    !sameDirectoryIdentity(releaseRootAfter, releaseRootIdentity) ||
    releaseRootAfter.mtimeMs !== releaseRootIdentity.mtimeMs ||
    releaseRootAfter.ctimeMs !== releaseRootIdentity.ctimeMs
  ) fail("REHEARSAL_INPUT_CHANGED", "Release root or directory changed during validation");
  return Object.freeze({
    directory,
    directoryIdentity: directoryIdentity(details),
    manifest,
    manifestSha256: sha256(manifestBytes),
    migrationArtifactSha256,
    releaseRole,
  });
}

async function readCurrentRelease(options) {
  const details = await lstat(options.currentLink).catch(() => undefined);
  if (!details?.isSymbolicLink() || details.uid !== currentUid()) {
    fail("CURRENT_POINTER_INVALID", "Current pointer must be a current-user symbolic link");
  }
  const target = await readlink(options.currentLink);
  if (!releaseIdPattern.test(target) || target === "." || target === "..") {
    fail("CURRENT_POINTER_INVALID", "Current pointer must name one direct release id");
  }
  const resolved = await realpath(options.currentLink).catch(() => undefined);
  if (resolved !== join(options.releaseRoot, target)) {
    fail("CURRENT_POINTER_INVALID", "Current pointer escapes the release root");
  }
  return Object.freeze({
    id: target,
    identity: Object.freeze({ dev: details.dev, ino: details.ino, uid: details.uid }),
  });
}

function sameIdentity(details, identity) {
  return details?.dev === identity.dev && details?.ino === identity.ino && details?.uid === identity.uid;
}

function syncDirectory(path) {
  const descriptor = openSync(path, fileConstants.O_RDONLY | (fileConstants.O_NOFOLLOW ?? 0));
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

async function probePointerPublication(options, oldId, candidateId) {
  try {
    const current = await readCurrentRelease(options);
    return Object.freeze({
      current,
      id: current.id,
      state: current.id === candidateId
        ? "candidate"
        : (current.id === oldId ? "old" : "foreign"),
    });
  } catch {
    return Object.freeze({ id: undefined, state: "unknown" });
  }
}

function publicationFailure(error, publication) {
  const failure = new RehearsalError(
    "CURRENT_PUBLICATION_POST_RENAME_FAILED",
    `Atomic current publication failed after rename; observed pointer state is ${publication.state}: ${
      error instanceof Error ? error.message : "unknown post-rename failure"
    }`,
  );
  failure.publication = publication;
  failure.cause = error;
  return failure;
}

async function atomicSwitch(
  options,
  current,
  candidateId,
  reservation,
  { allowSafeCheckpoint = true } = {},
) {
  // The O_EXCL reservation serializes every supported rehearsal writer. The
  // identity check detects an outside change that completed before the final
  // rename, but it is deliberately not represented as a kernel CAS against an
  // arbitrary same-UID process that ignores the private-root reservation.
  const temporary = `${options.currentLink}.next-${process.pid}-${randomBytes(8).toString("hex")}`;
  let renamed = false;
  try {
    await assertOperationReservation(reservation);
    await symlink(candidateId, temporary);
    syncDirectory(dirname(options.currentLink));
    if (allowSafeCheckpoint) {
      await runSafeCheckpoint(options, "current-race-before-rename", {
        competitorId: current.id,
      });
    }
    const currentNow = await lstat(options.currentLink).catch(() => undefined);
    const targetNow = await readlink(options.currentLink).catch(() => undefined);
    if (!currentNow?.isSymbolicLink() || !sameIdentity(currentNow, current.identity) || targetNow !== current.id) {
      fail("CURRENT_POINTER_CHANGED", "Current pointer changed before atomic publication");
    }
    await assertOperationReservation(reservation);
    await rename(temporary, options.currentLink);
    renamed = true;
    if (allowSafeCheckpoint) {
      await runSafeCheckpoint(options, "post-rename-publication-failure");
    }
    syncDirectory(dirname(options.currentLink));
    await assertOperationReservation(reservation);
    const after = await readCurrentRelease(options);
    if (after.id !== candidateId) fail("CURRENT_POINTER_CHANGED", "Atomic current publication failed");
    return Object.freeze({ ...after, publicationState: "candidate" });
  } catch (error) {
    if (renamed) {
      const publication = await probePointerPublication(options, current.id, candidateId);
      throw publicationFailure(error, publication);
    }
    throw error;
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}

async function readDataContracts(options) {
  const stateSnapshot = await fixedFileSnapshot(options.databaseState, "Synthetic database state", {
    maximumBytes: MAXIMUM_CONTROL_FILE_BYTES,
    mode: 0o600,
  });
  const stateBytes = stateSnapshot.bytes;
  const state = parseDocument(stateBytes, "Synthetic database state");
  if (
    state.format !== STATE_FORMAT || !new Set([37, 41]).has(state.schemaVersion) ||
    !releaseIdPattern.test(state.bridgeReleaseId ?? "") ||
    !releaseIdPattern.test(state.exactOldReleaseId ?? "") ||
    !releaseIdPattern.test(state.finalReleaseId ?? "") ||
    new Set([
      state.bridgeReleaseId,
      state.exactOldReleaseId,
      state.finalReleaseId,
    ]).size !== 3
  ) fail("DATA_STATE_INVALID", "Synthetic data state is invalid");
  const backupSnapshot = await fixedFileSnapshot(options.backupReceipt, "Frozen backup receipt", {
    maximumBytes: MAXIMUM_CONTROL_FILE_BYTES,
    mode: 0o400,
  });
  const backupBytes = backupSnapshot.bytes;
  const backup = parseDocument(backupBytes, "Frozen backup receipt");
  if (
    backup.format !== BACKUP_FORMAT || backup.frozen !== true || backup.schemaVersion !== 37 ||
    !sha256Pattern.test(backup.databaseStateSha256 ?? "") ||
    backup.activeGenerationTasks !== 0 || backup.providerAdmissionsAfterQuietSince !== 0 ||
    !Number.isSafeInteger(backup.generationAdmissionQuietSinceEpochMs) ||
    Date.now() - backup.generationAdmissionQuietSinceEpochMs < REQUIRED_QUIET_MILLISECONDS
  ) fail("BACKUP_RECEIPT_INVALID", "Frozen backup and 60-second admission quiet receipt is invalid");
  if (state.schemaVersion === 37 && backup.databaseStateSha256 !== sha256(stateBytes)) {
    fail("BACKUP_RECEIPT_INVALID", "Frozen backup receipt does not bind the pre-migration state");
  }
  return Object.freeze({
    backup,
    backupSha256: backupSnapshot.sha256,
    backupIdentity: backupSnapshot.identity,
    initialStateBytes: stateBytes,
    initialStateIdentity: stateSnapshot.identity,
    initialStateSha256: stateSnapshot.sha256,
    state,
  });
}

async function assertDataContractsUnchanged(options, contracts) {
  const [state, backup] = await Promise.all([
    fixedFileSnapshot(options.databaseState, "Synthetic database state", {
      maximumBytes: MAXIMUM_CONTROL_FILE_BYTES,
      mode: 0o600,
    }),
    fixedFileSnapshot(options.backupReceipt, "Frozen backup receipt", {
      maximumBytes: MAXIMUM_CONTROL_FILE_BYTES,
      mode: 0o400,
    }),
  ]);
  if (
    state.sha256 !== contracts.initialStateSha256 ||
    !samePinnedFileIdentity(state.identity, contracts.initialStateIdentity) ||
    backup.sha256 !== contracts.backupSha256 ||
    !samePinnedFileIdentity(backup.identity, contracts.backupIdentity)
  ) fail("REHEARSAL_INPUT_CHANGED", "Synthetic state or backup changed before execution");
}

async function readSyntheticSequence(
  options,
  currentRelease,
  candidateRelease,
  contracts,
  { nowEpochMs = Date.now() } = {},
) {
  const snapshot = await fixedFileSnapshot(
    options.sequencingReceipt,
    "Synthetic sequencing receipt",
    { maximumBytes: MAXIMUM_CONTROL_FILE_BYTES, mode: 0o400 },
  );
  const receipt = parseDocument(snapshot.bytes, "Synthetic sequencing receipt");
  const expectedBackupSha256 = options.operation === "bridge-switch"
    ? null
    : contracts.backupSha256;
  if (
    receipt.format !== SEQUENCING_FORMAT || receipt.evidenceClass !== "synthetic" ||
    !sha256Pattern.test(receipt.syntheticSequenceId ?? "") ||
    !sha256Pattern.test(receipt.syntheticNonce ?? "") ||
    !Number.isSafeInteger(receipt.issuedAtEpochMs) ||
    !Number.isSafeInteger(receipt.expiresAtEpochMs) ||
    receipt.issuedAtEpochMs > nowEpochMs || receipt.expiresAtEpochMs <= nowEpochMs ||
    receipt.expiresAtEpochMs - receipt.issuedAtEpochMs > 5 * 60_000 ||
    receipt.operation !== options.operation ||
    receipt.currentReleaseId !== currentRelease.manifest.releaseId ||
    receipt.candidateReleaseId !== options.candidateId ||
    receipt.currentManifestSha256 !== currentRelease.manifestSha256 ||
    receipt.candidateManifestSha256 !== candidateRelease.manifestSha256 ||
    receipt.databaseStateSha256 !== contracts.initialStateSha256 ||
    receipt.backupReceiptSha256 !== expectedBackupSha256 ||
    receipt.schemaVersion !== contracts.state.schemaVersion
  ) fail("SEQUENCING_RECEIPT_INVALID", "Synthetic sequencing receipt does not bind this exact transition");
  return Object.freeze({
    expiresAtEpochMs: receipt.expiresAtEpochMs,
    identity: snapshot.identity,
    nonce: receipt.syntheticNonce,
    sequenceId: receipt.syntheticSequenceId,
    sha256: snapshot.sha256,
  });
}

async function assertSyntheticSequenceCurrent(
  options,
  sequence,
  currentRelease,
  candidateRelease,
  contracts,
  { forceExactExpiry = false } = {},
) {
  const refreshed = await readSyntheticSequence(
    options,
    currentRelease,
    candidateRelease,
    contracts,
    { nowEpochMs: forceExactExpiry ? sequence.expiresAtEpochMs : Date.now() },
  );
  if (
    refreshed.sha256 !== sequence.sha256 || refreshed.nonce !== sequence.nonce ||
    refreshed.sequenceId !== sequence.sequenceId ||
    refreshed.expiresAtEpochMs !== sequence.expiresAtEpochMs ||
    !samePinnedFileIdentity(refreshed.identity, sequence.identity)
  ) {
    fail(
      "SEQUENCING_RECEIPT_CHANGED",
      "Synthetic sequencing receipt changed before an authorized transition mutation",
    );
  }
  return refreshed;
}

async function assertExpectedDataState(options, expected) {
  const current = await fixedFileSnapshot(options.databaseState, "Synthetic database state", {
    maximumBytes: MAXIMUM_CONTROL_FILE_BYTES,
    mode: 0o600,
  });
  if (
    current.sha256 !== expected.sha256 ||
    !samePinnedFileIdentity(current.identity, expected.identity)
  ) fail("DATA_STATE_CHANGED", "Synthetic database state changed before pointer publication");
}

async function atomicWriteJson(options, path, document, expected, reservation, mode = 0o600) {
  // Supported writers share the pinned O_EXCL reservation. Fixed snapshots
  // detect outside changes completed before publication; arbitrary same-UID
  // writers that ignore the private-root reservation are outside this synthetic
  // rehearsal's concurrency contract and are not described as an atomic CAS.
  const temporary = `${path}.next-${process.pid}-${randomBytes(8).toString("hex")}`;
  const bytes = `${JSON.stringify(document, null, 2)}\n`;
  try {
    await assertOperationReservation(reservation);
    const before = await fixedFileSnapshot(path, "Synthetic database state", {
      maximumBytes: MAXIMUM_CONTROL_FILE_BYTES,
      mode,
    });
    if (
      before.sha256 !== expected.sha256 ||
      !samePinnedFileIdentity(before.identity, expected.identity)
    ) fail("DATA_STATE_CHANGED", "Synthetic database state changed before migration commit");
    await writeFile(temporary, bytes, { flag: "wx", mode });
    const descriptor = openSync(temporary, fileConstants.O_RDONLY | (fileConstants.O_NOFOLLOW ?? 0));
    try {
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    await runSafeCheckpoint(options, "state-race-before-rename", { path });
    const immediatelyBeforeRename = await fixedFileSnapshot(path, "Synthetic database state", {
      maximumBytes: MAXIMUM_CONTROL_FILE_BYTES,
      mode,
    });
    if (
      immediatelyBeforeRename.sha256 !== expected.sha256 ||
      !samePinnedFileIdentity(immediatelyBeforeRename.identity, expected.identity)
    ) fail("DATA_STATE_CHANGED", "Synthetic database state lost its compare-and-swap race");
    await assertOperationReservation(reservation);
    await rename(temporary, path);
    syncDirectory(dirname(path));
    await assertOperationReservation(reservation);
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
  const published = await fixedFileSnapshot(path, "Migrated synthetic database state", {
    maximumBytes: MAXIMUM_CONTROL_FILE_BYTES,
    mode,
  });
  if (published.sha256 !== sha256(Buffer.from(bytes))) {
    fail("DATA_STATE_CHANGED", "Synthetic database state publication was replaced");
  }
  return published;
}

async function writeFrozenReceipt(path, document, parentIdentity, checkpointOptions) {
  const temporary = `${path}.next-${process.pid}-${randomBytes(8).toString("hex")}`;
  const bytes = `${JSON.stringify(document, null, 2)}\n`;
  try {
    if (await lstat(path).then(() => true, (error) => {
      if (error?.code !== "ENOENT") throw error;
      return false;
    })) {
      fail("RECEIPT_TARGET_EXISTS", "Synthetic evidence receipt already exists");
    }
    await writeFile(temporary, bytes, { flag: "wx", mode: 0o400 });
    const descriptor = openSync(temporary, fileConstants.O_RDONLY | (fileConstants.O_NOFOLLOW ?? 0));
    try {
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    await assertPinnedDirectory(dirname(path), parentIdentity, "Receipt parent");
    if (await lstat(path).then(() => true, (error) => {
      if (error?.code !== "ENOENT") throw error;
      return false;
    })) {
      fail("RECEIPT_TARGET_EXISTS", "Synthetic evidence receipt appeared before publication");
    }
    // Hard-link publication is the POSIX no-replace primitive available here:
    // unlike rename(), it fails atomically if another receipt already exists.
    await link(temporary, path);
    // A successful no-replace link is the terminal publication commit point.
    // From here onward the command must not report an ordinary failure while a
    // visible PASS/FAIL document remains. Directory sync and temporary-link
    // cleanup are still attempted, but an error after the commit point is not
    // reclassified as a failed rehearsal with contradictory frozen evidence.
    try {
      if (checkpointOptions) {
        await runSafeCheckpoint(checkpointOptions, "receipt-post-link-commit");
      }
      syncDirectory(dirname(path));
    } catch {
      // Publication is already atomically visible and therefore committed.
    }
    await rm(temporary, { force: true }).catch(() => {});
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}

function waitForChildMessage(child) {
  return new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(() => {
      reject(new RehearsalError("FAKE_SERVER_START_FAILED", "Fake server did not become ready"));
    }, 5_000);
    child.once("message", (message) => {
      clearTimeout(timeout);
      if (!message || message.type !== "ready" || !Number.isInteger(message.port)) {
        reject(new RehearsalError("FAKE_SERVER_START_FAILED", "Fake server readiness is malformed"));
      } else resolvePromise(message);
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      reject(new RehearsalError(
        "FAKE_SERVER_START_FAILED",
        `Fake server exited before readiness (${code ?? signal})`,
      ));
    });
  });
}

async function startFakeServer(release, statePath, role, failure = "none") {
  const child = spawn(process.execPath, [scriptPath, "--internal-fake-server"], {
    detached: true,
    env: {
      HOME: "/var/empty",
      LANG: "C",
      LC_ALL: "C",
      PATH: "/usr/bin:/bin",
      UNBOUNDRY_M95_FAILURE: failure,
      UNBOUNDRY_M95_MANIFEST: join(release.directory, "release-manifest.json"),
      UNBOUNDRY_M95_RELEASE_DIR: release.directory,
      UNBOUNDRY_M95_ROLE: role,
      UNBOUNDRY_M95_STATE: statePath,
    },
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    if (stderr.length < 64 * 1024) stderr += chunk.toString("utf8");
  });
  const message = await waitForChildMessage(child);
  return {
    child,
    origin: `http://127.0.0.1:${message.port}`,
    pid: message.pid,
    role,
    statePath,
    stderr: () => stderr,
  };
}

async function fetchWithDeadline(url, init = {}) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(3_000) });
}

function staticHealthAsset(release, schemaVersion) {
  if (
    release.releaseRole === "bridge" && schemaVersion === 37
  ) return release.manifest.runtime.health.legacySchema37StaticAsset;
  return release.manifest.runtime.health.staticAsset;
}

async function verifyHealth(server, release, expectedRole) {
  const state = parseDocument(
    await readFile(releaseStatePath(server), "utf8"),
    "Synthetic data state",
  );
  const staticAsset = staticHealthAsset(release, state.schemaVersion);
  const staticResponse = await fetchWithDeadline(`${server.origin}/`);
  const staticBytes = Buffer.from(await staticResponse.arrayBuffer());
  if (
    staticResponse.status !== 200 ||
    staticBytes.length !== staticAsset.size ||
    sha256(staticBytes) !== staticAsset.sha256
  ) fail("STATIC_HEALTH_FAILED", "Static artifact health did not match the release manifest");
  const live = await fetchWithDeadline(`${server.origin}${release.manifest.runtime.health.livePath}`);
  if (live.status !== 200) fail("LIVE_HEALTH_FAILED", "Process liveness health failed");
  const version = await fetchWithDeadline(
    `${server.origin}${release.manifest.runtime.health.versionPath}`,
  );
  let versionBody;
  try {
    versionBody = await version.json();
  } catch {
    fail("VERSION_HEALTH_FAILED", "Version health returned malformed JSON");
  }
  if (version.status !== 200 || versionBody.version !== release.manifest.runtime.health.version) {
    fail("VERSION_HEALTH_FAILED", "Version health differs from the immutable manifest");
  }
  const ready = await fetchWithDeadline(`${server.origin}${release.manifest.runtime.health.readyPath}`);
  let readyBody;
  try {
    readyBody = await ready.json();
  } catch {
    fail("READY_HEALTH_FAILED", "Readiness health returned malformed JSON");
  }
  if (
    ready.status !== 200 || readyBody.status !== "ready" || readyBody.role !== expectedRole ||
    readyBody.schemaVersion !== state.schemaVersion ||
    readyBody.version !== release.manifest.runtime.health.version
  ) fail("READY_HEALTH_FAILED", "Readiness health did not prove role, schema, and version");
  return Object.freeze({ live: 200, ready: 200, static: 200 });
}

async function verifyWriteProbe(server) {
  const requestId = `m95-write-probe-${randomBytes(8).toString("hex")}`;
  const response = await fetchWithDeadline(`${server.origin}/save`, {
    body: "synthetic-write-probe",
    headers: { "Idempotency-Key": requestId },
    method: "POST",
  });
  const body = await response.json().catch(() => undefined);
  const metrics = await fetchWithDeadline(`${server.origin}/ops/metrics`)
    .then((value) => value.json());
  if (
    response.status !== 200 || body?.accepted !== true || metrics.draining !== false ||
    metrics.requestIds.filter((value) => value === requestId).length !== 1
  ) fail("WRITE_PROBE_FAILED", "Synthetic active write probe did not commit exactly once");
  return Object.freeze({ accepted: true, attempts: 1, requestId });
}

async function verifyStandbyHealth(server, release) {
  const state = parseDocument(
    await readFile(releaseStatePath(server), "utf8"),
    "Synthetic data state",
  );
  const staticAsset = staticHealthAsset(release, state.schemaVersion);
  const staticResponse = await fetchWithDeadline(`${server.origin}/`);
  const staticBytes = Buffer.from(await staticResponse.arrayBuffer());
  if (
    staticResponse.status !== 200 ||
    staticBytes.length !== staticAsset.size ||
    sha256(staticBytes) !== staticAsset.sha256
  ) fail("STATIC_HEALTH_FAILED", "Standby static health did not match the release manifest");
  const live = await fetchWithDeadline(`${server.origin}${release.manifest.runtime.health.livePath}`);
  if (live.status !== 200) fail("LIVE_HEALTH_FAILED", "Standby liveness health failed");
  const version = await fetchWithDeadline(
    `${server.origin}${release.manifest.runtime.health.versionPath}`,
  );
  const versionBody = await version.json().catch(() => undefined);
  if (version.status !== 200 || versionBody?.version !== release.manifest.runtime.health.version) {
    fail("VERSION_HEALTH_FAILED", "Standby version health differs from the immutable manifest");
  }
  const ready = await fetchWithDeadline(`${server.origin}${release.manifest.runtime.health.readyPath}`);
  const readyBody = await ready.json().catch(() => undefined);
  if (ready.status !== 503 || readyBody?.status !== "role-blocked" || readyBody?.role !== "standby") {
    fail("READY_HEALTH_FAILED", "Standby must remain explicitly blocked from traffic readiness");
  }
  return Object.freeze({ live: 200, ready: 503, static: 200, version: 200 });
}

function releaseStatePath(server) {
  return server.statePath;
}

async function stopFakeServer(server) {
  if (!server || server.child.exitCode !== null || server.child.signalCode !== null) return;
  try {
    process.kill(-server.child.pid, "SIGTERM");
  } catch (error) {
    if (!error || typeof error !== "object" || error.code !== "ESRCH") throw error;
  }
  await new Promise((resolvePromise) => {
    const timeout = setTimeout(() => {
      try {
        process.kill(-server.child.pid, "SIGKILL");
      } catch (error) {
        if (!error || typeof error !== "object" || error.code !== "ESRCH") throw error;
      }
    }, 5_000);
    server.child.once("exit", () => {
      clearTimeout(timeout);
      resolvePromise();
    });
  });
}

async function startSyntheticProxy(upstreamOrigin) {
  const { createServer } = await import("node:http");
  const attempts = [];
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/ops/metrics") {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ attempts }));
      return;
    }
    if (!new Set(["GET", "POST"]).has(request.method) ||
        !new Set(["/asset", "/save"]).has(url.pathname)) {
      response.statusCode = 404;
      response.end("synthetic proxy route not found");
      return;
    }
    const requestId = String(
      request.headers["idempotency-key"] ??
      request.headers["x-synthetic-request-id"] ??
      `m95-proxy-${randomBytes(8).toString("hex")}`,
    );
    const bodyChunks = [];
    let bodyBytes = 0;
    for await (const chunk of request) {
      bodyBytes += chunk.length;
      if (bodyBytes > MAXIMUM_CONTROL_FILE_BYTES) {
        response.statusCode = 413;
        response.end("synthetic proxy request too large");
        return;
      }
      bodyChunks.push(chunk);
    }
    const body = Buffer.concat(bodyChunks);
    const maximumAttempts = request.method === "GET" ? 2 : 1;
    let upstreamResponse;
    for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
      upstreamResponse = await fetchWithDeadline(`${upstreamOrigin}${url.pathname}${url.search}`, {
        body: request.method === "POST" ? body : undefined,
        headers: {
          ...(request.headers.range ? { Range: request.headers.range } : {}),
          "Idempotency-Key": requestId,
          "X-Synthetic-Request-Id": requestId,
        },
        method: request.method,
      });
      attempts.push(Object.freeze({
        attempt,
        method: request.method,
        requestId,
        status: upstreamResponse.status,
      }));
      if (request.method !== "GET" || upstreamResponse.status < 500 || attempt === maximumAttempts) {
        break;
      }
      await upstreamResponse.body?.cancel();
    }
    const responseBytes = Buffer.from(await upstreamResponse.arrayBuffer());
    if (responseBytes.length > MAXIMUM_STATIC_HEALTH_BYTES) {
      response.statusCode = 502;
      response.end("synthetic proxy upstream response too large");
      return;
    }
    response.statusCode = upstreamResponse.status;
    for (const name of ["content-range", "retry-after"]) {
      const value = upstreamResponse.headers.get(name);
      if (value) response.setHeader(name, value);
    }
    response.end(responseBytes);
  });
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  return Object.freeze({
    close: () => new Promise((resolvePromise, reject) => {
      server.close((error) => error ? reject(error) : resolvePromise());
    }),
    origin: `http://127.0.0.1:${address.port}`,
  });
}

async function waitForActiveRequests(server, count) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const metrics = await fetchWithDeadline(`${server.origin}/ops/metrics`)
      .then((response) => response.json());
    if (metrics.activeDataRequests === count) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  }
  fail("DRAIN_CONTRACT_FAILED", "Synthetic in-flight requests did not reach the barrier");
}

async function exerciseDrain(server) {
  const requestId = `m95-save-${randomBytes(8).toString("hex")}`;
  const transientGetId = `m95-get-${randomBytes(8).toString("hex")}`;
  const rejectedGetId = `m95-drained-get-${randomBytes(8).toString("hex")}`;
  const proxy = await startSyntheticProxy(server.origin);
  try {
    const retriedGet = await fetchWithDeadline(
      `${proxy.origin}/asset?failOnce=${transientGetId}`,
      { headers: { "X-Synthetic-Request-Id": transientGetId } },
    );
    const retriedGetBody = await retriedGet.text();
    const ordinaryGet = fetchWithDeadline(`${proxy.origin}/asset?delay=120`);
    const rangeGet = fetchWithDeadline(`${proxy.origin}/asset?delay=120`, {
      headers: { Range: "bytes=0-3" },
    });
    await waitForActiveRequests(server, 2);
    const drain = await fetchWithDeadline(`${server.origin}/ops/drain`, { method: "POST" });
    const [ordinary, ranged] = await Promise.all([ordinaryGet, rangeGet]);
    const [ordinaryBody, rangeBody] = await Promise.all([ordinary.text(), ranged.text()]);
    const rejectedGet = await fetchWithDeadline(`${proxy.origin}/asset`, {
      headers: { "X-Synthetic-Request-Id": rejectedGetId },
    });
    const post = await fetchWithDeadline(`${proxy.origin}/save`, {
      body: "one-attempt",
      headers: { "Idempotency-Key": requestId },
      method: "POST",
    });
    const readyAfterDrain = await fetchWithDeadline(`${server.origin}/api/health/ready`);
    const [proxyMetrics, serverMetrics] = await Promise.all([
      fetchWithDeadline(`${proxy.origin}/ops/metrics`).then((response) => response.json()),
      fetchWithDeadline(`${server.origin}/ops/metrics`).then((response) => response.json()),
    ]);
    const transientAttempts = proxyMetrics.attempts.filter((entry) =>
      entry.requestId === transientGetId
    );
    const rejectedAttempts = proxyMetrics.attempts.filter((entry) =>
      entry.requestId === rejectedGetId
    );
    const postAttempts = proxyMetrics.attempts.filter((entry) => entry.requestId === requestId);
    if (
      drain.status !== 200 || retriedGet.status !== 200 || retriedGetBody !== "0123456789" ||
      JSON.stringify(transientAttempts.map((entry) => entry.status)) !== "[503,200]" ||
      ordinary.status !== 200 || ordinaryBody !== "0123456789" ||
      ranged.status !== 206 || rangeBody !== "0123" ||
      rejectedGet.status !== 503 || rejectedAttempts.length !== 2 ||
      rejectedAttempts.some((entry) => entry.status !== 503) ||
      post.status !== 503 || postAttempts.length !== 1 || postAttempts[0].status !== 503 ||
      serverMetrics.activeDataRequests !== 0 || serverMetrics.draining !== true ||
      readyAfterDrain.status !== 503
    ) fail("DRAIN_CONTRACT_FAILED", "Synthetic proxy retry or in-flight drain contract failed");
    return Object.freeze({
      getAutomaticallyRetried: true,
      getCompleted: true,
      getRetryAttempts: transientAttempts.length,
      newGetRejectedAfterDrain: true,
      postAttempts: postAttempts.length,
      postAutomaticallyRetried: false,
      postRequestId: requestId,
      postStatus: post.status,
      rangeCompleted: true,
      rangeStatus: ranged.status,
      readinessBlockedAfterDrain: true,
      syntheticProxyActuallyExecuted: true,
    });
  } finally {
    await proxy.close();
  }
}

async function verifyMaintenanceHealth(server, release) {
  const state = parseDocument(
    await readFile(releaseStatePath(server), "utf8"),
    "Synthetic data state",
  );
  const staticAsset = staticHealthAsset(release, state.schemaVersion);
  const staticResponse = await fetchWithDeadline(`${server.origin}/`);
  const staticBytes = Buffer.from(await staticResponse.arrayBuffer());
  const live = await fetchWithDeadline(`${server.origin}${release.manifest.runtime.health.livePath}`);
  const ready = await fetchWithDeadline(`${server.origin}${release.manifest.runtime.health.readyPath}`);
  const dynamic = await fetchWithDeadline(`${server.origin}/save`, {
    body: "must-not-write",
    method: "POST",
  });
  if (
    staticResponse.status !== 200 || staticBytes.length !== staticAsset.size ||
    sha256(staticBytes) !== staticAsset.sha256 ||
    live.status !== 200 || ready.status !== 503 ||
    dynamic.status !== 503 || dynamic.headers.get("retry-after") !== "1"
  ) fail("MAINTENANCE_HEALTH_FAILED", "Maintenance static/dynamic boundary is invalid");
  return Object.freeze({ dynamic: 503, live: 200, ready: 503, retryAfter: "1", static: 200 });
}

function validateSyntheticNginx(candidate) {
  const port = Number(new URL(candidate.origin).port);
  const document = [
    "upstream unboundry_candidate {",
    `  server 127.0.0.1:${port};`,
    "}",
    "location / { proxy_pass http://unboundry_candidate; }",
  ].join("\n");
  if (
    !Number.isInteger(port) || port < 1 || port > 65535 ||
    /server\s+(?!127\.0\.0\.1:)/.test(document) || !document.includes("proxy_pass")
  ) fail("NGINX_VALIDATION_FAILED", "Synthetic nginx target is invalid");
  return Object.freeze({ mode: "local-synthetic-contract", sha256: sha256(document) });
}

async function verifyOldAfterFailure(context) {
  if (!context.currentServer || context.currentServer.child.exitCode !== null) {
    context.currentServer = await startFakeServer(
      context.currentRelease,
      context.options.databaseState,
      "active",
    );
  }
  await verifyHealth(context.currentServer, context.currentRelease, "active");
  const writeProbe = await verifyWriteProbe(context.currentServer);
  return Object.freeze({ healthy: true, writeProbe });
}

async function orchestrate(options) {
  const roots = await assertSafeRoots(options);
  const reservation = await acquireOperationReservation(roots);
  let initialCurrent;
  let contracts;
  const context = {
    candidateServer: undefined,
    currentRelease: undefined,
    currentServer: undefined,
    maintenanceServer: undefined,
    options,
  };
  const steps = [];
  let candidateRelease;
  let drainEvidence;
  let nginxEvidence;
  let pointerAfter;
  let migrationCommitted = false;
  let published = false;
  let sequence;
  let syntheticOldRecovery;
  let reservationReleaseAttempted = false;
  const startedAt = Date.now();
  try {
    await runSafeCheckpoint(options, "crash-after-reservation");
    await runSafeCheckpoint(options, "hold-after-reservation");
    await assertOperationReservation(reservation);
    initialCurrent = await readCurrentRelease(options);
    contracts = await readDataContracts(options);
    pointerAfter = initialCurrent.id;
    if (options.candidateId === initialCurrent.id) {
      fail("REHEARSAL_ARGUMENT_INVALID", "Candidate is already current");
    }
    context.currentRelease = await validateRelease(options.releaseRoot, initialCurrent.id, {
      allowExactLegacy: initialCurrent.id === contracts.state.exactOldReleaseId,
    });
    context.currentServer = await startFakeServer(
      context.currentRelease,
      options.databaseState,
      "active",
    );
    await verifyHealth(context.currentServer, context.currentRelease, "active");
    steps.push("current-three-layer-health");
    if (options.failure === "build") fail("BUILD_STAGE_FAILED", "Injected build failure");
    candidateRelease = await validateRelease(options.releaseRoot, options.candidateId, {
      allowExactLegacy: options.candidateId === contracts.state.exactOldReleaseId,
      injectedManifestFailure: options.failure === "manifest",
    });
    steps.push("candidate-manifest-verified");
    sequence = await readSyntheticSequence(
      options,
      context.currentRelease,
      candidateRelease,
      contracts,
    );
    await assertDataContractsUnchanged(options, contracts);
    steps.push("synthetic-sequencing-receipt-bound-and-current");

    if (options.operation === "rollback") {
      if (contracts.state.schemaVersion === 41 && options.candidateId === contracts.state.exactOldReleaseId) {
        fail(
          "EXACT_OLD_ROLLBACK_FORBIDDEN",
          "Schema 41 cannot roll back to exact v0.5.1; the verified bridge is mandatory",
        );
      }
      if (contracts.state.schemaVersion === 41 && options.candidateId !== contracts.state.bridgeReleaseId) {
        fail("BRIDGE_ROLLBACK_REQUIRED", "Schema 41 rollback target must be the verified bridge release");
      }
      if (
        contracts.state.schemaVersion !== 41 ||
        initialCurrent.id !== contracts.state.finalReleaseId ||
        context.currentRelease.releaseRole !== "final" ||
        candidateRelease.releaseRole !== "bridge"
      ) fail("BRIDGE_ROLLBACK_REQUIRED", "Rollback must switch the final schema 41 release to bridge");
    } else if (options.operation === "bridge-switch") {
      if (
        contracts.state.schemaVersion !== 37 ||
        initialCurrent.id !== contracts.state.exactOldReleaseId ||
        context.currentRelease.releaseRole !== "legacy" ||
        options.candidateId !== contracts.state.bridgeReleaseId ||
        candidateRelease.releaseRole !== "bridge"
      ) {
        fail(
          "BRIDGE_STAGE_INVALID",
          "The first synthetic sequence may only switch exact v0.5.1 to the verified bridge on schema 37",
        );
      }
    } else if (
      contracts.state.schemaVersion !== 37 ||
      initialCurrent.id !== contracts.state.bridgeReleaseId ||
      context.currentRelease.releaseRole !== "bridge" ||
      options.candidateId !== contracts.state.finalReleaseId ||
      candidateRelease.releaseRole !== "final"
    ) {
      fail(
        "MIGRATION_STAGE_INVALID",
        "Schema migration must start on schema 37 with the verified bridge current",
      );
    }

    const healthFailure = new Set(["static-health", "live-health", "ready-health"])
      .has(options.failure) ? options.failure : "none";
    context.candidateServer = await startFakeServer(
      candidateRelease,
      options.databaseState,
      "standby",
      healthFailure,
    );
    await verifyStandbyHealth(context.candidateServer, candidateRelease);
    steps.push("candidate-standby-static-live-version-and-role-blocked-ready-health");

    if (options.operation === "migrate-switch") {
      // The frozen receipt, not SIGTERM, is the migration quiet precondition.
      steps.push("frozen-backup-and-60-second-admission-quiet-verified");
      drainEvidence = await exerciseDrain(context.currentServer);
      steps.push("bridge-get-range-drained-post-not-retried");
      await stopFakeServer(context.currentServer);
      context.currentServer = undefined;
      await stopFakeServer(context.candidateServer);
      context.candidateServer = undefined;
      steps.push("bridge-and-standby-stopped-before-one-shot-migration");
      context.maintenanceServer = await startFakeServer(
        candidateRelease,
        options.databaseState,
        "maintenance",
      );
      await verifyMaintenanceHealth(context.maintenanceServer, candidateRelease);
      steps.push("maintenance-static-200-dynamic-503-retry-after");
      if (options.failure === "migration") {
        fail("MIGRATION_STAGE_FAILED", "Injected one-shot migration failure before commit");
      }
      await assertSyntheticSequenceCurrent(
        options,
        sequence,
        context.currentRelease,
        candidateRelease,
        contracts,
      );
      const migratedState = await atomicWriteJson(options, options.databaseState, {
        ...contracts.state,
        migrationArtifactSha256: context.currentRelease.migrationArtifactSha256,
        migratedFromBackupReceiptSha256: contracts.backupSha256,
        migrationHttpListenerStarted: false,
        migrationManifestSha256: context.currentRelease.manifestSha256,
        migrationReleaseId: context.currentRelease.manifest.releaseId,
        migrationSourceStateSha256: contracts.initialStateSha256,
        schemaVersion: 41,
      }, {
        identity: contracts.initialStateIdentity,
        sha256: contracts.initialStateSha256,
      }, reservation);
      context.expectedState = migratedState;
      migrationCommitted = true;
      steps.push("one-shot-schema39-migration-committed-without-http");
      await stopFakeServer(context.maintenanceServer);
      context.maintenanceServer = undefined;
      context.candidateServer = await startFakeServer(
        candidateRelease,
        options.databaseState,
        "active",
      );
      await verifyHealth(context.candidateServer, candidateRelease, "active");
      steps.push("candidate-restarted-after-migration-three-layer-health");
    } else {
      drainEvidence = await exerciseDrain(context.currentServer);
      await stopFakeServer(context.currentServer);
      context.currentServer = undefined;
      steps.push("old-active-drained-and-stopped-before-next-active");
      await stopFakeServer(context.candidateServer);
      context.candidateServer = await startFakeServer(
        candidateRelease,
        options.databaseState,
        "active",
      );
      await verifyHealth(context.candidateServer, candidateRelease, "active");
      steps.push("next-only-active-restarted-three-layer-health");
    }

    if (options.failure === "nginx-validate") {
      fail("NGINX_VALIDATION_FAILED", "Injected synthetic nginx validation failure");
    }
    nginxEvidence = validateSyntheticNginx(context.candidateServer);
    steps.push("synthetic-nginx-config-validated");
    if (options.failure === "nginx-switch") {
      fail("NGINX_SWITCH_FAILED", "Injected failure before atomic current publication");
    }
    await assertExpectedDataState(options, context.expectedState ?? {
      identity: contracts.initialStateIdentity,
      sha256: contracts.initialStateSha256,
    });
    await assertPinnedDirectory(options.releaseRoot, roots.releaseIdentity, "Release root");
    await assertPinnedDirectory(
      context.currentRelease.directory,
      context.currentRelease.directoryIdentity,
      "Current release directory",
    );
    await assertPinnedDirectory(
      candidateRelease.directory,
      candidateRelease.directoryIdentity,
      "Candidate release directory",
    );
    const [currentDirectoryNow, candidateDirectoryNow] = await Promise.all([
      lstat(context.currentRelease.directory).catch(() => undefined),
      lstat(candidateRelease.directory).catch(() => undefined),
    ]);
    if (
      !sameStrictDirectoryIdentity(currentDirectoryNow, context.currentRelease.directoryIdentity) ||
      !sameStrictDirectoryIdentity(candidateDirectoryNow, candidateRelease.directoryIdentity)
    ) fail("REHEARSAL_INPUT_CHANGED", "Release directory changed before publication");
    await assertOperationReservation(reservation);
    // This full receipt reparse is deliberately the last authorization check before
    // the cooperative CAS pointer mutation: expiry and every bound identity/hash are
    // evaluated again, rather than trusting the snapshot read earlier in the run.
    await assertSyntheticSequenceCurrent(
      options,
      sequence,
      context.currentRelease,
      candidateRelease,
      contracts,
      { forceExactExpiry: options.safeCheckpoint === "sequence-expires-at-publication" },
    );
    await atomicSwitch(options, initialCurrent, options.candidateId, reservation);
    published = true;
    pointerAfter = options.candidateId;
    steps.push("current-pointer-atomically-published");
    if (options.failure === "post-publication-health") {
      await stopFakeServer(context.candidateServer);
      context.candidateServer = undefined;
      fail("POST_PUBLICATION_HEALTH_FAILED", "Injected candidate failure after pointer publication");
    }
    await verifyHealth(context.candidateServer, candidateRelease, "active");
    await verifyWriteProbe(context.candidateServer);
    steps.push("published-candidate-health-and-write-probe");

    if (context.currentServer) {
      drainEvidence = await exerciseDrain(context.currentServer);
      await stopFakeServer(context.currentServer);
      context.currentServer = undefined;
      steps.push("old-release-drained-after-rollback-switch");
    }
    const revalidatedOld = await validateRelease(options.releaseRoot, initialCurrent.id, {
      allowExactLegacy: initialCurrent.id === contracts.state.exactOldReleaseId,
    });
    if (revalidatedOld.manifestSha256 !== context.currentRelease.manifestSha256) {
      fail("RELEASE_RETENTION_FAILED", "N-1 immutable manifest changed after publication");
    }
    const retainedServer = await startFakeServer(
      revalidatedOld,
      options.databaseState,
      "standby",
    );
    try {
      await verifyStandbyHealth(retainedServer, revalidatedOld);
    } finally {
      await stopFakeServer(retainedServer);
    }
    steps.push("n-minus-one-retained");
    const finalStateBytes = await fixedFile(options.databaseState, "Final synthetic database state", {
      mode: 0o600,
    });
    const receipt = Object.freeze({
      evidenceClass: "synthetic",
      format: FORMAT,
      syntheticCandidateManifestSha256: candidateRelease.manifestSha256,
      syntheticConcurrencyBoundary:
        "private-root cooperative O_EXCL reservation; arbitrary same-UID writers excluded",
      syntheticCurrentManifestSha256: context.currentRelease.manifestSha256,
      syntheticDatabaseStateAfterSha256: sha256(finalStateBytes),
      syntheticDatabaseStateBeforeSha256: contracts?.initialStateSha256,
      syntheticDrain: drainEvidence,
      syntheticExecution: Object.freeze({
        hostPrerequisitesActuallyExecuted: false,
        migrationActuallyExecuted: false,
        proxyActuallyExecuted: drainEvidence?.syntheticProxyActuallyExecuted === true,
        productRuntimeActuallyExecuted: false,
        syntheticFakeRuntimeActuallyExecuted: true,
      }),
      syntheticFinishedAtEpochMs: Date.now(),
      syntheticMigration: Object.freeze({
        artifactSha256: options.operation === "migrate-switch"
          ? context.currentRelease.migrationArtifactSha256
          : null,
        bridgeStoppedBeforeMigration: options.operation === "migrate-switch",
        committed: migrationCommitted,
        httpListenerStarted: false,
        manifestSha256: options.operation === "migrate-switch"
          ? context.currentRelease.manifestSha256
          : null,
        quietMillisecondsRequired: REQUIRED_QUIET_MILLISECONDS,
        quietReceiptVerifiedBeforeBridgeStop: true,
        releaseId: options.operation === "migrate-switch"
          ? context.currentRelease.manifest.releaseId
          : null,
        restartAfterCommit: options.operation === "migrate-switch",
      }),
      syntheticNginx: nginxEvidence,
      syntheticOperation: options.operation,
      syntheticReceiptCommitRule: "no-replace-hard-link-is-terminal",
      syntheticRollbackPolicy: Object.freeze({
        afterMigrationBeforeWrites: "verified-bridge-or-forward-fix-only",
        afterWritesResume: "verified-bridge-or-forward-fix-only-no-old-backup-restore",
        beforeMigration: "restore-frozen-schema37-backup-and-keep-bridge",
        exactOldAfterSchema39: "forbidden",
        staticMaintenance: "keep-current-pointer-static-200-dynamic-503-retry-after",
      }),
      syntheticPointerAfter: pointerAfter,
      syntheticPointerBefore: initialCurrent?.id,
      syntheticReleaseRoles: Object.freeze({
        candidate: candidateRelease.releaseRole,
        current: context.currentRelease.releaseRole,
      }),
      syntheticRetainedReleaseIds: Object.freeze([initialCurrent.id, options.candidateId].sort()),
      syntheticSequenceId: sequence.sequenceId,
      syntheticSequenceReceiptSha256: sequence.sha256,
      syntheticStartedAtEpochMs: startedAt,
      syntheticStatus: "passed",
      syntheticSteps: Object.freeze(steps),
    });
    // A PASS receipt is not visible until the pinned operation reservation has
    // been released successfully. This prevents an exit failure during release
    // from coexisting with a durable syntheticStatus=passed document.
    reservationReleaseAttempted = true;
    await releaseOperationReservation(reservation);
    const [currentAfterRelease, stateAfterRelease] = await Promise.all([
      readCurrentRelease(options),
      fixedFile(options.databaseState, "Post-release synthetic database state", {
        mode: 0o600,
      }),
    ]);
    if (
      currentAfterRelease.id !== receipt.syntheticPointerAfter ||
      sha256(stateAfterRelease) !== receipt.syntheticDatabaseStateAfterSha256
    ) {
      fail(
        "REHEARSAL_INPUT_CHANGED",
        "Synthetic transition changed after reservation release and before PASS evidence",
      );
    }
    await writeFrozenReceipt(
      options.receiptPath,
      receipt,
      roots.receiptParentIdentity,
      options,
    );
    return receipt;
  } catch (error) {
    if (context.maintenanceServer) {
      await stopFakeServer(context.maintenanceServer).catch(() => {});
      context.maintenanceServer = undefined;
    }
    if (context.candidateServer) {
      await stopFakeServer(context.candidateServer).catch(() => {});
      context.candidateServer = undefined;
    }
    let pointerObservation = initialCurrent
      ? await probePointerPublication(options, initialCurrent.id, options.candidateId)
      : Object.freeze({ id: undefined, state: "unknown" });
    if (initialCurrent && pointerObservation.state === "candidate") {
      try {
        await atomicSwitch(
          options,
          pointerObservation.current,
          initialCurrent.id,
          reservation,
          { allowSafeCheckpoint: false },
        );
        pointerObservation = await probePointerPublication(
          options,
          initialCurrent.id,
          options.candidateId,
        );
        if (pointerObservation.state !== "old") {
          fail(
            "CURRENT_POINTER_RECOVERY_UNCERTAIN",
            "Candidate pointer rollback did not prove the exact old pointer",
          );
        }
        pointerAfter = initialCurrent.id;
        steps.push("post-publication-failure-pointer-atomically-rolled-back");
      } catch (rollbackError) {
        pointerObservation = await probePointerPublication(
          options,
          initialCurrent.id,
          options.candidateId,
        );
        error = new RehearsalError(
          "CURRENT_POINTER_RECOVERY_UNCERTAIN",
          `Candidate publication was observed but exact-old rollback was not proven: ${
            rollbackError instanceof Error ? rollbackError.message : "unknown rollback failure"
          }`,
        );
      }
    }
    if (context.currentRelease && pointerObservation.state === "old") {
      if (context.currentServer?.role === "active") {
        await stopFakeServer(context.currentServer).catch(() => {});
        context.currentServer = undefined;
      }
      syntheticOldRecovery = await verifyOldAfterFailure(context).catch(() => undefined);
    }
    const currentAfterFailure = await readCurrentRelease(options).catch(() => undefined);
    const finalStateBytes = await fixedFile(options.databaseState, "Final synthetic database state", {
      mode: 0o600,
    }).catch(() => Buffer.alloc(0));
    const code = error instanceof RehearsalError ? error.code : "REHEARSAL_INTERNAL_ERROR";
    const receipt = Object.freeze({
      evidenceClass: "synthetic",
      format: FORMAT,
      syntheticCandidateManifestSha256: candidateRelease?.manifestSha256,
      syntheticConcurrencyBoundary:
        "private-root cooperative O_EXCL reservation; arbitrary same-UID writers excluded",
      syntheticDatabaseStateAfterSha256: finalStateBytes.length ? sha256(finalStateBytes) : undefined,
      syntheticDatabaseStateBeforeSha256: contracts?.initialStateSha256,
      syntheticError: Object.freeze({
        code,
        message: error instanceof Error ? error.message : "Unknown synthetic failure",
      }),
      syntheticExecution: Object.freeze({
        hostPrerequisitesActuallyExecuted: false,
        migrationActuallyExecuted: false,
        proxyActuallyExecuted: drainEvidence?.syntheticProxyActuallyExecuted === true,
        productRuntimeActuallyExecuted: false,
        syntheticFakeRuntimeActuallyExecuted: context.currentRelease !== undefined,
      }),
      syntheticFinishedAtEpochMs: Date.now(),
      syntheticMigrationCommitted: migrationCommitted,
      syntheticOldRecovery,
      syntheticOperation: options.operation,
      syntheticReceiptCommitRule: "no-replace-hard-link-is-terminal",
      syntheticPointerAfter: currentAfterFailure?.id,
      syntheticPointerRecoveryState: pointerObservation.state,
      syntheticPointerBefore: initialCurrent?.id,
      syntheticPointerUnchanged: currentAfterFailure?.id === initialCurrent?.id,
      syntheticSequenceId: sequence?.sequenceId,
      syntheticSequenceReceiptSha256: sequence?.sha256,
      syntheticStartedAtEpochMs: startedAt,
      syntheticStatus: "failed",
      syntheticSteps: Object.freeze(steps),
    });
    await writeFrozenReceipt(
      options.receiptPath,
      receipt,
      roots.receiptParentIdentity,
    ).catch(() => {});
    throw error;
  } finally {
    await stopFakeServer(context.maintenanceServer).catch(() => {});
    await stopFakeServer(context.candidateServer).catch(() => {});
    await stopFakeServer(context.currentServer).catch(() => {});
    if (!reservationReleaseAttempted) await releaseOperationReservation(reservation);
  }
}

async function internalFakeServer() {
  const { createServer } = await import("node:http");
  const manifest = JSON.parse(await readFile(process.env.UNBOUNDRY_M95_MANIFEST, "utf8"));
  const release = Object.freeze({
    manifest,
    releaseRole: manifest.releaseRole ?? "legacy",
  });
  const releaseDirectory = process.env.UNBOUNDRY_M95_RELEASE_DIR;
  const role = process.env.UNBOUNDRY_M95_ROLE;
  const statePath = process.env.UNBOUNDRY_M95_STATE;
  const failure = process.env.UNBOUNDRY_M95_FAILURE ?? "none";
  let draining = role !== "active";
  let activeDataRequests = 0;
  let postAttempts = 0;
  const requestIds = [];
  const failOnceTokens = new Set();
  const drainWaiters = new Set();
  const sockets = new Set();
  const finishDataRequest = () => {
    activeDataRequests -= 1;
    if (activeDataRequests === 0) {
      for (const resolveWaiter of drainWaiters) resolveWaiter();
      drainWaiters.clear();
    }
  };
  const rejectDraining = (response) => {
    response.statusCode = 503;
    response.setHeader("Retry-After", "1");
    response.end(JSON.stringify({ code: "RUNTIME_ROLE_DRAINING" }));
  };
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/") {
      const state = JSON.parse(await readFile(statePath, "utf8"));
      const asset = staticHealthAsset(release, state.schemaVersion);
      const bytes = await readFile(join(releaseDirectory, asset.path));
      response.statusCode = failure === "static-health" ? 500 : 200;
      response.end(failure === "static-health" ? "corrupt" : bytes);
      return;
    }
    if (url.pathname === manifest.runtime.health.livePath) {
      response.statusCode = failure === "live-health" ? 503 : 200;
      response.end(JSON.stringify({ status: "live" }));
      return;
    }
    if (url.pathname === manifest.runtime.health.readyPath) {
      const state = JSON.parse(await readFile(statePath, "utf8"));
      const activeReady = role === "active" && !draining && failure !== "ready-health";
      response.setHeader("Content-Type", "application/json");
      response.statusCode = failure === "ready-health" ? 500 : (activeReady ? 200 : 503);
      response.end(JSON.stringify({
        role,
        schemaVersion: state.schemaVersion,
        status: failure === "ready-health"
          ? "health-failed"
          : (activeReady ? "ready" : "role-blocked"),
        version: manifest.runtime.health.version,
      }));
      return;
    }
    if (url.pathname === "/api/version") {
      response.end(JSON.stringify({ version: manifest.runtime.health.version }));
      return;
    }
    if (url.pathname === "/ops/drain" && request.method === "POST") {
      draining = true;
      if (activeDataRequests > 0) {
        await new Promise((resolvePromise) => drainWaiters.add(resolvePromise));
      }
      response.end(JSON.stringify({ draining: true }));
      return;
    }
    if (url.pathname === "/ops/metrics") {
      response.end(JSON.stringify({ activeDataRequests, draining, postAttempts, requestIds }));
      return;
    }
    if (url.pathname === "/save" && request.method === "POST") {
      postAttempts += 1;
      requestIds.push(request.headers["idempotency-key"] ?? null);
      if (draining) {
        rejectDraining(response);
        return;
      }
      activeDataRequests += 1;
      try {
        response.statusCode = 200;
        response.end(JSON.stringify({ accepted: true }));
      } finally {
        finishDataRequest();
      }
      return;
    }
    if (url.pathname === "/asset" && request.method === "GET") {
      const failOnce = url.searchParams.get("failOnce");
      if (failOnce && !failOnceTokens.has(failOnce)) {
        failOnceTokens.add(failOnce);
        response.statusCode = 503;
        response.setHeader("Retry-After", "0");
        response.end("transient synthetic GET failure");
        return;
      }
      if (draining) {
        rejectDraining(response);
        return;
      }
      activeDataRequests += 1;
      try {
        await new Promise((resolvePromise) => setTimeout(
          resolvePromise,
          Number(url.searchParams.get("delay") ?? 0),
        ));
        const body = "0123456789";
        if (request.headers.range === "bytes=0-3") {
          response.statusCode = 206;
          response.setHeader("Content-Range", "bytes 0-3/10");
          response.end(body.slice(0, 4));
        } else response.end(body);
      } finally {
        finishDataRequest();
      }
      return;
    }
    response.statusCode = 404;
    response.end("not found");
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    process.send?.({ pid: process.pid, port: address.port, type: "ready" });
  });
  const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => {
      for (const socket of sockets) socket.destroy();
      process.exit(1);
    }, 4_000).unref();
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

if (process.argv[2] === "--internal-fake-server") {
  await internalFakeServer();
} else {
  try {
    const result = await orchestrate(parseArguments(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const code = error instanceof RehearsalError ? error.code : "REHEARSAL_INTERNAL_ERROR";
    process.stderr.write(`${JSON.stringify({
      code,
      message: error instanceof Error ? error.message : "Release rehearsal failed",
    })}\n`);
    process.exitCode = 1;
  }
}
