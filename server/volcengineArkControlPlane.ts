import { createHash, createHmac } from "node:crypto";

export const VOLCENGINE_ARK_CONTROL_PLANE_HOST = "open.volcengineapi.com";
export const VOLCENGINE_ARK_CONTROL_PLANE_SERVICE = "ark";
export const VOLCENGINE_ARK_CONTROL_PLANE_VERSION = "2024-01-01";
export const VOLCENGINE_ARK_CONTROL_PLANE_REGION = "cn-beijing";
export const VOLCENGINE_ARK_CONTROL_PLANE_TIMEOUT_MS = 10_000;
export const VOLCENGINE_ARK_CONTROL_PLANE_MAX_RESPONSE_BYTES =
  5 * 1_024 * 1_024;

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 100;
const HARD_MAX_PAGES = 100;
const DEFAULT_MAX_RECORDS = 2_000;
const HARD_MAX_RECORDS = 5_000;
const HARD_MAX_REQUESTS = 512;
const HARD_MAX_CREDENTIAL_SCAN_VALUES = 250_000;

const readActions = [
  "ListEndpoints",
  "ListFoundationModels",
  "ListFoundationModelVersions",
] as const;

const seedanceAssetActions = [
  "CreateVisualValidateSession",
  "GetVisualValidateResult",
  "CreateAsset",
  "GetAsset",
] as const;

const readActionSet = new Set<string>(readActions);
const seedanceAssetActionSet = new Set<string>(seedanceAssetActions);
const actionSet = new Set<string>([...readActions, ...seedanceAssetActions]);

export type VolcengineArkControlPlaneReadAction = (typeof readActions)[number];
export type VolcengineArkSeedanceAssetAction =
  (typeof seedanceAssetActions)[number];
type VolcengineArkControlPlaneAction =
  | VolcengineArkControlPlaneReadAction
  | VolcengineArkSeedanceAssetAction;

export type VolcengineArkControlPlaneErrorCode =
  | "AUTH"
  | "FORMAT"
  | "NETWORK"
  | "PERMISSION"
  | "RATE_LIMIT"
  | "REMOTE";

export class VolcengineArkControlPlaneError extends Error {
  constructor(readonly code: VolcengineArkControlPlaneErrorCode) {
    super(errorMessage(code));
    this.name = "VolcengineArkControlPlaneError";
  }
}

export type VolcengineArkControlPlaneCredentials = {
  accessKeyId: string;
  projectName?: string;
  region?: typeof VOLCENGINE_ARK_CONTROL_PLANE_REGION;
  secretAccessKey: string;
};

export type VolcengineArkFoundationModel = {
  createdAt: string | null;
  displayName: string | null;
  lifecycleStatus: string | null;
  name: string;
  primaryVersion: string | null;
  taskTypes: string[];
  updatedAt: string | null;
};

export type VolcengineArkFoundationModelVersion = {
  createdAt: string | null;
  displayName: string | null;
  id: string | null;
  lifecycleStatus: string | null;
  modelName: string;
  updatedAt: string | null;
  version: string;
};

export type VolcengineArkEndpoint = {
  createdAt: string | null;
  displayName: string | null;
  id: string;
  modelName: string | null;
  modelVersion: string | null;
  status: string | null;
  updatedAt: string | null;
};

export type VolcengineArkControlPlaneListResult<T> = {
  items: T[];
  requestCount: number;
};

export type VolcengineArkControlPlaneDiscovery = {
  endpoints: VolcengineArkEndpoint[];
  models: VolcengineArkFoundationModel[];
  requestCount: number;
  versions: VolcengineArkFoundationModelVersion[];
};

export type ArkDiscoveredCapability =
  | "audio"
  | "image"
  | "text"
  | "unknown"
  | "video";

export type ArkDiscoveredModel = {
  capability: ArkDiscoveredCapability;
  discoveryId: string;
  displayName: string;
  providerModelId: string;
  source: "volcengine-ark-control-plane";
  status: string;
};

export type ArkDiscoveredEndpoint = {
  id: string;
  name: string;
  providerModelId?: string;
  source: "volcengine-ark-control-plane";
  status: string;
};

