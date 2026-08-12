import type { ProviderProfile } from "./providerProfiles";
import {
  ProviderRequestDeadlineError,
  type ProviderRequestDeadline,
  type ProviderRequestDeadlineOverrides,
  type ProviderRequestOperation,
  withProviderRequestDeadline,
} from "./providerRequestDeadline";
import {
  downloadProviderResultMedia,
  ProviderResultMediaError,
  safeProviderResultUrl,
} from "./providerResultMedia";
import type { PublicHttpsFetchDependencies } from "./outboundNetwork";

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

export type MurekaAudioResultDownloadOptions = {
  deadlineOptions?: ProviderRequestDeadlineOverrides;
  network?: Omit<PublicHttpsFetchDependencies, "fetcher">;
  signal?: AbortSignal;
};

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
  constructor(
    public readonly code: MurekaAudioErrorCode,
    providerMessage?: string,
  ) {
    // Provider text is sanitized and length-capped before it may reach the UI;
    // the local default remains the fallback whenever no safe message exists.
    super(providerMessage || murekaAudioErrorMessages[code]);
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

async function limitedJson(
  response: Response,
  deadline: ProviderRequestDeadline,
) {
  let text = "";
  try {
    if (response.body) {
      const reader = deadline.wrapStream(response.body).getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 2 * 1024 * 1024) {
          void reader.cancel().catch(() => undefined);
          throw new MurekaAudioError("FORMAT");
        }
        chunks.push(value);
      }
      text = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
    } else {
      // A real body-less Response resolves to an empty string (FORMAT). Keeping
      // this abortable fallback also preserves safe classification for injected
      // Response-like fixtures whose body accessor/read fails.
      text = await deadline.race(response.text());
    }
  } catch (error) {
    if (
      error instanceof MurekaAudioError ||
      error instanceof ProviderRequestDeadlineError
    ) throw error;
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
  operation: ProviderRequestOperation,
  beforeProviderRequest?: () => void,
  deadlineOptions?: ProviderRequestDeadlineOverrides,
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
  try {
    return await withProviderRequestDeadline({
      ...deadlineOptions,
      operation,
      signal: init.signal ?? undefined,
    }, async (deadline) => {
      const response = await deadline.race(fetcher(`${profile.baseUrl}${endpoint}`, {
        ...init,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${profile.apiKey}`,
          ...(init.body ? { "Content-Type": "application/json" } : {}),
        },
        redirect: "error",
        signal: deadline.signal,
      }));
      const body = await limitedJson(response, deadline);
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
        const message = body && typeof body === "object" &&
            !Array.isArray(body) &&
            typeof (body as Record<string, unknown>).message === "string"
          ? String((body as Record<string, unknown>).message)
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 200)
          : "";
        // 远端文本可能回显请求密钥：AUTH 一律使用本地友好文案；
        // 其余情况只要包含密钥就丢弃远端文本，防止密钥进入 UI/日志。
        const safeMessage =
          code === "AUTH" || containsProviderKey(message, profile.apiKey ?? "")
            ? ""
            : message;
        throw new MurekaAudioError(code, safeMessage || undefined);
      }
      return body;
    });
  } catch (error) {
    if (error instanceof MurekaAudioError) throw error;
    if (error instanceof ProviderRequestDeadlineError) {
      throw new MurekaAudioError(error.code);
    }
    if (init.signal?.aborted) throw new MurekaAudioError("CANCELLED");
    throw new MurekaAudioError("NETWORK");
  }
}

export async function createMurekaAudioTask(
  profile: ProviderProfile,
  input: Parameters<typeof buildMurekaAudioRequest>[0],
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
  beforeProviderRequest?: () => void,
  deadlineOptions?: ProviderRequestDeadlineOverrides,
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
    "submit",
    beforeProviderRequest,
    deadlineOptions,
  );
  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (
    !/^[a-z0-9._-]{1,160}$/i.test(id) ||
    containsProviderKey(id, profile.apiKey ?? "")
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
  deadlineOptions?: ProviderRequestDeadlineOverrides,
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
    "poll",
    undefined,
    deadlineOptions,
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
  const audioUrl = typeof first?.url === "string" ? first.url : "";
  try {
    const parsed = safeProviderResultUrl(audioUrl, profile.apiKey ?? "");
    const duration = Number(first?.duration);
    return {
      audioUrl: parsed.toString(),
      durationMs: Number.isFinite(duration) && duration >= 0 ? duration : undefined,
      state: "succeeded",
    };
  } catch {
    throw new MurekaAudioError("FORMAT");
  }
}

export async function downloadMurekaAudioResult(
  profile: ProviderProfile,
  audioUrl: string,
  options: MurekaAudioResultDownloadOptions = {},
) {
  if (
    profile.driver !== "mureka" ||
    profile.baseUrl !== "https://api.mureka.ai"
  ) {
    throw new MurekaAudioError("FORMAT");
  }
  try {
    const downloaded = await downloadProviderResultMedia({
      apiKey: profile.apiKey ?? "",
      deadlineOptions: options.deadlineOptions,
      expectedContentType: "audio/mpeg",
      kind: "audio",
      network: options.network,
      signal: options.signal,
      url: audioUrl,
    });
    return downloaded.body;
  } catch (error) {
    if (error instanceof MurekaAudioError) throw error;
    if (error instanceof ProviderResultMediaError) {
      const code: MurekaAudioErrorCode = error.code === "FORMAT" ||
          error.code === "CANCELLED" ||
          error.code === "REMOTE" ||
          error.code === "TIMEOUT"
        ? error.code
        : "NETWORK";
      throw new MurekaAudioError(code);
    }
    if (options.signal?.aborted) throw new MurekaAudioError("CANCELLED");
    throw new MurekaAudioError("NETWORK");
  }
}
