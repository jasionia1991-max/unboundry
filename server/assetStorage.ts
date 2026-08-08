import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, join } from "node:path";
import { crc32, inflateSync } from "node:zlib";
import {
  createAliyunOssObjectKey,
  createPrivateAliyunOssReadUrl,
  deletePrivateAliyunOssObject,
  uploadPrivateAliyunOssObject,
} from "./aliyunOss";
import { publishCloudObject } from "./cloudMediaStorage";
import { requestIdentity } from "./auth";
import {
  decodedRequestHeader,
  decodedRequestPath,
  HttpRequestError,
} from "./httpRequest";
import {
  mayReadMedia,
  mayWriteMedia,
  readableMedia,
  readableMediaForOwner,
  registerMedia,
  registerMediaForOwner,
  unregisterMedia,
} from "./mediaRegistry";
import {
  storageMediaRoutingState,
  storageProfileForMedia,
} from "./secureStorageProfiles";
import { openAppDatabase } from "./database";

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
    return createPrivateAliyunOssReadUrl(media.objectKey, profile, 300);
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
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > maxImageBytes) throw new Error("Image is too large");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
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

export async function saveGeneratedPng(input: {
  bytes: Buffer;
  label: string;
  ownerId: string;
}) {
  const dimensions = validatePng(input.bytes);
  const id = randomUUID();
  const path = assetPath(id);
  const temporary = `${path.file}.${randomUUID()}.generating`;
  const checksumSha256 = createHash("sha256").update(input.bytes).digest("hex");
  const routing = await storageMediaRoutingState();
  await mkdir(path.directory, { recursive: true });
  await writeFile(temporary, input.bytes, { flag: "wx" });
  try {
    if (routing.enabled && routing.profile) {
      const objectKey = createAliyunOssObjectKey("image", "png");
      await publishCloudObject({
        commit: () =>
          registerMediaForOwner(input.ownerId, {
            byteSize: input.bytes.length,
            checksumSha256,
            contentType: "image/png",
            id,
            kind: "image",
            mediaHeight: dimensions.height,
            mediaWidth: dimensions.width,
            objectKey,
            storageBackend: "oss",
            storageProfileId: routing.profile?.id,
            storageName: `${id}.png`,
          }),
        remove: () => deletePrivateAliyunOssObject(objectKey, routing.profile!),
        upload: () =>
          uploadPrivateAliyunOssObject({
            byteSize: input.bytes.length,
            checksumSha256,
            contentType: "image/png",
            credentials: routing.profile!,
            filePath: temporary,
            objectKey,
          }).then(() => undefined),
      });
      await rm(temporary, { force: true });
    } else {
      await rename(temporary, path.file);
      registerMediaForOwner(input.ownerId, {
        byteSize: input.bytes.length,
        checksumSha256,
        contentType: "image/png",
        id,
        kind: "image",
        mediaHeight: dimensions.height,
        mediaWidth: dimensions.width,
        storageName: `${id}.png`,
      });
    }
    const store = openAppDatabase();
    try {
      store.prepare(`
        INSERT INTO asset_history (
          account_id, id, kind, label, preview, created_at, owner_id
        ) VALUES (?, ?, 'image', ?, ?, ?, ?)
        ON CONFLICT(account_id, id) DO UPDATE SET
          label = excluded.label,
          preview = excluded.preview,
          owner_id = excluded.owner_id
      `).run(
        input.ownerId,
        id,
        input.label.slice(0, 120) || "生成图片",
        `/api/assets/${id}`,
        new Date().toISOString(),
        input.ownerId,
      );
    } finally {
      store.close();
    }
    return { assetId: id, ...dimensions, url: `/api/assets/${id}` };
  } catch (error) {
    await rm(temporary, { force: true });
    await rm(path.file, { force: true });
    throw error;
  }
}