export type ArkCatalogDiscovery = {
  endpoints: ArkDiscoveredEndpoint[];
  models: ArkDiscoveredModel[];
  requestCount: number;
};

export type VolcengineArkControlPlaneRequestMetadata = {
  action: VolcengineArkControlPlaneAction;
  requestNumber: number;
};

export type VolcengineArkControlPlaneOptions = {
  fetcher?: typeof fetch;
  includeVersions?: boolean;
  maxPages?: number;
  maxRecords?: number;
  now?: () => Date;
  onRequest?: (metadata: VolcengineArkControlPlaneRequestMetadata) => void;
  pageSize?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
};

type SafeCredentials = {
  accessKeyId: string;
  projectName?: string;
  region: typeof VOLCENGINE_ARK_CONTROL_PLANE_REGION;
  secretAccessKey: string;
};

type RequestContext = {
  credentials: SafeCredentials;
  fetcher: typeof fetch;
  maxPages: number;
  maxRecords: number;
  now: () => Date;
  onRequest?: (metadata: VolcengineArkControlPlaneRequestMetadata) => void;
  pageCount: number;
  pageSize: number;
  recordCount: number;
  requestCount: number;
  signal?: AbortSignal;
  timeoutMs: number;
};

type JsonObject = Record<string, unknown>;

function errorMessage(code: VolcengineArkControlPlaneErrorCode) {
  if (code === "AUTH") return "火山方舟控制面凭证无效";
  if (code === "PERMISSION") return "火山方舟控制面只读权限不足";
  if (code === "RATE_LIMIT") return "火山方舟控制面正在限流";
  if (code === "NETWORK") return "无法连接火山方舟控制面";
  if (code === "REMOTE") return "火山方舟控制面暂时不可用";
  return "火山方舟控制面返回格式无法识别";
}

function fail(code: VolcengineArkControlPlaneErrorCode): never {
  throw new VolcengineArkControlPlaneError(code);
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  hardMaximum: number,
) {
  const normalized = value ?? fallback;
  if (!Number.isSafeInteger(normalized) || normalized < 1 || normalized > hardMaximum) {
    fail("FORMAT");
  }
  return normalized;
}

function cleanCredentials(
  credentials: VolcengineArkControlPlaneCredentials,
): SafeCredentials {
  const accessKeyId = typeof credentials?.accessKeyId === "string"
    ? credentials.accessKeyId.trim()
    : "";
  const secretAccessKey = typeof credentials?.secretAccessKey === "string"
    ? credentials.secretAccessKey
    : "";
  const projectName = typeof credentials?.projectName === "string"
    ? credentials.projectName.trim()
    : undefined;
  if (
    accessKeyId.length < 8 ||
    accessKeyId.length > 256 ||
    secretAccessKey.length < 8 ||
    secretAccessKey.length > 4_096 ||
    (credentials?.region !== undefined &&
      credentials.region !== VOLCENGINE_ARK_CONTROL_PLANE_REGION) ||
    (projectName !== undefined &&
      (projectName.length < 1 || projectName.length > 256))
  ) {
    fail("FORMAT");
  }
  return {
    accessKeyId,
    projectName,
    region: VOLCENGINE_ARK_CONTROL_PLANE_REGION,
    secretAccessKey,
  };
}

