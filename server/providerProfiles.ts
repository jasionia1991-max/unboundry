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
  stat,
  writeFile,
} from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { requestIdentity } from "./auth";
import { appDataDirectory, openAppDatabase } from "./database";
import { generationProviderAttemptCounts } from "./generationTaskStore";
import { providerCatalogCapabilities } from "./providerCatalogCapabilities";

export type ProviderDriver =
  | "mureka"
  | "openai-compatible"
  | "openrouter"
  | "volcengine-ark";

export type ArkControlPlaneCredentials = {
  accessKeyId: string;
  projectName: string;
  region: "cn-beijing";
  revision: string;
  secretAccessKey: string;
  updatedAt: string;
};

export type ProviderProfile = {
  apiKey: string;
  arkControlPlane?: ArkControlPlaneCredentials;
  baseUrl: string;
  configurationVersion?: number;
  createdAt: string;
  driver: ProviderDriver;
  id: string;
  label: string;
  updatedAt: string;
};

export type ProviderVerification = {
  latencyMs: number;
  message: string;
  modelCount: number;
  status: "verified";
};

export type ProviderKeyStatus =
  | "unchecked"
  | "valid"
  | "invalid"
  | "unknown";

export type ProviderCatalogKeyStatus =
  | "unchecked"
  | "valid"
  | "invalid"
  | "permission"
  | "unknown";

type ProviderProfileDocument = {
  profiles: ProviderProfile[];
  version: 1;
};

type EncryptedDocument = {
  ciphertext: string;
  iv: string;
  tag: string;
  version: 1;
};

const associatedData = Buffer.from("tapnow:provider-profiles:v1", "utf8");
const documentLockAcquireTimeoutMs = 5_000;
const drivers: readonly ProviderDriver[] = [
  "mureka",
  "openrouter",
  "volcengine-ark",
  "openai-compatible",
];
let database: DatabaseSync | undefined;
let databaseDirectory = "";
let documentMutation: Promise<void> = Promise.resolve();
let afterDocumentWriteForTests: (() => Promise<void>) | undefined;

function db() {
  const directory = appDataDirectory();
  if (database && databaseDirectory === directory) return database;
  database?.close();
  database = openAppDatabase();
  databaseDirectory = directory;
  return database;
}

