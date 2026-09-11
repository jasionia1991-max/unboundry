import { createHash, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import OSS from "ali-oss";
import * as urllib from "urllib";
import type { HttpClientResponse, RequestOptions } from "urllib";
import {
  fetchPublicHttps,
  preparePublicHttpsDestination,
  safeCanonicalAliyunOssEndpoint,
  safePublicHttpsUrl,
  type DestinationResolver,
  type PublicHttpsFetchDependencies,
} from "./outboundNetwork";

type MediaKind = "audio" | "image" | "video";

export type AliyunOssGenerationObjectIdentity = Readonly<{
  byteSize: number;
  checksumSha256: string;
  contentType: string;
  executionAttempt: number;
  format: string;
  kind: MediaKind;
  objectKey: string;
  ownerId: string;
  publicationId: string;
  storageProfileId: string;
  taskId: string;
}>;

export type AliyunOssPutOutcome = Readonly<{
  etag: string;
  requestId: string;
  /** Older injected upload seams omit this; the real OSS adapter always sets it. */
  status?: "adopted" | "created";
  versionId: string;
}>;

export class AliyunOssPublicationQuarantineError extends Error {
  readonly code = "OSS_IDENTITY_QUARANTINED";
  readonly reason: "HEAD_UNKNOWN" | "IDENTITY_MISMATCH" | "PUT_UNKNOWN";

  constructor(
    reason: AliyunOssPublicationQuarantineError["reason"],
    message: string,
  ) {
    super(message);
    this.name = "AliyunOssPublicationQuarantineError";
    this.reason = reason;
  }
}

export type AliyunOssCredentials = {
  accessKeyId: string;
  accessKeySecret: string;
  bucket: string;
  endpoint: string;
  region: string;
};

export type AliyunOssUrllib = {
  request: (
    url: string,
    options?: RequestOptions,
  ) => Promise<HttpClientResponse<unknown>>;
};

export type AliyunOssNetworkDependencies = {
  /** Raw signed-read seam; production uses the guarded HTTPS transport. */
  fetcher?: PublicHttpsFetchDependencies["fetcher"];
  requester?: PublicHttpsFetchDependencies["requester"];
  resolver?: DestinationResolver;
  urllib?: AliyunOssUrllib;
};

export type SafeAliyunOssConnectionError = {
  code:
    | "ACCESS_DENIED"
    | "BUCKET_NOT_FOUND"
    | "CLEANUP_FAILED"
    | "CLOCK_SKEW"
    | "INVALID_ACCESS_KEY"
    | "NETWORK_ERROR"
    | "REGION_OR_SECRET_MISMATCH"
    | "SIGNED_READ_FAILED"
    | "UNKNOWN_ERROR";
  message: string;
};

function errorField(error: unknown, field: "code" | "name") {
  if (typeof error !== "object" || error === null) return "";
  const record = error as Record<string, unknown>;
  if (typeof record[field] === "string") return record[field];
  return "";
}

export function safeAliyunOssConnectionError(
  error: unknown,
): SafeAliyunOssConnectionError {
  const code = errorField(error, "code");
  const name = errorField(error, "name");
  const identity = `${code} ${name}`;
  if (identity.includes("InvalidAccessKeyId")) {
    return {
      code: "INVALID_ACCESS_KEY",
      message: "AK不存在或已失效，请检查AccessKey ID。",
    };
  }
  if (
    identity.includes("SignatureDoesNotMatch") ||
    identity.includes("InvalidRegion")
  ) {
    return {
      code: "REGION_OR_SECRET_MISMATCH",
      message: "签名校验失败，请检查SK、Region和Endpoint是否匹配。",
    };
  }
  if (identity.includes("AccessDenied")) {
    return {
      code: "ACCESS_DENIED",
      message: "RAM账号没有完成测试所需的上传、读取或删除权限。",
    };
  }
  if (
    identity.includes("NoSuchBucket") ||
    identity.includes("InvalidBucketName")
  ) {
    return {
      code: "BUCKET_NOT_FOUND",
      message: "Bucket不存在或名称不正确，请检查Bucket和所属区域。",
    };
  }
  if (identity.includes("RequestTimeTooSkewed")) {
    return {
      code: "CLOCK_SKEW",
      message: "服务器时间偏差过大，请校准服务器时间后重试。",
    };
  }
  if (
    identity.includes("ConnectionTimeout") ||
    identity.includes("ResponseTimeout") ||
    identity.includes("SocketAssignTimeout") ||
    identity.includes("RequestError") ||
    identity.includes("ResponseError")
  ) {
    return {
      code: "NETWORK_ERROR",
      message: "服务器无法连接OSS，请检查网络和Endpoint。",
    };
  }
  if (error instanceof Error && error.message === "Signed OSS read failed") {
    return {
      code: "SIGNED_READ_FAILED",
      message: "临时文件已上传，但短时读取验证失败。",
    };
  }
  if (
    error instanceof Error &&
    error.message === "Temporary OSS object cleanup failed"
  ) {
    return {
      code: "CLEANUP_FAILED",
      message: "测试文件已创建，但自动删除失败，请检查删除权限。",
    };
  }
  return {
    code: "UNKNOWN_ERROR",
    message: "连接测试失败，请检查Bucket、区域、Endpoint和RAM权限。",
  };
}

function safeAliyunOssHosts(credentials: AliyunOssCredentials) {
  const endpoint = safeCanonicalAliyunOssEndpoint(
    credentials.endpoint,
    credentials.region,
  );
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(credentials.bucket)) {
    throw new Error("Unsafe Aliyun OSS destination");
  }
  return new Set([
    endpoint.hostname.toLowerCase(),
    `${credentials.bucket}.${endpoint.hostname}`.toLowerCase(),
  ]);
}