function createContext(
  credentials: VolcengineArkControlPlaneCredentials,
  options: VolcengineArkControlPlaneOptions,
): RequestContext {
  const timeoutMs = boundedInteger(
    options.timeoutMs,
    VOLCENGINE_ARK_CONTROL_PLANE_TIMEOUT_MS,
    VOLCENGINE_ARK_CONTROL_PLANE_TIMEOUT_MS,
  );
  return {
    credentials: cleanCredentials(credentials),
    fetcher: options.fetcher ?? fetch,
    maxPages: boundedInteger(
      options.maxPages,
      DEFAULT_MAX_PAGES,
      HARD_MAX_PAGES,
    ),
    maxRecords: boundedInteger(
      options.maxRecords,
      DEFAULT_MAX_RECORDS,
      HARD_MAX_RECORDS,
    ),
    now: options.now ?? (() => new Date()),
    onRequest: options.onRequest,
    pageCount: 0,
    pageSize: boundedInteger(options.pageSize, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE),
    recordCount: 0,
    requestCount: 0,
    signal: options.signal,
    timeoutMs,
  };
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hmac(key: string | Buffer, value: string) {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

function rfc3986(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function utcTimestamp(date: Date) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) fail("FORMAT");
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function signedHeaders(
  credentials: SafeCredentials,
  action: VolcengineArkControlPlaneAction,
  body: string,
  date: Date,
) {
  if (!actionSet.has(action)) fail("FORMAT");
  const xDate = utcTimestamp(date);
  const shortDate = xDate.slice(0, 8);
  const contentType = "application/json; charset=utf-8";
  const payloadHash = sha256(body);
  const query = [
    ["Action", action],
    ["Version", VOLCENGINE_ARK_CONTROL_PLANE_VERSION],
  ].map(([key, value]) => `${rfc3986(key)}=${rfc3986(value)}`).sort().join("&");
  const canonicalHeaders = [
    `host:${VOLCENGINE_ARK_CONTROL_PLANE_HOST}`,
    `x-content-sha256:${payloadHash}`,
    `x-date:${xDate}`,
  ].join("\n") + "\n";
  const headerNames = "host;x-content-sha256;x-date";
  const canonicalRequest = [
    "POST",
    "/",
    query,
    canonicalHeaders,
    headerNames,
    payloadHash,
  ].join("\n");
  const scope = [
    shortDate,
    credentials.region,
    VOLCENGINE_ARK_CONTROL_PLANE_SERVICE,
    "request",
  ].join("/");
  const stringToSign = [
    "HMAC-SHA256",
    xDate,
    scope,
    sha256(canonicalRequest),
  ].join("\n");
  const dateKey = hmac(credentials.secretAccessKey, shortDate);
  const regionKey = hmac(dateKey, credentials.region);
  const serviceKey = hmac(regionKey, VOLCENGINE_ARK_CONTROL_PLANE_SERVICE);
  const signingKey = hmac(serviceKey, "request");
  const signature = createHmac("sha256", signingKey)
    .update(stringToSign, "utf8")
    .digest("hex");
  return {
    Authorization: `HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${headerNames}, Signature=${signature}`,
    "Content-Type": contentType,
    Host: VOLCENGINE_ARK_CONTROL_PLANE_HOST,
    "X-Content-Sha256": payloadHash,
    "X-Date": xDate,
    query,
  };
}

function asObject(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}

function firstValue(object: JsonObject, keys: readonly string[]) {
  for (const key of keys) {
    if (object[key] !== undefined) return object[key];
  }
  return undefined;
}

function safeString(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 2_048 ? normalized : null;
}

function requiredString(value: unknown) {
  const normalized = safeString(value);
  if (!normalized) fail("FORMAT");
  return normalized;
}

function safeStringList(value: unknown) {
  if (!Array.isArray(value)) return [];
  if (value.length > 100) fail("FORMAT");
  return [...new Set(value.map(safeString).filter((item): item is string => Boolean(item)))];
}

function providerErrorCode(body: JsonObject) {
  const metadata = asObject(firstValue(body, ["ResponseMetadata", "response_metadata"]));
  const nestedError = asObject(firstValue(metadata ?? {}, ["Error", "error"]));
  const directError = asObject(firstValue(body, ["Error", "error"]));
  return safeString(firstValue(nestedError ?? directError ?? {}, [
    "Code",
    "code",
    "ErrorCode",
    "error_code",
  ]));
}

function classifyProviderError(status: number, providerCode: string | null) {
  const code = providerCode?.toLowerCase() ?? "";
  if (/signature|credential|accesskey|authfailure|authentication/.test(code)) {
    return "AUTH" as const;
  }
  if (/permission|accessdenied|forbidden|unauthorizedoperation/.test(code)) {
    return "PERMISSION" as const;
  }
  if (/thrott|ratelimit|flowlimit|requestlimit|too.?many/.test(code)) {
    return "RATE_LIMIT" as const;
  }
  if (status === 401) return "AUTH" as const;
  if (status === 403) return "PERMISSION" as const;
  if (status === 429) return "RATE_LIMIT" as const;
  return "REMOTE" as const;
}

function foldedSensitiveText(value: string) {
  return value.normalize("NFKC").toLowerCase();
}

function containsCredentialEcho(
  value: unknown,
  credentials: SafeCredentials,
) {
  const needles = [credentials.accessKeyId, credentials.secretAccessKey].map(
    (credential) => ({
      exact: credential,
      folded: foldedSensitiveText(credential),
    }),
  );
  const containsNeedle = (candidate: string) => {
    if (needles.some(({ exact }) => candidate.includes(exact))) return true;
    const folded = foldedSensitiveText(candidate);
    return needles.some(({ folded: needle }) => folded.includes(needle));
  };

  // JSON itself cannot contain cycles, so an iterative walk avoids call-stack
  // exhaustion while still rejecting unreasonably wide/deep response shapes.
  const pending: unknown[] = [value];
  let examined = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    examined += 1;
    if (examined + pending.length > HARD_MAX_CREDENTIAL_SCAN_VALUES) {
      fail("FORMAT");
    }
    if (typeof current === "string") {
      if (containsNeedle(current)) return true;
      continue;
    }
    if (typeof current === "number") {
      if (containsNeedle(String(current))) return true;
      continue;
    }
    if (current === null || typeof current !== "object") continue;
    if (Array.isArray(current)) {
      if (
        examined + pending.length + current.length >
          HARD_MAX_CREDENTIAL_SCAN_VALUES
      ) {
        fail("FORMAT");
      }
      for (let index = current.length - 1; index >= 0; index -= 1) {
        pending.push(current[index]);
      }
      continue;
    }
    const object = current as JsonObject;
    const keys = Object.keys(object);
    if (
      examined + pending.length + (keys.length * 2) >
        HARD_MAX_CREDENTIAL_SCAN_VALUES
    ) {
      fail("FORMAT");
    }
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      const key = keys[index];
      examined += 1;
      if (containsNeedle(key)) return true;
      pending.push(object[key]);
    }
  }
  return false;
}

