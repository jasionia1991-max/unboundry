import { createHash } from "node:crypto";
import type { ProviderProfile } from "./providerProfiles";
import {
  ProviderRequestDeadlineError,
  type ProviderRequestDeadline,
  type ProviderRequestDeadlineOverrides,
  type ProviderRequestOperation,
  withProviderRequestDeadline,
} from "./providerRequestDeadline";

export type ArkVideoStatus = {
  errorCode?: string;
  errorMessage?: string;
  providerUsageTokens?: number;
  state: "cancelled" | "failed" | "queued" | "running" | "succeeded";
  videoUrl?: string;
};

export type ArkVideoReference =
  | Readonly<{ kind: "inline-data"; value: string }>
  | Readonly<{ kind: "public-url"; value: string }>
  | Readonly<{
      bindingId: string;
      kind: "trusted-asset";
      providerAssetId: string;
    }>;

export type ArkVideoMediaInput = {
  kind: "audio" | "image" | "video";
  order: number;
  reference: ArkVideoReference;
  role:
    | "first-frame"
    | "last-frame"
    | "reference-audio"
    | "reference-image"
    | "reference-video"
    | "subject";
};

export type ArkVideoLimits = {
  counts: { audio: number; image: number; video: number };
  durationMax: number;
  durationMin: number;
  maxBytes: { audio: number; image: number; video: number };
  ratios: string[];
  resolutions: string[];
};

export const defaultArkVideoLimits: ArkVideoLimits = {
  counts: { audio: 3, image: 9, video: 3 },
  durationMax: 15,
  durationMin: 4,
  maxBytes: {
    audio: 15 * 1024 * 1024,
    image: 20 * 1024 * 1024,
    video: 200 * 1024 * 1024,
  },
  ratios: ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9"],
  resolutions: ["480p", "720p"],
};

export class VolcengineArkVideoError extends Error {
  constructor(
    readonly code:
      | "AUTH"
      | "CANCELLED"
      | "FORMAT"
      | "NETWORK"
      | "RATE_LIMIT"
      | "REMOTE"
      | "TIMEOUT",
    message: string,
    readonly providerTaskMayStillRun = false,
  ) {
    super(message);
    this.name = "VolcengineArkVideoError";
  }
}

export type ArkVideoResponseEvidence = Readonly<{
  contentType?: string;
  failureStage?: string;
  fieldPaths: readonly string[];
  httpStatus?: number;
  providerRequestId?: string;
  responseBytes?: number;
  structureHash?: string;
}>;

type ArkVideoResponseEvidenceCallback = (
  evidence: ArkVideoResponseEvidence,
) => void;

const providerTaskPattern = /^[a-z0-9._-]{3,160}$/i;

const providerRole = {
  "first-frame": "first_frame",
  "last-frame": "last_frame",
  "reference-audio": "reference_audio",
  "reference-image": "reference_image",
  "reference-video": "reference_video",
  // Ark has no `subject` role. Product-level subject inputs are deliberately
  // lowered to the matching official reference role in mediaContent().
  subject: undefined,
} as const;

function safeProviderMediaUrl(
  kind: ArkVideoMediaInput["kind"],
  value: unknown,
  limits: ArkVideoLimits,
) {
  if (typeof value !== "string") return false;
  if (
    kind === "image" &&
    value.startsWith("data:image/png;base64,") &&
    value.length <=
      Math.ceil(limits.maxBytes.image / 3) * 4 + 128
  ) {
    return /^[a-z0-9+/]+=*$/i.test(value.slice("data:image/png;base64,".length));
  }
  if (
    kind === "audio" &&
    (value.startsWith("data:audio/mp3;base64,") ||
      value.startsWith("data:audio/wav;base64,")) &&
    value.length <=
      Math.ceil(limits.maxBytes.audio / 3) * 4 + 128
  ) {
    return /^[a-z0-9+/]+=*$/i.test(value.slice(value.indexOf(",") + 1));
  }
  if (value.length > 4_000) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password;
  } catch {
    return false;
  }
}