function safeAliyunOssRequestUrl(
  value: string,
  credentials: AliyunOssCredentials,
) {
  const url = safePublicHttpsUrl(value);
  if (!safeAliyunOssHosts(credentials).has(url.hostname.toLowerCase())) {
    throw new Error("Unsafe Aliyun OSS destination");
  }
  return url;
}

function normalizedFamily(value: number | string) {
  if (value === 4 || value === "4" || value === "IPv4") return 4;
  if (value === 6 || value === "6" || value === "IPv6") return 6;
  return 0;
}

function guardedAliyunOssUrllib(
  credentials: AliyunOssCredentials,
  dependencies: AliyunOssNetworkDependencies,
): AliyunOssUrllib {
  const transport = dependencies.urllib ?? {
    request: (url: string, options?: RequestOptions) =>
      urllib.request(url, options),
  };
  return {
    async request(value, options = {}) {
      if (process.env.URLLIB_ENABLE_PROXY) {
        throw new Error("Unsafe Aliyun OSS proxy configuration");
      }
      const url = safeAliyunOssRequestUrl(value, credentials);
      const destination = await preparePublicHttpsDestination(
        url,
        dependencies.resolver,
        AbortSignal.timeout(60_000),
      );
      return transport.request(url.toString(), {
        ...options,
        agent: false as unknown as RequestOptions["agent"],
        checkAddress: (address, family, hostname) => {
          if (hostname.toLowerCase() !== destination.hostname) return false;
          if (Array.isArray(address)) {
            const selected = address[0] as
              | { address?: unknown; family?: unknown }
              | undefined;
            return address.length === 1 &&
              selected?.address === destination.address &&
              normalizedFamily(String(selected.family)) === destination.family &&
              isIP(selected.address) === destination.family;
          }
          return address === destination.address &&
            normalizedFamily(family) === destination.family &&
            isIP(address) === destination.family;
        },
        enableProxy: false,
        followRedirect: false,
        httpsAgent: false as unknown as RequestOptions["httpsAgent"],
        lookup: destination.lookup,
        proxy: undefined,
      });
    },
  };
}

function configuredClient(
  credentials: AliyunOssCredentials,
  dependencies: AliyunOssNetworkDependencies = {},
) {
  safeAliyunOssHosts(credentials);
  const options = {
    accessKeyId: credentials.accessKeyId,
    accessKeySecret: credentials.accessKeySecret,
    authorizationV4: true,
    bucket: credentials.bucket,
    endpoint: credentials.endpoint,
    region: credentials.region,
    secure: true,
    timeout: 60_000,
    urllib: guardedAliyunOssUrllib(credentials, dependencies),
  } as ConstructorParameters<typeof OSS>[0] & {
    urllib: AliyunOssUrllib;
  };
  return new OSS(options);
}

