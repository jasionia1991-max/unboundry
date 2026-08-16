import {
  createHash,
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from "node:crypto";
import {
  constants,
} from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { assertAccountMutationAllowed } from "./accountMutationFence.ts";
import { appDataDirectory, openAppDatabase } from "./database.ts";
import { safeCanonicalAliyunOssEndpoint } from "./outboundNetwork.ts";

export type StorageProfileStatus = "active" | "draft" | "verified";

export type AliyunStorageProfile = {
  accessKeyId: string;
  accessKeySecret: string;
  bucket: string;
  createdAt: string;
  endpoint: string;
  id: string;
  label: string;
  lastVerifiedAt?: string;
  provider: "aliyun-oss";
  region: string;
  status: StorageProfileStatus;
  updatedAt: string;
};

export type StorageMediaRouting = Readonly<{
  enabled: boolean;
  profile?: AliyunStorageProfile;
}>;

type StorageProfileDocument = {
  activeProfileId?: string;
  mediaRoutingEnabled?: boolean;
  profiles: AliyunStorageProfile[];
  version: 1;
};

type EncryptedDocument = {
  ciphertext: string;
  iv: string;
  tag: string;
  version: 1;
};

const associatedData = Buffer.from("unboundry:storage-profiles:v1", "utf8");
const repairMarkerName = ".storage-profile-repair-incomplete.json";
const secretDocumentLockTimeoutMs = 5_000;
const secretFileMaximumBytes = 16 * 1024 * 1024;

let documentMutationTail: Promise<void> = Promise.resolve();

export class StorageProfileRepairRecoveryRequiredError extends Error {
  readonly code = "STORAGE_REPAIR_RECOVERY_REQUIRED";

  constructor() {
    super("Storage profile repair recovery is required");
    this.name = "StorageProfileRepairRecoveryRequiredError";
  }
}

type RepairMarker = Readonly<{
  afterSha256: string;
  beforeFile: string;
  beforeSha256: string;
  nextFile: string;
  operationId: string;
  version: 1;
}>;

type PathIdentity = Readonly<{ dev: bigint; ino: bigint }>;

function sha256(value: Buffer | string) {
  return createHash("sha256").update(value).digest("hex");
}

function sameIdentity(left: PathIdentity, right: PathIdentity) {
  return left.dev === right.dev && left.ino === right.ino;
}

async function privateDirectoryIdentity(directory: string): Promise<PathIdentity> {
  const details = await lstat(directory, { bigint: true });
  const currentUid = typeof process.getuid === "function"
    ? BigInt(process.getuid())
    : undefined;
  if (
    currentUid === undefined ||
    details.isSymbolicLink() ||
    !details.isDirectory() ||
    details.uid !== currentUid ||
    (details.mode & 0o077n) !== 0n ||
    await realpath(directory) !== directory
  ) {
    throw new Error("Storage secret directory is not private");
  }
  return Object.freeze({ dev: details.dev, ino: details.ino });
}

async function readPrivateFile(
  path: string,
  maximumBytes = secretFileMaximumBytes,
) {
  const before = await lstat(path, { bigint: true });
  const currentUid = typeof process.getuid === "function"
    ? BigInt(process.getuid())
    : undefined;
  if (
    currentUid === undefined ||
    before.isSymbolicLink() ||
    !before.isFile() ||
    before.uid !== currentUid ||
    before.nlink !== 1n ||
    (before.mode & 0o777n) !== 0o600n ||
    before.size < 1n ||
    before.size > BigInt(maximumBytes)
  ) {
    throw new Error("Storage secret file is not private");
  }
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  let scratch: Buffer | undefined;
  try {
    const opened = await handle.stat({ bigint: true });
    if (
      !opened.isFile() ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.uid !== before.uid ||
      opened.nlink !== 1n ||
      (opened.mode & 0o777n) !== 0o600n ||
      opened.size !== before.size ||
      opened.mtimeNs !== before.mtimeNs ||
      opened.ctimeNs !== before.ctimeNs ||
      opened.size < 1n ||
      opened.size > BigInt(maximumBytes)
    ) {
      throw new Error("Storage secret file changed while opening");
    }
    const expectedSize = Number(opened.size);
    scratch = Buffer.alloc(expectedSize + 1);
    let position = 0;
    while (position < scratch.length) {
      const { bytesRead } = await handle.read(
        scratch,
        position,
        scratch.length - position,
        position,
      );
      if (!bytesRead) break;
      position += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    if (
      position !== expectedSize ||
      after.isFile() !== true ||
      after.dev !== opened.dev ||
      after.ino !== opened.ino ||
      after.uid !== opened.uid ||
      after.nlink !== opened.nlink ||
      (after.mode & 0o777n) !== (opened.mode & 0o777n) ||
      after.size !== opened.size ||
      after.mtimeNs !== opened.mtimeNs ||
      after.ctimeNs !== opened.ctimeNs
    ) {
      throw new Error("Storage secret file changed while reading");
    }
    const result = Buffer.from(scratch.subarray(0, expectedSize));
    scratch.fill(0);
    scratch = undefined;
    return result;
  } finally {
    scratch?.fill(0);
    await handle.close();
  }
}

async function writePrivateDurable(path: string, value: Buffer | string) {
  const handle = await open(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await handle.writeFile(value);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncDirectory(directory: string) {
  const handle = await open(directory, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function withDocumentMutationLock<T>(operation: () => Promise<T>) {
  const previous = documentMutationTail;
  let release!: () => void;
  documentMutationTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  let lockDatabase: DatabaseSync | undefined;
  try {
    const target = paths();
    await ensurePrivateSecretDirectory();
    const existingLock = await lstat(target.writeLock, { bigint: true })
      .catch(() => undefined);
    const currentUid = typeof process.getuid === "function"
      ? BigInt(process.getuid())
      : undefined;
    if (
      existingLock && (
        currentUid === undefined ||
        existingLock.isSymbolicLink() ||
        !existingLock.isFile() ||
        existingLock.uid !== currentUid ||
        existingLock.nlink !== 1n ||
        (existingLock.mode & 0o777n) !== 0o600n
      )
    ) {
      throw new Error("Storage configuration lock is invalid");
    }
    lockDatabase = new DatabaseSync(target.writeLock, {
      timeout: secretDocumentLockTimeoutMs,
    });
    await chmod(target.writeLock, 0o600);
    const openedLock = await lstat(target.writeLock, { bigint: true });
    if (
      currentUid === undefined ||
      openedLock.isSymbolicLink() ||
      !openedLock.isFile() ||
      openedLock.uid !== currentUid ||
      openedLock.nlink !== 1n ||
      (openedLock.mode & 0o777n) !== 0o600n
    ) {
      throw new Error("Storage configuration lock is invalid");
    }
    lockDatabase.exec(`PRAGMA busy_timeout = ${secretDocumentLockTimeoutMs}`);
    if (
      process.env.UNBOUNDRY_SAFE_TEST === "1" &&
      process.env.UNBOUNDRY_TEST_STORAGE_LOCK_ATTEMPT_FILE
    ) {
      await writeFile(
        process.env.UNBOUNDRY_TEST_STORAGE_LOCK_ATTEMPT_FILE,
        "attempt\n",
        { flag: "wx", mode: 0o600 },
      );
    }
    lockDatabase.exec(`
      CREATE TABLE IF NOT EXISTS provider_profile_write_lock (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        marker INTEGER NOT NULL
      );
      INSERT OR IGNORE INTO provider_profile_write_lock (id, marker)
      VALUES (1, 0);
    `);
    // BEGIN IMMEDIATE itself is the cross-process lease. It deliberately has
    // no durable mutation: releasing it via ROLLBACK cannot create an
    // outcome-unknown error after the protected operation has succeeded.
    lockDatabase.exec("BEGIN IMMEDIATE");
    return await operation();
  } finally {
    try {
      if (lockDatabase) {
        try {
          if (lockDatabase.isTransaction) lockDatabase.exec("ROLLBACK");
        } catch {
          // Closing the dedicated connection still releases the lease. A
          // release failure must not erase a successful operation result.
        } finally {
          try {
            lockDatabase.close();
          } catch {
            // The connection is already unusable; the OS releases it on exit.
          }
        }
      }
    } finally {
      release();
    }
  }
}

function paths() {
  const directory = join(appDataDirectory(), "secrets");
  return {
    directory,
    key: join(directory, "config-master.key"),
    marker: join(directory, repairMarkerName),
    profiles: join(directory, "storage-profiles.enc.json"),
    writeLock: join(directory, "provider-profile-write-lock.sqlite"),
  };
}

async function ensurePrivateSecretDirectory() {
  const target = paths();
  await mkdir(target.directory, { mode: 0o700, recursive: true });
  return privateDirectoryIdentity(target.directory);
}

async function existingEncryptionKey() {
  await privateDirectoryIdentity(paths().directory);
  const existing = await readPrivateFile(paths().key, 32);
  if (existing.length !== 32) throw new Error("Invalid secret-store key");
  return existing;
}

async function encryptionKey() {
  const target = paths();
  await ensurePrivateSecretDirectory();
  try {
    return await existingEncryptionKey();
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code !== "ENOENT"
    ) {
      throw error;
    }
  }
  const created = randomBytes(32);
  try {
    await writeFile(target.key, created, { flag: "wx", mode: 0o600 });
    return created;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "EEXIST"
    ) {
      return existingEncryptionKey();
    }
    throw error;
  }
}

async function repairMarkerExists() {
  try {
    await lstat(paths().marker);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function isMissingPathError(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function stableEncryptedDocumentBytes() {
  const target = paths();
  if (await repairMarkerExists()) {
    throw new StorageProfileRepairRecoveryRequiredError();
  }
  let directoryBefore: PathIdentity;
  try {
    directoryBefore = await privateDirectoryIdentity(target.directory);
  } catch (error) {
    if (!isMissingPathError(error)) throw error;
    if (await repairMarkerExists()) {
      throw new StorageProfileRepairRecoveryRequiredError();
    }
    try {
      await lstat(target.directory);
    } catch (afterError) {
      if (isMissingPathError(afterError)) return undefined;
      throw afterError;
    }
    throw new StorageProfileRepairRecoveryRequiredError();
  }

  let first: Buffer;
  try {
    first = await readPrivateFile(target.profiles);
  } catch (error) {
    if (!isMissingPathError(error)) throw error;
    if (
      await repairMarkerExists() ||
      !sameIdentity(directoryBefore, await privateDirectoryIdentity(target.directory))
    ) {
      throw new StorageProfileRepairRecoveryRequiredError();
    }
    try {
      await lstat(target.profiles);
    } catch (afterError) {
      if (isMissingPathError(afterError)) return undefined;
      throw afterError;
    }
    throw new StorageProfileRepairRecoveryRequiredError();
  }
  const firstIdentity = await lstat(target.profiles, { bigint: true });
  if (await repairMarkerExists()) {
    throw new StorageProfileRepairRecoveryRequiredError();
  }
  const second = await readPrivateFile(target.profiles).catch((error) => {
    if (isMissingPathError(error)) {
      throw new StorageProfileRepairRecoveryRequiredError();
    }
    throw error;
  });
  const secondIdentity = await lstat(target.profiles, { bigint: true });
  if (
    await repairMarkerExists() ||
    !sameIdentity(directoryBefore, await privateDirectoryIdentity(target.directory)) ||
    firstIdentity.dev !== secondIdentity.dev ||
    firstIdentity.ino !== secondIdentity.ino ||
    sha256(first) !== sha256(second)
  ) {
    throw new StorageProfileRepairRecoveryRequiredError();
  }
  return second;
}

async function readDocument(): Promise<StorageProfileDocument> {
  const encryptedBytes = await stableEncryptedDocumentBytes();
  if (!encryptedBytes) return { profiles: [], version: 1 };
  const encrypted = JSON.parse(
    encryptedBytes.toString("utf8"),
  ) as EncryptedDocument;
  if (
    encrypted.version !== 1 ||
    !encrypted.iv ||
    !encrypted.tag ||
    !encrypted.ciphertext
  ) {
    throw new Error("Invalid encrypted storage configuration");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    await existingEncryptionKey(),
    Buffer.from(encrypted.iv, "base64"),
  );
  decipher.setAAD(associatedData);
  decipher.setAuthTag(Buffer.from(encrypted.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
    decipher.final(),
  ]);
  const document = JSON.parse(
    plaintext.toString("utf8"),
  ) as StorageProfileDocument;
  if (document.version !== 1 || !Array.isArray(document.profiles)) {
    throw new Error("Invalid storage configuration");
  }
  return document;
}

function encryptedDocument(document: StorageProfileDocument, key: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(associatedData);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(document), "utf8"),
    cipher.final(),
  ]);
  return JSON.stringify({
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    version: 1,
  } satisfies EncryptedDocument);
}

async function writeDocument(document: StorageProfileDocument) {
  const target = paths();
  const temporary = `${target.profiles}.${randomUUID()}.tmp`;
  await writeFile(temporary, encryptedDocument(document, await encryptionKey()), {
    flag: "wx",
    mode: 0o600,
  });
  await rename(temporary, target.profiles);
  await chmod(target.profiles, 0o600);
}

function markerFileName(kind: "before" | "next", operationId: string) {
  return `.storage-profile-repair-${operationId}.${kind}`;
}

function validMarkerFileName(value: string, kind: "before" | "next") {
  return new RegExp(
    `^\\.storage-profile-repair-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.${kind}$`,
    "i",
  ).test(value);
}

async function readRepairMarker(): Promise<RepairMarker | undefined> {
  if (!await repairMarkerExists()) return undefined;
  const parsed = JSON.parse(
    (await readPrivateFile(paths().marker, 16 * 1024)).toString("utf8"),
  ) as Partial<RepairMarker>;
  if (
    parsed.version !== 1 ||
    typeof parsed.operationId !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(parsed.operationId) ||
    typeof parsed.beforeFile !== "string" ||
    !validMarkerFileName(parsed.beforeFile, "before") ||
    parsed.beforeFile !== markerFileName("before", parsed.operationId) ||
    typeof parsed.nextFile !== "string" ||
    !validMarkerFileName(parsed.nextFile, "next") ||
    parsed.nextFile !== markerFileName("next", parsed.operationId) ||
    typeof parsed.beforeSha256 !== "string" ||
    !/^[0-9a-f]{64}$/i.test(parsed.beforeSha256) ||
    typeof parsed.afterSha256 !== "string" ||
    !/^[0-9a-f]{64}$/i.test(parsed.afterSha256)
  ) {
    throw new StorageProfileRepairRecoveryRequiredError();
  }
  return parsed as RepairMarker;
}

function repairAuditCommitted(operationId: string) {
  const inspection = new DatabaseSync(
    join(appDataDirectory(), "unboundry.sqlite"),
    { readOnly: true, timeout: 5_000 },
  );
  try {
    return Boolean(inspection.prepare(`
      SELECT 1 FROM admin_audit_events
      WHERE
        action = 'repair_storage_profile_state'
        AND json_valid(details)
        AND json_extract(details, '$.operationId') = ?
      LIMIT 1
    `).get(operationId));
  } finally {
    inspection.close();
  }
}

async function removeIfPresent(path: string) {
  try {
    await unlink(path);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }
}

async function cleanupRepairFiles(marker: RepairMarker) {
  const target = paths();
  await removeIfPresent(join(target.directory, marker.beforeFile));
  await removeIfPresent(join(target.directory, marker.nextFile));
  await removeIfPresent(target.marker);
  await syncDirectory(target.directory);
}

async function reconcileRepairMarker(marker: RepairMarker) {
  const target = paths();
  const directoryBefore = await privateDirectoryIdentity(target.directory);
  const current = await readPrivateFile(target.profiles);
  const currentSha256 = sha256(current);
  const committed = repairAuditCommitted(marker.operationId);
  if (committed) {
    if (currentSha256 !== marker.afterSha256) {
      throw new StorageProfileRepairRecoveryRequiredError();
    }
    await cleanupRepairFiles(marker);
    return true;
  }
  if (currentSha256 === marker.afterSha256) {
    const beforePath = join(target.directory, marker.beforeFile);
    const before = await readPrivateFile(beforePath);
    if (sha256(before) !== marker.beforeSha256) {
      throw new StorageProfileRepairRecoveryRequiredError();
    }
    if (!sameIdentity(directoryBefore, await privateDirectoryIdentity(target.directory))) {
      throw new StorageProfileRepairRecoveryRequiredError();
    }
    await rename(beforePath, target.profiles);
    await chmod(target.profiles, 0o600);
    await syncDirectory(target.directory);
  } else if (currentSha256 !== marker.beforeSha256) {
    throw new StorageProfileRepairRecoveryRequiredError();
  }
  await cleanupRepairFiles(marker);
  return false;
}

async function prepareRepairMarker(
  document: StorageProfileDocument,
  operationId: string,
) {
  const target = paths();
  const directoryIdentity = await privateDirectoryIdentity(target.directory);
  const before = await readPrivateFile(target.profiles);
  const next = Buffer.from(
    encryptedDocument(document, await existingEncryptionKey()),
    "utf8",
  );
  const marker: RepairMarker = Object.freeze({
    afterSha256: sha256(next),
    beforeFile: markerFileName("before", operationId),
    beforeSha256: sha256(before),
    nextFile: markerFileName("next", operationId),
    operationId,
    version: 1,
  });
  await writePrivateDurable(target.marker, JSON.stringify(marker));
  try {
    await writePrivateDurable(join(target.directory, marker.beforeFile), before);
    await writePrivateDurable(join(target.directory, marker.nextFile), next);
    await syncDirectory(target.directory);
    if (!sameIdentity(directoryIdentity, await privateDirectoryIdentity(target.directory))) {
      throw new StorageProfileRepairRecoveryRequiredError();
    }
  } catch (error) {
    await reconcileRepairMarker(marker);
    throw error;
  }
  return marker;
}

async function publishPreparedRepair(marker: RepairMarker) {
  const target = paths();
  const nextPath = join(target.directory, marker.nextFile);
  const next = await readPrivateFile(nextPath);
  if (sha256(next) !== marker.afterSha256) {
    throw new StorageProfileRepairRecoveryRequiredError();
  }
  await rename(nextPath, target.profiles);
  await chmod(target.profiles, 0o600);
  await syncDirectory(target.directory);
}

async function storageRepairTestBarrier() {
  if (process.env.UNBOUNDRY_SAFE_TEST !== "1") return;
  const ready = process.env.UNBOUNDRY_TEST_STORAGE_REPAIR_READY_FILE;
  const release = process.env.UNBOUNDRY_TEST_STORAGE_REPAIR_RELEASE_FILE;
  if (!ready || !release) return;
  await writeFile(ready, "ready\n", { flag: "wx", mode: 0o600 });
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      await lstat(release);
      return;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Storage repair test barrier timed out");
}

type StorageDocumentCommit<T> = (
  store: DatabaseSync,
  result: T,
) => void;

/**
 * Serialize one authenticated document mutation with its SQLite audit. The
 * document lock is always acquired before the database writer lock, matching
 * the publication reservation paths. Audit failures happen before rename, so
 * they cannot leave an unaudited credential or routing change behind.
 */
async function mutateStorageDocument<T>(
  mutation: (
    document: StorageProfileDocument,
    transactionStore?: DatabaseSync,
  ) => T,
  actorUserId?: string,
  onCommit?: StorageDocumentCommit<T>,
) {
  if (onCommit && !actorUserId) {
    throw new Error("Authenticated storage audit requires an actor");
  }
  return withDocumentMutationLock(async () => {
    const document = await readDocument();
    if (!actorUserId) {
      const result = mutation(document);
      await writeDocument(document);
      return result;
    }
    const transactionStore = openAppDatabase();
    let transactionOpen = false;
    try {
      transactionStore.exec("BEGIN IMMEDIATE");
      transactionOpen = true;
      assertAccountMutationAllowed(transactionStore, actorUserId);
      const result = mutation(document, transactionStore);
      onCommit?.(transactionStore, result);
      await writeDocument(document);
      transactionStore.exec("COMMIT");
      transactionOpen = false;
      return result;
    } catch (error) {
      if (transactionOpen) {
        try {
          transactionStore.exec("ROLLBACK");
        } catch {
          // Closing the dedicated connection still releases the writer lock.
        }
      }
      throw error;
    } finally {
      transactionStore.close();
    }
  });
}

function storageProfileHasDurableReferences(
  profileId: string,
  transactionStore?: DatabaseSync,
) {
  const database = transactionStore ?? openAppDatabase();
  try {
    return Boolean(database.prepare(`
      SELECT 1 FROM media_assets
      WHERE storage_backend = 'oss' AND storage_profile_id = ?
      UNION ALL
      SELECT 1 FROM media_publication_attempts
      WHERE storage_backend = 'oss' AND storage_profile_id = ?
      LIMIT 1
    `).get(profileId, profileId));
  } finally {
    if (!transactionStore) database.close();
  }
}

function assertStorageProfileNotRetained(
  profileId: string,
  transactionStore?: DatabaseSync,
) {
  if (storageProfileHasDurableReferences(profileId, transactionStore)) {
    throw new Error("Storage profile is retained by registered media");
  }
}

function text(value: unknown, maximum: number) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function validEndpoint(value: string, region: string) {
  try {
    safeCanonicalAliyunOssEndpoint(value, region);
    return true;
  } catch {
    return false;
  }
}

function usableStorageProfile(
  profile: AliyunStorageProfile | undefined,
): profile is AliyunStorageProfile {
  return Boolean(
    profile &&
      profile.provider === "aliyun-oss" &&
      typeof profile.endpoint === "string" &&
      typeof profile.region === "string" &&
      validEndpoint(profile.endpoint, profile.region) &&
      typeof profile.bucket === "string" &&
      /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(profile.bucket) &&
      typeof profile.accessKeyId === "string" &&
      profile.accessKeyId.length >= 8 &&
      !/\s/.test(profile.accessKeyId) &&
      typeof profile.accessKeySecret === "string" &&
      profile.accessKeySecret.length >= 8 &&
      !/\s/.test(profile.accessKeySecret),
  );
}

function cleanProfileInput(
  input: Record<string, unknown>,
  current?: AliyunStorageProfile,
) {
  const label = text(input.label, 40);
  const endpoint = text(input.endpoint, 240);
  const region = text(input.region, 80);
  const bucket = text(input.bucket, 80);
  const accessKeyId =
    text(input.accessKeyId, 160) || current?.accessKeyId || "";
  const accessKeySecret =
    text(input.accessKeySecret, 320) || current?.accessKeySecret || "";
  if (
    !label ||
    !/^oss-[a-z0-9-]{3,70}$/.test(region) ||
    !validEndpoint(endpoint, region) ||
    !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket) ||
    accessKeyId.length < 8 ||
    /\s/.test(accessKeyId) ||
    accessKeySecret.length < 8 ||
    /\s/.test(accessKeySecret)
  ) {
    throw new Error("OSS configuration is invalid");
  }
  return {
    accessKeyId,
    accessKeySecret,
    bucket,
    endpoint,
    label,
    region,
  };
}

export function publicStorageProfile(profile: AliyunStorageProfile) {
  return {
    accessKeyIdMask: profile.accessKeyId
      ? `••••${profile.accessKeyId.slice(-4)}`
      : "",
    bucket: profile.bucket,
    endpoint: profile.endpoint,
    hasAccessKeySecret: Boolean(profile.accessKeySecret),
    id: profile.id,
    label: profile.label,
    lastVerifiedAt: profile.lastVerifiedAt,
    provider: profile.provider,
    region: profile.region,
    status: profile.status,
    updatedAt: profile.updatedAt,
  };
}

export async function listStorageProfiles() {
  return readDocument();
}

export async function activeStorageProfile() {
  const document = await readDocument();
  const profile = document.profiles.find(
    (candidate) =>
      usableStorageProfile(candidate) &&
      candidate.id === document.activeProfileId &&
      candidate.status === "active",
  );
  return profile;
}

/**
 * 读取路径使用的配置：正式配置因“重新测试连接”被降级为 verified 时，
 * 只要它仍是 activeProfileId 指向的配置，就必须继续可读，避免旧 OSS 素材失读。
 */
export async function readableStorageProfile() {
  const document = await readDocument();
  const profile = document.profiles.find(
    (candidate) =>
      usableStorageProfile(candidate) &&
      candidate.id === document.activeProfileId &&
      (candidate.status === "active" || candidate.status === "verified"),
  );
  return profile;
}

/**
 * Resolve the currently readable profile and create its durable publication
 * references while profile-document mutations are serialized. Once the
 * callback returns, an active journal row protects the fixed credentials from
 * deletion or in-place replacement until compensation finishes.
 */
export async function withReadableStorageProfileReservation<T>(
  operation: (profile: AliyunStorageProfile) => Promise<T> | T,
) {
  return withDocumentMutationLock(async () => {
    const document = await readDocument();
    const profile = document.profiles.find(
      (candidate) =>
        usableStorageProfile(candidate) &&
        candidate.id === document.activeProfileId &&
        (candidate.status === "active" || candidate.status === "verified"),
    );
    return profile ? operation(profile) : undefined;
  });
}

export async function storageProfileById(
  profileId: string | null | undefined,
) {
  if (!profileId) return undefined;
  const document = await readDocument();
  return document.profiles.find(
    (candidate) =>
      usableStorageProfile(candidate) &&
      candidate.id === profileId &&
      (candidate.status === "active" || candidate.status === "verified"),
  );
}

/**
 * 优先按素材登记时所属的配置读取；没有登记时回退到当前正式配置。
 */
export async function storageProfileForMedia(
  media: { storageProfileId?: string | null } | null | undefined,
) {
  if (
    media &&
    media.storageProfileId !== null &&
    media.storageProfileId !== undefined
  ) {
    return storageProfileById(media.storageProfileId);
  }
  return readableStorageProfile();
}

/** Destructive operations must never guess a legacy object's bucket. */
export async function storageProfileForDestructiveMedia(
  media: { storageProfileId?: string | null } | null | undefined,
) {
  if (!media?.storageProfileId) return undefined;
  return storageProfileById(media.storageProfileId);
}

export type StorageProfileRepairResult = Readonly<{
  activeProfileId: string;
  changed: boolean;
  mediaRoutingEnabled: boolean;
  operationId?: string;
  profile?: Readonly<{
    id: string;
    label: string;
    status: StorageProfileStatus;
  }>;
}>;

export type StorageProfileRepairOptions = Readonly<{
  actorUserId?: string;
  apply?: boolean;
  database?: DatabaseSync;
  onCommit?: StorageDocumentCommit<StorageProfileRepairResult>;
}>;

/**
 * Inspect or repair “activeProfileId points at a verified profile” corruption.
 * Apply is deliberately opt-in. SQLite and the encrypted file are not one
 * cross-media ACID transaction: a durable marker and exact before/after hashes
 * make the bounded rename/commit window compensatable, while every ordinary
 * storage read fails closed until an interrupted operation is reconciled.
 */
export async function repairStorageProfileState(
  options: StorageProfileRepairOptions = {},
) {
  if (!options.apply) {
    const document = await readDocument();
    const profile = document.profiles.find(
      (candidate) =>
        usableStorageProfile(candidate) &&
        candidate.id === document.activeProfileId &&
        (candidate.status === "active" || candidate.status === "verified"),
    );
    const changed = profile?.status === "verified";
    const result: StorageProfileRepairResult = {
      activeProfileId: document.activeProfileId ?? "",
      changed,
      mediaRoutingEnabled: changed
        ? false
        : Boolean(document.mediaRoutingEnabled),
      profile: profile
        ? {
            id: profile.id,
            label: profile.label,
            status: changed ? "active" : profile.status,
          }
        : undefined,
    };
    if (await repairMarkerExists()) {
      throw new StorageProfileRepairRecoveryRequiredError();
    }
    return result;
  }
  return withDocumentMutationLock(async () => {
    await storageRepairTestBarrier();
    const pendingMarker = await readRepairMarker();
    if (pendingMarker) await reconcileRepairMarker(pendingMarker);
    const document = await readDocument();
    const profile = document.profiles.find(
      (candidate) =>
        usableStorageProfile(candidate) &&
        candidate.id === document.activeProfileId &&
        (candidate.status === "active" || candidate.status === "verified"),
    );
    const changed = profile?.status === "verified";
    const operationId = randomUUID();
    const result: StorageProfileRepairResult = {
      activeProfileId: document.activeProfileId ?? "",
      changed,
      mediaRoutingEnabled: changed
        ? false
        : Boolean(document.mediaRoutingEnabled),
      operationId,
      profile: profile
        ? {
            id: profile.id,
            label: profile.label,
            status: changed ? "active" : profile.status,
          }
        : undefined,
    };
    if (!options.actorUserId || !options.database || !options.onCommit) {
      throw new Error("Storage repair apply requires an authenticated audit");
    }

    const transactionStore = options.database;
    let transactionOpen = false;
    let repairMarker: RepairMarker | undefined;
    try {
      if (changed && profile) {
        profile.status = "active";
        profile.updatedAt = new Date().toISOString();
        document.mediaRoutingEnabled = false;
        repairMarker = await prepareRepairMarker(document, operationId);
      }
      transactionStore.exec("BEGIN IMMEDIATE");
      transactionOpen = true;
      assertAccountMutationAllowed(transactionStore, options.actorUserId);
      options.onCommit(transactionStore, result);
      if (repairMarker) {
        await publishPreparedRepair(repairMarker);
        if (
          process.env.UNBOUNDRY_SAFE_TEST === "1" &&
          process.env.UNBOUNDRY_TEST_STORAGE_REPAIR_FAULT === "throw-after-rename"
        ) {
          throw new Error("Synthetic storage repair commit fault");
        }
        if (
          process.env.UNBOUNDRY_SAFE_TEST === "1" &&
          process.env.UNBOUNDRY_TEST_STORAGE_REPAIR_FAULT === "exit-after-rename"
        ) {
          process.exit(86);
        }
      }
      transactionStore.exec("COMMIT");
      transactionOpen = false;
      if (repairMarker) await cleanupRepairFiles(repairMarker);
      return result;
    } catch (error) {
      if (transactionOpen && transactionStore.isTransaction) {
        try {
          transactionStore.exec("ROLLBACK");
        } catch {
          // Closing the dedicated connection still releases the writer lock.
        }
      }
      if (repairMarker) {
        const committed = await reconcileRepairMarker(repairMarker);
        if (committed) return result;
      }
      throw error;
    }
  });
}

export async function storageMediaRoutingState() {
  const document = await readDocument();
  const profile = document.profiles.find(
    (candidate) =>
      usableStorageProfile(candidate) &&
      candidate.id === document.activeProfileId &&
      candidate.status === "active",
  );
  return {
    enabled: Boolean(document.mediaRoutingEnabled && profile),
    profile,
  };
}

/**
 * Hold the profile-document mutation lock from routing resolution through the
 * synchronous journal reservation callback. A selected profile therefore
 * gains its durable database reference before it can be switched away and
 * edited or deleted under the same ID.
 */
export async function withStorageMediaRoutingReservation<T>(
  reserve: (routing: StorageMediaRouting) => T,
  execution?: {
    afterRead?: (routing: StorageMediaRouting) => Promise<void> | void;
  },
) {
  return withDocumentMutationLock(async () => {
    const document = await readDocument();
    const profile = document.profiles.find(
      (candidate) =>
        usableStorageProfile(candidate) &&
        candidate.id === document.activeProfileId &&
        candidate.status === "active",
    );
    const routing: StorageMediaRouting = {
      enabled: Boolean(document.mediaRoutingEnabled && profile),
      profile,
    };
    await execution?.afterRead?.(routing);
    return reserve(routing);
  });
}

export async function setStorageMediaRouting(
  enabled: boolean,
  actorUserId?: string,
  onCommit?: StorageDocumentCommit<StorageMediaRouting>,
) {
  return mutateStorageDocument((document) => {
    const profile = document.profiles.find(
      (candidate) =>
        usableStorageProfile(candidate) &&
        candidate.id === document.activeProfileId &&
        candidate.status === "active",
    );
    if (enabled && !profile) {
      throw new Error("Select a verified storage profile first");
    }
    document.mediaRoutingEnabled = enabled;
    return {
      enabled,
      profile,
    } satisfies StorageMediaRouting;
  }, actorUserId, onCommit);
}

export async function saveStorageProfile(
  input: Record<string, unknown>,
  profileId?: string,
  actorUserId?: string,
  onCommit?: StorageDocumentCommit<AliyunStorageProfile>,
) {
  return mutateStorageDocument((document, transactionStore) => {
    const current = profileId
      ? document.profiles.find((profile) => profile.id === profileId)
      : undefined;
    if (profileId && !current) throw new Error("Storage profile not found");
    if (current?.status === "active") {
      throw new Error("Create and verify a replacement for the active profile");
    }
    if (current) assertStorageProfileNotRetained(current.id, transactionStore);
    const cleaned = cleanProfileInput(input, current);
    const timestamp = new Date().toISOString();
    const profile: AliyunStorageProfile = {
      ...cleaned,
      createdAt: current?.createdAt ?? timestamp,
      id: current?.id ?? randomUUID(),
      provider: "aliyun-oss",
      status: "draft",
      updatedAt: timestamp,
    };
    document.profiles = current
      ? document.profiles.map((candidate) =>
          candidate.id === current.id ? profile : candidate,
        )
      : [...document.profiles, profile];
    if (document.activeProfileId === profile.id) {
      document.activeProfileId = undefined;
    }
    return profile;
  }, actorUserId, onCommit);
}

function sameStorageProfileRevision(
  current: AliyunStorageProfile,
  expected: AliyunStorageProfile,
) {
  return (
    current.id === expected.id &&
    current.accessKeyId === expected.accessKeyId &&
    current.accessKeySecret === expected.accessKeySecret &&
    current.bucket === expected.bucket &&
    current.createdAt === expected.createdAt &&
    current.endpoint === expected.endpoint &&
    current.label === expected.label &&
    current.lastVerifiedAt === expected.lastVerifiedAt &&
    current.provider === expected.provider &&
    current.region === expected.region &&
    current.status === expected.status &&
    current.updatedAt === expected.updatedAt
  );
}

export async function markStorageProfileVerified(
  profileId: string,
  actorUserId?: string,
  onCommit?: StorageDocumentCommit<AliyunStorageProfile>,
  expectedProfile?: AliyunStorageProfile,
) {
  return mutateStorageDocument((document) => {
    const timestamp = new Date().toISOString();
    const profile = document.profiles.find(
      (candidate) => candidate.id === profileId,
    );
    if (!profile) throw new Error("Storage profile not found");
    if (!usableStorageProfile(profile)) {
      throw new Error("OSS configuration is invalid");
    }
    if (expectedProfile && !sameStorageProfileRevision(profile, expectedProfile)) {
      throw new Error("Storage profile changed during verification");
    }
    profile.lastVerifiedAt = timestamp;
    if (profile.status !== "active") {
      profile.status = "verified";
    }
    profile.updatedAt = timestamp;
    return profile;
  }, actorUserId, onCommit);
}

export async function activateStorageProfile(
  profileId: string,
  actorUserId?: string,
  onCommit?: StorageDocumentCommit<AliyunStorageProfile>,
) {
  return mutateStorageDocument((document) => {
    const profile = document.profiles.find(
      (candidate) => candidate.id === profileId,
    );
    if (
      !usableStorageProfile(profile) ||
      profile.status !== "verified"
    ) {
      throw new Error("Only a verified storage profile can be activated");
    }
    const timestamp = new Date().toISOString();
    for (const candidate of document.profiles) {
      if (candidate.status === "active") candidate.status = "verified";
    }
    profile.status = "active";
    profile.updatedAt = timestamp;
    document.activeProfileId = profile.id;
    document.mediaRoutingEnabled = false;
    return profile;
  }, actorUserId, onCommit);
}

export async function deleteStorageProfile(
  profileId: string,
  actorUserId?: string,
  onCommit?: StorageDocumentCommit<void>,
) {
  return mutateStorageDocument((document, transactionStore) => {
    if (document.activeProfileId === profileId) {
      throw new Error("Active storage profile cannot be deleted");
    }
    const next = document.profiles.filter(
      (candidate) => candidate.id !== profileId,
    );
    if (next.length === document.profiles.length) {
      throw new Error("Storage profile not found");
    }
    assertStorageProfileNotRetained(profileId, transactionStore);
    document.profiles = next;
  }, actorUserId, onCommit);
}

export async function encryptedStorageProfilePath() {
  return paths().profiles;
}