function mediaReferenceUrl(
  mediaKind: ArkVideoMediaInput["kind"],
  value: unknown,
  limits: ArkVideoLimits,
) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const reference = value as Partial<ArkVideoReference>;
  if (reference.kind === "trusted-asset") {
    if (
      mediaKind !== "image" ||
      typeof reference.bindingId !== "string" ||
      !/^[a-z0-9._-]{1,160}$/i.test(reference.bindingId) ||
      typeof reference.providerAssetId !== "string" ||
      !/^[a-z0-9._-]{3,160}$/i.test(reference.providerAssetId)
    ) return undefined;
    return `asset://${reference.providerAssetId}`;
  }
  if (
    (reference.kind !== "inline-data" && reference.kind !== "public-url") ||
    typeof reference.value !== "string" ||
    !safeProviderMediaUrl(mediaKind, reference.value, limits)
  ) return undefined;
  if (
    reference.kind === "inline-data" && !reference.value.startsWith("data:") ||
    reference.kind === "public-url" && !reference.value.startsWith("https://")
  ) return undefined;
  return reference.value;
}

function normalizeMediaInputs(
  value: unknown,
  limits: ArkVideoLimits = defaultArkVideoLimits,
): ArkVideoMediaInput[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 15) {
    throw new VolcengineArkVideoError("FORMAT", "视频参考素材数量无效");
  }
  const seenOrders = new Set<number>();
  const singularRoles = new Set<string>();
  const counts = { audio: 0, image: 0, video: 0 };
  const normalized = value.map((raw): ArkVideoMediaInput => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new VolcengineArkVideoError("FORMAT", "视频参考素材无效");
    }
    const item = raw as Partial<ArkVideoMediaInput>;
    if (
      (item.kind !== "audio" && item.kind !== "image" && item.kind !== "video") ||
      !Number.isSafeInteger(item.order) ||
      Number(item.order) < 1 ||
      seenOrders.has(Number(item.order)) ||
      typeof item.role !== "string" ||
      !(item.role in providerRole) ||
      !mediaReferenceUrl(
        item.kind as ArkVideoMediaInput["kind"],
        item.reference,
        limits,
      )
    ) {
      throw new VolcengineArkVideoError("FORMAT", "视频参考素材无效");
    }
    const role = item.role as ArkVideoMediaInput["role"];
    const roleMatchesKind = item.kind === "image"
      ? ["first-frame", "last-frame", "reference-image", "subject"].includes(role)
      : item.kind === "video"
        ? ["reference-video", "subject"].includes(role)
        : role === "reference-audio";
    if (!roleMatchesKind) {
      throw new VolcengineArkVideoError("FORMAT", "视频参考素材角色无效");
    }
    if (["first-frame", "last-frame", "subject"].includes(role)) {
      const singularKey = role === "subject" ? `${item.kind}:${role}` : role;
      if (singularRoles.has(singularKey)) {
        throw new VolcengineArkVideoError("FORMAT", "视频参考素材角色重复");
      }
      singularRoles.add(singularKey);
    }
    const kind = item.kind as ArkVideoMediaInput["kind"];
    counts[kind] += 1;
    seenOrders.add(Number(item.order));
    return {
      kind,
      order: Number(item.order),
      reference: item.reference as ArkVideoReference,
      role,
    };
  }).sort((left, right) => left.order - right.order);
  if (
    counts.image > limits.counts.image ||
    counts.video > limits.counts.video ||
    counts.audio > limits.counts.audio
  ) {
    throw new VolcengineArkVideoError("FORMAT", "视频参考素材超过当前模型上限");
  }
  return normalized;
}

function mediaContent(input: ArkVideoMediaInput) {
  const role = input.role === "subject"
    ? input.kind === "image"
      ? "reference_image"
      : "reference_video"
    : providerRole[input.role];
  const url = input.reference.kind === "trusted-asset"
    ? `asset://${input.reference.providerAssetId}`
    : input.reference.value;
  if (input.kind === "image") {
    return { image_url: { url }, role, type: "image_url" };
  }
  if (input.kind === "video") {
    return { role, type: "video_url", video_url: { url } };
  }
  return { audio_url: { url }, role, type: "audio_url" };
}