function safeExtension(extension: string) {
  const normalized = extension.toLowerCase().replace(/^\./, "");
  if (!/^[a-z0-9]{1,8}$/.test(normalized)) {
    throw new Error("Invalid object extension");
  }
  return normalized;
}

export function createAliyunOssObjectKey(
  kind: MediaKind,
  extension: string,
  now = new Date(),
) {
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `objects/${year}/${month}/${kind}/${randomUUID()}.${safeExtension(extension)}`;
}

function errorStatus(error: unknown) {
  if (!error || typeof error !== "object") return undefined;
  const record = error as Record<string, unknown>;
  const status = Number(record.status ?? record.statusCode);
  return Number.isFinite(status) ? status : undefined;
}

const OSS_ABSENCE_RANGE = "bytes=0-0";
const OSS_ABSENCE_READ_TIMEOUT_MS = 60_000;
const OSS_ERROR_BODY_MAX_BYTES = 16 * 1024;

function cancelResponseBody(response: Response) {
  if (!response.body) return;
  try {
    void response.body.cancel().catch(() => undefined);
  } catch {
    // A body can already be closed when the status has been inspected.
  }
}

function abortReason(signal: AbortSignal) {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("OSS absence read timed out", "TimeoutError");
}

async function abortablePromise<T>(promise: Promise<T>, signal: AbortSignal) {
  if (signal.aborted) throw abortReason(signal);
  return await new Promise<T>((resolve, reject) => {
    const aborted = () => reject(abortReason(signal));
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) {
      aborted();
      return;
    }
    promise.then(
      (value) => {
        signal.removeEventListener("abort", aborted);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", aborted);
        reject(error);
      },
    );
  });
}

async function readResponseChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
) {
  if (signal.aborted) throw abortReason(signal);
  return await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
    let settled = false;
    const cancel = () => {
      if (settled) return;
      settled = true;
      try {
        void reader.cancel().catch(() => undefined);
      } catch {}
      reject(abortReason(signal));
    };
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) {
      cancel();
      return;
    }
    reader.read().then(
      (value) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", cancel);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", cancel);
        reject(error);
      },
    );
  });
}

/**
 * Read only a bounded error response. A missing-object proof must not turn a
 * failed GET into an unbounded object download. The returned bytes belong to
 * the caller and must be cleared after parsing.
 */
async function readBoundedResponseBody(
  response: Response,
  maximumBytes: number,
  signal: AbortSignal,
): Promise<Buffer | undefined> {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  const clearChunks = () => {
    for (const chunk of chunks) chunk.fill(0);
    chunks.length = 0;
  };
  let total = 0;
  try {
    while (true) {
      const { done, value } = await readResponseChunk(reader, signal);
      if (done) {
        const result = Buffer.concat(chunks);
        clearChunks();
        return result;
      }
      if (total + value.byteLength > maximumBytes) {
        try {
          void reader.cancel().catch(() => undefined);
        } catch {}
        clearChunks();
        return undefined;
      }
      const chunk = Buffer.from(value);
      total += chunk.length;
      chunks.push(chunk);
    }
  } catch (error) {
    clearChunks();
    throw error;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // A timed-out pending read may still own the lock until cancellation
      // finishes; the caller has already failed closed in that case.
    }
  }
}

type ParsedOssErrorNode = {
  readonly children: ParsedOssErrorNode[];
  readonly name: string;
  text: string;
};

function validXmlText(value: string) {
  return !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFD]/.test(value) &&
    !/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9A-Fa-f]+);)/.test(value);
}

/**
 * Parse the small, fixed OSS error envelope without adding an XML dependency.
 * We accept only a well-formed Error document with exactly one direct Code
 * and RequestId. Unknown/empty/malformed responses remain uncertain.
 */
