import { createHash } from "node:crypto";
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
  rm,
  rmdir,
  unlink,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { DatabaseSync } from "node:sqlite";
import { inspectBackupDatabase } from "./backupInspection.ts";

export const ossRecoveryIndexFileName =
  ".unboundry-oss-recovery-index.json" as const;
export const ossRecoveryIndexFormat =
  "unboundry-oss-recovery-index" as const;
export const ossRecoveryIndexVersion = 1 as const;

const fakeOssStageMarker =
  ".unboundry-fake-oss-recovery-stage.json" as const;
export const fakeOssRecoveryOwnershipMarkerName =
  ".unboundry-fake-oss-recovery-owner.sqlite" as const;
const fakeOssClaimSuffix = ".fake-oss-recovery-claim.sqlite" as const;
const indexMaximumBytes = 64 * 1024 * 1024;
const ioChunkBytes = 256 * 1024;
const maximumIndexEntries = 1_000_000;

export type OssRecoveryIndexEntry = Readonly<{
  byteSize: number;
  checksumSha256: string;
  logicalPath: string;
  objectKey: string;
  storageProfileId: string | null;
  versionId: string;
}>;

export type OssRecoveryIndex = Readonly<{
  backupId: string;
  databaseLogicalSha256: string;
  entries: readonly OssRecoveryIndexEntry[];
  entriesSha256: string;
  format: typeof ossRecoveryIndexFormat;
  version: typeof ossRecoveryIndexVersion;
}>;

export type CreateFakeOssRecoveryIndexOptions = Readonly<{
  backupId: string;
  databaseLogicalSha256: string;
  entries: readonly OssRecoveryIndexEntry[];
}>;

export type RehydrateFakeOssOptions = Readonly<{
  index: OssRecoveryIndex;
  onCheckpoint?: FakeOssRecoveryCheckpoint;
  sourceDirectory: string;
  targetDirectory: string;
}>;

export type RehydrateFakeOssFromIndexFileOptions = Readonly<{
  indexPath: string;
  onCheckpoint?: FakeOssRecoveryCheckpoint;
  sourceDirectory: string;
  targetDirectory: string;
}>;

export type FakeOssRecoveryCheckpointName =
  | "after-object-copy"
  | "after-target-mkdir"
  | "before-publish"
  | "before-owned-target-cleanup";

export type FakeOssRecoveryCheckpoint = (
  checkpoint: FakeOssRecoveryCheckpointName,
) => Promise<void> | void;

export type FakeOssRecoveredObject = Readonly<{
  byteSize: number;
  checksumSha256: string;
  logicalPath: string;
  metadataFile: string;
  objectFile: string;
  objectId: string;
  objectKey: string;
  storageProfileId: string | null;
  versionId: string;
}>;

export type FakeOssRecoverySummary = Readonly<{
  backupId: string;
  databaseLogicalSha256: string;
  entriesSha256: string;
  objects: readonly FakeOssRecoveredObject[];
  targetDirectory: string;
}>;

export class FakeOssRecoveryError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "FakeOssRecoveryError";
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new FakeOssRecoveryError(code, message);
}

function errorCode(error: unknown) {
  return error instanceof Error && "code" in error
    ? String(error.code)
    : "";
}

function stableJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      fail("FAKE_OSS_INDEX_INVALID", "Recovery index contains a non-finite number");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  fail("FAKE_OSS_INDEX_INVALID", "Recovery index contains an unsupported value");
}

function sha256(value: Buffer | string) {
  return createHash("sha256").update(value).digest("hex");
}

function jsonObject(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("FAKE_OSS_INDEX_INVALID", "Recovery index object is invalid");
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    fail("FAKE_OSS_INDEX_INVALID", "Recovery index fields are invalid");
  }
}

function validUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      value,
    );
}

function validSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function boundedIdentity(value: unknown, label: string) {
  if (
    typeof value !== "string" || !value || value.length > 1_024 ||
    value.includes("\0")
  ) {
    fail("FAKE_OSS_INDEX_INVALID", `${label} is invalid`);
  }
  return value;
}

function safeLogicalMirrorPath(value: unknown) {
  if (typeof value !== "string" || value.length > 1_024 || value.includes("\0")) {
    fail("FAKE_OSS_INDEX_INVALID", "Recovery mirror path is invalid");
  }
  const parts = value.split("/");
  if (
    parts.length !== 2 || parts[0] !== "oss-mirrors" ||
    !validUuid(parts[1]) || value.includes("\\")
  ) {
    fail("FAKE_OSS_INDEX_INVALID", "Recovery mirror path is invalid");
  }
  return value;
}

function safeByteSize(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    fail("FAKE_OSS_INDEX_INVALID", "Recovery object byte size is invalid");
  }
  return value;
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareEntries(left: OssRecoveryIndexEntry, right: OssRecoveryIndexEntry) {
  return compareText(left.objectKey, right.objectKey) ||
    compareText(left.versionId, right.versionId) ||
    compareText(left.logicalPath, right.logicalPath);
}

function validateEntries(value: unknown): readonly OssRecoveryIndexEntry[] {
  if (!Array.isArray(value) || value.length > maximumIndexEntries) {
    fail("FAKE_OSS_INDEX_INVALID", "Recovery index entries are invalid");
  }
  const logicalPaths = new Set<string>();
  const identities = new Set<string>();
  const normalized = value.map((raw) => {
    const entry = jsonObject(raw);
    exactKeys(entry, [
      "byteSize",
      "checksumSha256",
      "logicalPath",
      "objectKey",
      "storageProfileId",
      "versionId",
    ]);
    const logicalPath = safeLogicalMirrorPath(entry.logicalPath);
    const objectKey = boundedIdentity(entry.objectKey, "Recovery object key");
    const versionId = boundedIdentity(entry.versionId, "Recovery object version");
    const storageProfileId = entry.storageProfileId === null
      ? null
      : boundedIdentity(entry.storageProfileId, "Recovery storage profile");
    if (!validSha256(entry.checksumSha256)) {
      fail("FAKE_OSS_INDEX_INVALID", "Recovery object checksum is invalid");
    }
    const identity = stableJson({ objectKey, versionId });
    if (logicalPaths.has(logicalPath) || identities.has(identity)) {
      fail("FAKE_OSS_INDEX_INVALID", "Recovery index contains duplicate objects");
    }
    logicalPaths.add(logicalPath);
    identities.add(identity);
    return Object.freeze({
      byteSize: safeByteSize(entry.byteSize),
      checksumSha256: entry.checksumSha256,
      logicalPath,
      objectKey,
      storageProfileId,
      versionId,
    });
  });
  normalized.sort(compareEntries);
  const objectIds = new Set<string>();
  for (const entry of normalized) {
    const objectId = encodeFakeOssObjectIdentity(entry.objectKey, entry.versionId);
    if (objectIds.has(objectId)) {
      fail("FAKE_OSS_INDEX_INVALID", "Recovery object identity hash is duplicated");
    }
    objectIds.add(objectId);
  }
  return Object.freeze(normalized);
}

/**
 * Returns the canonical JSON representation used by entriesSha256. Entries are
 * validated and sorted first, so callers cannot accidentally hash input order.
 */
export function stableEncodeOssRecoveryEntries(
  entries: readonly OssRecoveryIndexEntry[],
) {
  return stableJson(validateEntries(entries));
}

export function ossRecoveryEntriesSha256(
  entries: readonly OssRecoveryIndexEntry[],
) {
  return sha256(stableEncodeOssRecoveryEntries(entries));
}

/**
 * Creates the index written beside restored mirrors. The index itself is not
 * signed: its authenticity is inherited only when restore derives it from an
 * authenticated backup manifest and publishes it into a trusted private tree.
 * entriesSha256 is a canonical integrity self-check, not a signature. This
 * function performs no filesystem or network operation.
 */
