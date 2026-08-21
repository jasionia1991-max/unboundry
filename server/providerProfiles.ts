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
import {
  AccountMutationBlockedError,
  assertAccountMutationAllowed,
} from "./accountMutationFence";
import { appDataDirectory, openAppDatabase } from "./database";
import {
  decodedRequestPath,
  HttpRequestError,
  readJsonBody,
} from "./httpRequest";
import { hasPermission } from "./permissions";
import { generationProviderAttemptCounts } from "./generationTaskStore";
import {
  RelayRemoteError,
  fetchRelayModelCatalog,
} from "./multiProtocolRelay";
import {
  OutboundDestinationError,
  OutboundProxyConfigurationError,
  fetchPublicHttps,
} from "./outboundNetwork";
import { providerCatalogCapabilities } from "./providerCatalogCapabilities";
import { parseProviderCatalogDiagnostics } from "./providerCatalogDiagnostics";
import { secretStoreEncryptionKey } from "./secretStore";

export type ProviderDriver =
  | "mureka"
  | "multi-protocol-relay"
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
  apiKey?: string;
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

type ProviderProfileCommit = (
  store: DatabaseSync,
  profile: ProviderProfile,
) => void;

type EncryptedDocument = {
  ciphertext: string;
  iv: string;
  tag: string;
  version: 1;
};

