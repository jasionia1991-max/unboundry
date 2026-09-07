import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { appDataDirectory } from "./database";
import { requestIdentity } from "./auth";
import { decodedRequestPath } from "./httpRequest";
import type {
  MediaBlobReference,
  MediaBlobStore,
} from "./mediaBlobStore";
import { MediaBlobStoreError } from "./mediaBlobStore";
import { defaultMediaBlobStore } from "./mediaBlobStores";
import {
  readableMedia,
  type MediaRecord,
} from "./mediaRegistry";
import { createHistoryImagePreview } from "./providerImageNormalization";
import { MediaProcessPool } from "./mediaProcess";
import { validatePng } from "./assetStorage";

const maximumImageBytes = 20 * 1024 * 1024;
const defaultReadTimeoutMs = 60_000;
const assetIdPattern = /^[a-z0-9._-]{1,160}$/i;

class MediaEditSourceIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaEditSourceIntegrityError";
  }
}

export class MediaEditSourceAdmission {
  private active = 0;
  private readonly ownerActive = new Map<string, number>();

  constructor(
    readonly globalLimit = 2,
    readonly perOwnerLimit = 1,
  ) {
    if (
      !Number.isSafeInteger(globalLimit) || globalLimit < 1 ||
      !Number.isSafeInteger(perOwnerLimit) || perOwnerLimit < 1 ||
      perOwnerLimit > globalLimit
    ) {
      throw new TypeError("Invalid media edit source admission limits");
    }
  }

  snapshot() {
    return { active: this.active, owners: this.ownerActive.size };
  }

  tryAcquire(ownerId: string) {
    const ownerCount = this.ownerActive.get(ownerId) ?? 0;
    if (this.active >= this.globalLimit || ownerCount >= this.perOwnerLimit) {
      return undefined;
    }
    this.active += 1;
    this.ownerActive.set(ownerId, ownerCount + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active = Math.max(0, this.active - 1);
      const remaining = (this.ownerActive.get(ownerId) ?? 1) - 1;
      if (remaining > 0) this.ownerActive.set(ownerId, remaining);
      else this.ownerActive.delete(ownerId);
    };
  }
}

type MediaEditSourceDependencies = Readonly<{
  admission?: MediaEditSourceAdmission;
  blobStore?: MediaBlobStore;
  identity?: (request: IncomingMessage) =>
    ReturnType<typeof requestIdentity>;
  lookup?: (
    request: IncomingMessage,
    kind: "image",
    id: string,
  ) => MediaRecord | undefined;
  readTimeoutMs?: number;
  previewCache?: HistoryPreviewCache;
  encodePreview?: typeof createHistoryImagePreview;
}>;

let cachedBlobStore: MediaBlobStore | undefined;
let cachedBlobStoreDirectory = "";

function mediaBlobStore() {
  const directory = appDataDirectory();
  if (!cachedBlobStore || cachedBlobStoreDirectory !== directory) {
    cachedBlobStore = defaultMediaBlobStore(directory);
    cachedBlobStoreDirectory = directory;
  }
  return cachedBlobStore;
}

const defaultAdmission = new MediaEditSourceAdmission();

function json(
  response: ServerResponse,
  statusCode: number,
  code: string,
  error: string,
) {
  if (response.headersSent || response.writableEnded || response.destroyed) return;
  response.statusCode = statusCode;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify({ code, error }));
}

function blobReference(media: MediaRecord): MediaBlobReference {
  return {
    backend: media.storageBackend,
    objectKey: media.storageBackend === "oss"
      ? media.objectKey
      : media.storageName,
    storageProfileId: media.storageProfileId ?? undefined,
  };
}

function boundedTimeout(value: number | undefined) {
  const timeout = value ?? defaultReadTimeoutMs;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 120_000) {
    throw new TypeError("Invalid media edit source timeout");
  }
  return timeout;
}