async function readLimitedJson(response: Response, credentials: SafeCredentials) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > VOLCENGINE_ARK_CONTROL_PLANE_MAX_RESPONSE_BYTES
  ) {
    try {
      await response.body?.cancel();
    } catch {
      // The fixed FORMAT error below deliberately hides stream details.
    }
    fail("FORMAT");
  }
  if (!response.body) {
    if (!response.ok) return {};
    fail("FORMAT");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > VOLCENGINE_ARK_CONTROL_PLANE_MAX_RESPONSE_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // Keep the public error fixed and credential-free.
        }
        fail("FORMAT");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof VolcengineArkControlPlaneError) throw error;
    fail("FORMAT");
  }
  const text = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))
    .toString("utf8");
  if (
    text.includes(credentials.accessKeyId) ||
    text.includes(credentials.secretAccessKey)
  ) {
    fail("FORMAT");
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (containsCredentialEcho(parsed, credentials)) fail("FORMAT");
    return asObject(parsed) ?? fail("FORMAT");
  } catch (error) {
    if (error instanceof VolcengineArkControlPlaneError) throw error;
    if (!response.ok) return {};
    fail("FORMAT");
  }
}

function linkedSignal(context: RequestContext) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (context.signal?.aborted) controller.abort();
  context.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, context.timeoutMs);
  return {
    dispose() {
      clearTimeout(timer);
      context.signal?.removeEventListener("abort", abort);
    },
    signal: controller.signal,
  };
}

