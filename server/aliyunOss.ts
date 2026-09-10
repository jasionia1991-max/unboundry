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