export function createFakeOssRecoveryIndex(
  options: CreateFakeOssRecoveryIndexOptions,
): OssRecoveryIndex {
  if (!validUuid(options.backupId)) {
    fail("FAKE_OSS_INDEX_INVALID", "Recovery backup id is invalid");
  }
  if (!validSha256(options.databaseLogicalSha256)) {
    fail("FAKE_OSS_INDEX_INVALID", "Recovery database checksum is invalid");
  }
  const entries = validateEntries(options.entries);
  return Object.freeze({
    backupId: options.backupId,
    databaseLogicalSha256: options.databaseLogicalSha256,
    entries,
    entriesSha256: sha256(stableJson(entries)),
    format: ossRecoveryIndexFormat,
    version: ossRecoveryIndexVersion,
  });
}

export function validateOssRecoveryIndex(value: unknown): OssRecoveryIndex {
  const index = jsonObject(value);
  exactKeys(index, [
    "backupId",
    "databaseLogicalSha256",
    "entries",
    "entriesSha256",
    "format",
    "version",
  ]);
  if (
    index.format !== ossRecoveryIndexFormat ||
    index.version !== ossRecoveryIndexVersion ||
    typeof index.backupId !== "string" ||
    typeof index.databaseLogicalSha256 !== "string"
  ) {
    fail("FAKE_OSS_INDEX_INVALID", "Recovery index contract is invalid");
  }
  const canonical = createFakeOssRecoveryIndex({
    backupId: index.backupId,
    databaseLogicalSha256: index.databaseLogicalSha256,
    entries: index.entries as readonly OssRecoveryIndexEntry[],
  });
  if (
    !validSha256(index.entriesSha256) ||
    index.entriesSha256 !== canonical.entriesSha256 ||
    stableJson(index.entries) !== stableJson(canonical.entries)
  ) {
    fail(
      "FAKE_OSS_INDEX_INVALID",
      "Recovery index entries are not canonical or fail their checksum",
    );
  }
  return canonical;
}

/**
 * Encodes an OSS key/version pair into a filename-safe, fixed-length identity.
 * Neither caller-controlled string is ever interpreted as a filesystem path.
 */
export function encodeFakeOssObjectIdentity(
  objectKey: string,
  versionId: string,
) {
  const checkedKey = boundedIdentity(objectKey, "Recovery object key");
  const checkedVersion = boundedIdentity(versionId, "Recovery object version");
  return sha256(stableJson({
    format: "unboundry-fake-oss-object",
    objectKey: checkedKey,
    version: 1,
    versionId: checkedVersion,
  }));
}

function normalizedAbsolute(path: string, label: string) {
  if (!path || !isAbsolute(path) || resolve(path) !== path) {
    fail("FAKE_OSS_PATH_INVALID", `${label} must be an absolute normalized path`);
  }
  return path;
}

export function fakeOssRecoveryClaimPath(targetDirectory: string) {
  const target = normalizedAbsolute(targetDirectory, "Fake OSS target directory");
  return join(dirname(target), `.${basename(target)}${fakeOssClaimSuffix}`);
}

function containsPath(parent: string, child: string) {
  const difference = relative(parent, child);
  return difference === "" ||
    (!isAbsolute(difference) &&
      !difference.startsWith(`..${sep}`) && difference !== "..");
}

async function canonicalPotentialPath(path: string) {
  let current = path;
  const missing: string[] = [];
  for (;;) {
    try {
      return resolve(await realpath(current), ...missing);
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
      const parent = dirname(current);
      if (parent === current) throw error;
      missing.unshift(basename(current));
      current = parent;
    }
  }
}

function currentUid() {
  if (typeof process.getuid !== "function") {
    fail("FAKE_OSS_PERMISSIONS_INVALID", "Filesystem owner checks are unavailable");
  }
  return BigInt(process.getuid());
}

function trustedDirectoryMetadata(details: BigIntStats) {
  const uid = currentUid();
  const mode = details.mode & 0o7777n;
  const trustedOwner = details.uid === 0n || details.uid === uid;
  const protectedFromOthers = (mode & 0o022n) === 0n;
  const stickySharedRoot = (mode & 0o1000n) !== 0n && trustedOwner;
  return details.isDirectory() && trustedOwner &&
    (protectedFromOthers || stickySharedRoot);
}