const associatedData = Buffer.from("unboundry:provider-profiles:v1", "utf8");
const accountCredentialAad = Buffer.from(
  "unboundry:account-credentials:v1",
  "utf8",
);
const documentLockAcquireTimeoutMs = 5_000;
const drivers: readonly ProviderDriver[] = [
  "mureka",
  "multi-protocol-relay",
  "openrouter",
  "volcengine-ark",
  "openai-compatible",
];
let database: DatabaseSync | undefined;
let databaseDirectory = "";
let documentMutation: Promise<void> = Promise.resolve();
let afterDocumentWriteForTests: (() => Promise<void>) | undefined;
// In-process queue so concurrent generation submissions never block the event
// loop on the same SQLite lock. The SQLite lock remains for cross-process
// writers; the queue makes same-process waiters asynchronous.
let providerDocumentLockQueue: Promise<void> = Promise.resolve();

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
  return secretStoreEncryptionKey();
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
  let releaseQueue!: () => void;
  const previous = providerDocumentLockQueue;
  providerDocumentLockQueue = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });
  await previous;
  const target = paths();
  let lockDatabase: DatabaseSync | undefined;
  try {
    await mkdir(target.directory, { mode: 0o700, recursive: true });
    lockDatabase = new DatabaseSync(target.writeLock, {
      timeout: documentLockAcquireTimeoutMs,
    });
    await chmod(target.writeLock, 0o600);
    const lockFile = await stat(target.writeLock);
    if (!lockFile.isFile()) {
      lockDatabase.close();
      throw new Error("Provider configuration lock is invalid");
    }
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
  } catch (error) {
    lockDatabase?.close();
    releaseQueue();
    if (
      error instanceof Error &&
      /database is locked|locked|busy/i.test(error.message)
    ) {
      throw new Error("Provider configuration is busy");
    }
    throw error;
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
        releaseQueue();
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
  actorUserId?: string,
  onActorCommit?: (store: DatabaseSync, result: T) => void,
) {
  let result!: T;
  const operation = documentMutation.then(async () => {
    const lock = await acquireDocumentLock();
    let actorStore: DatabaseSync | undefined;
    let actorTransactionOpen = false;
    let commit = false;
    try {
      const document = await readDocument();
      result = await mutate(document);
      if (actorUserId) {
        actorStore = openAppDatabase(appDataDirectory());
        actorStore.exec("BEGIN IMMEDIATE");
        actorTransactionOpen = true;
        assertAccountMutationAllowed(actorStore, actorUserId);
        onActorCommit?.(actorStore, result);
      } else if (onActorCommit) {
        throw new Error("Provider commit callback requires an account actor");
      }
      await writeDocument(document);
      await afterDocumentWriteForTests?.();
      if (updateMetadata) {
        if (actorStore) updateMetadata(actorStore, result);
        else updateMetadataAtomically(updateMetadata, result);
      }
      if (actorStore) {
        actorStore.exec("COMMIT");
        actorTransactionOpen = false;
      }
      commit = true;
    } finally {
      if (actorTransactionOpen) {
        try {
          actorStore?.exec("ROLLBACK");
        } catch {
          // Closing the dedicated connection still releases the account lock.
        }
      }
      actorStore?.close();
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
  if (process.env.UNBOUNDRY_TEST_PROVIDER_PROFILE_BARRIER !== "1") {
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
      | "ACCOUNT_CREDENTIAL_CHANGED"
      | "ACCOUNT_CREDENTIAL_INVALID"
      | "ACCOUNT_CREDENTIAL_MISSING"
      | "PROVIDER_CONFIGURATION_MISMATCH"
      | "PROVIDER_PROFILE_MISSING"
      | "PROVIDER_REVERIFY_REQUIRED",
    message: string,
  ) {
    super(message);
  }
}

export class ProviderProfileInUseError extends Error {
  readonly code = "PROVIDER_PROFILE_IN_USE" as const;

  constructor() {
    super(
      "仍有已提交到模型平台的任务依赖当前连接，请等待结果保存后再修改",
    );
    this.name = "ProviderProfileInUseError";
  }
}

export class ProviderProfileLockBusyError extends Error {
  readonly code = "PROVIDER_LOCK_BUSY" as const;

  constructor() {
    super("平台连接正在处理中，请稍后自动重试");
    this.name = "ProviderProfileLockBusyError";
  }
}

function assertProviderProfileMutationHasNoPaidWork(
  store: DatabaseSync,
  profileId: string,
) {
  const paidWork = store.prepare(`
    SELECT tasks.id
    FROM generation_tasks AS tasks
    JOIN generation_provider_attempts AS attempts
      ON attempts.task_id = tasks.id
    WHERE
      tasks.provider_profile_id = ?
      AND (
        (
          attempts.outcome = 'boundary-claimed'
          AND tasks.state IN ('queued', 'running', 'retrying', 'recovering')
        )
        OR (
          attempts.outcome IN ('accepted', 'response-received')
          AND tasks.state IN (
            'queued', 'running', 'retrying', 'recovering', 'failed'
          )
        )
      )
    LIMIT 1
  `).get(profileId);
  if (paidWork) throw new ProviderProfileInUseError();
}

/** Current credential version for one account + connection (0 = 未配置). */
export function accountCredentialVersion(ownerId: string, profileId: string) {
  const row = db()
    .prepare(`
      SELECT credential_version
      FROM account_provider_credentials
      WHERE account_id = ? AND provider_profile_id = ?
    `)
    .get(ownerId, profileId) as { credential_version: number } | undefined;
  return row ? Number(row.credential_version) : 0;
}

async function encryptAccountApiKey(apiKey: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", await encryptionKey(), iv);
  cipher.setAAD(accountCredentialAad);
  const ciphertext = Buffer.concat([
    cipher.update(apiKey, "utf8"),
    cipher.final(),
  ]);
  return [
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    ciphertext.toString("base64"),
  ].join("$");
}

let legacyKeyMigrationScheduled = false;

/**
 * One-time migration: remove generation API keys from the encrypted Provider
 * document and write them as the active administrators' own account
 * credentials. Non-admin accounts never inherit these keys.
 */
export async function migrateLegacyProviderKeysIfNeeded(actorUserId?: string) {
  if (legacyKeyMigrationScheduled) return;
  legacyKeyMigrationScheduled = true;
  try {
    const document = await readDocument();
    const legacy = document.profiles.filter(
      (profile) => Boolean(profile.apiKey),
    );
    if (!legacy.length) return;
    const admins = db()
      .prepare(`
        SELECT id
        FROM users
        WHERE role = 'admin' AND status = 'active'
      `)
      .all() as Array<{ id: string }>;
    if (!admins.length) {
      legacyKeyMigrationScheduled = false;
      return;
    }
    const payloads = await Promise.all(
      legacy.map(async (profile) => ({
        encrypted: await encryptAccountApiKey(profile.apiKey!),
        profileId: profile.id,
      })),
    );
    const timestamp = new Date().toISOString();
    await mutateDocument((current) => {
      for (const payload of payloads) {
        const profile = current.profiles.find(
          (candidate) => candidate.id === payload.profileId,
        );
        if (profile?.apiKey) {
          delete profile.apiKey;
        }
      }
    }, (store) => {
      const insert = store.prepare(`
        INSERT OR IGNORE INTO account_provider_credentials (
          account_id, provider_profile_id, encrypted_key, key_status,
          key_checked_at, credential_version, updated_at
        )
        SELECT id, ?, ?, 'unchecked', NULL, 1, ?
        FROM users
        WHERE id = ? AND role = 'admin' AND status = 'active'
          AND NOT EXISTS (
            SELECT 1 FROM account_delete_intents WHERE owner_id = users.id
          )
      `);
      const insertEpoch = store.prepare(`
        INSERT OR IGNORE INTO account_provider_credential_epochs (
          account_id, provider_profile_id, credential_revision, updated_at
        )
        SELECT account_id, provider_profile_id, credential_version, updated_at
        FROM account_provider_credentials
        WHERE account_id = ? AND provider_profile_id = ?
      `);
      for (const payload of payloads) {
        for (const admin of admins) {
          insert.run(
            payload.profileId,
            payload.encrypted,
            timestamp,
            admin.id,
          );
          insertEpoch.run(admin.id, payload.profileId);
        }
      }
    }, actorUserId);
  } catch (error) {
    legacyKeyMigrationScheduled = false;
    throw error;
  }
}

export type ProviderGenerationProfileState = {
  configurationAligned: boolean;
  credentialRevision?: number;
  documentConfigurationVersion?: number;
  metadataConfigurationVersion?: number;
  profile?: ProviderProfile;
  reason:
    | "account-credential-invalid"
    | "account-credential-missing"
    | "configuration-mismatch"
    | "missing"
    | "ready"
    | "reverify-required";
};

export type ProviderGenerationRequestLease = {
  credentialRevision?: number;
  profile: ProviderProfile;
  release: () => void;
};

/**
 * Read-only Provider configuration snapshot used exclusively for work that
 * must happen before the real generation lease (for example Files API
 * uploads). It is fetched under the same cross-process lock as the lease so
 * the encrypted document and the account credential row are read from the
 * same configuration version, then the lock is released immediately. Callers
 * must never make a Provider request while holding this snapshot.
 */
export type ProviderGenerationSnapshot = {
  apiKey: string;
  baseUrl: string;
  configurationVersion: number;
  credentialRevision: number;
  profileId: string;
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
    !validBaseUrl(baseUrl)
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
        catalog_diagnostics,
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
        catalog_diagnostics: string;
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
      ...parseProviderCatalogDiagnostics(row?.catalog_diagnostics ?? "{}"),
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
              profile.driver === "openai-compatible" ||
              profile.driver === "multi-protocol-relay"
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
    apiKeyMask: profile.apiKey
      ? `••••${profile.apiKey.slice(-4)}`
      : undefined,
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
          catalog_endpoint_count = CASE WHEN ? THEN 0 ELSE catalog_endpoint_count END,
          catalog_diagnostics = CASE WHEN ? THEN '{}' ELSE catalog_diagnostics END
        WHERE id = ? AND provider_configuration_version = ?
      `).run(
        catalogCredentialChanged ? 1 : 0,
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
        catalog_diagnostics = CASE WHEN ? THEN '{}' ELSE catalog_diagnostics END,
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
        catalog_diagnostics = CASE WHEN ? THEN '{}' ELSE catalog_diagnostics END,
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

/**
 * Holds the cross-process Provider document lock while a server-only caller
 * validates the matching SQLite metadata and applies one local mutation.
 */
export async function acquireProviderConfigurationLease(profileId: string) {
  const lock = await acquireDocumentLock();
  try {
    const document = await readDocument();
    const profile = document.profiles.find(
      (candidate) => candidate.id === profileId,
    );
    if (!profile) throw new Error("Provider profile not found");
    let released = false;
    return {
      profile,
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

/**
 * Serializes account credential replacement/deletion with the Provider request
 * lease. A request therefore observes either the complete old credential or the
 * complete new revision, never a document/key split-brain window.
 */
export async function acquireProviderCredentialMutationLease(profileId: string) {
  const lock = await acquireDocumentLock();
  try {
    const document = await readDocument();
    const profile = document.profiles.find(
      (candidate) => candidate.id === profileId,
    );
    let released = false;
    return {
      profile,
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

async function accountKeyForOwner(ownerId: string, profileId: string) {
  const row = db()
    .prepare(`
      SELECT encrypted_key, credential_version
      FROM account_provider_credentials
      WHERE account_id = ? AND provider_profile_id = ?
    `)
    .get(ownerId, profileId) as
      | { credential_version: number; encrypted_key: string }
      | undefined;
  if (!row) return undefined;
  try {
    const parts = row.encrypted_key.split("$");
    if (parts.length !== 3) return undefined;
    const iv = Buffer.from(parts[0], "base64");
    const tag = Buffer.from(parts[1], "base64");
    const ciphertext = Buffer.from(parts[2], "base64");
    if (iv.length !== 12 || tag.length !== 16) return undefined;
    const decipher = createDecipheriv(
      "aes-256-gcm",
      await encryptionKey(),
      iv,
    );
    decipher.setAAD(accountCredentialAad);
    decipher.setAuthTag(tag);
    return {
      apiKey: Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString("utf8"),
      credentialRevision: Number(row.credential_version),
    };
  } catch {
    return undefined;
  }
}

function profileForGenerationState(state: ProviderGenerationProfileState) {
  if (state.reason === "ready" && state.profile) return state.profile;
  if (state.reason === "account-credential-missing") {
    throw new ProviderGenerationConfigurationError(
      "ACCOUNT_CREDENTIAL_MISSING",
      "未配置你的平台密钥",
    );
  }
  if (state.reason === "account-credential-invalid") {
    throw new ProviderGenerationConfigurationError(
      "ACCOUNT_CREDENTIAL_INVALID",
      "你的平台密钥无效",
    );
  }
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
  ownerId: string,
): Promise<ProviderGenerationProfileState> {
  const profile = await getProviderProfile(profileId);
  const state = generationProfileState(profileId, profile, db());
  if (state.reason !== "ready" || !state.profile) return state;
  const credential = db()
    .prepare(`
      SELECT key_status, credential_version
      FROM account_provider_credentials
      WHERE account_id = ? AND provider_profile_id = ?
    `)
    .get(ownerId, profileId) as
    | {
        credential_version: number;
        key_status: "invalid" | "unchecked" | "unknown" | "valid";
      }
    | undefined;
  if (!credential) {
    return {
      ...state,
      reason: "account-credential-missing",
    };
  }
  if (credential.key_status === "invalid") {
    return {
      ...state,
      reason: "account-credential-invalid",
    };
  }
  const key = await accountKeyForOwner(ownerId, profileId);
  if (
    !key ||
    key.credentialRevision !== Number(credential.credential_version)
  ) {
    return {
      ...state,
      reason: "account-credential-missing",
    };
  }
  return {
    ...state,
    credentialRevision: key.credentialRevision,
    profile: { ...state.profile, apiKey: key.apiKey },
  };
}

/**
 * The only profile lookup allowed immediately before a real Provider request.
 * It never repairs metadata on the paid path: split-brain and unverified
 * configurations fail closed.
 */
export async function getProviderProfileForGeneration(
  profileId: string,
  ownerId: string,
): Promise<ProviderProfile> {
  return profileForGenerationState(
    await getProviderGenerationProfileState(profileId, ownerId),
  );
}

/**
 * Holds the same cross-process lock used by profile writers while the caller
 * reads both stores and starts one real Provider request. The caller must
 * release immediately after its fetch function has been invoked.
 */
export async function acquireProviderGenerationRequestLease(
  profileId: string,
  ownerId: string,
): Promise<ProviderGenerationRequestLease> {
  let lock: Awaited<ReturnType<typeof acquireDocumentLock>>;
  try {
    lock = await acquireDocumentLock();
  } catch {
    // A busy document lock means another Provider request or writer is
    // currently holding the same lease. It is a transient contention signal,
    // never a configuration change; callers may retry with bounded backoff.
    throw new ProviderProfileLockBusyError();
  }
  try {
    const document = await readDocument();
    const profile = document.profiles.find(
      (candidate) => candidate.id === profileId,
    );
    const state = generationProfileState(profileId, profile, db());
    const generationState = state.reason === "ready"
      ? await getProviderGenerationProfileState(profileId, ownerId)
      : state;
    const ready = profileForGenerationState(generationState);
    if (!generationState.credentialRevision) {
      throw new ProviderGenerationConfigurationError(
        "ACCOUNT_CREDENTIAL_MISSING",
        "未配置你的平台密钥",
      );
    }
    let released = false;
    return {
      credentialRevision: generationState.credentialRevision,
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

/**
 * Acquires the same cross-process document lock used by profile writers,
 * reads a consistent snapshot of the Provider profile and the account
 * credential, then releases the lock before any network work. The snapshot
 * must be kept in memory only and discarded after file cleanup finishes.
 */
export async function acquireProviderGenerationSnapshot(
  profileId: string,
  ownerId: string,
): Promise<ProviderGenerationSnapshot> {
  let lock: Awaited<ReturnType<typeof acquireDocumentLock>>;
  try {
    lock = await acquireDocumentLock();
  } catch {
    // A busy document lock means another Provider request or writer is
    // currently holding the same lease. It is a transient contention signal,
    // never a configuration change; callers may retry with bounded backoff.
    throw new ProviderProfileLockBusyError();
  }
  try {
    const document = await readDocument();
    const profile = document.profiles.find(
      (candidate) => candidate.id === profileId,
    );
    const state = generationProfileState(profileId, profile, db());
    const generationState = state.reason === "ready"
      ? await getProviderGenerationProfileState(profileId, ownerId)
      : state;
    const ready = profileForGenerationState(generationState);
    if (!generationState.credentialRevision || !ready.apiKey) {
      throw new ProviderGenerationConfigurationError(
        "ACCOUNT_CREDENTIAL_MISSING",
        "未配置你的平台密钥",
      );
    }
    return {
      apiKey: ready.apiKey,
      baseUrl: ready.baseUrl,
      configurationVersion: providerConfigurationVersion(ready),
      credentialRevision: generationState.credentialRevision,
      profileId: ready.id,
    };
  } catch (error) {
    throw error;
  } finally {
    lock.finish(false);
  }
}

export async function saveProviderProfile(
  input: Record<string, unknown>,
  profileId?: string,
  actorUserId?: string,
  onCommit?: ProviderProfileCommit,
) {
  let previousDriver: ProviderDriver | undefined;
  let profileKeyCatalogChanged = false;
  const profile = await mutateDocument((document) => {
    const current = profileId
      ? document.profiles.find((candidate) => candidate.id === profileId)
      : undefined;
    if (profileId && !current) throw new Error("Provider profile not found");
    if (current) {
      assertProviderProfileMutationHasNoPaidWork(db(), current.id);
    }
    previousDriver = current?.driver;
    const cleaned = cleanProfileInput(input, current);
    profileKeyCatalogChanged = Boolean(
      current &&
        (cleaned.driver === "openrouter" ||
          cleaned.driver === "openai-compatible" ||
          cleaned.driver === "multi-protocol-relay") &&
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
  }, actorUserId, onCommit);
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
  actorUserId?: string,
  onCommit?: ProviderProfileCommit,
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
    if (changed) {
      assertProviderProfileMutationHasNoPaidWork(db(), current.id);
    }
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
  }, actorUserId, onCommit);
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
      | "NOT_CONFIGURED"
      | "NOT_SUPPORTED"
      | "PERMISSION"
      | "PROXY_CONFIGURATION"
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
  actorUserId?: string,
  onCommit?: ProviderProfileCommit,
) {
  const lock = await acquireDocumentLock();
  let actorStore: DatabaseSync | undefined;
  let actorTransactionOpen = false;
  try {
    const latest = await readDocument();
    const current = latest.profiles.find(
      (candidate) => candidate.id === profile.id,
    );
    if (!sameProviderRevision(current, profile)) {
      throw new ProviderVerificationError("CONFIG_CHANGED");
    }
    const store = actorUserId
      ? (actorStore = openAppDatabase(appDataDirectory()))
      : db();
    if (actorUserId) {
      store.exec("BEGIN IMMEDIATE");
      actorTransactionOpen = true;
      assertAccountMutationAllowed(store, actorUserId);
    }
    assertProviderProfileMutationHasNoPaidWork(store, profile.id);
    if (!recordKeyCheck(store, profile, keyStatus)) {
      throw new ProviderVerificationError("CONFIG_CHANGED");
    }
    onCommit?.(store, profile);
    if (actorStore) {
      actorStore.exec("COMMIT");
      actorTransactionOpen = false;
    }
  } finally {
    if (actorTransactionOpen) {
      try {
        actorStore?.exec("ROLLBACK");
      } catch {
        // Closing the dedicated connection still releases the account lock.
      }
    }
    actorStore?.close();
    lock.finish(false);
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
    profile.driver === "openai-compatible" ||
    profile.driver === "multi-protocol-relay"
  ) {
    return `API Key有效。可读取模型：${modelCount} 个。`;
  }
  if (profile.driver === "volcengine-ark") {
    return "API Key有效。视频任务接口可读。";
  }
  return "API Key有效。账户接口可读。";
}

/**
 * Read-only Provider key probe used by both admin connection checks and
 * per-account credential verification. Never records anything.
 */
export async function probeProviderKey(
  profile: ProviderProfile,
  fetcher?: typeof fetch,
): Promise<ProviderVerification> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    if (profile.driver === "multi-protocol-relay") {
      const catalog = await fetchRelayModelCatalog(profile, fetcher, {
        signal: controller.signal,
        timeoutMs: 10_000,
      });
      return {
        latencyMs: Math.max(0, Date.now() - startedAt),
        message: verificationSuccessMessage(profile, catalog.models.length),
        modelCount: catalog.models.length,
        status: "verified",
      };
    }
    const requestUrl = modelListUrl(profile);
    const requestInit = {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${profile.apiKey}`,
      },
      method: "GET",
      redirect: "error",
      signal: controller.signal,
    } satisfies RequestInit;
    const response = profile.driver === "openai-compatible"
      ? await fetchPublicHttps(requestUrl, requestInit, { fetcher })
      : await (fetcher ?? fetch)(requestUrl, requestInit);
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
    return {
      latencyMs: Math.max(0, Date.now() - startedAt),
      message: verificationSuccessMessage(profile, modelCount),
      modelCount,
      status: "verified",
    };
  } catch (error) {
    if (error instanceof OutboundProxyConfigurationError) {
      throw new ProviderVerificationError(error.code);
    }
    if (error instanceof OutboundDestinationError) {
      throw new ProviderVerificationError(error.code);
    }
    if (error instanceof RelayRemoteError) {
      throw new ProviderVerificationError(error.code);
    }
    if (error instanceof ProviderVerificationError) {
      throw error;
    }
    throw new ProviderVerificationError("NETWORK");
  } finally {
    clearTimeout(timer);
  }
}

