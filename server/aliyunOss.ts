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

export async function uploadPrivateAliyunOssObject(input: {
  byteSize: number;
  checksumSha256: string;
  contentType: string;
  credentials: AliyunOssCredentials;
  filePath: string;
  objectKey: string;
  network?: AliyunOssNetworkDependencies;
}) {
  if (!/^[a-f0-9]{64}$/.test(input.checksumSha256)) {
    throw new Error("Invalid SHA-256 checksum");
  }
  if (
    !input.objectKey.startsWith("objects/") ||
    input.objectKey.includes("..")
  ) {
    throw new Error("Invalid OSS object key");
  }
  const client = configuredClient(input.credentials, input.network);
  try {
    const result = await client.put(input.objectKey, input.filePath, {
      headers: {
        "Content-Type": input.contentType,
        "x-oss-forbid-overwrite": "true",
        "x-oss-meta-sha256": input.checksumSha256,
        "x-oss-object-acl": "private",
      },
      mime: input.contentType,
    });
    const head = await client.head(input.objectKey);
    const storedSize = Number(
      head.res?.headers?.["content-length"] ?? head.res?.headers?.["Content-Length"],
    );
    if (!Number.isFinite(storedSize) || storedSize !== input.byteSize) {
      throw new Error("OSS object verification failed");
    }
    return {
      etag: result.res?.headers?.etag ?? "",
      requestId: result.res?.headers?.["x-oss-request-id"] ?? "",
      versionId: result.res?.headers?.["x-oss-version-id"] ?? "",
    };
  } catch (error) {
    try {
      await client.delete(input.objectKey);
    } catch {}
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
