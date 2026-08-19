import { realpathSync } from "node:fs";
import { relative, sep } from "node:path";
import {
  fetchPublicHttps,
  OutboundDestinationError,
  safePublicHttpsUrl,
  type DestinationResolver,
  type PublicHttpsFetchDependencies,
} from "./outboundNetwork";
import {
  createProviderRequestDeadline,
  ProviderRequestDeadlineError,
  type ProviderRequestDeadlineOverrides,
} from "./providerRequestDeadline";
import { waitForProviderDelay } from "./providerRequestDeadline";

export type ProviderResultMediaKind = "audio" | "image" | "video";

export class ProviderResultMediaError extends Error {
  constructor(
    readonly code:
      | "CANCELLED"
      | "FORMAT"
      | "NETWORK"
      | "PROXY_CONFIGURATION"
      | "REMOTE"
      | "TIMEOUT",
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

function injectedTestFetcherAllowed() {
  if (process.env.UNBOUNDRY_SAFE_TEST !== "1") return false;
  const dataDirectory = process.env.UNBOUNDRY_DATA_DIR;
  const testRoot = process.env.UNBOUNDRY_TEST_ROOT;
  const temporaryRoot = process.env.UNBOUNDRY_SYSTEM_TEMPORARY_ROOT;
  if (!dataDirectory || !testRoot || !temporaryRoot) return false;
  try {
    const realDataDirectory = realpathSync(dataDirectory);
    const realTestRoot = realpathSync(testRoot);
    const realTemporaryRoot = realpathSync(temporaryRoot);
    const isInside = (parent: string, child: string) => {
      const path = relative(parent, child);
      return path !== "" && path !== ".." && !path.startsWith(`..${sep}`);
    };
    return isInside(realTemporaryRoot, realTestRoot) &&
      isInside(realTestRoot, realDataDirectory);
  } catch {
    return false;
  }
}

export function safeProviderResultUrl(value: string, apiKey: string) {
  if (
    !value ||
    value.length > 8_192 ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    /%25/i.test(value) ||
    containsSecret(value, apiKey)
  ) {
    throw new ProviderResultMediaError("FORMAT", "模型结果地址无效");
  }
  try {
    const url = safePublicHttpsUrl(value);
    if ([url.href, url.host, url.hostname, url.pathname, url.search].some(
      (part) => containsSecret(part, apiKey),
    )) {
      throw new ProviderResultMediaError("FORMAT", "模型结果地址无效");
    }
    return url;
  } catch {
    throw new ProviderResultMediaError("FORMAT", "模型结果地址无效");
  }
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
  deadlineOptions?: ProviderRequestDeadlineOverrides;
  kind: ProviderResultMediaKind;
  network?: Omit<PublicHttpsFetchDependencies, "fetcher">;
  resolver?: DestinationResolver;
  signal?: AbortSignal;
  /** Offline fixture seam. Runtime use requires the safe-test and temp-data gates. */
  testFetcher?: typeof fetch;
  url: string;
}) {
  const url = safeProviderResultUrl(input.url, input.apiKey);
  if (input.testFetcher && !injectedTestFetcherAllowed()) {
    throw new ProviderResultMediaError("FORMAT", "模型结果地址无效");
  }
  if (input.signal?.aborted) {
    throw new ProviderResultMediaError("CANCELLED", "已停止等待模型结果");
  }
  const deadline = createProviderRequestDeadline({
    ...input.deadlineOptions,
    operation: "result-download",
    signal: input.signal,
    timeoutMs: input.deadlineOptions?.timeoutMs ?? 60_000,
  });
  const attempt = async () => {
    const response = await deadline.race(fetchPublicHttps(url, {
      headers: {
        Accept: input.kind === "image"
          ? "image/png"
          : input.kind === "video"
            ? "video/mp4"
            : "audio/*",
      },
      method: "GET",
      redirect: "error",
      signal: deadline.signal,
    }, {
      ...input.network,
      fetcher: input.testFetcher,
      resolver: input.resolver ?? input.network?.resolver,
    }));
    if (!response.ok || !response.body) {
      if (response.body) void response.body.cancel().catch(() => undefined);
      const error = new ProviderResultMediaError("REMOTE", "模型结果暂时无法下载");
      Object.assign(error, { status: response.status });
      throw error;
    }
    const declared = normalizedContentType(input.expectedContentType ?? "");
    const received = normalizedContentType(response.headers.get("content-type"));
    const contentType = received === "application/octet-stream" ? declared : received;
    if (!acceptedTypes(input.kind).has(contentType)) {
      void response.body.cancel().catch(() => undefined);
      throw new ProviderResultMediaError("FORMAT", "模型结果格式不受支持");
    }
    return {
      body: deadline.wrapStream(response.body, (error) =>
        error instanceof ProviderRequestDeadlineError
          ? new ProviderResultMediaError(
              error.code,
              error.code === "TIMEOUT" ? "模型结果下载超时" : "已停止等待模型结果",
            )
          : error
      ),
      contentType,
    };
  };
  let lastError: unknown;
  for (let attemptNumber = 0; attemptNumber < 3; attemptNumber += 1) {
    if (attemptNumber > 0) {
      await waitForProviderDelay(
        attemptNumber === 1 ? 2_000 : attemptNumber === 2 ? 4_000 : 8_000,
        deadline.signal,
      );
    }
    try {
      return await attempt();
    } catch (error) {
      const retryable = error instanceof ProviderResultMediaError &&
        (
          error.code === "NETWORK" ||
          (
            error.code === "REMOTE" &&
            typeof (error as ProviderResultMediaError & { status?: number }).status === "number" &&
            (error as ProviderResultMediaError & { status?: number }).status! >= 500
          )
        );
      if (!retryable) {
        deadline.complete();
        if (error instanceof ProviderResultMediaError) throw error;
        if (error instanceof ProviderRequestDeadlineError) {
          throw new ProviderResultMediaError(
            error.code,
            error.code === "TIMEOUT" ? "模型结果下载超时" : "已停止等待模型结果",
          );
        }
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
      lastError = error;
    }
  }
  deadline.complete();
  throw lastError;
}
