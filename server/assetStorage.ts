import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, join } from "node:path";
import { crc32, inflateSync } from "node:zlib";
import {
  assertDeclaredBodyWithin,
  BoundedBodyError,
  readBoundedBody,
  rejectUnreadRequestBody,
} from "./boundedBody";
import {
  createAliyunOssObjectKey,
  createPrivateAliyunOssReadUrl,
  deletePrivateAliyunOssObject,
  uploadPrivateAliyunOssObject,
} from "./aliyunOss";
import { requestIdentity } from "./auth";
import {
  decodedRequestHeader,
  decodedRequestPath,
  HttpRequestError,
} from "./httpRequest";
import {
  readableMedia,
  readableMediaForOwner,
} from "./mediaRegistry";
import {
  beginMediaDeletion,
  cleanupPublicationStaging,
  compensateMediaPublication,
  finalizeMediaPublication,
  finishMediaDeletion,
  markExternalMediaPublicationReady,
  markMediaDeletionFailed,
  mediaPublicationFinalPath,
  mediaPublicationStagingPath,
  MediaPublicationConflictError,
  MediaPublicationDeferredError,
  publishLocalMediaPublication,
  reserveMediaPublication,
  stageMediaPublication,
  type GeneratedPublicationTask,
  type MediaPublicationExecution,
} from "./mediaPublicationService";
import {
  storageProfileForMedia,
  storageProfileForDestructiveMedia,
  withStorageMediaRoutingReservation,
  type AliyunStorageProfile,
} from "./secureStorageProfiles";
import {
  reserveMediaProcessResources,
  reserveMediaResources,
  ResourceBudgetError,
} from "./resourceBudget";

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const maxImageBytes = 20 * 1024 * 1024;
const maxDecodedBytes = 128 * 1024 * 1024;
const maxImagePixels = 40_000_000;

function assetPath(id: string) {
  const directory = join(
    process.env.UNBOUNDRY_DATA_DIR ?? join(process.cwd(), "data"),
    "media",
  );
  return { directory, file: join(directory, `${id}.png`) };
}

