import type { ProviderProfile } from "./providerProfiles";

export type OpenRouterImageRequest = {
  aspectRatio?: string;
  inputReferences?: string[];
  model: string;
  prompt: string;
  quality?: "auto" | "low" | "medium" | "high";
};

export type OpenRouterImageResult = {
  actualCostMicrounits: number;
  bytes: Buffer;
  mimeType: "image/png";
};

export class OpenRouterImageError extends Error {
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
    this.name = "OpenRouterImageError";
  }
}

const aspectRatios = new Set([
  "1:1",
  "3:2",
  "2:3",
  "4:3",
  "3:4",
  "16:9",
  "9:16",
  "21:9",
  "auto",
]);
const maxResponseBytes = 30 * 1024 * 1024;
const maxImageBytes = 20 * 1024 * 1024;

async function limitedJson(response: Response) {
  if (!response.body) throw new OpenRouterImageError("FORMAT", "模型没有返回图片");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxResponseBytes) {
      await reader.cancel();
      throw new OpenRouterImageError("FORMAT", "模型返回的图片过大");
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(
      Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8"),
    ) as {
      data?: Array<{ b64_json?: string; media_type?: string }>;
      usage?: { cost?: number };
    };
  } catch {
    throw new OpenRouterImageError("FORMAT", "模型返回格式无法识别");
  }
}

export async function generateOpenRouterImage(
  profile: ProviderProfile,
  input: OpenRouterImageRequest,
  fetcher: typeof fetch = fetch,
  externalSignal?: AbortSignal,
  timeoutMs = 180_000,
  beforeProviderRequest?: () => void,
): Promise<OpenRouterImageResult> {
  if (profile.driver !== "openrouter") {
    throw new OpenRouterImageError("FORMAT", "当前平台不支持图片生成");
  }
  const prompt = input.prompt.trim();
  if (!prompt || prompt.length > 10_000 || !input.model.trim()) {
    throw new OpenRouterImageError("FORMAT", "图片生成参数无效");
  }
  const aspectRatio = aspectRatios.has(input.aspectRatio ?? "auto")
    ? input.aspectRatio ?? "auto"
    : "auto";
  const inputReferences = input.inputReferences ?? [];
  if (
    inputReferences.length > 16 ||
    inputReferences.some(
      (url) =>
        !url.startsWith("https://") &&
        !url.startsWith("http://") &&
        !url.startsWith("data:image/png;base64,"),
    )
  ) {
    throw new OpenRouterImageError("FORMAT", "参考图参数无效");
  }
  if (externalSignal?.aborted) {
    throw new OpenRouterImageError("CANCELLED", "图片生成已取消");
  }
  beforeProviderRequest?.();
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (externalSignal?.aborted) controller.abort();
  externalSignal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(
    () => controller.abort(),
    Math.max(1, Math.min(timeoutMs, 180_000)),
  );
  try {
    const response = await fetcher(`${profile.baseUrl}/images`, {
      body: JSON.stringify({
        aspect_ratio: aspectRatio,
        ...(inputReferences.length
          ? {
              input_references: inputReferences.map((url) => ({
                image_url: { url },
                type: "image_url",
              })),
            }
          : {}),
        model: input.model,
        n: 1,
        output_format: "png",
        prompt,
        quality: input.quality ?? "auto",
      }),
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${profile.apiKey}`,
        "Content-Type": "application/json",
      },
      method: "POST",
      redirect: "error",
      signal: controller.signal,
    });
    if (response.status === 401 || response.status === 403) {
      throw new OpenRouterImageError("AUTH", "模型平台授权失败");
    }
    if (response.status === 429) {
      throw new OpenRouterImageError("RATE_LIMIT", "模型平台正在限流，请稍后再试");
    }
    if (!response.ok) {
      throw new OpenRouterImageError("REMOTE", "模型平台暂时无法生成图片");
    }
    const body = await limitedJson(response);
    const image = body.data?.[0];
    if (!image?.b64_json || (image.media_type && image.media_type !== "image/png")) {
      throw new OpenRouterImageError("FORMAT", "模型没有返回可用的PNG图片");
    }
    const bytes = Buffer.from(image.b64_json, "base64");
    if (!bytes.length || bytes.length > maxImageBytes) {
      throw new OpenRouterImageError("FORMAT", "模型返回的图片大小无效");
    }
    const cost = Number(body.usage?.cost);
    if (!Number.isFinite(cost) || cost < 0) {
      throw new OpenRouterImageError("FORMAT", "模型没有返回可核对的费用");
    }
    return {
      actualCostMicrounits: Math.ceil(cost * 1_000_000),
      bytes,
      mimeType: "image/png",
    };
  } catch (error) {
    if (error instanceof OpenRouterImageError) throw error;
    if (externalSignal?.aborted) {
      throw new OpenRouterImageError("CANCELLED", "图片生成已取消");
    }
    if (controller.signal.aborted) {
      throw new OpenRouterImageError("TIMEOUT", "图片生成超时，请稍后再试");
    }
    throw new OpenRouterImageError("NETWORK", "无法连接图片生成平台");
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", cancel);
  }
}