function isConfirmedAliyunOssMissingXml(body: Buffer) {
  if (body.length === 0) return false;
  let xml = body.toString("utf8").replace(/^\uFEFF/, "").trim();
  if (!xml || !validXmlText(xml) || xml.includes("<!")) return false;
  if (xml.startsWith("<?xml")) {
    const declaration = /^<\?xml\s+version=["']1\.0["'](?:\s+encoding=["'][A-Za-z0-9._-]+["'])?(?:\s+standalone=["'](?:yes|no)["'])?\s*\?>/i.exec(xml);
    if (!declaration) return false;
    xml = xml.slice(declaration[0].length).trim();
  }
  if (!xml || xml.includes("<?")) return false;

  const tokens = /<[^>]*>|[^<]+/g;
  const stack: ParsedOssErrorNode[] = [];
  let root: ParsedOssErrorNode | undefined;
  let cursor = 0;
  for (const match of xml.matchAll(tokens)) {
    if (match.index !== cursor) return false;
    const token = match[0];
    cursor += token.length;
    if (!token.startsWith("<")) {
      if (!validXmlText(token)) return false;
      if (!stack.length && token.trim()) return false;
      if (stack.length) stack[stack.length - 1].text += token;
      continue;
    }
    if (token.startsWith("</")) {
      const closing = /^<\/([A-Za-z_][A-Za-z0-9_.:-]*)>$/.exec(token);
      if (!closing || !stack.length || stack[stack.length - 1].name !== closing[1]) return false;
      stack.pop();
      continue;
    }
    const selfClosing = /^<([A-Za-z_][A-Za-z0-9_.:-]*)\s*\/>$/.exec(token);
    const opening = selfClosing ?? /^<([A-Za-z_][A-Za-z0-9_.:-]*)>$/.exec(token);
    if (!opening) return false;
    const node: ParsedOssErrorNode = { children: [], name: opening[1], text: "" };
    if (stack.length) stack[stack.length - 1].children.push(node);
    else if (root) return false;
    else root = node;
    if (!selfClosing) stack.push(node);
  }
  if (cursor !== xml.length || stack.length || !root || root.name !== "Error") return false;
  const directText = (name: string) => {
    const matches = root!.children.filter((child) => child.name === name);
    if (matches.length !== 1 || matches[0].children.length) return "";
    const value = matches[0].text.trim();
    return value.length <= 256 && validXmlText(value) ? value : "";
  };
  const code = directText("Code");
  const requestId = directText("RequestId");
  return code === "NoSuchKey" && requestId.length > 0;
}

function aliyunOssObjectMissing(error: unknown) {
  return errorStatus(error) === 404 || [
    "NoSuchKey",
    "NoSuchObject",
    "NotFound",
  ].includes(errorField(error, "code"));
}

function aliyunOssPutConflict(error: unknown) {
  return [409, 412].includes(errorStatus(error) ?? 0) || [
    "FileAlreadyExists",
    "ObjectAlreadyExists",
    "PreconditionFailed",
  ].includes(errorField(error, "code"));
}

function assertAliyunOssGenerationIdentity(
  identity: AliyunOssGenerationObjectIdentity,
  upload: Readonly<{
    byteSize: number;
    checksumSha256: string;
    contentType: string;
    objectKey: string;
  }>,
) {
  const bounded = (value: string, maximum: number) =>
    value.length > 0 && value.length <= maximum && !/[\r\n]/.test(value);
  if (
    identity.byteSize !== upload.byteSize ||
    identity.checksumSha256 !== upload.checksumSha256 ||
    identity.contentType !== upload.contentType ||
    identity.objectKey !== upload.objectKey ||
    !Number.isSafeInteger(identity.executionAttempt) ||
    identity.executionAttempt < 1 ||
    !bounded(identity.ownerId, 120) ||
    !bounded(identity.storageProfileId, 120) ||
    !bounded(identity.publicationId, 120) ||
    !bounded(identity.taskId, 120) ||
    !bounded(identity.format, 32) ||
    !["audio", "image", "video"].includes(identity.kind)
  ) throw new Error("Invalid generated OSS identity");
}

