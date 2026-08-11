import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import { composeExecutionProfile } from "./accountCredentials";
import {
  AccountMutationBlockedError,
  assertAccountMutationAllowed,
} from "./accountMutationFence";
import { requestIdentity } from "./auth";
import { appDataDirectory, openAppDatabase } from "./database";
import {
  decodedRequestPath,
  HttpRequestError,
  readJsonBody,
} from "./httpRequest";
import { hasPermission } from "./permissions";
import {
  acquireProviderConfigurationLease,
  getArkControlPlaneCredentials,
  getProviderProfile,
  prepareArkControlPlaneCredentials,
  providerConfigurationVersion,
  saveArkControlPlaneCredentials,
  type ProviderCatalogKeyStatus,
  type ProviderDriver,
  type ProviderProfile,
} from "./providerProfiles";
import {
  providerCatalogCapabilities,
} from "./providerCatalogCapabilities";
import {
  parseProviderCatalogDiagnostics,
  serializeProviderCatalogDiagnostics,
  type ProviderCatalogDiagnostics,
} from "./providerCatalogDiagnostics";
import {
  RelayRemoteError,
  fetchRelayModelCatalog,
  inferRelayCatalogModelHints,
  readRelayManagementResource,
  relayReadOnlyDescriptor,
  relayReadOnlyErrorCode,
  relayReadOnlyErrorMessage,
  type RelayReadOnlyResource,
} from "./multiProtocolRelay";
import {
  OutboundDestinationError,
  OutboundProxyConfigurationError,
  fetchPublicHttps,
} from "./outboundNetwork";
import {
  ArkControlPlaneError,
  VOLCENGINE_ARK_CONTROL_PLANE_TIMEOUT_MS,
  discoverArkCatalog,
} from "./volcengineArkControlPlane";
import {
  knownModelParameterSchema,
  type ModelCapability,
} from "../types/modelParameters";
import {
  isProviderProtocol,
  providerProtocolSupportsCapability,
  relayProviderProtocols,
  type ProviderProtocol,
} from "../types/relayProtocols";

type CatalogSnapshotRow = {
  catalog_checked_at: string | null;
  catalog_control_request_count: number;
  catalog_diagnostics: string;
  catalog_endpoint_count: number;
  catalog_endpoints: string;
  catalog_key_status: ProviderCatalogKeyStatus;
  catalog_last_error_code: string | null;
  catalog_model_count: number;
  catalog_models: string;
  catalog_synced_at: string | null;
  driver: ProviderDriver;
  provider_configuration_version: number;
};

type ImportSelection = {
  capability?: unknown;
  discoveryId?: unknown;
  providerProtocol?: unknown;
};

type ProviderCatalogSyncOptions = {
  actorUserId?: string;
  maximumDurationMs?: number;
};

export type ProviderCatalogModelMetadata = {
  contextLength?: number;
  inputModalities?: string[];
  modelType?: string;
  modalities?: string[];
  outputModalities?: string[];
  pricingSummary?: string;
  protocols?: Exclude<ProviderProtocol, "native">[];
  supportedParameters?: string[];
};

export type ProviderCatalogDiscoveredModel = {
  capability: ModelCapability | "unknown";
  discoveryId: string;
  displayName: string;
  metadata?: ProviderCatalogModelMetadata;
  providerModelId: string;
  source:
    | "openai-compatible-public-catalog"
    | "openrouter-account-catalog"
    | "multi-protocol-relay-account-catalog"
    | "volcengine-ark-control-plane";
  status: string;
};

export type ProviderCatalogDiscoveredEndpoint = {
  id: string;
  name: string;
  providerModelId?: string;
  source: "volcengine-ark-control-plane";
  status: string;
};

const capabilities: readonly ModelCapability[] = [
  "text",
  "image",
  "video",
  "audio",
];
const catalogSyncMaximumDurationMs = 60_000;
const catalogMaximumResponseBytes = 5 * 1_024 * 1_024;
const catalogMaximumModels = 2_000;
let database: DatabaseSync | undefined;
let databaseDirectory = "";

function db() {
  const directory = appDataDirectory();
  if (database && databaseDirectory === directory) return database;
  database?.close();
  database = openAppDatabase();
  databaseDirectory = directory;
  return database;
}

function json(response: ServerResponse, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function snapshotRow(store: DatabaseSync, profileId: string) {
  return store.prepare(`
    SELECT
      catalog_checked_at,
      catalog_control_request_count,
      catalog_diagnostics,
      catalog_endpoint_count,
      catalog_endpoints,
      catalog_key_status,
      catalog_last_error_code,
      catalog_model_count,
      catalog_models,
      catalog_synced_at,
      driver,
      provider_configuration_version
    FROM provider_profiles
    WHERE id = ?
  `).get(profileId) as CatalogSnapshotRow | undefined;
}

function parseSnapshotList(value: string) {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) throw new Error("Invalid catalog snapshot");
  return parsed;
}

function requiredSnapshotString(
  record: Record<string, unknown>,
  field: string,
  maximum = 2_048,
) {
  const value = record[field];
  if (typeof value !== "string" || !value || value.length > maximum) {
    throw new Error("Invalid catalog snapshot");
  }
  return value;
}

function safeSnapshotStringArray(value: unknown) {
  if (!Array.isArray(value) || value.length > 100) {
    throw new Error("Invalid catalog snapshot");
  }
  return value.map((item) => {
    if (typeof item !== "string" || !item || item.length > 80) {
      throw new Error("Invalid catalog snapshot");
    }
    return item;
  });
}

function parseSnapshotMetadata(value: unknown) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid catalog snapshot");
  }
  const record = value as Record<string, unknown>;
  const contextLength = record.contextLength;
  if (
    contextLength !== undefined &&
    (!Number.isSafeInteger(contextLength) || Number(contextLength) < 1 ||
      Number(contextLength) > 100_000_000)
  ) {
    throw new Error("Invalid catalog snapshot");
  }
  const pricingSummary = record.pricingSummary;
  if (
    pricingSummary !== undefined &&
    (typeof pricingSummary !== "string" || pricingSummary.length > 320)
  ) {
    throw new Error("Invalid catalog snapshot");
  }
  const modelType = record.modelType;
  if (
    modelType !== undefined &&
    (typeof modelType !== "string" || !modelType || modelType.length > 80)
  ) {
    throw new Error("Invalid catalog snapshot");
  }
  const protocols = record.protocols === undefined
    ? undefined
    : safeSnapshotStringArray(record.protocols);
  if (
    protocols?.some((protocol) =>
      !relayProviderProtocols.includes(
        protocol as Exclude<ProviderProtocol, "native">,
      )
    )
  ) {
    throw new Error("Invalid catalog snapshot");
  }
  return {
    ...(contextLength !== undefined
      ? { contextLength: Number(contextLength) }
      : {}),
    ...(record.inputModalities !== undefined
      ? { inputModalities: safeSnapshotStringArray(record.inputModalities) }
      : {}),
    ...(modelType !== undefined ? { modelType } : {}),
    ...(record.modalities !== undefined
      ? { modalities: safeSnapshotStringArray(record.modalities) }
      : {}),
    ...(record.outputModalities !== undefined
      ? { outputModalities: safeSnapshotStringArray(record.outputModalities) }
      : {}),
    ...(pricingSummary !== undefined ? { pricingSummary } : {}),
    ...(protocols !== undefined
      ? { protocols: protocols as Exclude<ProviderProtocol, "native">[] }
      : {}),
    ...(record.supportedParameters !== undefined
      ? { supportedParameters: safeSnapshotStringArray(record.supportedParameters) }
      : {}),
  } satisfies ProviderCatalogModelMetadata;
}

