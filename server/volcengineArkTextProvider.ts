import type { ProviderProfile } from "./providerProfiles";
import {
  TextGenerationProviderError,
  type TextGenerationProvider,
} from "./generationProvider";
import {
  ProviderRequestDeadlineError,
  type ProviderRequestDeadline,
  type ProviderRequestDeadlineOverrides,
  withProviderRequestDeadline,
} from "./providerRequestDeadline";

export type ArkTextInput = {
  fileId?: string;
  kind: "audio" | "image" | "text" | "video";
  order: number;
  role: "context-audio" | "context-image" | "context-text" | "context-video";
  text?: string;
  url?: string;
};

export type ArkTextResult = {
  providerUsageTokens?: number;
  text: string;
};

export class VolcengineArkTextError extends Error {
  constructor(
    readonly code:
      | "AUTH"
      | "CANCELLED"
      | "FORMAT"
      | "NETWORK"
      | "PERMISSION"
      | "RATE_LIMIT"
      | "REMOTE"
      | "TIMEOUT",
    message: string,
  ) {
    super(message);
    this.name = "VolcengineArkTextError";
  }
}

const inputRoles = {
  audio: "context-audio",
  image: "context-image",
  text: "context-text",
  video: "context-video",
} as const;

function httpsUrl(value: string) {
  if (value.length > 4_000) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname) &&
      !url.username && !url.password;
  } catch {
    return false;
  }
}

function base64DataUrl(
  value: string,
  prefixes: readonly string[],
  maximumLength: number,
) {
  const prefix = prefixes.find((candidate) => value.startsWith(candidate));
  if (!prefix || value.length > maximumLength) return false;
  const encoded = value.slice(prefix.length);
  return encoded.length > 0 && encoded.length % 4 === 0 &&
    /^[a-z0-9+/]+={0,2}$/i.test(encoded);
}

function safeMediaUrl(kind: Exclude<ArkTextInput["kind"], "text">, value: unknown) {
  if (typeof value !== "string") return false;
  if (httpsUrl(value)) return true;
  if (kind === "image") {
    return base64DataUrl(
      value,
      ["data:image/png;base64,"],
      14_000_000,
    );
  }
  if (kind === "audio") {
    return base64DataUrl(
      value,
      ["data:audio/mp3;base64,", "data:audio/wav;base64,"],
      35_000_000,
    );
  }
  // Durable video inputs are exposed only as short-lived private HTTPS URLs.
  return false;
}

function normalizeInputs(value: unknown): ArkTextInput[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 64) {
    throw new VolcengineArkTextError("FORMAT", "文字上下文数量无效");
  }
  const seenOrders = new Set<number>();
  return value.map((raw): ArkTextInput => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new VolcengineArkTextError("FORMAT", "文字上下文无效");
    }
    const input = raw as Partial<ArkTextInput>;
    if (
      (input.kind !== "text" && input.kind !== "image" &&
        input.kind !== "video" && input.kind !== "audio") ||
      !Number.isSafeInteger(input.order) ||
      Number(input.order) < 1 ||
      seenOrders.has(Number(input.order)) ||
      input.role !== inputRoles[input.kind]
    ) {
      throw new VolcengineArkTextError("FORMAT", "文字上下文顺序或角色无效");
    }
    seenOrders.add(Number(input.order));
    if (input.kind === "text") {
      const text = typeof input.text === "string" ? input.text.trim() : "";
      if (
        !text ||
        text.length > 100_000 ||
        input.url !== undefined ||
        input.fileId !== undefined
      ) {
        throw new VolcengineArkTextError("FORMAT", "文字上下文内容无效");
      }
      return {
        kind: "text",
        order: Number(input.order),
        role: "context-text",
        text,
      };
    }
    if (input.text !== undefined) {
      throw new VolcengineArkTextError("FORMAT", "多媒体上下文内容无效");
    }
    if (input.fileId !== undefined) {
      if (
        input.kind !== "image" ||
        input.url !== undefined ||
        !/^file-[a-z0-9-]+$/i.test(input.fileId)
      ) {
        throw new VolcengineArkTextError("FORMAT", "多媒体上下文内容无效");
      }
      return {
        fileId: input.fileId,
        kind: "image",
        order: Number(input.order),
        role: "context-image",
      };
    }
    if (!safeMediaUrl(input.kind, input.url)) {
      throw new VolcengineArkTextError("FORMAT", "多媒体上下文内容无效");
    }
    return {
      kind: input.kind,
      order: Number(input.order),
      role: inputRoles[input.kind],
      url: input.url,
    };
  }).sort((left, right) => left.order - right.order);
}