export async function verifyProviderProfile(
  profileId: string,
  ownerIdOrFetcher?: string | typeof fetch,
  fetcher?: typeof fetch,
  actorUserId?: string,
  onCommit?: ProviderProfileCommit,
): Promise<ProviderVerification> {
  const ownerId =
    typeof ownerIdOrFetcher === "function" ? undefined : ownerIdOrFetcher;
  const effectiveFetcher =
    typeof ownerIdOrFetcher === "function" ? ownerIdOrFetcher : fetcher;
  // Product HTTP callers pass an authenticated actor explicitly. Keep the
  // legacy owner/fetcher overload actor-free for internal fixtures, while the
  // final metadata write repeats this check transactionally.
  if (actorUserId) assertAccountMutationAllowed(db(), actorUserId);
  const document = await readDocument();
  const profile = document.profiles.find(
    (candidate) => candidate.id === profileId,
  );
  if (!profile) throw new ProviderVerificationError("FORMAT");
  if (!ensureMetadata(db(), profile)) {
    throw new ProviderVerificationError("CONFIG_CHANGED");
  }
  let probeProfile = profile;
  if (ownerId) {
    const apiKey = (await accountKeyForOwner(ownerId, profileId))?.apiKey;
    if (!apiKey) {
      throw new ProviderVerificationError("NOT_CONFIGURED");
    }
    probeProfile = { ...profile, apiKey };
  }
  let result: ProviderVerification;
  try {
    result = await probeProviderKey(probeProfile, effectiveFetcher);
  } catch (error) {
    if (error instanceof AccountMutationBlockedError) throw error;
    if (error instanceof ProviderProfileInUseError) throw error;
    if (error instanceof ProviderVerificationError) {
      if (error.code === "CONFIG_CHANGED") throw error;
      await recordCurrentKeyCheck(
        profile,
        error.code === "AUTH" ? "invalid" : "unknown",
        actorUserId,
      );
      throw error;
    }
    await recordCurrentKeyCheck(profile, "unknown", actorUserId);
    throw new ProviderVerificationError("NETWORK");
  }
  // Keep persistence/audit failures distinct from remote probe failures. A
  // successful probe must not be rewritten to "unknown" when its atomic
  // metadata + audit commit rolls back.
  await recordCurrentKeyCheck(profile, "valid", actorUserId, onCommit);
  return result;
}