async function requestJson(
  context: RequestContext,
  action: VolcengineArkControlPlaneAction,
  payload: JsonObject,
  allowedProviderErrorCodes: ReadonlySet<string> = new Set(),
) {
  if (!actionSet.has(action)) fail("FORMAT");
  if (context.requestCount >= HARD_MAX_REQUESTS) fail("FORMAT");
  let date: Date;
  try {
    date = context.now();
  } catch {
    fail("FORMAT");
  }
  const body = JSON.stringify(payload);
  if (Buffer.byteLength(body, "utf8") > 256 * 1_024) fail("FORMAT");
  const headers = signedHeaders(context.credentials, action, body, date);
  context.requestCount += 1;
  try {
    context.onRequest?.({ action, requestNumber: context.requestCount });
  } catch {
    fail("NETWORK");
  }
  const linked = linkedSignal(context);
  let response: Response;
  try {
    response = await context.fetcher(
      `https://${VOLCENGINE_ARK_CONTROL_PLANE_HOST}/?${headers.query}`,
      {
        body,
        headers: {
          Accept: "application/json",
          Authorization: headers.Authorization,
          "Content-Type": headers["Content-Type"],
          Host: headers.Host,
          "X-Content-Sha256": headers["X-Content-Sha256"],
          "X-Date": headers["X-Date"],
        },
        method: "POST",
        redirect: "error",
        signal: linked.signal,
      },
    );
  } catch {
    linked.dispose();
    fail("NETWORK");
  }
  if (!(response instanceof Response)) {
    linked.dispose();
    fail("FORMAT");
  }
  if (response.status === 401 || response.status === 429) {
    linked.dispose();
    fail(classifyProviderError(response.status, null));
  }
  let parsed: JsonObject;
  try {
    try {
      parsed = await readLimitedJson(response, context.credentials);
    } catch (error) {
      if (!response.ok && error instanceof VolcengineArkControlPlaneError) {
        fail(classifyProviderError(response.status, null));
      }
      throw error;
    }
  } finally {
    linked.dispose();
  }
  const responseErrorCode = providerErrorCode(parsed);
  if (
    !response.ok ||
    responseErrorCode && !allowedProviderErrorCodes.has(responseErrorCode)
  ) {
    fail(classifyProviderError(response.status, responseErrorCode));
  }
  return parsed;
}

export function isVolcengineArkSeedanceAssetAction(
  value: unknown,
): value is VolcengineArkSeedanceAssetAction {
  return typeof value === "string" && seedanceAssetActionSet.has(value);
}

/** Exact signed Assets API transport. It exposes only the four admitted actions. */
export async function requestVolcengineArkSeedanceAssetControlPlane(
  credentials: VolcengineArkControlPlaneCredentials,
  action: VolcengineArkSeedanceAssetAction,
  payload: Readonly<Record<string, unknown>>,
  options: VolcengineArkControlPlaneOptions & Readonly<{
    allowedProviderErrorCodes?: readonly string[];
  }> = {},
): Promise<Record<string, unknown>> {
  if (!seedanceAssetActionSet.has(action)) fail("FORMAT");
  const context = createContext(credentials, options);
  return await requestJson(
    context,
    action,
    { ...payload },
    new Set(options.allowedProviderErrorCodes ?? []),
  );
}

function consumeRecords(context: RequestContext, count: number) {
  if (!Number.isSafeInteger(count) || count < 0) fail("FORMAT");
  if (context.recordCount + count > context.maxRecords) fail("FORMAT");
  context.recordCount += count;
}

function resultItems(
  body: JsonObject,
  aliases: readonly string[],
) {
  const result = asObject(firstValue(body, ["Result", "result"]));
  if (!result) fail("FORMAT");
  const items = firstValue(result, aliases);
  if (!Array.isArray(items)) fail("FORMAT");
  const totalValue = firstValue(result, ["TotalCount", "total_count", "total"]);
  const total = totalValue === undefined ? undefined : Number(totalValue);
  if (
    total !== undefined &&
    (!Number.isSafeInteger(total) || total < 0)
  ) {
    fail("FORMAT");
  }
  return { items, total };
}

