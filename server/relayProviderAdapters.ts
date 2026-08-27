import {
  providerProtocolSupportsCapability,
  type ProviderProtocol,
} from "../types/relayProtocols";
import {
  TextGenerationProviderError,
  type TextGenerationProvider,
} from "./generationProvider";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  createAliyunOssObjectKey,
  createPrivateAliyunOssReadUrl,
  deletePrivateAliyunOssObject,
  uploadPrivateAliyunOssObject,
} from "./aliyunOss";
import {
  compensateMediaPublication,
  markExternalMediaPublicationReady,
  mediaPublicationStagingPath,
  reserveMediaPublication,
  stageMediaPublication,
  type MediaPublicationReservation,
} from "./mediaPublicationService";
import {
  StorageConfigurationBusyError,
  type AliyunStorageProfile,
  withReadableStorageProfileReservation,
} from "./secureStorageProfiles";
import type { DestinationResolver } from "./outboundNetwork";
import {
  fetchPublicHttps,
  OutboundDestinationError,
} from "./outboundNetwork";
import { providerRequestTimeoutMsByOperation } from "./providerRequestDeadline";
import {
  compileModelContractPoll,
  compileModelExecutionContract,
} from "./modelExecutionContractCompiler";
import type { ModelExecutionContract } from "../types/modelExecutionContracts";

export type RelayCapability = "audio" | "image" | "text" | "video";

export type RelayTextProviderProtocol = Extract<
  ProviderProtocol,
  | "openai-chat"
  | "openai-responses"
  | "claude-messages"
  | "gemini-generate-content"
>;

export type RelayProviderConnection = Readonly<{
  apiKey: string;
  baseUrl: string;
}>;

export type RelayTextMessage = Readonly<{
  role: "assistant" | "user";
  text: string;
}>;

export type RelayTextContextInput =
  | Readonly<{
      kind: "text";
      text: string;
    }>
  | Readonly<{
      kind: "audio" | "image" | "video";
      mimeType: string;
      /**
       * Materialized only at execution time. This may be an HTTPS signed URL
       * or a data URL and must never be copied into a durable snapshot.
       */
      transientUrl: string;
    }>;

export type RelayTextRequest = Readonly<{
  capability: "text";
  contextInputs?: readonly RelayTextContextInput[];
  instructions?: string;
  maxOutputTokens?: number;
  messages: readonly RelayTextMessage[];
  model: string;
  providerProtocol: RelayTextProviderProtocol;
  temperature?: number;
}>;

export type RelayGptImageRequest = Readonly<{
  background?: "transparent";
  capability: "image";
  count?: number;
  inputImages?: readonly string[];
  maskImage?: string;
  model: string;
  operation: "edit" | "generation";
  prompt: string;
  providerProtocol: "gpt-image";
  quality?: "auto" | "high" | "low" | "medium";
  responseFormat?: "b64_json" | "url";
  size?: string;
}>;

export type RelayMediaParamPrimitive = boolean | number | string;
export type RelayMediaParamValue =
  | RelayMediaParamPrimitive
  | readonly RelayMediaParamPrimitive[];

export type RelayMediaGenerateRequest = Readonly<{
  capability: Exclude<RelayCapability, "text">;
  model: string;
  params: Readonly<Record<string, RelayMediaParamValue>>;
  prompt: string;
  providerProtocol: "media-generate";
}>;

export type RelayProviderRequest =
  | RelayGptImageRequest
  | RelayMediaGenerateRequest
  | RelayTextRequest;

export type RelayProviderUsage = Readonly<{
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}>;

export type RelayTextResult = Readonly<{
  capability: "text";
  providerProtocol: RelayTextProviderProtocol;
  state: "success";
  text: string;
  usage?: RelayProviderUsage;
}>;

/**
 * URL outputs are deliberately marked transient. They may be short-lived or
 * signed and must be copied into the project's private media store before any
 * durable task, node or history record is updated.
 */
export type RelayTransientMediaOutput =
  | Readonly<{
      bytes: Uint8Array;
      kind: "image";
      mimeType: string;
      transport: "bytes";
    }>
  | Readonly<{
      kind: Exclude<RelayCapability, "text">;
      mimeType?: string;
      transientUrl: string;
      transport: "transient-url";
    }>;

export type RelayImageResult = Readonly<{
  capability: "image";
  externalTaskId?: string;
  outputs: readonly RelayTransientMediaOutput[];
  providerProtocol: "gpt-image";
  state: "success";
}>;

export type RelayMediaSubmission = Readonly<{
  capability: Exclude<RelayCapability, "text">;
  externalTaskId: string;
  externalTaskIds: readonly string[];
  providerProtocol: "media-generate";
  state: "queued";
}>;

export type RelayProviderResult =
  | RelayImageResult
  | RelayMediaSubmission
  | RelayTextResult;

export type RelayMediaTaskSnapshot =
  | Readonly<{
      capability: Exclude<RelayCapability, "text">;
      progress?: number;
      providerProtocol: "media-generate";
      state: "queued" | "running";
    }>
  | Readonly<{
      capability: Exclude<RelayCapability, "text">;
      code: "REMOTE";
      message: string;
      providerProtocol: "media-generate";
      refunded?: boolean;
      state: "failed";
    }>
  | Readonly<{
      capability: Exclude<RelayCapability, "text">;
      outputs: readonly RelayTransientMediaOutput[];
      providerCostUnits?: number;
      providerProtocol: "media-generate";
      state: "success";
    }>;

export type RelayProviderErrorCode =
  | "AUTH"
  | "CANCELLED"
  | "FORMAT"
  | "NETWORK"
  | "PERMISSION"
  | "PROVIDER_REQUEST_FAILED"
  | "PROVIDER_RESULT_FORMAT"
  | "PROXY_CONFIGURATION"
  | "RATE_LIMIT"
  | "REFERENCE_SIGN_FAILED"
  | "REFERENCE_STORAGE_BUSY"
  | "REFERENCE_UPLOAD_FAILED"
  | "REMOTE"
  | "TIMEOUT";

const errorMessages: Record<RelayProviderErrorCode, string> = {
  AUTH: "中转站API Key无效或已失效，请由管理员更新平台连接",
  CANCELLED: "已停止本地等待；中转站任务可能仍在运行",
  FORMAT: "中转站请求或响应格式无法安全识别",
  NETWORK: "无法连接中转站",
  PERMISSION: "当前API Key没有所选模型或接口权限",
  PROVIDER_REQUEST_FAILED:
    "已向模型提交，但请求未完成；为避免重复扣费，本次不会自动重提",
  PROVIDER_RESULT_FORMAT:
    "模型已响应，但结果格式无法安全识别；本次不会自动重提",
  PROXY_CONFIGURATION: "本机代理地址模式阻止安全连接，请管理员检查代理设置",
  RATE_LIMIT: "中转站正在限流，请稍后再试",
  REFERENCE_SIGN_FAILED: "参考图临时链接创建失败，本次未向模型提交",
  REFERENCE_STORAGE_BUSY: "参考图临时存储繁忙，本次未向模型提交",
  REFERENCE_UPLOAD_FAILED: "参考图临时上传失败，本次未向模型提交",
  REMOTE: "中转站暂时无法完成请求",
  TIMEOUT: "等待中转站响应超时；异步任务可能仍在运行",
};

export class RelayProviderError extends Error {
  constructor(
    readonly code: RelayProviderErrorCode,
    readonly providerTaskMayStillRun = false,
    message?: string,
    readonly statusCode?: number,
  ) {
    super(message || errorMessages[code]);
    this.name = "RelayProviderError";
  }
}

export type RelayProviderExecution = Readonly<{
  beforeProviderRequest?: () => void;
  fetcher?: typeof fetch;
  mediaLifecycle?: Readonly<{ ownerId: string }>;
  onProviderResponseEvidence?: (evidence: RelayProviderResponseEvidence) => void;
  /**
   * TTL for reference URLs materialized during preparation. Asynchronous
   * submissions keep references alive until polling finishes, so callers that
   * submit async must pass a TTL that covers the polling window.
   */
  referenceUrlTtlSeconds?: number;
  resolver?: DestinationResolver;
  signal?: AbortSignal;
  temporaryImageObjectStore?: RelayTemporaryImageObjectStore;
  timeoutMs?: number;
  usePinnedTransport?: boolean;
}>;