function paths() {
  const directory = join(appDataDirectory(), "secrets");
  return {
    directory,
    key: join(directory, "config-master.key"),
    profiles: join(directory, "provider-profiles.enc.json"),
    writeLock: join(directory, "provider-profile-write-lock.sqlite"),
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

async function readDocument(): Promise<ProviderProfileDocument> {
  let encrypted: EncryptedDocument;
  try {
    encrypted = JSON.parse(
      await readFile(paths().profiles, "utf8"),
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
    throw new Error("Invalid encrypted Provider configuration");
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
  ) as ProviderProfileDocument;
  if (document.version !== 1 || !Array.isArray(document.profiles)) {
    throw new Error("Invalid Provider configuration");
  }
  return document;
}

async function writeDocument(document: ProviderProfileDocument) {
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

async function acquireDocumentLock() {
  const target = paths();
  await mkdir(target.directory, { mode: 0o700, recursive: true });
  const lockDatabase = new DatabaseSync(target.writeLock, {
    timeout: documentLockAcquireTimeoutMs,
  });
  await chmod(target.writeLock, 0o600);
  const lockFile = await stat(target.writeLock);
  if (!lockFile.isFile()) {
    lockDatabase.close();
    throw new Error("Provider configuration lock is invalid");
  }
  try {
    lockDatabase.exec(`PRAGMA busy_timeout = ${documentLockAcquireTimeoutMs}`);
    lockDatabase.exec(`
      CREATE TABLE IF NOT EXISTS provider_profile_write_lock (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        marker INTEGER NOT NULL
      );
      INSERT OR IGNORE INTO provider_profile_write_lock (id, marker)
      VALUES (1, 0);
    `);
    lockDatabase.exec("BEGIN IMMEDIATE");
    lockDatabase.exec(`
      UPDATE provider_profile_write_lock
      SET marker = marker + 1
      WHERE id = 1;
    `);
    if (!lockDatabase.isTransaction) {
      throw new Error("Provider configuration lock was not acquired");
    }
  } catch {
    lockDatabase.close();
    throw new Error("Provider configuration is busy");
  }
  let released = false;
  return {
    finish(commit: boolean) {
      if (released) return;
      try {
        lockDatabase.exec(commit ? "COMMIT" : "ROLLBACK");
      } finally {
        released = true;
        lockDatabase.close();
      }
    },
  };
}

function updateMetadataAtomically<T>(
  updateMetadata: (store: DatabaseSync, result: T) => void,
  result: T,
) {
  const store = openAppDatabase(appDataDirectory());
  let commit = false;
  try {
    store.exec("BEGIN IMMEDIATE");
    updateMetadata(store, result);
    store.exec("COMMIT");
    commit = true;
  } finally {
    if (!commit) {
      try {
        store.exec("ROLLBACK");
      } catch {
        // Closing the dedicated connection still releases the database lock.
      }
    }
    store.close();
  }
}

async function mutateDocument<T>(
  mutate: (document: ProviderProfileDocument) => Promise<T> | T,
  updateMetadata?: (store: DatabaseSync, result: T) => void,
) {
  let result!: T;
  const operation = documentMutation.then(async () => {
    const lock = await acquireDocumentLock();
    let commit = false;
    try {
      const document = await readDocument();
      result = await mutate(document);
      await writeDocument(document);
      await afterDocumentWriteForTests?.();
      if (updateMetadata) updateMetadataAtomically(updateMetadata, result);
      commit = true;
    } finally {
      await lock.finish(commit);
    }
  });
  documentMutation = operation.then(
    () => undefined,
    () => undefined,
  );
  await operation;
  return result;
}

/** Test-only barrier for exercising the rename-to-metadata crash window. */
export function setProviderProfileAfterDocumentWriteHookForTests(
  hook: (() => Promise<void>) | undefined,
) {
  if (process.env.TAPNOW_TEST_PROVIDER_PROFILE_BARRIER !== "1") {
    throw new Error("Provider profile test barrier is disabled");
  }
  afterDocumentWriteForTests = hook;
}

function text(value: unknown, maximum: number) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function profileConfigurationVersion(profile: ProviderProfile) {
  const value = (profile as ProviderProfile & {
    configurationVersion?: unknown;
  }).configurationVersion;
  return Number.isSafeInteger(value) && Number(value) >= 1
    ? Number(value)
    : 1;
}

export function providerConfigurationVersion(profile: ProviderProfile) {
  return profileConfigurationVersion(profile);
}

export class ProviderGenerationConfigurationError extends Error {
  constructor(
    readonly code:
      | "PROVIDER_CONFIGURATION_MISMATCH"
      | "PROVIDER_PROFILE_MISSING"
      | "PROVIDER_REVERIFY_REQUIRED",
    message: string,
  ) {
    super(message);
  }
}

export type ProviderGenerationProfileState = {
  configurationAligned: boolean;
  documentConfigurationVersion?: number;
  metadataConfigurationVersion?: number;
  profile?: ProviderProfile;
  reason:
    | "configuration-mismatch"
    | "missing"
    | "ready"
    | "reverify-required";
};

export type ProviderGenerationRequestLease = {
  profile: ProviderProfile;
  release: () => void;
};

function defaultBaseUrl(driver: ProviderDriver) {
  if (driver === "mureka") return "https://api.mureka.ai";
  if (driver === "openrouter") return "https://openrouter.ai/api/v1";
  if (driver === "volcengine-ark") {
    return "https://ark.cn-beijing.volces.com/api/v3";
  }
  return "";
}

function validBaseUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      /^[a-z0-9.-]+$/i.test(url.hostname)
    );
  } catch {
    return false;
  }
}

function cleanProfileInput(
  input: Record<string, unknown>,
  current?: ProviderProfile,
) {
  const driver = input.driver as ProviderDriver;
  const label = text(input.label, 40);
  const baseUrl =
    text(input.baseUrl, 300) ||
    current?.baseUrl ||
    (drivers.includes(driver) ? defaultBaseUrl(driver) : "");
  const apiKey = text(input.apiKey, 500) || current?.apiKey || "";
  if (
    !drivers.includes(driver) ||
    !label ||
    !validBaseUrl(baseUrl) ||
    apiKey.length < 8 ||
    /\s/.test(apiKey)
  ) {
    throw new Error("Provider configuration is invalid");
  }
  if (
    (driver === "mureka" &&
      baseUrl !== "https://api.mureka.ai") ||
    (driver === "openrouter" &&
      baseUrl !== "https://openrouter.ai/api/v1") ||
    (driver === "volcengine-ark" &&
      baseUrl !== "https://ark.cn-beijing.volces.com/api/v3")
  ) {
    throw new Error("Built-in Provider endpoint cannot be changed");
  }
  return { apiKey, baseUrl: baseUrl.replace(/\/+$/, ""), driver, label };
}

function metadataStatus(store: DatabaseSync, profile: ProviderProfile) {
  const row = store
    .prepare(`
      SELECT
        status,
        key_status,
        key_checked_at,
        catalog_key_status,
        catalog_checked_at,
        catalog_synced_at,
        catalog_last_error_code,
        catalog_model_count,
        catalog_endpoint_count,
        catalog_control_request_count,
        (
          SELECT COUNT(*)
          FROM model_profiles
          WHERE provider_profile_id = provider_profiles.id
        ) AS configured_model_count
      FROM provider_profiles
      WHERE id = ?
    `)
    .get(profile.id) as
    | {
        key_checked_at: string | null;
        key_status: ProviderKeyStatus;
        catalog_checked_at: string | null;
        catalog_control_request_count: number;
        catalog_endpoint_count: number;
        catalog_key_status: ProviderCatalogKeyStatus;
        catalog_last_error_code: string | null;
        catalog_model_count: number;
        catalog_synced_at: string | null;
        configured_model_count: number;
        status: "disabled" | "enabled";
      }
    | undefined;
  return {
    keyStatus: (row?.key_status ?? "unchecked") as ProviderKeyStatus,
    lastCheckedAt: row?.key_checked_at ?? undefined,
    lastVerifiedAt:
      row?.key_status === "valid"
        ? row.key_checked_at ?? undefined
        : undefined,
    modelCatalog: {
      ...providerCatalogCapabilities(profile.driver),
      accessKeyIdMask: profile.arkControlPlane
        ? `••••${profile.arkControlPlane.accessKeyId.slice(-4)}`
        : undefined,
      checkedAt: row?.catalog_checked_at ?? undefined,
      configuredModelCount: Number(row?.configured_model_count ?? 0),
      controlRequestCount: Number(row?.catalog_control_request_count ?? 0),
      endpointCount: Number(row?.catalog_endpoint_count ?? 0),
      errorCode: row?.catalog_last_error_code ?? undefined,
      hasCredentials:
        profile.driver === "volcengine-ark"
          ? Boolean(profile.arkControlPlane)
          : profile.driver === "openrouter" ||
              profile.driver === "openai-compatible"
            ? Boolean(profile.apiKey)
            : false,
      keyStatus: (row?.catalog_key_status ?? "unchecked") as ProviderCatalogKeyStatus,
      modelCount: Number(row?.catalog_model_count ?? 0),
      projectName: profile.arkControlPlane?.projectName ?? "default",
      snapshotStale: Boolean(
        row?.catalog_synced_at && row.catalog_key_status !== "valid",
      ),
      syncedAt: row?.catalog_synced_at ?? undefined,
    },
    status: row?.status === "enabled" ? "verified" as const : "saved" as const,
  };
}

function publicProfile(profile: ProviderProfile, store = db()) {
  const metadata = metadataStatus(store, profile);
  return {
    apiKeyMask: `••••${profile.apiKey.slice(-4)}`,
    baseUrl: profile.baseUrl,
    driver: profile.driver,
    hasApiKey: Boolean(profile.apiKey),
    id: profile.id,
    label: profile.label,
    ...metadata,
    updatedAt: profile.updatedAt,
  };
}

function ensureMetadata(store: DatabaseSync, profile: ProviderProfile) {
  const configurationVersion = profileConfigurationVersion(profile);
  const catalogCredentialRevision =
    profile.driver === "volcengine-ark"
      ? profile.arkControlPlane?.revision ?? null
      : null;
  store
    .prepare(`
      INSERT INTO provider_profiles (
        id, display_name, driver, status,
        provider_configuration_version,
        catalog_credential_revision,
        created_at, updated_at
      )
      VALUES (?, ?, ?, 'disabled', ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `)
    .run(
      profile.id,
      profile.label,
      profile.driver,
      configurationVersion,
      catalogCredentialRevision,
      profile.createdAt,
      profile.updatedAt,
    );

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = store.prepare(`
      SELECT
        driver,
        catalog_credential_revision,
        provider_configuration_version
      FROM provider_profiles
      WHERE id = ?
    `).get(profile.id) as {
      catalog_credential_revision: string | null;
      driver: string;
      provider_configuration_version: number;
    };
    const currentVersion = Number(current.provider_configuration_version);
    const driverChanged = current.driver !== profile.driver;
    const catalogCredentialChanged =
      driverChanged ||
      current.catalog_credential_revision !== catalogCredentialRevision;

    if (currentVersion > configurationVersion) {
      const failedClosed = store.prepare(`
        UPDATE provider_profiles
        SET
          status = 'disabled',
          key_status = 'unchecked',
          key_checked_at = NULL,
          catalog_key_status = 'unchecked',
          catalog_checked_at = NULL,
          catalog_last_error_code = 'CONFIGURATION_MISMATCH',
          catalog_synced_at = CASE WHEN ? THEN NULL ELSE catalog_synced_at END,
          catalog_models = CASE WHEN ? THEN '[]' ELSE catalog_models END,
          catalog_endpoints = CASE WHEN ? THEN '[]' ELSE catalog_endpoints END,
          catalog_model_count = CASE WHEN ? THEN 0 ELSE catalog_model_count END,
          catalog_endpoint_count = CASE WHEN ? THEN 0 ELSE catalog_endpoint_count END
        WHERE id = ? AND provider_configuration_version = ?
      `).run(
        catalogCredentialChanged ? 1 : 0,
        catalogCredentialChanged ? 1 : 0,
        catalogCredentialChanged ? 1 : 0,
        catalogCredentialChanged ? 1 : 0,
        catalogCredentialChanged ? 1 : 0,
        profile.id,
        currentVersion,
      );
      if (failedClosed.changes === 1) return false;
      continue;
    }

    const firstAlignment = currentVersion === 0;
    const versionBehind = currentVersion < configurationVersion;
    const metadataMismatch = driverChanged || catalogCredentialChanged;
    if (!firstAlignment && !versionBehind && !metadataMismatch) return true;

    // Version 0 came from the pre-versioned schema and cannot prove that the
    // encrypted document and its old green status committed together. Keep a
    // same-driver catalog snapshot only as stale until a new read-only sync.
    const markCatalogStale = firstAlignment || catalogCredentialChanged;
    const clearCatalog = driverChanged;
    const targetVersion = firstAlignment || versionBehind
      ? configurationVersion
      : currentVersion;
    const aligned = store.prepare(`
      UPDATE provider_profiles
      SET
        display_name = ?,
        driver = ?,
        status = 'disabled',
        key_status = 'unchecked',
        key_checked_at = NULL,
        provider_configuration_version = ?,
        catalog_credential_revision = ?,
        catalog_key_status = CASE WHEN ? THEN 'unchecked' ELSE catalog_key_status END,
        catalog_checked_at = CASE WHEN ? THEN NULL ELSE catalog_checked_at END,
        catalog_synced_at = CASE WHEN ? THEN NULL ELSE catalog_synced_at END,
        catalog_last_error_code = CASE WHEN ? THEN NULL ELSE catalog_last_error_code END,
        catalog_models = CASE WHEN ? THEN '[]' ELSE catalog_models END,
        catalog_endpoints = CASE WHEN ? THEN '[]' ELSE catalog_endpoints END,
        catalog_model_count = CASE WHEN ? THEN 0 ELSE catalog_model_count END,
        catalog_endpoint_count = CASE WHEN ? THEN 0 ELSE catalog_endpoint_count END,
        updated_at = ?
      WHERE id = ? AND provider_configuration_version = ?
    `).run(
      profile.label,
      profile.driver,
      targetVersion,
      catalogCredentialRevision,
      markCatalogStale ? 1 : 0,
      markCatalogStale ? 1 : 0,
      clearCatalog ? 1 : 0,
      markCatalogStale ? 1 : 0,
      clearCatalog ? 1 : 0,
      clearCatalog ? 1 : 0,
      clearCatalog ? 1 : 0,
      clearCatalog ? 1 : 0,
      profile.updatedAt,
      profile.id,
      currentVersion,
    );
    if (aligned.changes === 1) return targetVersion === configurationVersion;
  }
  return false;
}