async function paginatedItems(
  context: RequestContext,
  action: VolcengineArkControlPlaneReadAction,
  aliases: readonly string[],
  pagePayload: (pageNumber: number, pageSize: number) => JsonObject,
) {
  const collected: unknown[] = [];
  let pageNumber = 1;
  while (true) {
    if (context.pageCount >= context.maxPages) fail("FORMAT");
    context.pageCount += 1;
    const response = await requestJson(
      context,
      action,
      pagePayload(pageNumber, context.pageSize),
    );
    const page = resultItems(response, aliases);
    if (page.total !== undefined && page.total > context.maxRecords) {
      fail("FORMAT");
    }
    consumeRecords(context, page.items.length);
    collected.push(...page.items);
    if (
      page.items.length === 0 ||
      (page.total !== undefined && collected.length >= page.total) ||
      page.items.length < context.pageSize
    ) {
      return collected;
    }
    pageNumber += 1;
  }
}

function normalizeModel(value: unknown): VolcengineArkFoundationModel {
  const item = asObject(value) ?? fail("FORMAT");
  const tag = asObject(firstValue(item, [
    "FoundationModelTag",
    "foundation_model_tag",
  ]));
  const taskTypes = [
    ...safeStringList(firstValue(tag ?? {}, ["TaskTypes", "task_types"])),
    ...safeStringList(firstValue(tag ?? {}, [
      "FilterTaskTypes",
      "filter_task_types",
    ])),
    ...safeStringList(firstValue(item, ["TaskTypes", "task_types"])),
  ];
  return {
    createdAt: safeString(firstValue(item, ["CreateTime", "created_at"])),
    displayName: safeString(firstValue(item, ["DisplayName", "display_name"])),
    lifecycleStatus: safeString(firstValue(item, [
      "LifecycleStatus",
      "lifecycle_status",
      "Status",
      "status",
    ])),
    name: requiredString(firstValue(item, [
      "Name",
      "name",
      "FoundationModelName",
      "foundation_model_name",
    ])),
    primaryVersion: safeString(firstValue(item, [
      "PrimaryVersion",
      "primary_version",
    ])),
    taskTypes: [...new Set(taskTypes)],
    updatedAt: safeString(firstValue(item, ["UpdateTime", "updated_at"])),
  };
}

function normalizeVersion(
  modelName: string,
  value: unknown,
): VolcengineArkFoundationModelVersion {
  const item = asObject(value) ?? fail("FORMAT");
  return {
    createdAt: safeString(firstValue(item, ["CreateTime", "created_at"])),
    displayName: safeString(firstValue(item, ["DisplayName", "display_name"])),
    id: safeString(firstValue(item, ["Id", "ID", "id"])),
    lifecycleStatus: safeString(firstValue(item, [
      "LifecycleStatus",
      "lifecycle_status",
      "Status",
      "status",
    ])),
    modelName,
    updatedAt: safeString(firstValue(item, ["UpdateTime", "updated_at"])),
    version: requiredString(firstValue(item, [
      "Version",
      "version",
      "ModelVersion",
      "model_version",
      "Name",
      "name",
    ])),
  };
}

function normalizeEndpoint(value: unknown): VolcengineArkEndpoint {
  const item = asObject(value) ?? fail("FORMAT");
  const modelReference = asObject(firstValue(item, [
    "ModelReference",
    "model_reference",
  ]));
  const model = asObject(firstValue(modelReference ?? {}, [
    "FoundationModel",
    "foundation_model",
  ])) ?? asObject(firstValue(item, [
    "FoundationModel",
    "foundation_model",
    "Model",
    "model",
  ]));
  return {
    createdAt: safeString(firstValue(item, ["CreateTime", "created_at"])),
    displayName: safeString(firstValue(item, [
      "Name",
      "name",
      "EndpointName",
      "endpoint_name",
    ])),
    id: requiredString(firstValue(item, [
      "Id",
      "ID",
      "id",
      "EndpointId",
      "EndpointID",
      "endpoint_id",
    ])),
    modelName: safeString(firstValue(item, [
      "FoundationModelName",
      "foundation_model_name",
    ])) ?? safeString(firstValue(model ?? {}, ["Name", "name"])),
    modelVersion: safeString(firstValue(item, [
      "FoundationModelVersion",
      "foundation_model_version",
      "ModelVersion",
      "model_version",
    ])) ?? safeString(firstValue(model ?? {}, [
      "ModelVersion",
      "model_version",
      "Version",
      "version",
    ])),
    status: safeString(firstValue(item, ["Status", "status"])),
    updatedAt: safeString(firstValue(item, ["UpdateTime", "updated_at"])),
  };
}