async function limitedJson(
  response: Response,
  deadline: ProviderRequestDeadline,
  onProviderResponseEvidence?: ArkVideoResponseEvidenceCallback,
) {
  const baseEvidence = arkResponseEvidenceBase(response);
  if (!response.body) {
    onProviderResponseEvidence?.({
      ...baseEvidence,
      failureStage: "response-body",
      responseBytes: 0,
    });
    throw new VolcengineArkVideoError("FORMAT", "方舟没有返回可读数据");
  }
  const reader = deadline.wrapStream(response.body).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 2 * 1_024 * 1_024) {
      void reader.cancel().catch(() => undefined);
      onProviderResponseEvidence?.({
        ...baseEvidence,
        failureStage: "response-size",
        responseBytes: size,
      });
      throw new VolcengineArkVideoError("FORMAT", "方舟返回数据过大");
    }
    chunks.push(value);
  }
  try {
    const body = JSON.parse(
      Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8"),
    ) as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new VolcengineArkVideoError("FORMAT", "方舟返回格式无法识别");
    }
    const fieldPaths = responseStructure(body);
    onProviderResponseEvidence?.({
      ...baseEvidence,
      fieldPaths,
      responseBytes: size,
      structureHash: createHash("sha256")
        .update(JSON.stringify(fieldPaths))
        .digest("hex"),
    });
    return body as Record<string, unknown>;
  } catch {
    onProviderResponseEvidence?.({
      ...baseEvidence,
      failureStage: "response-format",
      responseBytes: size,
    });
    throw new VolcengineArkVideoError("FORMAT", "方舟返回格式无法识别");
  }
}

async function discardResponseBodySize(
  response: Response,
  deadline: ProviderRequestDeadline,
) {
  if (!response.body) return 0;
  try {
    const reader = deadline.wrapStream(response.body).getReader();
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) return size;
      size += value.byteLength;
      if (size > 2 * 1_024 * 1_024) {
        void reader.cancel().catch(() => undefined);
        return size;
      }
    }
  } catch {
    return undefined;
  }
}

function cleanResponseHeader(value: string | null) {
  const normalized = value?.replace(/[^A-Za-z0-9._:/+;= -]/g, "").trim();
  return normalized ? normalized.slice(0, 160) : undefined;
}

function arkResponseEvidenceBase(response: Response) {
  return {
    contentType: cleanResponseHeader(response.headers.get("content-type")),
    fieldPaths: [] as readonly string[],
    httpStatus: response.status,
    providerRequestId: cleanResponseHeader(
      response.headers.get("x-request-id") ??
        response.headers.get("x-trace-id") ??
        response.headers.get("request-id"),
    ),
  };
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
    if (item && typeof item === "object") {
      for (const key of Object.keys(item).sort().slice(0, 64)) {
        const next = path ? `${path}.${key}` : key;
        paths.push(next);
        visit((item as Record<string, unknown>)[key], next, depth + 1);
      }
      return;
    }
    paths.push(`${path || "$"}:${item === null ? "null" : typeof item}`);
  };
  visit(value, "", 0);
  return [...new Set(paths)].sort();
}