function resetMetadata(
  store: DatabaseSync,
  profile: ProviderProfile,
  resetCatalog = false,
  invalidateProfileKeyCatalog = false,
) {
  if (!ensureMetadata(store, profile)) {
    throw new Error("Provider configuration metadata is inconsistent");
  }
  const updated = store
    .prepare(`
      UPDATE provider_profiles
      SET
        display_name = ?,
        driver = ?,
        status = 'disabled',
        key_status = 'unchecked',
        key_checked_at = NULL,
        catalog_key_status = CASE
          WHEN ? OR ? THEN 'unchecked'
          ELSE catalog_key_status
        END,
        catalog_checked_at = CASE
          WHEN ? OR ? THEN NULL
          ELSE catalog_checked_at
        END,
        catalog_synced_at = CASE WHEN ? THEN NULL ELSE catalog_synced_at END,
        catalog_last_error_code = CASE
          WHEN ? OR ? THEN NULL
          ELSE catalog_last_error_code
        END,
        catalog_models = CASE WHEN ? THEN '[]' ELSE catalog_models END,
        catalog_endpoints = CASE WHEN ? THEN '[]' ELSE catalog_endpoints END,
        catalog_model_count = CASE WHEN ? THEN 0 ELSE catalog_model_count END,
        catalog_endpoint_count = CASE
          WHEN ? THEN 0
          ELSE catalog_endpoint_count
        END,
        updated_at = ?
      WHERE id = ? AND provider_configuration_version = ?
    `)
    .run(
      profile.label,
      profile.driver,
      resetCatalog ? 1 : 0,
      invalidateProfileKeyCatalog ? 1 : 0,
      resetCatalog ? 1 : 0,
      invalidateProfileKeyCatalog ? 1 : 0,
      resetCatalog ? 1 : 0,
      resetCatalog ? 1 : 0,
      invalidateProfileKeyCatalog ? 1 : 0,
      resetCatalog ? 1 : 0,
      resetCatalog ? 1 : 0,
      resetCatalog ? 1 : 0,
      resetCatalog ? 1 : 0,
      profile.updatedAt,
      profile.id,
      profileConfigurationVersion(profile),
    );
  if (updated.changes !== 1) {
    throw new Error("Provider configuration changed while metadata was reset");
  }
}