function modelCapability(model: VolcengineArkFoundationModel) {
  const searchable = `${model.name} ${model.taskTypes.join(" ")}`.toLowerCase();
  if (/video|text.?to.?video|image.?to.?video|seedance/.test(searchable)) {
    return "video" as const;
  }
  if (/image|text.?to.?image|seedream/.test(searchable)) {
    return "image" as const;
  }
  if (/audio|speech|voice|music/.test(searchable)) return "audio" as const;
  if (/text|chat|language|embedding|doubao|seed/.test(searchable)) {
    return "text" as const;
  }
  return "unknown" as const;
}

function primaryProviderModelId(model: VolcengineArkFoundationModel) {
  if (!model.primaryVersion) return model.name;
  return model.name.endsWith(`-${model.primaryVersion}`)
    ? model.name
    : `${model.name}-${model.primaryVersion}`;
}

function versionProviderModelId(
  model: VolcengineArkFoundationModel,
  version: VolcengineArkFoundationModelVersion,
) {
  return model.name.endsWith(`-${version.version}`)
    ? model.name
    : `${model.name}-${version.version}`;
}

async function listModelsWithContext(context: RequestContext) {
  const raw = await paginatedItems(
    context,
    "ListFoundationModels",
    ["Items", "items", "FoundationModels", "foundation_models"],
    (pageNumber, pageSize) => ({
      PageNumber: pageNumber,
      PageSize: pageSize,
    }),
  );
  const models = new Map<string, VolcengineArkFoundationModel>();
  for (const item of raw) {
    const model = normalizeModel(item);
    if (!models.has(model.name)) models.set(model.name, model);
  }
  return [...models.values()];
}

async function listVersionsWithContext(
  context: RequestContext,
  modelName: string,
) {
  const normalizedName = requiredString(modelName);
  const raw = await paginatedItems(
    context,
    "ListFoundationModelVersions",
    [
      "Items",
      "items",
      "Versions",
      "versions",
      "FoundationModelVersions",
      "foundation_model_versions",
    ],
    (pageNumber, pageSize) => ({
      FoundationModelName: normalizedName,
      PageNumber: pageNumber,
      PageSize: pageSize,
    }),
  );
  const versions = new Map<string, VolcengineArkFoundationModelVersion>();
  for (const item of raw) {
    const version = normalizeVersion(normalizedName, item);
    if (!versions.has(version.version)) versions.set(version.version, version);
  }
  return [...versions.values()];
}

async function listEndpointsWithContext(context: RequestContext) {
  const raw = await paginatedItems(
    context,
    "ListEndpoints",
    ["Items", "items", "Endpoints", "endpoints"],
    (pageNumber, pageSize) => ({
      PageNumber: pageNumber,
      PageSize: pageSize,
      ...(context.credentials.projectName
        ? { ProjectName: context.credentials.projectName }
        : {}),
      SortBy: "UpdateTime",
      SortOrder: "Desc",
    }),
  );
  const endpoints = new Map<string, VolcengineArkEndpoint>();
  for (const item of raw) {
    const endpoint = normalizeEndpoint(item);
    if (!endpoints.has(endpoint.id)) endpoints.set(endpoint.id, endpoint);
  }
  return [...endpoints.values()];
}

export function isVolcengineArkControlPlaneReadAction(
  value: unknown,
): value is VolcengineArkControlPlaneReadAction {
  return typeof value === "string" && readActionSet.has(value);
}

export async function listVolcengineArkFoundationModels(
  credentials: VolcengineArkControlPlaneCredentials,
  options: VolcengineArkControlPlaneOptions = {},
): Promise<VolcengineArkControlPlaneListResult<VolcengineArkFoundationModel>> {
  const context = createContext(credentials, options);
  return {
    items: await listModelsWithContext(context),
    requestCount: context.requestCount,
  };
}