async function validatePhysicalDirectoryChain(
  path: string,
  allowTrustedLinks: boolean,
) {
  const uid = currentUid();
  let current = path;
  for (;;) {
    const details = await lstat(current, { bigint: true });
    const trustedLink = allowTrustedLinks && details.isSymbolicLink() &&
      (details.uid === 0n || details.uid === uid);
    if (!trustedLink && !trustedDirectoryMetadata(details)) {
      fail(
        "FAKE_OSS_PERMISSIONS_INVALID",
        "Filesystem directory ancestry is unsafe",
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

function assertPrivateDirectory(details: BigIntStats, requireCurrentOwner: boolean) {
  const uid = currentUid();
  const trustedOwner = requireCurrentOwner
    ? details.uid === uid
    : details.uid === 0n || details.uid === uid;
  if (
    details.isSymbolicLink() || !details.isDirectory() || !trustedOwner ||
    (details.mode & 0o077n) !== 0n
  ) {
    fail("FAKE_OSS_PERMISSIONS_INVALID", "Recovery directory is not private");
  }
}

function assertPrivateFile(details: BigIntStats) {
  const uid = currentUid();
  if (
    details.isSymbolicLink() || !details.isFile() ||
    (details.uid !== 0n && details.uid !== uid) ||
    (details.mode & 0o077n) !== 0n || details.nlink !== 1n
  ) {
    fail("FAKE_OSS_PERMISSIONS_INVALID", "Recovery file is not private");
  }
}

type FileEvidence = Readonly<{
  ctimeNs: bigint;
  dev: bigint;
  ino: bigint;
  mtimeNs: bigint;
  sha256: string;
  size: number;
}>;

async function inspectPrivateRegularFile(
  path: string,
  maximumBytes: number,
): Promise<FileEvidence> {
  const before = await lstat(path, { bigint: true });
  assertPrivateFile(before);
  if (before.size > BigInt(maximumBytes)) {
    fail("FAKE_OSS_FILE_TOO_LARGE", "Recovery file exceeds its size limit");
  }
  const noFollow = "O_NOFOLLOW" in fileConstants ? fileConstants.O_NOFOLLOW : 0;
  const handle = await open(path, fileConstants.O_RDONLY | noFollow);
  let buffer: Buffer | undefined;
  try {
    const opened = await handle.stat({ bigint: true });
    assertPrivateFile(opened);
    if (
      opened.dev !== before.dev || opened.ino !== before.ino ||
      opened.size !== before.size || opened.mtimeNs !== before.mtimeNs ||
      opened.ctimeNs !== before.ctimeNs
    ) {
      fail("FAKE_OSS_SOURCE_CHANGED", "Recovery file changed while opening");
    }
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
      if (!bytesRead) {
        fail("FAKE_OSS_SOURCE_CHANGED", "Recovery file ended unexpectedly");
      }
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    assertPrivateFile(after);
    if (
      after.dev !== opened.dev || after.ino !== opened.ino ||
      after.size !== opened.size || after.mtimeNs !== opened.mtimeNs ||
      after.ctimeNs !== opened.ctimeNs
    ) {
      fail("FAKE_OSS_SOURCE_CHANGED", "Recovery file changed while reading");
    }
    return Object.freeze({
      ctimeNs: opened.ctimeNs,
      dev: opened.dev,
      ino: opened.ino,
      mtimeNs: opened.mtimeNs,
      sha256: hash.digest("hex"),
      size: Number(opened.size),
    });
  } finally {
    buffer?.fill(0);
    await handle.close();
  }
}

async function readBoundedPrivateFile(path: string, maximumBytes: number) {
  const evidence = await inspectPrivateRegularFile(path, maximumBytes);
  const noFollow = "O_NOFOLLOW" in fileConstants ? fileConstants.O_NOFOLLOW : 0;
  const handle = await open(path, fileConstants.O_RDONLY | noFollow);
  let value: Buffer | undefined;
  let overflowProbe: Buffer | undefined;
  try {
    const opened = await handle.stat({ bigint: true });
    assertPrivateFile(opened);
    if (
      opened.dev !== evidence.dev || opened.ino !== evidence.ino ||
      Number(opened.size) !== evidence.size || opened.mtimeNs !== evidence.mtimeNs ||
      opened.ctimeNs !== evidence.ctimeNs
    ) {
      fail("FAKE_OSS_SOURCE_CHANGED", "Recovery index changed before reading");
    }
    const openedSize = Number(opened.size);
    if (!Number.isSafeInteger(openedSize) || openedSize > maximumBytes) {
      fail("FAKE_OSS_FILE_TOO_LARGE", "Recovery file exceeds its size limit");
    }
    value = Buffer.allocUnsafe(openedSize);
    let position = 0;
    while (position < openedSize) {
      const { bytesRead } = await handle.read(
        value,
        position,
        Math.min(ioChunkBytes, openedSize - position),
        position,
      );
      if (!bytesRead) {
        fail("FAKE_OSS_SOURCE_CHANGED", "Recovery index ended unexpectedly");
      }
      position += bytesRead;
    }
    // Read at most opened.size + 1 bytes in total. A same-inode expansion is
    // detected without allowing an attacker to make this reader allocate or
    // consume more than the configured maximum plus one probe byte.
    overflowProbe = Buffer.allocUnsafe(1);
    const overflow = await handle.read(overflowProbe, 0, 1, openedSize);
    if (overflow.bytesRead !== 0) {
      fail("FAKE_OSS_FILE_TOO_LARGE", "Recovery file expanded past its size limit");
    }
    const after = await handle.stat({ bigint: true });
    assertPrivateFile(after);
    if (
      after.dev !== opened.dev || after.ino !== opened.ino ||
      after.size !== opened.size || after.mtimeNs !== opened.mtimeNs ||
      after.ctimeNs !== opened.ctimeNs || value.length !== evidence.size ||
      sha256(value) !== evidence.sha256
    ) {
      value.fill(0);
      fail("FAKE_OSS_SOURCE_CHANGED", "Recovery index changed while reading");
    }
    return value;
  } catch (error) {
    value?.fill(0);
    throw error;
  } finally {
    overflowProbe?.fill(0);
    await handle.close();
  }
}

export async function readOssRecoveryIndex(indexPath: string) {
  const path = normalizedAbsolute(indexPath, "Recovery index path");
  await validateTrustedDirectoryChain(dirname(path));
  const value = await readBoundedPrivateFile(path, indexMaximumBytes);
  try {
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(value));
    } catch {
      fail("FAKE_OSS_INDEX_INVALID", "Recovery index JSON is invalid");
    }
    return validateOssRecoveryIndex(parsed);
  } finally {
    value.fill(0);
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

async function writePrivateFile(path: string, value: Buffer | string) {
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(value);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(path, 0o600);
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
      fail("FAKE_OSS_WRITE_FAILED", "Fake OSS object write made no progress");
    }
    offset += bytesWritten;
  }
}

type VerifiedPrivateFileExpectation = Readonly<{
  byteSize: number;
  checksumSha256: string;
}>;

async function copyVerifiedPrivateFile(
  source: string,
  destination: string,
  expected: VerifiedPrivateFileExpectation,
  label: string,
) {
  const before = await inspectPrivateRegularFile(source, expected.byteSize);
  if (
    before.size !== expected.byteSize ||
    before.sha256 !== expected.checksumSha256
  ) {
    fail(
      "FAKE_OSS_SOURCE_MISMATCH",
      `${label} does not match its size and checksum`,
    );
  }
  const noFollow = "O_NOFOLLOW" in fileConstants ? fileConstants.O_NOFOLLOW : 0;
  const input = await open(source, fileConstants.O_RDONLY | noFollow);
  let output: Awaited<ReturnType<typeof open>> | undefined;
  let buffer: Buffer | undefined;
  try {
    const opened = await input.stat({ bigint: true });
    assertPrivateFile(opened);
    if (
      opened.dev !== before.dev || opened.ino !== before.ino ||
      Number(opened.size) !== before.size || opened.mtimeNs !== before.mtimeNs ||
      opened.ctimeNs !== before.ctimeNs
    ) {
      fail("FAKE_OSS_SOURCE_CHANGED", `${label} changed before copying`);
    }
    output = await open(destination, "wx", 0o600);
    buffer = Buffer.allocUnsafe(ioChunkBytes);
    const hash = createHash("sha256");
    let position = 0;
    while (position < expected.byteSize) {
      const { bytesRead } = await input.read(
        buffer,
        0,
        Math.min(buffer.length, expected.byteSize - position),
        position,
      );
      if (!bytesRead) {
        fail("FAKE_OSS_SOURCE_CHANGED", `${label} ended while copying`);
      }
      const chunk = buffer.subarray(0, bytesRead);
      hash.update(chunk);
      await writeAll(output, chunk, position);
      position += bytesRead;
    }
    const after = await input.stat({ bigint: true });
    assertPrivateFile(after);
    if (
      after.dev !== opened.dev || after.ino !== opened.ino ||
      after.size !== opened.size || after.mtimeNs !== opened.mtimeNs ||
      after.ctimeNs !== opened.ctimeNs ||
      hash.digest("hex") !== expected.checksumSha256
    ) {
      fail("FAKE_OSS_SOURCE_CHANGED", `${label} changed while copying`);
    }
    await output.sync();
  } finally {
    buffer?.fill(0);
    await output?.close().catch(() => undefined);
    await input.close().catch(() => undefined);
  }
  await chmod(destination, 0o600);
  const written = await inspectPrivateRegularFile(
    destination,
    expected.byteSize,
  );
  if (
    written.size !== expected.byteSize ||
    written.sha256 !== expected.checksumSha256
  ) {
    fail("FAKE_OSS_WRITE_FAILED", `${label} failed post-write verification`);
  }
}

async function copyVerifiedObject(
  source: string,
  destination: string,
  entry: OssRecoveryIndexEntry,
) {
  return copyVerifiedPrivateFile(source, destination, entry, "Recovery mirror");
}

function sameFileEvidence(left: FileEvidence, right: FileEvidence) {
  return left.ctimeNs === right.ctimeNs && left.dev === right.dev &&
    left.ino === right.ino && left.mtimeNs === right.mtimeNs &&
    left.sha256 === right.sha256 && left.size === right.size;
}

async function assertStandaloneSourceDatabase(databasePath: string) {
  for (const suffix of ["-journal", "-shm", "-wal"] as const) {
    try {
      await lstat(`${databasePath}${suffix}`, { bigint: true });
      fail(
        "FAKE_OSS_DATABASE_NOT_STANDALONE",
        "Recovery source database must not have SQLite sidecars",
      );
    } catch (error) {
      if (error instanceof FakeOssRecoveryError) throw error;
      if (errorCode(error) !== "ENOENT") throw error;
    }
  }
}

async function unlinkIfPresent(path: string) {
  try {
    await unlink(path);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }
}

/**
 * Proves that the authenticated-manifest-derived index belongs to the restored
 * SQLite tree. The source is copied byte-for-byte into a private sibling
 * scratch directory because logical inspection needs temporary sort files and
 * must never mutate the restored source. The entries checksum alone provides
 * integrity self-checking; it does not authenticate this database binding.
 */
async function inspectSourceDatabaseLogicalSha256(
  sourceDirectory: string,
  inspectionParent: string,
) {
  const databasePath = join(sourceDirectory, "unboundry.sqlite");
  await assertStandaloneSourceDatabase(databasePath);
  const initial = await lstat(databasePath, { bigint: true });
  assertPrivateFile(initial);
  if (initial.size > BigInt(Number.MAX_SAFE_INTEGER)) {
    fail("FAKE_OSS_FILE_TOO_LARGE", "Recovery source database is too large");
  }
  const sourceEvidence = await inspectPrivateRegularFile(
    databasePath,
    Number(initial.size),
  );
  const scratchDirectory = await mkdtemp(
    join(inspectionParent, ".unboundry-fake-oss-inspect-"),
  );
  const snapshotPath = join(scratchDirectory, "unboundry.sqlite");
  try {
    await chmod(scratchDirectory, 0o700);
    const scratchDetails = await lstat(scratchDirectory, { bigint: true });
    assertPrivateDirectory(scratchDetails, true);
    await copyVerifiedPrivateFile(
      databasePath,
      snapshotPath,
      {
        byteSize: sourceEvidence.size,
        checksumSha256: sourceEvidence.sha256,
      },
      "Recovery source database",
    );
    let logicalSha256: string;
    try {
      logicalSha256 = inspectBackupDatabase(
        snapshotPath,
        scratchDirectory,
      ).logicalSha256;
    } catch {
      fail(
        "FAKE_OSS_DATABASE_INVALID",
        "Recovery source database failed exact logical inspection",
      );
    }
    const finalEvidence = await inspectPrivateRegularFile(
      databasePath,
      sourceEvidence.size,
    );
    await assertStandaloneSourceDatabase(databasePath);
    if (!sameFileEvidence(sourceEvidence, finalEvidence)) {
      fail(
        "FAKE_OSS_SOURCE_CHANGED",
        "Recovery source database changed during logical inspection",
      );
    }
    return logicalSha256;
  } finally {
    await unlinkIfPresent(snapshotPath);
    await rmdir(scratchDirectory);
  }
}

type DirectoryIdentity = Readonly<{ dev: bigint; ino: bigint }>;

function directoryIdentity(details: BigIntStats): DirectoryIdentity {
  return Object.freeze({ dev: details.dev, ino: details.ino });
}

function sameDirectoryIdentity(left: DirectoryIdentity, right: DirectoryIdentity) {
  return left.dev === right.dev && left.ino === right.ino;
}

async function assertDirectoryIdentity(
  path: string,
  expected: DirectoryIdentity,
  requireCurrentOwner: boolean,
) {
  const details = await lstat(path, { bigint: true });
  assertPrivateDirectory(details, requireCurrentOwner);
  if (!sameDirectoryIdentity(directoryIdentity(details), expected)) {
    fail("FAKE_OSS_TARGET_CHANGED", "Recovery directory identity changed");
  }
}

async function pathExists(path: string) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false;
    throw error;
  }
}

