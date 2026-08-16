import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, open, readFile, rm, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, join } from "node:path";
import {
  createPrivateAliyunOssReadUrl,
} from "./aliyunOss";
import { requestIdentity } from "./auth";
import { appDataDirectory } from "./database";
import { HttpRequestError, readJsonBody } from "./httpRequest";
import { readableMedia, type MediaRecord } from "./mediaRegistry";
import { runMediaProcess } from "./mediaProcess";
import { fetchPublicHttps } from "./outboundNetwork";
import {
  reserveMediaResources,
  ResourceBudgetError,
} from "./resourceBudget";
import { storageProfileForMedia } from "./secureStorageProfiles";

type Sheet = {
  columns: number;
  count: number;
  frameHeight: number;
  frameWidth: number;
  image: Buffer;
  interval: number;
  rows: number;
};

type CacheEntry = {
  expiresAt: number;
  sheet: Sheet;
};

const assetIdPattern = /^[a-z0-9][a-z0-9._-]{0,198}\.mp4$/i;
const cache = new Map<string, CacheEntry>();
const singleflight = new Map<string, Promise<Sheet>>();
const cacheTtlMs = 60 * 60_000;
const maxCacheBytes = 64 * 1_024 * 1_024;
const maxCacheEntries = 24;
const maxFrameHeight = 540;
const maxInputBytes = 500 * 1_024 * 1_024;
const maxInputPixels = 33_177_600;
const maxOutputBytes = 8 * 1_024 * 1_024;
const maxSheetPixels = 16_000_000;
let cachedBytes = 0;

export function validateThumbnailSourceProbe(
  width: unknown,
  height: unknown,
  durationValue: unknown,
) {
  const duration = Number(durationValue);
  if (
    !Number.isSafeInteger(width) ||
    Number(width) < 1 ||
    !Number.isSafeInteger(height) ||
    Number(height) < 1 ||
    Number(width) > Math.floor(maxInputPixels / Number(height)) ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    duration > 7 * 24 * 60 * 60
  ) {
    throw new Error("视频没有可用画面或画面尺寸超出限制");
  }
  return {
    duration,
    height: Number(height),
    width: Number(width),
  };
}

function json(response: ServerResponse, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function ownerId(request: IncomingMessage) {
  const identity = requestIdentity(request);
  if (!identity) throw new Error("请先登录");
  return identity.bypass ? "__test__" : identity.userId;
}

async function sha256File(file: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

function cachedSheet(key: string) {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    cachedBytes -= entry.sheet.image.length;
    return undefined;
  }
  cache.delete(key);
  cache.set(key, entry);
  return entry.sheet;
}

function storeSheet(key: string, sheet: Sheet) {
  const previous = cache.get(key);
  if (previous) cachedBytes -= previous.sheet.image.length;
  cache.delete(key);
  cache.set(key, { expiresAt: Date.now() + cacheTtlMs, sheet });
  cachedBytes += sheet.image.length;
  while (cache.size > maxCacheEntries || cachedBytes > maxCacheBytes) {
    const oldestKey = cache.keys().next().value as string | undefined;
    if (oldestKey === undefined) break;
    const oldest = cache.get(oldestKey)!;
    cache.delete(oldestKey);
    cachedBytes -= oldest.sheet.image.length;
  }
}

async function spoolOssMedia(media: MediaRecord, destination: string) {
  const profile = await storageProfileForMedia(media);
  if (!profile) throw new Error("云端视频素材暂不可用");
  const location = await createPrivateAliyunOssReadUrl(
    media.objectKey,
    profile,
    600,
  );
  const signal = AbortSignal.timeout(5 * 60_000);
  const response = await fetchPublicHttps(
    location,
    { signal },
    { timeoutMs: 60_000 },
  );
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("云端视频素材读取失败");
  }
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared !== media.byteSize) {
    await response.body.cancel().catch(() => undefined);
    throw new Error("云端视频素材长度不一致");
  }
  const reader = response.body.getReader();
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let size = 0;
  let completed = false;
  try {
    handle = await open(destination, "wx");
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > media.byteSize || size > maxInputBytes) {
        throw new Error("云端视频素材超过可信大小");
      }
      await handle.writeFile(Buffer.from(value));
    }
    completed = true;
  } finally {
    if (!completed) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
    await handle?.close();
  }
  if (size !== media.byteSize) throw new Error("云端视频素材不完整");
  if (await sha256File(destination) !== media.checksumSha256) {
    throw new Error("云端视频素材校验失败");
  }
}

