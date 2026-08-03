import type { ProviderProfile } from "./providerProfiles";

export type MurekaMusicMode =
  | "instrumental"
  | "lyrics-song"
  | "prompt-song";

export type MurekaAudioRequest = {
  endpoint:
    | "/v1/instrumental/generate"
    | "/v1/song/easy-generate"
    | "/v1/song/generate";
  payload: Record<string, boolean | number | string>;
};

export type MurekaAudioQueryKind = "instrumental" | "song";

export type MurekaAudioTaskStatus = {
  audioUrl?: string;
  durationMs?: number;
  errorMessage?: string;
  state: "cancelled" | "failed" | "pending" | "succeeded";
};

export type MurekaAudioErrorCode =
  | "AUTH"
  | "CANCELLED"
  | "FORMAT"
  | "NETWORK"
  | "RATE_LIMIT"
  | "REMOTE"
  | "TIMEOUT";

const murekaAudioErrorMessages: Record<MurekaAudioErrorCode, string> = {
  AUTH: "Mureka 授权已失效，请管理员检查连接",
  CANCELLED: "音频任务已停止等待",
  FORMAT: "Mureka 返回的数据无法安全使用",
  NETWORK: "暂时无法连接 Mureka",
  RATE_LIMIT: "Mureka 请求过于频繁，请稍后再试",
  REMOTE: "Mureka 暂未接受本次请求",
  TIMEOUT: "音频生成等待超时，可稍后继续查看",
};

export class MurekaAudioError extends Error {
  constructor(public readonly code: MurekaAudioErrorCode) {
    // Provider-controlled text must never become an application error. Keeping
    // the message derived exclusively from our local code also protects every
    // persistence and HTTP path that serializes this error later.
    super(murekaAudioErrorMessages[code]);
    this.name = "MurekaAudioError";
  }
}

const supportedModels = new Set([
  "auto",
  "mureka-7.6",
  "mureka-8",
  "mureka-9",
]);

function requiredText(value: unknown, maximum: number, message: string) {
  const resolved = typeof value === "string" ? value.trim() : "";
  if (!resolved || resolved.length > maximum) throw new Error(message);
  return resolved;
}

/**
 * Converts provider-neutral node values into an official Mureka payload.
 * This function is intentionally pure: it cannot read a key or send a request.
 */
export function buildMurekaAudioRequest(input: {
  lyrics?: unknown;
  model: unknown;
  musicGenerationMode: unknown;
  outputCount: unknown;
  prompt: unknown;
  streamPlayback: unknown;
  vocalGender?: unknown;
}): MurekaAudioRequest {
  const model = typeof input.model === "string" ? input.model.trim() : "";
  if (!supportedModels.has(model)) {
    throw new Error("Mureka model is not supported");
  }
  const outputCount = Number(input.outputCount);
  if (!Number.isInteger(outputCount) || outputCount < 1 || outputCount > 3) {
    throw new Error("Mureka output count is not supported");
  }
  const stream = input.streamPlayback === true;
  const mode = input.musicGenerationMode as MurekaMusicMode;
  if (mode === "instrumental") {
    return {
      endpoint: "/v1/instrumental/generate",
      payload: {
        model,
        n: outputCount,
        prompt: requiredText(input.prompt, 1_024, "Mureka prompt is invalid"),
        stream,
      },
    };
  }
  if (mode === "prompt-song") {
    return {
      endpoint: "/v1/song/easy-generate",
      payload: {
        model,
        n: outputCount,
        prompt: requiredText(input.prompt, 2_000, "Mureka prompt is invalid"),
        stream,
      },
    };
  }
  if (mode === "lyrics-song") {
    const gender = input.vocalGender;
    if (gender !== "female" && gender !== "male") {
      throw new Error("Mureka vocal gender is not supported");
    }
    return {
      endpoint: "/v1/song/generate",
      payload: {
        gender,
        lyrics: requiredText(input.lyrics, 5_000, "Mureka lyrics are invalid"),
        model,
        n: outputCount,
        prompt: requiredText(input.prompt, 1_024, "Mureka prompt is invalid"),
        stream,
      },
    };
  }
  throw new Error("Mureka music mode is not supported");
}

async function limitedJson(response: Response) {
  let text: string;
  try {
    text = await response.text();
  } catch {
    throw new MurekaAudioError("NETWORK");
  }
  if (Buffer.byteLength(text, "utf8") > 2 * 1024 * 1024) {
    throw new MurekaAudioError("FORMAT");
  }
  try {
    const body = JSON.parse(text) as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new MurekaAudioError("FORMAT");
    }
    return body as Record<string, unknown>;
  } catch {
    throw new MurekaAudioError("FORMAT");
  }
}

function containsProviderKey(value: string, apiKey: string) {
  if (!apiKey) return false;
  if (value.includes(apiKey) || value.includes(encodeURIComponent(apiKey))) {
    return true;
  }
  try {
    return decodeURIComponent(value).includes(apiKey);
  } catch {
    return false;
  }
}