async function prepareStage(targetDirectory: string, index: OssRecoveryIndex) {
  const parent = dirname(targetDirectory);
  if (parent === targetDirectory) {
    fail("FAKE_OSS_PATH_INVALID", "Filesystem root cannot be a fake OSS target");
  }
  await validateTrustedDirectoryChain(parent);
  const stageDirectory = await mkdtemp(join(
    parent,
    `.${basename(targetDirectory)}.fake-oss-stage-`,
  ));
  await chmod(stageDirectory, 0o700);
  const details = await lstat(stageDirectory, { bigint: true });
  assertPrivateDirectory(details, true);
  const identity = directoryIdentity(details);
  const markerPath = join(stageDirectory, fakeOssStageMarker);
  await writePrivateFile(markerPath, `${stableJson({
    backupId: index.backupId,
    databaseLogicalSha256: index.databaseLogicalSha256,
    entriesSha256: index.entriesSha256,
    format: "unboundry-fake-oss-recovery-stage",
    targetName: basename(targetDirectory),
    version: 1,
  })}\n`);
  await assertDirectoryIdentity(stageDirectory, identity, true);
  await syncDirectory(stageDirectory);
  await syncDirectory(parent);
  return Object.freeze({ identity, markerPath, parent, stageDirectory });
}

async function validateStageMarker(
  markerPath: string,
  targetDirectory: string,
  index: OssRecoveryIndex,
) {
  const value = await readBoundedPrivateFile(markerPath, indexMaximumBytes);
  try {
    let parsed: Record<string, unknown>;
    try {
      parsed = jsonObject(JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(value),
      ));
    } catch (error) {
      if (error instanceof FakeOssRecoveryError) throw error;
      fail("FAKE_OSS_INVENTORY_INVALID", "Fake OSS staging marker is invalid");
    }
    exactKeys(parsed, [
      "backupId",
      "databaseLogicalSha256",
      "entriesSha256",
      "format",
      "targetName",
      "version",
    ]);
    if (
      parsed.backupId !== index.backupId ||
      parsed.databaseLogicalSha256 !== index.databaseLogicalSha256 ||
      parsed.entriesSha256 !== index.entriesSha256 ||
      parsed.format !== "unboundry-fake-oss-recovery-stage" ||
      parsed.targetName !== basename(targetDirectory) || parsed.version !== 1
    ) {
      fail("FAKE_OSS_INVENTORY_INVALID", "Fake OSS staging marker is invalid");
    }
  } finally {
    value.fill(0);
  }
}

function objectMetadata(
  index: OssRecoveryIndex,
  entry: OssRecoveryIndexEntry,
  objectId: string,
) {
  return Object.freeze({
    backupId: index.backupId,
    byteSize: entry.byteSize,
    checksumSha256: entry.checksumSha256,
    databaseLogicalSha256: index.databaseLogicalSha256,
    format: "unboundry-fake-oss-object" as const,
    logicalPath: entry.logicalPath,
    objectId,
    objectKey: entry.objectKey,
    storageProfileId: entry.storageProfileId,
    version: 1 as const,
    versionId: entry.versionId,
  });
}