export type RelayProviderResponseEvidence = Readonly<{
  contentType?: string;
  failureStage?: string;
  fieldPaths: readonly string[];
  httpStatus?: number;
  providerRequestId?: string;
  responseBytes?: number;
  structureHash?: string;
}>;

export type RelayTemporaryImageObjectStore = Readonly<{
  createReadUrl: typeof createPrivateAliyunOssReadUrl;
  deleteObject: typeof deletePrivateAliyunOssObject;
  uploadObject: typeof uploadPrivateAliyunOssObject;
}>;

/**
 * A transient, in-memory GPT Image request whose local data references have
 * already been materialized. Signed URLs must never be persisted. Cleanup is
 * idempotent and retains the existing publication journal when object deletion
 * cannot be completed immediately.
 */
export type PreparedRelayGptImageRequest = Readonly<{
  cleanup: () => Promise<void>;
  request: RelayGptImageRequest;
}>;

const defaultTemporaryImageObjectStore: RelayTemporaryImageObjectStore = {
  createReadUrl: createPrivateAliyunOssReadUrl,
  deleteObject: deletePrivateAliyunOssObject,
  uploadObject: uploadPrivateAliyunOssObject,
};

export const relayMediaCancellationBoundary = Object.freeze({
  localAbortBehavior: "stop-local-request-and-polling-only" as const,
  providerTaskMayStillRun: true,
  supportsProviderCancel: false,
});

const textResponseLimitBytes = 8 * 1024 * 1024;
const mediaResponseLimitBytes = 50 * 1024 * 1024;
const mediaRequestLimitBytes = 50 * 1024 * 1024;
const textRequestLimitBytes = 2 * 1024 * 1024;
const maxDecodedImageBytes = 30 * 1024 * 1024;
const modelPattern = /^[a-z0-9][a-z0-9._:/-]{0,199}$/i;
const taskIdPattern = /^[a-z0-9][a-z0-9._:-]{0,159}$/i;
const sizePattern = /^(?:auto|\d{2,5}x\d{2,5})$/;
const forbiddenParamName = /(?:api.?key|authorization|credential|password|secret|token|notify.?url)/i;

// GPT Image's synchronous edit endpoint regularly needs longer than the
// generic JSON request window, especially when it has to fetch a reference
// image and return a base64 payload. Keep it on the shared Provider submit
// deadline so a slow, valid response is not cut off at the old 120s default.
export const relayGptImageRequestTimeoutMs =
  providerRequestTimeoutMsByOperation.submit;
const mediaParamNamesByCapability = {
  audio: new Set([
    "audioMode",
    "audio_mode",
    "context_audio_url",
    "context_image_url",
    "context_video_url",
    "duration",
    "emotion",
    "emotion_scale",
    "format",
    "generation_mode",
    "inputMode",
    "input_mode",
    "instrumental",
    "lyrics",
    "lyricsMode",
    "lyrics_mode",
    "make_instrumental",
    "musicGenerationMode",
    "music_generation_mode",
    "outputCount",
    "output_count",
    "reference_audio_url",
    "reference_image_url",
    "reference_video_url",
    "sample_rate",
    "bitrate",
    "speaker",
    "speech_rate",
    "streamPlayback",
    "stream_playback",
    "subject_audio_url",
    "subject_image_url",
    "subject_video_url",
    "vocalGender",
    "vocal_gender",
    "mv",
  ]),
  image: new Set([
    "aspectRatio",
    "aspect_ratio",
    "background",
    "cameraMovement",
    "camera_movement",
    "context_image_url",
    "groupMode",
    "group_mode",
    "image",
    "image_url",
    "images",
    "imageSize",
    "inputMode",
    "input_mode",
    "lens",
    "mask",
    "n",
    "outputCount",
    "output_count",
    "quality",
    "reference_image_url",
    "resolution",
    "response_format",
    "size",
    "style",
    "subject_image_url",
  ]),
  video: new Set([
    "aspectRatio",
    "aspect_ratio",
    "context_audio_url",
    "context_image_url",
    "context_video_url",
    "duration",
    "first_frame_url",
    "generateAudio",
    "generate_audio",
    "images",
    "inputMode",
    "input_mode",
    "last_frame_url",
    "multiShot",
    "multi_shot",
    "mode",
    "outputCount",
    "output_count",
    "reference_audio_url",
    "reference_image_url",
    "reference_video_url",
    "resolution",
    "subject_audio_url",
    "subject_image_url",
    "subject_video_url",
  ]),
} as const satisfies Record<Exclude<RelayCapability, "text">, ReadonlySet<string>>;
const contextMimeTypes = {
  audio: new Set(["audio/aac", "audio/mp4", "audio/mpeg", "audio/wav"]),
  image: new Set(["image/gif", "image/jpeg", "image/png", "image/webp"]),
  video: new Set(["video/mp4", "video/quicktime", "video/webm"]),
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanConnection(connection: RelayProviderConnection) {
  if (
    typeof connection.apiKey !== "string" ||
    !connection.apiKey ||
    connection.apiKey.length > 8_192 ||
    /[\r\n\0]/.test(connection.apiKey)
  ) {
    throw new RelayProviderError("FORMAT");
  }
  let parsed: URL;
  try {
    parsed = new URL(connection.baseUrl);
  } catch {
    throw new RelayProviderError("FORMAT");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new RelayProviderError("FORMAT");
  }
  const pathname = parsed.pathname.replace(/\/+$/, "").replace(/\/v1$/i, "");
  parsed.pathname = pathname || "/";
  return {
    apiKey: connection.apiKey,
    apiRoot: parsed.toString().replace(/\/$/, ""),
  };
}

function assertModel(model: string) {
  if (typeof model !== "string" || !modelPattern.test(model)) {
    throw new RelayProviderError("FORMAT");
  }
  return model;
}

function assertText(value: string, maximum: number) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maximum ||
    /\0/.test(value)
  ) {
    throw new RelayProviderError("FORMAT");
  }
  return value.trim();
}

function optionalTokenCount(value: number | undefined) {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 1 || value > 1_000_000) {
    throw new RelayProviderError("FORMAT");
  }
  return value;
}

function optionalTemperature(value: number | undefined) {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value < 0 || value > 2) {
    throw new RelayProviderError("FORMAT");
  }
  return value;
}

function optionalUsageNumber(value: unknown) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : undefined;
}

function usageFromValues(input: unknown, output: unknown, total: unknown) {
  const inputTokens = optionalUsageNumber(input);
  const outputTokens = optionalUsageNumber(output);
  const totalTokens = optionalUsageNumber(total) ?? (
    inputTokens !== undefined && outputTokens !== undefined
      ? inputTokens + outputTokens
      : undefined
  );
  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    totalTokens === undefined
  ) return undefined;
  return { inputTokens, outputTokens, totalTokens } satisfies RelayProviderUsage;
}

function requestHeaders(apiKey: string, protocol: ProviderProtocol) {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    ...(protocol === "claude-messages"
      ? { "anthropic-version": "2023-06-01" }
      : {}),
  };
}

function remoteError(status: number) {
  if (status === 401) return new RelayProviderError("AUTH", false, undefined, status);
  if (status === 403) return new RelayProviderError("PERMISSION", false, undefined, status);
  if (status === 429) return new RelayProviderError("RATE_LIMIT", false, undefined, status);
  return new RelayProviderError("REMOTE", false, undefined, status);
}

async function providerErrorText(response: Response) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 4_096) {
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  const text = Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk)),
  ).toString("utf8");
  try {
    const body = JSON.parse(text) as {
      error?: { message?: unknown };
      message?: unknown;
    };
    const message = typeof body.error?.message === "string"
      ? body.error.message
      : typeof body.message === "string"
        ? body.message
        : "";
    return message.replace(/\s+/g, " ").trim().slice(0, 400);
  } catch {
    return text.replace(/\s+/g, " ").trim().slice(0, 400);
  }
}