export async function imageReferenceForProvider(
  ownerId: string,
  assetId: string,
  ttlSeconds = 300,
) {
  const media = readableMediaForOwner(ownerId, "image", assetId);
  if (!media || media.storageStatus !== "ready") {
    throw new Error("前置图片不存在或尚未保存");
  }
  if (media.byteSize < 1 || media.byteSize > maxImageBytes) {
    throw new Error("前置图片大小无效");
  }
  if (media.contentType !== "image/png") {
    throw new Error("当前只支持PNG参考图");
  }
  if (media.storageBackend === "oss") {
    const profile = await storageProfileForMedia(media);
    if (!profile) throw new Error("前置图片的云端存储暂不可用");
    return createPrivateAliyunOssReadUrl(media.objectKey, profile, ttlSeconds);
  }
  if (basename(media.storageName) !== media.storageName) {
    throw new Error("前置图片路径无效");
  }
  const bytes = await readFile(
    join(
      process.env.UNBOUNDRY_DATA_DIR ?? join(process.cwd(), "data"),
      "media",
      media.storageName,
    ),
  );
  if (bytes.length !== media.byteSize) {
    throw new Error("前置图片文件不完整");
  }
  if (
    createHash("sha256").update(bytes).digest("hex") !== media.checksumSha256
  ) {
    throw new Error("前置图片校验失败");
  }
  validatePng(bytes);
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

function json(response: ServerResponse, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

async function readImage(request: IncomingMessage) {
  return readBoundedBody(request, {
    idleTimeoutMs: 15_000,
    maximumBytes: maxImageBytes,
    totalTimeoutMs: 120_000,
  });
}

function decodedLength(
  width: number,
  height: number,
  bitsPerPixel: number,
  interlaced: boolean,
) {
  const passes = interlaced
    ? [
        [0, 0, 8, 8],
        [4, 0, 8, 8],
        [0, 4, 4, 8],
        [2, 0, 4, 4],
        [0, 2, 2, 4],
        [1, 0, 2, 2],
        [0, 1, 1, 2],
      ]
    : [[0, 0, 1, 1]];
  return passes.reduce((total, [x, y, dx, dy]) => {
    const passWidth = Math.max(0, Math.ceil((width - x) / dx));
    const passHeight = Math.max(0, Math.ceil((height - y) / dy));
    return total + passHeight * (Math.ceil(passWidth * bitsPerPixel / 8) + 1);
  }, 0);
}

export function validatePng(bytes: Buffer) {
  if (!bytes.subarray(0, 8).equals(pngSignature)) {
    throw new Error("Invalid PNG image");
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let expectedBytes = 0;
  let sawHeader = false;
  let sawImageData = false;
  let sawEnd = false;
  const imageData: Buffer[] = [];

  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new Error("Invalid PNG image");
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) throw new Error("Invalid PNG image");
    const typeBytes = bytes.subarray(offset + 4, offset + 8);
    const type = typeBytes.toString("ascii");
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    const expectedCrc = bytes.readUInt32BE(offset + 8 + length);
    if (crc32(Buffer.concat([typeBytes, data])) !== expectedCrc) {
      throw new Error("Invalid PNG image");
    }

    if (!sawHeader) {
      if (type !== "IHDR" || length !== 13) {
        throw new Error("Invalid PNG image");
      }
      sawHeader = true;
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const bitDepth = data[8];
      const colorType = data[9];
      const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
      const legalDepths = {
        0: [1, 2, 4, 8, 16],
        2: [8, 16],
        3: [1, 2, 4, 8],
        4: [8, 16],
        6: [8, 16],
      }[colorType];
      if (
        !width ||
        !height ||
        width * height > maxImagePixels ||
        !channels ||
        !legalDepths?.includes(bitDepth) ||
        data[10] !== 0 ||
        data[11] !== 0 ||
        (data[12] !== 0 && data[12] !== 1)
      ) {
        throw new Error("Invalid image dimensions");
      }
      expectedBytes = decodedLength(
        width,
        height,
        channels * bitDepth,
        data[12] === 1,
      );
      if (expectedBytes > maxDecodedBytes) {
        throw new Error("Image is too large");
      }
    } else if (type === "IDAT") {
      sawImageData = true;
      imageData.push(data);
    } else if (type === "IEND") {
      if (length !== 0 || end !== bytes.length) {
        throw new Error("Invalid PNG image");
      }
      sawEnd = true;
    }
    offset = end;
  }

  if (!sawHeader || !sawImageData || !sawEnd) {
    throw new Error("Invalid PNG image");
  }
  const decoded = inflateSync(Buffer.concat(imageData), {
    maxOutputLength: expectedBytes,
  });
  if (decoded.length !== expectedBytes) throw new Error("Invalid PNG image");
  return { height, width };
}

/**
 * Remove-background results must contain at least one genuinely transparent
 * pixel. Merely converting an opaque JPEG to RGBA is not sufficient.
 * Canonical Provider PNGs use non-interlaced 8/16-bit grayscale-alpha or
 * RGBA; other encodings are rejected fail-closed for this operation.
 */
export function validateTransparentPng(bytes: Buffer) {
  const dimensions = validatePng(bytes);
  let offset = 8;
  let bitDepth = 0;
  let colorType = 0;
  let interlaced = false;
  const imageData: Buffer[] = [];
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      bitDepth = data[8];
      colorType = data[9];
      interlaced = data[12] !== 0;
    } else if (type === "IDAT") imageData.push(data);
    offset += 12 + length;
  }
  const channels = colorType === 4 ? 2 : colorType === 6 ? 4 : 0;
  if (!channels || (bitDepth !== 8 && bitDepth !== 16) || interlaced) {
    throw new Error("PNG image does not contain supported transparency");
  }
  const sampleBytes = bitDepth / 8;
  const bytesPerPixel = channels * sampleBytes;
  const rowBytes = dimensions.width * bytesPerPixel;
  const decoded = inflateSync(Buffer.concat(imageData), {
    maxOutputLength: dimensions.height * (rowBytes + 1),
  });
  let previous = Buffer.alloc(rowBytes);
  let cursor = 0;
  const paeth = (left: number, above: number, upperLeft: number) => {
    const prediction = left + above - upperLeft;
    const leftDistance = Math.abs(prediction - left);
    const aboveDistance = Math.abs(prediction - above);
    const upperLeftDistance = Math.abs(prediction - upperLeft);
    return leftDistance <= aboveDistance && leftDistance <= upperLeftDistance
      ? left
      : aboveDistance <= upperLeftDistance ? above : upperLeft;
  };
  for (let y = 0; y < dimensions.height; y += 1) {
    const filter = decoded[cursor++];
    if (filter > 4) throw new Error("Invalid PNG image");
    const row = Buffer.alloc(rowBytes);
    for (let x = 0; x < rowBytes; x += 1) {
      const encoded = decoded[cursor++];
      const left = x >= bytesPerPixel ? row[x - bytesPerPixel] : 0;
      const above = previous[x] ?? 0;
      const upperLeft = x >= bytesPerPixel ? previous[x - bytesPerPixel] : 0;
      const predictor = filter === 0 ? 0
        : filter === 1 ? left
          : filter === 2 ? above
            : filter === 3 ? Math.floor((left + above) / 2)
              : paeth(left, above, upperLeft);
      row[x] = (encoded + predictor) & 0xff;
    }
    const alphaOffset = (channels - 1) * sampleBytes;
    for (let x = alphaOffset; x < rowBytes; x += bytesPerPixel) {
      if (sampleBytes === 1 ? row[x] < 0xff : row.readUInt16BE(x) < 0xffff) {
        return dimensions;
      }
    }
    previous = row;
  }
  throw new Error("PNG image does not contain transparent pixels");
}