export function aliyunOssGenerationIdentityHeaders(
  identity: AliyunOssGenerationObjectIdentity,
) {
  return {
    "x-oss-meta-unboundry-execution-attempt": String(identity.executionAttempt),
    "x-oss-meta-unboundry-media-format": identity.format,
    "x-oss-meta-unboundry-media-kind": identity.kind,
    "x-oss-meta-unboundry-owner-id": identity.ownerId,
    "x-oss-meta-unboundry-publication-id": identity.publicationId,
    "x-oss-meta-unboundry-sha256": identity.checksumSha256,
    "x-oss-meta-unboundry-storage-profile-id": identity.storageProfileId,
    "x-oss-meta-unboundry-task-id": identity.taskId,
  } as const;
}

function normalizedHeadValue(
  head: unknown,
  headerName: string,
) {
  if (!head || typeof head !== "object") return "";
  const record = head as Record<string, unknown>;
  const response = record.res && typeof record.res === "object"
    ? record.res as Record<string, unknown>
    : undefined;
  const headers = response?.headers && typeof response.headers === "object"
    ? response.headers as Record<string, unknown>
    : {};
  const metadata = record.meta && typeof record.meta === "object"
    ? record.meta as Record<string, unknown>
    : {};
  const lower = headerName.toLowerCase();
  const metadataName = lower.replace(/^x-oss-meta-/, "");
  const match = Object.entries(headers).find(([name]) =>
    name.toLowerCase() === lower
  )?.[1] ?? Object.entries(metadata).find(([name]) =>
    name.toLowerCase() === metadataName ||
    `x-oss-meta-${name.toLowerCase()}` === lower
  )?.[1];
  return typeof match === "string" || typeof match === "number"
    ? String(match)
    : "";
}

export function assertExactAliyunOssGenerationHead(
  identity: AliyunOssGenerationObjectIdentity,
  head: unknown,
) {
  const expected = aliyunOssGenerationIdentityHeaders(identity);
  for (const [name, value] of Object.entries(expected)) {
    if (normalizedHeadValue(head, name) !== value) {
      throw new AliyunOssPublicationQuarantineError(
        "IDENTITY_MISMATCH",
        `OSS generated object metadata mismatch: ${name}`,
      );
    }
  }
  if (
    normalizedHeadValue(head, "content-length") !== String(identity.byteSize) ||
    normalizedHeadValue(head, "content-type").toLowerCase() !==
      identity.contentType.toLowerCase()
  ) {
    throw new AliyunOssPublicationQuarantineError(
      "IDENTITY_MISMATCH",
      "OSS generated object size or content type mismatch",
    );
  }
}

