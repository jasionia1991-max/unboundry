import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import type { MediaBlobReference, MediaBlobStore } from "./mediaBlobStore";
import { defaultMediaBlobStore } from "./mediaBlobStores";
import { readableMediaForOwner } from "./mediaRegistry";
import {
  type AcquireProviderReferenceInput,
  type ProviderReferenceLease,
  type ProviderReferenceStore,
  ProviderReferenceStoreError,
} from "./providerReferenceStore";

let blobStore: MediaBlobStore | undefined;
let blobStoreDataDirectory: string | undefined;

function mediaBlobStore() {
  const dataDirectory = process.env.UNBOUNDRY_DATA_DIR ?? join(process.cwd(), "data");
  if (!blobStore || blobStoreDataDirectory !== dataDirectory) {
    blobStore = defaultMediaBlobStore(dataDirectory);
    blobStoreDataDirectory = dataDirectory;
  }
  return blobStore;
}

function blobReference(media: NonNullable<ReturnType<typeof readableMediaForOwner>>) {
  return {
    backend: media.storageBackend,
    objectKey: media.storageBackend === "oss"
      ? media.objectKey
      : media.storageName,
    storageProfileId: media.storageProfileId ?? undefined,
  } satisfies MediaBlobReference;
}

function lease(
  input: AcquireProviderReferenceInput,
  media: NonNullable<ReturnType<typeof readableMediaForOwner>>,
  locator: ProviderReferenceLease["locator"],
): ProviderReferenceLease {
  return {
    assetId: input.assetId,
    byteSize: media.byteSize,
    checksumSha256: media.checksumSha256,
    contentType: media.contentType,
    durationSeconds: media.durationSeconds,
    durationSource: media.durationSource,
    durationStatus: media.durationStatus,
    kind: input.kind,
    leaseId: randomUUID(),
    locator,
    mediaHeight: media.mediaHeight,
    mediaWidth: media.mediaWidth,
    ownerId: input.ownerId,
  };
}

/**
 * Media-owned adapter for durable assets. It materializes only a temporary
 * Provider locator and never exposes storage credentials or publication rows.
 */
export const ownerMediaProviderReferenceStore: ProviderReferenceStore =
  Object.freeze({
    async acquire(input: AcquireProviderReferenceInput) {
      if (
        !/^[a-z0-9._-]{1,160}$/i.test(input.assetId) ||
        !/^[a-z0-9._-]{1,160}$/i.test(input.ownerId) ||
        !Number.isSafeInteger(input.maximumBytes) ||
        input.maximumBytes < 1
      ) {
        throw new ProviderReferenceStoreError("INVALID", "参考素材编号无效");
      }
      if (input.signal?.aborted) {
        throw new DOMException("参考素材读取已停止", "AbortError");
      }
      const media = readableMediaForOwner(input.ownerId, input.kind, input.assetId);
      if (!media || media.storageStatus !== "ready") {
        throw new ProviderReferenceStoreError(
          "UNAVAILABLE",
          "参考素材不存在、尚未保存或不属于当前账号",
        );
      }
      if (
        !Number.isSafeInteger(media.byteSize) ||
        media.byteSize < 1 ||
        media.byteSize > input.maximumBytes ||
        !/^[a-f0-9]{64}$/i.test(media.checksumSha256)
      ) {
        throw new ProviderReferenceStoreError("INVALID", "参考素材大小或校验信息无效");
      }
      if (
        media.storageBackend === "oss" &&
        input.preferredTransports.includes("signed-url")
      ) {
        try {
          const signed = await mediaBlobStore().signRead(
            blobReference(media),
            300,
          );
          if (input.signal?.aborted) {
            throw new DOMException("参考素材读取已停止", "AbortError");
          }
          return lease(input, media, {
            expiresAt: signed.expiresAt,
            transport: "signed-url",
            url: signed.url,
          });
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") {
            throw error;
          }
          if (error instanceof ProviderReferenceStoreError) throw error;
          throw new ProviderReferenceStoreError(
            "UNAVAILABLE",
            "参考素材暂时无法安全读取",
          );
        }
      }
      if (
        media.storageBackend !== "local" ||
        !input.preferredTransports.includes("inline-data") ||
        input.kind === "video"
      ) {
        throw new ProviderReferenceStoreError(
          "NOT_ACCESSIBLE",
          "当前存储中的参考素材无法安全交给所选模型",
        );
      }
      const bytes = await mediaBlobStore().read(
        blobReference(media),
        input.maximumBytes,
      ).catch(() => undefined);
      if (!bytes || bytes.byteLength !== media.byteSize) {
        throw new ProviderReferenceStoreError("INVALID", "参考素材文件不完整");
      }
      if (
        input.signal?.aborted ||
        createHash("sha256").update(bytes).digest("hex") !==
          media.checksumSha256
      ) {
        if (input.signal?.aborted) {
          throw new DOMException("参考素材读取已停止", "AbortError");
        }
        throw new ProviderReferenceStoreError("INVALID", "参考素材校验失败");
      }
      return lease(input, media, {
        dataUrl: `data:${media.contentType};base64,${Buffer.from(bytes).toString("base64")}`,
        transport: "inline-data",
      });
    },
    async release() {
      // Durable local/OSS assets are not owned by this temporary lease.
    },
  });