function bufferView(bytes: Uint8Array) {
  return Buffer.isBuffer(bytes)
    ? bytes
    : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export async function mediaEditSource(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: MediaEditSourceDependencies = {},
) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    json(response, 405, "METHOD_NOT_ALLOWED", "编辑图片接口只支持读取");
    return;
  }

  const id = decodedRequestPath(request).replace(/^\/+/, "");
  if (!assetIdPattern.test(id)) {
    json(response, 400, "INVALID_ASSET_ID", "图片素材编号无效");
    return;
  }

  const identity = (dependencies.identity ?? requestIdentity)(request);
  if (!identity) {
    json(response, 401, "AUTH_REQUIRED", "请先登录");
    return;
  }
  const ownerId = identity.bypass ? "__test__" : identity.userId;
  const media = (dependencies.lookup ?? readableMedia)(request, "image", id);
  if (!media || media.storageStatus !== "ready") {
    json(
      response,
      404,
      "IMAGE_EDIT_SOURCE_NOT_FOUND",
      "这张图片已不存在或尚未保存",
    );
    return;
  }
  if (
    media.contentType !== "image/png" ||
    !Number.isSafeInteger(media.byteSize) ||
    media.byteSize < 1 ||
    media.byteSize > maximumImageBytes ||
    !/^[a-f0-9]{64}$/i.test(media.checksumSha256)
  ) {
    json(
      response,
      409,
      "IMAGE_EDIT_SOURCE_INVALID",
      "图片文件不完整，暂时无法裁剪",
    );
    return;
  }

  const preview = new URL(request.url ?? "", "http://127.0.0.1").searchParams.get("preview");
  if (preview !== null) {
    if (preview !== "320-v1") {
      json(response, 400, "INVALID_PREVIEW", "预览尺寸无效");
      return;
    }
    const keyFor = (item: MediaRecord) => JSON.stringify([
      appDataDirectory(), ownerId, id, item.storageBackend, item.storageProfileId,
      item.objectKey, item.storageName, item.checksumSha256,
    ]);
    const key = keyFor(media);
    try {
      const buffer = await (dependencies.previewCache ?? historyPreviews).get(key, async (signal) => {
        const bytes = await readVerifiedImage(media, dependencies.blobStore ?? mediaBlobStore(), signal);
        return (dependencies.encodePreview ?? createHistoryImagePreview)(bytes, ownerId, signal);
      });
      // Recheck live authorization after queued/remote work, including cache hits.
      const current = (dependencies.lookup ?? readableMedia)(request, "image", id);
      const currentIdentity = (dependencies.identity ?? requestIdentity)(request);
      if (!currentIdentity || (currentIdentity.bypass ? "__test__" : currentIdentity.userId) !== ownerId ||
          !current || current.storageStatus !== "ready" || keyFor(current) !== key) {
        json(response, 404, "IMAGE_PREVIEW_NOT_FOUND", "图片已不可用");
        return;
      }
      if (response.destroyed || response.writableEnded) return;
      response.statusCode = 200;
      response.setHeader("Cache-Control", "private, no-store");
      response.setHeader("Content-Type", "image/png");
      response.setHeader("Content-Length", String(buffer.length));
      response.end(buffer);
    } catch {
      response.setHeader("Retry-After", "30");
      json(response, 503, "IMAGE_PREVIEW_UNAVAILABLE", "预览暂不可用，可查看原图");
    }
    return;
  }

  const release = (dependencies.admission ?? defaultAdmission).tryAcquire(ownerId);
  if (!release) {
    response.setHeader("Retry-After", "1");
    json(
      response,
      429,
      "IMAGE_EDIT_SOURCE_BUSY",
      "正在处理其他图片，请稍后重试",
    );
    return;
  }

  const controller = new AbortController();
  let completed = false;
  const disconnected = () => {
    if (!completed && !controller.signal.aborted) {
      controller.abort(new DOMException("Client disconnected", "AbortError"));
    }
  };
  request.once("aborted", disconnected);
  response.once("close", disconnected);
  const timer = setTimeout(() => {
    if (!controller.signal.aborted) {
      controller.abort(new DOMException("Image read timed out", "TimeoutError"));
    }
  }, boundedTimeout(dependencies.readTimeoutMs));
  timer.unref?.();

  try {
    const buffer = await readVerifiedImage(media,
      dependencies.blobStore ?? mediaBlobStore(), controller.signal);

    completed = true;
    response.statusCode = 200;
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("Content-Length", String(buffer.byteLength));
    response.setHeader("Content-Type", "image/png");
    response.end(buffer);
  } catch (error) {
    const reason = controller.signal.aborted ? controller.signal.reason : error;
    if (response.destroyed || response.writableEnded) return;
    if (reason instanceof DOMException && reason.name === "TimeoutError") {
      json(
        response,
        504,
        "IMAGE_EDIT_SOURCE_TIMEOUT",
        "图片暂时无法读取，请稍后重试",
      );
    } else if (reason instanceof DOMException && reason.name === "AbortError") {
      json(
        response,
        503,
        "IMAGE_EDIT_SOURCE_UNAVAILABLE",
        "图片暂时无法读取，请稍后重试",
      );
    } else if (
      error instanceof MediaEditSourceIntegrityError ||
      error instanceof MediaBlobStoreError && error.code === "READ_TOO_LARGE"
    ) {
      json(
        response,
        409,
        "IMAGE_EDIT_SOURCE_INVALID",
        "图片文件不完整，暂时无法裁剪",
      );
    } else {
      json(
        response,
        503,
        "IMAGE_EDIT_SOURCE_UNAVAILABLE",
        "图片暂时无法读取，请稍后重试",
      );
    }
  } finally {
    completed = true;
    clearTimeout(timer);
    request.off("aborted", disconnected);
    response.off("close", disconnected);
    release();
  }
}