export async function uploadPrivateAliyunOssObject(input: {
  byteSize: number;
  bytes?: Buffer;
  checksumSha256: string;
  contentType: string;
  credentials: AliyunOssCredentials;
  filePath?: string;
  generationIdentity?: AliyunOssGenerationObjectIdentity;
  objectKey: string;
  network?: AliyunOssNetworkDependencies;
}): Promise<AliyunOssPutOutcome> {
  if (!/^[a-f0-9]{64}$/.test(input.checksumSha256)) {
    throw new Error("Invalid SHA-256 checksum");
  }
  if (
    !input.objectKey.startsWith("objects/") ||
    input.objectKey.includes("..")
  ) {
    throw new Error("Invalid OSS object key");
  }
  if (
    (input.bytes === undefined) === (input.filePath === undefined) ||
    input.bytes && input.bytes.length !== input.byteSize
  ) {
    throw new Error("Invalid OSS upload source");
  }
  if (input.generationIdentity) {
    assertAliyunOssGenerationIdentity(input.generationIdentity, input);
  }
  const client = configuredClient(input.credentials, input.network);
  if (input.generationIdentity) {
    try {
      const existing = await client.head(input.objectKey);
      assertExactAliyunOssGenerationHead(input.generationIdentity, existing);
      return {
        etag: String(existing.res?.headers?.etag ?? ""),
        requestId: String(existing.res?.headers?.["x-oss-request-id"] ?? ""),
        status: "adopted",
        versionId: String(existing.res?.headers?.["x-oss-version-id"] ?? ""),
      };
    } catch (error) {
      if (error instanceof AliyunOssPublicationQuarantineError) throw error;
      if (!aliyunOssObjectMissing(error)) {
        throw new AliyunOssPublicationQuarantineError(
          "HEAD_UNKNOWN",
          "OSS object identity could not be read; the staged result is quarantined",
        );
      }
    }
  }
  let result: Awaited<ReturnType<typeof client.put>>;
  try {
    result = await client.put(
      input.objectKey,
      input.bytes ?? input.filePath!,
      {
        headers: {
          "Content-Type": input.contentType,
          "x-oss-forbid-overwrite": "true",
          "x-oss-meta-sha256": input.checksumSha256,
          ...(input.generationIdentity
            ? aliyunOssGenerationIdentityHeaders(input.generationIdentity)
            : {}),
          "x-oss-object-acl": "private",
        },
        mime: input.contentType,
      },
    );
  } catch (error) {
    if (input.generationIdentity && aliyunOssPutConflict(error)) {
      try {
        const existing = await client.head(input.objectKey);
        assertExactAliyunOssGenerationHead(input.generationIdentity, existing);
        return {
          etag: String(existing.res?.headers?.etag ?? ""),
          requestId: String(existing.res?.headers?.["x-oss-request-id"] ?? ""),
          status: "adopted",
          versionId: String(existing.res?.headers?.["x-oss-version-id"] ?? ""),
        };
      } catch (headError) {
        if (headError instanceof AliyunOssPublicationQuarantineError) {
          throw headError;
        }
        throw new AliyunOssPublicationQuarantineError(
          "HEAD_UNKNOWN",
          "Conflicting OSS object identity could not be read; the staged result is quarantined",
        );
      }
    }
    if (input.generationIdentity) {
      throw new AliyunOssPublicationQuarantineError(
        "PUT_UNKNOWN",
        "OSS PUT outcome is unknown; the staged result is quarantined without delete or overwrite",
      );
    }
    throw error;
  }
  try {
    const head = await client.head(input.objectKey);
    if (input.generationIdentity) {
      assertExactAliyunOssGenerationHead(input.generationIdentity, head);
    }
    const storedSize = Number(
      head.res?.headers?.["content-length"] ?? head.res?.headers?.["Content-Length"],
    );
    if (!Number.isFinite(storedSize) || storedSize !== input.byteSize) {
      throw new Error("OSS object verification failed");
    }
    return {
      etag: result.res?.headers?.etag ?? "",
      requestId: result.res?.headers?.["x-oss-request-id"] ?? "",
      status: "created",
      versionId: result.res?.headers?.["x-oss-version-id"] ?? "",
    };
  } catch (error) {
    if (
      input.generationIdentity &&
      !(error instanceof AliyunOssPublicationQuarantineError)
    ) {
      throw new AliyunOssPublicationQuarantineError(
        "HEAD_UNKNOWN",
        "New OSS object could not be verified; the staged result is quarantined without delete",
      );
    }
    if (!input.generationIdentity) {
      try {
        await client.delete(input.objectKey);
      } catch {}
    }
    throw error;
  }
}

export async function deletePrivateAliyunOssObject(
  objectKey: string,
  credentials: AliyunOssCredentials,
  network?: AliyunOssNetworkDependencies,
) {
  if (!objectKey.startsWith("objects/") || objectKey.includes("..")) {
    throw new Error("Invalid OSS object key");
  }
  await configuredClient(credentials, network).delete(objectKey);
}

/** Read-only fence for a download which never reached durable staging.
 * No checksum is invented and this capability can never delete an object. */
