import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
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
export const arkFilesOssReadTimeoutMs = 30_000;
export const arkFilesPollRequestTimeoutMs = 10_000;
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
  fetcher?: typeof fetch;
  readTimeoutMs?: number;
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
    !Number.isSafeInteger(input.byteSize) ||
    input.byteSize <= arkFilesImageThresholdBytes ||
    input.byteSize > arkFilesImageMaximumBytes
  ) {
    throw new ArkFilesError(
      "FORMAT",
      "参考图片大小或格式不受Files直传支持",
    );
  }
}

function assertReadNotCancelled(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new ArkFilesError("CANCELLED", "参考素材读取已取消");
  }
}

function assertChecksum(bytes: Buffer, expected: string) {
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expected) {
    throw new ArkFilesError("FORMAT", "参考图片校验失败");
  }
}

type ArkFilesLogStage = "delete" | "poll" | "upload";

function safeIdentity(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function logArkFilesEvent(input: {
  byteSize?: number;
  durationMs: number;
  errorCode?: ArkFilesErrorCode;
  ownerId: string;
  pollCount?: number;
  profileId: string;
  result: "failure" | "success";
  stage: ArkFilesLogStage;
  taskId?: string;
}) {
  try {
    console.error(JSON.stringify({
      event: `ark-files-${input.stage}`,
      timestamp: new Date().toISOString(),
      taskId: input.taskId ?? null,
      owner: safeIdentity(input.ownerId),
      profile: safeIdentity(input.profileId),
      byteSize: input.byteSize ?? null,
      durationMs: Math.max(0, Math.round(input.durationMs)),
      pollCount: input.pollCount ?? null,
      result: input.result,
      errorCode: input.errorCode ?? null,
    }));
  } catch {
    // Diagnostics must never change generation behavior.
  }
}

function arkFilesErrorCode(error: unknown): ArkFilesErrorCode {
  return error instanceof ArkFilesError ? error.code : "REMOTE";
}

function createDeadlineController(
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
  timeoutMessage: string,
) {
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted) onAbort();
  else parentSignal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException(timeoutMessage, "TimeoutError"));
  }, timeoutMs);
  return {
    cleanup() {
      clearTimeout(timer);
      parentSignal?.removeEventListener("abort", onAbort);
    },
    controller,
    timeoutError() {
      return timedOut ? new ArkFilesError("TIMEOUT", timeoutMessage) : undefined;
    },
  };
}

async function readBoundedResponse(
  response: Response,
  maximumBytes: number,
): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let completed = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) {
        throw new ArkFilesError("FORMAT", "云端参考图片超过20MB上限");
      }
      chunks.push(value);
    }
    completed = true;
    return Buffer.concat(chunks, size);
  } finally {
    if (!completed) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
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
    const deadline = createDeadlineController(
      input.signal,
      input.readTimeoutMs ?? arkFilesOssReadTimeoutMs,
      "云端参考图片读取超时",
    );
    let bytes: Buffer;
    try {
      const response = await (input.fetcher ?? fetch)(input.ossReadUrl, {
        method: "GET",
        redirect: "error",
        signal: deadline.controller.signal,
      });
      if (!response.ok) {
        if (response.body) void response.body.cancel().catch(() => undefined);
        throw new ArkFilesError(
          "NETWORK",
          "云端参考图片暂时无法读取",
        );
      }
      bytes = await readBoundedResponse(response, arkFilesImageMaximumBytes);
    } catch (error) {
      const timeout = deadline.timeoutError();
      if (timeout) throw timeout;
      const mapped = cancelledError(error);
      if (mapped) throw mapped;
      if (error instanceof ArkFilesError) throw error;
      if (error instanceof TypeError) {
        throw new ArkFilesError("NETWORK", "云端参考图片暂时无法读取");
      }
      throw error;
    } finally {
      deadline.cleanup();
    }
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
  assertReadNotCancelled(input.signal);
  const noFollow = fsConstants.O_NOFOLLOW;
  if (typeof noFollow !== "number") {
    throw new ArkFilesError("FORMAT", "当前系统不支持安全读取参考素材");
  }
  let handle: FileHandle | undefined;
  let primaryError: unknown;
  let bytes: Buffer;
  try {
    handle = await open(filePath, fsConstants.O_RDONLY | noFollow);
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.size !== BigInt(input.byteSize)) {
      throw new ArkFilesError("FORMAT", "参考素材文件不完整");
    }
    bytes = Buffer.alloc(input.byteSize + 1);
    let total = 0;
    const chunkSize = 1024 * 1024;
    while (total < bytes.byteLength) {
      assertReadNotCancelled(input.signal);
      const result = await handle.read(
        bytes,
        total,
        Math.min(chunkSize, bytes.byteLength - total),
        total,
      );
      if (result.bytesRead === 0) break;
      total += result.bytesRead;
    }
    assertReadNotCancelled(input.signal);
    const after = await handle.stat({ bigint: true });
    if (
      !after.isFile() ||
      before.size !== after.size ||
      after.size !== BigInt(input.byteSize) ||
      total !== input.byteSize
    ) {
      throw new ArkFilesError("FORMAT", "参考素材文件在读取期间发生变化");
    }
    bytes = bytes.subarray(0, total);
  } catch (error) {
    primaryError = error;
    if (error instanceof ArkFilesError) throw error;
    if (
      input.signal?.aborted ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      throw new ArkFilesError("CANCELLED", "参考素材读取已取消");
    }
    throw new ArkFilesError("FORMAT", "参考素材文件无法安全读取");
  } finally {
    if (handle) {
      try {
        await handle.close();
      } catch {
        if (!primaryError) {
          throw new ArkFilesError("FORMAT", "参考素材文件无法安全关闭");
        }
      }
    }
  }
  assertReadNotCancelled(input.signal);
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

