import { constants as fileConstants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import "./node-typescript-runtime.mjs";

const {
  BackupPackageError,
  createEncryptedBackup,
} = await import("../server/backupPackage.ts");
const {
  RuntimeRoleError,
  assertStoppedProcessProof,
  createRuntimeRoleCoordinator,
} = await import("../server/runtimeRole.ts");

const maximumKeyBytes = 64 * 1024;

class CliError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function fail(code, message) {
  throw new CliError(code, message);
}

function normalizedAbsolutePath(value) {
  if (!value || resolve(value) !== value) {
    fail("BACKUP_ARGUMENT_INVALID", "All path arguments must be normalized absolute paths");
  }
  return value;
}

function containsPath(parent, child) {
  const difference = relative(parent, child);
  return difference === "" ||
    (!isAbsolute(difference) &&
      !difference.startsWith(`..${sep}`) && difference !== "..");
}

async function assertKeysOutside(paths, roots) {
  const [canonicalPaths, canonicalRoots] = await Promise.all([
    Promise.all(paths.map((path) => realpath(path).catch(() => path))),
    Promise.all(roots.map((root) => realpath(root).catch(() => root))),
  ]);
  if (canonicalPaths.some((path) =>
    canonicalRoots.some((root) => containsPath(root, path)))) {
    fail("BACKUP_KEY_LOCATION_INVALID", "Key files must be outside backup data and work directories");
  }
}

function parseArguments(argv) {
  const values = new Map();
  const mirrors = [];
  const mediaWarnings = [];
  let sourceFrozen = false;
  let externalFreezeNonFinal = false;
  let historicalRecovery = false;
  let quiescedActivePreservation = false;
  let requireCleanMedia = false;
  const valueOptions = new Set([
    "--allow-media-warning",
    "--backup-root",
    "--data-dir",
    "--expected-database-logical-sha256",
    "--expected-schema-version",
    "--generation-frozen-at",
    "--last-provider-admission-at",
    "--oss-mirror",
    "--recovery-public-key",
    "--retry-backup-id",
    "--previous-pid",
    "--previous-pid-namespace",
    "--previous-pid-start-ticks",
    "--preserved-task-attempt",
    "--preserved-task-id",
    "--runtime-directory",
    "--scratch-root",
    "--signing-private-key",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === "--source-frozen") {
      if (sourceFrozen) fail("BACKUP_ARGUMENT_INVALID", "Duplicate source freeze confirmation");
      sourceFrozen = true;
      continue;
    }
    if (option === "--external-freeze-non-final") {
      if (externalFreezeNonFinal) {
        fail("BACKUP_ARGUMENT_INVALID", "External freeze mode is duplicated");
      }
      externalFreezeNonFinal = true;
      continue;
    }
    if (option === "--historical-recovery") {
      if (historicalRecovery) {
        fail("BACKUP_ARGUMENT_INVALID", "Historical recovery mode is duplicated");
      }
      historicalRecovery = true;
      continue;
    }
    if (option === "--quiesced-active-preservation") {
      if (quiescedActivePreservation) {
        fail("BACKUP_ARGUMENT_INVALID", "Quiesced preservation mode is duplicated");
      }
      quiescedActivePreservation = true;
      continue;
    }
    if (option === "--require-clean-media") {
      if (requireCleanMedia || mediaWarnings.length) {
        fail("BACKUP_ARGUMENT_INVALID", "Media warning policy is duplicated or conflicting");
      }
      requireCleanMedia = true;
      continue;
    }
    if (!valueOptions.has(option)) {
      fail("BACKUP_ARGUMENT_INVALID", "Unknown or misplaced backup argument");
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      fail("BACKUP_ARGUMENT_INVALID", "A backup argument value is missing");
    }
    index += 1;
    if (option === "--oss-mirror") {
      mirrors.push(value);
      continue;
    }
    if (option === "--allow-media-warning") {
      if (
        requireCleanMedia ||
        !/^MEDIA_INTEGRITY_[A-Z0-9_]+$/.test(value) ||
        mediaWarnings.includes(value)
      ) {
        fail("BACKUP_ARGUMENT_INVALID", "Media warning allowlist is invalid");
      }
      mediaWarnings.push(value);
      continue;
    }
    if (values.has(option)) {
      fail("BACKUP_ARGUMENT_INVALID", "Duplicate backup argument");
    }
    values.set(option, value);
  }
  const required = [
    "--backup-root",
    "--data-dir",
    "--recovery-public-key",
    "--signing-private-key",
  ];
  if (!sourceFrozen || required.some((option) => !values.has(option))) {
    fail(
      "BACKUP_ARGUMENT_INVALID",
      "Backup requires explicit source freeze, source, destination, and key arguments",
    );
  }
  return {
    externalFreezeNonFinal,
    historicalRecovery,
    mediaWarnings,
    mirrors,
    quiescedActivePreservation,
    requireCleanMedia,
    sourceFrozen,
    values,
  };
}

function parsePositiveInteger(value, option) {
  if (!value || !/^[0-9]+$/.test(value)) {
    fail("BACKUP_ARGUMENT_INVALID", `${option} must be a decimal integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || String(parsed) !== value) {
    fail("BACKUP_ARGUMENT_INVALID", `${option} is outside the safe integer range`);
  }
  return parsed;
}

function parseQuiescedSourceContract(values, frozenSourceContract) {
  if (!frozenSourceContract) {
    fail(
      "BACKUP_ARGUMENT_INVALID",
      "Quiesced preservation requires a complete frozen source contract",
    );
  }
  const runtimeDirectory = normalizedAbsolutePath(values.get("--runtime-directory"));
  const pid = parsePositiveInteger(values.get("--previous-pid"), "--previous-pid");
  if (pid === process.pid) {
    fail("BACKUP_ARGUMENT_INVALID", "--previous-pid must identify the stopped service");
  }
  const startTicks = values.get("--previous-pid-start-ticks");
  const pidNamespace = values.get("--previous-pid-namespace");
  if (
    !startTicks || !/^[1-9][0-9]*$/.test(startTicks) ||
    !pidNamespace || pidNamespace.length > 128 || pidNamespace.includes("\0")
  ) {
    fail("BACKUP_ARGUMENT_INVALID", "Stopped process proof is incomplete");
  }
  const taskId = values.get("--preserved-task-id");
  if (
    !taskId || taskId.length > 256 || taskId.includes("\0")
  ) {
    fail("BACKUP_ARGUMENT_INVALID", "--preserved-task-id is invalid");
  }
  const executionAttempt = parsePositiveInteger(
    values.get("--preserved-task-attempt"),
    "--preserved-task-attempt",
  );
  return {
    ...frozenSourceContract,
    expectedSchemaVersion: 43,
    preservedTask: { executionAttempt, taskId },
    runtimeDirectory,
    stoppedProcess: { pid, pidNamespace, startTicks },
  };
}

function parseFrozenSourceContract(values, historicalRecovery) {
  const names = [
    "--expected-database-logical-sha256",
    "--expected-schema-version",
    "--generation-frozen-at",
    "--last-provider-admission-at",
  ];
  const present = names.filter((name) => values.has(name));
  if (!present.length) return undefined;
  if (present.length !== names.length) {
    fail(
      "BACKUP_ARGUMENT_INVALID",
      "Frozen source contract requires schema, logical SHA, freeze, and admission evidence",
    );
  }
  const expectedDatabaseLogicalSha256 = values.get(
    "--expected-database-logical-sha256",
  );
  const schemaText = values.get("--expected-schema-version");
  const expectedSchemaVersion = Number(schemaText);
  const generationFrozenAt = values.get("--generation-frozen-at");
  const admissionText = values.get("--last-provider-admission-at");
  const schemaAccepted = historicalRecovery
    ? [37, 38, 39, 40, 41, 42].includes(expectedSchemaVersion)
    : expectedSchemaVersion === 43;
  if (
    !/^[a-f0-9]{64}$/.test(expectedDatabaseLogicalSha256) ||
    !schemaAccepted ||
    String(expectedSchemaVersion) !== schemaText ||
    !generationFrozenAt ||
    !admissionText
  ) {
    fail("BACKUP_ARGUMENT_INVALID", "Frozen source contract is invalid");
  }
  return {
    expectedDatabaseLogicalSha256,
    expectedSchemaVersion,
    freezeEvidence: {
      generationFrozenAt,
      lastProviderAdmissionAt: admissionText === "none" ? null : admissionText,
      sourceDatabaseLogicalSha256: expectedDatabaseLogicalSha256,
    },
  };
}

function parseMirror(value) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    fail("BACKUP_ARGUMENT_INVALID", "OSS mirrors must be JSON objects");
  }
  if (
    !parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
    Object.keys(parsed).sort().join(",") !== "filePath,objectKey,versionId" ||
    typeof parsed.objectKey !== "string" || !parsed.objectKey ||
    typeof parsed.versionId !== "string" || !parsed.versionId ||
    typeof parsed.filePath !== "string" || !parsed.filePath ||
    parsed.objectKey.includes("\0") || parsed.versionId.includes("\0")
  ) {
    fail("BACKUP_ARGUMENT_INVALID", "OSS mirrors require objectKey, versionId, and absolute filePath");
  }
  return {
    filePath: normalizedAbsolutePath(parsed.filePath),
    objectKey: parsed.objectKey,
    versionId: parsed.versionId,
  };
}

function keyMetadataIsSafe(details, role) {
  if (typeof process.getuid !== "function") return false;
  const uid = BigInt(process.getuid());
  const trustedOwner = details.uid === 0n || details.uid === uid;
  const writeProtected = (details.mode & 0o022n) === 0n;
  const privateMode = role !== "private" || (details.mode & 0o077n) === 0n;
  return trustedOwner && writeProtected && privateMode && details.nlink === 1n;
}

async function validateKeyDirectoryChain(path, allowTrustedLinks) {
  if (typeof process.getuid !== "function") {
    fail("BACKUP_KEY_LOCATION_INVALID", "Key ancestry cannot be trusted");
  }
  const uid = BigInt(process.getuid());
  let current = path;
  for (;;) {
    const details = await lstat(current, { bigint: true }).catch(() => undefined);
    const trustedOwner = details && (details.uid === 0n || details.uid === uid);
    const trustedLink = trustedOwner && allowTrustedLinks && details.isSymbolicLink();
    const mode = details ? details.mode & 0o7777n : 0n;
    const trustedDirectory = trustedOwner && details.isDirectory() &&
      ((mode & 0o022n) === 0n ||
        ((mode & 0o1000n) !== 0n && (details.uid === 0n || details.uid === uid)));
    if (!trustedLink && !trustedDirectory) {
      fail("BACKUP_KEY_LOCATION_INVALID", "Key ancestry cannot be trusted");
    }
    const parent = dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

async function assertTrustedKeyAncestry(path) {
  const parent = dirname(path);
  await validateKeyDirectoryChain(parent, true);
  await validateKeyDirectoryChain(await realpath(parent), false);
}

async function readKey(path, role = "anchor") {
  await assertTrustedKeyAncestry(path);
  const details = await lstat(path, { bigint: true }).catch(() => undefined);
  if (
    !details ||
    details.isSymbolicLink() ||
    !details.isFile() ||
    details.size < 1n ||
    details.size > BigInt(maximumKeyBytes) ||
    !keyMetadataIsSafe(details, role)
  ) {
    fail("BACKUP_KEY_INVALID", "A key file is unavailable or invalid");
  }
  let handle;
  let material;
  let overflowProbe;
  try {
    handle = await open(
      path,
      fileConstants.O_RDONLY | (fileConstants.O_NOFOLLOW ?? 0),
    );
    const opened = await handle.stat({ bigint: true });
    if (
      !opened.isFile() ||
      opened.size !== details.size ||
      opened.dev !== details.dev ||
      opened.ino !== details.ino ||
      opened.mtimeNs !== details.mtimeNs ||
      opened.ctimeNs !== details.ctimeNs ||
      !keyMetadataIsSafe(opened, role)
    ) {
      fail("BACKUP_KEY_INVALID", "A key file changed while it was being read");
    }
    if (opened.size > BigInt(maximumKeyBytes)) {
      fail("BACKUP_KEY_INVALID", "A key file exceeds its size limit");
    }
    material = Buffer.alloc(Number(opened.size));
    let position = 0;
    while (position < material.length) {
      const { bytesRead } = await handle.read(
        material,
        position,
        material.length - position,
        position,
      );
      if (!bytesRead) {
        material.fill(0);
        fail("BACKUP_KEY_INVALID", "A key file ended while it was being read");
      }
      position += bytesRead;
    }
    overflowProbe = Buffer.allocUnsafe(1);
    if ((await handle.read(
      overflowProbe,
      0,
      1,
      material.length,
    )).bytesRead !== 0) {
      fail("BACKUP_KEY_INVALID", "A key file expanded past its size limit");
    }
    const after = await handle.stat({ bigint: true });
    if (
      after.size !== opened.size ||
      after.dev !== opened.dev ||
      after.ino !== opened.ino ||
      after.mtimeNs !== opened.mtimeNs ||
      after.ctimeNs !== opened.ctimeNs ||
      !keyMetadataIsSafe(after, role)
    ) {
      material.fill(0);
      fail("BACKUP_KEY_INVALID", "A key file changed while it was being read");
    }
    return material;
  } catch (error) {
    material?.fill(0);
    if (error instanceof CliError) throw error;
    fail("BACKUP_KEY_INVALID", "A key file is unavailable or invalid");
  } finally {
    overflowProbe?.fill(0);
    await handle?.close().catch(() => undefined);
  }
}

function redactPaths(message, paths) {
  let safe = String(message || "Backup failed");
  for (const path of [...paths].sort((left, right) => right.length - left.length)) {
    safe = safe.replaceAll(path, "[path]");
  }
  return safe;
}

let pathArguments = [];
const keyMaterials = [];
let runtimeCoordinator;
let drainStarted = false;
let drainCompleted = false;
try {
  const parsed = parseArguments(process.argv.slice(2));
  const value = (option) => normalizedAbsolutePath(parsed.values.get(option));
  const sourceDirectory = value("--data-dir");
  const backupRoot = value("--backup-root");
  const recoveryPublicKeyPath = value("--recovery-public-key");
  const signingPrivateKeyPath = value("--signing-private-key");
  const frozenSourceContract = parseFrozenSourceContract(
    parsed.values,
    parsed.historicalRecovery,
  );
  if (
    parsed.quiescedActivePreservation &&
    (parsed.historicalRecovery || parsed.externalFreezeNonFinal)
  ) {
    fail(
      "BACKUP_ARGUMENT_INVALID",
      "Quiesced preservation cannot combine historical or external freeze modes",
    );
  }
  if (
    !parsed.quiescedActivePreservation &&
    Boolean(frozenSourceContract) === parsed.externalFreezeNonFinal
  ) {
    fail(
      "BACKUP_ARGUMENT_INVALID",
      "Choose either a complete locked source contract or explicit external non-final freeze mode",
    );
  }
  if (parsed.historicalRecovery && !frozenSourceContract) {
    fail(
      "BACKUP_ARGUMENT_INVALID",
      "Historical recovery requires a complete historical locked source contract",
    );
  }
  const quiescedSourceContract = parsed.quiescedActivePreservation
    ? parseQuiescedSourceContract(parsed.values, frozenSourceContract)
    : undefined;
  const quiescedOnlyArguments = [
    "--previous-pid",
    "--previous-pid-namespace",
    "--previous-pid-start-ticks",
    "--preserved-task-attempt",
    "--preserved-task-id",
    "--runtime-directory",
  ];
  if (
    !parsed.quiescedActivePreservation &&
    quiescedOnlyArguments.some((option) => parsed.values.has(option))
  ) {
    fail(
      "BACKUP_ARGUMENT_INVALID",
      "Quiesced preservation proof arguments require quiesced preservation mode",
    );
  }
  const retryBackupId = parsed.values.get("--retry-backup-id");
  if (
    retryBackupId !== undefined &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      retryBackupId,
    )
  ) {
    fail("BACKUP_ARGUMENT_INVALID", "Backup retry id is invalid");
  }
  const scratchValue = parsed.values.get("--scratch-root");
  const scratchRoot = scratchValue
    ? normalizedAbsolutePath(scratchValue)
    : undefined;
  const ossMirrors = parsed.mirrors.map(parseMirror);
  await assertKeysOutside(
    [recoveryPublicKeyPath, signingPrivateKeyPath],
    [
      sourceDirectory,
      backupRoot,
      ...(quiescedSourceContract ? [quiescedSourceContract.runtimeDirectory] : []),
      ...(scratchRoot ? [scratchRoot] : []),
      ...ossMirrors.map(({ filePath }) => filePath),
    ],
  );
  pathArguments = [
    sourceDirectory,
    backupRoot,
    recoveryPublicKeyPath,
    signingPrivateKeyPath,
    ...(scratchRoot ? [scratchRoot] : []),
    ...(quiescedSourceContract ? [quiescedSourceContract.runtimeDirectory] : []),
    ...ossMirrors.map(({ filePath }) => filePath),
  ];
  if (quiescedSourceContract) {
    assertStoppedProcessProof(quiescedSourceContract.stoppedProcess);
    runtimeCoordinator = createRuntimeRoleCoordinator({
      dataDirectory: sourceDirectory,
      requireExistingLease: true,
      role: "active",
      runtimeDirectory: quiescedSourceContract.runtimeDirectory,
    });
    drainStarted = true;
    const drained = await runtimeCoordinator.beginDrain(120_000);
    if (!drained.drained || drained.activeExecutions !== 0) {
      fail(
        "BACKUP_RUNTIME_DRAIN_FAILED",
        "The stopped runtime did not complete its active execution drain",
      );
    }
    drainCompleted = true;
  }
  const recoveryPublicKey = await readKey(recoveryPublicKeyPath);
  keyMaterials.push(recoveryPublicKey);
  const signingPrivateKey = await readKey(signingPrivateKeyPath, "private");
  keyMaterials.push(signingPrivateKey);
  const result = await createEncryptedBackup({
    backupRoot,
    capturePurpose: parsed.historicalRecovery
      ? "historical-recovery"
      : parsed.quiescedActivePreservation
        ? "quiesced-active-preservation"
        : "current-schema43",
    ...(parsed.quiescedActivePreservation
      ? {
          quiescedRuntimeLease: runtimeCoordinator,
          quiescedSourceContract,
        }
      : { frozenSourceContract }),
    mediaWarningAllowlist:
      parsed.requireCleanMedia || parsed.mediaWarnings.length
        ? parsed.mediaWarnings
        : undefined,
    ossMirrors: ossMirrors.length ? ossMirrors : undefined,
    recoveryPublicKey,
    retryBackupId,
    scratchRoot,
    signingPrivateKey,
    sourceDirectory,
    sourceFrozen: true,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  const known = error instanceof CliError || error instanceof BackupPackageError ||
    error instanceof RuntimeRoleError;
  process.stderr.write(`${JSON.stringify({
    code: known ? error.code : "BACKUP_FAILED",
    message: redactPaths(known ? error.message : "Backup failed", pathArguments),
  })}\n`);
  process.exitCode = 1;
} finally {
  if (runtimeCoordinator) {
    try {
      if (drainCompleted) {
        runtimeCoordinator.releaseAfterDrain();
      } else if (!drainStarted) {
        runtimeCoordinator.close();
      }
    } catch (error) {
      if (process.exitCode === undefined) {
        process.stderr.write(`${JSON.stringify({
          code: error?.code || "BACKUP_RUNTIME_RELEASE_FAILED",
          message: redactPaths(error?.message || "Runtime lease release failed", pathArguments),
        })}\n`);
        process.exitCode = 1;
      }
    }
  }
  for (const material of keyMaterials) material.fill(0);
}