export async function assetStorage(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const id = decodedRequestPath(request).replace(
    /^\/+/,
    "",
  );
  if (!/^[a-z0-9._-]+$/i.test(id)) {
    json(response, 400, { error: "Invalid asset ID" });
    return;
  }

  const path = assetPath(id);
  if (request.method === "GET") {
    if (!mayReadMedia(request, "image", id)) {
      json(response, 404, { error: "Asset not found" });
      return;
    }
    const media = readableMedia(request, "image", id);
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
      const info = await stat(path.file);
      response.statusCode = 200;
      response.setHeader("Cache-Control", "private, max-age=31536000, immutable");
      response.setHeader("Content-Length", String(info.size));
      response.setHeader("Content-Type", "image/png");
      createReadStream(path.file).pipe(response);
    } catch {
      json(response, 404, { error: "Asset not found" });
    }
    return;
  }

  if (request.method === "DELETE") {
    if (!mayReadMedia(request, "image", id)) {
      json(response, 404, { error: "Asset not found" });
      return;
    }
    const media = readableMedia(request, "image", id);
    if (media?.storageBackend === "oss") {
      try {
        const profile = await storageProfileForMedia(media);
        if (!profile) throw new Error("Active OSS profile is unavailable");
        await deletePrivateAliyunOssObject(media.objectKey, profile);
        unregisterMedia(request, "image", id);
        response.statusCode = 204;
        response.end();
      } catch {
        json(response, 503, {
          error: "Cloud asset could not be deleted",
        });
      }
      return;
    }
    await rm(path.file, { force: true });
    unregisterMedia(request, "image", id);
    response.statusCode = 204;
    response.end();
    return;
  }

  if (request.method !== "POST") {
    response.setHeader("Allow", "GET, POST, DELETE");
    json(response, 405, { error: "Method not allowed" });
    return;
  }

  const temporary = `${path.file}.${randomUUID()}.uploading`;
  let cloudAttempted = false;
  try {
    const fileName = decodedRequestHeader(
      request,
      String(request.headers["x-file-name"] ?? "Image.png"),
    ).slice(0, 240);
    if (!mayWriteMedia(request, "image", id)) {
      throw new Error("Asset ID is unavailable");
    }
    if (request.headers["content-type"] !== "image/png") {
      throw new Error("Only PNG images are supported");
    }
    const bytes = await readImage(request);
    const { height, width } = validatePng(bytes);
    const checksumSha256 = createHash("sha256").update(bytes).digest("hex");
    const routing = requestIdentity(request)?.bypass
      ? { enabled: false, profile: undefined }
      : await storageMediaRoutingState();

    await mkdir(path.directory, { recursive: true });
    await writeFile(temporary, bytes, { flag: "wx" });
    if (routing.enabled && routing.profile) {
      cloudAttempted = true;
      const objectKey = createAliyunOssObjectKey("image", "png");
      await publishCloudObject({
        commit: () =>
          registerMedia(request, {
            byteSize: bytes.length,
            checksumSha256,
            contentType: "image/png",
            id,
            kind: "image",
            objectKey,
            storageBackend: "oss",
            storageProfileId: routing.profile?.id,
            storageName: `${id}.png`,
          }),
        remove: () =>
          deletePrivateAliyunOssObject(objectKey, routing.profile!),
        upload: async () => {
          await uploadPrivateAliyunOssObject({
            byteSize: bytes.length,
            checksumSha256,
            contentType: "image/png",
            credentials: routing.profile!,
            filePath: temporary,
            objectKey,
          });
        },
      });
      await rm(temporary, { force: true });
      await rm(path.file, { force: true });
    } else {
      await rename(temporary, path.file);
      registerMedia(request, {
        byteSize: bytes.length,
        checksumSha256,
        contentType: "image/png",
        id,
        kind: "image",
        storageName: `${id}.png`,
      });
    }
    json(response, 201, {
      assetId: id,
      byteSize: bytes.length,
      contentType: "image/png",
      fileName,
      height,
      storageBackend: routing.enabled && routing.profile ? "oss" : "local",
      url: `/api/assets/${id}`,
      width,
    });
  } catch (error) {
    if (error instanceof HttpRequestError) throw error;
    await rm(temporary, { force: true });
    json(response, 400, {
      error: cloudAttempted
        ? "云端素材保存失败，未创建节点"
        : error instanceof Error
          ? error.message
          : "Upload failed",
    });
  }
}