function providerContent(input: ArkTextInput) {
  if (input.kind === "text") {
    return { text: input.text, type: "input_text" };
  }
  if (input.kind === "image") {
    if (input.fileId) {
      return { file_id: input.fileId, type: "input_image" };
    }
    return { image_url: input.url, type: "input_image" };
  }
  if (input.kind === "video") {
    return { type: "input_video", video_url: input.url };
  }
  return { audio_url: input.url, type: "input_audio" };
}

async function limitedJson(
  response: Response,
  deadline: ProviderRequestDeadline,
) {
  if (!response.body) {
    throw new VolcengineArkTextError("FORMAT", "方舟没有返回可读文字结果");
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
      throw new VolcengineArkTextError("FORMAT", "方舟文字结果超过安全上限");
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(
      Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8"),
    ) as Record<string, unknown>;
  } catch {
    throw new VolcengineArkTextError("FORMAT", "方舟文字结果格式无法识别");
  }
}

async function providerErrorText(
  response: Response,
  deadline: ProviderRequestDeadline,
) {
  if (!response.body) return "";
  const reader = deadline.wrapStream(response.body).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 4_096) {
      void reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(value);
  }
  try {
    const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
    const body = JSON.parse(bytes.toString("utf8")) as {
      error?: { message?: unknown };
    };
    const message = body.error?.message;
    return typeof message === "string" ? message.slice(0, 400) : "";
  } catch {
    return "";
  }
}

function outputText(body: Record<string, unknown>) {
  const output = Array.isArray(body.output) ? body.output : [];
  const parts: string[] = [];
  for (const rawMessage of output) {
    if (!rawMessage || typeof rawMessage !== "object" || Array.isArray(rawMessage)) continue;
    const message = rawMessage as Record<string, unknown>;
    if (message.type !== "message" || message.status !== "completed") continue;
    const content = Array.isArray(message.content) ? message.content : [];
    for (const rawPart of content) {
      if (!rawPart || typeof rawPart !== "object" || Array.isArray(rawPart)) continue;
      const part = rawPart as Record<string, unknown>;
      if (part.type === "output_text" && typeof part.text === "string") {
        const text = part.text.trim();
        if (text) parts.push(text);
      }
    }
  }
  const shorthand = typeof body.output_text === "string"
    ? body.output_text.trim()
    : "";
  const text = parts.length ? parts.join("\n\n") : shorthand;
  if (!text || text.length > 200_000) {
    throw new VolcengineArkTextError("FORMAT", "方舟没有返回完整文字内容");
  }
  return text;
}

