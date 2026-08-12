import { isUtf8 } from "node:buffer";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  copyFile,
  mkdtemp,
  open,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import {
  createAliyunOssObjectKey,
  createPrivateAliyunOssReadUrl,
  uploadPrivateAliyunOssObject,
} from "./aliyunOss";
import { requestIdentity } from "./auth";
import { appDataDirectory } from "./database";
import { HttpRequestError, readJsonBody } from "./httpRequest";
import { BoundedBodyError, readBoundedBody } from "./boundedBody";
import {
  cleanupPublicationStaging,
  compensateMediaPublication,
  finalizeMediaPublication,
  markExternalMediaPublicationReady,
  mediaPublicationStagingPath,
  MediaPublicationConflictError,
  publishLocalMediaPublication,
  reserveMediaPublication,
  stageMediaPublication,
} from "./mediaLifecycle";
import { probeTrustedMediaMetadata } from "./mediaMetadata";
import { readableMedia, type MediaRecord } from "./mediaRegistry";
import { runMediaProcess } from "./mediaProcess";
import { fetchPublicHttps } from "./outboundNetwork";
import {
  reserveMediaResources,
  ResourceBudgetError,
} from "./resourceBudget";
import {
  storageProfileForMedia,
  withStorageMediaRoutingReservation,
  type AliyunStorageProfile,
} from "./secureStorageProfiles";

type PlaylistClipInput = {
  assetId?: unknown;
  end?: unknown;
  fixturePath?: unknown;
  start?: unknown;
};

type PlaylistExportInput = {
  assetId?: unknown;
  clips?: unknown;
  fileName?: unknown;
  mode?: unknown;
};

const assetIdPattern = /^[a-z0-9][a-z0-9._-]{0,198}\.mp4$/i;
const fixturePathPattern = /^\/fixtures\/[a-z0-9][a-z0-9._-]{0,120}\.mp4$/i;
const maxClipCount = 100;
const maxExportBytes = 500 * 1_024 * 1_024;
const maxSourceBytes = 1_024 * 1_024 * 1_024;
const maxTotalDurationSeconds = 2 * 60 * 60;
const maxVideoPixels = 33_177_600;

export function playlistPartOutputLimit(partBytes: number) {
  const remaining = maxExportBytes - partBytes;
  if (!Number.isSafeInteger(partBytes) || partBytes < 0 || remaining < 1) {
    throw new Error("播放列表片段累计超过 500MiB 限制");
  }
  return remaining + 1;
}

export function assertPlaylistOutputDuration(
  actualDuration: number,
  expectedDuration: number,
  clipCount: number,
) {
  const tolerance = Math.max(0.25, clipCount / 30 + 0.1);
  if (
    !Number.isFinite(actualDuration) ||
    !Number.isFinite(expectedDuration) ||
    !Number.isSafeInteger(clipCount) ||
    clipCount < 1 ||
    Math.abs(actualDuration - expectedDuration) > tolerance
  ) {
    throw new Error("导出结果时长不完整");
  }
}