function catalogModelSource(driver: ProviderDriver) {
  if (driver === "openrouter") return "openrouter-account-catalog" as const;
  if (driver === "openai-compatible") {
    return "openai-compatible-public-catalog" as const;
  }
  if (driver === "multi-protocol-relay") {
    return "multi-protocol-relay-account-catalog" as const;
  }
  return "volcengine-ark-control-plane" as const;
}

function parseSnapshotModels(
  value: string,
  driver: ProviderDriver,
): ProviderCatalogDiscoveredModel[] {
  return parseSnapshotList(value).map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("Invalid catalog snapshot");
    }
    const record = item as Record<string, unknown>;
    const capability = record.capability;
    if (
      capability !== "unknown" &&
      !capabilities.includes(capability as ModelCapability)
    ) {
      throw new Error("Invalid catalog snapshot");
    }
    const providerModelId = requiredSnapshotString(record, "providerModelId");
    const displayName = requiredSnapshotString(record, "displayName");
    const metadata = parseSnapshotMetadata(record.metadata);
    const inferred = driver === "multi-protocol-relay"
      ? inferRelayCatalogModelHints(providerModelId, displayName)
      : { capability: "unknown" as const };
    const resolvedCapability = capability === "unknown"
      ? inferred.capability
      : capability as ModelCapability;
    return {
      capability: resolvedCapability,
      discoveryId: requiredSnapshotString(record, "discoveryId"),
      displayName,
      ...(metadata ? { metadata } : {}),
      providerModelId,
      source: catalogModelSource(driver),
      status: requiredSnapshotString(record, "status", 160),
    };
  });
}

function parseSnapshotEndpoints(
  value: string,
  driver: ProviderDriver,
): ProviderCatalogDiscoveredEndpoint[] {
  if (driver !== "volcengine-ark") {
    if (parseSnapshotList(value).length !== 0) {
      throw new Error("Invalid catalog snapshot");
    }
    return [];
  }
  return parseSnapshotList(value).map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("Invalid catalog snapshot");
    }
    const record = item as Record<string, unknown>;
    const providerModelId = record.providerModelId;
    if (
      providerModelId !== undefined &&
      (typeof providerModelId !== "string" ||
        !providerModelId ||
        providerModelId.length > 2_048)
    ) {
      throw new Error("Invalid catalog snapshot");
    }
    return {
      id: requiredSnapshotString(record, "id"),
      name: requiredSnapshotString(record, "name"),
      ...(providerModelId ? { providerModelId } : {}),
      source: "volcengine-ark-control-plane",
      status: requiredSnapshotString(record, "status", 160),
    };
  });
}

function publicCatalog(store: DatabaseSync, profileId: string) {
  const row = snapshotRow(store, profileId);
  if (!row) throw new Error("Provider profile not found");
  return {
    ...providerCatalogCapabilities(row.driver),
    ...parseProviderCatalogDiagnostics(row.catalog_diagnostics),
    checkedAt: row.catalog_checked_at ?? undefined,
    controlRequestCount: Number(row.catalog_control_request_count),
    endpointCount: Number(row.catalog_endpoint_count),
    endpoints: parseSnapshotEndpoints(row.catalog_endpoints, row.driver),
    errorCode: row.catalog_last_error_code ?? undefined,
    keyStatus: row.catalog_key_status,
    modelCount: Number(row.catalog_model_count),
    models: parseSnapshotModels(row.catalog_models, row.driver),
    syncedAt: row.catalog_synced_at ?? undefined,
  };
}

export function getArkProviderCatalog(profileId: string) {
  const row = snapshotRow(db(), profileId);
  if (row?.driver !== "volcengine-ark") {
    throw new Error("Ark Provider profile not found");
  }
  return publicCatalog(db(), profileId);
}

export async function getProviderCatalog(profileId: string) {
  const profile = await getProviderProfile(profileId);
  if (!profile) throw new Error("Provider profile not found");
  const row = snapshotRow(db(), profileId);
  if (!row || row.driver !== profile.driver) {
    throw new Error("Provider profile not found");
  }
  return publicCatalog(db(), profileId);
}

function audit(
  store: DatabaseSync,
  actorUserId: string,
  action: string,
  profileId: string,
  details: Record<string, unknown> = {},
) {
  store.prepare(`
    INSERT INTO admin_audit_events (
      actor_user_id, action, target_user_id, details, created_at
    )
    VALUES (?, ?, NULL, ?, ?)
  `).run(
    actorUserId,
    action,
    JSON.stringify({ profileId, ...details }),
    new Date().toISOString(),
  );
}

type CatalogRemoteErrorCode =
  | "AUTH"
  | "FORMAT"
  | "NETWORK"
  | "PERMISSION"
  | "PROXY_CONFIGURATION"
  | "RATE_LIMIT"
  | "REMOTE";

class CatalogRemoteError extends Error {
  constructor(readonly code: CatalogRemoteErrorCode) {
    super(code);
  }
}

class CatalogSyncPersistenceError extends Error {
  constructor(readonly original: unknown) {
    super("Provider catalog persistence failed");
  }
}

function catalogStatusForError(error: unknown): ProviderCatalogKeyStatus {
  if (
    !(error instanceof ArkControlPlaneError) &&
    !(error instanceof CatalogRemoteError)
  ) {
    return "unknown";
  }
  if (error.code === "AUTH") return "invalid";
  if (error.code === "PERMISSION") return "permission";
  return "unknown";
}

function catalogErrorCode(error: unknown) {
  if (error instanceof ArkControlPlaneError) return error.code;
  if (error instanceof CatalogRemoteError) return error.code;
  if (error instanceof CatalogSyncError) return error.code;
  return "UNKNOWN";
}

class CatalogSyncError extends Error {
  constructor(
    readonly code:
      | "AUTH"
      | "CONFIG_CHANGED"
      | "NOT_CONFIGURED"
      | "NOT_SUPPORTED"
      | "STALE",
  ) {
    super(code);
  }
}

function remainingCatalogSyncDurationMs(
  deadline: number,
  signal?: AbortSignal,
) {
  const remaining = Math.ceil(deadline - performance.now());
  if (signal?.aborted || remaining < 1) {
    throw new ArkControlPlaneError("NETWORK");
  }
  return remaining;
}