function recordKeyCheck(
  store: DatabaseSync,
  profile: ProviderProfile,
  keyStatus: Exclude<ProviderKeyStatus, "unchecked">,
  checkedAt = new Date().toISOString(),
) {
  const updated = store.prepare(`
    UPDATE provider_profiles
    SET
      status = CASE
        WHEN ? = 'valid' THEN 'enabled'
        WHEN ? = 'invalid' THEN 'disabled'
        ELSE status
      END,
      key_status = ?,
      key_checked_at = ?
    WHERE
      id = ?
      AND provider_configuration_version = ?
      AND driver = ?
  `).run(
    keyStatus,
    keyStatus,
    keyStatus,
    checkedAt,
    profile.id,
    profileConfigurationVersion(profile),
    profile.driver,
  );
  return updated.changes === 1 ? checkedAt : undefined;
}

function audit(
  store: DatabaseSync,
  actorUserId: string,
  action: string,
  profile: ProviderProfile,
) {
  store
    .prepare(`
      INSERT INTO admin_audit_events (
        actor_user_id, action, target_user_id, details, created_at
      )
      VALUES (?, ?, NULL, ?, ?)
    `)
    .run(
      actorUserId,
      action,
      JSON.stringify({
        driver: profile.driver,
        profileId: profile.id,
      }),
      new Date().toISOString(),
    );
}

