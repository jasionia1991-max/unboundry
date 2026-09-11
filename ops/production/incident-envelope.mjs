/*
 * Incident-active preservation envelope.
 *
 * This module is deliberately independent from server/backupPackage.ts.  The
 * caller must acquire and retain the runtime, secret-document, and database
 * fences for the whole captureEnvelope call.  This module only reads the
 * selected source tree and writes a new private package or scratch restore.
 * It never discovers identifiers, calls a Provider or OSS, starts/stops a
 * process, or writes CURRENT.
 */

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
} from "node:crypto";
import {
  constants as fsConstants,
} from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  realpath,
  rm,
  unlink,
  link,
  rmdir,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const INCIDENT_ENVELOPE_FORMAT = "unboundry-incident-active-preservation";
export const INCIDENT_ENVELOPE_VERSION = 1;
export const INCIDENT_CAPTURE_MODE = "incident-active-preservation";
export const INCIDENT_FINAL_CANDIDATE = false;

const MAX_ENVELOPE_BYTES = 1024 * 1024;
const MAX_MANIFEST_BYTES = 32 * 1024 * 1024;
const MAX_ENTRY_COUNT = 1_000_000;
const MAX_CONTEXT_BYTES = 8 * 1024 * 1024;
const IO_CHUNK_BYTES = 256 * 1024;
const INCOMPLETE_MARKER = ".unboundry-incident-incomplete";
const DOMAIN = "unboundry:incident-active-preservation:v1";
const NO_FOLLOW = "O_NOFOLLOW" in fsConstants ? fsConstants.O_NOFOLLOW : 0;
const RSA_PADDING = cryptoConstants.RSA_PKCS1_OAEP_PADDING;

const DATABASE_FILE_NAMES = new Set([
  "unboundry.sqlite",
  "unboundry.sqlite-journal",
  "unboundry.sqlite-shm",
  "unboundry.sqlite-wal",
  "library.sqlite",
  "library.sqlite-journal",
  "library.sqlite-shm",
  "library.sqlite-wal",
]);

export class IncidentEnvelopeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "IncidentEnvelopeError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new IncidentEnvelopeError(code, message);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stableJson(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("INCIDENT_JSON_INVALID", "JSON contains a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  fail("INCIDENT_JSON_INVALID", "JSON contains an unsupported value");
}

function canonicalJson(value, label = "value") {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("INCIDENT_JSON_INVALID", `${label} contains a non-finite number`);
    return value;
  }
  if (Array.isArray(value)) return value.map((entry, index) => canonicalJson(entry, `${label}[${index}]`));
  if (isObject(value)) {
    const result = {};
    for (const key of Object.keys(value).sort()) {
      if (key.includes("\0")) fail("INCIDENT_JSON_INVALID", `${label} contains an invalid key`);
      result[key] = canonicalJson(value[key], `${label}.${key}`);
    }
    return result;
  }
  fail("INCIDENT_JSON_INVALID", `${label} contains an unsupported value`);
}