export async function assertUnstagedAliyunOssGenerationObjectAbsent(
  identity: Omit<AliyunOssGenerationObjectIdentity, "byteSize" | "checksumSha256">,
  credentials: AliyunOssCredentials,
  network?: AliyunOssNetworkDependencies,
) {
  const bounded = (value: string, maximum: number) =>
    typeof value === "string" && value.length > 0 && value.length <= maximum && !/[\r\n]/.test(value);
  if (!identity.objectKey.startsWith("objects/") || identity.objectKey.includes("..") ||
      !bounded(identity.objectKey, 1_024) || !bounded(identity.ownerId, 120) ||
      !bounded(identity.storageProfileId, 120) || !bounded(identity.publicationId, 120) ||
      !bounded(identity.taskId, 120) || !bounded(identity.contentType, 160) ||
      !/^[a-z0-9]{1,8}$/.test(identity.format) || !["image", "video", "audio"].includes(identity.kind) ||
      !Number.isSafeInteger(identity.executionAttempt) || identity.executionAttempt < 1) {
    throw new Error("Invalid unstaged OSS generation identity");
  }
  const dependencies = network ?? {};
  const client = configuredClient(credentials, dependencies);
  try {
    await client.head(identity.objectKey);
  } catch (error) {
    if (errorStatus(error) !== 404) {
      // An unavailable bucket, credentials or network is not absence. Leave
      // the partial download pending so a later recovery sweep can check again.
      throw new Error("OSS unstaged object absence could not be confirmed", {
        cause: error,
      });
    }
    // A HEAD 404 is not sufficient: ali-oss can synthesize NoSuchKey for an
    // empty error body, including a missing bucket. Re-read the same object
    // through a short, signed GET so the response carries the object scope.
    let signedUrl: string;
    try {
      signedUrl = await client.signatureUrlV4(
        "GET",
        60,
        { headers: { Range: OSS_ABSENCE_RANGE } },
        identity.objectKey,
        ["Range"],
      );
    } catch (signatureError) {
      throw new Error("OSS unstaged object absence could not be confirmed", {
        cause: signatureError,
      });
    }
    const readController = new AbortController();
    const timeout = setTimeout(() => {
      readController.abort(new DOMException("OSS absence read timed out", "TimeoutError"));
    }, OSS_ABSENCE_READ_TIMEOUT_MS);
    let response: Response;
    try {
      response = await abortablePromise(
        fetchPublicHttps(
          safeAliyunOssRequestUrl(signedUrl, credentials),
          {
            headers: { Range: OSS_ABSENCE_RANGE },
            method: "GET",
            redirect: "error",
            signal: readController.signal,
          },
          {
            fetcher: dependencies.fetcher,
            requester: dependencies.requester,
            resolver: dependencies.resolver,
          },
        ),
        readController.signal,
      );
    } catch (readError) {
      clearTimeout(timeout);
      throw new Error("OSS unstaged object absence could not be confirmed", {
        cause: readError,
      });
    }
    if (response.status === 200 || response.status === 206) {
      clearTimeout(timeout);
      cancelResponseBody(response);
      throw new AliyunOssPublicationQuarantineError(
        "IDENTITY_MISMATCH", "OSS object exists without staged identity; all evidence retained",
      );
    }
    if (response.status !== 404) {
      clearTimeout(timeout);
      cancelResponseBody(response);
      throw new Error("OSS unstaged object absence could not be confirmed");
    }
    let errorBody: Buffer | undefined;
    try {
      errorBody = await readBoundedResponseBody(
        response,
        OSS_ERROR_BODY_MAX_BYTES,
        readController.signal,
      );
    } catch (bodyError) {
      clearTimeout(timeout);
      throw new Error("OSS unstaged object absence could not be confirmed", {
        cause: bodyError,
      });
    }
    clearTimeout(timeout);
    try {
      if (errorBody && isConfirmedAliyunOssMissingXml(errorBody)) return;
    } finally {
      errorBody?.fill(0);
    }
    throw new Error("OSS unstaged object absence could not be confirmed");
  }
  throw new AliyunOssPublicationQuarantineError(
    "IDENTITY_MISMATCH", "OSS object exists without staged identity; all evidence retained",
  );
}

/**
 * Delete a generated object only after proving that the object still belongs
 * to the exact publication attempt. OSS DeleteObject has no If-Match
 * contract; when versioning is enabled the version id is the server-side
 * identity fence. A missing object is already clean; an unreadable, changed,
 * or unversioned object is quarantined by the caller instead of being removed
 * by key alone.
 */