export async function listVolcengineArkFoundationModelVersions(
  credentials: VolcengineArkControlPlaneCredentials,
  modelName: string,
  options: VolcengineArkControlPlaneOptions = {},
): Promise<
  VolcengineArkControlPlaneListResult<VolcengineArkFoundationModelVersion>
> {
  const context = createContext(credentials, options);
  return {
    items: await listVersionsWithContext(context, modelName),
    requestCount: context.requestCount,
  };
}

export async function listVolcengineArkEndpoints(
  credentials: VolcengineArkControlPlaneCredentials,
  options: VolcengineArkControlPlaneOptions = {},
): Promise<VolcengineArkControlPlaneListResult<VolcengineArkEndpoint>> {
  const context = createContext(credentials, options);
  return {
    items: await listEndpointsWithContext(context),
    requestCount: context.requestCount,
  };
}

export async function discoverVolcengineArkControlPlane(
  credentials: VolcengineArkControlPlaneCredentials,
  options: VolcengineArkControlPlaneOptions = {},
): Promise<VolcengineArkControlPlaneDiscovery> {
  const context = createContext(credentials, options);
  const models = await listModelsWithContext(context);
  const versions: VolcengineArkFoundationModelVersion[] = [];
  if (options.includeVersions !== false) {
    for (const model of models) {
      versions.push(...await listVersionsWithContext(context, model.name));
    }
  }
  const endpoints = await listEndpointsWithContext(context);
  return {
    endpoints,
    models,
    requestCount: context.requestCount,
    versions,
  };
}

export const syncVolcengineArkControlPlane = discoverVolcengineArkControlPlane;

export type ArkControlPlaneCredentialsInput =
  VolcengineArkControlPlaneCredentials;
export { VolcengineArkControlPlaneError as ArkControlPlaneError };

export async function discoverArkCatalog(
  credentials: ArkControlPlaneCredentialsInput,
  options: VolcengineArkControlPlaneOptions = {},
): Promise<ArkCatalogDiscovery> {
  const context = createContext(credentials, options);
  const foundationModels = await listModelsWithContext(context);
  const discoveredModels = new Map<string, ArkDiscoveredModel>();
  for (const model of foundationModels) {
    const versions = options.includeVersions === false
      ? []
      : await listVersionsWithContext(context, model.name);
    if (versions.length === 0) {
      const providerModelId = primaryProviderModelId(model);
      discoveredModels.set(providerModelId, {
        capability: modelCapability(model),
        discoveryId: `foundation:${model.name}:${model.primaryVersion ?? "primary"}`,
        displayName: model.displayName ?? model.name,
        providerModelId,
        source: "volcengine-ark-control-plane",
        status: model.lifecycleStatus ?? "unknown",
      });
      continue;
    }
    for (const version of versions) {
      const providerModelId = versionProviderModelId(model, version);
      if (discoveredModels.has(providerModelId)) continue;
      discoveredModels.set(providerModelId, {
        capability: modelCapability(model),
        discoveryId: `foundation:${model.name}:${version.version}`,
        displayName: version.displayName ?? model.displayName ?? providerModelId,
        providerModelId,
        source: "volcengine-ark-control-plane",
        status: version.lifecycleStatus ?? model.lifecycleStatus ?? "unknown",
      });
    }
  }
  const rawEndpoints = await listEndpointsWithContext(context);
  return {
    endpoints: rawEndpoints.map((endpoint) => ({
      id: endpoint.id,
      name: endpoint.displayName ?? endpoint.id,
      ...(endpoint.modelName
        ? {
            providerModelId: endpoint.modelVersion &&
                !endpoint.modelName.endsWith(`-${endpoint.modelVersion}`)
              ? `${endpoint.modelName}-${endpoint.modelVersion}`
              : endpoint.modelName,
          }
        : {}),
      source: "volcengine-ark-control-plane" as const,
      status: endpoint.status ?? "unknown",
    })),
    models: [...discoveredModels.values()],
    requestCount: context.requestCount,
  };
}

export const syncArkCatalog = discoverArkCatalog;
