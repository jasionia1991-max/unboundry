import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import {
  mayReadMedia,
  mayWriteMedia,
  readableMedia,
  registerMedia,
  registerMediaForOwner,
  unregisterMedia,
} from "./mediaRegistry";
import {
  createAliyunOssObjectKey,
  createPrivateAliyunOssReadUrl,
  deletePrivateAliyunOssObject,
  uploadPrivateAliyunOssObject,
} from "./aliyunOss";
import { publishCloudObject } from "./cloudMediaStorage";
import { openAppDatabase } from "./database";
import {
  storageMediaRoutingState,
  storageProfileForMedia,
} from "./secureStorageProfiles";
import { probeTrustedMediaMetadata } from "./mediaMetadata";

const maxVideoBytes = 500 * 1024 * 1024;

function videoPath(id: string) {
  const directory = join(
    process.env.TAPNOW_DATA_DIR ?? join(process.cwd(), "data"),
    "media",
  );
  return { directory, file: join(directory, id) };
}

function json(response: ServerResponse, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

export async function saveGeneratedMp4(input: {
  body: ReadableStream<Uint8Array>;
  label: string;
  ownerId: string;
}) {
  const id = `${randomUUID()}.mp4`;
  const path = videoPath(id);
  const temporary = `${path.file}.${randomUUID()}.generating`;
  const checksum = createHash("sha256");
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let size = 0;
  let header = Buffer.alloc(0);
  await mkdir(path.directory, { recursive: true });
  try {
    handle = await open(temporary, "wx");
    const reader = input.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const bytes = Buffer.from(value);
      size += bytes.length;
      if (size > maxVideoBytes) {
        await reader.cancel();
        throw new Error("Generated video is too large");
      }
      if (header.length < 32) {
        header = Buffer.concat([header, bytes]).subarray(0, 32);
      }
      checksum.update(bytes);
      await handle.write(bytes);
    }
    await handle.close();
    handle = undefined;
    if (size < 12 || header.toString("ascii", 4, 8) !== "ftyp") {
      throw new Error("Invalid generated MP4 video");
    }
    const metadata = await probeTrustedMediaMetadata(temporary);
    const checksumSha256 = checksum.digest("hex");
    const routing = await storageMediaRoutingState();
    if (routing.enabled && routing.profile) {
      const objectKey = createAliyunOssObjectKey("video", "mp4");
      await publishCloudObject({
        commit: () =>
          registerMediaForOwner(input.ownerId, {
            byteSize: size,
            checksumSha256,
            contentType: "video/mp4",
            durationSeconds: metadata.durationSeconds,
            id,
            kind: "video",
            mediaHeight: metadata.height,
            mediaWidth: metadata.width,
            objectKey,
            storageBackend: "oss",
            storageProfileId: routing.profile?.id,
            storageName: id,
          }),
        remove: () => deletePrivateAliyunOssObject(objectKey, routing.profile!),
        upload: () =>
          uploadPrivateAliyunOssObject({
            byteSize: size,
            checksumSha256,
            contentType: "video/mp4",
            credentials: routing.profile!,
            filePath: temporary,
            objectKey,
          }).then(() => undefined),
      });
      await rm(temporary, { force: true });
    } else {
      await rename(temporary, path.file);
      registerMediaForOwner(input.ownerId, {
        byteSize: size,
        checksumSha256,
        contentType: "video/mp4",
        durationSeconds: metadata.durationSeconds,
        id,
        kind: "video",
        mediaHeight: metadata.height,
        mediaWidth: metadata.width,
        storageName: id,
      });
    }
    const store = openAppDatabase();
    try {
      store.prepare(`
        INSERT INTO asset_history (
          account_id, id, kind, label, preview, created_at, owner_id
        ) VALUES (?, ?, 'video', ?, ?, ?, ?)
        ON CONFLICT(account_id, id) DO UPDATE SET
          label = excluded.label,
          preview = excluded.preview,
          owner_id = excluded.owner_id
      `).run(
        input.ownerId,
        id,
        input.label.slice(0, 120) || "生成视频",
        `/api/video-assets/${id}`,
        new Date().toISOString(),
        input.ownerId,
      );
    } finally {
      store.close();
    }
    return {
      assetId: id,
      byteSize: size,
      contentType: "video/mp4",
      durationSeconds: metadata.durationSeconds,
      storageBackend: routing.enabled && routing.profile ? "oss" as const : "local" as const,
      url: `/api/video-assets/${id}`,
    };
  } catch (error) {
    await handle?.close();
    await rm(temporary, { force: true });
    await rm(path.file, { force: true });
    throw error;
  }
}

