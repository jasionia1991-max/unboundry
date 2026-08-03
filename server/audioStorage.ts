import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, rename, rm, stat, writeFile } from "node:fs/promises";
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
  activeStorageProfile,
  storageMediaRoutingState,
} from "./secureStorageProfiles";
import { probeTrustedMediaDuration } from "./mediaMetadata";

const maxAudioBytes = 50 * 1024 * 1024;

function audioPath(id: string) {
  const directory = join(
    process.env.TAPNOW_DATA_DIR ?? join(process.cwd(), "data"),
    "media",
  );
  return { directory, file: join(directory, id) };
}

function audioFormat(id: string) {
  const extension = id.split(".").at(-1)?.toLowerCase();
  if (extension === "wav") {
    return {
      contentType: "audio/wav",
      requestTypes: ["audio/wav", "audio/x-wav"],
      validate: validateWav,
    };
  }
  if (extension === "mp3") {
    return {
      contentType: "audio/mpeg",
      requestTypes: ["audio/mpeg", "audio/mp3"],
      validate: (bytes: Buffer) => {
        const id3 = bytes.toString("ascii", 0, 3) === "ID3";
        const frame = bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
        if (bytes.length < 4 || (!id3 && !frame)) {
          throw new Error("Invalid MP3 audio");
        }
      },
    };
  }
  if (extension === "m4a") {
    return {
      contentType: "audio/mp4",
      requestTypes: ["audio/mp4", "audio/x-m4a"],
      validate: (bytes: Buffer) => {
        if (
          bytes.length < 12 ||
          bytes.toString("ascii", 4, 8) !== "ftyp"
        ) {
          throw new Error("Invalid M4A audio");
        }
      },
    };
  }
  if (extension === "aac") {
    return {
      contentType: "audio/aac",
      requestTypes: ["audio/aac", "audio/x-aac"],
      validate: (bytes: Buffer) => {
        if (
          bytes.length < 7 ||
          bytes[0] !== 0xff ||
          (bytes[1] & 0xf6) !== 0xf0
        ) {
          throw new Error("Invalid AAC audio");
        }
      },
    };
  }
}

