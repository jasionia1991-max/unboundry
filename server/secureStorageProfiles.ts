import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { assertAccountMutationAllowed } from "./accountMutationFence.ts";
import { appDataDirectory, openAppDatabase } from "./database.ts";

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

let documentMutationTail: Promise<void> = Promise.resolve();

async function withDocumentMutationLock<T>(operation: () => Promise<T>) {
  const previous = documentMutationTail;
  let release!: () => void;
  documentMutationTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

function paths() {
  const directory = join(appDataDirectory(), "secrets");
  return {
    directory,
    key: join(directory, "config-master.key"),
    profiles: join(directory, "storage-profiles.enc.json"),
  };
}

async function encryptionKey() {
  const target = paths();
  await mkdir(target.directory, { mode: 0o700, recursive: true });
  try {
    const existing = await readFile(target.key);
    if (existing.length !== 32) throw new Error("Invalid secret-store key");
    return existing;
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
      const existing = await readFile(target.key);
      if (existing.length !== 32) throw new Error("Invalid secret-store key");
      return existing;
    }
    throw error;
  }
}

async function readDocument(): Promise<StorageProfileDocument> {
  const target = paths();
  let encrypted: EncryptedDocument;
  try {
    encrypted = JSON.parse(
      await readFile(target.profiles, "utf8"),
    ) as EncryptedDocument;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return { profiles: [], version: 1 };
    }
    throw error;
  }
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
    await encryptionKey(),
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

async function writeDocument(document: StorageProfileDocument) {
  const target = paths();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", await encryptionKey(), iv);
  cipher.setAAD(associatedData);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(document), "utf8"),
    cipher.final(),
  ]);
  const encrypted: EncryptedDocument = {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    version: 1,
  };
  const temporary = `${target.profiles}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(encrypted), {
    flag: "wx",
    mode: 0o600,
  });
  await rename(temporary, target.profiles);
  await chmod(target.profiles, 0o600);
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

function validEndpoint(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (url.pathname === "/" || url.pathname === "") &&
      /^[a-z0-9.-]+$/i.test(url.hostname)
    );
  } catch {
    return false;
  }
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
    !validEndpoint(endpoint) ||
    !/^oss-[a-z0-9-]{3,70}$/.test(region) ||
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

/**
 * 修复“activeProfileId 指向 verified 配置”的状态损坏：
 * 恢复为 active，并把被掩盖的云路由开关复位为关闭（本地优先）。
 */
export async function repairStorageProfileState() {
  return withDocumentMutationLock(async () => {
    const document = await readDocument();
    const profile = document.profiles.find(
      (candidate) => candidate.id === document.activeProfileId,
    );
    if (!profile || profile.status !== "verified") {
      return {
        changed: false,
        activeProfileId: document.activeProfileId ?? "",
        mediaRoutingEnabled: Boolean(document.mediaRoutingEnabled),
        profile: profile
          ? { id: profile.id, label: profile.label, status: profile.status }
          : undefined,
      };
    }
    profile.status = "active";
    profile.updatedAt = new Date().toISOString();
    if (document.mediaRoutingEnabled) {
      document.mediaRoutingEnabled = false;
    }
    await writeDocument(document);
    return {
      changed: true,
      activeProfileId: document.activeProfileId ?? "",
      mediaRoutingEnabled: Boolean(document.mediaRoutingEnabled),
      profile: { id: profile.id, label: profile.label, status: profile.status },
    };
  });
}

export async function storageMediaRoutingState() {
  const document = await readDocument();
  const profile = document.profiles.find(
    (candidate) =>
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
    if (!profile || profile.status !== "verified") {
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
