import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { MediaRecord } from "./mediaRegistry";
import type { ProviderGenerationSnapshot } from "./providerProfiles";

/**
 * Ark Files API uploader (INC-GEN-011).
 *
 * Everything in this module is network work and must never run while the
 * Provider configuration lock is held. Callers obtain a read-only snapshot
 * (acquireProviderGenerationSnapshot), release the lock, then use these
 * helpers. Each task uploads and deletes its own file; there is deliberately
 * no cross-task cache.
 */

export const arkFilesEnabled = () =>
  process.env.UNBOUNDRY_ARK_FILES_API === "1";

export const arkFilesImageThresholdBytes = 10 * 1024 * 1024;
export const arkFilesImageMaximumBytes = 20 * 1024 * 1024;
export const arkFilesUploadConcurrencyPerProfile = 2;
export const arkFilesUploadTimeoutMs = 60_000;
export const arkFilesPollTimeoutMs = 120_000;
export const arkFilesDeleteTimeoutMs = 10_000;
export const arkFilesQueueTimeoutMs = 30_000;
export const arkFilesPollIntervalMs = 1_000;

export type ArkFilesErrorCode =
  | "AUTH"
  | "CANCELLED"
  | "FORMAT"
  | "NETWORK"
  | "PERMISSION"
  | "RATE_LIMIT"
  | "REMOTE"
  | "TIMEOUT";

export class ArkFilesError extends Error {
  constructor(
    readonly code: ArkFilesErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ArkFilesError";
  }
}

export type ArkImageBytesInput = {
  assetId: string;
  checksumSha256: string;
  contentType: string;
  objectKey: string;
  ossReadUrl?: string;
  ownerId: string;
  storageBackend: MediaRecord["storageBackend"];
  storageName: string;
  byteSize: number;
  signal?: AbortSignal;
};

export type ArkImageBytes = {
  bytes: Buffer;
  fileName: string;
};

function assertPngHeader(bytes: Buffer) {
  const signature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  if (
    bytes.length < signature.length ||
    !bytes.subarray(0, signature.length).equals(signature)
  ) {
    throw new ArkFilesError("FORMAT", "参考图片不是有效的PNG文件");
  }
}

function assertImageSize(input: {
  byteSize: number;
  contentType: string;
}) {
  if (
    input.contentType !== "image/png" ||
    input.byteSize <= arkFilesImageThresholdBytes ||
    input.byteSize > arkFilesImageMaximumBytes
  ) {
    throw new ArkFilesError(
      "FORMAT",
      "参考图片大小或格式不受Files直传支持",
    );
  }
}

function assertChecksum(bytes: Buffer, expected: string) {
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expected) {
    throw new ArkFilesError("FORMAT", "参考图片校验失败");
  }
}

/**
 * Reads the exact bytes of a 10-20MB PNG reference before any Base64
 * conversion. Local files are read from the media directory; OSS objects are
 * downloaded through a short-lived signed read URL supplied by the caller.
 */