async function readPlaylistExportInput(request: IncomingMessage) {
  const contentType = request.headers["content-type"];
  if (
    typeof contentType !== "string" ||
    contentType.split(";", 1)[0]?.trim().toLowerCase() !==
      "application/x-www-form-urlencoded"
  ) {
    return readJsonBody<PlaylistExportInput>(request, 128 * 1_024);
  }
  let body: Buffer;
  try {
    body = await readBoundedBody(request, {
      idleTimeoutMs: 15_000,
      maximumBytes: 128 * 1_024,
      totalTimeoutMs: 120_000,
    });
  } catch (error) {
    if (error instanceof BoundedBodyError) {
      if (error.code === "PAYLOAD_TOO_LARGE") {
        throw new HttpRequestError(
          "PAYLOAD_TOO_LARGE",
          413,
          "Request payload is too large",
        );
      }
      throw new HttpRequestError(
        "REQUEST_TIMEOUT",
        408,
        "Request body timed out",
      );
    }
    throw error;
  }
  if (!isUtf8(body) || request.aborted) {
    throw new HttpRequestError(
      "INVALID_JSON",
      400,
      "Playlist download request is invalid",
    );
  }
  try {
    const fields = new URLSearchParams(body.toString("utf8"));
    const payloads = fields.getAll("payload");
    if (fields.size !== 1 || payloads.length !== 1) throw new Error();
    return JSON.parse(payloads[0]) as PlaylistExportInput;
  } catch {
    throw new HttpRequestError(
      "INVALID_JSON",
      400,
      "Playlist download request is invalid",
    );
  }
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

async function spoolOssMedia(
  media: MediaRecord,
  destination: string,
  signal: AbortSignal,
) {
  const profile = await storageProfileForMedia(media);
  if (!profile) throw new Error("云端视频素材暂不可用");
  const location = await createPrivateAliyunOssReadUrl(
    media.objectKey,
    profile,
    600,
  );
  const bodyDeadline = AbortSignal.timeout(5 * 60_000);
  const combined = AbortSignal.any([signal, bodyDeadline]);
  const response = await fetchPublicHttps(
    location,
    { signal: combined },
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
      if (size > media.byteSize || size > maxExportBytes) {
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

async function mediaFile(
  media: MediaRecord,
  directory: string,
  index: number,
  signal: AbortSignal,
) {
  if (media.byteSize < 1 || media.byteSize > maxExportBytes) {
    throw new Error("视频素材大小无效");
  }
  if (media.storageBackend === "local") {
    if (basename(media.storageName) !== media.storageName) {
      throw new Error("视频素材路径无效");
    }
    const file = join(appDataDirectory(), "media", media.storageName);
    const info = await stat(file);
    if (!info.isFile() || info.size !== media.byteSize) {
      throw new Error("视频素材文件不完整");
    }
    return file;
  }
  const destination = join(directory, `source-${index}.mp4`);
  await spoolOssMedia(media, destination, signal);
  return destination;
}

async function publishExport(
  request: IncomingMessage,
  file: string,
  input: { assetId: string; fileName: string },
) {
  const owner = ownerId(request);
  let reservation: ReturnType<typeof reserveMediaPublication> | undefined;
  let profile: AliyunStorageProfile | undefined;
  try {
    const publication = await withStorageMediaRoutingReservation((routing) => {
      const objectKey = routing.enabled && routing.profile
        ? createAliyunOssObjectKey("video", "mp4")
        : input.assetId;
      return {
        objectKey,
        reservation: reserveMediaPublication({
          contentType: "video/mp4",
          finalStorageName: input.assetId,
          id: input.assetId,
          kind: "video",
          objectKey,
          ownerId: owner,
          storageBackend: routing.enabled && routing.profile ? "oss" : "local",
          storageProfileId: routing.profile?.id,
        }),
        routing,
      };
    });
    reservation = publication.reservation;
    profile = publication.routing.profile;
    await copyFile(file, mediaPublicationStagingPath(reservation));
    const info = await stat(file);
    const metadata = await probeTrustedMediaMetadata(file);
    const checksumSha256 = await sha256File(file);
    stageMediaPublication(reservation, {
      byteSize: info.size,
      checksumSha256,
      contentType: "video/mp4",
      durationSeconds: metadata.durationSeconds,
      mediaHeight: metadata.height,
      mediaWidth: metadata.width,
    });
    if (publication.routing.enabled && publication.routing.profile) {
      await uploadPrivateAliyunOssObject({
        byteSize: info.size,
        checksumSha256,
        contentType: "video/mp4",
        credentials: publication.routing.profile,
        filePath: mediaPublicationStagingPath(reservation),
        objectKey: publication.objectKey,
      });
      markExternalMediaPublicationReady(reservation);
    } else {
      await publishLocalMediaPublication(reservation);
    }
    finalizeMediaPublication(reservation);
    await cleanupPublicationStaging(reservation).catch(() => undefined);
    return {
      assetId: input.assetId,
      byteSize: info.size,
      contentType: "video/mp4",
      durationSeconds: metadata.durationSeconds,
      fileName: input.fileName,
      mediaHeight: metadata.height,
      mediaWidth: metadata.width,
      storageBackend: publication.routing.enabled && publication.routing.profile
        ? "oss" as const
        : "local" as const,
      url: `/api/video-assets/${input.assetId}`,
    };
  } catch (error) {
    if (reservation) await compensateMediaPublication(reservation, { profile });
    throw error;
  }
}

export async function playlistExport(
  request: IncomingMessage,
  response: ServerResponse,
) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    json(response, 405, { error: "只支持 POST", code: "METHOD_NOT_ALLOWED" });
    return;
  }
  const abort = new AbortController();
  const onRequestAbort = () => abort.abort();
  const onResponseClose = () => {
    if (!response.writableEnded) abort.abort();
  };
  request.once("aborted", onRequestAbort);
  response.once("close", onResponseClose);
  let directory = "";
  let releaseResources: (() => void) | undefined;
  try {
    const input = await readPlaylistExportInput(request);
    if (!Array.isArray(input.clips) || input.clips.length < 1 || input.clips.length > maxClipCount) {
      throw new Error("播放列表片段数量无效");
    }
    const mode = input.mode === "asset" ? "asset" :
      input.mode === "download" || input.mode === undefined ? "download" : undefined;
    if (!mode) throw new Error("导出模式无效");
    const assetId = typeof input.assetId === "string" ? input.assetId : "";
    if (mode === "asset" && !assetIdPattern.test(assetId)) {
      throw new Error("导出素材标识无效");
    }
    const fileName = typeof input.fileName === "string" && input.fileName.trim()
      ? input.fileName.trim().slice(0, 240)
      : "Playlist.mp4";
    const allowFixture = requestIdentity(request)?.bypass === true;
    const clips = input.clips.map((value, index) => {
      const clip = value as PlaylistClipInput;
      const clipAssetId = typeof clip?.assetId === "string" ? clip.assetId : "";
      const fixturePath = typeof clip?.fixturePath === "string"
        ? clip.fixturePath
        : "";
      const start = Number(clip?.start);
      const end = Number(clip?.end);
      if (
        (!assetIdPattern.test(clipAssetId) &&
          !(allowFixture && fixturePathPattern.test(fixturePath))) ||
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        start < 0 ||
        end <= start
      ) {
        throw new Error(`第 ${index + 1} 个片段无效`);
      }
      const assetId = assetIdPattern.test(clipAssetId) ? clipAssetId : undefined;
      const fixture = assetId ? undefined : fixturePath;
      return {
        assetId,
        end,
        fixturePath: fixture,
        sourceId: assetId ? `asset:${assetId}` : `fixture:${fixture}`,
        start,
      };
    });

    const mediaById = new Map<string, MediaRecord>();
    const fixtureByPath = new Map<string, { byteSize: number; file: string }>();
    let sourceBytes = 0;
    let ossBytes = 0;
    for (const clip of clips) {
      if (clip.assetId) {
        if (mediaById.has(clip.assetId)) continue;
        const media = readableMedia(request, "video", clip.assetId);
        if (!media || media.contentType !== "video/mp4") {
          throw new Error("播放列表包含不可读取的视频素材");
        }
        sourceBytes += media.byteSize;
        if (media.storageBackend === "oss") ossBytes += media.byteSize;
        mediaById.set(clip.assetId, media);
      } else {
        const fixturePath = clip.fixturePath!;
        if (fixtureByPath.has(fixturePath)) continue;
        const file = join(
          process.cwd(),
          "client",
          "public",
          fixturePath.slice(1),
        );
        const info = await stat(file);
        if (!info.isFile() || info.size < 1 || info.size > maxExportBytes) {
          throw new Error("测试视频 fixture 大小无效");
        }
        sourceBytes += info.size;
        fixtureByPath.set(fixturePath, { byteSize: info.size, file });
      }
      if (sourceBytes > maxSourceBytes) throw new Error("播放列表源素材总量过大");
    }
    const dataDirectory = appDataDirectory();
    releaseResources = await reserveMediaResources({
      bytes: Math.min(2 * 1_024 * 1_024 * 1_024, maxExportBytes * 2 + ossBytes),
      directory: dataDirectory,
      ownerId: ownerId(request),
    });
    directory = await mkdtemp(join(dataDirectory, "playlist-work-"));

    const sourceById = new Map<string, {
      file: string;
      hasAudio: boolean;
      metadata: Awaited<ReturnType<typeof probeTrustedMediaMetadata>>;
    }>();
    const inspectSource = async (id: string, file: string) => {
      const metadata = await probeTrustedMediaMetadata(file);
      if (
        !metadata.width ||
        !metadata.height ||
        metadata.width * metadata.height > maxVideoPixels
      ) {
        throw new Error("视频素材画面尺寸超出导出限制");
      }
      const audio = JSON.parse((await runMediaProcess("ffprobe", [
        "-v", "error",
        "-select_streams", "a:0",
        "-show_entries", "stream=index",
        "-of", "json",
        file,
      ], { kind: "probe", signal: abort.signal, timeoutMs: 20_000 })).stdout) as {
        streams?: unknown[];
      };
      sourceById.set(id, {
        file,
        hasAudio: Boolean(audio.streams?.length),
        metadata,
      });
    };
    let sourceIndex = 0;
    for (const [id, media] of mediaById) {
      const file = await mediaFile(media, directory, sourceIndex++, abort.signal);
      await inspectSource(`asset:${id}`, file);
    }
    for (const [fixturePath, fixture] of fixtureByPath) {
      await inspectSource(`fixture:${fixturePath}`, fixture.file);
    }

    let totalDuration = 0;
    for (const [index, clip] of clips.entries()) {
      const source = sourceById.get(clip.sourceId)!;
      if (clip.end > source.metadata.durationSeconds + 0.05) {
        throw new Error(`第 ${index + 1} 个片段超出素材时长`);
      }
      totalDuration += clip.end - clip.start;
    }
    if (totalDuration > maxTotalDurationSeconds) {
      throw new Error("播放列表总时长超过 2 小时");
    }

    const firstVideo = sourceById.get(clips[0].sourceId)!.metadata;
    const width = Math.max(2, Math.floor(firstVideo.width! / 2) * 2);
    const height = Math.max(2, Math.floor(firstVideo.height! / 2) * 2);
    const parts: string[] = [];
    let partBytes = 0;
    for (const [index, clip] of clips.entries()) {
      const source = sourceById.get(clip.sourceId)!;
      const duration = clip.end - clip.start;
      const output = join(directory, `part-${index}.mp4`);
      const partOutputLimit = playlistPartOutputLimit(partBytes);
      const args = [
        "-y", "-ss", String(clip.start), "-t", String(duration),
        "-i", source.file,
      ];
      if (!source.hasAudio) {
        args.push(
          "-f", "lavfi", "-t", String(duration),
          "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
          "-map", "0:v:0", "-map", "1:a:0",
        );
      } else {
        args.push("-map", "0:v:0", "-map", "0:a:0");
      }
      args.push(
        "-vf",
        `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=30`,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-pix_fmt", "yuv420p", "-c:a", "aac", "-ar", "48000",
        "-ac", "2", "-shortest", "-fs", String(partOutputLimit),
        output,
      );
      await runMediaProcess("ffmpeg", args, {
        kind: "encode",
        signal: abort.signal,
        timeoutMs: Math.min(10 * 60_000, Math.max(60_000, duration * 10_000)),
      });
      const partInfo = await stat(output);
      if (!partInfo.isFile() || partInfo.size < 1) {
        throw new Error("播放列表片段编码结果无效");
      }
      partBytes += partInfo.size;
      if (partBytes > maxExportBytes) {
        throw new Error("播放列表片段累计超过 500MiB 限制");
      }
      parts.push(output);
    }
    const concatFile = join(directory, "concat.txt");
    await writeFile(
      concatFile,
      parts.map((file) => `file '${file.replaceAll("'", "'\\''")}'`).join("\n"),
    );
    const output = join(directory, "playlist.mp4");
    await runMediaProcess("ffmpeg", [
      "-y", "-f", "concat", "-safe", "0", "-i", concatFile,
      "-c", "copy", "-movflags", "+faststart",
      "-fs", String(maxExportBytes + 1), output,
    ], { kind: "encode", signal: abort.signal, timeoutMs: 10 * 60_000 });
    const info = await stat(output);
    if (!info.isFile() || info.size < 1 || info.size > maxExportBytes) {
      throw new Error("导出结果超过 500MiB 限制");
    }
    const outputMetadata = await probeTrustedMediaMetadata(output);
    assertPlaylistOutputDuration(
      outputMetadata.durationSeconds,
      totalDuration,
      clips.length,
    );
    // Drop intermediate parts and any OSS source spools before publication
    // copies the final output into media staging. This keeps the checked peak
    // within: OSS sources 1GiB + parts 500MiB + concat output 500MiB.
    const disposable = new Set<string>([concatFile, ...parts]);
    for (const source of sourceById.values()) {
      if (dirname(source.file) === directory) disposable.add(source.file);
    }
    await Promise.all(
      [...disposable].map((file) => rm(file, { force: true })),
    );

    if (mode === "asset") {
      const asset = await publishExport(request, output, { assetId, fileName });
      json(response, 201, asset);
      return;
    }
    response.statusCode = 200;
    response.setHeader("Cache-Control", "no-store");
    response.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    );
    response.setHeader("Content-Length", String(info.size));
    response.setHeader("Content-Type", "video/mp4");
    await pipeline(createReadStream(output), response, { signal: abort.signal });
  } catch (error) {
    if (error instanceof HttpRequestError) throw error;
    if (response.headersSent) {
      if (!response.destroyed) response.destroy();
      return;
    }
    if (error instanceof ResourceBudgetError) {
      response.setHeader("Retry-After", "5");
      json(response, error.statusCode, { code: error.code, error: error.message });
      return;
    }
    if (error instanceof MediaPublicationConflictError) {
      json(response, 409, {
        code: "MEDIA_ID_UNAVAILABLE",
        error: "Media id is unavailable",
      });
      return;
    }
    json(response, 400, {
      code: "PLAYLIST_EXPORT_FAILED",
      error: error instanceof Error ? error.message : "导出失败",
    });
  } finally {
    request.off("aborted", onRequestAbort);
    response.off("close", onResponseClose);
    releaseResources?.();
    if (directory) await rm(directory, { force: true, recursive: true });
  }
}