function claimCatalogSync(
  store: DatabaseSync,
  profileId: string,
  syncToken: string,
) {
  const claimed = store.prepare(`
    UPDATE provider_profiles
    SET catalog_sync_token = ?
    WHERE
      id = ?
      AND driver = 'volcengine-ark'
  `).run(syncToken, profileId);
  if (claimed.changes !== 1) throw new CatalogSyncError("CONFIG_CHANGED");
}

function catalogSyncStateError(
  store: DatabaseSync,
  profileId: string,
  credentialRevision: string,
  syncToken: string,
) {
  const current = store.prepare(`
    SELECT driver, catalog_credential_revision, catalog_sync_token
    FROM provider_profiles
    WHERE id = ?
  `).get(profileId) as {
    catalog_credential_revision: string | null;
    catalog_sync_token: string | null;
    driver: string;
  } | undefined;
  if (
    !current ||
    current.driver !== "volcengine-ark" ||
    current.catalog_credential_revision !== credentialRevision
  ) {
    return new CatalogSyncError("CONFIG_CHANGED");
  }
  if (current.catalog_sync_token !== syncToken) {
    return new CatalogSyncError("STALE");
  }
  return undefined;
}

function assertCatalogSyncCurrent(
  store: DatabaseSync,
  profileId: string,
  credentialRevision: string,
  syncToken: string,
) {
  const error = catalogSyncStateError(
    store,
    profileId,
    credentialRevision,
    syncToken,
  );
  if (error) throw error;
}

async function sameCredentialRevision(profileId: string, revision: string) {
  return (await getArkControlPlaneCredentials(profileId))?.revision === revision;
}

function incrementControlRequests(
  store: DatabaseSync,
  profileId: string,
  requestCount: number,
) {
  if (!requestCount) return;
  store.prepare(`
    UPDATE provider_profiles
    SET catalog_control_request_count = catalog_control_request_count + ?
    WHERE id = ?
  `).run(requestCount, profileId);
}

export async function syncArkProviderCatalog(
  profileId: string,
  fetcher: typeof fetch = fetch,
  options: ProviderCatalogSyncOptions = {},
) {
  if (options.actorUserId) {
    assertAccountMutationAllowed(db(), options.actorUserId);
  }
  const maximumDurationMs = options.maximumDurationMs ??
    catalogSyncMaximumDurationMs;
  if (
    !Number.isSafeInteger(maximumDurationMs) ||
    maximumDurationMs < 1 ||
    maximumDurationMs > catalogSyncMaximumDurationMs
  ) {
    throw new Error("Invalid catalog sync duration");
  }
  const deadline = performance.now() + maximumDurationMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), maximumDurationMs);
  let requestCount = 0;
  let credentials: Awaited<
    ReturnType<typeof prepareArkControlPlaneCredentials>
  > = undefined;
  let syncClaimed = false;
  let controlRequestsRecorded = false;
  const syncToken = randomUUID();
  const countingFetcher: typeof fetch = async (input, init) => {
    requestCount += 1;
    return fetcher(input, init);
  };
  try {
    claimCatalogSync(db(), profileId, syncToken);
    syncClaimed = true;
    credentials = await prepareArkControlPlaneCredentials(profileId);
    if (!credentials) throw new CatalogSyncError("NOT_CONFIGURED");
    remainingCatalogSyncDurationMs(deadline, controller.signal);
    assertCatalogSyncCurrent(
      db(),
      profileId,
      credentials.revision,
      syncToken,
    );
    const requestTimeoutMs = Math.min(
      VOLCENGINE_ARK_CONTROL_PLANE_TIMEOUT_MS,
      remainingCatalogSyncDurationMs(deadline, controller.signal),
    );
    const discovered = await discoverArkCatalog(credentials, {
      fetcher: countingFetcher,
      signal: controller.signal,
      timeoutMs: requestTimeoutMs,
    });
    remainingCatalogSyncDurationMs(deadline, controller.signal);
    assertCatalogSyncCurrent(
      db(),
      profileId,
      credentials.revision,
      syncToken,
    );
    if (!(await sameCredentialRevision(profileId, credentials.revision))) {
      throw new CatalogSyncError("CONFIG_CHANGED");
    }
    remainingCatalogSyncDurationMs(deadline, controller.signal);
    const timestamp = new Date().toISOString();
    const store = db();
    store.exec("BEGIN IMMEDIATE");
    try {
      remainingCatalogSyncDurationMs(deadline, controller.signal);
      if (options.actorUserId) {
        assertAccountMutationAllowed(store, options.actorUserId);
      }
      const updated = store.prepare(`
        UPDATE provider_profiles
        SET
          catalog_key_status = 'valid',
          catalog_checked_at = ?,
          catalog_synced_at = ?,
          catalog_last_error_code = NULL,
          catalog_models = ?,
          catalog_endpoints = ?,
          catalog_model_count = ?,
          catalog_endpoint_count = ?,
          catalog_control_request_count = catalog_control_request_count + ?,
          catalog_diagnostics = '{}',
          catalog_sync_token = NULL
        WHERE
          id = ?
          AND driver = 'volcengine-ark'
          AND catalog_credential_revision = ?
          AND catalog_sync_token = ?
      `).run(
        timestamp,
        timestamp,
        JSON.stringify(discovered.models),
        JSON.stringify(discovered.endpoints),
        discovered.models.length,
        discovered.endpoints.length,
        requestCount,
        profileId,
        credentials.revision,
        syncToken,
      );
      if (updated.changes !== 1) {
        throw catalogSyncStateError(
          store,
          profileId,
          credentials.revision,
          syncToken,
        ) ?? new CatalogSyncError("STALE");
      }
      if (options.actorUserId) {
        audit(store, options.actorUserId, "provider_catalog.sync", profileId, {
          controlPlaneRequests: requestCount,
          endpointCount: discovered.endpoints.length,
          modelCount: discovered.models.length,
        });
      }
      store.exec("COMMIT");
      controlRequestsRecorded = true;
    } catch (error) {
      store.exec("ROLLBACK");
      if (
        error instanceof AccountMutationBlockedError ||
        error instanceof CatalogRemoteError ||
        error instanceof CatalogSyncError
      ) {
        throw error;
      }
      throw new CatalogSyncPersistenceError(error);
    }
    return {
      catalog: publicCatalog(store, profileId),
      controlPlaneRequests: requestCount,
    };
  } catch (caught) {
    if (caught instanceof AccountMutationBlockedError) throw caught;
    if (caught instanceof CatalogSyncPersistenceError) throw caught.original;
    let error = caught;
    try {
      remainingCatalogSyncDurationMs(deadline, controller.signal);
    } catch (timeoutError) {
      error = timeoutError;
    }
    if (!credentials || !syncClaimed) throw error;
    const store = db();
    store.exec("BEGIN IMMEDIATE");
    try {
      if (options.actorUserId) {
        assertAccountMutationAllowed(store, options.actorUserId);
      }
      if (!controlRequestsRecorded && !(error instanceof CatalogSyncError)) {
        const updated = store.prepare(`
          UPDATE provider_profiles
          SET
            catalog_key_status = ?,
            catalog_checked_at = ?,
            catalog_last_error_code = ?,
            catalog_control_request_count = catalog_control_request_count + ?,
            catalog_sync_token = NULL
          WHERE
            id = ?
            AND driver = 'volcengine-ark'
            AND catalog_credential_revision = ?
            AND catalog_sync_token = ?
        `).run(
          catalogStatusForError(error),
          new Date().toISOString(),
          catalogErrorCode(error),
          requestCount,
          profileId,
          credentials.revision,
          syncToken,
        );
        controlRequestsRecorded = updated.changes === 1;
      }
      if (!controlRequestsRecorded) {
        incrementControlRequests(store, profileId, requestCount);
        controlRequestsRecorded = true;
      }
      store.exec("COMMIT");
    } catch (persistenceError) {
      if (store.isTransaction) store.exec("ROLLBACK");
      throw persistenceError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function remainingProfileCatalogSyncDurationMs(
  deadline: number,
  signal?: AbortSignal,
) {
  const remaining = Math.ceil(deadline - performance.now());
  if (signal?.aborted || remaining < 1) {
    throw new CatalogRemoteError("NETWORK");
  }
  return remaining;
}

function claimProfileCatalogSync(
  store: DatabaseSync,
  profile: ProviderProfile,
  syncToken: string,
) {
  const claimed = store.prepare(`
    UPDATE provider_profiles
    SET catalog_sync_token = ?
    WHERE
      id = ?
      AND driver = ?
      AND provider_configuration_version = ?
  `).run(
    syncToken,
    profile.id,
    profile.driver,
    providerConfigurationVersion(profile),
  );
  if (claimed.changes !== 1) throw new CatalogSyncError("CONFIG_CHANGED");
}

function profileCatalogSyncStateError(
  store: DatabaseSync,
  profile: ProviderProfile,
  syncToken: string,
) {
  const current = store.prepare(`
    SELECT driver, provider_configuration_version, catalog_sync_token
    FROM provider_profiles
    WHERE id = ?
  `).get(profile.id) as {
    catalog_sync_token: string | null;
    driver: string;
    provider_configuration_version: number;
  } | undefined;
  if (
    !current ||
    current.driver !== profile.driver ||
    Number(current.provider_configuration_version) !==
      providerConfigurationVersion(profile)
  ) {
    return new CatalogSyncError("CONFIG_CHANGED");
  }
  if (current.catalog_sync_token !== syncToken) {
    return new CatalogSyncError("STALE");
  }
  return undefined;
}

function assertProfileCatalogSyncCurrent(
  store: DatabaseSync,
  profile: ProviderProfile,
  syncToken: string,
) {
  const error = profileCatalogSyncStateError(store, profile, syncToken);
  if (error) throw error;
}

async function sameProfileCatalogRevision(profile: ProviderProfile) {
  const current = await getProviderProfile(profile.id);
  return Boolean(
    current &&
      current.driver === profile.driver &&
      providerConfigurationVersion(current) ===
        providerConfigurationVersion(profile),
  );
}

async function readLimitedCatalogJson(response: Response) {
  if (!response.body) throw new CatalogRemoteError("FORMAT");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > catalogMaximumResponseBytes) {
      await reader.cancel();
      throw new CatalogRemoteError("FORMAT");
    }
    chunks.push(value);
  }
  try {
    const parsed = JSON.parse(
      Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8"),
    ) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("invalid");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new CatalogRemoteError("FORMAT");
  }
}

