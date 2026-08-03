import type { ModelCapability } from "../types/modelParameters";
import {
  relayProviderProtocols,
  type ProviderProtocol,
} from "../types/relayProtocols";
import type { ProviderProfile } from "./providerProfiles";
import {
  fetchPublicHttps,
  OutboundDestinationError,
  OutboundProxyConfigurationError,
} from "./outboundNetwork";

export const relayMaximumResponseBytes = 5 * 1_024 * 1_024;
export const relayReadOnlyMaximumResponseBytes = 1 * 1_024 * 1_024;
export const relayRequestTimeoutMs = 10_000;
export const relayMaximumModels = 2_000;

export type RelayRemoteErrorCode =
  | "AUTH"
  | "FORMAT"
  | "NETWORK"
  | "PERMISSION"
  | "PROXY_CONFIGURATION"
  | "RATE_LIMIT"
  | "REMOTE";

export class RelayRemoteError extends Error {
  constructor(
    readonly code: RelayRemoteErrorCode,
    readonly status?: number,
  ) {
    super(code);
  }
}

export type RelayCatalogMetadata = {
  contextLength?: number;
  inputModalities?: string[];
  modelType?: string;
  modalities?: string[];
  outputModalities?: string[];
  pricingSummary?: string;
  protocols?: Exclude<ProviderProtocol, "native">[];
  supportedParameters?: string[];
};

export type RelayCatalogModel = {
  capability: ModelCapability | "unknown";
  discoveryId: string;
  displayName: string;
  metadata?: RelayCatalogMetadata;
  providerModelId: string;
  source: "multi-protocol-relay-account-catalog";
  status: string;
};

export type RelayCatalogResult = {
  endpoint: "basic" | "enhanced";
  models: RelayCatalogModel[];
};

export type RelayReadOnlyResource =
  | "balance"
  | "model-detail"
  | "pricing"
  | "task-status"
  | "usage";

type RelaySummaryValue =
  | boolean
  | number
  | string
  | string[]
  | Record<string, number>;

export type RelayReadOnlySummary = Record<string, RelaySummaryValue>;

export type RelayReadOnlyResult = {
  available: true;
  checkedAt: string;
  paidGenerationRequests: 0;
  parsed: boolean;
  providerReadOnlyRequests: 1;
  resource: RelayReadOnlyResource;
  summary?: RelayReadOnlySummary;
};

function isPrivateRelayHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized === "::" ||
    normalized === "::1" ||
    (normalized.includes(":") &&
      (normalized.startsWith("fc") ||
        normalized.startsWith("fd") ||
        /^fe[89ab]/.test(normalized)))
  ) {
    return true;
  }
  const parts = normalized.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) {
    return false;
  }
  const octets = parts.map(Number);
  if (octets.some((octet) => octet > 255)) return true;
  return octets[0] === 0 ||
    octets[0] === 10 ||
    octets[0] === 127 ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168);
}

function safeRelayUrl(profile: ProviderProfile, suffix: string) {
  const base = new URL(profile.baseUrl);
  const configuredPath = base.pathname.replace(/\/+$/, "");
  const apiPath = configuredPath && configuredPath !== "/"
    ? configuredPath
    : "/v1";
  const url = new URL(`${base.origin}${apiPath}${suffix}`);
  if (
    base.protocol !== "https:" ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    isPrivateRelayHostname(base.hostname) ||
    url.protocol !== "https:" ||
    url.origin !== base.origin ||
    url.username ||
    url.password ||
    url.hash ||
    (url.pathname !== apiPath && !url.pathname.startsWith(`${apiPath}/`))
  ) {
    throw new RelayRemoteError("FORMAT");
  }
  return url.toString();
}

function errorForStatus(status: number) {
  if (status === 401) return new RelayRemoteError("AUTH", status);
  if (status === 403) return new RelayRemoteError("PERMISSION", status);
  if (status === 429) return new RelayRemoteError("RATE_LIMIT", status);
  return new RelayRemoteError("REMOTE", status);
}

async function readBoundedJson(response: Response, maximumBytes: number) {
  if (!response.body) throw new RelayRemoteError("FORMAT");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximumBytes) {
      await reader.cancel();
      throw new RelayRemoteError("FORMAT");
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
  } catch (error) {
    if (error instanceof RelayRemoteError) throw error;
    throw new RelayRemoteError("FORMAT");
  }
}