async function requestJson(
  profile: ProviderProfile,
  path: string,
  init: RequestInit,
  fetcher: typeof fetch,
  operation: ProviderRequestOperation,
  beforeProviderRequest?: () => void,
  deadlineOptions?: ProviderRequestDeadlineOverrides,
  onProviderResponseEvidence?: ArkVideoResponseEvidenceCallback,
) {
  if (profile.driver !== "volcengine-ark") {
    throw new VolcengineArkVideoError("FORMAT", "当前平台不支持方舟视频生成");
  }
  if (init.signal?.aborted) {
    throw new VolcengineArkVideoError("CANCELLED", "视频任务已取消");
  }
  beforeProviderRequest?.();
  try {
    return await withProviderRequestDeadline({
      ...deadlineOptions,
      operation,
      signal: init.signal ?? undefined,
    }, async (deadline) => {
      const response = await deadline.race(fetcher(`${profile.baseUrl}${path}`, {
        ...init,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${profile.apiKey}`,
          "Content-Type": "application/json",
          ...init.headers,
        },
        redirect: "error",
        signal: deadline.signal,
      }));
      const baseEvidence = arkResponseEvidenceBase(response);
      if (response.status === 401 || response.status === 403) {
        const responseBytes = await discardResponseBodySize(response, deadline);
        onProviderResponseEvidence?.({
          ...baseEvidence,
          failureStage: "http-status",
          ...(responseBytes === undefined ? {} : { responseBytes }),
        });
        throw new VolcengineArkVideoError("AUTH", "火山方舟授权失败");
      }
      if (response.status === 429) {
        const responseBytes = await discardResponseBodySize(response, deadline);
        onProviderResponseEvidence?.({
          ...baseEvidence,
          failureStage: "http-status",
          ...(responseBytes === undefined ? {} : { responseBytes }),
        });
        throw new VolcengineArkVideoError("RATE_LIMIT", "火山方舟正在限流，请稍后再试");
      }
      if (!response.ok) {
        const responseBytes = await discardResponseBodySize(response, deadline);
        onProviderResponseEvidence?.({
          ...baseEvidence,
          failureStage: "http-status",
          ...(responseBytes === undefined ? {} : { responseBytes }),
        });
        throw new VolcengineArkVideoError("REMOTE", "火山方舟暂时无法处理视频任务");
      }
      if (response.status === 204) {
        onProviderResponseEvidence?.({ ...baseEvidence, responseBytes: 0 });
        return {};
      }
      return limitedJson(response, deadline, onProviderResponseEvidence);
    });
  } catch (error) {
    if (error instanceof VolcengineArkVideoError) {
      if (
        (operation === "submit" || operation === "poll") &&
        error.code === "FORMAT"
      ) {
        throw new VolcengineArkVideoError(error.code, error.message, true);
      }
      throw error;
    }
    if (error instanceof ProviderRequestDeadlineError) {
      throw new VolcengineArkVideoError(
        error.code,
        error.code === "TIMEOUT" ? "火山方舟请求超时" : "视频任务已取消",
        operation === "submit",
      );
    }
    if (init.signal?.aborted) {
      throw new VolcengineArkVideoError(
        "CANCELLED",
        "视频任务已取消",
        operation === "submit",
      );
    }
    throw new VolcengineArkVideoError(
      "NETWORK",
      "无法连接火山方舟",
      operation === "submit",
    );
  }
}

export async function createVolcengineArkVideoTask(
  profile: ProviderProfile,
  input: {
    duration?: number;
    generateAudio?: boolean;
    inputs?: ArkVideoMediaInput[];
    limits?: ArkVideoLimits;
    model: string;
    prompt: string;
    ratio?: string;
    resolution?: string;
  },
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
  beforeProviderRequest?: () => void,
  deadlineOptions?: ProviderRequestDeadlineOverrides,
  onProviderResponseEvidence?: ArkVideoResponseEvidenceCallback,
) {
  const prompt = input.prompt.trim();
  const duration = input.duration ?? 5;
  const ratio = input.ratio ?? "16:9";
  const resolution = input.resolution ?? "480p";
  const limits = input.limits ?? defaultArkVideoLimits;
  const mediaInputs = normalizeMediaInputs(input.inputs, limits);
  if (
    !prompt ||
    prompt.length > 10_000 ||
    !/^doubao-seedance-[a-z0-9-]+$/i.test(input.model) ||
    !Number.isInteger(duration) ||
    duration < limits.durationMin ||
    duration > limits.durationMax ||
    !limits.ratios.includes(ratio) ||
    !limits.resolutions.includes(resolution) ||
    (input.generateAudio !== undefined && typeof input.generateAudio !== "boolean")
  ) {
    throw new VolcengineArkVideoError("FORMAT", "视频生成参数无效");
  }
  const serializedBody = JSON.stringify({
    content: [
      { text: prompt, type: "text" },
      ...mediaInputs.map(mediaContent),
    ],
    duration,
    generate_audio: input.generateAudio !== false,
    model: input.model,
    ratio,
    resolution,
    watermark: false,
  });
  if (Buffer.byteLength(serializedBody, "utf8") > 64 * 1_024 * 1_024) {
    throw new VolcengineArkVideoError("FORMAT", "视频生成请求内容超过平台上限");
  }
  const body = await requestJson(
    profile,
    "/contents/generations/tasks",
    {
      body: serializedBody,
      method: "POST",
      signal,
    },
    fetcher,
    "submit",
    beforeProviderRequest,
    deadlineOptions,
    onProviderResponseEvidence,
  );
  const id = typeof body.id === "string" ? body.id : "";
  if (!providerTaskPattern.test(id)) {
    throw new VolcengineArkVideoError(
      "FORMAT",
      "方舟没有返回视频任务编号",
      true,
    );
  }
  return { id };
}

export async function getVolcengineArkVideoTask(
  profile: ProviderProfile,
  providerTaskId: string,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
  deadlineOptions?: ProviderRequestDeadlineOverrides,
  onProviderResponseEvidence?: ArkVideoResponseEvidenceCallback,
): Promise<ArkVideoStatus> {
  if (!providerTaskPattern.test(providerTaskId)) {
    throw new VolcengineArkVideoError("FORMAT", "方舟视频任务编号无效");
  }
  const body = await requestJson(
    profile,
    `/contents/generations/tasks/${encodeURIComponent(providerTaskId)}`,
    { method: "GET", signal },
    fetcher,
    "poll",
    undefined,
    deadlineOptions,
    onProviderResponseEvidence,
  );
  const state = String(body.status ?? "") as ArkVideoStatus["state"];
  if (!["queued", "running", "cancelled", "succeeded", "failed"].includes(state)) {
    throw new VolcengineArkVideoError("FORMAT", "方舟视频任务状态无法识别");
  }
  const content = body.content && typeof body.content === "object"
    ? body.content as Record<string, unknown>
    : {};
  const usage = body.usage && typeof body.usage === "object"
    ? body.usage as Record<string, unknown>
    : {};
  const error = body.error && typeof body.error === "object"
    ? body.error as Record<string, unknown>
    : {};
  const usageTokens = Number(usage.total_tokens ?? usage.completion_tokens);
  const videoUrl = typeof content.video_url === "string" ? content.video_url : undefined;
  if (videoUrl && (!videoUrl.startsWith("https://") || videoUrl.length > 2_000)) {
    throw new VolcengineArkVideoError("FORMAT", "方舟返回的视频地址无效");
  }
  return {
    errorCode: typeof error.code === "string" ? error.code.slice(0, 80) : undefined,
    errorMessage: state === "failed" ? "火山方舟未完成本次视频生成" : undefined,
    providerUsageTokens:
      Number.isSafeInteger(usageTokens) && usageTokens >= 0 ? usageTokens : undefined,
    state,
    videoUrl,
  };
}

export async function cancelVolcengineArkVideoTask(
  profile: ProviderProfile,
  providerTaskId: string,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
  deadlineOptions?: ProviderRequestDeadlineOverrides,
  onProviderResponseEvidence?: ArkVideoResponseEvidenceCallback,
) {
  if (!providerTaskPattern.test(providerTaskId)) {
    throw new VolcengineArkVideoError("FORMAT", "方舟视频任务编号无效");
  }
  await requestJson(
    profile,
    `/contents/generations/tasks/${encodeURIComponent(providerTaskId)}`,
    { method: "DELETE", signal },
    fetcher,
    "cancel",
    undefined,
    deadlineOptions,
    onProviderResponseEvidence,
  );
}

export const seedanceMiniAudioPriceMicrounitsPerThousandTokens = 14_000;