async function readLimitedJson(response: Response, maximumBytes: number) {
  const declared = Number(response.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > maximumBytes) {
    throw new RelayProviderError("FORMAT");
  }
  if (!response.body) throw new RelayProviderError("FORMAT");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximumBytes) {
      await reader.cancel();
      throw new RelayProviderError("FORMAT");
    }
    chunks.push(value);
  }
  try {
    const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
    return {
      body: JSON.parse(bytes.toString("utf8")) as unknown,
      responseBytes: bytes.byteLength,
    };
  } catch {
    throw new RelayProviderError("FORMAT");
  }
}

function responseStructure(value: unknown) {
  const paths: string[] = [];
  const visit = (item: unknown, path: string, depth: number) => {
    if (paths.length >= 128 || depth > 6) return;
    if (Array.isArray(item)) {
      paths.push(`${path || "$"}[]`);
      if (item.length) visit(item[0], `${path || "$"}[]`, depth + 1);
      return;
    }
    if (isRecord(item)) {
      for (const key of Object.keys(item).sort().slice(0, 64)) {
        const next = path ? `${path}.${key}` : key;
        paths.push(next);
        visit(item[key], next, depth + 1);
      }
      return;
    }
    paths.push(`${path || "$"}:${item === null ? "null" : typeof item}`);
  };
  visit(value, "", 0);
  return [...new Set(paths)].sort();
}

function cleanResponseHeader(value: string | null) {
  const normalized = value?.replace(/[^A-Za-z0-9._:/+;= -]/g, "").trim();
  return normalized ? normalized.slice(0, 160) : undefined;
}

async function relayJsonRequest(input: {
  body?: unknown;
  connection: RelayProviderConnection;
  execution: RelayProviderExecution;
  maximumRequestBytes: number;
  maximumResponseBytes: number;
  method: "GET" | "POST";
  networkFailureMayStillRun?: boolean;
  path: string;
  protocol: ProviderProtocol;
  providerTaskMayStillRun?: boolean;
}) {
  const { apiKey, apiRoot } = cleanConnection(input.connection);
  if (input.execution.signal?.aborted) {
    throw new RelayProviderError(
      "CANCELLED",
      Boolean(input.providerTaskMayStillRun),
    );
  }
  const serializedBody = input.body === undefined
    ? undefined
    : JSON.stringify(input.body);
  if (
    serializedBody !== undefined &&
    Buffer.byteLength(serializedBody, "utf8") > input.maximumRequestBytes
  ) {
    throw new RelayProviderError("FORMAT");
  }
  const timeoutMs = Math.max(
    1,
    Math.min(input.execution.timeoutMs ?? 120_000, 10 * 60_000),
  );
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  input.execution.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const requestUrl = `${apiRoot}${input.path}`;
    if (input.execution.signal?.aborted || controller.signal.aborted) {
      throw new RelayProviderError(
        "CANCELLED",
        Boolean(input.providerTaskMayStillRun),
      );
    }
    const response = await fetchPublicHttps(requestUrl, {
      body: serializedBody,
      headers: requestHeaders(apiKey, input.protocol),
      method: input.method,
      redirect: "error",
      signal: controller.signal,
    }, {
      beforeRequest: input.execution.beforeProviderRequest,
      fetcher: input.execution.usePinnedTransport
        ? undefined
        : input.execution.fetcher,
      resolver: input.execution.resolver,
    });
    const baseEvidence = {
      contentType: cleanResponseHeader(response.headers.get("content-type")),
      fieldPaths: [] as readonly string[],
      httpStatus: response.status,
      providerRequestId: cleanResponseHeader(
        response.headers.get("x-request-id") ??
          response.headers.get("x-trace-id") ??
          response.headers.get("request-id"),
      ),
    };
    if (!response.ok) {
      input.execution.onProviderResponseEvidence?.({
        ...baseEvidence,
        failureStage: "http-status",
        responseBytes: Number(response.headers.get("content-length")) || undefined,
      });
      const providerText = await providerErrorText(response);
      const error = remoteError(response.status);
      throw providerText
        ? new RelayProviderError(
            error.code,
            error.providerTaskMayStillRun,
            providerText,
            error.statusCode,
          )
        : error;
    }
    const parsed = await readLimitedJson(response, input.maximumResponseBytes);
    const fieldPaths = responseStructure(parsed.body);
    input.execution.onProviderResponseEvidence?.({
      ...baseEvidence,
      fieldPaths,
      responseBytes: parsed.responseBytes,
      structureHash: createHash("sha256")
        .update(JSON.stringify(fieldPaths))
        .digest("hex"),
    });
    return parsed.body;
  } catch (error) {
    if (error instanceof RelayProviderError) throw error;
    if (error instanceof OutboundDestinationError) {
      throw new RelayProviderError(error.code);
    }
    if (input.execution.signal?.aborted) {
      throw new RelayProviderError(
        "CANCELLED",
        Boolean(input.providerTaskMayStillRun),
      );
    }
    if (timedOut || controller.signal.aborted) {
      throw new RelayProviderError(
        "TIMEOUT",
        Boolean(input.providerTaskMayStillRun),
      );
    }
    throw new RelayProviderError(
      "NETWORK",
      Boolean(input.networkFailureMayStillRun),
    );
  } finally {
    clearTimeout(timer);
    input.execution.signal?.removeEventListener("abort", abort);
  }
}

function cleanTextRequest(request: RelayTextRequest) {
  assertModel(request.model);
  if (!providerProtocolSupportsCapability(request.providerProtocol, "text")) {
    throw new RelayProviderError("FORMAT");
  }
  if (!Array.isArray(request.messages) || request.messages.length < 1 || request.messages.length > 200) {
    throw new RelayProviderError("FORMAT");
  }
  const messages = request.messages.map((message) => {
    if (!message || !["assistant", "user"].includes(message.role)) {
      throw new RelayProviderError("FORMAT");
    }
    return { role: message.role, text: assertText(message.text, 200_000) };
  });
  const contextInputs = (request.contextInputs ?? []).map((input) => {
    if (!input || !["audio", "image", "text", "video"].includes(input.kind)) {
      throw new RelayProviderError("FORMAT");
    }
    if (input.kind === "text") {
      return { kind: "text" as const, text: assertText(input.text, 200_000) };
    }
    if (!contextMimeTypes[input.kind].has(input.mimeType as never)) {
      throw new RelayProviderError("FORMAT");
    }
    return {
      kind: input.kind,
      mimeType: input.mimeType,
      transientUrl: cleanTransientMediaValue(input.transientUrl, input.mimeType),
    };
  });
  if (contextInputs.length > 32 || (
    contextInputs.length > 0 && messages.at(-1)?.role !== "user"
  )) {
    throw new RelayProviderError("FORMAT");
  }
  return {
    contextInputs,
    instructions: request.instructions === undefined
      ? undefined
      : assertText(request.instructions, 100_000),
    maxOutputTokens: optionalTokenCount(request.maxOutputTokens),
    messages,
    model: request.model,
    temperature: optionalTemperature(request.temperature),
  };
}

function cleanTransientMediaValue(value: string, mimeType: string) {
  if (typeof value !== "string" || value.length > 50 * 1024 * 1024) {
    throw new RelayProviderError("FORMAT");
  }
  if (value.startsWith("data:")) {
    const match = /^data:([^;,]+);base64,([a-z0-9+/=\r\n]+)$/i.exec(value);
    if (!match || match[1].toLowerCase() !== mimeType.toLowerCase()) {
      throw new RelayProviderError("FORMAT");
    }
    return value;
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new RelayProviderError("FORMAT");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new RelayProviderError("FORMAT");
  }
  return value;
}

function dataUrlParts(value: string) {
  const match = /^data:([^;,]+);base64,([a-z0-9+/=\r\n]+)$/i.exec(value);
  if (!match) throw new RelayProviderError("FORMAT");
  return { data: match[2].replace(/\s+/g, ""), mimeType: match[1].toLowerCase() };
}

function withContextOnLastUserMessage<T extends { role: string }>(
  messages: T[],
  content: unknown,
) {
  return messages.map((message, index) =>
    index === messages.length - 1 ? { ...message, content } : message
  );
}

