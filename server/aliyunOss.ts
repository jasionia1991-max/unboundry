import { createHash, randomUUID } from "node:crypto";
import OSS from "ali-oss";

type MediaKind = "audio" | "image" | "video";

export type AliyunOssCredentials = {
  accessKeyId: string;
  accessKeySecret: string;
  bucket: string;
  endpoint: string;
  region: string;
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

function configuredClient(credentials: AliyunOssCredentials) {
  return new OSS({
    accessKeyId: credentials.accessKeyId,
    accessKeySecret: credentials.accessKeySecret,
    authorizationV4: true,
    bucket: credentials.bucket,
    endpoint: credentials.endpoint,
    region: credentials.region,
    secure: true,
    timeout: 60_000,
  });
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
  const client = configuredClient(input.credentials);
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
) {
  if (!objectKey.startsWith("objects/") || objectKey.includes("..")) {
    throw new Error("Invalid OSS object key");
  }
  await configuredClient(credentials).delete(objectKey);
}

export async function createPrivateAliyunOssReadUrl(
  objectKey: string,
  credentials: AliyunOssCredentials,
  ttlSeconds = 300,
) {
  if (!objectKey.startsWith("objects/") || objectKey.includes("..")) {
    throw new Error("Invalid OSS object key");
  }
  const ttl = Math.max(60, Math.min(600, Math.floor(ttlSeconds)));
  return configuredClient(credentials).signatureUrlV4(
    "GET",
    ttl,
    { headers: {} },
    objectKey,
  );
}

export async function testAliyunOssConnection(
  credentials: AliyunOssCredentials,
) {
  const client = configuredClient(credentials);
  const objectKey = createAliyunOssObjectKey("image", "txt");
  const content = Buffer.from(`tapnow-storage-check:${randomUUID()}`, "utf8");
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
    const read = await fetch(signedUrl, {
      headers: { Range: "bytes=0-0" },
      redirect: "error",
    });
    if (![200, 206].includes(read.status)) {
      throw new Error("Signed OSS read failed");
    }
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