async function murekaRequest(
  profile: ProviderProfile,
  endpoint: string,
  init: RequestInit,
  fetcher: typeof fetch,
  beforeProviderRequest?: () => void,
) {
  if (
    profile.driver !== "mureka" ||
    profile.baseUrl !== "https://api.mureka.ai"
  ) {
    throw new MurekaAudioError("FORMAT");
  }
  if (init.signal?.aborted) {
    throw new MurekaAudioError("CANCELLED");
  }
  beforeProviderRequest?.();
  let response: Response;
  try {
    response = await fetcher(`${profile.baseUrl}${endpoint}`, {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${profile.apiKey}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      redirect: "error",
    });
  } catch (error) {
    if (
      (error instanceof DOMException && error.name === "AbortError") ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      throw new MurekaAudioError("CANCELLED");
    }
    throw new MurekaAudioError("NETWORK");
  }
  const body = await limitedJson(response);
  let ok: boolean;
  let status: number;
  try {
    ok = response.ok;
    status = response.status;
  } catch {
    throw new MurekaAudioError("REMOTE");
  }
  if (!ok) {
    const code = status === 401 || status === 403
      ? "AUTH"
      : status === 429
        ? "RATE_LIMIT"
        : "REMOTE";
    throw new MurekaAudioError(code);
  }
  return body;
}

export async function createMurekaAudioTask(
  profile: ProviderProfile,
  input: Parameters<typeof buildMurekaAudioRequest>[0],
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
  beforeProviderRequest?: () => void,
) {
  const request = buildMurekaAudioRequest(input);
  const body = await murekaRequest(
    profile,
    request.endpoint,
    {
      body: JSON.stringify(request.payload),
      method: "POST",
      signal,
    },
    fetcher,
    beforeProviderRequest,
  );
  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (
    !/^[a-z0-9._-]{1,160}$/i.test(id) ||
    containsProviderKey(id, profile.apiKey)
  ) {
    throw new MurekaAudioError("FORMAT");
  }
  return {
    id,
    queryKind: request.endpoint === "/v1/instrumental/generate"
      ? "instrumental" as const
      : "song" as const,
  };
}

export async function getMurekaAudioTask(
  profile: ProviderProfile,
  taskId: string,
  queryKind: MurekaAudioQueryKind,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<MurekaAudioTaskStatus> {
  if (!/^[a-z0-9._-]{1,160}$/i.test(taskId)) {
    throw new MurekaAudioError("FORMAT");
  }
  const endpoint = queryKind === "instrumental"
    ? `/v1/instrumental/query/${encodeURIComponent(taskId)}`
    : `/v1/song/query/${encodeURIComponent(taskId)}`;
  const body = await murekaRequest(
    profile,
    endpoint,
    { method: "GET", signal },
    fetcher,
  );
  const status = typeof body.status === "string"
    ? body.status.toLowerCase()
    : "";
  if (["preparing", "queued", "running", "streaming"].includes(status)) {
    return { state: "pending" };
  }
  if (status === "cancelled") {
    return { state: "cancelled" };
  }
  if (["failed", "timeouted"].includes(status)) {
    return {
      errorMessage: status === "timeouted"
        ? "Mureka 音频生成超时"
        : "Mureka 未完成本次音频生成",
      state: "failed",
    };
  }
  if (status !== "succeeded") {
    throw new MurekaAudioError("FORMAT");
  }
  const choices = Array.isArray(body.choices) ? body.choices : [];
  const first = choices[0] as Record<string, unknown> | undefined;
  const audioUrl = typeof first?.url === "string" ? first.url.trim() : "";
  let parsed: URL;
  try {
    parsed = new URL(audioUrl);
  } catch {
    throw new MurekaAudioError("FORMAT");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    containsProviderKey(parsed.toString(), profile.apiKey)
  ) {
    throw new MurekaAudioError("FORMAT");
  }
  const duration = Number(first?.duration);
  return {
    audioUrl: parsed.toString(),
    durationMs: Number.isFinite(duration) && duration >= 0 ? duration : undefined,
    state: "succeeded",
  };
}

export async function downloadMurekaAudioResult(
  profile: ProviderProfile,
  audioUrl: string,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
) {
  let parsed: URL;
  try {
    parsed = new URL(audioUrl);
  } catch {
    throw new MurekaAudioError("FORMAT");
  }
  if (
    profile.driver !== "mureka" ||
    profile.baseUrl !== "https://api.mureka.ai" ||
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    containsProviderKey(parsed.toString(), profile.apiKey)
  ) {
    throw new MurekaAudioError("FORMAT");
  }
  if (signal?.aborted) throw new MurekaAudioError("CANCELLED");

  let response: Response;
  try {
    response = await fetcher(parsed.toString(), {
      headers: { Accept: "audio/mpeg" },
      redirect: "error",
      signal,
    });
  } catch (error) {
    if (
      (error instanceof DOMException && error.name === "AbortError") ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      throw new MurekaAudioError("CANCELLED");
    }
    throw new MurekaAudioError("NETWORK");
  }

  let body: ReadableStream<Uint8Array> | null;
  let contentType: string;
  let ok: boolean;
  try {
    contentType = String(
      response.headers.get("content-type") ?? "",
    ).toLowerCase();
    body = response.body;
    ok = response.ok;
  } catch {
    throw new MurekaAudioError("REMOTE");
  }
  if (
    !ok ||
    !body ||
    (!contentType.includes("audio") &&
      !contentType.includes("application/octet-stream"))
  ) {
    throw new MurekaAudioError("REMOTE");
  }
  return body;
}