function openAiChatContextParts(inputs: readonly RelayTextContextInput[]) {
  return inputs.map((input) => {
    if (input.kind === "text") return { text: input.text, type: "text" };
    if (input.kind === "image") {
      return {
        image_url: { url: input.transientUrl },
        type: "image_url",
      };
    }
    throw new RelayProviderError("FORMAT");
  });
}

function openAiResponsesContextParts(inputs: readonly RelayTextContextInput[]) {
  return inputs.map((input) => {
    if (input.kind === "text") return { text: input.text, type: "input_text" };
    if (input.kind === "image") {
      return { image_url: input.transientUrl, type: "input_image" };
    }
    if (input.kind === "audio") {
      if (!input.transientUrl.startsWith("data:")) {
        throw new RelayProviderError("FORMAT");
      }
      const { data, mimeType } = dataUrlParts(input.transientUrl);
      if (mimeType !== "audio/wav" && mimeType !== "audio/mpeg") {
        throw new RelayProviderError("FORMAT");
      }
      return {
        input_audio: {
          data,
          format: mimeType === "audio/wav" ? "wav" : "mp3",
        },
        type: "input_audio",
      };
    }
    throw new RelayProviderError("FORMAT");
  });
}

function claudeContextParts(inputs: readonly RelayTextContextInput[]) {
  return inputs.map((input) => {
    if (input.kind === "text") return { text: input.text, type: "text" };
    if (input.kind !== "image") throw new RelayProviderError("FORMAT");
    if (input.transientUrl.startsWith("data:")) {
      const { data, mimeType } = dataUrlParts(input.transientUrl);
      return {
        source: { data, media_type: mimeType, type: "base64" },
        type: "image",
      };
    }
    return {
      source: { type: "url", url: input.transientUrl },
      type: "image",
    };
  });
}

function geminiContextParts(inputs: readonly RelayTextContextInput[]) {
  return inputs.map((input) => {
    if (input.kind === "text") return { text: input.text };
    if (input.transientUrl.startsWith("data:")) {
      const { data, mimeType } = dataUrlParts(input.transientUrl);
      return { inlineData: { data, mimeType } };
    }
    return {
      fileData: {
        fileUri: input.transientUrl,
        mimeType: input.mimeType,
      },
    };
  });
}

function textRequestRoute(request: RelayTextRequest) {
  const clean = cleanTextRequest(request);
  if (request.providerProtocol === "openai-chat") {
    const messages = clean.messages.map((message) => ({
      content: message.text as unknown,
      role: message.role,
    }));
    const contextualMessages = clean.contextInputs.length
      ? withContextOnLastUserMessage(messages, [
          ...openAiChatContextParts(clean.contextInputs),
          { text: clean.messages.at(-1)!.text, type: "text" },
        ])
      : messages;
    return {
      body: {
        model: clean.model,
        messages: [
          ...(clean.instructions
            ? [{ content: clean.instructions, role: "system" }]
            : []),
          ...contextualMessages,
        ],
        ...(clean.maxOutputTokens === undefined
          ? {}
          : { max_tokens: clean.maxOutputTokens }),
        ...(clean.temperature === undefined
          ? {}
          : { temperature: clean.temperature }),
      },
      path: "/v1/chat/completions",
    };
  }
  if (request.providerProtocol === "openai-responses") {
    const messages = clean.messages.map((message) => ({
      content: message.text as unknown,
      role: message.role,
    }));
    const contextualMessages = clean.contextInputs.length
      ? withContextOnLastUserMessage(messages, [
          ...openAiResponsesContextParts(clean.contextInputs),
          { text: clean.messages.at(-1)!.text, type: "input_text" },
        ])
      : messages;
    return {
      body: {
        input: contextualMessages,
        ...(clean.instructions ? { instructions: clean.instructions } : {}),
        ...(clean.maxOutputTokens === undefined
          ? {}
          : { max_output_tokens: clean.maxOutputTokens }),
        model: clean.model,
        ...(clean.temperature === undefined
          ? {}
          : { temperature: clean.temperature }),
      },
      path: "/v1/responses",
    };
  }
  if (request.providerProtocol === "claude-messages") {
    const messages = clean.messages.map((message) => ({
      content: message.text as unknown,
      role: message.role,
    }));
    const contextualMessages = clean.contextInputs.length
      ? withContextOnLastUserMessage(messages, [
          ...claudeContextParts(clean.contextInputs),
          { text: clean.messages.at(-1)!.text, type: "text" },
        ])
      : messages;
    return {
      body: {
        max_tokens: clean.maxOutputTokens ?? 4_096,
        messages: contextualMessages,
        model: clean.model,
        ...(clean.instructions ? { system: clean.instructions } : {}),
        ...(clean.temperature === undefined
          ? {}
          : { temperature: clean.temperature }),
      },
      path: "/v1/messages",
    };
  }
  const contents = clean.messages.map((message) => ({
    parts: [{ text: message.text }] as unknown[],
    role: message.role === "assistant" ? "model" : "user",
  }));
  if (clean.contextInputs.length) {
    contents[contents.length - 1].parts = [
      ...geminiContextParts(clean.contextInputs),
      { text: clean.messages.at(-1)!.text },
    ];
  }
  return {
    body: {
      contents,
      ...(clean.instructions
        ? { systemInstruction: { parts: [{ text: clean.instructions }] } }
        : {}),
      ...(
        clean.maxOutputTokens === undefined && clean.temperature === undefined
          ? {}
          : {
              generationConfig: {
                ...(clean.maxOutputTokens === undefined
                  ? {}
                  : { maxOutputTokens: clean.maxOutputTokens }),
                ...(clean.temperature === undefined
                  ? {}
                  : { temperature: clean.temperature }),
              },
            }
      ),
    },
    path: `/v1beta/models/${encodeURIComponent(clean.model)}:generateContent`,
  };
}

function collectTextParts(value: unknown) {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.map((part) => {
    if (typeof part === "string") return part;
    if (!isRecord(part)) return "";
    if (typeof part.text === "string") return part.text;
    if (typeof part.content === "string") return part.content;
    return "";
  }).join("");
}

function decodeReflectedSecret(value: string) {
  const percentDecoded = value.replace(/(?:%[0-9a-f]{2})+/gi, (encoded) => {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  });
  return percentDecoded.replace(
    /\\u\{([0-9a-f]{1,6})\}|\\u([0-9a-f]{4})|\\x([0-9a-f]{2})/gi,
    (encoded, braced: string | undefined, fixed: string | undefined, byte: string | undefined) => {
      const codePoint = Number.parseInt(braced ?? fixed ?? byte ?? "", 16);
      if (!Number.isSafeInteger(codePoint) || codePoint > 0x10ffff) return encoded;
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return encoded;
      }
    },
  );
}

function containsReflectedSecret(value: string, secret: string) {
  let candidate = value;
  for (let pass = 0; pass < 3; pass += 1) {
    if (candidate.includes(secret)) return true;
    const decoded = decodeReflectedSecret(candidate);
    if (decoded === candidate) return false;
    candidate = decoded;
  }
  return candidate.includes(secret);
}