function releaseProfileGate(gateKey: string, gate: ProfileGate) {
  const next = gate.waiters.shift();
  if (next) {
    // The released slot is transferred synchronously to the waiter. Keeping it
    // counted here prevents another release from deleting the gate before the
    // waiter's Promise continuation resumes.
    next();
    return;
  }
  gate.active -= 1;
  if (gate.active === 0 && gate.waiters.length === 0) {
    profileGates.delete(gateKey);
  }
}

async function acquireProfileGate(
  gateKey: string,
  signal: AbortSignal | undefined,
  queueTimeoutMs: number = arkFilesQueueTimeoutMs,
): Promise<() => void> {
  let gate = profileGates.get(gateKey);
  if (!gate) {
    gate = { active: 0, waiters: [] };
    profileGates.set(gateKey, gate);
  }
  if (gate.active < arkFilesUploadConcurrencyPerProfile) {
    gate.active += 1;
    return () => releaseProfileGate(gateKey, gate!);
  }
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const removeWaiter = () => {
      const index = gate!.waiters.indexOf(resume);
      if (index >= 0) gate!.waiters.splice(index, 1);
    };
    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      removeWaiter();
      signal?.removeEventListener("abort", onAbort);
      reject(new ArkFilesError("CANCELLED", "文件上传排队已取消"));
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      removeWaiter();
      signal?.removeEventListener("abort", onAbort);
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
    const resume = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    gate!.waiters.push(resume);
  });
  return () => releaseProfileGate(gateKey, gate!);
}