export async function videoStorage(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const id = decodeURIComponent((request.url ?? "").split("?")[0]).replace(
    /^\/+/,
    "",
  );
  if (!/^[a-z0-9_-]+\.mp4$/i.test(id)) {
    json(response, 400, { error: "Invalid MP4 asset ID" });
    return;
  }

  const path = videoPath(id);
  if (request.method === "GET") {
    if (!mayReadMedia(request, "video", id)) {
      json(response, 404, { error: "Asset not found" });
      return;
    }
    const media = readableMedia(request, "video", id);
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
        json(response, 503, { error: "Cloud video is temporarily unavailable" });
      }
      return;
    }
    try {
      const info = await stat(path.file);
      const match = /^bytes=(\d+)-(\d*)$/.exec(
        String(request.headers.range ?? ""),
      );
      const start = match ? Number(match[1]) : 0;
      const end = match?.[2]
        ? Math.min(Number(match[2]), info.size - 1)
        : info.size - 1;
      if (start >= info.size || end < start) {
        response.statusCode = 416;
        response.setHeader("Content-Range", `bytes */${info.size}`);
        response.end();
        return;
      }
      response.statusCode = match ? 206 : 200;
      response.setHeader("Accept-Ranges", "bytes");
      response.setHeader("Cache-Control", "private, max-age=31536000, immutable");
      response.setHeader("Content-Length", String(end - start + 1));
      response.setHeader("Content-Type", "video/mp4");
      if (match) {
        response.setHeader(
          "Content-Range",
          `bytes ${start}-${end}/${info.size}`,
        );
      }
      createReadStream(path.file, { end, start }).pipe(response);
    } catch {
      json(response, 404, { error: "Asset not found" });
    }
    return;
  }

  if (request.method === "DELETE") {
    if (!mayReadMedia(request, "video", id)) {
      json(response, 404, { error: "Asset not found" });
      return;
    }
    const media = readableMedia(request, "video", id);
    if (media?.storageBackend === "oss") {
      try {
        const profile = await storageProfileForMedia(media);
        if (!profile) throw new Error("Active OSS profile is unavailable");
        await deletePrivateAliyunOssObject(media.objectKey, profile);
      } catch {
        json(response, 503, { error: "Cloud video could not be deleted" });
        return;
      }
    } else {
      await rm(path.file, { force: true });
    }
    unregisterMedia(request, "video", id);
    response.statusCode = 204;
    response.end();
    return;
  }

  if (request.method !== "POST") {
    response.setHeader("Allow", "GET, POST, DELETE");
    json(response, 405, { error: "Method not allowed" });
    return;
  }

  const temporary = `${path.file}.uploading`;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  const checksum = createHash("sha256");
  try {
    if (!mayWriteMedia(request, "video", id)) {
      throw new Error("Asset ID is unavailable");
    }
    if (request.headers["content-type"] !== "video/mp4") {
      throw new Error("Only MP4 video is supported");
    }
    await mkdir(path.directory, { recursive: true });
    handle = await open(temporary, "wx");
    let size = 0;
    let header = Buffer.alloc(0);
    for await (const chunk of request) {
      const bytes = Buffer.from(chunk);
      size += bytes.length;
      if (size > maxVideoBytes) throw new Error("Video is too large");
      if (header.length < 32) {
        header = Buffer.concat([header, bytes]).subarray(0, 32);
      }
      checksum.update(bytes);
      await handle.write(bytes);
    }
    await handle.close();
    handle = undefined;
    if (
      size < 12 ||
      header.toString("ascii", 4, 8) !== "ftyp"
    ) {
      throw new Error("Invalid MP4 video");
    }
    const metadata = await probeTrustedMediaMetadata(temporary);
    const checksumSha256 = checksum.digest("hex");
    const routing = await storageMediaRoutingState();
    if (routing.enabled && routing.profile) {
      const objectKey = createAliyunOssObjectKey("video", "mp4");
      await publishCloudObject({
        commit: () => registerMedia(request, {
          byteSize: size,
          checksumSha256,
          contentType: "video/mp4",
          durationSeconds: metadata.durationSeconds,
          id,
          kind: "video",
          mediaHeight: metadata.height,
          mediaWidth: metadata.width,
          objectKey,
          storageBackend: "oss",
          storageProfileId: routing.profile?.id,
          storageName: id,
        }),
        remove: () => deletePrivateAliyunOssObject(objectKey, routing.profile!),
        upload: () => uploadPrivateAliyunOssObject({
          byteSize: size,
          checksumSha256,
          contentType: "video/mp4",
          credentials: routing.profile!,
          filePath: temporary,
          objectKey,
        }).then(() => undefined),
      });
      await rm(temporary, { force: true });
    } else {
      await rename(temporary, path.file);
      registerMedia(request, {
        byteSize: size,
        checksumSha256,
        contentType: "video/mp4",
        durationSeconds: metadata.durationSeconds,
        id,
        kind: "video",
        mediaHeight: metadata.height,
        mediaWidth: metadata.width,
        storageName: id,
      });
    }
    const rawName = String(request.headers["x-file-name"] ?? "Video.mp4");
    json(response, 201, {
      assetId: id,
      byteSize: size,
      contentType: "video/mp4",
      fileName: decodeURIComponent(rawName).slice(0, 240),
      durationSeconds: metadata.durationSeconds,
      size,
      storageBackend: routing.enabled && routing.profile ? "oss" : "local",
      url: `/api/video-assets/${id}`,
    });
  } catch (error) {
    await handle?.close();
    await rm(temporary, { force: true });
    json(response, 400, {
      error: error instanceof Error ? error.message : "Upload failed",
    });
  }
}