export async function saveGeneratedPng(input: {
  bytes: Buffer;
  label: string;
  ownerId: string;
  task?: GeneratedPublicationTask;
  /** Test seam for the external-object write; production uses private OSS. */
  uploadObject?: typeof uploadPrivateAliyunOssObject;
}) {
  if (input.bytes.length < 1 || input.bytes.length > maxImageBytes) {
    throw new Error("Generated PNG image size is invalid");
  }
  const id = randomUUID();
  const path = assetPath(id);
  const checksumSha256 = createHash("sha256").update(input.bytes).digest("hex");
  let releaseResources: (() => void) | undefined;
  let publication: {
    objectKey: string;
    reservation: ReturnType<typeof reserveMediaPublication>;
    routing: { enabled: boolean; profile?: AliyunStorageProfile };
  } | undefined;
  let resourceReservation:
    | ReturnType<typeof reserveMediaProcessResources>
    | undefined;
  let staged = false;
  try {
    resourceReservation = reserveMediaProcessResources({
      bytes: maxImageBytes,
      ownerId: input.ownerId,
    });
    releaseResources = resourceReservation.release;
    publication = await withStorageMediaRoutingReservation((routing) => {
      const objectKey = routing.enabled && routing.profile
        ? createAliyunOssObjectKey("image", "png")
        : `${id}.png`;
      return {
        objectKey,
        reservation: reserveMediaPublication({
          contentType: "image/png",
          finalStorageName: `${id}.png`,
          historyLabel: input.label.slice(0, 120) || "生成图片",
          id,
          kind: "image",
          objectKey,
          ownerId: input.ownerId,
          storageBackend: routing.enabled && routing.profile ? "oss" : "local",
          storageProfileId: routing.profile?.id,
          task: input.task,
        }),
        routing,
      };
    });
    const { objectKey, reservation, routing } = publication;
    await mkdir(path.directory, { recursive: true });
    await resourceReservation.verifyLocalStorage(path.directory);
    const dimensions = validatePng(input.bytes);
    await writeFile(mediaPublicationStagingPath(reservation), input.bytes, {
      flag: "wx",
    });
    stageMediaPublication(reservation, {
      byteSize: input.bytes.length,
      checksumSha256,
      contentType: "image/png",
      mediaHeight: dimensions.height,
      mediaWidth: dimensions.width,
    });
    staged = true;
    if (routing.enabled && routing.profile) {
      await (input.uploadObject ?? uploadPrivateAliyunOssObject)({
        byteSize: input.bytes.length,
        checksumSha256,
        contentType: "image/png",
        credentials: routing.profile,
        filePath: mediaPublicationStagingPath(reservation),
        objectKey,
      });
      markExternalMediaPublicationReady(reservation);
    } else {
      await publishLocalMediaPublication(reservation);
    }
    if (input.task) {
      return {
        assetId: id,
        ...dimensions,
        publicationToken: reservation,
        url: `/api/assets/${id}`,
      };
    }
    finalizeMediaPublication(reservation);
    await cleanupPublicationStaging(reservation).catch(() => undefined);
    return { assetId: id, ...dimensions, url: `/api/assets/${id}` };
  } catch (error) {
    if (publication) {
      if (input.task && staged) {
        throw new MediaPublicationDeferredError();
      }
      await compensateMediaPublication(publication.reservation, {
        profile: publication.routing.profile,
      });
    }
    throw error;
  } finally {
    releaseResources?.();
  }
}