export async function readArkImageBytes(
  input: ArkImageBytesInput,
): Promise<ArkImageBytes> {
  assertImageSize(input);
  if (input.storageBackend === "oss") {
    if (!input.ossReadUrl) {
      throw new ArkFilesError(
        "FORMAT",
        "云端参考图片缺少可读取的私有链接",
      );
    }
    const response = await fetch(input.ossReadUrl, {
      method: "GET",
      redirect: "error",
      signal: input.signal,
    });
    if (!response.ok) {
      if (response.body) void response.body.cancel().catch(() => undefined);
      throw new ArkFilesError(
        "NETWORK",
        "云端参考图片暂时无法读取",
      );
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    assertImageSize({
      byteSize: bytes.byteLength,
      contentType: input.contentType,
    });
    assertPngHeader(bytes);
    assertChecksum(bytes, input.checksumSha256);
    return { bytes, fileName: `${input.assetId}.png` };
  }
  const fileName = basename(input.storageName);
  if (fileName !== input.storageName) {
    throw new ArkFilesError("FORMAT", "参考素材的本机路径无效");
  }
  const filePath = join(
    process.env.UNBOUNDRY_DATA_DIR ?? join(process.cwd(), "data"),
    "media",
    fileName,
  );
  const info = await stat(filePath).catch(() => undefined);
  if (!info?.isFile() || info.size !== input.byteSize) {
    throw new ArkFilesError("FORMAT", "参考素材文件不完整");
  }
  const bytes = await readFile(filePath);
  assertImageSize({
    byteSize: bytes.byteLength,
    contentType: input.contentType,
  });
  assertPngHeader(bytes);
  assertChecksum(bytes, input.checksumSha256);
  return { bytes, fileName: `${input.assetId}.png` };
}

type ProfileGate = {
  active: number;
  waiters: Array<() => void>;
};

const profileGates = new Map<string, ProfileGate>();

function releaseProfileGate(profileId: string, gate: ProfileGate) {
  gate.active -= 1;
  const next = gate.waiters.shift();
  next?.();
  if (gate.active === 0 && gate.waiters.length === 0) {
    profileGates.delete(profileId);
  }
}

async function acquireProfileGate(
  profileId: string,
  signal: AbortSignal | undefined,
  queueTimeoutMs: number = arkFilesQueueTimeoutMs,
): Promise<() => void> {
  let gate = profileGates.get(profileId);
  if (!gate) {
    gate = { active: 0, waiters: [] };
    profileGates.set(profileId, gate);
  }
  if (gate.active < arkFilesUploadConcurrencyPerProfile) {
    gate.active += 1;
    return () => releaseProfileGate(profileId, gate!);
  }
  await new Promise<void>((resolve, reject) => {
    const removeWaiter = () => {
      const index = gate!.waiters.indexOf(resolve);
      if (index >= 0) gate!.waiters.splice(index, 1);
    };
    const onAbort = () => {
      removeWaiter();
      reject(new ArkFilesError("CANCELLED", "文件上传排队已取消"));
    };
    const timer = setTimeout(() => {
      removeWaiter();
      reject(new ArkFilesError(
        "RATE_LIMIT",
        "文件上传排队超时，请稍后重试",
      ));
    }, queueTimeoutMs);
    if (signal?.aborted) {
      clearTimeout(timer);
      reject(new ArkFilesError("CANCELLED", "文件上传排队已取消"));
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    gate!.waiters.push(() => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve();
    });
  });
  gate.active += 1;
  return () => releaseProfileGate(profileId, gate!);
}

function cancelledError(error: unknown) {
  if (error instanceof ArkFilesError) return error;
  if (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  ) {
    return new ArkFilesError("CANCELLED", "文件操作已取消");
  }
  return undefined;
}

async function raceWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new ArkFilesError("TIMEOUT", message));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function waitAbortable(
  milliseconds: number,
  signal: AbortSignal | undefined,
) {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new ArkFilesError("CANCELLED", "文件操作已取消"));
    };
    if (signal?.aborted) {
      clearTimeout(timer);
      reject(new ArkFilesError("CANCELLED", "文件操作已取消"));
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function arkJson(response: Response) {
  if (!response.body) return undefined;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 2 * 1024 * 1024) {
      await reader.cancel().catch(() => undefined);
      throw new ArkFilesError("FORMAT", "方舟文件接口返回内容异常");
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return undefined;
  }
}

function mapResponseStatus(
  response: Response,
  body: Record<string, unknown> | undefined,
  fallbackMessage: string,
) {
  const message = typeof body?.message === "string" && body.message
    ? body.message
    : fallbackMessage;
  if (response.status === 401) {
    return new ArkFilesError(
      "AUTH",
      "火山方舟API Key无效或已失效，请由管理员更新平台连接",
    );
  }
  if (response.status === 403) {
    return new ArkFilesError(
      "PERMISSION",
      "当前API Key没有文件接口权限，请在方舟控制台确认开通",
    );
  }
  if (response.status === 429) {
    return new ArkFilesError("RATE_LIMIT", "火山方舟正在限流，请稍后再试");
  }
  return new ArkFilesError("REMOTE", message);
}

async function requestWithCancellation(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  signal: AbortSignal | undefined,
) {
  try {
    return await fetchImpl(url, { ...init, signal });
  } catch (error) {
    const mapped = cancelledError(error);
    if (mapped) throw mapped;
    if (error instanceof TypeError) {
      throw new ArkFilesError("NETWORK", "无法连接火山方舟文件接口");
    }
    throw error;
  }
}