async function validateFinalInventory(
  targetDirectory: string,
  index: OssRecoveryIndex,
  objects: readonly FakeOssRecoveredObject[],
  markerName?: string,
) {
  const expectedTopLevel = [
    ...(markerName ? [markerName] : []),
    "objects",
    ossRecoveryIndexFileName,
  ].sort(compareText);
  const topLevel = (await readdir(targetDirectory)).sort(compareText);
  if (
    topLevel.length !== expectedTopLevel.length ||
    topLevel.some((name, position) => name !== expectedTopLevel[position])
  ) {
    fail("FAKE_OSS_INVENTORY_INVALID", "Fake OSS target inventory is invalid");
  }
  const expectedObjectNames = objects.flatMap((object) => [
    basename(object.metadataFile),
    basename(object.objectFile),
  ]).sort(compareText);
  const objectNames = (await readdir(join(targetDirectory, "objects"))).sort(compareText);
  if (
    objectNames.length !== expectedObjectNames.length ||
    objectNames.some((name, position) => name !== expectedObjectNames[position])
  ) {
    fail("FAKE_OSS_INVENTORY_INVALID", "Fake OSS object inventory is invalid");
  }
  const entryByIdentity = new Map(index.entries.map((entry) => [
    encodeFakeOssObjectIdentity(entry.objectKey, entry.versionId),
    entry,
  ]));
  for (const object of objects) {
    const entry = entryByIdentity.get(object.objectId);
    if (!entry) {
      fail("FAKE_OSS_INVENTORY_INVALID", "Fake OSS object is not indexed");
    }
    const objectEvidence = await inspectPrivateRegularFile(
      object.objectFile,
      entry.byteSize,
    );
    if (
      objectEvidence.size !== entry.byteSize ||
      objectEvidence.sha256 !== entry.checksumSha256
    ) {
      fail("FAKE_OSS_INVENTORY_INVALID", "Fake OSS object content is invalid");
    }
    const expectedMetadata = Buffer.from(
      `${stableJson(objectMetadata(index, entry, object.objectId))}\n`,
      "utf8",
    );
    try {
      const metadataEvidence = await inspectPrivateRegularFile(
        object.metadataFile,
        expectedMetadata.length,
      );
      if (
        metadataEvidence.size !== expectedMetadata.length ||
        metadataEvidence.sha256 !== sha256(expectedMetadata)
      ) {
        fail("FAKE_OSS_INVENTORY_INVALID", "Fake OSS object metadata is invalid");
      }
    } finally {
      expectedMetadata.fill(0);
    }
  }
  const persistedIndex = await readOssRecoveryIndex(
    join(targetDirectory, ossRecoveryIndexFileName),
  );
  if (stableJson(persistedIndex) !== stableJson(index)) {
    fail("FAKE_OSS_INVENTORY_INVALID", "Persisted recovery index changed");
  }
}

function recoveredObjects(
  targetDirectory: string,
  index: OssRecoveryIndex,
) {
  const objectsDirectory = join(targetDirectory, "objects");
  return Object.freeze(index.entries.map((entry) => {
    const objectId = encodeFakeOssObjectIdentity(entry.objectKey, entry.versionId);
    return Object.freeze({
      byteSize: entry.byteSize,
      checksumSha256: entry.checksumSha256,
      logicalPath: entry.logicalPath,
      metadataFile: join(objectsDirectory, `${objectId}.json`),
      objectFile: join(objectsDirectory, `${objectId}.bin`),
      objectId,
      objectKey: entry.objectKey,
      storageProfileId: entry.storageProfileId,
      versionId: entry.versionId,
    });
  }));
}

function recoverySummary(
  targetDirectory: string,
  index: OssRecoveryIndex,
  objects: readonly FakeOssRecoveredObject[],
): FakeOssRecoverySummary {
  return Object.freeze({
    backupId: index.backupId,
    databaseLogicalSha256: index.databaseLogicalSha256,
    entriesSha256: index.entriesSha256,
    objects,
    targetDirectory,
  });
}

type FakeOssClaimLease = Readonly<{
  claimPath: string;
  database: DatabaseSync;
  dev: bigint;
  ino: bigint;
  stageMarkerSha256: string;
  stageName: string;
}>;

