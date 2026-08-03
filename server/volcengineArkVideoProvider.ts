import type { ProviderProfile } from "./providerProfiles";

export type ArkVideoStatus = {
  errorCode?: string;
  errorMessage?: string;
  providerUsageTokens?: number;
  state: "cancelled" | "failed" | "queued" | "running" | "succeeded";
  videoUrl?: string;
};

export type ArkVideoMediaInput = {
  kind: "audio" | "image" | "video";
  order: number;
  role:
    | "first-frame"
    | "last-frame"
    | "reference-audio"
    | "reference-image"
    | "reference-video"
    | "subject";
  url: string;
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
  ) {
    super(message);
    this.name = "VolcengineArkVideoError";
  }
}

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

function safeProviderMediaUrl(kind: ArkVideoMediaInput["kind"], value: unknown) {
  if (typeof value !== "string") return false;
  if (
    kind === "image" &&
    value.startsWith("data:image/png;base64,") &&
    value.length <= 28_000_000
  ) {
    return /^[a-z0-9+/]+=*$/i.test(value.slice("data:image/png;base64,".length));
  }
  if (
    kind === "audio" &&
    (value.startsWith("data:audio/mp3;base64,") ||
      value.startsWith("data:audio/wav;base64,")) &&
    value.length <= 21_100_000
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

function normalizeMediaInputs(value: unknown): ArkVideoMediaInput[] {
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
      !safeProviderMediaUrl(item.kind as ArkVideoMediaInput["kind"], item.url)
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
      role,
      url: item.url!,
    };
  }).sort((left, right) => left.order - right.order);
  if (counts.image > 9 || counts.video > 3 || counts.audio > 3) {
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
  if (input.kind === "image") {
    return { image_url: { url: input.url }, role, type: "image_url" };
  }
  if (input.kind === "video") {
    return { role, type: "video_url", video_url: { url: input.url } };
  }
  return { audio_url: { url: input.url }, role, type: "audio_url" };
}

async function limitedJson(response: Response) {
  if (!response.body) {
    throw new VolcengineArkVideoError("FORMAT", "方舟没有返回可读数据");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 2 * 1_024 * 1_024) {
      await reader.cancel();
      throw new VolcengineArkVideoError("FORMAT", "方舟返回数据过大");
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(
      Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8"),
    ) as Record<string, unknown>;
  } catch {
    throw new VolcengineArkVideoError("FORMAT", "方舟返回格式无法识别");
  }
}

async function requestJson(
  profile: ProviderProfile,
  path: string,
  init: RequestInit,
  fetcher: typeof fetch,
  beforeProviderRequest?: () => void,
) {
  if (profile.driver !== "volcengine-ark") {
    throw new VolcengineArkVideoError("FORMAT", "当前平台不支持方舟视频生成");
  }
  if (init.signal?.aborted) {
    throw new VolcengineArkVideoError("CANCELLED", "视频任务已取消");
  }
  beforeProviderRequest?.();
  try {
    const response = await fetcher(`${profile.baseUrl}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${profile.apiKey}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
      redirect: "error",
    });
    if (response.status === 401 || response.status === 403) {
      throw new VolcengineArkVideoError("AUTH", "火山方舟授权失败");
    }
    if (response.status === 429) {
      throw new VolcengineArkVideoError("RATE_LIMIT", "火山方舟正在限流，请稍后再试");
    }
    if (!response.ok) {
      throw new VolcengineArkVideoError("REMOTE", "火山方舟暂时无法处理视频任务");
    }
    if (response.status === 204) return {};
    return limitedJson(response);
  } catch (error) {
    if (error instanceof VolcengineArkVideoError) throw error;
    if (init.signal?.aborted) {
      throw new VolcengineArkVideoError("CANCELLED", "视频任务已取消");
    }
    throw new VolcengineArkVideoError("NETWORK", "无法连接火山方舟");
  }
}

export async function createVolcengineArkVideoTask(
  profile: ProviderProfile,
  input: {
    duration?: number;
    generateAudio?: boolean;
    inputs?: ArkVideoMediaInput[];
    model: string;
    prompt: string;
    ratio?: string;
    resolution?: string;
  },
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
  beforeProviderRequest?: () => void,
) {
  const prompt = input.prompt.trim();
  const duration = input.duration ?? 5;
  const ratio = input.ratio ?? "16:9";
  const resolution = input.resolution ?? "480p";
  const mediaInputs = normalizeMediaInputs(input.inputs);
  if (
    !prompt ||
    prompt.length > 10_000 ||
    !/^doubao-seedance-2-0-mini-[a-z0-9-]+$/i.test(input.model) ||
    !Number.isInteger(duration) ||
    duration < 4 ||
    duration > 15 ||
    !["16:9", "4:3", "1:1", "3:4", "9:16", "21:9"].includes(ratio) ||
    !["480p", "720p"].includes(resolution) ||
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
    beforeProviderRequest,
  );
  const id = typeof body.id === "string" ? body.id : "";
  if (!providerTaskPattern.test(id)) {
    throw new VolcengineArkVideoError("FORMAT", "方舟没有返回视频任务编号");
  }
  return { id };
}

export async function getVolcengineArkVideoTask(
  profile: ProviderProfile,
  providerTaskId: string,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<ArkVideoStatus> {
  if (!providerTaskPattern.test(providerTaskId)) {
    throw new VolcengineArkVideoError("FORMAT", "方舟视频任务编号无效");
  }
  const body = await requestJson(
    profile,
    `/contents/generations/tasks/${encodeURIComponent(providerTaskId)}`,
    { method: "GET", signal },
    fetcher,
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
) {
  if (!providerTaskPattern.test(providerTaskId)) {
    throw new VolcengineArkVideoError("FORMAT", "方舟视频任务编号无效");
  }
  await requestJson(
    profile,
    `/contents/generations/tasks/${encodeURIComponent(providerTaskId)}`,
    { method: "DELETE", signal },
    fetcher,
  );
}

export const seedanceMiniAudioPriceMicrounitsPerThousandTokens = 14_000;
