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
import { appDataDirectory } from "./database";

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

const associatedData = Buffer.from("tapnow:storage-profiles:v1", "utf8");

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

export async function setStorageMediaRouting(enabled: boolean) {
  const document = await readDocument();
  const profile = document.profiles.find(
    (candidate) =>
      candidate.id === document.activeProfileId &&
      candidate.status === "active",
  );
  if (enabled && !profile) {
    throw new Error("Select a verified storage profile first");
  }
  document.mediaRoutingEnabled = enabled;
  await writeDocument(document);
  return {
    enabled,
    profile,
  };
}

export async function saveStorageProfile(
  input: Record<string, unknown>,
  profileId?: string,
) {
  const document = await readDocument();
  const current = profileId
    ? document.profiles.find((profile) => profile.id === profileId)
    : undefined;
  if (profileId && !current) throw new Error("Storage profile not found");
  if (current?.status === "active") {
    throw new Error("Create and verify a replacement for the active profile");
  }
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
  await writeDocument(document);
  return profile;
}

export async function markStorageProfileVerified(profileId: string) {
  const document = await readDocument();
  const timestamp = new Date().toISOString();
  const profile = document.profiles.find(
    (candidate) => candidate.id === profileId,
  );
  if (!profile) throw new Error("Storage profile not found");
  profile.lastVerifiedAt = timestamp;
  profile.status = "verified";
  profile.updatedAt = timestamp;
  await writeDocument(document);
  return profile;
}

export async function activateStorageProfile(profileId: string) {
  const document = await readDocument();
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
  await writeDocument(document);
  return profile;
}

export async function deleteStorageProfile(profileId: string) {
  const document = await readDocument();
  if (document.activeProfileId === profileId) {
    throw new Error("Active storage profile cannot be deleted");
  }
  const next = document.profiles.filter(
    (candidate) => candidate.id !== profileId,
  );
  if (next.length === document.profiles.length) {
    throw new Error("Storage profile not found");
  }
  document.profiles = next;
  await writeDocument(document);
}

export async function encryptedStorageProfilePath() {
  return paths().profiles;
}