async function pollArkFileActive(input: {
  baseUrl: string;
  fetchImpl: typeof fetch;
  fileId: string;
  pollTimeoutMs?: number;
  signal: AbortSignal | undefined;
  snapshot: ProviderGenerationSnapshot;
}) {
  const deadline = Date.now() + (input.pollTimeoutMs ?? arkFilesPollTimeoutMs);
  while (Date.now() < deadline) {
    const response = await requestWithCancellation(
      input.fetchImpl,
      `${input.baseUrl}/files/${input.fileId}`,
      {
        headers: {
          Authorization: `Bearer ${input.snapshot.apiKey}`,
        },
        method: "GET",
      },
      input.signal,
    );
    const body = await arkJson(response);
    if (!response.ok) {
      throw mapResponseStatus(
        response,
        body,
        "文件状态查询失败",
      );
    }
    if (body?.status === "active") return;
    if (body?.status === "failed") {
      const error = body.error as Record<string, unknown> | undefined;
      const message = typeof error?.message === "string" && error.message
        ? error.message
        : "方舟文件处理失败";
      throw new ArkFilesError("FORMAT", message);
    }
    await waitAbortable(arkFilesPollIntervalMs, input.signal);
  }
  throw new ArkFilesError("TIMEOUT", "文件上传后处理超时");
}

export async function deleteArkFile(
  fileId: string,
  snapshot: ProviderGenerationSnapshot,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
) {
  const response = await raceWithTimeout(
    requestWithCancellation(
      fetcher,
      `${snapshot.baseUrl}/files/${fileId}`,
      {
        headers: {
          Authorization: `Bearer ${snapshot.apiKey}`,
        },
        method: "DELETE",
      },
      signal,
    ),
    arkFilesDeleteTimeoutMs,
    "删除临时文件超时",
  );
  if (response.ok || response.status === 404) return;
  const body = await arkJson(response);
  throw mapResponseStatus(
    response,
    body,
    "删除临时文件失败",
  );
}

export type UploadArkImageInput = {
  bytes: Buffer;
  fileName: string;
  fetcher?: typeof fetch;
  mimeType: string;
  pollTimeoutMs?: number;
  profileId: string;
  queueTimeoutMs?: number;
  signal?: AbortSignal;
  snapshot: ProviderGenerationSnapshot;
  uploadTimeoutMs?: number;
};

export type UploadArkImageResult = {
  cleanup: (cleanupSignal?: AbortSignal) => Promise<void>;
  fileId: string;
};

/**
 * Uploads one PNG through the Ark Files API, waits for it to become active
 * and returns a cleanup function that deletes the remote file with its own
 * short-lived signal. The upload and poll both honour the task cancellation
 * signal; cleanup must NOT reuse that already-aborted signal.
 */
export async function uploadArkImageFile(
  input: UploadArkImageInput,
): Promise<UploadArkImageResult> {
  if (input.bytes.byteLength <= arkFilesImageThresholdBytes ||
      input.bytes.byteLength > arkFilesImageMaximumBytes ||
      input.mimeType !== "image/png") {
    throw new ArkFilesError(
      "FORMAT",
      "参考图片大小或格式不受Files直传支持",
    );
  }
  const fetchImpl = input.fetcher ?? fetch;
  const release = await acquireProfileGate(
    input.profileId,
    input.signal,
    input.queueTimeoutMs,
  );
  try {
    const form = new FormData();
    form.append("purpose", "user_data");
    form.append(
      "file",
      new Blob([
        new Uint8Array(
          input.bytes.buffer as ArrayBuffer,
          input.bytes.byteOffset,
          input.bytes.byteLength,
        ),
      ], { type: input.mimeType }),
      input.fileName,
    );
    const response = await raceWithTimeout(
      requestWithCancellation(
        fetchImpl,
        `${input.snapshot.baseUrl}/files`,
        {
          body: form,
          headers: {
            Authorization: `Bearer ${input.snapshot.apiKey}`,
          },
          method: "POST",
          redirect: "error",
        },
        input.signal,
      ),
      input.uploadTimeoutMs ?? arkFilesUploadTimeoutMs,
      "上传文件超时",
    );
    const body = await arkJson(response);
    if (!response.ok) {
      throw mapResponseStatus(
        response,
        body,
        "上传文件失败",
      );
    }
    if (
      typeof body?.id !== "string" ||
      !/^file-[a-z0-9-]+$/i.test(body.id)
    ) {
      throw new ArkFilesError("FORMAT", "方舟没有返回有效的文件编号");
    }
    const fileId = body.id;
    await pollArkFileActive({
      baseUrl: input.snapshot.baseUrl,
      fetchImpl,
      fileId,
      pollTimeoutMs: input.pollTimeoutMs,
      signal: input.signal,
      snapshot: input.snapshot,
    });
    return {
      cleanup: (cleanupSignal) =>
        deleteArkFile(fileId, input.snapshot, cleanupSignal, fetchImpl),
      fileId,
    };
  } finally {
    release();
  }
}
