import { constants as fileConstants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import {
  BackupPackageError,
  createEncryptedBackup,
} from "../server/backupPackage.ts";

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
    (!difference.startsWith(`..${sep}`) && difference !== "..");
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
  let sourceFrozen = false;
  const valueOptions = new Set([
    "--backup-root",
    "--data-dir",
    "--oss-mirror",
    "--recovery-public-key",
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
  return { mirrors, sourceFrozen, values };
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
    const material = await handle.readFile();
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
    if (error instanceof CliError) throw error;
    fail("BACKUP_KEY_INVALID", "A key file is unavailable or invalid");
  } finally {
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
try {
  const parsed = parseArguments(process.argv.slice(2));
  const value = (option) => normalizedAbsolutePath(parsed.values.get(option));
  const sourceDirectory = value("--data-dir");
  const backupRoot = value("--backup-root");
  const recoveryPublicKeyPath = value("--recovery-public-key");
  const signingPrivateKeyPath = value("--signing-private-key");
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
    ...ossMirrors.map(({ filePath }) => filePath),
  ];
  const recoveryPublicKey = await readKey(recoveryPublicKeyPath);
  keyMaterials.push(recoveryPublicKey);
  const signingPrivateKey = await readKey(signingPrivateKeyPath, "private");
  keyMaterials.push(signingPrivateKey);
  const result = await createEncryptedBackup({
    backupRoot,
    ossMirrors: ossMirrors.length ? ossMirrors : undefined,
    recoveryPublicKey,
    scratchRoot,
    signingPrivateKey,
    sourceDirectory,
    sourceFrozen: true,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  const known = error instanceof CliError || error instanceof BackupPackageError;
  process.stderr.write(`${JSON.stringify({
    code: known ? error.code : "BACKUP_FAILED",
    message: redactPaths(known ? error.message : "Backup failed", pathArguments),
  })}\n`);
  process.exitCode = 1;
} finally {
  for (const material of keyMaterials) material.fill(0);
}