function parseTextResult(
  providerProtocol: RelayTextProviderProtocol,
  body: unknown,
  apiKey: string,
): RelayTextResult {
  if (!isRecord(body)) throw new RelayProviderError("FORMAT");
  let text = "";
  let usage: RelayProviderUsage | undefined;
  if (providerProtocol === "openai-chat") {
    const choice = Array.isArray(body.choices) && isRecord(body.choices[0])
      ? body.choices[0]
      : undefined;
    const message = choice && isRecord(choice.message) ? choice.message : undefined;
    text = collectTextParts(message?.content);
    const rawUsage = isRecord(body.usage) ? body.usage : {};
    usage = usageFromValues(
      rawUsage.prompt_tokens,
      rawUsage.completion_tokens,
      rawUsage.total_tokens,
    );
  } else if (providerProtocol === "openai-responses") {
    text = typeof body.output_text === "string" ? body.output_text : "";
    if (!text && Array.isArray(body.output)) {
      text = body.output.map((item) => {
        if (!isRecord(item)) return "";
        return collectTextParts(item.content);
      }).join("");
    }
    const rawUsage = isRecord(body.usage) ? body.usage : {};
    usage = usageFromValues(
      rawUsage.input_tokens,
      rawUsage.output_tokens,
      rawUsage.total_tokens,
    );
  } else if (providerProtocol === "claude-messages") {
    text = collectTextParts(body.content);
    const rawUsage = isRecord(body.usage) ? body.usage : {};
    usage = usageFromValues(
      rawUsage.input_tokens,
      rawUsage.output_tokens,
      undefined,
    );
  } else {
    const candidate = Array.isArray(body.candidates) && isRecord(body.candidates[0])
      ? body.candidates[0]
      : undefined;
    const content = candidate && isRecord(candidate.content)
      ? candidate.content
      : undefined;
    text = collectTextParts(content?.parts);
    const rawUsage = isRecord(body.usageMetadata) ? body.usageMetadata : {};
    usage = usageFromValues(
      rawUsage.promptTokenCount,
      rawUsage.candidatesTokenCount,
      rawUsage.totalTokenCount,
    );
  }
  text = assertText(text, 2_000_000);
  if (containsReflectedSecret(text, apiKey)) {
    throw new RelayProviderError("FORMAT");
  }
  return {
    capability: "text",
    providerProtocol,
    state: "success",
    text,
    ...(usage ? { usage } : {}),
  };
}

export async function requestRelayText(
  connection: RelayProviderConnection,
  request: RelayTextRequest,
  execution: RelayProviderExecution,
) {
  const route = textRequestRoute(request);
  const body = await relayJsonRequest({
    body: route.body,
    connection,
    execution,
    maximumRequestBytes: textRequestLimitBytes,
    maximumResponseBytes: textResponseLimitBytes,
    method: "POST",
    networkFailureMayStillRun: true,
    path: route.path,
    protocol: request.providerProtocol,
  });
  return parseTextResult(request.providerProtocol, body, connection.apiKey);
}

function relayTextContextInputs(
  inputs: Parameters<TextGenerationProvider["generate"]>[0]["inputs"],
): RelayTextContextInput[] {
  return inputs.map((input) => {
    if (input.kind === "text") {
      if (typeof input.text !== "string") throw new RelayProviderError("FORMAT");
      return { kind: "text", text: input.text };
    }
    if (
      typeof input.mimeType !== "string" ||
      typeof input.transientUrl !== "string"
    ) {
      throw new RelayProviderError("FORMAT");
    }
    return {
      kind: input.kind,
      mimeType: input.mimeType,
      transientUrl: input.transientUrl,
    };
  });
}

export const relayTextGenerationProvider: TextGenerationProvider = {
  id: "multi-protocol-relay-text",
  registrations: [
    { driver: "multi-protocol-relay", protocol: "openai-chat" },
    { driver: "multi-protocol-relay", protocol: "openai-responses" },
    { driver: "multi-protocol-relay", protocol: "claude-messages" },
    { driver: "multi-protocol-relay", protocol: "gemini-generate-content" },
  ],
  async generate(request, execution) {
    try {
      if (
        request.protocol === "native" ||
        !execution.profile.apiKey
      ) {
        throw new RelayProviderError(
          request.protocol === "native" ? "FORMAT" : "AUTH",
        );
      }
      const result = await requestRelayText(
        {
          apiKey: execution.profile.apiKey,
          baseUrl: execution.profile.baseUrl,
        },
        {
          capability: "text",
          contextInputs: relayTextContextInputs(request.inputs),
          maxOutputTokens: request.maxOutputTokens,
          messages: [{ role: "user", text: request.prompt }],
          model: request.model,
          providerProtocol: request.protocol,
          temperature: request.temperature,
        },
        {
          beforeProviderRequest: () => {
            execution.beforeProviderRequest();
            // The pinned relay transport bypasses the injected fetch wrapper.
            // Releasing here preserves the existing request-boundary lease.
            execution.releaseProviderLease();
          },
          fetcher: execution.fetcher,
          signal: execution.signal,
          usePinnedTransport: execution.usePinnedTransport,
        },
      );
      return {
        providerUsageTokens: result.usage?.totalTokens,
        text: result.text,
      };
    } catch (error) {
      if (error instanceof RelayProviderError) {
        throw new TextGenerationProviderError(
          error.code,
          error.message,
          error.providerTaskMayStillRun,
        );
      }
      throw error;
    }
  },
};

function cleanTransientImage(value: string) {
  if (typeof value !== "string" || value.length > 50 * 1024 * 1024) {
    throw new RelayProviderError("FORMAT");
  }
  if (value.startsWith("data:image/")) {
    if (!/^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=\r\n]+$/i.test(value)) {
      throw new RelayProviderError("FORMAT");
    }
    return value;
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new RelayProviderError("FORMAT");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new RelayProviderError("FORMAT");
  }
  return value;
}

function cleanImageRequest(request: RelayGptImageRequest) {
  assertModel(request.model);
  const prompt = assertText(request.prompt, 100_000);
  const count = request.count ?? 1;
  if (!Number.isSafeInteger(count) || count < 1 || count > 10) {
    throw new RelayProviderError("FORMAT");
  }
  if (request.size !== undefined && !sizePattern.test(request.size)) {
    throw new RelayProviderError("FORMAT");
  }
  const inputImages = (request.inputImages ?? []).map(cleanTransientImage);
  const maskImage = request.maskImage === undefined
    ? undefined
    : cleanTransientImage(request.maskImage);
  if (inputImages.length > 16) throw new RelayProviderError("FORMAT");
  if (request.operation === "edit" && inputImages.length < 1) {
    throw new RelayProviderError("FORMAT");
  }
  if (request.operation === "generation" && inputImages.length > 0) {
    throw new RelayProviderError("FORMAT");
  }
  if (
    maskImage !== undefined &&
    (request.operation !== "edit" ||
      !/^data:image\/png;base64,/i.test(maskImage) &&
        !/^https:\/\//i.test(maskImage))
  ) throw new RelayProviderError("FORMAT");
  return {
    body: {
      ...(request.background ? { background: request.background } : {}),
      ...(request.operation === "edit"
        ? { image: inputImages.length === 1 ? inputImages[0] : inputImages }
        : {}),
      ...(maskImage ? { mask: maskImage } : {}),
      model: request.model,
      n: count,
      output_format: "png",
      prompt,
      quality: request.quality ?? "auto",
      response_format: request.responseFormat ?? "b64_json",
      size: request.size ?? "auto",
    },
    path: request.operation === "edit"
      ? "/v1/images/edits"
      : "/v1/images/generations",
  };
}

function decodeImageBase64(value: string) {
  const compact = value.replace(/\s+/g, "");
  if (!compact || !/^[a-z0-9+/]+={0,2}$/i.test(compact)) {
    throw new RelayProviderError("FORMAT");
  }
  const bytes = Buffer.from(compact, "base64");
  if (!bytes.length || bytes.length > maxDecodedImageBytes) {
    throw new RelayProviderError("FORMAT");
  }
  return new Uint8Array(bytes);
}

function decodePngBase64(value: string) {
  const bytes = decodeImageBase64(value);
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (
    bytes.length < signature.length ||
    signature.some((byte, index) => bytes[index] !== byte)
  ) {
    throw new RelayProviderError("FORMAT");
  }
  return bytes;
}

function cleanTransientOutputUrl(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new RelayProviderError("FORMAT");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new RelayProviderError("FORMAT");
  }
  return value;
}

