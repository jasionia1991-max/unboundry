import { isIP } from "node:net";
import {
  fetchPublicHttps,
  OutboundDestinationError,
  type DestinationResolver,
} from "./outboundNetwork";

export type ProviderResultMediaKind = "audio" | "image" | "video";

export class ProviderResultMediaError extends Error {
  constructor(
    readonly code:
      | "CANCELLED"
      | "FORMAT"
      | "NETWORK"
      | "PROXY_CONFIGURATION"
      | "REMOTE",
    message: string,
  ) {
    super(message);
    this.name = "ProviderResultMediaError";
  }
}

function containsSecret(value: string, secret: string) {
  if (!secret) return false;
  if (value.includes(secret) || value.includes(encodeURIComponent(secret))) {
    return true;
  }
  try {
    return decodeURIComponent(value).includes(secret);
  } catch {
    return false;
  }
}

function privateIpv4(address: string) {
  const parts = address.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) return true;
  const [a, b] = parts;
  return a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224;
}

function privateIp(address: string) {
  const family = isIP(address);
  if (family === 4) return privateIpv4(address);
  if (family !== 6) return true;
  const normalized = address.toLowerCase();
  if (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/.test(normalized)
  ) return true;
  const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  return mapped ? privateIpv4(mapped) : false;
}

export function safeProviderResultUrl(value: string, apiKey: string) {
  if (!value || value.length > 8_192 || containsSecret(value, apiKey)) {
    throw new ProviderResultMediaError("FORMAT", "模型结果地址无效");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ProviderResultMediaError("FORMAT", "模型结果地址无效");
  }
  const hostname = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    (isIP(hostname) > 0 && privateIp(hostname))
  ) {
    throw new ProviderResultMediaError("FORMAT", "模型结果地址无效");
  }
  return url;
}

function acceptedTypes(kind: ProviderResultMediaKind) {
  return kind === "image"
    ? new Set(["image/png"])
    : kind === "video"
      ? new Set(["video/mp4"])
      : new Set([
          "audio/aac",
          "audio/mp4",
          "audio/mpeg",
          "audio/ogg",
          "audio/wav",
        ]);
}

function normalizedContentType(value: string | null) {
  const normalized = String(value ?? "").split(";", 1)[0].trim().toLowerCase();
  return normalized === "application/ogg" || normalized === "audio/opus"
    ? "audio/ogg"
    : normalized;
}

export async function downloadProviderResultMedia(input: {
  apiKey: string;
  expectedContentType?: string;
  fetcher?: typeof fetch;
  kind: ProviderResultMediaKind;
  resolver?: DestinationResolver;
  signal?: AbortSignal;
  url: string;
}) {
  const url = safeProviderResultUrl(input.url, input.apiKey);
  if (input.signal?.aborted) {
    throw new ProviderResultMediaError("CANCELLED", "已停止等待模型结果");
  }
  let response: Response;
  try {
    response = await fetchPublicHttps(url, {
      headers: {
        Accept: input.kind === "image"
          ? "image/png"
          : input.kind === "video"
            ? "video/mp4"
            : "audio/*",
      },
      method: "GET",
      redirect: "error",
      signal: input.signal,
    }, {
      fetcher: input.fetcher,
      resolver: input.resolver,
    });
  } catch (error) {
    if (input.signal?.aborted) {
      throw new ProviderResultMediaError("CANCELLED", "已停止等待模型结果");
    }
    if (error instanceof OutboundDestinationError) {
      throw new ProviderResultMediaError(
        error.code,
        error.code === "FORMAT"
          ? "模型结果地址不可安全访问"
          : error.code === "PROXY_CONFIGURATION"
            ? "本机代理地址模式阻止安全下载"
          : "模型结果地址暂时无法解析",
      );
    }
    throw new ProviderResultMediaError("NETWORK", "模型结果暂时无法下载");
  }
  if (!response.ok || !response.body) {
    throw new ProviderResultMediaError("REMOTE", "模型结果暂时无法下载");
  }
  const declared = normalizedContentType(input.expectedContentType ?? "");
  const received = normalizedContentType(response.headers.get("content-type"));
  const contentType = received === "application/octet-stream" ? declared : received;
  if (!acceptedTypes(input.kind).has(contentType)) {
    try {
      await response.body.cancel();
    } catch {
      // The result is rejected regardless of whether the remote stream closes.
    }
    throw new ProviderResultMediaError("FORMAT", "模型结果格式不受支持");
  }
  return { body: response.body, contentType };
}