export async function createVolcengineArkTextResponse(
  profile: ProviderProfile,
  input: {
    inputs?: ArkTextInput[];
    model: string;
    prompt: string;
    thinkingLevel?: "minimal" | "medium";
  },
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
  beforeProviderRequest?: () => void,
  deadlineOptions?: ProviderRequestDeadlineOverrides,
): Promise<ArkTextResult> {
  const prompt = input.prompt.trim();
  const inputs = normalizeInputs(input.inputs);
  const thinkingLevel = input.thinkingLevel ?? "medium";
  if (
    profile.driver !== "volcengine-ark" ||
    !/^doubao-seed-2-0-lite-[a-z0-9-]+$/i.test(input.model) ||
    !prompt ||
    prompt.length > 10_000 ||
    !["minimal", "medium"].includes(thinkingLevel)
  ) {
    throw new VolcengineArkTextError("FORMAT", "文字生成参数无效");
  }
  const serializedBody = JSON.stringify({
    input: [{
      content: [
        { text: prompt, type: "input_text" },
        ...inputs.map(providerContent),
      ],
      role: "user",
    }],
    model: input.model,
    // Ark's public Responses contract exposes an on/off switch. Keep the
    // historical `medium` value as the durable product value for "enabled".
    thinking: { type: thinkingLevel === "minimal" ? "disabled" : "enabled" },
  });
  if (Buffer.byteLength(serializedBody, "utf8") > 64 * 1_024 * 1_024) {
    throw new VolcengineArkTextError("FORMAT", "文字生成请求内容超过平台上限");
  }
  if (signal?.aborted) {
    throw new VolcengineArkTextError("CANCELLED", "文字生成已取消");
  }
  beforeProviderRequest?.();
  try {
    return await withProviderRequestDeadline({
      ...deadlineOptions,
      operation: "submit",
      signal,
    }, async (deadline) => {
      const response = await deadline.race(fetcher(`${profile.baseUrl}/responses`, {
        body: serializedBody,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${profile.apiKey}`,
          "Content-Type": "application/json",
        },
        method: "POST",
        redirect: "error",
        signal: deadline.signal,
      }));
      if (response.status === 401) {
        if (response.body) void response.body.cancel().catch(() => undefined);
        throw new VolcengineArkTextError(
          "AUTH",
          "火山方舟API Key无效或已失效，请由管理员更新平台连接",
        );
      }
      if (response.status === 403) {
        if (response.body) void response.body.cancel().catch(() => undefined);
        throw new VolcengineArkTextError(
          "PERMISSION",
          "当前API Key没有所选文字模型权限，请在方舟控制台开通模型服务并更新平台连接",
        );
      }
      if (response.status === 429) {
        if (response.body) void response.body.cancel().catch(() => undefined);
        throw new VolcengineArkTextError("RATE_LIMIT", "火山方舟正在限流，请稍后再试");
      }
      if (!response.ok) {
        const message = await providerErrorText(response, deadline);
        throw new VolcengineArkTextError(
          "REMOTE",
          message || "火山方舟暂时无法完成文字生成",
        );
      }
      const body = await limitedJson(response, deadline);
      if (body.status !== "completed") {
        throw new VolcengineArkTextError("FORMAT", "方舟没有返回已完成的文字结果");
      }
      const usage = body.usage && typeof body.usage === "object" && !Array.isArray(body.usage)
        ? body.usage as Record<string, unknown>
        : {};
      const tokens = Number(usage.total_tokens);
      return {
        providerUsageTokens: Number.isSafeInteger(tokens) && tokens >= 0
          ? tokens
          : undefined,
        text: outputText(body),
      };
    });
  } catch (error) {
    if (error instanceof VolcengineArkTextError) throw error;
    if (error instanceof ProviderRequestDeadlineError) {
      throw new VolcengineArkTextError(
        error.code,
        error.code === "TIMEOUT" ? "文字生成请求超时" : "文字生成已取消",
      );
    }
    if (signal?.aborted) {
      throw new VolcengineArkTextError("CANCELLED", "文字生成已取消");
    }
    throw new VolcengineArkTextError("NETWORK", "无法连接火山方舟");
  }
}

export const volcengineArkTextGenerationProvider: TextGenerationProvider = {
  id: "volcengine-ark-text",
  registrations: [{
    driver: "volcengine-ark",
    protocol: "native",
  }],
  async generate(request, execution) {
    try {
      return await createVolcengineArkTextResponse(
        execution.profile,
        {
          inputs: request.inputs.map((input): ArkTextInput => ({
            fileId: input.fileId,
            kind: input.kind,
            order: input.order,
            role: input.role,
            text: input.text,
            url: input.transientUrl,
          })),
          model: request.model,
          prompt: request.prompt,
          thinkingLevel: request.thinkingLevel,
        },
        execution.fetcher,
        execution.signal,
        execution.beforeProviderRequest,
      );
    } catch (error) {
      if (error instanceof VolcengineArkTextError) {
        throw new TextGenerationProviderError(error.code, error.message);
      }
      throw error;
    }
  },
};