export function assetStorage(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void>;
export function assetStorage(
  request: IncomingMessage,
  response: ServerResponse,
  execution: MediaPublicationExecution,
): Promise<void>;
export async function assetStorage(
  request: IncomingMessage,
  response: ServerResponse,
  execution: MediaPublicationExecution = {},
) {
  const id = decodedRequestPath(request).replace(
    /^\/+/,
    "",
  );
  if (!/^[a-z0-9._-]+$/i.test(id)) {
    if (request.method === "POST") rejectUnreadRequestBody(request, response);
    json(response, 400, { error: "Invalid asset ID" });
    return;
  }

  const path = assetPath(id);
  if (request.method === "GET") {
    const media = readableMedia(request, "image", id);
    if (!media) {
      json(response, 404, { error: "Asset not found" });
      return;
    }
    if (media?.storageBackend === "oss") {
      if (media.storageStatus !== "ready" || !media.objectKey) {
        json(response, 404, { error: "Asset not found" });
        return;
      }
      try {
        const profile = await storageProfileForMedia(media);
        if (!profile) throw new Error("Active OSS profile is unavailable");
        const location = await createPrivateAliyunOssReadUrl(
          media.objectKey,
          profile,
          300,
        );
        response.statusCode = 307;
        response.setHeader("Cache-Control", "private, no-store");
        response.setHeader("Location", location);
        response.end();
      } catch {
        json(response, 503, {
          error: "Cloud asset is temporarily unavailable",
        });
      }
      return;
    }
    try {
      if (basename(media.storageName) !== media.storageName) {
        throw new Error("Invalid media path");
      }
      const file = join(path.directory, media.storageName);
      const info = await stat(file);
      if (info.size !== media.byteSize) throw new Error("Asset is incomplete");
      response.statusCode = 200;
      response.setHeader("Cache-Control", "private, max-age=31536000, immutable");
      response.setHeader("Content-Length", String(info.size));
      response.setHeader("Content-Type", "image/png");
      createReadStream(file).pipe(response);
    } catch {
      json(response, 404, { error: "Asset not found" });
    }
    return;
  }

  if (request.method === "DELETE") {
    let deletion;
    try {
      deletion = beginMediaDeletion(
        request,
        "image",
        id,
        execution.assertDeletionAllowedInTransaction,
      );
    } catch (error) {
      json(response, 409, {
        code: "MEDIA_DELETE_CONFLICT",
        error: error instanceof Error ? error.message : "Asset cannot be deleted",
      });
      return;
    }
    if (!deletion) {
      json(response, 404, { error: "Asset not found" });
      return;
    }
    if (deletion.action === "deferred") {
      response.statusCode = 204;
      response.end();
      return;
    }
    const media = deletion.media;
    try {
      await execution.beforePhysicalDelete?.({ id, kind: "image", media });
    } catch {
      try {
        markMediaDeletionFailed(request, "image", id);
      } catch {
        // Preserve the injected physical-boundary failure.
      }
      json(response, 503, { error: "Asset could not be deleted" });
      return;
    }
    if (media.storageBackend === "oss") {
      try {
        const profile = await storageProfileForDestructiveMedia(media);
        if (!profile || !media.objectKey) {
          throw new Error("Active OSS profile is unavailable");
        }
        await (execution.deleteExternalObject ?? deletePrivateAliyunOssObject)(
          media.objectKey,
          profile,
        );
        finishMediaDeletion(request, "image", id, media);
        response.statusCode = 204;
        response.end();
      } catch {
        try {
          markMediaDeletionFailed(request, "image", id);
        } catch {
          // The original physical-delete failure remains the response cause.
        }
        json(response, 503, {
          error: "Cloud asset could not be deleted",
        });
      }
      return;
    }
    try {
      if (basename(media.storageName) !== media.storageName) {
        throw new Error("Invalid media path");
      }
      await rm(join(path.directory, media.storageName), { force: true });
      finishMediaDeletion(request, "image", id, media);
    } catch {
      try {
        markMediaDeletionFailed(request, "image", id);
      } catch {
        // The original physical-delete failure remains the response cause.
      }
      json(response, 503, { error: "Asset could not be deleted" });
      return;
    }
    response.statusCode = 204;
    response.end();
    return;
  }

  if (request.method !== "POST") {
    response.setHeader("Allow", "GET, POST, DELETE");
    json(response, 405, { error: "Method not allowed" });
    return;
  }

  let reservation: ReturnType<typeof reserveMediaPublication> | undefined;
  let profile: AliyunStorageProfile | undefined;
  let releaseResources: (() => void) | undefined;
  try {
    const fileName = decodedRequestHeader(
      request,
      String(request.headers["x-file-name"] ?? "Image.png"),
    ).slice(0, 240);
    if (request.headers["content-type"] !== "image/png") {
      throw new Error("Only PNG images are supported");
    }
    assertDeclaredBodyWithin(request, maxImageBytes);
    const identity = requestIdentity(request)!;
    const ownerId = identity.bypass ? "__test__" : identity.userId;
    releaseResources = await reserveMediaResources({
      bytes: maxImageBytes,
      directory: path.directory,
      ownerId,
    });
    const reserve = (routing: {
      enabled: boolean;
      profile?: AliyunStorageProfile;
    }) => {
      const objectKey = routing.enabled && routing.profile
        ? createAliyunOssObjectKey("image", "png")
        : `${id}.png`;
      return {
        objectKey,
        reservation: reserveMediaPublication({
          contentType: "image/png",
          finalStorageName: `${id}.png`,
          id,
          kind: "image",
          objectKey,
          ownerId,
          storageBackend: routing.enabled && routing.profile ? "oss" : "local",
          storageProfileId: routing.profile?.id,
        }),
        routing,
      };
    };
    const publication = identity.bypass
      ? await (async () => {
          if (execution.beforeReservation) {
            await execution.beforeReservation();
          }
          return reserve({ enabled: false });
        })()
      : await withStorageMediaRoutingReservation(reserve, {
          afterRead: execution.beforeReservation,
        });
    const { objectKey, routing } = publication;
    reservation = publication.reservation;
    profile = routing.profile;
    const bytes = await readImage(request);
    const { height, width } = validatePng(bytes);
    const checksumSha256 = createHash("sha256").update(bytes).digest("hex");

    await mkdir(path.directory, { recursive: true });
    await writeFile(mediaPublicationStagingPath(reservation), bytes, { flag: "wx" });
    stageMediaPublication(reservation, {
      byteSize: bytes.length,
      checksumSha256,
      contentType: "image/png",
      mediaHeight: height,
      mediaWidth: width,
    });
    await execution.afterTransition?.("staged", reservation);
    if (routing.enabled && routing.profile) {
      await uploadPrivateAliyunOssObject({
        byteSize: bytes.length,
        checksumSha256,
        contentType: "image/png",
        credentials: routing.profile,
        filePath: mediaPublicationStagingPath(reservation),
        objectKey,
      });
      markExternalMediaPublicationReady(reservation);
    } else {
      await publishLocalMediaPublication(reservation);
    }
    await execution.afterTransition?.("external-ready", reservation);
    finalizeMediaPublication(reservation);
    await cleanupPublicationStaging(reservation).catch(() => undefined);
    json(response, 201, {
      assetId: id,
      byteSize: bytes.length,
      contentType: "image/png",
      fileName,
      height,
      mediaHeight: height,
      mediaWidth: width,
      storageBackend: routing.enabled && routing.profile ? "oss" : "local",
      url: `/api/assets/${id}`,
      width,
    });
  } catch (error) {
    if (request.method === "POST") rejectUnreadRequestBody(request, response);
    if (reservation) {
      await compensateMediaPublication(reservation, { profile });
    }
    if (error instanceof BoundedBodyError) {
      response.setHeader("Connection", "close");
      json(response, error.statusCode, {
        code: error.code,
        error: error.message,
      });
      return;
    }
    if (error instanceof ResourceBudgetError) {
      response.setHeader("Retry-After", "5");
      json(response, error.statusCode, {
        code: error.code,
        error: error.message,
      });
      return;
    }
    if (error instanceof HttpRequestError) throw error;
    json(response, error instanceof MediaPublicationConflictError ? 409 : 400, {
      code: error instanceof MediaPublicationConflictError
        ? "MEDIA_ID_UNAVAILABLE"
        : undefined,
      error: error instanceof Error ? error.message : "Upload failed",
    });
  } finally {
    releaseResources?.();
  }
}