function validateClaimDatabase(
  database: DatabaseSync,
  index: OssRecoveryIndex,
  targetDirectory: string,
) {
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
    PRAGMA table_info(fake_oss_recovery_claim)
  `).all() as Array<{ name?: unknown }>;
  const row = database.prepare(`
    SELECT id, backup_id, database_logical_sha256, entries_sha256, format,
      stage_marker_sha256, stage_name, target_name, version
    FROM fake_oss_recovery_claim
    ORDER BY id
  `).all() as Array<Record<string, unknown>>;
  if (
    integrity?.integrity_check !== "ok" || journal?.journal_mode !== "delete" ||
    schema.length !== 1 || schema[0]?.type !== "table" ||
    schema[0]?.name !== "fake_oss_recovery_claim" ||
    columns.map(({ name }) => name).join(",") !==
      "id,backup_id,database_logical_sha256,entries_sha256,format,stage_marker_sha256,stage_name,target_name,version" ||
    row.length !== 1 || Number(row[0]?.id) !== 1 ||
    row[0]?.backup_id !== index.backupId ||
    row[0]?.database_logical_sha256 !== index.databaseLogicalSha256 ||
    row[0]?.entries_sha256 !== index.entriesSha256 ||
    row[0]?.format !== "unboundry-fake-oss-recovery-claim" ||
    !validSha256(row[0]?.stage_marker_sha256) ||
    typeof row[0]?.stage_name !== "string" ||
    !String(row[0]?.stage_name).startsWith(
      `.${basename(targetDirectory)}.fake-oss-stage-`,
    ) ||
    basename(String(row[0]?.stage_name)) !== row[0]?.stage_name ||
    row[0]?.target_name !== basename(targetDirectory) ||
    Number(row[0]?.version) !== 1
  ) {
    fail("FAKE_OSS_TARGET_CONFLICT", "Fake OSS recovery claim is invalid");
  }
  return Object.freeze({
    stageMarkerSha256: String(row[0]!.stage_marker_sha256),
    stageName: String(row[0]!.stage_name),
  });
}

function assertPrivateClaimFile(details: BigIntStats) {
  const uid = currentUid();
  if (
    details.isSymbolicLink() || !details.isFile() ||
    (details.uid !== 0n && details.uid !== uid) ||
    (details.mode & 0o077n) !== 0n ||
    (details.nlink !== 1n && details.nlink !== 2n)
  ) {
    fail("FAKE_OSS_TARGET_CONFLICT", "Fake OSS recovery claim is unsafe");
  }
}

async function createPreparedClaimDatabase(
  stageDirectory: string,
  targetDirectory: string,
  index: OssRecoveryIndex,
): Promise<string> {
  const preparedPath = join(stageDirectory, ".prepared-fake-oss-claim.sqlite");
  const stageMarkerSha256 = (await inspectPrivateRegularFile(
    join(stageDirectory, fakeOssStageMarker),
    indexMaximumBytes,
  )).sha256;
  const database = new DatabaseSync(preparedPath);
  try {
    database.exec("PRAGMA journal_mode = DELETE");
    database.exec(`
      CREATE TABLE fake_oss_recovery_claim (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        backup_id TEXT NOT NULL,
        database_logical_sha256 TEXT NOT NULL,
        entries_sha256 TEXT NOT NULL,
        format TEXT NOT NULL,
        stage_marker_sha256 TEXT NOT NULL,
        stage_name TEXT NOT NULL,
        target_name TEXT NOT NULL,
        version INTEGER NOT NULL CHECK (version = 1)
      );
    `);
    database.prepare(`
      INSERT INTO fake_oss_recovery_claim (
        id, backup_id, database_logical_sha256, entries_sha256, format,
        stage_marker_sha256, stage_name, target_name, version
      ) VALUES (
        1, ?, ?, ?, 'unboundry-fake-oss-recovery-claim', ?, ?, ?, 1
      )
    `).run(
      index.backupId,
      index.databaseLogicalSha256,
      index.entriesSha256,
      stageMarkerSha256,
      basename(stageDirectory),
      basename(targetDirectory),
    );
  } finally {
    database.close();
  }
  await chmod(preparedPath, 0o600);
  const descriptor = await open(preparedPath, fileConstants.O_RDONLY);
  try {
    await descriptor.sync();
  } finally {
    await descriptor.close();
  }
  assertPrivateFile(await lstat(preparedPath, { bigint: true }));
  await syncDirectory(stageDirectory);
  return preparedPath;
}

async function acquireClaimLease(
  claimPath: string,
  targetDirectory: string,
  index: OssRecoveryIndex,
): Promise<FakeOssClaimLease> {
  const claimDetails = await lstat(claimPath, { bigint: true });
  assertPrivateClaimFile(claimDetails);
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(claimPath, { timeout: 1_000 });
    database.exec("PRAGMA busy_timeout = 1000");
    try {
      database.exec("BEGIN IMMEDIATE");
    } catch {
      fail(
        "FAKE_OSS_TARGET_BUSY",
        "Another fake OSS recovery still owns this target",
      );
    }
    const claim = validateClaimDatabase(database, index, targetDirectory);
    const current = await lstat(claimPath, { bigint: true });
    assertPrivateClaimFile(current);
    if (current.dev !== claimDetails.dev || current.ino !== claimDetails.ino) {
      fail("FAKE_OSS_TARGET_CONFLICT", "Fake OSS recovery claim changed");
    }
    return Object.freeze({
      claimPath,
      database,
      dev: current.dev,
      ino: current.ino,
      stageMarkerSha256: claim.stageMarkerSha256,
      stageName: claim.stageName,
    });
  } catch (error) {
    if (database?.isTransaction) {
      try {
        database.exec("ROLLBACK");
      } catch {
        // Closing below releases the failed claim attempt.
      }
    }
    database?.close();
    if (error instanceof FakeOssRecoveryError) throw error;
    fail("FAKE_OSS_TARGET_CONFLICT", "Fake OSS recovery claim is invalid");
  }
}

async function cleanupClaimedStage(
  lease: FakeOssClaimLease,
  targetDirectory: string,
  index: OssRecoveryIndex,
) {
  const stageDirectory = join(dirname(targetDirectory), lease.stageName);
  let details: BigIntStats;
  try {
    details = await lstat(stageDirectory, { bigint: true });
  } catch (error) {
    if (errorCode(error) === "ENOENT") return;
    throw error;
  }
  assertPrivateDirectory(details, true);
  await validateTrustedDirectoryChain(stageDirectory);
  const identity = directoryIdentity(details);
  const marker = await inspectPrivateRegularFile(
    join(stageDirectory, fakeOssStageMarker),
    indexMaximumBytes,
  );
  if (marker.sha256 !== lease.stageMarkerSha256) {
    fail(
      "FAKE_OSS_TARGET_CONFLICT",
      "Claimed fake OSS staging marker does not match its locked claim",
    );
  }
  await validateStageMarker(
    join(stageDirectory, fakeOssStageMarker),
    targetDirectory,
    index,
  );
  const preparedClaim = join(
    stageDirectory,
    ".prepared-fake-oss-claim.sqlite",
  );
  try {
    const prepared = await lstat(preparedClaim, { bigint: true });
    assertPrivateClaimFile(prepared);
    if (
      prepared.dev !== lease.dev || prepared.ino !== lease.ino ||
      prepared.nlink !== 2n
    ) {
      fail(
        "FAKE_OSS_TARGET_CONFLICT",
        "Claimed staging directory contains a foreign prepared claim",
      );
    }
    await unlink(preparedClaim);
    await syncDirectory(stageDirectory);
  } catch (error) {
    if (
      error instanceof FakeOssRecoveryError ||
      errorCode(error) !== "ENOENT"
    ) throw error;
  }
  await validateFinalInventory(
    stageDirectory,
    index,
    recoveredObjects(stageDirectory, index),
    fakeOssStageMarker,
  );
  await assertDirectoryIdentity(stageDirectory, identity, true);
  await rm(stageDirectory, { force: true, recursive: true });
  await syncDirectory(dirname(targetDirectory));
}

function releaseClaimLease(lease: FakeOssClaimLease) {
  try {
    if (lease.database.isTransaction) lease.database.exec("ROLLBACK");
  } finally {
    lease.database.close();
  }
}

async function partialTargetHasOnlyRecoveryFiles(
  targetDirectory: string,
  index: OssRecoveryIndex,
) {
  const allowedTopLevel = new Set([
    "objects",
    ossRecoveryIndexFileName,
    fakeOssRecoveryOwnershipMarkerName,
  ]);
  const topLevel = await readdir(targetDirectory);
  if (topLevel.some((name) => !allowedTopLevel.has(name))) return false;
  const allowedObjects = new Set(recoveredObjects(targetDirectory, index).flatMap(
    (object) => [basename(object.metadataFile), basename(object.objectFile)],
  ));
  if (topLevel.includes("objects")) {
    const directory = await lstat(join(targetDirectory, "objects"), {
      bigint: true,
    });
    try {
      assertPrivateDirectory(directory, true);
    } catch {
      return false;
    }
    for (const name of await readdir(join(targetDirectory, "objects"))) {
      if (!allowedObjects.has(name)) return false;
      try {
        assertPrivateFile(await lstat(join(targetDirectory, "objects", name), {
          bigint: true,
        }));
      } catch {
        return false;
      }
    }
  }
  if (topLevel.includes(ossRecoveryIndexFileName)) {
    try {
      assertPrivateFile(await lstat(
        join(targetDirectory, ossRecoveryIndexFileName),
        { bigint: true },
      ));
    } catch {
      return false;
    }
  }
  return true;
}

async function assertOwnedTargetMarker(
  targetDirectory: string,
  targetIdentity: DirectoryIdentity,
  lease: FakeOssClaimLease,
  index: OssRecoveryIndex,
) {
  try {
    await validateTrustedDirectoryChain(targetDirectory);
    await assertDirectoryIdentity(targetDirectory, targetIdentity, true);
  } catch {
    fail(
      "FAKE_OSS_TARGET_CONFLICT",
      "Fake OSS target identity changed while its recovery claim was locked",
    );
  }
  const markerPath = join(
    targetDirectory,
    fakeOssRecoveryOwnershipMarkerName,
  );
  const [claim, marker] = await Promise.all([
    lstat(lease.claimPath, { bigint: true }),
    lstat(markerPath, { bigint: true }),
  ]);
  assertPrivateClaimFile(claim);
  assertPrivateClaimFile(marker);
  if (
    claim.dev !== lease.dev || claim.ino !== lease.ino ||
    marker.dev !== lease.dev || marker.ino !== lease.ino ||
    claim.nlink !== 2n || marker.nlink !== 2n
  ) {
    fail(
      "FAKE_OSS_TARGET_CONFLICT",
      "Fake OSS target ownership marker does not match its locked claim",
    );
  }
  if (!lease.database.isTransaction) {
    fail(
      "FAKE_OSS_TARGET_CONFLICT",
      "Fake OSS recovery claim lease is no longer active",
    );
  }
  validateClaimDatabase(lease.database, index, targetDirectory);
  return markerPath;
}

async function publishOwnedTargetMarker(
  targetDirectory: string,
  targetIdentity: DirectoryIdentity,
  lease: FakeOssClaimLease,
  index: OssRecoveryIndex,
  parentDirectory: string,
) {
  const markerPath = join(
    targetDirectory,
    fakeOssRecoveryOwnershipMarkerName,
  );
  try {
    await link(lease.claimPath, markerPath);
  } catch (error) {
    if (errorCode(error) === "EEXIST") {
      fail(
        "FAKE_OSS_TARGET_CONFLICT",
        "Fake OSS target ownership marker already exists",
      );
    }
    throw error;
  }
  await assertOwnedTargetMarker(targetDirectory, targetIdentity, lease, index);
  await syncDirectory(targetDirectory);
  await syncDirectory(parentDirectory);
  return markerPath;
}

async function removeClaimAndRelease(
  lease: FakeOssClaimLease,
  parentDirectory: string,
) {
  try {
    await unlink(lease.claimPath);
    await syncDirectory(parentDirectory);
  } finally {
    releaseClaimLease(lease);
  }
}

async function validatedExistingTarget(
  targetDirectory: string,
  index: OssRecoveryIndex,
) {
  const details = await lstat(targetDirectory, { bigint: true });
  assertPrivateDirectory(details, true);
  await validateTrustedDirectoryChain(targetDirectory);
  const objects = recoveredObjects(targetDirectory, index);
  try {
    await validateFinalInventory(targetDirectory, index, objects);
  } catch {
    fail(
      "FAKE_OSS_TARGET_CONFLICT",
      "Existing fake OSS target does not match this recovery index",
    );
  }
  return recoverySummary(targetDirectory, index, objects);
}

async function recoverExistingClaim(
  claimPath: string,
  targetDirectory: string,
  index: OssRecoveryIndex,
  onCheckpoint?: FakeOssRecoveryCheckpoint,
) {
  const lease = await acquireClaimLease(claimPath, targetDirectory, index);
  let released = false;
  const removeClaim = async () => {
    await cleanupClaimedStage(lease, targetDirectory, index);
    released = true;
    await removeClaimAndRelease(lease, dirname(targetDirectory));
  };
  try {
    if (!(await pathExists(targetDirectory))) {
      await removeClaim();
      return undefined;
    }
    let complete: FakeOssRecoverySummary | undefined;
    try {
      complete = await validatedExistingTarget(targetDirectory, index);
    } catch {
      // The matching sibling claim is the provenance required to distinguish
      // a crash residue from an unrelated target. Only the exact expected
      // partial inventory is eligible for retry cleanup.
    }
    if (complete) {
      await removeClaim();
      return complete;
    }
    const targetDetails = await lstat(targetDirectory, { bigint: true });
    assertPrivateDirectory(targetDetails, true);
    const targetIdentity = directoryIdentity(targetDetails);
    let markerPath: string;
    try {
      markerPath = await assertOwnedTargetMarker(
        targetDirectory,
        targetIdentity,
        lease,
        index,
      );
    } catch {
      fail(
        "FAKE_OSS_TARGET_CONFLICT",
        "Claimed fake OSS target has no matching ownership marker",
      );
    }
    const objects = recoveredObjects(targetDirectory, index);
    let ownedTargetComplete = false;
    try {
      await validateFinalInventory(
        targetDirectory,
        index,
        objects,
        fakeOssRecoveryOwnershipMarkerName,
      );
      ownedTargetComplete = true;
    } catch (error) {
      if (
        !(error instanceof FakeOssRecoveryError) ||
        error.code !== "FAKE_OSS_INVENTORY_INVALID"
      ) {
        throw error;
      }
    }
    if (ownedTargetComplete) {
      await unlink(markerPath);
      await syncDirectory(targetDirectory);
      await removeClaim();
      await validateFinalInventory(targetDirectory, index, objects);
      return recoverySummary(targetDirectory, index, objects);
    }
    if (!(await partialTargetHasOnlyRecoveryFiles(targetDirectory, index))) {
      fail(
        "FAKE_OSS_TARGET_CONFLICT",
        "Claimed fake OSS target contains foreign recovery data",
      );
    }
    await onCheckpoint?.("before-owned-target-cleanup");
    await assertOwnedTargetMarker(
      targetDirectory,
      targetIdentity,
      lease,
      index,
    );
    if (!(await partialTargetHasOnlyRecoveryFiles(targetDirectory, index))) {
      fail(
        "FAKE_OSS_TARGET_CONFLICT",
        "Claimed fake OSS target changed before cleanup",
      );
    }
    await rm(targetDirectory, { force: true, recursive: true });
    await syncDirectory(dirname(targetDirectory));
    await removeClaim();
    return undefined;
  } finally {
    if (!released) releaseClaimLease(lease);
  }
}

export async function rehydrateFakeOss(
  options: RehydrateFakeOssOptions,
): Promise<FakeOssRecoverySummary> {
  const index = validateOssRecoveryIndex(options.index);
  const sourceDirectory = normalizedAbsolute(
    options.sourceDirectory,
    "Recovery source directory",
  );
  const targetDirectory = normalizedAbsolute(
    options.targetDirectory,
    "Fake OSS target directory",
  );
  const [canonicalSource, canonicalTarget] = await Promise.all([
    canonicalPotentialPath(sourceDirectory),
    canonicalPotentialPath(targetDirectory),
  ]);
  if (
    containsPath(canonicalSource, canonicalTarget) ||
    containsPath(canonicalTarget, canonicalSource)
  ) {
    fail("FAKE_OSS_PATH_OVERLAP", "Recovery source and target must be disjoint");
  }
  await validateTrustedDirectoryChain(sourceDirectory);
  const sourceDetails = await lstat(sourceDirectory, { bigint: true });
  assertPrivateDirectory(sourceDetails, false);
  const sourceIdentity = directoryIdentity(sourceDetails);
  const inspectionParent = dirname(canonicalTarget);
  await validateTrustedDirectoryChain(inspectionParent);
  const sourceDatabaseLogicalSha256 =
    await inspectSourceDatabaseLogicalSha256(
      sourceDirectory,
      inspectionParent,
    );
  if (sourceDatabaseLogicalSha256 !== index.databaseLogicalSha256) {
    fail(
      "FAKE_OSS_DATABASE_MISMATCH",
      "Recovery index belongs to a different restored database",
    );
  }
  const mirrorsDirectory = join(sourceDirectory, "oss-mirrors");
  const mirrorsDetails = await lstat(mirrorsDirectory, { bigint: true });
  assertPrivateDirectory(mirrorsDetails, false);
  const mirrorsIdentity = directoryIdentity(mirrorsDetails);

  const claimPath = fakeOssRecoveryClaimPath(targetDirectory);
  if (await pathExists(claimPath)) {
    const recovered = await recoverExistingClaim(
      claimPath,
      targetDirectory,
      index,
      options.onCheckpoint,
    );
    if (recovered) return recovered;
  } else if (await pathExists(targetDirectory)) {
    return validatedExistingTarget(targetDirectory, index);
  }

  const stage = await prepareStage(targetDirectory, index);
  try {
    const objectsDirectory = join(stage.stageDirectory, "objects");
    await mkdir(objectsDirectory, { mode: 0o700 });
    await chmod(objectsDirectory, 0o700);
    const objectsDetails = await lstat(objectsDirectory, { bigint: true });
    assertPrivateDirectory(objectsDetails, true);
    const objectsIdentity = directoryIdentity(objectsDetails);
    const stagedObjects = recoveredObjects(stage.stageDirectory, index);

    for (const [position, entry] of index.entries.entries()) {
      await assertDirectoryIdentity(sourceDirectory, sourceIdentity, false);
      await assertDirectoryIdentity(mirrorsDirectory, mirrorsIdentity, false);
      await assertDirectoryIdentity(stage.stageDirectory, stage.identity, true);
      await assertDirectoryIdentity(objectsDirectory, objectsIdentity, true);
      const recovered = stagedObjects[position]!;
      const source = join(sourceDirectory, ...entry.logicalPath.split("/"));
      await copyVerifiedObject(source, recovered.objectFile, entry);
      const metadata = objectMetadata(index, entry, recovered.objectId);
      await writePrivateFile(recovered.metadataFile, `${stableJson(metadata)}\n`);
      const expectedMetadata = Buffer.from(`${stableJson(metadata)}\n`, "utf8");
      try {
        const writtenMetadata = await inspectPrivateRegularFile(
          recovered.metadataFile,
          expectedMetadata.length,
        );
        if (
          writtenMetadata.size !== expectedMetadata.length ||
          writtenMetadata.sha256 !== sha256(expectedMetadata)
        ) {
          fail("FAKE_OSS_WRITE_FAILED", "Fake OSS metadata failed verification");
        }
      } finally {
        expectedMetadata.fill(0);
      }
      await options.onCheckpoint?.("after-object-copy");
    }

    await assertDirectoryIdentity(sourceDirectory, sourceIdentity, false);
    await assertDirectoryIdentity(mirrorsDirectory, mirrorsIdentity, false);
    await assertDirectoryIdentity(stage.stageDirectory, stage.identity, true);
    await assertDirectoryIdentity(objectsDirectory, objectsIdentity, true);
    await syncDirectory(objectsDirectory);
    await writePrivateFile(
      join(stage.stageDirectory, ossRecoveryIndexFileName),
      `${stableJson(index)}\n`,
    );
    await validateStageMarker(stage.markerPath, targetDirectory, index);
    await validateFinalInventory(
      stage.stageDirectory,
      index,
      stagedObjects,
      fakeOssStageMarker,
    );
    await syncDirectory(stage.stageDirectory);
    await options.onCheckpoint?.("before-publish");
    const preparedClaim = await createPreparedClaimDatabase(
      stage.stageDirectory,
      targetDirectory,
      index,
    );
    let linkedClaim = false;
    try {
      // A hard link publishes the fully initialized claim atomically and never
      // replaces an existing claim. If the process exits after this point, a
      // retry can authenticate and lock the deterministic sibling claim before
      // deciding whether the final directory is complete, partial, or foreign.
      await link(preparedClaim, claimPath);
      linkedClaim = true;
      await syncDirectory(stage.parent);
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
      const recovered = await recoverExistingClaim(
        claimPath,
        targetDirectory,
        index,
        options.onCheckpoint,
      );
      if (recovered) return recovered;
      try {
        await link(preparedClaim, claimPath);
        linkedClaim = true;
        await syncDirectory(stage.parent);
      } catch (retryError) {
        if (errorCode(retryError) === "EEXIST") {
          fail(
            "FAKE_OSS_TARGET_BUSY",
            "Another fake OSS recovery claimed this target during retry",
          );
        }
        throw retryError;
      }
    }
    if (linkedClaim) {
      await unlink(preparedClaim);
      await syncDirectory(stage.stageDirectory);
    }
    let claimLease: FakeOssClaimLease | undefined;
    let targetIdentity: DirectoryIdentity | undefined;
    const removeActiveClaim = async () => {
      const active = claimLease;
      claimLease = undefined;
      if (active) await removeClaimAndRelease(active, stage.parent);
    };
    try {
      claimLease = await acquireClaimLease(claimPath, targetDirectory, index);
      if (await pathExists(targetDirectory)) {
        await removeActiveClaim();
        fail(
          "FAKE_OSS_TARGET_CONFLICT",
          "Foreign fake OSS target appeared before no-replace publication",
        );
      }
      try {
        await mkdir(targetDirectory, { mode: 0o700 });
      } catch (error) {
        await removeActiveClaim();
        if (errorCode(error) === "EEXIST") {
          fail(
            "FAKE_OSS_TARGET_CONFLICT",
            "Foreign fake OSS target won the final-directory race",
          );
        }
        throw error;
      }
      const claimDetails = await lstat(targetDirectory, { bigint: true });
      assertPrivateDirectory(claimDetails, true);
      targetIdentity = directoryIdentity(claimDetails);
      await chmod(targetDirectory, 0o700);
      await assertDirectoryIdentity(targetDirectory, targetIdentity, true);
      await syncDirectory(targetDirectory);
      await publishOwnedTargetMarker(
        targetDirectory,
        targetIdentity,
        claimLease,
        index,
        stage.parent,
      );
      await options.onCheckpoint?.("after-target-mkdir");
      const finalObjects = recoveredObjects(targetDirectory, index);
      await mkdir(join(targetDirectory, "objects"), { mode: 0o700 });
      for (const [position, staged] of stagedObjects.entries()) {
        const final = finalObjects[position]!;
        await copyVerifiedPrivateFile(
          staged.objectFile,
          final.objectFile,
          {
            byteSize: staged.byteSize,
            checksumSha256: staged.checksumSha256,
          },
          "Staged fake OSS object",
        );
        const metadata = Buffer.from(`${stableJson(objectMetadata(
          index,
          index.entries[position]!,
          final.objectId,
        ))}\n`, "utf8");
        try {
          await copyVerifiedPrivateFile(
            staged.metadataFile,
            final.metadataFile,
            { byteSize: metadata.length, checksumSha256: sha256(metadata) },
            "Staged fake OSS metadata",
          );
        } finally {
          metadata.fill(0);
        }
      }
      await syncDirectory(join(targetDirectory, "objects"));
      const encodedIndex = Buffer.from(`${stableJson(index)}\n`, "utf8");
      try {
        await copyVerifiedPrivateFile(
          join(stage.stageDirectory, ossRecoveryIndexFileName),
          join(targetDirectory, ossRecoveryIndexFileName),
          { byteSize: encodedIndex.length, checksumSha256: sha256(encodedIndex) },
          "Staged fake OSS index",
        );
      } finally {
        encodedIndex.fill(0);
      }
      await validateFinalInventory(
        targetDirectory,
        index,
        finalObjects,
        fakeOssRecoveryOwnershipMarkerName,
      );
      await syncDirectory(targetDirectory);
      const ownershipMarker = await assertOwnedTargetMarker(
        targetDirectory,
        targetIdentity,
        claimLease,
        index,
      );
      await unlink(ownershipMarker);
      await syncDirectory(targetDirectory);
      await removeActiveClaim();
      await validateFinalInventory(targetDirectory, index, finalObjects);
      await syncDirectory(stage.parent);
      return recoverySummary(targetDirectory, index, finalObjects);
    } catch (error) {
      let owned = false;
      if (targetIdentity) {
        try {
          await assertOwnedTargetMarker(
            targetDirectory,
            targetIdentity,
            claimLease!,
            index,
          );
          owned = true;
        } catch {
          // A missing or mismatched ownership marker makes cleanup unsafe.
        }
      }
      let targetRemoved = false;
      try {
        targetRemoved = !(await pathExists(targetDirectory));
      } catch {
        // Keep the authenticated claim when target state cannot be resolved.
      }
      let cleanupError: unknown;
      try {
        if (owned) {
          try {
            await options.onCheckpoint?.("before-owned-target-cleanup");
            await assertOwnedTargetMarker(
              targetDirectory,
              targetIdentity!,
              claimLease!,
              index,
            );
            if (!(await partialTargetHasOnlyRecoveryFiles(targetDirectory, index))) {
              fail(
                "FAKE_OSS_TARGET_CONFLICT",
                "Owned fake OSS target changed before cleanup",
              );
            }
            await rm(targetDirectory, { force: true, recursive: true });
            await syncDirectory(stage.parent);
            targetRemoved = true;
          } catch (error) {
            cleanupError = error;
          }
        }
      } finally {
        if (claimLease) {
          if (targetRemoved) {
            await removeClaimAndRelease(claimLease, stage.parent);
          } else {
            // Preserve the authenticated claim if cleanup itself fails, so a
            // later retry can safely recover the remaining partial target.
            releaseClaimLease(claimLease);
          }
        }
      }
      if (cleanupError) throw cleanupError;
      throw error;
    }
  } finally {
    // The private stage is never the requested final path. It is removed after
    // success and ordinary failures; a hard process crash can leave only this
    // hidden, provenance-marked sibling and never blocks a target retry.
    await assertDirectoryIdentity(stage.stageDirectory, stage.identity, true);
    await rm(stage.stageDirectory, { force: true, recursive: true });
    await syncDirectory(stage.parent);
  }
}

export async function rehydrateFakeOssFromIndexFile(
  options: RehydrateFakeOssFromIndexFileOptions,
) {
  const index = await readOssRecoveryIndex(options.indexPath);
  return rehydrateFakeOss({
    index,
    onCheckpoint: options.onCheckpoint,
    sourceDirectory: options.sourceDirectory,
    targetDirectory: options.targetDirectory,
  });
}