async function readBody<T>(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > 64 * 1_024) throw new Error("Payload too large");
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

function json(response: ServerResponse, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

export async function listProviderProfiles() {
  return readDocument();
}

/** Server-only lookup. Never return this object from an HTTP handler. */
export async function getProviderProfile(profileId: string) {
  const document = await readDocument();
  return document.profiles.find((profile) => profile.id === profileId);
}

function generationProfileState(
  profileId: string,
  profile: ProviderProfile | undefined,
  store: DatabaseSync,
): ProviderGenerationProfileState {
  if (!profile) {
    return { configurationAligned: false, reason: "missing" };
  }
  const documentConfigurationVersion = profileConfigurationVersion(profile);
  const metadata = store.prepare(`
    SELECT driver, provider_configuration_version, status
    FROM provider_profiles
    WHERE id = ?
  `).get(profile.id) as
    | {
        driver: string;
        provider_configuration_version: number;
        status: "disabled" | "enabled";
      }
    | undefined;
  const metadataConfigurationVersion = metadata
    ? Number(metadata.provider_configuration_version)
    : undefined;
  const configurationAligned = Boolean(
    metadata &&
    metadataConfigurationVersion !== 0 &&
    metadataConfigurationVersion === documentConfigurationVersion &&
    metadata.driver === profile.driver,
  );
  if (!configurationAligned) {
    return {
      configurationAligned: false,
      documentConfigurationVersion,
      metadataConfigurationVersion,
      profile,
      reason: "configuration-mismatch",
    };
  }
  if (metadata?.status !== "enabled") {
    return {
      configurationAligned: true,
      documentConfigurationVersion,
      metadataConfigurationVersion,
      profile,
      reason: "reverify-required",
    };
  }
  return {
    configurationAligned: true,
    documentConfigurationVersion,
    metadataConfigurationVersion,
    profile,
    reason: "ready",
  };
}

function profileForGenerationState(state: ProviderGenerationProfileState) {
  if (state.reason === "ready" && state.profile) return state.profile;
  if (state.reason === "missing") {
    throw new ProviderGenerationConfigurationError(
      "PROVIDER_PROFILE_MISSING",
      "平台安全配置缺失，请联系管理员",
    );
  }
  if (state.reason === "reverify-required") {
    throw new ProviderGenerationConfigurationError(
      "PROVIDER_REVERIFY_REQUIRED",
      "平台连接资料已更新，请管理员完成只读连接检查",
    );
  }
  throw new ProviderGenerationConfigurationError(
    "PROVIDER_CONFIGURATION_MISMATCH",
    "平台连接配置与安全状态不一致，已阻止本次生成",
  );
}

export async function getProviderGenerationProfileState(
  profileId: string,
): Promise<ProviderGenerationProfileState> {
  const profile = await getProviderProfile(profileId);
  return generationProfileState(profileId, profile, db());
}

/**
 * The only profile lookup allowed immediately before a real Provider request.
 * It never repairs metadata on the paid path: split-brain and unverified
 * configurations fail closed.
 */
export async function getProviderProfileForGeneration(
  profileId: string,
): Promise<ProviderProfile> {
  return profileForGenerationState(
    await getProviderGenerationProfileState(profileId),
  );
}

/**
 * Holds the same cross-process lock used by profile writers while the caller
 * reads both stores and starts one real Provider request. The caller must
 * release immediately after its fetch function has been invoked.
 */
export async function acquireProviderGenerationRequestLease(
  profileId: string,
): Promise<ProviderGenerationRequestLease> {
  let lock: Awaited<ReturnType<typeof acquireDocumentLock>>;
  try {
    lock = await acquireDocumentLock();
  } catch {
    throw new ProviderGenerationConfigurationError(
      "PROVIDER_CONFIGURATION_MISMATCH",
      "平台连接正在更新，已阻止本次生成",
    );
  }
  try {
    const document = await readDocument();
    const profile = document.profiles.find(
      (candidate) => candidate.id === profileId,
    );
    const ready = profileForGenerationState(
      generationProfileState(profileId, profile, db()),
    );
    let released = false;
    return {
      profile: ready,
      release() {
        if (released) return;
        released = true;
        lock.finish(false);
      },
    };
  } catch (error) {
    lock.finish(false);
    throw error;
  }
}

export async function saveProviderProfile(
  input: Record<string, unknown>,
  profileId?: string,
) {
  let previousDriver: ProviderDriver | undefined;
  let profileKeyCatalogChanged = false;
  const profile = await mutateDocument((document) => {
    const current = profileId
      ? document.profiles.find((candidate) => candidate.id === profileId)
      : undefined;
    if (profileId && !current) throw new Error("Provider profile not found");
    previousDriver = current?.driver;
    const cleaned = cleanProfileInput(input, current);
    profileKeyCatalogChanged = Boolean(
      current &&
        (cleaned.driver === "openrouter" ||
          cleaned.driver === "openai-compatible") &&
        (current.driver !== cleaned.driver ||
          current.apiKey !== cleaned.apiKey ||
          current.baseUrl !== cleaned.baseUrl),
    );
    const timestamp = new Date().toISOString();
    const next: ProviderProfile = {
      ...cleaned,
      ...(cleaned.driver === "volcengine-ark" && current?.arkControlPlane
        ? { arkControlPlane: current.arkControlPlane }
        : {}),
      configurationVersion: current
        ? profileConfigurationVersion(current) + 1
        : 1,
      createdAt: current?.createdAt ?? timestamp,
      id: current?.id ?? randomUUID(),
      updatedAt: timestamp,
    };
    document.profiles = current
      ? document.profiles.map((candidate) =>
          candidate.id === next.id ? next : candidate,
        )
      : [...document.profiles, next];
    return next;
  }, (store, next) => {
    resetMetadata(
      store,
      next,
      Boolean(previousDriver && previousDriver !== next.driver),
      profileKeyCatalogChanged,
    );
  });
  return profile;
}

function cleanArkControlCredentials(
  input: Record<string, unknown>,
  current?: ArkControlPlaneCredentials,
) {
  const suppliedAccessKeyId = text(input.accessKeyId, 256);
  const suppliedSecretAccessKey = text(input.secretAccessKey, 256);
  if (Boolean(suppliedAccessKeyId) !== Boolean(suppliedSecretAccessKey)) {
    throw new Error("Ark control-plane credentials are incomplete");
  }
  const accessKeyId = suppliedAccessKeyId || current?.accessKeyId || "";
  const secretAccessKey = suppliedSecretAccessKey || current?.secretAccessKey || "";
  const projectName = text(input.projectName, 128) || current?.projectName || "default";
  if (
    accessKeyId.length < 8 ||
    secretAccessKey.length < 8 ||
    /\s/.test(accessKeyId) ||
    /\s/.test(secretAccessKey) ||
    !/^[a-zA-Z0-9._-]{1,128}$/.test(projectName)
  ) {
    throw new Error("Ark control-plane credentials are invalid");
  }
  const changed =
    !current ||
    Boolean(suppliedAccessKeyId) ||
    projectName !== current.projectName;
  if (!changed) return current;
  const timestamp = new Date().toISOString();
  return {
    accessKeyId,
    projectName,
    region: "cn-beijing" as const,
    revision: randomUUID(),
    secretAccessKey,
    updatedAt: timestamp,
  };
}

/** Server-only lookup. Never return the credentials object from an HTTP handler. */
export async function getArkControlPlaneCredentials(profileId: string) {
  const profile = await getProviderProfile(profileId);
  if (profile?.driver !== "volcengine-ark" || !profile.arkControlPlane) {
    return undefined;
  }
  return { ...profile.arkControlPlane };
}

/** Aligns the non-secret database revision once, before a catalog sync starts. */
export async function prepareArkControlPlaneCredentials(profileId: string) {
  const profile = await getProviderProfile(profileId);
  if (profile?.driver !== "volcengine-ark" || !profile.arkControlPlane) {
    return undefined;
  }
  if (!ensureMetadata(db(), profile)) {
    throw new ProviderGenerationConfigurationError(
      "PROVIDER_CONFIGURATION_MISMATCH",
      "平台连接配置与安全状态不一致",
    );
  }
  return { ...profile.arkControlPlane };
}

export async function saveArkControlPlaneCredentials(
  profileId: string,
  input: Record<string, unknown>,
) {
  let changed = false;
  const profile = await mutateDocument((document) => {
    const index = document.profiles.findIndex(
      (candidate) => candidate.id === profileId,
    );
    const current = document.profiles[index];
    if (!current || current.driver !== "volcengine-ark") {
      throw new Error("Ark Provider profile not found");
    }
    const control = cleanArkControlCredentials(input, current.arkControlPlane);
    changed = control.revision !== current.arkControlPlane?.revision;
    const next: ProviderProfile = {
      ...current,
      arkControlPlane: control,
      configurationVersion: changed
        ? profileConfigurationVersion(current) + 1
        : profileConfigurationVersion(current),
      updatedAt: changed ? control.updatedAt : current.updatedAt,
    };
    document.profiles[index] = next;
    return next;
  }, (store, next) => {
    if (!ensureMetadata(store, next)) {
      throw new Error("Provider configuration metadata is inconsistent");
    }
    if (changed) {
      const updated = store.prepare(`
        UPDATE provider_profiles
        SET
          catalog_key_status = 'unchecked',
          catalog_checked_at = NULL,
          catalog_last_error_code = NULL,
          updated_at = ?
        WHERE id = ? AND provider_configuration_version = ?
      `).run(
        next.updatedAt,
        next.id,
        profileConfigurationVersion(next),
      );
      if (updated.changes !== 1) {
        throw new Error("Provider configuration changed while credentials were saved");
      }
    }
  });
  return {
    accessKeyIdMask: `••••${profile.arkControlPlane!.accessKeyId.slice(-4)}`,
    hasCredentials: true as const,
    projectName: profile.arkControlPlane!.projectName,
    updatedAt: profile.arkControlPlane!.updatedAt,
  };
}

class ProviderVerificationError extends Error {
  constructor(
    readonly code:
      | "AUTH"
      | "CONFIG_CHANGED"
      | "FORMAT"
      | "NETWORK"
      | "NOT_SUPPORTED"
      | "PERMISSION"
      | "RATE_LIMIT"
      | "REMOTE",
  ) {
    super(code);
  }
}

function sameProviderRevision(
  current: ProviderProfile | undefined,
  checked: ProviderProfile,
) {
  return Boolean(
    current &&
    current.id === checked.id &&
    current.updatedAt === checked.updatedAt &&
    current.apiKey === checked.apiKey &&
    current.baseUrl === checked.baseUrl &&
    current.driver === checked.driver &&
    profileConfigurationVersion(current) === profileConfigurationVersion(checked),
  );
}

async function recordCurrentKeyCheck(
  profile: ProviderProfile,
  keyStatus: Exclude<ProviderKeyStatus, "unchecked">,
) {
  const latest = await readDocument();
  const current = latest.profiles.find(
    (candidate) => candidate.id === profile.id,
  );
  if (!sameProviderRevision(current, profile)) {
    throw new ProviderVerificationError("CONFIG_CHANGED");
  }
  if (!recordKeyCheck(db(), profile, keyStatus)) {
    throw new ProviderVerificationError("CONFIG_CHANGED");
  }
}

function modelListUrl(profile: ProviderProfile) {
  if (profile.driver === "mureka") {
    return `${profile.baseUrl}/v1/account/billing`;
  }
  if (profile.driver === "volcengine-ark") {
    return `${profile.baseUrl}/contents/generations/tasks?page_num=1&page_size=1`;
  }
  const suffix =
    profile.driver === "openrouter" ? "/models/user" : "/models";
  return `${profile.baseUrl}${suffix}`;
}

async function readLimitedJson(response: Response) {
  if (!response.body) throw new ProviderVerificationError("FORMAT");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 5 * 1_024 * 1_024) {
      await reader.cancel();
      throw new ProviderVerificationError("FORMAT");
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(
      Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8"),
    ) as Record<string, unknown>;
  } catch {
    throw new ProviderVerificationError("FORMAT");
  }
}