async function generateSheet(owner: string, media: MediaRecord) {
  const dataDirectory = appDataDirectory();
  const release = await reserveMediaResources({
    bytes: maxOutputBytes +
      (media.storageBackend === "oss" ? media.byteSize : 0),
    directory: dataDirectory,
    ownerId: owner,
  });
  let directory = "";
  try {
    directory = await mkdtemp(join(dataDirectory, "thumbnail-work-"));
    let input: string;
    if (media.storageBackend === "local") {
      if (basename(media.storageName) !== media.storageName) {
        throw new Error("视频素材路径无效");
      }
      input = join(dataDirectory, "media", media.storageName);
      const info = await stat(input);
      if (!info.isFile() || info.size !== media.byteSize) {
        throw new Error("视频素材文件不完整");
      }
    } else {
      input = join(directory, "input.mp4");
      await spoolOssMedia(media, input);
    }
    const output = join(directory, "sheet.jpg");
    const probe = JSON.parse((await runMediaProcess(
      "ffprobe",
      [
        "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "format=duration:stream=width,height",
        "-of", "json",
        input,
      ],
      { kind: "probe", timeoutMs: 20_000 },
    )).stdout) as {
      format?: { duration?: string };
      streams?: Array<{ height?: number; width?: number }>;
    };
    const stream = probe.streams?.[0];
    const source = validateThumbnailSourceProbe(
      stream?.width,
      stream?.height,
      probe.format?.duration,
    );
    const duration = source.duration;
    const frameWidth = 96;
    const frameHeight = Math.min(
      maxFrameHeight,
      Math.max(
        2,
        Math.round((frameWidth * source.height) / source.width / 2) * 2,
      ),
    );
    const columns = 10;
    const rowPixelLimit = Math.max(
      1,
      Math.floor(maxSheetPixels / (columns * frameWidth * frameHeight)),
    );
    const maxRows = Math.max(1, Math.min(
      Math.floor(16_000 / frameHeight),
      rowPixelLimit,
    ));
    const maxFrames = columns * maxRows;
    const interval = Math.max(0.1, duration / maxFrames);
    const count = Math.max(1, Math.min(maxFrames, Math.ceil(duration / interval)));
    const rows = Math.ceil(count / columns);
    await runMediaProcess("ffmpeg", [
      "-y", "-i", input,
      "-vf",
      `fps=1/${interval},scale=${frameWidth}:${frameHeight}:force_original_aspect_ratio=decrease,pad=${frameWidth}:${frameHeight}:(ow-iw)/2:(oh-ih)/2:black,tile=${columns}x${rows}`,
      "-frames:v", "1", "-c:v", "mjpeg", "-q:v", "4",
      "-fs", String(maxOutputBytes + 1), output,
    ], { kind: "encode", timeoutMs: 5 * 60_000 });
    const info = await stat(output);
    if (!info.isFile() || info.size < 1 || info.size > maxOutputBytes) {
      throw new Error("缩略图结果超过大小限制");
    }
    const image = await readFile(output);
    if (
      image.length < 4 ||
      image[0] !== 0xff ||
      image[1] !== 0xd8 ||
      image.at(-2) !== 0xff ||
      image.at(-1) !== 0xd9
    ) {
      throw new Error("缩略图结果不完整");
    }
    return {
      columns,
      count,
      frameHeight,
      frameWidth,
      image,
      interval,
      rows,
    };
  } finally {
    release();
    if (directory) await rm(directory, { force: true, recursive: true });
  }
}

async function sheetFor(key: string, owner: string, media: MediaRecord) {
  const hit = cachedSheet(key);
  if (hit) return hit;
  const existing = singleflight.get(key);
  if (existing) return existing;
  const pending = generateSheet(owner, media)
    .then((sheet) => {
      storeSheet(key, sheet);
      return sheet;
    })
    .finally(() => singleflight.delete(key));
  singleflight.set(key, pending);
  return pending;
}

export async function playlistThumbnails(
  request: IncomingMessage,
  response: ServerResponse,
) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    json(response, 405, { error: "只支持 POST", code: "METHOD_NOT_ALLOWED" });
    return;
  }
  try {
    const body = await readJsonBody<{ assetId?: unknown }>(request, 16 * 1_024);
    const assetId = typeof body.assetId === "string" ? body.assetId : "";
    if (!assetIdPattern.test(assetId)) throw new Error("视频素材标识无效");
    const media = readableMedia(request, "video", assetId);
    if (
      !media ||
      media.contentType !== "video/mp4" ||
      media.byteSize < 1 ||
      media.byteSize > maxInputBytes
    ) {
      throw new Error("视频素材不存在或尚未保存");
    }
    const owner = ownerId(request);
    const key = `${owner}\0${assetId}\0${media.checksumSha256}`;
    const sheet = await sheetFor(key, owner, media);
    response.statusCode = 200;
    response.setHeader("Cache-Control", "private, max-age=3600");
    response.setHeader("Content-Length", String(sheet.image.length));
    response.setHeader("Content-Type", "image/jpeg");
    response.setHeader("X-Thumbnail-Columns", String(sheet.columns));
    response.setHeader("X-Thumbnail-Count", String(sheet.count));
    response.setHeader("X-Thumbnail-Frame-Height", String(sheet.frameHeight));
    response.setHeader("X-Thumbnail-Frame-Width", String(sheet.frameWidth));
    response.setHeader("X-Thumbnail-Interval", String(sheet.interval));
    response.setHeader("X-Thumbnail-Rows", String(sheet.rows));
    response.end(sheet.image);
  } catch (error) {
    if (error instanceof HttpRequestError) throw error;
    if (error instanceof ResourceBudgetError) {
      response.setHeader("Retry-After", "5");
      json(response, error.statusCode, { code: error.code, error: error.message });
      return;
    }
    json(response, 400, {
      code: "PLAYLIST_THUMBNAIL_FAILED",
      error: error instanceof Error ? error.message : "缩略图生成失败",
    });
  }
}