function cancelledError(error: unknown) {
  if (error instanceof ArkFilesError) return error;
  if (
    error instanceof Error &&
    error.name === "AbortError"
  ) {
    return new ArkFilesError("CANCELLED", "文件操作已取消");
  }
  return undefined;
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
  let completed = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2 * 1024 * 1024) {
        throw new ArkFilesError("FORMAT", "方舟文件接口返回内容异常");
      }
      chunks.push(value);
    }
    completed = true;
  } finally {
    if (!completed) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
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

async function requestArkJsonWithDeadline(input: {
  fetchImpl: typeof fetch;
  init: RequestInit;
  signal: AbortSignal | undefined;
  timeoutMessage: string;
  timeoutMs: number;
  url: string;
}) {
  const deadline = createDeadlineController(
    input.signal,
    input.timeoutMs,
    input.timeoutMessage,
  );
  try {
    const response = await requestWithCancellation(
      input.fetchImpl,
      input.url,
      input.init,
      deadline.controller.signal,
    );
    const body = await arkJson(response);
    return { body, response };
  } catch (error) {
    const timeout = deadline.timeoutError();
    if (timeout) throw timeout;
    const cancelled = cancelledError(error);
    if (cancelled) throw cancelled;
    if (error instanceof TypeError) {
      throw new ArkFilesError("NETWORK", "无法连接火山方舟文件接口");
    }
    throw error;
  } finally {
    deadline.cleanup();
  }
}

async function pollArkFileActive(input: {
  baseUrl: string;
  byteSize: number;
  fetchImpl: typeof fetch;
  fileId: string;
  ownerId: string;
  pollTimeoutMs?: number;
  profileId: string;
  signal: AbortSignal | undefined;
  snapshot: ProviderGenerationSnapshot;
  taskId?: string;
}) {
  const startedAt = Date.now();
  const deadline = Date.now() + (input.pollTimeoutMs ?? arkFilesPollTimeoutMs);
  let pollCount = 0;
  try {
    while (Date.now() < deadline) {
      pollCount += 1;
      const remaining = deadline - Date.now();
      const { body, response } = await requestArkJsonWithDeadline({
        fetchImpl: input.fetchImpl,
        init: {
        headers: {
          Authorization: `Bearer ${input.snapshot.apiKey}`,
        },
        method: "GET",
        },
        signal: input.signal,
        timeoutMessage: "文件状态查询超时",
        timeoutMs: Math.max(
          1,
          Math.min(arkFilesPollRequestTimeoutMs, remaining),
        ),
        url: `${input.baseUrl}/files/${input.fileId}`,
      });
      if (!response.ok) {
        throw mapResponseStatus(
          response,
          body,
          "文件状态查询失败",
        );
      }
      if (body?.status === "active") {
        logArkFilesEvent({
          byteSize: input.byteSize,
          durationMs: Date.now() - startedAt,
          ownerId: input.ownerId,
          pollCount,
          profileId: input.profileId,
          result: "success",
          stage: "poll",
          taskId: input.taskId,
        });
        return;
      }
      if (body?.status === "failed") {
        const error = body.error as Record<string, unknown> | undefined;
        const message = typeof error?.message === "string" && error.message
          ? error.message
          : "方舟文件处理失败";
        throw new ArkFilesError("FORMAT", message);
      }
      await waitAbortable(
        Math.min(arkFilesPollIntervalMs, Math.max(1, deadline - Date.now())),
        input.signal,
      );
    }
    throw new ArkFilesError("TIMEOUT", "文件上传后处理超时");
  } catch (error) {
    logArkFilesEvent({
      byteSize: input.byteSize,
      durationMs: Date.now() - startedAt,
      errorCode: arkFilesErrorCode(error),
      ownerId: input.ownerId,
      pollCount,
      profileId: input.profileId,
      result: "failure",
      stage: "poll",
      taskId: input.taskId,
    });
    throw error;
  }
}

export async function deleteArkFile(
  fileId: string,
  snapshot: ProviderGenerationSnapshot,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
  context?: {
    byteSize?: number;
    ownerId: string;
    profileId: string;
    taskId?: string;
  },
) {
  const startedAt = Date.now();
  try {
    const { body, response } = await requestArkJsonWithDeadline({
      fetchImpl: fetcher,
      init: {
        headers: {
          Authorization: `Bearer ${snapshot.apiKey}`,
        },
        method: "DELETE",
      },
      signal,
      timeoutMessage: "删除临时文件超时",
      timeoutMs: arkFilesDeleteTimeoutMs,
      url: `${snapshot.baseUrl}/files/${fileId}`,
    });
    if (!response.ok && response.status !== 404) {
      throw mapResponseStatus(
        response,
        body,
        "删除临时文件失败",
      );
    }
    if (context) {
      logArkFilesEvent({
        byteSize: context.byteSize,
        durationMs: Date.now() - startedAt,
        ownerId: context.ownerId,
        profileId: context.profileId,
        result: "success",
        stage: "delete",
        taskId: context.taskId,
      });
    }
  } catch (error) {
    if (context) {
      logArkFilesEvent({
        byteSize: context.byteSize,
        durationMs: Date.now() - startedAt,
        errorCode: arkFilesErrorCode(error),
        ownerId: context.ownerId,
        profileId: context.profileId,
        result: "failure",
        stage: "delete",
        taskId: context.taskId,
      });
    }
    throw error;
  }
}

export type UploadArkImageInput = {
  bytes: Buffer;
  fileName: string;
  fetcher?: typeof fetch;
  mimeType: string;
  ownerId: string;
  pollTimeoutMs?: number;
  profileId: string;
  queueTimeoutMs?: number;
  signal?: AbortSignal;
  snapshot: ProviderGenerationSnapshot;
  taskId?: string;
  uploadTimeoutMs?: number;
};

export type UploadArkImageResult = {
  cleanup: (cleanupSignal?: AbortSignal) => Promise<void>;
  fileId: string;
};

function createArkFileCleanup(input: {
  byteSize: number;
  fetchImpl: typeof fetch;
  fileId: string;
  ownerId: string;
  profileId: string;
  snapshot: ProviderGenerationSnapshot;
  taskId?: string;
}) {
  let cleanupPromise: Promise<void> | undefined;
  return (cleanupSignal?: AbortSignal) => {
    cleanupPromise ??= deleteArkFile(
      input.fileId,
      input.snapshot,
      cleanupSignal,
      input.fetchImpl,
      {
        byteSize: input.byteSize,
        ownerId: input.ownerId,
        profileId: input.profileId,
        taskId: input.taskId,
      },
    );
    return cleanupPromise;
  };
}

async function uploadArkImageFileWithinGate(
  input: UploadArkImageInput,
): Promise<UploadArkImageResult> {
  const fetchImpl = input.fetcher ?? fetch;
  const startedAt = Date.now();
  let fileId: string | undefined;
  let cleanup: ((cleanupSignal?: AbortSignal) => Promise<void>) | undefined;
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
    const { body, response } = await requestArkJsonWithDeadline({
      fetchImpl,
      init: {
        body: form,
        headers: {
          Authorization: `Bearer ${input.snapshot.apiKey}`,
        },
        method: "POST",
        redirect: "error",
      },
      signal: input.signal,
      timeoutMessage: "上传文件超时",
      timeoutMs: input.uploadTimeoutMs ?? arkFilesUploadTimeoutMs,
      url: `${input.snapshot.baseUrl}/files`,
    });
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
    fileId = body.id;
    cleanup = createArkFileCleanup({
      byteSize: input.bytes.byteLength,
      fetchImpl,
      fileId,
      ownerId: input.ownerId,
      profileId: input.profileId,
      snapshot: input.snapshot,
      taskId: input.taskId,
    });
    logArkFilesEvent({
      byteSize: input.bytes.byteLength,
      durationMs: Date.now() - startedAt,
      ownerId: input.ownerId,
      profileId: input.profileId,
      result: "success",
      stage: "upload",
      taskId: input.taskId,
    });
    try {
      await pollArkFileActive({
        baseUrl: input.snapshot.baseUrl,
        byteSize: input.bytes.byteLength,
        fetchImpl,
        fileId,
        ownerId: input.ownerId,
        pollTimeoutMs: input.pollTimeoutMs,
        profileId: input.profileId,
        signal: input.signal,
        snapshot: input.snapshot,
        taskId: input.taskId,
      });
    } catch (error) {
      // A file id is now owned locally. Cleanup uses an independent signal so
      // task cancellation cannot cancel DELETE before it begins.
      const cleanupController = new AbortController();
      await cleanup(cleanupController.signal).catch(() => undefined);
      throw error;
    }
    return { cleanup, fileId };
  } catch (error) {
    if (!fileId) {
      logArkFilesEvent({
        byteSize: input.bytes.byteLength,
        durationMs: Date.now() - startedAt,
        errorCode: arkFilesErrorCode(error),
        ownerId: input.ownerId,
        profileId: input.profileId,
        result: "failure",
        stage: "upload",
        taskId: input.taskId,
      });
    }
    throw error;
  }
}

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
  const release = await acquireProfileGate(
    `${input.ownerId}:${input.profileId}`,
    input.signal,
    input.queueTimeoutMs,
  );
  try {
    return await uploadArkImageFileWithinGate(input);
  } finally {
    release();
  }
}

export type PrepareArkImageInput = Omit<UploadArkImageInput, "bytes" | "fileName"> & {
  image: ArkImageBytesInput;
};

export async function prepareArkImageFile(
  input: PrepareArkImageInput,
): Promise<UploadArkImageResult> {
  const release = await acquireProfileGate(
    `${input.ownerId}:${input.profileId}`,
    input.signal,
    input.queueTimeoutMs,
  );
  try {
    const { bytes, fileName } = await readArkImageBytes({
      ...input.image,
      signal: input.signal ?? input.image.signal,
    });
    return await uploadArkImageFileWithinGate({
      ...input,
      bytes,
      fileName,
    });
  } finally {
    release();
  }
}