function verificationSuccessMessage(
  profile: ProviderProfile,
  modelCount: number,
) {
  if (
    profile.driver === "openrouter" ||
    profile.driver === "openai-compatible"
  ) {
    return `API Key有效。可读取模型：${modelCount} 个。`;
  }
  if (profile.driver === "volcengine-ark") {
    return "API Key有效。视频任务接口可读。";
  }
  return "API Key有效。账户接口可读。";
}

export async function verifyProviderProfile(
  profileId: string,
  fetcher: typeof fetch = fetch,
): Promise<ProviderVerification> {
  const document = await readDocument();
  const profile = document.profiles.find(
    (candidate) => candidate.id === profileId,
  );
  if (!profile) throw new ProviderVerificationError("FORMAT");
  if (!ensureMetadata(db(), profile)) {
    throw new ProviderVerificationError("CONFIG_CHANGED");
  }
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetcher(modelListUrl(profile), {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${profile.apiKey}`,
      },
      method: "GET",
      redirect: "error",
      signal: controller.signal,
    });
    if (response.status === 401) {
      throw new ProviderVerificationError("AUTH");
    }
    if (response.status === 403) {
      throw new ProviderVerificationError("PERMISSION");
    }
    if (response.status === 429) {
      throw new ProviderVerificationError("RATE_LIMIT");
    }
    if (!response.ok) throw new ProviderVerificationError("REMOTE");
    const body = await readLimitedJson(response);
    const models = profile.driver === "volcengine-ark" ? body.items : body.data;
    if (profile.driver === "mureka") {
      if (
        typeof body.account_id !== "number" ||
        typeof body.concurrent_request_limit !== "number" ||
        (body.balance !== undefined && typeof body.balance !== "number")
      ) {
        throw new ProviderVerificationError("FORMAT");
      }
    } else if (!Array.isArray(models)) {
      throw new ProviderVerificationError("FORMAT");
    }
    const modelCount = profile.driver === "mureka"
      ? 0
      : (models as unknown[]).length;
    await recordCurrentKeyCheck(profile, "valid");
    return {
      latencyMs: Math.max(0, Date.now() - startedAt),
      message: verificationSuccessMessage(profile, modelCount),
      modelCount,
      status: "verified",
    };
  } catch (error) {
    if (error instanceof ProviderVerificationError) {
      if (error.code === "CONFIG_CHANGED") throw error;
      await recordCurrentKeyCheck(
        profile,
        error.code === "AUTH" ? "invalid" : "unknown",
      );
      throw error;
    }
    await recordCurrentKeyCheck(profile, "unknown");
    throw new ProviderVerificationError("NETWORK");
  } finally {
    clearTimeout(timer);
  }
}

function verificationMessage(error: unknown) {
  if (!(error instanceof ProviderVerificationError)) return "暂时无法确认API Key是否有效";
  if (error.code === "AUTH") return "API Key已失效";
  if (error.code === "CONFIG_CHANGED") return "连接资料已修改，请重新检查Key";
  if (error.code === "PERMISSION") return "暂时无法确认API Key是否有效";
  if (error.code === "RATE_LIMIT") return "平台限流，暂时无法确认API Key是否有效";
  if (error.code === "FORMAT") return "平台返回异常，暂时无法确认API Key是否有效";
  if (error.code === "NOT_SUPPORTED") {
    return "当前平台暂不支持安全的Key检查";
  }
  if (error.code === "REMOTE") return "平台暂时不可用，无法确认API Key是否有效";
  return "网络异常，暂时无法确认API Key是否有效";
}

export async function encryptedProviderProfilePath() {
  return paths().profiles;
}

/** Server-only diagnostic path. Contains no credential material. */
export function providerProfileWriteLockPath() {
  return paths().writeLock;
}

export async function adminProviderProfilesApi(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const identity = requestIdentity(request);
  if (!identity || identity.role !== "admin") {
    json(response, 403, {
      error: "Only administrators can manage Provider connections",
    });
    return;
  }
  const path = decodeURIComponent((request.url ?? "").split("?")[0]).replace(
    /^\/+/,
    "",
  );
  if (request.method === "GET" && !path) {
    try {
      const document = await readDocument();
      for (const profile of document.profiles) {
        ensureMetadata(db(), profile);
      }
      json(response, 200, {
        ...generationProviderAttemptCounts(db()),
        profiles: document.profiles.map((profile) => publicProfile(profile)),
        providerSecretsStoredInBrowser: false,
        realGenerationEnabled: false,
        supportedDrivers: drivers,
      });
    } catch {
      json(response, 500, { error: "平台连接配置无法安全读取" });
    }
    return;
  }
  if (
    (request.method === "POST" && !path) ||
    (request.method === "PATCH" && /^[a-f0-9-]{36}$/i.test(path))
  ) {
    try {
      const profile = await saveProviderProfile(
        await readBody<Record<string, unknown>>(request),
        path || undefined,
      );
      audit(
        db(),
        identity.userId,
        path ? "provider_profile.update" : "provider_profile.create",
        profile,
      );
      json(response, path ? 200 : 201, { profile: publicProfile(profile) });
    } catch {
      json(response, 400, { error: "平台连接配置无效" });
    }
    return;
  }
  if (
    request.method === "POST" &&
    /^([a-f0-9-]{36})\/test$/i.test(path)
  ) {
    const profileId = path.split("/")[0];
    try {
      const result = await verifyProviderProfile(profileId);
      const document = await readDocument();
      const profile = document.profiles.find(
        (candidate) => candidate.id === profileId,
      );
      if (profile) {
        audit(db(), identity.userId, "provider_profile.verify", profile);
      }
      json(response, 200, {
        paidGenerationRequests: 0,
        verification: result,
      });
    } catch (error) {
      json(response, 400, {
        error: verificationMessage(error),
        paidGenerationRequests: 0,
      });
    }
    return;
  }
  response.setHeader("Allow", "GET, POST, PATCH");
  json(response, 404, { error: "Provider endpoint not found" });
}