function parseGptImageResult(body: unknown): RelayImageResult {
  if (!isRecord(body)) {
    throw new RelayProviderError("FORMAT");
  }
  const responseItems = Array.isArray(body.data)
    ? body.data
    : Array.isArray(body.output)
      ? body.output
      : undefined;
  if (!responseItems || responseItems.length < 1 || responseItems.length > 10) {
    throw new RelayProviderError("FORMAT");
  }
  const outputs = responseItems.map((item): RelayTransientMediaOutput => {
    if (!isRecord(item)) throw new RelayProviderError("FORMAT");
    if (
      item.type === "image_generation_call" &&
      typeof item.result === "string" &&
      Object.keys(item).every((key) => ["id", "result", "status", "type"].includes(key))
    ) {
      if (
        item.status !== undefined &&
        item.status !== "completed" &&
        item.status !== "succeeded"
      ) throw new RelayProviderError("FORMAT");
      return {
        bytes: decodePngBase64(item.result),
        kind: "image",
        mimeType: "image/png",
        transport: "bytes",
      };
    }
    if (typeof item.b64_json === "string") {
      if (
        item.media_type !== undefined &&
        (typeof item.media_type !== "string" || item.media_type.toLowerCase() !== "image/png")
      ) {
        throw new RelayProviderError("FORMAT");
      }
      return {
        bytes: decodePngBase64(item.b64_json),
        kind: "image",
        mimeType: "image/png",
        transport: "bytes",
      };
    }
    if (typeof item.url === "string") {
      return {
        kind: "image",
        transientUrl: cleanTransientOutputUrl(item.url),
        transport: "transient-url",
      };
    }
    throw new RelayProviderError("FORMAT");
  });
  const taskIds = [...new Set(taskIdCandidates(body).flatMap((value) => {
    const taskId = typeof value === "number" && Number.isSafeInteger(value)
      ? String(value)
      : typeof value === "string" ? value.trim() : "";
    return taskIdPattern.test(taskId) ? [taskId] : [];
  }))];
  return {
    capability: "image",
    ...(taskIds.length === 1 ? { externalTaskId: taskIds[0] } : {}),
    outputs,
    providerProtocol: "gpt-image",
    state: "success",
  };
}

function referencePreparationError(
  error: unknown,
  fallback: Extract<
    RelayProviderErrorCode,
    "REFERENCE_UPLOAD_FAILED" | "REFERENCE_SIGN_FAILED"
  >,
) {
  if (error instanceof RelayProviderError) return error;
  if (error instanceof StorageConfigurationBusyError) {
    return new RelayProviderError("REFERENCE_STORAGE_BUSY");
  }
  if (
    error instanceof Error &&
    /(?:database\s+is\s+)?(?:locked|busy)|configuration\s+is\s+busy/i.test(error.message)
  ) {
    return new RelayProviderError("REFERENCE_STORAGE_BUSY");
  }
  return new RelayProviderError(fallback);
}

/**
 * Materialize local data references before acquiring the Provider request
 * lease. Provider and Storage configuration intentionally share one
 * cross-process lock; nesting this operation inside the Provider lease would
 * self-block until the five-second lock timeout.
 */