function remoteCatalogUrl(profile: ProviderProfile) {
  if (profile.driver === "openrouter") {
    return `${profile.baseUrl}/models/user`;
  }
  if (profile.driver === "openai-compatible") {
    return `${profile.baseUrl}/models`;
  }
  throw new CatalogSyncError("NOT_SUPPORTED");
}

function optionalRemoteString(value: unknown, maximum: number) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) return undefined;
  return normalized;
}

const knownModalities = new Set(["audio", "image", "text", "video"]);

function remoteStringList(
  value: unknown,
  maximumItems: number,
  maximumLength: number,
  allowed?: ReadonlySet<string>,
) {
  if (!Array.isArray(value) || value.length > maximumItems) return undefined;
  const normalized: string[] = [];
  for (const item of value) {
    const text = optionalRemoteString(item, maximumLength)?.toLowerCase();
    if (!text || (allowed && !allowed.has(text))) continue;
    if (!normalized.includes(text)) normalized.push(text);
  }
  return normalized.length ? normalized : undefined;
}

function remoteModelCapability(outputModalities: string[] | undefined) {
  if (!outputModalities?.length) return "unknown" as const;
  const media = outputModalities.filter((item) => item !== "text");
  if (media.length === 1) return media[0] as ModelCapability;
  if (media.length === 0 && outputModalities.length === 1) return "text" as const;
  return "unknown" as const;
}

function remotePricingSummary(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const pricing = value as Record<string, unknown>;
  const fields = [
    ["prompt", "输入"],
    ["completion", "输出"],
    ["image", "图片"],
    ["request", "请求"],
  ] as const;
  const parts: string[] = [];
  for (const [field, label] of fields) {
    const raw = pricing[field];
    const text = typeof raw === "number" && Number.isFinite(raw)
      ? String(raw)
      : optionalRemoteString(raw, 40);
    if (text && /^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) {
      parts.push(`${label} ${text}`);
    }
  }
  return parts.length ? parts.join(" · ").slice(0, 320) : undefined;
}

function containsProfileSecret(value: unknown, secret: string): boolean {
  if (!secret) return false;
  if (typeof value === "string") {
    if (value.includes(secret) || value.includes(encodeURIComponent(secret))) {
      return true;
    }
    try {
      return decodeURIComponent(value).includes(secret);
    } catch {
      return false;
    }
  }
  if (Array.isArray(value)) {
    return value.some((item) => containsProfileSecret(item, secret));
  }
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).some(
      ([key, item]) =>
        containsProfileSecret(key, secret) ||
        containsProfileSecret(item, secret),
    );
  }
  return false;
}

function normalizeRemoteCatalogModel(
  raw: unknown,
  driver: "openai-compatible" | "openrouter",
): ProviderCatalogDiscoveredModel | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const providerModelId = optionalRemoteString(record.id, 160);
  if (!providerModelId) return undefined;
  const architecture =
    record.architecture &&
      typeof record.architecture === "object" &&
      !Array.isArray(record.architecture)
      ? record.architecture as Record<string, unknown>
      : {};
  const inputModalities = remoteStringList(
    architecture.input_modalities ?? record.input_modalities,
    20,
    40,
    knownModalities,
  );
  const outputModalities = remoteStringList(
    architecture.output_modalities ?? record.output_modalities,
    20,
    40,
    knownModalities,
  );
  const contextLength = Number.isSafeInteger(record.context_length) &&
      Number(record.context_length) >= 1 &&
      Number(record.context_length) <= 100_000_000
    ? Number(record.context_length)
    : undefined;
  const supportedParameters = remoteStringList(
    record.supported_parameters,
    100,
    80,
  );
  const pricingSummary = remotePricingSummary(record.pricing);
  const metadata: ProviderCatalogModelMetadata = {
    ...(contextLength ? { contextLength } : {}),
    ...(inputModalities ? { inputModalities } : {}),
    ...(outputModalities ? { outputModalities } : {}),
    ...(pricingSummary ? { pricingSummary } : {}),
    ...(supportedParameters ? { supportedParameters } : {}),
  };
  const displayName =
    optionalRemoteString(record.name, 160) ?? providerModelId;
  const status = optionalRemoteString(record.status, 160) ?? "available";
  return {
    capability: remoteModelCapability(outputModalities),
    discoveryId: `${driver}:${providerModelId}`,
    displayName,
    ...(Object.keys(metadata).length ? { metadata } : {}),
    providerModelId,
    source: catalogModelSource(driver),
    status,
  };
}