async function readVerifiedImage(media: MediaRecord, store: MediaBlobStore, signal: AbortSignal) {
    const bytes = await store.read(
      blobReference(media),
      {
        maximumBytes: maximumImageBytes,
        signal: signal,
      },
    );
    if (signal.aborted) throw signal.reason;
    if (bytes.byteLength !== media.byteSize) {
      throw new MediaEditSourceIntegrityError("Image byte length mismatch");
    }
    const buffer = bufferView(bytes);
    if (
      createHash("sha256").update(buffer).digest("hex") !==
        media.checksumSha256.toLowerCase()
    ) {
      throw new MediaEditSourceIntegrityError("Image checksum mismatch");
    }
    let dimensions: ReturnType<typeof validatePng>;
    try {
      dimensions = validatePng(buffer);
    } catch {
      throw new MediaEditSourceIntegrityError("Image PNG validation failed");
    }
    if (
      media.mediaWidth !== null && media.mediaWidth !== dimensions.width ||
      media.mediaHeight !== null && media.mediaHeight !== dimensions.height
    ) {
      throw new MediaEditSourceIntegrityError("Image dimensions mismatch");
    }

    return buffer;
}

/** Memory-only LRU: no derivative files accumulate or enter backups. Two
 * bounded lanes include source downloads, not just encoding. */
export class HistoryPreviewCache {
  private readonly cache = new Map<string, { bytes: Buffer; at: number }>();
  private readonly pending = new Map<string, Promise<Buffer>>();
  private readonly failures = new Map<string, number>();
  private readonly lane = new MediaProcessPool(2, 31);
  private byteSize = 0;
  constructor(private readonly maximumBytes = 64 * 1024 * 1024) {}
  snapshot() { return { bytes: this.byteSize, entries: this.cache.size,
    pending: this.pending.size, ...this.lane.snapshot() }; }
  async get(key: string, create: (signal: AbortSignal) => Promise<Buffer>): Promise<Buffer> {
    const cached = this.cache.get(key);
    if (cached && cached.at > Date.now() - 300_000) {
      this.cache.delete(key); this.cache.set(key, cached);
      return cached.bytes;
    }
    if (cached) { this.cache.delete(key); this.byteSize -= cached.bytes.length; }
    if ((this.failures.get(key) ?? 0) > Date.now()) throw new Error("Preview cooling down");
    const existing = this.pending.get(key);
    if (existing) return existing;
    if (this.pending.size >= 33) throw new Error("Preview queue full");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    timer.unref?.();
    const work = (async () => {
      const release = await this.lane.acquire(controller.signal);
      try {
        const bytes = await create(controller.signal);
        if (controller.signal.aborted || bytes.length > 100 * 1024 || !bytes.length) throw new Error("Invalid preview");
        while (this.cache.size && this.byteSize + bytes.length > this.maximumBytes) {
          const oldest = this.cache.keys().next().value!;
          this.byteSize -= this.cache.get(oldest)!.bytes.length;
          this.cache.delete(oldest);
        }
        if (bytes.length <= this.maximumBytes) {
          this.cache.set(key, { bytes, at: Date.now() }); this.byteSize += bytes.length;
        }
        return bytes;
      } finally { release(); }
    })().catch((error) => {
      if (this.failures.size >= 512) this.failures.delete(this.failures.keys().next().value!);
      this.failures.set(key, Date.now() + 30_000);
      throw error;
    }).finally(() => { clearTimeout(timer); this.pending.delete(key); });
    this.pending.set(key, work);
    return work;
  }
}
const historyPreviews = new HistoryPreviewCache();