function exactKeys(value, expected, label) {
  if (!isObject(value)) fail("INCIDENT_FORMAT_INVALID", `${label} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail("INCIDENT_FORMAT_INVALID", `${label} has unexpected fields`);
  }
}

function normalizedAbsolute(value, label) {
  if (
    typeof value !== "string" ||
    !value ||
    !isAbsolute(value) ||
    resolve(value) !== value ||
    value.includes("\0")
  ) {
    fail("INCIDENT_PATH_INVALID", `${label} must be a normalized absolute path`);
  }
  return value;
}

function containsPath(parent, child) {
  const difference = relative(parent, child);
  return difference === "" || (
    !isAbsolute(difference) &&
    !difference.startsWith(`..${sep}`) &&
    difference !== ".."
  );
}

function assertDisjoint(left, right, label) {
  if (containsPath(left, right) || containsPath(right, left)) {
    fail("INCIDENT_PATH_OVERLAP", `${label} must be disjoint`);
  }
}

function safeLogicalPath(value, label = "logical path") {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 4096 ||
    value.includes("\0") ||
    value.includes("\\") ||
    value.startsWith("/") ||
    value.endsWith("/") ||
    value.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    fail("INCIDENT_PATH_INVALID", `${label} is invalid`);
  }
  return value;
}

function allowedLogicalPath(value, expectedKind, label) {
  const path = safeLogicalPath(value, label);
  const top = path.split("/")[0];
  const databaseFile = DATABASE_FILE_NAMES.has(path);
  const treeFile = top === "media" || top === "secrets" || top === "oss-mirrors";
  if (!databaseFile && !treeFile) fail("INCIDENT_PATH_INVALID", `${label} is outside the DB/media/secrets allowlist`);
  if (databaseFile && expectedKind !== "file") fail("INCIDENT_FORMAT_INVALID", `${label} has an invalid kind`);
  if (treeFile && path === top && expectedKind !== "directory") fail("INCIDENT_FORMAT_INVALID", `${label} has an invalid kind`);
  return path;
}

function validSha(value, label) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    fail("INCIDENT_FORMAT_INVALID", `${label} must be a lowercase SHA-256 value`);
  }
  return value;
}

function validUuid(value, label) {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
  ) {
    fail("INCIDENT_FORMAT_INVALID", `${label} must be a lowercase UUID`);
  }
  return value;
}

function safeInteger(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    fail("INCIDENT_FORMAT_INVALID", `${label} must be a safe integer`);
  }
  return value;
}

function decodeBase64(value, expectedBytes, label) {
  if (typeof value !== "string" || !value || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    fail("INCIDENT_FORMAT_INVALID", `${label} is not canonical base64`);
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== expectedBytes || decoded.toString("base64") !== value) {
    decoded.fill(0);
    fail("INCIDENT_FORMAT_INVALID", `${label} has an invalid length or encoding`);
  }
  return decoded;
}

function decodeCanonicalBase64(value, label) {
  if (typeof value !== "string" || !value || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    fail("INCIDENT_FORMAT_INVALID", `${label} is not canonical base64`);
  }
  const decoded = Buffer.from(value, "base64");
  if (!decoded.length || decoded.toString("base64") !== value) {
    decoded.fill(0);
    fail("INCIDENT_FORMAT_INVALID", `${label} has an invalid encoding`);
  }
  return decoded;
}

function trustedOwner(details) {
  if (typeof process.getuid !== "function") return true;
  return details.uid === 0n || details.uid === BigInt(process.getuid());
}

function assertPrivateMetadata(details, kind, label, exactMode) {
  if (details.isSymbolicLink()) fail("INCIDENT_LINK_REJECTED", `${label} is a symbolic link`);
  if (kind === "directory" && !details.isDirectory()) fail("INCIDENT_SOURCE_INVALID", `${label} is not a directory`);
  if (kind === "file" && !details.isFile()) fail("INCIDENT_SOURCE_INVALID", `${label} is not a regular file`);
  if (!trustedOwner(details) || (details.mode & 0o022n) !== 0n) {
    fail("INCIDENT_PERMISSIONS_INVALID", `${label} is not owned by a trusted identity`);
  }
  if (kind === "file" && details.nlink !== 1n) {
    fail("INCIDENT_HARDLINK_REJECTED", `${label} has more than one hard link`);
  }
  if (exactMode !== undefined && Number(details.mode & 0o777n) !== exactMode) {
    fail("INCIDENT_PERMISSIONS_INVALID", `${label} does not have the required private mode`);
  }
}

async function assertCanonicalPath(path, label) {
  const canonical = await realpath(path);
  if (canonical !== path) fail("INCIDENT_PATH_ALIAS", `${label} is an aliased path`);
  return canonical;
}

async function assertAbsent(path, label) {
  try {
    await lstat(path);
    fail("INCIDENT_TARGET_EXISTS", `${label} already exists`);
  } catch (error) {
    if (error instanceof IncidentEnvelopeError) throw error;
    if (error?.code !== "ENOENT") throw error;
  }
}

async function ensurePrivateDirectory(path, label) {
  normalizedAbsolute(path, label);
  const details = await lstat(path, { bigint: true });
  assertPrivateMetadata(details, "directory", label, 0o700);
  await assertCanonicalPath(path, label);
}

async function ensurePrivateParent(path, label) {
  const parent = dirname(path);
  // The operator prepares a canonical private parent before invoking this module.
  // Do not create directories through an unverified ancestor or symlink.
  await ensurePrivateDirectory(parent, `${label} parent`);
  return parent;
}

function asPrivateKey(input, purpose) {
  let key;
  try {
    key = input && typeof input === "object" && typeof input.export === "function"
      ? input
      : createPrivateKey(input);
  } catch {
    fail("INCIDENT_KEY_INVALID", `${purpose} private key is invalid`);
  }
  if (key.type !== "private") fail("INCIDENT_KEY_INVALID", `${purpose} key must be private`);
  return key;
}

function asPublicKey(input, purpose) {
  let key;
  try {
    key = input && typeof input === "object" && typeof input.export === "function"
      ? input
      : createPublicKey(input);
  } catch {
    fail("INCIDENT_KEY_INVALID", `${purpose} public key is invalid`);
  }
  if (key.type !== "public") fail("INCIDENT_KEY_INVALID", `${purpose} key must be public`);
  return key;
}

function parseSigningPrivateKey(input) {
  const key = asPrivateKey(input, "incident signing");
  if (key.asymmetricKeyType !== "ed25519") fail("INCIDENT_KEY_INVALID", "Incident signing key must be Ed25519");
  return key;
}

function parseSigningPublicKey(input) {
  const key = asPublicKey(input, "incident signing");
  if (key.asymmetricKeyType !== "ed25519") fail("INCIDENT_KEY_INVALID", "Trusted signing key must be Ed25519");
  return key;
}

function parseRecoveryPublicKey(input) {
  const key = asPublicKey(input, "recovery");
  if (key.asymmetricKeyType !== "rsa" || Number(key.asymmetricKeyDetails?.modulusLength ?? 0) < 3072) {
    fail("INCIDENT_KEY_INVALID", "Recovery public key must be RSA 3072 bits or stronger");
  }
  return key;
}

function parseRecoveryPrivateKey(input) {
  const key = asPrivateKey(input, "recovery");
  if (key.asymmetricKeyType !== "rsa" || Number(key.asymmetricKeyDetails?.modulusLength ?? 0) < 3072) {
    fail("INCIDENT_KEY_INVALID", "Recovery private key must be RSA 3072 bits or stronger");
  }
  return key;
}

function publicFingerprint(key) {
  const publicKey = key.type === "public" ? key : createPublicKey(key);
  const der = publicKey.export({ format: "der", type: "spki" });
  return sha256(Buffer.isBuffer(der) ? der : Buffer.from(der));
}

function deriveEntryKey(dek, backupId, entryId) {
  return Buffer.from(hkdfSync(
    "sha256",
    dek,
    Buffer.from(backupId, "utf8"),
    Buffer.from(`${DOMAIN}:entry:${entryId}`, "utf8"),
    32,
  ));
}

function manifestAad(backupId) {
  return Buffer.from(`${DOMAIN}:manifest:${backupId}`, "utf8");
}

function signaturePayload(unsignedManifest) {
  return Buffer.from(`${DOMAIN}\n${stableJson(unsignedManifest)}`, "utf8");
}

async function syncDirectory(path) {
  let handle;
  try {
    handle = await open(path, fsConstants.O_RDONLY | (fsConstants.O_DIRECTORY ?? 0));
    await handle.sync();
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function writePrivateFile(path, value) {
  const contents = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
  let handle;
  try {
    handle = await open(path, "wx", 0o600);
    let offset = 0;
    while (offset < contents.length) {
      const { bytesWritten } = await handle.write(contents, offset, contents.length - offset, offset);
      if (bytesWritten <= 0) fail("INCIDENT_WRITE_FAILED", "Private file write made no progress");
      offset += bytesWritten;
    }
    await handle.sync();
  } finally {
    await handle?.close().catch(() => undefined);
    if (Buffer.isBuffer(value)) value.fill(0);
  }
  await chmod(path, 0o600);
}

async function readBoundedPrivateFile(path, label, maximumBytes) {
  const before = await lstat(path, { bigint: true });
  assertPrivateMetadata(before, "file", label, 0o600);
  if (before.size > BigInt(maximumBytes)) fail("INCIDENT_FILE_TOO_LARGE", `${label} exceeds its limit`);
  let handle;
  let value;
  try {
    handle = await open(path, fsConstants.O_RDONLY | NO_FOLLOW);
    const opened = await handle.stat({ bigint: true });
    if (
      opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size ||
      opened.mtimeNs !== before.mtimeNs || opened.ctimeNs !== before.ctimeNs
    ) fail("INCIDENT_PACKAGE_CHANGED", `${label} changed while opening`);
    value = Buffer.alloc(Number(opened.size));
    let offset = 0;
    while (offset < value.length) {
      const { bytesRead } = await handle.read(value, offset, value.length - offset, offset);
      if (!bytesRead) fail("INCIDENT_PACKAGE_CHANGED", `${label} ended while reading`);
      offset += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    if (
      after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size ||
      after.mtimeNs !== opened.mtimeNs || after.ctimeNs !== opened.ctimeNs
    ) fail("INCIDENT_PACKAGE_CHANGED", `${label} changed while reading`);
    return value;
  } catch (error) {
    value?.fill(0);
    throw error;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function inspectRegularFile(path, logicalPath, label = logicalPath) {
  const before = await lstat(path, { bigint: true });
  assertPrivateMetadata(before, "file", label);
  const canonical = await realpath(path);
  if (canonical !== path) fail("INCIDENT_PATH_ALIAS", `${label} is an aliased path`);
  let handle;
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(IO_CHUNK_BYTES);
  let bytes = 0;
  try {
    handle = await open(path, fsConstants.O_RDONLY | NO_FOLLOW);
    const opened = await handle.stat({ bigint: true });
    if (
      opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size ||
      opened.mtimeNs !== before.mtimeNs || opened.ctimeNs !== before.ctimeNs
    ) fail("INCIDENT_SOURCE_CHANGED", `${label} changed while opening`);
    let offset = 0;
    while (offset < Number(opened.size)) {
      const { bytesRead } = await handle.read(
        buffer,
        0,
        Math.min(buffer.length, Number(opened.size) - offset),
        offset,
      );
      if (!bytesRead) fail("INCIDENT_SOURCE_CHANGED", `${label} ended while reading`);
      hash.update(buffer.subarray(0, bytesRead));
      offset += bytesRead;
      bytes += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    if (
      after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size ||
      after.mtimeNs !== opened.mtimeNs || after.ctimeNs !== opened.ctimeNs
    ) fail("INCIDENT_SOURCE_CHANGED", `${label} changed while reading`);
    return Object.freeze({
      ctimeNs: after.ctimeNs.toString(),
      dev: after.dev.toString(),
      ino: after.ino.toString(),
      kind: "file",
      mode: Number(after.mode & 0o777n),
      mtimeNs: after.mtimeNs.toString(),
      path: logicalPath,
      sha256: hash.digest("hex"),
      size: bytes,
    });
  } finally {
    buffer.fill(0);
    await handle?.close().catch(() => undefined);
  }
}

async function inspectDirectory(path, logicalPath, label = logicalPath || "source directory") {
  const details = await lstat(path, { bigint: true });
  assertPrivateMetadata(details, "directory", label);
  const canonical = await realpath(path);
  if (canonical !== path) fail("INCIDENT_PATH_ALIAS", `${label} is an aliased path`);
  return Object.freeze({
    ctimeNs: details.ctimeNs.toString(),
    dev: details.dev.toString(),
    ino: details.ino.toString(),
    kind: "directory",
    mode: Number(details.mode & 0o777n),
    mtimeNs: details.mtimeNs.toString(),
    path: logicalPath,
  });
}

function assertAllowedSourcePath(path, kind, label) {
  const logical = allowedLogicalPath(path, kind, label);
  const top = logical.split("/")[0];
  if (kind === "directory" && top !== "media" && top !== "secrets" && top !== "oss-mirrors") {
    fail("INCIDENT_PATH_INVALID", `${label} contains a non-tree directory`);
  }
  return logical;
}

async function scanSource(sourceDir) {
  const root = await inspectDirectory(sourceDir, "", "source directory");
  const entries = [];
  let hasDatabase = false;
  let hasLibrary = false;
  let hasMedia = false;
  let hasSecrets = false;

  async function visit(directory, parts) {
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      const path = join(directory, child.name);
      const logicalPath = [...parts, child.name].join("/");
      const details = await lstat(path, { bigint: true });
      if (details.isSymbolicLink()) fail("INCIDENT_LINK_REJECTED", `Source contains a link at ${logicalPath}`);
      if (parts.length === 0 && child.name === "media") hasMedia = true;
      if (parts.length === 0 && child.name === "secrets") hasSecrets = true;
      if (details.isDirectory()) {
        assertAllowedSourcePath(logicalPath, "directory", logicalPath);
        entries.push(await inspectDirectory(path, logicalPath, logicalPath));
        await visit(path, [...parts, child.name]);
      } else if (details.isFile()) {
        if (parts.length === 0 && child.name === "unboundry.sqlite") hasDatabase = true;
        if (parts.length === 0 && child.name === "library.sqlite") hasLibrary = true;
        assertAllowedSourcePath(logicalPath, "file", logicalPath);
        entries.push(await inspectRegularFile(path, logicalPath, logicalPath));
      } else {
        fail("INCIDENT_SPECIAL_FILE_REJECTED", `Source contains a special file at ${logicalPath}`);
      }
    }
  }

  await visit(sourceDir, []);
  if (!hasDatabase || !hasLibrary || !hasMedia || !hasSecrets) {
    fail("INCIDENT_SOURCE_INCOMPLETE", "Source must contain unboundry.sqlite, library.sqlite, media, and secrets");
  }
  entries.sort((left, right) => left.path.localeCompare(right.path));
  return Object.freeze({ entries: Object.freeze(entries), root });
}

function logicalInventory(entries) {
  return entries.map((entry) => entry.kind === "file"
    ? {
        kind: "file",
        path: entry.path,
        sha256: entry.sha256,
        size: entry.size,
      }
    : { kind: "directory", path: entry.path })
    .sort((left, right) => left.path.localeCompare(right.path));
}

function physicalInventory(entries) {
  return entries.map((entry) => entry.kind === "file"
    ? {
        ctimeNs: entry.ctimeNs,
        dev: entry.dev,
        ino: entry.ino,
        kind: "file",
        mode: entry.mode,
        mtimeNs: entry.mtimeNs,
        path: entry.path,
        sha256: entry.sha256,
        size: entry.size,
      }
    : {
        ctimeNs: entry.ctimeNs,
        dev: entry.dev,
        ino: entry.ino,
        kind: "directory",
        mode: entry.mode,
        mtimeNs: entry.mtimeNs,
        path: entry.path,
      })
    .sort((left, right) => left.path.localeCompare(right.path));
}

function compareSourceScans(before, after) {
  if (stableJson(before.root) !== stableJson(after.root) ||
      stableJson(physicalInventory(before.entries)) !== stableJson(physicalInventory(after.entries))) {
    fail("INCIDENT_SOURCE_CHANGED", "Source tree changed during incident capture");
  }
}

async function encryptFile(sourcePath, sourceEntry, objectsDirectory, dek, backupId, entryId) {
  const before = await inspectRegularFile(sourcePath, sourceEntry.path, sourceEntry.path);
  if (stableJson(before) !== stableJson(sourceEntry)) fail("INCIDENT_SOURCE_CHANGED", `${sourceEntry.path} changed before encryption`);
  const key = deriveEntryKey(dek, backupId, entryId);
  const iv = randomBytes(12);
  const destination = join(objectsDirectory, `${entryId}.bin`);
  let input;
  let output;
  const plainHash = createHash("sha256");
  const cipherHash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(IO_CHUNK_BYTES);
  let plainBytes = 0;
  let cipherBytes = 0;
  let outputPosition = 0;
  try {
    input = await open(sourcePath, fsConstants.O_RDONLY | NO_FOLLOW);
    output = await open(destination, "wx", 0o600);
    const opened = await input.stat({ bigint: true });
    if (
      opened.dev.toString() !== sourceEntry.dev || opened.ino.toString() !== sourceEntry.ino ||
      opened.size !== BigInt(sourceEntry.size) || opened.mtimeNs.toString() !== sourceEntry.mtimeNs ||
      opened.ctimeNs.toString() !== sourceEntry.ctimeNs || opened.nlink !== 1n
    ) fail("INCIDENT_SOURCE_CHANGED", `${sourceEntry.path} changed while opening encryption input`);
    const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
    cipher.setAAD(Buffer.from(`${DOMAIN}:entry-aad:${backupId}:${entryId}:${sourceEntry.path}`, "utf8"));
    let offset = 0;
    while (offset < sourceEntry.size) {
      const { bytesRead } = await input.read(buffer, 0, Math.min(buffer.length, sourceEntry.size - offset), offset);
      if (!bytesRead) fail("INCIDENT_SOURCE_CHANGED", `${sourceEntry.path} ended during encryption`);
      const plain = buffer.subarray(0, bytesRead);
      plainHash.update(plain);
      plainBytes += bytesRead;
      const encrypted = cipher.update(plain);
      if (encrypted.length) {
        cipherHash.update(encrypted);
        cipherBytes += encrypted.length;
        let written = 0;
        while (written < encrypted.length) {
          const { bytesWritten } = await output.write(encrypted, written, encrypted.length - written, outputPosition + written);
          if (bytesWritten <= 0) fail("INCIDENT_WRITE_FAILED", "Encrypted file write made no progress");
          written += bytesWritten;
        }
        outputPosition += encrypted.length;
      }
      offset += bytesRead;
    }
    const final = cipher.final();
    if (final.length) {
      cipherHash.update(final);
      cipherBytes += final.length;
      let written = 0;
      while (written < final.length) {
        const { bytesWritten } = await output.write(final, written, final.length - written, outputPosition + written);
        if (bytesWritten <= 0) fail("INCIDENT_WRITE_FAILED", "Encrypted file final write made no progress");
        written += bytesWritten;
      }
      outputPosition += final.length;
      final.fill(0);
    }
    const after = await input.stat({ bigint: true });
    if (
      after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size ||
      after.mtimeNs !== opened.mtimeNs || after.ctimeNs !== opened.ctimeNs || after.nlink !== 1n
    ) fail("INCIDENT_SOURCE_CHANGED", `${sourceEntry.path} changed during encryption`);
    const plaintextSha256 = plainHash.digest("hex");
    if (plainBytes !== sourceEntry.size || plaintextSha256 !== sourceEntry.sha256 || outputPosition !== cipherBytes) {
      fail("INCIDENT_SOURCE_CHANGED", `${sourceEntry.path} checksum changed during encryption`);
    }
    await output.sync();
    await chmod(destination, 0o600);
    const tag = cipher.getAuthTag();
    return Object.freeze({
      ciphertextBytes: cipherBytes,
      ciphertextSha256: cipherHash.digest("hex"),
      entryId,
      iv: iv.toString("base64"),
      objectFile: `objects/${entryId}.bin`,
      plaintextBytes: plainBytes,
      plaintextSha256,
      tag: tag.toString("base64"),
    });
  } finally {
    buffer.fill(0);
    key.fill(0);
    iv.fill(0);
    await output?.close().catch(() => undefined);
    await input?.close().catch(() => undefined);
  }
}

function manifestUnsigned({ backupId, context, inventory, createdAt }) {
  return Object.freeze({
    backupId,
    captureMode: INCIDENT_CAPTURE_MODE,
    context,
    createdAt,
    finalCandidate: INCIDENT_FINAL_CANDIDATE,
    format: INCIDENT_ENVELOPE_FORMAT,
    inventory: Object.freeze(inventory),
    version: INCIDENT_ENVELOPE_VERSION,
  });
}

async function removeOwnedStage(stage) {
  try {
    await rm(stage, { force: true, recursive: true, maxRetries: 2, retryDelay: 100 });
  } catch (cause) {
    const error = new IncidentEnvelopeError("INCIDENT_CLEANUP_FAILED", `Private staging cleanup failed: ${stage}`);
    error.cause = cause;
    throw error;
  }
}

async function publishTreeNoReplace(stage, target) {
  const names = (await readdir(stage)).sort((left, right) => left.localeCompare(right));
  for (const name of names) {
    const source = join(stage, name);
    const destination = join(target, name);
    const details = await lstat(source, { bigint: true });
    if (details.isSymbolicLink()) fail("INCIDENT_LINK_REJECTED", "Staging package contains a symbolic link");
    if (details.isDirectory()) {
      await mkdir(destination, { mode: 0o700 });
      await chmod(destination, 0o700);
      await publishTreeNoReplace(source, destination);
      await rmdir(source);
      continue;
    }
    if (!details.isFile() || details.nlink !== 1n) fail("INCIDENT_PACKAGE_INVALID", "Staging package contains an unsafe file");
    try {
      await link(source, destination);
    } catch (error) {
      if (error?.code === "EEXIST") fail("INCIDENT_TARGET_CHANGED", "Package destination already contains a path");
      throw error;
    }
    await unlink(source);
  }
}

async function publishStage(stage, target) {
  await assertAbsent(target, "Package target");
  await mkdir(target, { mode: 0o700 });
  await chmod(target, 0o700);
  const marker = join(target, INCOMPLETE_MARKER);
  await writePrivateFile(marker, Buffer.from("incident-preservation-incomplete\n", "utf8"));
  await syncDirectory(target);
  await publishTreeNoReplace(stage, target);
  await rmdir(stage);
  await syncDirectory(target);
  await unlink(marker);
  await syncDirectory(target);
  await syncDirectory(dirname(target));
}

function fileEntryFor(sourceEntry, encrypted) {
  return Object.freeze({
    ciphertextBytes: encrypted.ciphertextBytes,
    ciphertextSha256: encrypted.ciphertextSha256,
    entryId: encrypted.entryId,
    iv: encrypted.iv,
    kind: "file",
    mode: sourceEntry.mode,
    objectFile: encrypted.objectFile,
    path: sourceEntry.path,
    plaintextBytes: encrypted.plaintextBytes,
    plaintextSha256: encrypted.plaintextSha256,
    tag: encrypted.tag,
  });
}

function directoryEntryFor(sourceEntry) {
  return Object.freeze({ kind: "directory", mode: sourceEntry.mode, path: sourceEntry.path });
}

export async function captureEnvelope({
  sourceDir,
  targetDir,
  signingPrivateKey,
  recoveryPublicKey,
  context,
}) {
  const sourceDirectory = normalizedAbsolute(sourceDir, "sourceDir");
  const targetDirectory = normalizedAbsolute(targetDir, "targetDir");
  assertDisjoint(sourceDirectory, targetDirectory, "Source/target");
  await assertCanonicalPath(sourceDirectory, "sourceDir");
  await assertAbsent(targetDirectory, "targetDir");
  await ensurePrivateParent(targetDirectory, "targetDir");
  const signer = parseSigningPrivateKey(signingPrivateKey);
  const recipient = parseRecoveryPublicKey(recoveryPublicKey);
  const canonicalContext = canonicalJson(context, "context");
  if (!isObject(canonicalContext)) fail("INCIDENT_CONTEXT_INVALID", "context must be an object");
  const contextBytes = Buffer.from(stableJson(canonicalContext), "utf8");
  if (contextBytes.length > MAX_CONTEXT_BYTES) {
    contextBytes.fill(0);
    fail("INCIDENT_CONTEXT_TOO_LARGE", "context exceeds its safe limit");
  }
  contextBytes.fill(0);
  const scanBefore = await scanSource(sourceDirectory);
  if (scanBefore.entries.length > MAX_ENTRY_COUNT) fail("INCIDENT_SOURCE_TOO_LARGE", "Source contains too many entries");
  const backupId = randomUUID();
  const stage = await mkdtemp(join(dirname(targetDirectory), `.${backupId}.incident-`));
  await chmod(stage, 0o700);
  const objectsDirectory = join(stage, "objects");
  await mkdir(objectsDirectory, { mode: 0o700 });
  await chmod(objectsDirectory, 0o700);
  const dek = randomBytes(32);
  const fileEntries = [];
  let published = false;
  try {
    for (const sourceEntry of scanBefore.entries) {
      if (sourceEntry.kind !== "file") continue;
      const encrypted = await encryptFile(
        join(sourceDirectory, ...sourceEntry.path.split("/")),
        sourceEntry,
        objectsDirectory,
        dek,
        backupId,
        randomUUID(),
      );
      fileEntries.push(fileEntryFor(sourceEntry, encrypted));
    }
    const inventory = [
      ...scanBefore.entries.filter((entry) => entry.kind === "directory").map(directoryEntryFor),
      ...fileEntries,
    ].sort((left, right) => left.path.localeCompare(right.path));
    const unsignedWithoutSigner = manifestUnsigned({
      backupId,
      context: canonicalContext,
      createdAt: new Date().toISOString(),
      inventory,
    });
    const signature = sign(null, signaturePayload(unsignedWithoutSigner), signer).toString("base64");
    const signedManifest = Object.freeze({
      ...unsignedWithoutSigner,
      signature,
      signatureAlgorithm: "Ed25519",
      signingKeySha256: publicFingerprint(signer),
    });
    const manifestPlaintext = Buffer.from(stableJson(signedManifest), "utf8");
    if (manifestPlaintext.length > MAX_MANIFEST_BYTES) {
      manifestPlaintext.fill(0);
      fail("INCIDENT_MANIFEST_TOO_LARGE", "Incident manifest exceeds its safe limit");
    }
    const manifestIv = randomBytes(12);
    const manifestCipher = createCipheriv("aes-256-gcm", dek, manifestIv, { authTagLength: 16 });
    manifestCipher.setAAD(manifestAad(backupId));
    const manifestCiphertext = Buffer.concat([manifestCipher.update(manifestPlaintext), manifestCipher.final()]);
    const manifestTag = manifestCipher.getAuthTag();
    const manifestPlaintextSha256 = sha256(manifestPlaintext);
    manifestPlaintext.fill(0);
    await writePrivateFile(join(stage, "manifest.bin"), manifestCiphertext);
    manifestCiphertext.fill(0);
    const wrappedKey = publicEncrypt({
      key: recipient,
      oaepHash: "sha256",
      oaepLabel: Buffer.from(backupId, "utf8"),
      padding: RSA_PADDING,
    }, dek);
    const envelope = {
      backupId,
      captureMode: INCIDENT_CAPTURE_MODE,
      encryption: "AES-256-GCM-HKDF-SHA256",
      finalCandidate: INCIDENT_FINAL_CANDIDATE,
      format: INCIDENT_ENVELOPE_FORMAT,
      keyWrap: "RSA-OAEP-SHA256",
      manifest: {
        ciphertextBytes: Number((await lstat(join(stage, "manifest.bin"), { bigint: true })).size),
        ciphertextSha256: sha256(await readBoundedPrivateFile(join(stage, "manifest.bin"), "manifest.bin", MAX_MANIFEST_BYTES)),
        iv: manifestIv.toString("base64"),
        plaintextSha256: manifestPlaintextSha256,
        tag: manifestTag.toString("base64"),
      },
      signingKeySha256: publicFingerprint(signer),
      version: INCIDENT_ENVELOPE_VERSION,
      wrappedKey: wrappedKey.toString("base64"),
    };
    wrappedKey.fill(0);
    await writePrivateFile(join(stage, "envelope.json"), `${stableJson(envelope)}\n`);
    await syncDirectory(objectsDirectory);
    await syncDirectory(stage);
    const scanAfter = await scanSource(sourceDirectory);
    compareSourceScans(scanBefore, scanAfter);
    if (stableJson(logicalInventory(scanAfter.entries)) !== stableJson(logicalInventory(scanBefore.entries))) {
      fail("INCIDENT_SOURCE_CHANGED", "Source logical inventory changed during capture");
    }
    await publishStage(stage, targetDirectory);
    published = true;
    return Object.freeze({
      backupId,
      captureMode: INCIDENT_CAPTURE_MODE,
      fileCount: fileEntries.length,
      finalCandidate: false,
      format: INCIDENT_ENVELOPE_FORMAT,
      packageDirectory: targetDirectory,
      schema: "caller-bound-context",
      version: INCIDENT_ENVELOPE_VERSION,
    });
  } finally {
    dek.fill(0);
    if (!published) await removeOwnedStage(stage);
  }
}

function validateEnvelope(value) {
  exactKeys(value, [
    "backupId", "captureMode", "encryption", "finalCandidate", "format", "keyWrap",
    "manifest", "signingKeySha256", "version", "wrappedKey",
  ], "envelope");
  validUuid(value.backupId, "envelope.backupId");
  if (
    value.captureMode !== INCIDENT_CAPTURE_MODE ||
    value.encryption !== "AES-256-GCM-HKDF-SHA256" ||
    value.finalCandidate !== false ||
    value.format !== INCIDENT_ENVELOPE_FORMAT ||
    value.keyWrap !== "RSA-OAEP-SHA256" ||
    value.version !== INCIDENT_ENVELOPE_VERSION
  ) fail("INCIDENT_FORMAT_INVALID", "Envelope policy fields are invalid");
  validSha(value.signingKeySha256, "envelope.signingKeySha256");
  if (typeof value.wrappedKey !== "string" || value.wrappedKey.length < 1) fail("INCIDENT_FORMAT_INVALID", "Envelope wrapped key is invalid");
  exactKeys(value.manifest, ["ciphertextBytes", "ciphertextSha256", "iv", "plaintextSha256", "tag"], "envelope.manifest");
  safeInteger(value.manifest.ciphertextBytes, "manifest.ciphertextBytes", 1);
  validSha(value.manifest.ciphertextSha256, "manifest.ciphertextSha256");
  validSha(value.manifest.plaintextSha256, "manifest.plaintextSha256");
  decodeBase64(value.manifest.iv, 12, "manifest.iv").fill(0);
  decodeBase64(value.manifest.tag, 16, "manifest.tag").fill(0);
  return value;
}

function validateManifest(value, envelope, expectedContext) {
  exactKeys(value, [
    "backupId", "captureMode", "context", "createdAt", "finalCandidate", "format",
    "inventory", "signature", "signatureAlgorithm", "signingKeySha256", "version",
  ], "signed manifest");
  if (
    value.backupId !== envelope.backupId ||
    value.captureMode !== INCIDENT_CAPTURE_MODE ||
    value.finalCandidate !== false ||
    value.format !== INCIDENT_ENVELOPE_FORMAT ||
    value.version !== INCIDENT_ENVELOPE_VERSION ||
    value.signatureAlgorithm !== "Ed25519" ||
    typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt))
  ) fail("INCIDENT_FORMAT_INVALID", "Signed manifest policy fields are invalid");
  validSha(value.signingKeySha256, "manifest.signingKeySha256");
  if (value.signingKeySha256 !== envelope.signingKeySha256) fail("INCIDENT_KEY_MISMATCH", "Manifest and envelope signing keys differ");
  if (typeof value.signature !== "string" || !value.signature) fail("INCIDENT_FORMAT_INVALID", "Manifest signature is missing");
  const context = canonicalJson(value.context, "manifest.context");
  if (!isObject(context)) fail("INCIDENT_CONTEXT_INVALID", "Manifest context must be an object");
  const expected = canonicalJson(expectedContext, "expectedContext");
  if (stableJson(context) !== stableJson(expected)) fail("INCIDENT_CONTEXT_MISMATCH", "Manifest context differs from the expected operation contract");
  if (!Array.isArray(value.inventory) || value.inventory.length > MAX_ENTRY_COUNT) fail("INCIDENT_FORMAT_INVALID", "Manifest inventory is invalid");
  const paths = new Set();
  const ids = new Set();
  const objectFiles = new Set();
  let hasDatabase = false;
  let hasLibrary = false;
  let hasMedia = false;
  let hasSecrets = false;
  const inventory = value.inventory.map((raw, index) => {
    if (!isObject(raw) || typeof raw.kind !== "string") fail("INCIDENT_FORMAT_INVALID", `Manifest inventory entry ${index} is invalid`);
    if (raw.kind === "directory") {
      exactKeys(raw, ["kind", "mode", "path"], `Manifest directory ${index}`);
      const path = allowedLogicalPath(raw.path, "directory", `Manifest directory ${index}.path`);
      if (!Number.isSafeInteger(raw.mode) || raw.mode < 0 || raw.mode > 0o777 || (raw.mode & 0o022) !== 0) fail("INCIDENT_FORMAT_INVALID", `Manifest directory ${index}.mode is invalid`);
      if (path === "media") hasMedia = true;
      if (path === "secrets") hasSecrets = true;
      if (paths.has(path)) fail("INCIDENT_FORMAT_INVALID", "Manifest inventory contains a duplicate path");
      paths.add(path);
      return Object.freeze({ kind: "directory", mode: raw.mode, path });
    }
    if (raw.kind !== "file") fail("INCIDENT_FORMAT_INVALID", `Manifest inventory entry ${index}.kind is invalid`);
    exactKeys(raw, [
      "ciphertextBytes", "ciphertextSha256", "entryId", "iv", "kind", "mode", "objectFile",
      "path", "plaintextBytes", "plaintextSha256", "tag",
    ], `Manifest file ${index}`);
    const path = allowedLogicalPath(raw.path, "file", `Manifest file ${index}.path`);
    const entryId = validUuid(raw.entryId, `Manifest file ${index}.entryId`);
    if (!Number.isSafeInteger(raw.mode) || raw.mode < 0 || raw.mode > 0o777 || (raw.mode & 0o022) !== 0) fail("INCIDENT_FORMAT_INVALID", `Manifest file ${index}.mode is invalid`);
    safeInteger(raw.plaintextBytes, `Manifest file ${index}.plaintextBytes`, 0);
    safeInteger(raw.ciphertextBytes, `Manifest file ${index}.ciphertextBytes`, 0);
    if (raw.ciphertextBytes !== raw.plaintextBytes) fail("INCIDENT_FORMAT_INVALID", `Manifest file ${index} has an invalid GCM size`);
    validSha(raw.plaintextSha256, `Manifest file ${index}.plaintextSha256`);
    validSha(raw.ciphertextSha256, `Manifest file ${index}.ciphertextSha256`);
    decodeBase64(raw.iv, 12, `Manifest file ${index}.iv`).fill(0);
    decodeBase64(raw.tag, 16, `Manifest file ${index}.tag`).fill(0);
    if (raw.objectFile !== `objects/${entryId}.bin`) fail("INCIDENT_FORMAT_INVALID", `Manifest file ${index}.objectFile is invalid`);
    if (paths.has(path) || ids.has(entryId) || objectFiles.has(raw.objectFile)) fail("INCIDENT_FORMAT_INVALID", "Manifest inventory contains a duplicate identity");
    paths.add(path);
    ids.add(entryId);
    objectFiles.add(raw.objectFile);
    if (path === "unboundry.sqlite") hasDatabase = true;
    if (path === "library.sqlite") hasLibrary = true;
    if (path.startsWith("media/")) hasMedia = true;
    if (path.startsWith("secrets/")) hasSecrets = true;
    return Object.freeze({
      ciphertextBytes: raw.ciphertextBytes,
      ciphertextSha256: raw.ciphertextSha256,
      entryId,
      iv: raw.iv,
      kind: "file",
      mode: raw.mode,
      objectFile: raw.objectFile,
      path,
      plaintextBytes: raw.plaintextBytes,
      plaintextSha256: raw.plaintextSha256,
      tag: raw.tag,
    });
  });
  if (!hasDatabase || !hasLibrary || !hasMedia || !hasSecrets) fail("INCIDENT_FORMAT_INVALID", "Manifest does not cover the complete DB/media/secrets tree");
  const unsigned = { ...value };
  delete unsigned.signature;
  delete unsigned.signatureAlgorithm;
  delete unsigned.signingKeySha256;
  unsigned.inventory = inventory;
  return Object.freeze({
    inventory: Object.freeze(inventory),
    signed: value,
    unsigned: Object.freeze(unsigned),
    objectFiles,
  });
}

async function validatePackageInventory(packageDirectory, manifest) {
  const root = await lstat(packageDirectory, { bigint: true });
  assertPrivateMetadata(root, "directory", "package directory", 0o700);
  const names = (await readdir(packageDirectory)).sort((left, right) => left.localeCompare(right));
  const expected = ["envelope.json", "manifest.bin", "objects"];
  if (names.length !== expected.length || names.some((name, index) => name !== expected[index])) fail("INCIDENT_PACKAGE_INVALID", "Package has extra or missing top-level paths");
  for (const name of ["envelope.json", "manifest.bin"]) {
    const details = await lstat(join(packageDirectory, name), { bigint: true });
    assertPrivateMetadata(details, "file", name, 0o600);
  }
  const objects = join(packageDirectory, "objects");
  const objectDetails = await lstat(objects, { bigint: true });
  assertPrivateMetadata(objectDetails, "directory", "objects", 0o700);
  const objectNames = (await readdir(objects)).sort((left, right) => left.localeCompare(right));
  const expectedObjects = [...manifest.objectFiles].map((path) => path.slice("objects/".length)).sort((left, right) => left.localeCompare(right));
  if (objectNames.length !== expectedObjects.length || objectNames.some((name, index) => name !== expectedObjects[index])) fail("INCIDENT_PACKAGE_INVALID", "Package objects are missing or extra");
  for (const name of objectNames) {
    const details = await lstat(join(objects, name), { bigint: true });
    assertPrivateMetadata(details, "file", `objects/${name}`, 0o600);
  }
}

async function decryptManifest(packageDirectory, envelope, recoveryKey) {
  const encrypted = await readBoundedPrivateFile(join(packageDirectory, "manifest.bin"), "manifest.bin", MAX_MANIFEST_BYTES);
  let dek;
  let plaintext;
  let transferred = false;
  try {
    if (encrypted.length !== envelope.manifest.ciphertextBytes || sha256(encrypted) !== envelope.manifest.ciphertextSha256) fail("INCIDENT_PACKAGE_TAMPERED", "Encrypted manifest checksum does not match the envelope");
    const wrapped = decodeCanonicalBase64(envelope.wrappedKey, "envelope.wrappedKey");
    try {
      dek = privateDecrypt({
        key: recoveryKey,
        oaepHash: "sha256",
        oaepLabel: Buffer.from(envelope.backupId, "utf8"),
        padding: RSA_PADDING,
      }, wrapped);
    } catch {
      fail("INCIDENT_KEY_UNWRAP_FAILED", "Recovery key could not unwrap the incident package");
    } finally {
      wrapped.fill(0);
    }
    if (dek.length !== 32) fail("INCIDENT_KEY_UNWRAP_FAILED", "Incident package data key has an invalid length");
    let iv;
    let tag;
    let partial;
    let final;
    try {
      iv = decodeBase64(envelope.manifest.iv, 12, "manifest.iv");
      tag = decodeBase64(envelope.manifest.tag, 16, "manifest.tag");
      const decipher = createDecipheriv("aes-256-gcm", dek, iv, { authTagLength: 16 });
      decipher.setAAD(manifestAad(envelope.backupId));
      decipher.setAuthTag(tag);
      try {
        partial = decipher.update(encrypted);
        final = decipher.final();
        plaintext = Buffer.concat([partial, final]);
      } catch {
        fail("INCIDENT_MANIFEST_AUTH_FAILED", "Encrypted incident manifest authentication failed");
      }
      if (plaintext.length === 0 || plaintext.length > MAX_MANIFEST_BYTES || sha256(plaintext) !== envelope.manifest.plaintextSha256) fail("INCIDENT_MANIFEST_TAMPERED", "Decrypted manifest checksum does not match the envelope");
      let value;
      try {
        value = JSON.parse(plaintext.toString("utf8"));
      } catch {
        fail("INCIDENT_MANIFEST_INVALID", "Decrypted incident manifest is invalid JSON");
      }
      transferred = true;
      return Object.freeze({ dek, plaintext, value });
    } finally {
      partial?.fill(0);
      final?.fill(0);
      iv?.fill(0);
      tag?.fill(0);
    }
  } finally {
    encrypted.fill(0);
    if (!transferred) {
      dek?.fill(0);
      plaintext?.fill(0);
    }
  }
}

async function decryptFileToStage(packageDirectory, entry, targetPath, dek, backupId) {
  const sourcePath = join(packageDirectory, ...entry.objectFile.split("/"));
  const sourceBefore = await lstat(sourcePath, { bigint: true });
  assertPrivateMetadata(sourceBefore, "file", entry.objectFile, 0o600);
  if (sourceBefore.size !== BigInt(entry.ciphertextBytes)) fail("INCIDENT_OBJECT_INVALID", `${entry.objectFile} has an invalid size`);
  const input = await open(sourcePath, fsConstants.O_RDONLY | NO_FOLLOW);
  const output = await open(targetPath, "wx", 0o600);
  const key = deriveEntryKey(dek, backupId, entry.entryId);
  const iv = decodeBase64(entry.iv, 12, `${entry.path}.iv`);
  const tag = decodeBase64(entry.tag, 16, `${entry.path}.tag`);
  const buffer = Buffer.allocUnsafe(IO_CHUNK_BYTES);
  const cipherHash = createHash("sha256");
  const plainHash = createHash("sha256");
  let cipherBytes = 0;
  let plainBytes = 0;
  let outputPosition = 0;
  try {
    const opened = await input.stat({ bigint: true });
    if (opened.dev !== sourceBefore.dev || opened.ino !== sourceBefore.ino || opened.size !== sourceBefore.size || opened.mtimeNs !== sourceBefore.mtimeNs || opened.ctimeNs !== sourceBefore.ctimeNs || opened.nlink !== 1n) fail("INCIDENT_PACKAGE_CHANGED", `${entry.objectFile} changed while opening`);
    const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
    decipher.setAAD(Buffer.from(`${DOMAIN}:entry-aad:${backupId}:${entry.entryId}:${entry.path}`, "utf8"));
    decipher.setAuthTag(tag);
    let offset = 0;
    while (offset < entry.ciphertextBytes) {
      const { bytesRead } = await input.read(buffer, 0, Math.min(buffer.length, entry.ciphertextBytes - offset), offset);
      if (!bytesRead) fail("INCIDENT_OBJECT_TRUNCATED", `${entry.objectFile} is truncated`);
      const encrypted = buffer.subarray(0, bytesRead);
      cipherHash.update(encrypted);
      cipherBytes += bytesRead;
      const plain = decipher.update(encrypted);
      if (plain.length) {
        plainHash.update(plain);
        plainBytes += plain.length;
        let written = 0;
        while (written < plain.length) {
          const { bytesWritten } = await output.write(plain, written, plain.length - written, outputPosition + written);
          if (bytesWritten <= 0) fail("INCIDENT_WRITE_FAILED", "Restored file write made no progress");
          written += bytesWritten;
        }
        outputPosition += plain.length;
        plain.fill(0);
      }
      offset += bytesRead;
    }
    let final;
    try {
      final = decipher.final();
    } catch {
      fail("INCIDENT_OBJECT_AUTH_FAILED", `${entry.objectFile} authentication failed`);
    }
    if (final.length) {
      plainHash.update(final);
      plainBytes += final.length;
      let written = 0;
      while (written < final.length) {
        const { bytesWritten } = await output.write(final, written, final.length - written, outputPosition + written);
        if (bytesWritten <= 0) fail("INCIDENT_WRITE_FAILED", "Restored file final write made no progress");
        written += bytesWritten;
      }
      outputPosition += final.length;
      final.fill(0);
    }
    const after = await input.stat({ bigint: true });
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size || after.mtimeNs !== opened.mtimeNs || after.ctimeNs !== opened.ctimeNs || after.nlink !== 1n) fail("INCIDENT_PACKAGE_CHANGED", `${entry.objectFile} changed while decrypting`);
    if (cipherBytes !== entry.ciphertextBytes || plainBytes !== entry.plaintextBytes || outputPosition !== entry.plaintextBytes || cipherHash.digest("hex") !== entry.ciphertextSha256 || plainHash.digest("hex") !== entry.plaintextSha256) fail("INCIDENT_OBJECT_CHECKSUM_INVALID", `${entry.path} does not match its manifest`);
    await output.sync();
    await chmod(targetPath, 0o600);
  } finally {
    buffer.fill(0);
    key.fill(0);
    iv.fill(0);
    tag.fill(0);
    await output.close().catch(() => undefined);
    await input.close().catch(() => undefined);
  }
}

function validateSignature(manifestInfo, trustedKey) {
  const publicKey = parseSigningPublicKey(trustedKey);
  if (publicFingerprint(publicKey) !== manifestInfo.signed.signingKeySha256) fail("INCIDENT_KEY_MISMATCH", "Trusted signing key does not match the manifest");
  const signature = Buffer.from(manifestInfo.signed.signature, "base64");
  if (!signature.length || !verify(null, signaturePayload(manifestInfo.unsigned), publicKey, signature)) fail("INCIDENT_SIGNATURE_INVALID", "Incident manifest signature is invalid");
  signature.fill(0);
}

async function restoreStage(packageDirectory, manifestInfo, stage, dek, backupId) {
  const directories = manifestInfo.inventory
    .filter((entry) => entry.kind === "directory")
    .sort((left, right) => left.path.split("/").length - right.path.split("/").length || left.path.localeCompare(right.path));
  for (const entry of directories) {
    const destination = join(stage, ...entry.path.split("/"));
    await mkdir(destination, { mode: 0o700 });
    await chmod(destination, 0o700);
  }
  for (const entry of manifestInfo.inventory.filter((item) => item.kind === "file").sort((left, right) => left.path.localeCompare(right.path))) {
    const destination = join(stage, ...entry.path.split("/"));
    const parent = dirname(destination);
    await mkdir(parent, { mode: 0o700, recursive: true });
    await chmod(parent, 0o700);
    await decryptFileToStage(packageDirectory, entry, destination, dek, backupId);
  }
}

/**
 * Recover the original operation context from the signed encrypted package.
 * This lets a future recovery use the package and external keys even when the
 * original operator's scratch receipts are gone. File restoration still goes
 * through verifyRestoreEnvelope and its complete byte/inventory checks.
 */
export async function readAuthenticatedEnvelopeContext({
  packageDir,
  trustedSigningPublicKey,
  recoveryPrivateKey,
}) {
  const packageDirectory = normalizedAbsolute(packageDir, "packageDir");
  await assertCanonicalPath(packageDirectory, "packageDir");
  const envelopeBytes = await readBoundedPrivateFile(join(packageDirectory, "envelope.json"), "envelope.json", MAX_ENVELOPE_BYTES);
  let envelope;
  try {
    envelope = validateEnvelope(JSON.parse(envelopeBytes.toString("utf8")));
  } finally {
    envelopeBytes.fill(0);
  }
  const key = parseRecoveryPrivateKey(recoveryPrivateKey);
  const opened = await decryptManifest(packageDirectory, envelope, key);
  try {
    const info = validateManifest(opened.value, envelope, opened.value.context);
    validateSignature(info, trustedSigningPublicKey);
    await validatePackageInventory(packageDirectory, info);
    return canonicalJson(info.signed.context);
  } finally {
    opened.dek.fill(0);
    opened.plaintext.fill(0);
  }
}

export async function verifyRestoreEnvelope({
  packageDir,
  freshRestoreDir,
  trustedSigningPublicKey,
  recoveryPrivateKey,
  expectedContext,
}) {
  const packageDirectory = normalizedAbsolute(packageDir, "packageDir");
  const restoreDirectory = normalizedAbsolute(freshRestoreDir, "freshRestoreDir");
  assertDisjoint(packageDirectory, restoreDirectory, "Package/restore");
  await assertCanonicalPath(packageDirectory, "packageDir");
  await assertAbsent(restoreDirectory, "freshRestoreDir");
  await ensurePrivateParent(restoreDirectory, "freshRestoreDir");
  const envelopeBytes = await readBoundedPrivateFile(join(packageDirectory, "envelope.json"), "envelope.json", MAX_ENVELOPE_BYTES);
  let envelope;
  try {
    envelope = validateEnvelope(JSON.parse(envelopeBytes.toString("utf8")));
  } catch (error) {
    if (error instanceof IncidentEnvelopeError) throw error;
    fail("INCIDENT_ENVELOPE_INVALID", "Envelope JSON is invalid");
  } finally {
    envelopeBytes.fill(0);
  }
  const key = parseRecoveryPrivateKey(recoveryPrivateKey);
  const manifestOpened = await decryptManifest(packageDirectory, envelope, key);
  let stage;
  try {
    const manifestInfo = validateManifest(manifestOpened.value, envelope, expectedContext);
    validateSignature(manifestInfo, trustedSigningPublicKey);
    await validatePackageInventory(packageDirectory, manifestInfo);
    stage = await mkdtemp(join(dirname(restoreDirectory), `.incident-restore-${envelope.backupId}-`));
    await chmod(stage, 0o700);
    await restoreStage(packageDirectory, manifestInfo, stage, manifestOpened.dek, envelope.backupId);
    const restoredScan = await scanSource(stage);
    const expectedInventory = manifestInfo.inventory.map((entry) => entry.kind === "file"
      ? { kind: "file", path: entry.path, sha256: entry.plaintextSha256, size: entry.plaintextBytes }
      : { kind: "directory", path: entry.path })
      .sort((left, right) => left.path.localeCompare(right.path));
    if (stableJson(logicalInventory(restoredScan.entries)) !== stableJson(expectedInventory)) fail("INCIDENT_RESTORE_MISMATCH", "Fresh restore inventory does not match the signed manifest");
    await publishStage(stage, restoreDirectory);
    stage = undefined;
    return Object.freeze({
      backupId: envelope.backupId,
      captureMode: INCIDENT_CAPTURE_MODE,
      finalCandidate: false,
      format: INCIDENT_ENVELOPE_FORMAT,
      freshRestoreDirectory: restoreDirectory,
      fileCount: manifestInfo.inventory.filter((entry) => entry.kind === "file").length,
      version: INCIDENT_ENVELOPE_VERSION,
    });
  } finally {
    manifestOpened.dek.fill(0);
    manifestOpened.plaintext.fill(0);
    if (stage) await removeOwnedStage(stage);
  }
}