export function providerVerificationErrorMessage(error: unknown) {
  if (error instanceof AccountMutationBlockedError) return error.message;
  if (error instanceof ProviderProfileInUseError) return error.message;
  if (!(error instanceof ProviderVerificationError)) return "暂时无法确认API Key是否有效";
  if (error.code === "AUTH") return "API Key已失效";
  if (error.code === "CONFIG_CHANGED") return "连接资料已修改，请重新检查Key";
  if (error.code === "NOT_CONFIGURED") return "未配置你的平台密钥";
  if (error.code === "PERMISSION") return "暂时无法确认API Key是否有效";
  if (error.code === "PROXY_CONFIGURATION") {
    return "本机代理地址模式阻止安全检查，暂时无法确认API Key是否有效";
  }
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
  if (!identity || !hasPermission(identity, "manage_providers")) {
    json(response, 403, {
      error: "Only administrators can manage Provider connections",
    });
    return;
  }
  await migrateLegacyProviderKeysIfNeeded(identity.userId).catch(() => undefined);
  const path = decodedRequestPath(request).replace(
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
        await readJsonBody<Record<string, unknown>>(request, 64 * 1_024),
        path || undefined,
        identity.userId,
        (store, committedProfile) => audit(
          store,
          identity.userId,
          path ? "provider_profile.update" : "provider_profile.create",
          committedProfile,
        ),
      );
      json(response, path ? 200 : 201, { profile: publicProfile(profile) });
    } catch (error) {
      if (error instanceof HttpRequestError) throw error;
      if (error instanceof AccountMutationBlockedError) {
        json(response, 409, { code: error.code, error: error.message });
        return;
      }
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
      const result = await verifyProviderProfile(
        profileId,
        identity.userId,
        undefined,
        identity.userId,
        (store, committedProfile) => audit(
          store,
          identity.userId,
          "provider_profile.verify",
          committedProfile,
        ),
      );
      json(response, 200, {
        paidGenerationRequests: 0,
        verification: result,
      });
    } catch (error) {
      if (error instanceof AccountMutationBlockedError) {
        json(response, 409, {
          code: error.code,
          error: error.message,
          paidGenerationRequests: 0,
        });
        return;
      }
      json(response, 400, {
        error: providerVerificationErrorMessage(error),
        paidGenerationRequests: 0,
      });
    }
    return;
  }
  response.setHeader("Allow", "GET, POST, PATCH");
  json(response, 404, { error: "Provider endpoint not found" });
}