export async function relayGetJson(
  profile: ProviderProfile,
  suffix: string,
  fetcher?: typeof fetch,
  options: {
    beforeRequest?: () => void;
    maximumBytes?: number;
    signal?: AbortSignal;
    timeoutMs?: number;
  } = {},
) {
  if (profile.driver !== "multi-protocol-relay") {
    throw new RelayRemoteError("FORMAT");
  }
  const timeoutMs = options.timeoutMs ?? relayRequestTimeoutMs;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 60_000
  ) {
    throw new RelayRemoteError("FORMAT");
  }
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const requestUrl = safeRelayUrl(profile, suffix);
    const response = await fetchPublicHttps(requestUrl, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${profile.apiKey}`,
      },
      method: "GET",
      redirect: "error",
      signal: controller.signal,
    }, {
      beforeRequest: options.beforeRequest,
      fetcher,
    });
    if (!response.ok) throw errorForStatus(response.status);
    return await readBoundedJson(
      response,
      options.maximumBytes ?? relayMaximumResponseBytes,
    );
  } catch (error) {
    if (error instanceof RelayRemoteError) throw error;
    if (error instanceof OutboundProxyConfigurationError) {
      throw new RelayRemoteError(error.code);
    }
    if (error instanceof OutboundDestinationError) {
      throw new RelayRemoteError(error.code);
    }
    throw new RelayRemoteError("NETWORK");
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}

function boundedString(value: unknown, maximum: number) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) return undefined;
  return normalized;
}

function containsRelaySecret(value: unknown, secret: string): boolean {
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
    return value.some((item) => containsRelaySecret(item, secret));
  }
  if (value && typeof value === "object") {
    return Object.entries(value).some(([key, item]) =>
      containsRelaySecret(key, secret) || containsRelaySecret(item, secret)
    );
  }
  return false;
}

function normalizedStringList(
  value: unknown,
  maximumItems: number,
  maximumLength: number,
) {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,|]/)
      : [];
  if (values.length > maximumItems) return undefined;
  const normalized: string[] = [];
  for (const item of values) {
    const text = boundedString(item, maximumLength)?.toLowerCase();
    if (text && !normalized.includes(text)) normalized.push(text);
  }
  return normalized.length ? normalized.sort() : undefined;
}

const modalities = new Set(["audio", "image", "text", "video"]);

function normalizedModalities(value: unknown) {
  return normalizedStringList(value, 20, 40)?.filter((item) =>
    modalities.has(item)
  );
}

function protocolForValue(value: string) {
  const token = value.trim().toLowerCase().replace(/[_.\s]+/g, "-");
  if (
    token === "openai-chat" ||
    token === "chat-completions" ||
    token === "chat/completions" ||
    token === "openai-compatible"
  ) return "openai-chat" as const;
  if (token === "openai-responses" || token === "responses") {
    return "openai-responses" as const;
  }
  if (
    token === "claude-messages" ||
    token === "anthropic-messages" ||
    token === "messages"
  ) return "claude-messages" as const;
  if (
    token === "gemini-generate-content" ||
    token === "generate-content" ||
    token === "generatecontent"
  ) return "gemini-generate-content" as const;
  if (token === "gpt-image" || token === "openai-image" || token === "images") {
    return "gpt-image" as const;
  }
  if (token === "media-generate" || token === "media-generation") {
    return "media-generate" as const;
  }
  return relayProviderProtocols.includes(
      token as Exclude<ProviderProtocol, "native">,
    )
    ? token as Exclude<ProviderProtocol, "native">
    : undefined;
}

function normalizedProtocols(record: Record<string, unknown>) {
  const raw = record.protocols ?? record.protocol ??
    record.api_protocols ?? record.api_protocol;
  const values = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw.split(/[,|]/)
      : [];
  if (values.length > 20) return undefined;
  const discovered = new Set<Exclude<ProviderProtocol, "native">>();
  for (const item of values) {
    const value = boundedString(item, 80);
    const protocol = value ? protocolForValue(value) : undefined;
    if (protocol) discovered.add(protocol);
  }
  const result = relayProviderProtocols.filter((item) => discovered.has(item));
  return result.length ? result : undefined;
}

function safePricingSummary(value: unknown) {
  if (typeof value === "string") return boundedString(value, 160);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const pricing = value as Record<string, unknown>;
  const fields = [
    ["prompt", "输入"],
    ["input", "输入"],
    ["completion", "输出"],
    ["output", "输出"],
    ["request", "请求"],
    ["image", "图片"],
    ["video", "视频"],
    ["audio", "音频"],
  ] as const;
  const parts: string[] = [];
  const usedLabels = new Set<string>();
  for (const [field, label] of fields) {
    if (usedLabels.has(label)) continue;
    const raw = pricing[field];
    const text = typeof raw === "number" && Number.isFinite(raw)
      ? String(raw)
      : boundedString(raw, 40);
    if (text && /^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) {
      parts.push(`${label} ${text}`);
      usedLabels.add(label);
    }
  }
  const currency = boundedString(pricing.currency, 20);
  const unit = boundedString(pricing.unit, 40);
  if (currency) parts.push(currency);
  if (unit) parts.push(unit);
  return parts.length ? parts.join(" · ").slice(0, 320) : undefined;
}

function capabilityFromHints(
  outputModalities: string[] | undefined,
  allModalities: string[] | undefined,
  modelType: string | undefined,
  protocols: Exclude<ProviderProtocol, "native">[] | undefined,
) {
  const outputs = outputModalities?.length ? outputModalities : allModalities;
  if (outputs?.length === 1 && modalities.has(outputs[0])) {
    return outputs[0] as ModelCapability;
  }
  const type = modelType?.toLowerCase();
  if (type) {
    if (/(?:image|图像|图片|生图)/.test(type)) return "image" as const;
    if (/(?:video|视频)/.test(type)) return "video" as const;
    if (/(?:audio|music|音频|音乐)/.test(type)) return "audio" as const;
    if (/(?:text|chat|llm|文字|文本|对话)/.test(type)) return "text" as const;
  }
  if (
    protocols?.length === 1 &&
    protocols[0] !== "media-generate"
  ) {
    return protocols[0] === "gpt-image" ? "image" as const : "text" as const;
  }
  return "unknown" as const;
}

function relayModelId(record: Record<string, unknown>) {
  return boundedString(
    record.id ?? record.model_id ?? record.model_name ?? record.model,
    2_048,
  );
}

function normalizeRelayModel(raw: unknown) {
  if (typeof raw === "string") {
    const providerModelId = boundedString(raw, 2_048);
    if (!providerModelId) return undefined;
    return {
      capability: "unknown" as const,
      discoveryId: `multi-protocol-relay:${providerModelId}`,
      displayName: providerModelId,
      providerModelId,
      source: "multi-protocol-relay-account-catalog" as const,
      status: "available",
    } satisfies RelayCatalogModel;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const providerModelId = relayModelId(record);
  if (!providerModelId) return undefined;
  const architecture =
    record.architecture && typeof record.architecture === "object" &&
      !Array.isArray(record.architecture)
      ? record.architecture as Record<string, unknown>
      : {};
  const modalityRecord =
    record.modalities && typeof record.modalities === "object" &&
      !Array.isArray(record.modalities)
      ? record.modalities as Record<string, unknown>
      : {};
  const inputModalities = normalizedModalities(
    architecture.input_modalities ?? modalityRecord.input ??
      record.input_modalities ?? record.inputModalities,
  );
  const outputModalities = normalizedModalities(
    architecture.output_modalities ?? modalityRecord.output ??
      record.output_modalities ?? record.outputModalities,
  );
  const allModalities = normalizedModalities(
    Array.isArray(record.modalities) ? record.modalities : record.modality,
  );
  const protocols = normalizedProtocols(record);
  const modelType = boundedString(
    record.type ?? record.model_type ?? record.category,
    80,
  );
  const contextCandidate = record.context_length ?? record.contextLength;
  const contextLength = Number.isSafeInteger(contextCandidate) &&
      Number(contextCandidate) >= 1 && Number(contextCandidate) <= 100_000_000
    ? Number(contextCandidate)
    : undefined;
  const supportedParameters = normalizedStringList(
    record.supported_parameters ?? record.supportedParameters,
    100,
    80,
  );
  const pricingSummary = safePricingSummary(
    record.pricing ?? record.price ?? record.pricing_hint,
  );
  const metadata: RelayCatalogMetadata = {
    ...(contextLength ? { contextLength } : {}),
    ...(inputModalities?.length ? { inputModalities } : {}),
    ...(modelType ? { modelType } : {}),
    ...(allModalities?.length ? { modalities: allModalities } : {}),
    ...(outputModalities?.length ? { outputModalities } : {}),
    ...(pricingSummary ? { pricingSummary } : {}),
    ...(protocols?.length ? { protocols } : {}),
    ...(supportedParameters?.length ? { supportedParameters } : {}),
  };
  return {
    capability: capabilityFromHints(
      outputModalities,
      allModalities,
      modelType,
      protocols,
    ),
    discoveryId: `multi-protocol-relay:${providerModelId}`,
    displayName:
      boundedString(record.display_name ?? record.displayName ?? record.name, 160) ??
      providerModelId,
    ...(Object.keys(metadata).length ? { metadata } : {}),
    providerModelId,
    source: "multi-protocol-relay-account-catalog" as const,
    status: boundedString(record.status, 160) ?? "available",
  } satisfies RelayCatalogModel;
}

function mergedStringList(
  left: string[] | undefined,
  right: string[] | undefined,
) {
  const values = [...new Set([...(left ?? []), ...(right ?? [])])].sort();
  return values.length ? values : undefined;
}

function mergeRelayModels(
  left: RelayCatalogModel,
  right: RelayCatalogModel,
): RelayCatalogModel {
  const metadata: RelayCatalogMetadata = {
    ...(Math.max(left.metadata?.contextLength ?? 0, right.metadata?.contextLength ?? 0)
      ? {
          contextLength: Math.max(
            left.metadata?.contextLength ?? 0,
            right.metadata?.contextLength ?? 0,
          ),
        }
      : {}),
    ...(mergedStringList(left.metadata?.inputModalities, right.metadata?.inputModalities)
      ? { inputModalities: mergedStringList(left.metadata?.inputModalities, right.metadata?.inputModalities) }
      : {}),
    ...([left.metadata?.modelType, right.metadata?.modelType].filter(Boolean).sort()[0]
      ? { modelType: [left.metadata?.modelType, right.metadata?.modelType].filter(Boolean).sort()[0] }
      : {}),
    ...(mergedStringList(left.metadata?.modalities, right.metadata?.modalities)
      ? { modalities: mergedStringList(left.metadata?.modalities, right.metadata?.modalities) }
      : {}),
    ...(mergedStringList(left.metadata?.outputModalities, right.metadata?.outputModalities)
      ? { outputModalities: mergedStringList(left.metadata?.outputModalities, right.metadata?.outputModalities) }
      : {}),
    ...([left.metadata?.pricingSummary, right.metadata?.pricingSummary].filter(Boolean).sort()[0]
      ? { pricingSummary: [left.metadata?.pricingSummary, right.metadata?.pricingSummary].filter(Boolean).sort()[0] }
      : {}),
    ...(
      (() => {
        const protocols = relayProviderProtocols.filter((protocol) =>
          left.metadata?.protocols?.includes(protocol) ||
          right.metadata?.protocols?.includes(protocol)
        );
        return protocols.length ? { protocols } : {};
      })()
    ),
    ...(mergedStringList(left.metadata?.supportedParameters, right.metadata?.supportedParameters)
      ? { supportedParameters: mergedStringList(left.metadata?.supportedParameters, right.metadata?.supportedParameters) }
      : {}),
  };
  const capability = capabilityFromHints(
    metadata.outputModalities,
    metadata.modalities,
    metadata.modelType,
    metadata.protocols,
  );
  const leftScore = Object.keys(left.metadata ?? {}).length;
  const rightScore = Object.keys(right.metadata ?? {}).length;
  const preferred = rightScore > leftScore
    ? right
    : leftScore > rightScore
      ? left
      : [left, right].sort((a, b) =>
          a.displayName.localeCompare(b.displayName, "en")
        )[0];
  return {
    capability,
    discoveryId: left.discoveryId,
    displayName: preferred.displayName || left.providerModelId,
    ...(Object.keys(metadata).length ? { metadata } : {}),
    providerModelId: left.providerModelId,
    source: left.source,
    status: [left.status, right.status].includes("available")
      ? "available"
      : [left.status, right.status].sort()[0],
  };
}

function normalizeRelayCatalog(
  body: Record<string, unknown>,
  key: "data" | "models",
  apiKey: string,
) {
  const raw = body[key];
  if (!Array.isArray(raw) || raw.length > relayMaximumModels) {
    throw new RelayRemoteError("FORMAT");
  }
  const deduplicated = new Map<string, RelayCatalogModel>();
  for (const item of raw) {
    const model = normalizeRelayModel(item);
    if (!model || containsRelaySecret(model, apiKey)) continue;
    const current = deduplicated.get(model.providerModelId);
    deduplicated.set(
      model.providerModelId,
      current ? mergeRelayModels(current, model) : model,
    );
  }
  return [...deduplicated.values()].sort((left, right) =>
    left.providerModelId.localeCompare(right.providerModelId, "en")
  );
}

function mayUseBasicCatalog(error: unknown) {
  return error instanceof RelayRemoteError &&
    (error.code === "FORMAT" ||
      error.code === "NETWORK" ||
      (error.code === "REMOTE" && [404, 405, 501].includes(error.status ?? 0)));
}

export async function fetchRelayModelCatalog(
  profile: ProviderProfile,
  fetcher?: typeof fetch,
  options: {
    beforeRequest?: () => void;
    signal?: AbortSignal;
    timeoutMs?: number;
  } = {},
): Promise<RelayCatalogResult> {
  try {
    const enhanced = await relayGetJson(profile, "/skills/models", fetcher, options);
    const models = normalizeRelayCatalog(enhanced, "models", profile.apiKey);
    if (models.length) {
      return {
        endpoint: "enhanced",
        models,
      };
    }
  } catch (error) {
    if (!mayUseBasicCatalog(error)) throw error;
  }
  const basic = await relayGetJson(profile, "/models", fetcher, options);
  return {
    endpoint: "basic",
    models: normalizeRelayCatalog(basic, "data", profile.apiKey),
  };
}

function nestedRecords(body: Record<string, unknown>) {
  const records = [body];
  for (const key of ["data", "result"] as const) {
    const value = body[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      records.push(value as Record<string, unknown>);
    }
  }
  return records;
}

function safeScalar(value: unknown): boolean | number | string | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return boundedString(value, 160);
}

function firstScalar(records: Record<string, unknown>[], keys: string[]) {
  for (const record of records) {
    for (const key of keys) {
      const value = safeScalar(record[key]);
      if (value !== undefined) return value;
    }
  }
  return undefined;
}

const summaryFields = [
  ["balance", ["balance", "available_balance", "availableBalance"]],
  ["currency", ["currency"]],
  ["used", ["used", "usage", "used_amount", "usedAmount"]],
  ["remaining", ["remaining", "remaining_balance", "remainingBalance"]],
  ["limit", ["limit", "quota", "total_quota", "totalQuota"]],
  ["total", ["total", "total_amount", "totalAmount"]],
  ["cost", ["cost", "amount", "total_cost", "totalCost", "price"]],
  ["requests", ["requests", "request_count", "requestCount"]],
  ["inputTokens", ["input_tokens", "inputTokens", "prompt_tokens"]],
  ["outputTokens", ["output_tokens", "outputTokens", "completion_tokens"]],
  ["totalTokens", ["total_tokens", "totalTokens"]],
  ["status", ["status"]],
  ["taskId", ["task_id", "taskId", "id"]],
  ["model", ["model", "model_name", "modelName"]],
  ["unit", ["unit"]],
] as const;

function safeGenericSummary(body: Record<string, unknown>, apiKey = "") {
  const records = nestedRecords(body);
  const summary: RelayReadOnlySummary = {};
  for (const [output, fields] of summaryFields) {
    const value = firstScalar(records, [...fields]);
    if (value !== undefined && !containsRelaySecret(value, apiKey)) {
      summary[output] = value;
    }
  }
  const list = [body.tasks, body.items, body.data, body.result].find(Array.isArray);
  if (Array.isArray(list) && list.length <= 10_000) {
    summary.itemCount = list.length;
    const counts: Record<string, number> = {};
    for (const item of list) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const status = boundedString((item as Record<string, unknown>).status, 40)
        ?.toLowerCase();
      if (
        !status ||
        containsRelaySecret(status, apiKey) ||
        Object.keys(counts).length >= 32 && !(status in counts)
      ) continue;
      counts[status] = (counts[status] ?? 0) + 1;
    }
    if (Object.keys(counts).length) summary.statusCounts = counts;
  }
  return summary;
}

function modelDetailSummary(body: Record<string, unknown>, apiKey: string) {
  const records = nestedRecords(body);
  for (const record of records) {
    const model = normalizeRelayModel(record);
    if (!model || containsRelaySecret(model, apiKey)) continue;
    const summary: RelayReadOnlySummary = {
      modelId: model.providerModelId,
      displayName: model.displayName,
      status: model.status,
      capability: model.capability,
    };
    if (model.metadata?.modelType) summary.modelType = model.metadata.modelType;
    if (model.metadata?.protocols) summary.protocols = model.metadata.protocols;
    if (model.metadata?.inputModalities) {
      summary.inputModalities = model.metadata.inputModalities;
    }
    if (model.metadata?.outputModalities) {
      summary.outputModalities = model.metadata.outputModalities;
    }
    if (model.metadata?.modalities) summary.modalities = model.metadata.modalities;
    if (model.metadata?.pricingSummary) {
      summary.pricingSummary = model.metadata.pricingSummary;
    }
    return summary;
  }
  return safeGenericSummary(body, apiKey);
}

export function relayReadOnlyDescriptor() {
  return {
    available: true as const,
    paidGenerationRequests: 0 as const,
    providerReadOnlyRequests: 0 as const,
    resources: {
      balance: { supported: true as const },
      usage: { supported: true as const },
      pricing: { requiresModel: true as const, supported: true as const },
      taskStatus: { supported: true as const },
      modelDetail: { requiresModel: true as const, supported: true as const },
    },
  };
}

export async function readRelayManagementResource(
  profile: ProviderProfile,
  resource: RelayReadOnlyResource,
  options: { model?: string } = {},
  fetcher?: typeof fetch,
): Promise<RelayReadOnlyResult> {
  const model = boundedString(options.model, 2_048);
  if ((resource === "pricing" || resource === "model-detail") && !model) {
    throw new RelayRemoteError("FORMAT");
  }
  const suffix = resource === "pricing"
    ? `/skills/models/${encodeURIComponent(model!)}/pricing`
    : resource === "model-detail"
      ? `/skills/models/${encodeURIComponent(model!)}`
      : `/skills/${resource}`;
  const body = await relayGetJson(profile, suffix, fetcher, {
    maximumBytes: relayReadOnlyMaximumResponseBytes,
  });
  const summary = resource === "model-detail"
    ? modelDetailSummary(body, profile.apiKey)
    : safeGenericSummary(body, profile.apiKey);
  return {
    available: true,
    checkedAt: new Date().toISOString(),
    paidGenerationRequests: 0,
    parsed: Object.keys(summary).length > 0,
    providerReadOnlyRequests: 1,
    resource,
    ...(Object.keys(summary).length ? { summary } : {}),
  };
}

export function relayReadOnlyErrorCode(error: unknown) {
  return error instanceof RelayRemoteError ? error.code : "NETWORK";
}

export function relayReadOnlyErrorMessage(error: unknown) {
  const code = relayReadOnlyErrorCode(error);
  if (code === "AUTH") return "API Key已失效";
  if (code === "PERMISSION") return "API Key没有读取该资料的权限";
  if (code === "PROXY_CONFIGURATION") {
    return "本机代理地址模式阻止安全读取，请调整代理设置后重试";
  }
  if (code === "RATE_LIMIT") return "平台暂时限流，请稍后重试";
  if (code === "FORMAT") return "平台返回格式暂时无法识别";
  if (code === "REMOTE") return "平台暂时不可用";
  return "网络异常，暂时无法读取";
}