export async function deleteExactAliyunOssGenerationObject(
  identity: AliyunOssGenerationObjectIdentity,
  credentials: AliyunOssCredentials,
  network?: AliyunOssNetworkDependencies,
) {
  assertAliyunOssGenerationIdentity(identity, identity);
  const client = configuredClient(credentials, network);
  let head: unknown;
  try {
    head = await client.head(identity.objectKey);
  } catch (error) {
    if (aliyunOssObjectMissing(error)) return;
    throw new AliyunOssPublicationQuarantineError(
      "HEAD_UNKNOWN",
      "OSS generated object identity could not be read; object retained",
    );
  }
  // This verifies every durable generation identity field, size and type
  // before the delete request is even constructed.
  assertExactAliyunOssGenerationHead(identity, head);
  const versionId = normalizedHeadValue(head, "x-oss-version-id").trim();
  if (!versionId || versionId.toLowerCase() === "null") {
    throw new AliyunOssPublicationQuarantineError(
      "HEAD_UNKNOWN",
      "OSS generated object has no verifiable version id; object retained",
    );
  }
  try {
    await client.delete(identity.objectKey, { versionId });
  } catch (error) {
    if (aliyunOssObjectMissing(error)) return;
    // Unknown network outcomes retain the bytes. The caller records the
    // quarantine so a later worker cannot retry a blind delete.
    throw new AliyunOssPublicationQuarantineError(
      "IDENTITY_MISMATCH",
      "OSS generated object changed or could not be version-deleted; object retained",
    );
  }
}

export async function createPrivateAliyunOssReadUrl(
  objectKey: string,
  credentials: AliyunOssCredentials,
  ttlSeconds = 300,
  network?: AliyunOssNetworkDependencies,
) {
  if (!objectKey.startsWith("objects/") || objectKey.includes("..")) {
    throw new Error("Invalid OSS object key");
  }
  const ttl = Math.max(60, Math.min(600, Math.floor(ttlSeconds)));
  const signedUrl = await configuredClient(credentials, network).signatureUrlV4(
    "GET",
    ttl,
    { headers: {} },
    objectKey,
  );
  return safeAliyunOssRequestUrl(signedUrl, credentials).toString();
}

export async function testAliyunOssConnection(
  credentials: AliyunOssCredentials,
  network: AliyunOssNetworkDependencies = {},
) {
  const client = configuredClient(credentials, network);
  const objectKey = createAliyunOssObjectKey("image", "txt");
  const content = Buffer.from(`unboundry-storage-check:${randomUUID()}`, "utf8");
  const checksum = createHash("sha256").update(content).digest("hex");
  const startedAt = Date.now();
  let uploaded = false;
  let requestId = "";
  try {
    const put = await client.put(objectKey, content, {
      headers: {
        "Content-Type": "text/plain",
        "x-oss-forbid-overwrite": "true",
        "x-oss-meta-sha256": checksum,
        "x-oss-object-acl": "private",
      },
      mime: "text/plain",
    });
    uploaded = true;
    requestId = put.res?.headers?.["x-oss-request-id"] ?? "";
    await client.head(objectKey);
    const signedUrl = await client.signatureUrlV4(
      "GET",
      60,
      { headers: {} },
      objectKey,
    );
    const safeSignedUrl = safeAliyunOssRequestUrl(signedUrl, credentials);
    const read = await fetchPublicHttps(safeSignedUrl, {
      headers: { Range: "bytes=0-0" },
      redirect: "error",
    }, {
      requester: network.requester,
      resolver: network.resolver,
      timeoutMs: 60_000,
    });
    if (![200, 206].includes(read.status)) {
      if (read.body) await read.body.cancel().catch(() => undefined);
      throw new Error("Signed OSS read failed");
    }
    if (read.body) await read.body.cancel();
  } catch (error) {
    if (uploaded) {
      try {
        await client.delete(objectKey);
      } catch {
        throw new Error("Temporary OSS object cleanup failed", {
          cause: error,
        });
      }
    }
    throw error;
  }
  try {
    await client.delete(objectKey);
  } catch {
    throw new Error("Temporary OSS object cleanup failed");
  }
  return {
    cleanupVerified: true,
    elapsedMs: Date.now() - startedAt,
    requestId,
    signedReadVerified: true,
  };
}