export async function prepareRelayGptImageRequest(
  request: RelayGptImageRequest,
  execution: RelayProviderExecution,
): Promise<PreparedRelayGptImageRequest> {
  if (!providerProtocolSupportsCapability(request.providerProtocol, request.capability)) {
    throw new RelayProviderError("FORMAT");
  }
  const objectStore = execution.temporaryImageObjectStore ??
    defaultTemporaryImageObjectStore;
  const temporaryPublications: Array<{
    bytes: Buffer;
    contentType: string;
    inputIndex: number;
    slot: "input" | "mask";
    reservation: MediaPublicationReservation;
  }> = [];
  let fixedProfile: AliyunStorageProfile | undefined;
  let cleanupStarted = false;
  const cleanup = async () => {
    if (cleanupStarted) return;
    cleanupStarted = true;
    if (!fixedProfile) return;
    for (const temporary of temporaryPublications.reverse()) {
      await compensateMediaPublication(temporary.reservation, {
        code: "RELAY_TEMP_REFERENCE_CLEANUP",
        deleteExternalObject: objectStore.deleteObject,
        profile: fixedProfile,
      }).catch(() => false);
    }
  };
  try {
    const inputImages = [...(request.inputImages ?? [])];
    let maskImage = request.maskImage;
    const references = [
      ...inputImages.map((image, inputIndex) => ({ image, inputIndex, slot: "input" as const })),
      ...(maskImage === undefined
        ? []
        : [{ image: maskImage, inputIndex: 0, slot: "mask" as const }]),
    ];
    const dataImages = references.flatMap(({ image, inputIndex, slot }) => {
      if (!image.startsWith("data:")) return [];
      const match =
        /^data:image\/(png|jpeg|webp);base64,([a-z0-9+/=\r\n]+)$/i.exec(image);
      if (!match) throw new RelayProviderError("FORMAT");
      if (slot === "mask" && match[1].toLowerCase() !== "png") {
        throw new RelayProviderError("FORMAT");
      }
      const mime = `image/${match[1].toLowerCase()}`;
      const extension = match[1].toLowerCase() === "png"
        ? "png"
        : match[1].toLowerCase() === "jpeg"
          ? "jpg"
          : "webp";
      const bytes = Buffer.from(match[2].replace(/\s+/g, ""), "base64");
      if (!bytes.length || bytes.length > 20 * 1024 * 1024) {
        throw new RelayProviderError("FORMAT");
      }
      return [{ bytes, contentType: mime, extension, inputIndex, slot }];
    });

    if (dataImages.length > 0) {
      let retained: boolean | undefined;
      try {
        retained = await withReadableStorageProfileReservation((profile) => {
          if (!execution.mediaLifecycle?.ownerId) {
            throw new RelayProviderError("FORMAT");
          }
          fixedProfile = profile;
          for (const dataImage of dataImages) {
            const id = randomUUID();
            const reservation = reserveMediaPublication({
              contentType: dataImage.contentType,
              finalStorageName: `${id}.${dataImage.extension}`,
              id,
              kind: "image",
              objectKey: createAliyunOssObjectKey("image", dataImage.extension),
              ownerId: execution.mediaLifecycle!.ownerId,
              storageBackend: "oss",
              storageProfileId: profile.id,
            });
            temporaryPublications.push({
              bytes: dataImage.bytes,
              contentType: dataImage.contentType,
              inputIndex: dataImage.inputIndex,
              slot: dataImage.slot,
              reservation,
            });
          }
          return true;
        });
      } catch (error) {
        throw referencePreparationError(error, "REFERENCE_UPLOAD_FAILED");
      }
      if (retained && fixedProfile) {
        for (const temporary of temporaryPublications) {
          try {
            const stagingPath = mediaPublicationStagingPath(temporary.reservation);
            await mkdir(dirname(stagingPath), { recursive: true });
            await writeFile(stagingPath, temporary.bytes, { flag: "wx" });
            const checksumSha256 = createHash("sha256")
              .update(temporary.bytes)
              .digest("hex");
            stageMediaPublication(temporary.reservation, {
              byteSize: temporary.bytes.length,
              checksumSha256,
              contentType: temporary.contentType,
            });
            await objectStore.uploadObject({
              byteSize: temporary.bytes.length,
              checksumSha256,
              contentType: temporary.contentType,
              credentials: fixedProfile,
              filePath: stagingPath,
              objectKey: temporary.reservation.objectKey,
            });
            markExternalMediaPublicationReady(temporary.reservation);
          } catch (error) {
            throw referencePreparationError(error, "REFERENCE_UPLOAD_FAILED");
          }
          try {
            const url = await objectStore.createReadUrl(
              temporary.reservation.objectKey,
              fixedProfile,
              execution.referenceUrlTtlSeconds ?? 300,
            );
            if (temporary.slot === "mask") maskImage = url;
            else inputImages[temporary.inputIndex] = url;
          } catch (error) {
            throw referencePreparationError(error, "REFERENCE_SIGN_FAILED");
          }
        }
      }
    }
    return {
      cleanup,
      request: request.inputImages === undefined && request.maskImage === undefined
        ? request
        : {
            ...request,
            ...(request.inputImages === undefined ? {} : { inputImages }),
            ...(request.maskImage === undefined ? {} : { maskImage }),
          },
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

/** Send a request that has already completed all local reference preparation. */
export async function sendPreparedRelayGptImageRequest(
  connection: RelayProviderConnection,
  request: RelayGptImageRequest,
  execution: RelayProviderExecution,
) {
  if (!providerProtocolSupportsCapability(request.providerProtocol, request.capability)) {
    throw new RelayProviderError("FORMAT");
  }
  const route = cleanImageRequest(request);
  let providerBoundaryCrossed = false;
  let body: unknown;
  try {
    body = await relayJsonRequest({
      body: route.body,
      connection,
      execution: {
        ...execution,
        timeoutMs:
          execution.timeoutMs ?? relayGptImageRequestTimeoutMs,
        beforeProviderRequest: () => {
          execution.beforeProviderRequest?.();
          providerBoundaryCrossed = true;
        },
      },
      maximumRequestBytes: mediaRequestLimitBytes,
      maximumResponseBytes: mediaResponseLimitBytes,
      method: "POST",
      path: route.path,
      protocol: request.providerProtocol,
      providerTaskMayStillRun: true,
    });
  } catch (error) {
    if (!providerBoundaryCrossed) throw error;
    if (error instanceof RelayProviderError && error.code === "FORMAT") {
      throw new RelayProviderError(
        "PROVIDER_RESULT_FORMAT",
        error.providerTaskMayStillRun,
      );
    }
    // Keep the real transport/auth/reject code. Rewriting every post-boundary
    // failure as "already submitted" blocked retry when the platform never
    // created a job.
    throw error;
  }
  try {
    return parseGptImageResult(body);
  } catch {
    throw new RelayProviderError("PROVIDER_RESULT_FORMAT", true);
  }
}

/** Convenience entry point for callers that do not already hold a Provider lease. */
export async function requestRelayGptImage(
  connection: RelayProviderConnection,
  request: RelayGptImageRequest,
  execution: RelayProviderExecution,
) {
  const prepared = await prepareRelayGptImageRequest(request, execution);
  try {
    return await sendPreparedRelayGptImageRequest(
      connection,
      prepared.request,
      execution,
    );
  } finally {
    await prepared.cleanup();
  }
}

function cleanMediaParamValue(value: RelayMediaParamValue) {
  const values = Array.isArray(value) ? value : [value];
  if (values.length > 32) throw new RelayProviderError("FORMAT");
  for (const item of values) {
    if (typeof item === "string") {
      if (item.length > 50 * 1024 * 1024 || /\0/.test(item)) {
        throw new RelayProviderError("FORMAT");
      }
    } else if (typeof item === "number") {
      if (!Number.isFinite(item)) throw new RelayProviderError("FORMAT");
    } else if (typeof item !== "boolean") {
      throw new RelayProviderError("FORMAT");
    }
  }
  return value;
}

function cleanMediaRequest(request: RelayMediaGenerateRequest) {
  assertModel(request.model);
  if (!providerProtocolSupportsCapability(request.providerProtocol, request.capability)) {
    throw new RelayProviderError("FORMAT");
  }
  const prompt = assertText(request.prompt, 100_000);
  if (!isRecord(request.params) || Object.keys(request.params).length > 100) {
    throw new RelayProviderError("FORMAT");
  }
  const params: Record<string, RelayMediaParamValue> = {};
  for (const [name, value] of Object.entries(request.params)) {
    if (
      !/^[a-z][a-z0-9_]{0,79}$/i.test(name) ||
      forbiddenParamName.test(name) ||
      !mediaParamNamesByCapability[request.capability].has(name)
    ) {
      throw new RelayProviderError("FORMAT");
    }
    params[name] = cleanMediaParamValue(value);
  }
  return { model: request.model, params, prompt };
}

function cleanExternalTaskId(value: unknown, apiKey: string) {
  const taskId = typeof value === "number" && Number.isSafeInteger(value)
    ? String(value)
    : typeof value === "string"
      ? value.trim()
      : "";
  if (
    !taskIdPattern.test(taskId) ||
    taskId.includes(apiKey) ||
    taskId.includes(encodeURIComponent(apiKey))
  ) {
    throw new RelayProviderError("FORMAT");
  }
  return taskId;
}

function taskIdCandidates(body: Record<string, unknown>) {
  const candidates: unknown[] = [body.task_id, body.id];
  if (isRecord(body.data)) candidates.push(body.data.task_id, body.data.id);
  if (Array.isArray(body.data)) {
    for (const item of body.data) {
      if (isRecord(item)) candidates.push(item.task_id, item.id);
    }
  }
  return candidates.filter((value) => value !== undefined && value !== null);
}

export async function submitRelayMedia(
  connection: RelayProviderConnection,
  request: RelayMediaGenerateRequest,
  execution: RelayProviderExecution,
) {
  const clean = cleanMediaRequest(request);
  const body = await relayJsonRequest({
    body: clean,
    connection,
    execution,
    maximumRequestBytes: mediaRequestLimitBytes,
    maximumResponseBytes: textResponseLimitBytes,
    method: "POST",
    networkFailureMayStillRun: true,
    path: "/v1/media/generate",
    protocol: request.providerProtocol,
    providerTaskMayStillRun: true,
  });
  if (!isRecord(body)) throw new RelayProviderError("FORMAT");
  const taskIds = [...new Set(taskIdCandidates(body).map((value) =>
    cleanExternalTaskId(value, connection.apiKey)
  ))];
  if (taskIds.length !== 1) {
    throw new RelayProviderError("FORMAT", true);
  }
  return {
    capability: request.capability,
    externalTaskId: taskIds[0],
    externalTaskIds: taskIds,
    providerProtocol: "media-generate",
    state: "queued",
  } satisfies RelayMediaSubmission;
}

export async function submitContractRelayMedia(
  connection: RelayProviderConnection,
  request: RelayMediaGenerateRequest,
  contractInput: unknown,
  execution: RelayProviderExecution,
) {
  const contract = compileModelExecutionContract(contractInput).contract;
  if (
    contract.connectorFamily !== "generic-async-media" ||
    contract.create.path !== "/v1/media/generate" ||
    contract.create.taskIdPath !== "task_id"
  ) throw new RelayProviderError("FORMAT");
  const body = await relayJsonRequest({
    body: cleanMediaRequest(request),
    connection,
    execution,
    maximumRequestBytes: mediaRequestLimitBytes,
    maximumResponseBytes: textResponseLimitBytes,
    method: "POST",
    networkFailureMayStillRun: true,
    path: contract.create.path,
    protocol: request.providerProtocol,
    providerTaskMayStillRun: true,
  });
  // The declarative contract owns the finite task-id path. Provider response
  // envelopes may add harmless metadata (for example request_id) without
  // changing that contract; response bytes are already bounded by
  // relayJsonRequest and cleanExternalTaskId still rejects unsafe IDs.
  if (!isRecord(body)) throw new RelayProviderError("FORMAT", true);
  const taskId = cleanExternalTaskId(body.task_id, connection.apiKey);
  return {
    capability: request.capability,
    externalTaskId: taskId,
    externalTaskIds: [taskId],
    providerProtocol: "media-generate" as const,
    state: "queued" as const,
  };
}

function exactContractState(contract: ModelExecutionContract, value: unknown) {
  if (typeof value !== "string" || !contract.result.states) {
    throw new RelayProviderError("FORMAT");
  }
  if (contract.result.states.running.includes(value)) return "running" as const;
  if (contract.result.states.succeeded.includes(value)) return "success" as const;
  if (contract.result.states.failed.includes(value)) return "failed" as const;
  throw new RelayProviderError("FORMAT");
}

export async function pollContractRelayMediaTask(
  connection: RelayProviderConnection,
  input: Readonly<{
    capability: Exclude<RelayCapability, "text">;
    externalTaskId: string;
    providerProtocol: "media-generate";
  }>,
  contractInput: unknown,
  execution: RelayProviderExecution,
) {
  const contract = compileModelExecutionContract(contractInput).contract;
  const taskId = cleanExternalTaskId(input.externalTaskId, connection.apiKey);
  const poll = compileModelContractPoll(contract, taskId);
  if (poll.method !== "GET") throw new RelayProviderError("FORMAT");
  const body = await relayJsonRequest({
    connection,
    execution,
    maximumRequestBytes: 0,
    maximumResponseBytes: textResponseLimitBytes,
    method: "GET",
    path: `${poll.path}?${new URLSearchParams(poll.query).toString()}`,
    protocol: input.providerProtocol,
    providerTaskMayStillRun: true,
  });
  if (!isRecord(body)) throw new RelayProviderError("FORMAT");
  const state = exactContractState(contract, body.state);
  if (state === "running") return {
    capability: input.capability,
    providerProtocol: "media-generate" as const,
    state,
  };
  if (state === "failed") return {
    capability: input.capability,
    code: "REMOTE" as const,
    message: errorMessages.REMOTE,
    providerProtocol: "media-generate" as const,
    state,
  };
  if (contract.result.resultPath !== "result_url") {
    throw new RelayProviderError("FORMAT");
  }
  if (typeof body.result_url !== "string") throw new RelayProviderError("FORMAT");
  const transientUrl = cleanTransientOutputUrl(body.result_url);
  return {
    capability: input.capability,
    outputs: [{
      kind: input.capability,
      transientUrl,
      transport: "transient-url" as const,
    }],
    providerProtocol: "media-generate" as const,
    state,
  };
}

function progressPercent(value: unknown) {
  if (typeof value === "string" && /^\d{1,3}%$/.test(value.trim())) {
    const number = Number.parseInt(value, 10);
    return number >= 0 && number <= 100 ? number : undefined;
  }
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 100
    ? number
    : undefined;
}

function normalizedMediaState(value: unknown) {
  if (typeof value !== "string") throw new RelayProviderError("FORMAT");
  const state = value.trim().toLowerCase();
  if (["pending", "queued", "waiting"].includes(state)) return "queued" as const;
  if (["running", "processing", "in_progress"].includes(state)) return "running" as const;
  if (["success", "succeeded", "completed"].includes(state)) return "success" as const;
  if (["failed", "error"].includes(state)) return "failed" as const;
  throw new RelayProviderError("FORMAT");
}

function resultUrls(body: Record<string, unknown>) {
  const values: unknown[] = [];
  if (body.result_url !== undefined) values.push(body.result_url);
  if (Array.isArray(body.result_urls)) values.push(...body.result_urls);
  if (Array.isArray(body.outputs)) {
    for (const output of body.outputs) {
      if (typeof output === "string") values.push(output);
      else if (isRecord(output)) values.push(output.url, output.result_url);
    }
  }
  return Array.from(new Set(values
    .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
    .map(cleanTransientOutputUrl)));
}

function parseMediaTaskSnapshot(
  capability: Exclude<RelayCapability, "text">,
  body: unknown,
  requireResultType = false,
): RelayMediaTaskSnapshot {
  if (!isRecord(body)) throw new RelayProviderError("FORMAT");
  const state = normalizedMediaState(body.state);
  const isFinal = body.is_final;
  if (isFinal !== undefined && typeof isFinal !== "boolean") {
    throw new RelayProviderError("FORMAT");
  }
  if ((state === "success" || state === "failed") && isFinal === false) {
    throw new RelayProviderError("FORMAT");
  }
  if ((state === "queued" || state === "running") && isFinal === true) {
    throw new RelayProviderError("FORMAT");
  }
  if (state === "queued" || state === "running") {
    const progress = progressPercent(body.progress);
    return {
      capability,
      ...(progress === undefined ? {} : { progress }),
      providerProtocol: "media-generate",
      state,
    };
  }
  if (state === "failed") {
    const refunded =
      body.refunded === true ||
      body.refunded === 1 ||
      body.refunded === "true";
    return {
      capability,
      code: "REMOTE",
      message: errorMessages.REMOTE,
      providerProtocol: "media-generate",
      ...(refunded ? { refunded: true } : {}),
      state: "failed",
    };
  }
  if (
    (requireResultType && body.result_type !== capability) ||
    (typeof body.result_type === "string" && body.result_type &&
      body.result_type !== capability)
  ) {
    throw new RelayProviderError("FORMAT");
  }
  const urls = resultUrls(body);
  if (urls.length < 1 || urls.length > 10) {
    throw new RelayProviderError("FORMAT");
  }
  const cost = Number(body.cost);
  const providerCostUnits = Number.isFinite(cost) && cost >= 0 ? cost : undefined;
  return {
    capability,
    outputs: urls.map((transientUrl) => ({
      kind: capability,
      transientUrl,
      transport: "transient-url" as const,
    })),
    ...(providerCostUnits === undefined ? {} : { providerCostUnits }),
    providerProtocol: "media-generate",
    state: "success",
  };
}

export async function pollRelayMediaTask(
  connection: RelayProviderConnection,
  input: Readonly<{
    capability: Exclude<RelayCapability, "text">;
    externalTaskId: string;
    providerProtocol: "media-generate";
    requireResultType?: boolean;
  }>,
  execution: RelayProviderExecution,
) {
  if (!providerProtocolSupportsCapability(input.providerProtocol, input.capability)) {
    throw new RelayProviderError("FORMAT");
  }
  const taskId = cleanExternalTaskId(input.externalTaskId, connection.apiKey);
  const requestStatus = (path: string) => relayJsonRequest({
    connection,
    execution,
    maximumRequestBytes: 0,
    maximumResponseBytes: textResponseLimitBytes,
    method: "GET",
    path,
    protocol: input.providerProtocol,
    providerTaskMayStillRun: true,
  });
  let body: unknown;
  try {
    body = await requestStatus(
      `/v1/skills/task-status?task_id=${encodeURIComponent(taskId)}`,
    );
  } catch (error) {
    if (
      !(error instanceof RelayProviderError) ||
      ![404, 405].includes(error.statusCode ?? 0)
    ) throw error;
    body = await requestStatus(
      `/v1/media/status?task_id=${encodeURIComponent(taskId)}`,
    );
  }
  return parseMediaTaskSnapshot(
    input.capability,
    body,
    input.requireResultType === true,
  );
}

export async function routeRelayProviderRequest(
  connection: RelayProviderConnection,
  request: RelayProviderRequest,
  execution: RelayProviderExecution,
): Promise<RelayProviderResult> {
  if (!providerProtocolSupportsCapability(request.providerProtocol, request.capability)) {
    throw new RelayProviderError("FORMAT");
  }
  if (request.providerProtocol === "gpt-image") {
    return requestRelayGptImage(connection, request, execution);
  }
  if (request.providerProtocol === "media-generate") {
    return submitRelayMedia(connection, request, execution);
  }
  return requestRelayText(connection, request, execution);
}

export type RelayProviderSafeSnapshot = Readonly<{
  capability: RelayCapability;
  contextInputCount?: number;
  contextInputKinds?: readonly ("audio" | "image" | "text" | "video")[];
  externalTaskCount?: number;
  externalTaskId?: string;
  messageCount?: number;
  model?: string;
  operation?: "edit" | "generation";
  outputCount?: number;
  parameterNames?: readonly string[];
  promptLength?: number;
  providerProtocol: Exclude<ProviderProtocol, "native">;
  state?: "failed" | "queued" | "running" | "success";
}>;

/**
 * Produces metadata safe for audit/task snapshots. It intentionally excludes
 * API keys, prompts, message text, media values, signed URLs and returned bytes.
 */
export function relayProviderSafeSnapshot(
  value: RelayProviderRequest | RelayProviderResult | RelayMediaTaskSnapshot,
): RelayProviderSafeSnapshot {
  if ("model" in value) {
    if (value.providerProtocol === "media-generate") {
      return {
        capability: value.capability,
        model: value.model,
        parameterNames: Object.keys(value.params).sort(),
        promptLength: value.prompt.length,
        providerProtocol: value.providerProtocol,
      };
    }
    if (value.providerProtocol === "gpt-image") {
      return {
        capability: value.capability,
        model: value.model,
        operation: value.operation,
        promptLength: value.prompt.length,
        providerProtocol: value.providerProtocol,
      };
    }
    return {
      capability: value.capability,
      ...(value.contextInputs?.length
        ? {
            contextInputCount: value.contextInputs.length,
            contextInputKinds: value.contextInputs.map((input) => input.kind),
          }
        : {}),
      messageCount: value.messages.length,
      model: value.model,
      providerProtocol: value.providerProtocol,
    };
  }
  if ("externalTaskIds" in value) {
    return {
      capability: value.capability,
      externalTaskCount: value.externalTaskIds.length,
      externalTaskId: value.externalTaskId,
      providerProtocol: value.providerProtocol,
      state: value.state,
    };
  }
  return {
    capability: value.capability,
    ...(value.state === "success" && "outputs" in value
      ? { outputCount: value.outputs.length }
      : {}),
    providerProtocol: value.providerProtocol,
    state: value.state,
  };
}