function json(response: ServerResponse, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

async function readAudio(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > maxAudioBytes) throw new Error("Audio is too large");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

function validateWav(bytes: Buffer) {
  if (
    bytes.length < 44 ||
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WAVE" ||
    bytes.readUInt32LE(4) + 8 > bytes.length
  ) {
    throw new Error("Invalid WAV audio");
  }

  let offset = 12;
  let format = false;
  let samples = false;
  while (offset + 8 <= bytes.length) {
    const type = bytes.toString("ascii", offset, offset + 4);
    const length = bytes.readUInt32LE(offset + 4);
    const end = offset + 8 + length;
    if (end > bytes.length) throw new Error("Invalid WAV audio");
    if (type === "fmt " && length >= 16) {
      const codec = bytes.readUInt16LE(offset + 8);
      const channels = bytes.readUInt16LE(offset + 10);
      const sampleRate = bytes.readUInt32LE(offset + 12);
      format =
        (codec === 1 || codec === 3) &&
        channels > 0 &&
        channels <= 8 &&
        sampleRate >= 8_000 &&
        sampleRate <= 384_000;
    }
    if (type === "data" && length > 0) samples = true;
    offset = end + (length % 2);
  }
  if (!format || !samples) throw new Error("Invalid WAV audio");
}

export async function saveGeneratedMp3(input: {
  body: ReadableStream<Uint8Array>;
  label: string;
  ownerId: string;
}) {
  const id = `${randomUUID()}.mp3`;
  const path = audioPath(id);
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
      if (size > maxAudioBytes) {
        await reader.cancel();
        throw new Error("Generated audio is too large");
      }
      if (header.length < 16) {
        header = Buffer.concat([header, bytes]).subarray(0, 16);
      }
      checksum.update(bytes);
      await handle.write(bytes);
    }
    await handle.close();
    handle = undefined;
    audioFormat(id)!.validate(header);
    const durationSeconds = await probeTrustedMediaDuration(temporary);
    const checksumSha256 = checksum.digest("hex");
    const routing = await storageMediaRoutingState();
    if (routing.enabled && routing.profile) {
      const objectKey = createAliyunOssObjectKey("audio", "mp3");
      await publishCloudObject({
        commit: () =>
          registerMediaForOwner(input.ownerId, {
            byteSize: size,
            checksumSha256,
            contentType: "audio/mpeg",
            durationSeconds,
            id,
            kind: "audio",
            objectKey,
            storageBackend: "oss",
            storageName: id,
          }),
        remove: () => deletePrivateAliyunOssObject(objectKey, routing.profile!),
        upload: () =>
          uploadPrivateAliyunOssObject({
            byteSize: size,
            checksumSha256,
            contentType: "audio/mpeg",
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
        contentType: "audio/mpeg",
        durationSeconds,
        id,
        kind: "audio",
        storageName: id,
      });
    }
    const store = openAppDatabase();
    try {
      store.prepare(`
        INSERT INTO asset_history (
          account_id, id, kind, label, preview, created_at, owner_id
        ) VALUES (?, ?, 'audio', ?, ?, ?, ?)
        ON CONFLICT(account_id, id) DO UPDATE SET
          label = excluded.label,
          preview = excluded.preview,
          owner_id = excluded.owner_id
      `).run(
        input.ownerId,
        id,
        input.label.slice(0, 120) || "生成音频",
        `/api/audio-assets/${id}`,
        new Date().toISOString(),
        input.ownerId,
      );
    } finally {
      store.close();
    }
    return {
      assetId: id,
      byteSize: size,
      contentType: "audio/mpeg",
      durationSeconds,
      storageBackend: routing.enabled && routing.profile ? "oss" as const : "local" as const,
      url: `/api/audio-assets/${id}`,
    };
  } catch (error) {
    await handle?.close();
    await rm(temporary, { force: true });
    await rm(path.file, { force: true });
    throw error;
  }
}

export async function audioStorage(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const id = decodeURIComponent((request.url ?? "").split("?")[0]).replace(
    /^\/+/,
    "",
  );
  if (!/^[a-z0-9._-]+$/i.test(id)) {
    json(response, 400, { error: "Invalid asset ID" });
    return;
  }

  const path = audioPath(id);
  const format = audioFormat(id);
  if (!format) {
    json(response, 400, { error: "Unsupported audio format" });
    return;
  }
  if (request.method === "GET") {
    if (!mayReadMedia(request, "audio", id)) {
      json(response, 404, { error: "Asset not found" });
      return;
    }
    const media = readableMedia(request, "audio", id);
    if (media?.storageBackend === "oss") {
      if (media.storageStatus !== "ready" || !media.objectKey) {
        json(response, 404, { error: "Asset not found" });
        return;
      }
      try {
        const profile = await activeStorageProfile();
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
        json(response, 503, { error: "Cloud audio is temporarily unavailable" });
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
      response.setHeader("Content-Type", format.contentType);
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
    if (!mayReadMedia(request, "audio", id)) {
      json(response, 404, { error: "Asset not found" });
      return;
    }
    const media = readableMedia(request, "audio", id);
    if (media?.storageBackend === "oss") {
      try {
        const profile = await activeStorageProfile();
        if (!profile || !media.objectKey) {
          throw new Error("Active OSS profile is unavailable");
        }
        await deletePrivateAliyunOssObject(media.objectKey, profile);
      } catch {
        json(response, 503, { error: "Cloud audio could not be deleted" });
        return;
      }
    } else {
      await rm(path.file, { force: true });
    }
    unregisterMedia(request, "audio", id);
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
  try {
    if (!mayWriteMedia(request, "audio", id)) {
      throw new Error("Asset ID is unavailable");
    }
    if (
      !format.requestTypes.includes(request.headers["content-type"] ?? "")
    ) {
      throw new Error("Audio type does not match its format");
    }
    const bytes = await readAudio(request);
    format.validate(bytes);
    await mkdir(path.directory, { recursive: true });
    await writeFile(temporary, bytes, { flag: "wx" });
    const durationSeconds = await probeTrustedMediaDuration(temporary);
    const checksumSha256 = createHash("sha256").update(bytes).digest("hex");
    const routing = await storageMediaRoutingState();
    if (routing.enabled && routing.profile) {
      const extension = id.split(".").at(-1)?.toLowerCase() ?? "bin";
      const objectKey = createAliyunOssObjectKey("audio", extension);
      await publishCloudObject({
        commit: () => registerMedia(request, {
          byteSize: bytes.length,
          checksumSha256,
          contentType: format.contentType,
          durationSeconds,
          id,
          kind: "audio",
          objectKey,
          storageBackend: "oss",
          storageName: id,
        }),
        remove: () => deletePrivateAliyunOssObject(objectKey, routing.profile!),
        upload: () => uploadPrivateAliyunOssObject({
          byteSize: bytes.length,
          checksumSha256,
          contentType: format.contentType,
          credentials: routing.profile!,
          filePath: temporary,
          objectKey,
        }).then(() => undefined),
      });
      await rm(temporary, { force: true });
    } else {
      await rename(temporary, path.file);
      registerMedia(request, {
        byteSize: bytes.length,
        checksumSha256,
        contentType: format.contentType,
        durationSeconds,
        id,
        kind: "audio",
        storageName: id,
      });
    }
    const rawName = String(request.headers["x-file-name"] ?? "Audio.wav");
    json(response, 201, {
      assetId: id,
      byteSize: bytes.length,
      contentType: format.contentType,
      durationSeconds,
      fileName: decodeURIComponent(rawName).slice(0, 240),
      size: bytes.length,
      storageBackend: routing.enabled && routing.profile ? "oss" : "local",
      url: `/api/audio-assets/${id}`,
    });
  } catch (error) {
    await rm(temporary, { force: true });
    json(response, 400, {
      error: error instanceof Error ? error.message : "Upload failed",
    });
  }
}