function normalizeRemoteCatalog(
  body: Record<string, unknown>,
  driver: "openai-compatible" | "openrouter",
  apiKey: string,
) {
  if (!Array.isArray(body.data) || body.data.length > catalogMaximumModels) {
    throw new CatalogRemoteError("FORMAT");
  }
  const models = new Map<string, ProviderCatalogDiscoveredModel>();
  for (const item of body.data) {
    if (containsProfileSecret(item, apiKey)) continue;
    const model = normalizeRemoteCatalogModel(item, driver);
    if (model && !containsProfileSecret(model, apiKey)) {
      models.set(model.providerModelId, model);
    }
  }
  return [...models.values()];
}

function remoteCatalogErrorForStatus(status: number) {
  if (status === 401) return new CatalogRemoteError("AUTH");
  if (status === 403) return new CatalogRemoteError("PERMISSION");
  if (status === 429) return new CatalogRemoteError("RATE_LIMIT");
  return new CatalogRemoteError("REMOTE");
}

async function syncProfileKeyProviderCatalog(
  profile: ProviderProfile,
  fetcher: typeof fetch | undefined,
  options: ProviderCatalogSyncOptions,
) {
  if (options.actorUserId) {
    assertAccountMutationAllowed(db(), options.actorUserId);
  }
  if (!profile.apiKey) throw new CatalogSyncError("AUTH");
  if (
    profile.driver !== "openrouter" &&
    profile.driver !== "openai-compatible" &&
    profile.driver !== "multi-protocol-relay"
  ) {
    throw new CatalogSyncError("NOT_SUPPORTED");
  }
  const maximumDurationMs = options.maximumDurationMs ??
    catalogSyncMaximumDurationMs;
  if (
    !Number.isSafeInteger(maximumDurationMs) ||
    maximumDurationMs < 1 ||
    maximumDurationMs > catalogSyncMaximumDurationMs
  ) {
    throw new Error("Invalid catalog sync duration");
  }
  const deadline = performance.now() + maximumDurationMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), maximumDurationMs);
  const syncToken = randomUUID();
  let requestCount = 0;
  let syncClaimed = false;
  let requestsRecorded = false;
  let catalogDiagnostics: ProviderCatalogDiagnostics = {};
  try {
    claimProfileCatalogSync(db(), profile, syncToken);
    syncClaimed = true;
    remainingProfileCatalogSyncDurationMs(deadline, controller.signal);
    assertProfileCatalogSyncCurrent(db(), profile, syncToken);
    let models: ProviderCatalogDiscoveredModel[];
    if (profile.driver === "multi-protocol-relay") {
      try {
        const relayCatalog = await fetchRelayModelCatalog(profile, fetcher, {
          beforeRequest: () => {
            requestCount += 1;
          },
          signal: controller.signal,
          timeoutMs: remainingProfileCatalogSyncDurationMs(
            deadline,
            controller.signal,
          ),
        });
        models = relayCatalog.models;
        catalogDiagnostics = {
          capabilityCounts: relayCatalog.capabilityCounts,
          catalogSource: relayCatalog.catalogSource,
          ...(relayCatalog.fallbackReason
            ? { fallbackReason: relayCatalog.fallbackReason }
            : {}),
          rejectedModelCount: relayCatalog.rejectedModelCount,
          ...(relayCatalog.reportedModelCount !== undefined
            ? { reportedModelCount: relayCatalog.reportedModelCount }
            : {}),
        };
      } catch (error) {
        if (error instanceof RelayRemoteError) {
          throw new CatalogRemoteError(error.code);
        }
        throw error;
      }
    } else {
      const requestUrl = remoteCatalogUrl(profile);
      const requestInit = {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${profile.apiKey}`,
        },
        method: "GET",
        redirect: "error",
        signal: controller.signal,
      } satisfies RequestInit;
      let response: Response;
      if (profile.driver === "openai-compatible") {
        response = await fetchPublicHttps(requestUrl, requestInit, {
          beforeRequest: () => {
            requestCount += 1;
          },
          fetcher,
        });
      } else {
        requestCount += 1;
        response = await (fetcher ?? fetch)(requestUrl, requestInit);
      }
      if (!response.ok) throw remoteCatalogErrorForStatus(response.status);
      models = normalizeRemoteCatalog(
        await readLimitedCatalogJson(response),
        profile.driver,
        profile.apiKey,
      );
    }
    remainingProfileCatalogSyncDurationMs(deadline, controller.signal);
    assertProfileCatalogSyncCurrent(db(), profile, syncToken);
    if (!(await sameProfileCatalogRevision(profile))) {
      throw new CatalogSyncError("CONFIG_CHANGED");
    }
    const timestamp = new Date().toISOString();
    const store = db();
    if (
      profile.driver === "multi-protocol-relay" &&
      catalogDiagnostics.catalogSource === "basic-fallback"
    ) {
      const previous = snapshotRow(store, profile.id);
      const previousDiagnostics = previous
        ? parseProviderCatalogDiagnostics(previous.catalog_diagnostics)
        : {};
      if (
        previous?.catalog_model_count &&
        (previousDiagnostics.catalogSource === "enhanced" ||
          previousDiagnostics.catalogSource === "enhanced+basic")
      ) {
        // A temporary enhanced-directory outage must not downgrade a known
        // complete snapshot to the smaller compatibility-only catalog.
        throw new CatalogRemoteError("FORMAT");
      }
    }
    store.exec("BEGIN IMMEDIATE");
    try {
      remainingProfileCatalogSyncDurationMs(deadline, controller.signal);
      if (options.actorUserId) {
        assertAccountMutationAllowed(store, options.actorUserId);
      }
      const updated = store.prepare(`
        UPDATE provider_profiles
        SET
          catalog_key_status = 'valid',
          catalog_checked_at = ?,
          catalog_synced_at = ?,
          catalog_last_error_code = NULL,
          catalog_models = ?,
          catalog_endpoints = '[]',
          catalog_model_count = ?,
          catalog_endpoint_count = 0,
          catalog_control_request_count = catalog_control_request_count + ?,
          catalog_diagnostics = ?,
          catalog_sync_token = NULL
        WHERE
          id = ?
          AND driver = ?
          AND provider_configuration_version = ?
          AND catalog_sync_token = ?
      `).run(
        timestamp,
        timestamp,
        JSON.stringify(models),
        models.length,
        requestCount,
        serializeProviderCatalogDiagnostics(catalogDiagnostics),
        profile.id,
        profile.driver,
        providerConfigurationVersion(profile),
        syncToken,
      );
      if (updated.changes !== 1) {
        throw profileCatalogSyncStateError(store, profile, syncToken) ??
          new CatalogSyncError("STALE");
      }
      if (options.actorUserId) {
        audit(
          store,
          options.actorUserId,
          "provider_catalog.sync",
          profile.id,
          {
            controlPlaneRequests: requestCount,
            endpointCount: 0,
            modelCount: models.length,
          },
        );
      }
      store.exec("COMMIT");
      requestsRecorded = true;
    } catch (error) {
      store.exec("ROLLBACK");
      if (
        error instanceof AccountMutationBlockedError ||
        error instanceof CatalogRemoteError ||
        error instanceof CatalogSyncError
      ) {
        throw error;
      }
      throw new CatalogSyncPersistenceError(error);
    }
    return {
      catalog: publicCatalog(store, profile.id),
      controlPlaneRequests: requestCount,
    };
  } catch (caught) {
    if (caught instanceof AccountMutationBlockedError) throw caught;
    if (caught instanceof CatalogSyncPersistenceError) throw caught.original;
    let error: unknown = caught instanceof OutboundProxyConfigurationError
      ? new CatalogRemoteError(caught.code)
      : caught instanceof OutboundDestinationError
        ? new CatalogRemoteError(caught.code)
        : caught instanceof CatalogRemoteError ||
          caught instanceof CatalogSyncError
        ? caught
        : new CatalogRemoteError("NETWORK");
    try {
      remainingProfileCatalogSyncDurationMs(deadline, controller.signal);
    } catch (timeoutError) {
      error = timeoutError;
    }
    if (!syncClaimed) throw error;
    const store = db();
    store.exec("BEGIN IMMEDIATE");
    try {
      if (options.actorUserId) {
        assertAccountMutationAllowed(store, options.actorUserId);
      }
      if (!requestsRecorded && !(error instanceof CatalogSyncError)) {
        const updated = store.prepare(`
          UPDATE provider_profiles
          SET
            catalog_key_status = ?,
            catalog_checked_at = ?,
            catalog_last_error_code = ?,
            catalog_control_request_count = catalog_control_request_count + ?,
            catalog_sync_token = NULL
          WHERE
            id = ?
            AND driver = ?
            AND provider_configuration_version = ?
            AND catalog_sync_token = ?
        `).run(
          catalogStatusForError(error),
          new Date().toISOString(),
          catalogErrorCode(error),
          requestCount,
          profile.id,
          profile.driver,
          providerConfigurationVersion(profile),
          syncToken,
        );
        requestsRecorded = updated.changes === 1;
      }
      if (!requestsRecorded) {
        incrementControlRequests(store, profile.id, requestCount);
        requestsRecorded = true;
      }
      store.exec("COMMIT");
    } catch (persistenceError) {
      if (store.isTransaction) store.exec("ROLLBACK");
      throw persistenceError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function syncProviderCatalog(
  profileId: string,
  ownerIdOrFetcher?: string | typeof fetch,
  fetcherOrOptions?: typeof fetch | ProviderCatalogSyncOptions,
  options: ProviderCatalogSyncOptions = {},
) {
  const ownerId =
    typeof ownerIdOrFetcher === "function" ? undefined : ownerIdOrFetcher;
  if (ownerId) assertAccountMutationAllowed(db(), ownerId);
  const fetcher =
    typeof ownerIdOrFetcher === "function"
      ? ownerIdOrFetcher
      : typeof fetcherOrOptions === "function"
        ? fetcherOrOptions
        : undefined;
  const mergedOptions =
    typeof fetcherOrOptions === "function"
      ? options
      : (fetcherOrOptions ?? options);
  const syncOptions: ProviderCatalogSyncOptions = ownerId
    ? { ...mergedOptions, actorUserId: ownerId }
    : mergedOptions;
  const profile = await getProviderProfile(profileId);
  if (!profile) throw new CatalogSyncError("CONFIG_CHANGED");
  const capabilities = providerCatalogCapabilities(profile.driver);
  if (!capabilities.supportsSync) {
    throw new CatalogSyncError("NOT_SUPPORTED");
  }
  if (profile.driver === "volcengine-ark") {
    return syncArkProviderCatalog(
      profileId,
      fetcher ?? fetch,
      syncOptions,
    );
  }
  const composed = ownerId
    ? await composeExecutionProfile(db(), ownerId, profile)
    : profile;
  return syncProfileKeyProviderCatalog(composed, fetcher, syncOptions);
}

export function providerCatalogSyncErrorMessage(
  error: unknown,
  driver?: ProviderDriver,
) {
  const code = catalogErrorCode(error);
  if (code === "AUTH") {
    return driver === "volcengine-ark"
      ? "AK/SK已失效，请更新后重试"
      : "API Key已失效，请更新平台连接后重试";
  }
  if (code === "PERMISSION") {
    return driver === "volcengine-ark"
      ? "AK/SK有效，但没有读取方舟模型目录的权限"
      : "API Key可用，但没有读取模型目录的权限";
  }
  if (code === "PROXY_CONFIGURATION") {
    return "本机代理地址模式阻止目录同步，已保留上次结果";
  }
  if (code === "RATE_LIMIT") return "平台暂时限流，请稍后再同步";
  if (code === "CONFIG_CHANGED" || code === "STALE") {
    return "连接资料已变化，本次旧同步结果未保存";
  }
  if (code === "NOT_CONFIGURED") return "请先安全保存只读AK/SK";
  if (code === "NOT_SUPPORTED") {
    return "当前平台没有可同步的模型目录，请在模型中心手动配置";
  }
  if (code === "FORMAT") return "平台返回格式异常，已保留上次同步结果";
  if (code === "NETWORK") return "网络异常，已保留上次同步结果";
  return "模型目录暂时不可用，已保留上次同步结果";
}

function importableModels(
  store: DatabaseSync,
  profileId: string,
  driver: ProviderDriver,
  expectedConfigurationVersion?: number,
) {
  const row = snapshotRow(store, profileId);
  if (
    !row ||
    row.driver !== driver ||
    (expectedConfigurationVersion !== undefined &&
      Number(row.provider_configuration_version) !== expectedConfigurationVersion)
  ) {
    throw new Error("Provider profile not found");
  }
  if (
    row.catalog_key_status !== "valid" ||
    !row.catalog_checked_at ||
    !row.catalog_synced_at ||
    row.catalog_last_error_code
  ) {
    throw new Error("Provider catalog must be synchronized again before import");
  }
  return parseSnapshotModels(row.catalog_models, driver);
}

function cleanImportSelection(
  selection: ImportSelection,
  discovered: ProviderCatalogDiscoveredModel[],
) {
  const discoveryId = typeof selection.discoveryId === "string"
    ? selection.discoveryId.trim()
    : "";
  const model = discovered.find((candidate) => candidate.discoveryId === discoveryId);
  if (!model) throw new Error("Unknown discovered model");
  const requestedCapability = selection.capability as ModelCapability | undefined;
  const capability = model.capability === "unknown"
    ? requestedCapability
    : model.capability;
  if (!capabilities.includes(capability as ModelCapability)) {
    throw new Error("Model capability is required");
  }
  if (
    !model.providerModelId ||
    model.providerModelId.length > 160 ||
    !model.displayName ||
    model.displayName.length > 160
  ) {
    throw new Error("Discovered model is invalid");
  }
  const relay = model.source === "multi-protocol-relay-account-catalog";
  const requestedProtocol = selection.providerProtocol;
  const declaredRelayProtocols = model.metadata?.protocols;
  const providerProtocol = relay
    ? isProviderProtocol(requestedProtocol) && requestedProtocol !== "native"
      ? requestedProtocol
      : undefined
    : "native";
  if (
    !providerProtocol ||
    !providerProtocolSupportsCapability(
      providerProtocol,
      capability as ModelCapability,
    ) ||
    (
      relay &&
      Boolean(declaredRelayProtocols?.length) &&
      !declaredRelayProtocols?.includes(
        providerProtocol as Exclude<ProviderProtocol, "native">,
      )
    )
  ) {
    throw new Error("Model protocol is required or incompatible");
  }
  return {
    capability: capability as ModelCapability,
    model,
    providerProtocol,
  };
}

function importCatalogDrafts(
  profileId: string,
  rawSelections: unknown,
  actorUserId: string,
  expectedDriver?: ProviderDriver,
  expectedConfigurationVersion?: number,
) {
  if (!Array.isArray(rawSelections) || rawSelections.length < 1 || rawSelections.length > 100) {
    throw new Error("Invalid import selection");
  }
  const store = db();
  let imported = 0;
  let restored = 0;
  let skipped = 0;
  const timestamp = new Date().toISOString();
  store.exec("BEGIN IMMEDIATE");
  try {
    assertAccountMutationAllowed(store, actorUserId);
    const profile = store.prepare(`
      SELECT id, driver, provider_configuration_version
      FROM provider_profiles
      WHERE id = ?
    `).get(profileId) as
      | {
          driver: ProviderDriver;
          id: string;
          provider_configuration_version: number;
        }
      | undefined;
    if (
      !profile ||
      (expectedDriver && profile.driver !== expectedDriver) ||
      (expectedConfigurationVersion !== undefined &&
        Number(profile.provider_configuration_version) !==
          expectedConfigurationVersion)
    ) {
      throw new Error("Provider profile not found");
    }
    const catalogCapabilities = providerCatalogCapabilities(profile.driver);
    if (!catalogCapabilities.supportsImport) {
      throw new Error("Provider catalog import is not supported");
    }
    const discovered = importableModels(
      store,
      profileId,
      profile.driver,
      expectedConfigurationVersion,
    );
    const uniqueSelections = new Map<
      string,
      ReturnType<typeof cleanImportSelection>
    >();
    for (const raw of rawSelections) {
      if (!raw || typeof raw !== "object") {
        throw new Error("Invalid import selection");
      }
      const selection = cleanImportSelection(raw as ImportSelection, discovered);
      uniqueSelections.set(
        `${selection.model.discoveryId}:${selection.capability}:${selection.providerProtocol}`,
        selection,
      );
    }
    const maximumOrder = store.prepare(`
      SELECT COALESCE(MAX(sort_order), 0) AS maximum
      FROM node_model_bindings
    `).get() as { maximum: number };
    let sortOrder = Number(maximumOrder.maximum) + 10;
    for (const { capability, model, providerProtocol } of uniqueSelections.values()) {
      const existing = store.prepare(`
        SELECT id, archived_at, status
        FROM model_profiles
        WHERE
          provider_profile_id = ?
          AND provider_model_id = ?
          AND capability = ?
          AND provider_protocol = ?
        LIMIT 1
      `).get(profileId, model.providerModelId, capability, providerProtocol) as
        | { archived_at: string | null; id: string; status: string }
        | undefined;
      if (existing) {
        if (existing.archived_at) {
          const restoredStatus = existing.status === "published"
            ? "disabled"
            : existing.status;
          store.prepare(`
            UPDATE model_profiles
            SET archived_at = NULL, status = ?, updated_at = ?
            WHERE id = ?
          `).run(restoredStatus, timestamp, existing.id);
          store.prepare(`
            UPDATE node_model_bindings
            SET enabled = 0, is_default = 0, updated_at = ?
            WHERE model_id = ?
          `).run(timestamp, existing.id);
          audit(store, actorUserId, "model.restore", profileId, {
            capability,
            modelId: existing.id,
            providerModelId: model.providerModelId,
            providerProtocol,
            restoredStatus,
            source: "provider-catalog-import",
          });
          restored += 1;
          continue;
        }
        skipped += 1;
        continue;
      }
      const modelId = randomUUID();
      store.prepare(`
        INSERT INTO model_profiles (
          id, display_name, provider_profile_id, provider_model_id,
          provider_protocol, capability, status, default_parameters,
          cost_currency, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)
      `).run(
        modelId,
        model.displayName.slice(0, 80),
        profileId,
        model.providerModelId,
        providerProtocol,
        capability,
        JSON.stringify(knownModelParameterSchema({
          capability,
          providerDriver: profile.driver,
          providerModelId: model.providerModelId,
        })),
        profile.driver === "volcengine-ark" ? "CNY" : "USD",
        timestamp,
        timestamp,
      );
      store.prepare(`
        INSERT INTO node_model_bindings (
          node_type, model_id, enabled, is_default, sort_order,
          created_at, updated_at
        )
        VALUES (?, ?, 0, 0, ?, ?, ?)
      `).run(capability, modelId, sortOrder, timestamp, timestamp);
      sortOrder += 10;
      imported += 1;
    }
    audit(store, actorUserId, "provider_catalog.import_drafts", profileId, {
      imported,
      restored,
      skipped,
    });
    store.exec("COMMIT");
  } catch (error) {
    if (store.isTransaction) store.exec("ROLLBACK");
    throw error;
  }
  return {
    imported,
    ...(restored > 0 ? { restored } : {}),
    skipped,
  };
}

export function importArkCatalogDrafts(
  profileId: string,
  rawSelections: unknown,
  actorUserId: string,
) {
  return importCatalogDrafts(
    profileId,
    rawSelections,
    actorUserId,
    "volcengine-ark",
  );
}

export async function importProviderCatalogDrafts(
  profileId: string,
  rawSelections: unknown,
  actorUserId: string,
) {
  const lease = await acquireProviderConfigurationLease(profileId);
  try {
    const { profile } = lease;
    if (!providerCatalogCapabilities(profile.driver).supportsImport) {
      throw new Error("Provider catalog import is not supported");
    }
    return importCatalogDrafts(
      profileId,
      rawSelections,
      actorUserId,
      profile.driver,
      providerConfigurationVersion(profile),
    );
  } finally {
    lease.release();
  }
}

export async function getProviderReadOnlyDescriptor(profileId: string) {
  const profile = await getProviderProfile(profileId);
  if (!profile) throw new Error("Provider profile not found");
  if (profile.driver !== "multi-protocol-relay") {
    throw new CatalogSyncError("NOT_SUPPORTED");
  }
  return relayReadOnlyDescriptor();
}

export async function readProviderReadOnlyResource(
  profileId: string,
  resource: RelayReadOnlyResource,
  ownerIdOrOptions: string | { model?: string } = {},
  optionsOrFetcher: { model?: string } | typeof fetch = {},
  fetcher?: typeof fetch,
) {
  const ownerId =
    typeof ownerIdOrOptions === "string" ? ownerIdOrOptions : undefined;
  const mergedOptions =
    typeof ownerIdOrOptions === "string"
      ? (optionsOrFetcher as { model?: string })
      : ownerIdOrOptions;
  const effectiveFetcher =
    typeof optionsOrFetcher === "function" ? optionsOrFetcher : fetcher;
  const profile = await getProviderProfile(profileId);
  if (!profile) throw new Error("Provider profile not found");
  if (profile.driver !== "multi-protocol-relay") {
    throw new CatalogSyncError("NOT_SUPPORTED");
  }
  const composed = ownerId
    ? await composeExecutionProfile(db(), ownerId, profile)
    : profile;
  return readRelayManagementResource(
    composed,
    resource,
    mergedOptions,
    effectiveFetcher,
  );
}

export async function adminProviderCatalogApi(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const identity = requestIdentity(request);
  if (!identity || !hasPermission(identity, "manage_providers")) {
    json(response, 403, { error: "Only administrators can manage Provider catalogs" });
    return;
  }
  const path = decodedRequestPath(request).replace(
    /^\/+/, "",
  );
  const match = path.match(
    /^([a-f0-9-]{36})(?:\/(credentials|sync|import|readonly)(?:\/(balance|usage|pricing|task-status|model-detail))?)?$/i,
  );
  if (!match) {
    json(response, 404, { error: "Provider catalog endpoint not found" });
    return;
  }
  const [, profileId, action = "", resource = ""] = match;
  if (resource && action !== "readonly") {
    json(response, 404, { error: "Provider catalog endpoint not found" });
    return;
  }
  if (request.method === "GET" && !action) {
    try {
      json(response, 200, {
        ...await getProviderCatalog(profileId),
        paidGenerationRequests: 0,
      });
    } catch {
      json(response, 404, { error: "平台模型目录不存在" });
    }
    return;
  }
  if (request.method === "GET" && action === "readonly" && !resource) {
    try {
      json(response, 200, await getProviderReadOnlyDescriptor(profileId));
    } catch {
      json(response, 400, {
        available: false,
        error: "当前平台连接不支持该只读资料",
        paidGenerationRequests: 0,
        providerReadOnlyRequests: 0,
      });
    }
    return;
  }
  if (request.method === "GET" && action === "readonly" && resource) {
    const normalizedResource = resource as RelayReadOnlyResource;
    const model = new URL(request.url ?? "/", "http://127.0.0.1")
      .searchParams.get("model") ?? undefined;
    if (
      (normalizedResource === "pricing" ||
        normalizedResource === "model-detail") &&
      (!model || model.length > 2_048)
    ) {
      json(response, 400, {
        available: false,
        code: "FORMAT",
        error: "请选择需要查看的模型",
        paidGenerationRequests: 0,
        providerReadOnlyRequests: 0,
      });
      return;
    }
    try {
      json(
        response,
        200,
        await readProviderReadOnlyResource(
          profileId,
          normalizedResource,
          identity.userId,
          { model },
        ),
      );
    } catch (error) {
      json(response, 400, {
        available: false,
        code: relayReadOnlyErrorCode(error),
        error: relayReadOnlyErrorMessage(error),
        paidGenerationRequests: 0,
        providerReadOnlyRequests:
          error instanceof CatalogSyncError ? 0 : 1,
      });
    }
    return;
  }
  if (request.method === "PATCH" && action === "credentials") {
    try {
      const saved = await saveArkControlPlaneCredentials(
        profileId,
        await readJsonBody<Record<string, unknown>>(request, 64 * 1_024),
        identity.userId,
        (store) => audit(
          store,
          identity.userId,
          "provider_catalog.credentials_update",
          profileId,
        ),
      );
      json(response, 200, {
        credentials: saved,
        paidGenerationRequests: 0,
      });
    } catch (error) {
      if (error instanceof HttpRequestError) throw error;
      if (error instanceof AccountMutationBlockedError) {
        json(response, 409, { code: error.code, error: error.message });
        return;
      }
      json(response, 400, { error: "只读AK/SK配置无效" });
    }
    return;
  }
  if (request.method === "POST" && action === "sync") {
    let driver: ProviderDriver | undefined;
    try {
      const profile = await getProviderProfile(profileId);
      if (!profile) throw new CatalogSyncError("CONFIG_CHANGED");
      driver = profile.driver;
      const result = await syncProviderCatalog(
        profileId,
        identity.userId,
      );
      const catalogCapabilities = providerCatalogCapabilities(profile.driver);
      const endpointSummary = catalogCapabilities.supportsEndpoints
        ? `，${result.catalog.endpointCount} 个${catalogCapabilities.endpointLabel ?? "Endpoint"}`
        : "";
      json(response, 200, {
        ...result,
        message: `同步完成：${result.catalog.modelCount} 个${catalogCapabilities.modelLabel}${endpointSummary}。`,
        paidGenerationRequests: 0,
      });
    } catch (error) {
      if (error instanceof AccountMutationBlockedError) {
        json(response, 409, { code: error.code, error: error.message });
        return;
      }
      json(response, 400, {
        error: providerCatalogSyncErrorMessage(error, driver),
        paidGenerationRequests: 0,
      });
    }
    return;
  }
  if (request.method === "POST" && action === "import") {
    try {
      const body = await readJsonBody<{ models?: unknown }>(
        request,
        64 * 1_024,
      );
      const result = await importProviderCatalogDrafts(
        profileId,
        body.models,
        identity.userId,
      );
      const restored = "restored" in result ? Number(result.restored) : 0;
      json(response, 200, {
        ...result,
        message: restored > 0
          ? `已新增 ${result.imported} 个、恢复 ${restored} 个模型，当前保持停用；不会自动发布或发起生成。`
          : `已添加 ${result.imported} 个模型到模型中心，当前保持停用；不会自动发布或发起生成。`,
        paidGenerationRequests: 0,
      });
    } catch (error) {
      if (error instanceof HttpRequestError) throw error;
      if (error instanceof AccountMutationBlockedError) {
        json(response, 409, { code: error.code, error: error.message });
        return;
      }
      json(response, 400, {
        error: "添加模型失败，请检查选择和节点类型",
      });
    }
    return;
  }
  response.setHeader("Allow", "GET, PATCH, POST");
  json(response, 405, { error: "Method not allowed" });
}
