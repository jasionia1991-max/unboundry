import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, rm, stat, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import {
  assertDeclaredBodyWithin,
  BoundedBodyError,
  consumeBoundedReadableStream,
  readBoundedBody,
  rejectUnreadRequestBody,
} from "./boundedBody";
import {
  readableMedia,
} from "./mediaRegistry";
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
  storageProfileForMedia,
  storageProfileForDestructiveMedia,
  withStorageMediaRoutingReservation,
  type AliyunStorageProfile,
} from "./secureStorageProfiles";
import { probeTrustedMediaMetadata } from "./mediaMetadata";
import {
  beginMediaDeletion,
  cleanupPublicationStaging,
  compensateMediaPublication,
  finalizeMediaPublication,
  finishMediaDeletion,
  markExternalMediaPublicationReady,
  markMediaDeletionFailed,
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
  reserveMediaResources,
  ResourceBudgetError,
} from "./resourceBudget";

const maxAudioBytes = 50 * 1024 * 1024;
const generatedAudioProbeBytes = 64 * 1024;

function audioPath(id: string) {
  const directory = join(
    process.env.UNBOUNDRY_DATA_DIR ?? join(process.cwd(), "data"),
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
  if (extension === "ogg") {
    return {
      contentType: "audio/ogg",
      requestTypes: ["audio/ogg", "application/ogg"],
      validate: (bytes: Buffer) => {
        if (
          bytes.length < 36 ||
          bytes.toString("ascii", 0, 4) !== "OggS" ||
          bytes[4] !== 0 ||
          bytes.indexOf(Buffer.from("OpusHead", "ascii")) < 0
        ) {
          throw new Error("Invalid OGG Opus audio");
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
  return readBoundedBody(request, {
    idleTimeoutMs: 15_000,
    maximumBytes: maxAudioBytes,
    totalTimeoutMs: 180_000,
  });
}

function validateWav(bytes: Buffer, totalSize = bytes.length) {
  if (
    bytes.length < 44 ||
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WAVE" ||
    bytes.readUInt32LE(4) + 8 > totalSize
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
    if (end > totalSize) throw new Error("Invalid WAV audio");
    if (type === "fmt " && length >= 16) {
      if (offset + 24 > bytes.length) throw new Error("Invalid WAV audio");
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
    if (end > bytes.length) break;
    offset = end + (length % 2);
  }
  if (!format || !samples) throw new Error("Invalid WAV audio");
}

export async function saveGeneratedAudio(input: {
  body: ReadableStream<Uint8Array>;
  contentType:
    | "audio/aac"
    | "audio/mp4"
    | "audio/mpeg"
    | "audio/ogg"
    | "audio/wav";
  label: string;
  ownerId: string;
  task?: GeneratedPublicationTask;
  /** Test seam for the external-object write; production uses private OSS. */
  uploadObject?: typeof uploadPrivateAliyunOssObject;
}) {
  const extension = input.contentType === "audio/wav"
    ? "wav"
    : input.contentType === "audio/mp4"
      ? "m4a"
      : input.contentType === "audio/aac"
        ? "aac"
        : input.contentType === "audio/ogg"
          ? "ogg"
          : "mp3";
  const id = `${randomUUID()}.${extension}`;
  const format = audioFormat(id)!;
  const path = audioPath(id);
  const checksum = createHash("sha256");
  let releaseResources: (() => void) | undefined;
  let publication: {
    objectKey: string;
    reservation: ReturnType<typeof reserveMediaPublication>;
    routing: { enabled: boolean; profile?: AliyunStorageProfile };
  };
  try {
    releaseResources = await reserveMediaResources({
      bytes: maxAudioBytes,
      directory: path.directory,
      ownerId: input.ownerId,
    });
    publication = await withStorageMediaRoutingReservation((routing) => {
      const objectKey = routing.enabled && routing.profile
        ? createAliyunOssObjectKey("audio", extension)
        : id;
      return {
        objectKey,
        reservation: reserveMediaPublication({
          contentType: format.contentType,
          finalStorageName: id,
          historyLabel: input.label.slice(0, 120) || "生成音频",
          id,
          kind: "audio",
          objectKey,
          ownerId: input.ownerId,
          storageBackend: routing.enabled && routing.profile ? "oss" : "local",
          storageProfileId: routing.profile?.id,
          task: input.task,
        }),
        routing,
      };
    });
  } catch (error) {
    await input.body.cancel().catch(() => undefined);
    releaseResources?.();
    throw error;
  }
  const { objectKey, reservation, routing } = publication;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let size = 0;
  let header = Buffer.alloc(0);
  let bodyConsumptionStarted = false;
  let staged = false;
  try {
    await mkdir(path.directory, { recursive: true });
    handle = await open(mediaPublicationStagingPath(reservation), "wx");
    const output = handle;
    bodyConsumptionStarted = true;
    size = await consumeBoundedReadableStream(
      input.body,
      maxAudioBytes,
      async (bytes) => {
      if (header.length < generatedAudioProbeBytes) {
        const remainingProbeBytes = generatedAudioProbeBytes - header.length;
        header = Buffer.concat([header, bytes.subarray(0, remainingProbeBytes)]);
      }
      checksum.update(bytes);
      await output.writeFile(bytes);
      },
    );
    await handle.close();
    handle = undefined;
    if (input.contentType === "audio/wav") {
      validateWav(header, size);
    } else {
      format.validate(header);
    }
    const metadata = await probeTrustedMediaMetadata(
      mediaPublicationStagingPath(reservation),
    );
    const checksumSha256 = checksum.digest("hex");
    stageMediaPublication(reservation, {
      byteSize: size,
      checksumSha256,
      contentType: format.contentType,
      durationSeconds: metadata.durationSeconds,
    });
    staged = true;
    if (routing.enabled && routing.profile) {
      await (input.uploadObject ?? uploadPrivateAliyunOssObject)({
        byteSize: size,
        checksumSha256,
        contentType: format.contentType,
        credentials: routing.profile,
        filePath: mediaPublicationStagingPath(reservation),
        objectKey,
      });
      markExternalMediaPublicationReady(reservation);
    } else {
      await publishLocalMediaPublication(reservation);
    }
    const saved = {
      assetId: id,
      byteSize: size,
      contentType: format.contentType,
      durationSeconds: metadata.durationSeconds,
      storageBackend: routing.enabled && routing.profile ? "oss" as const : "local" as const,
      url: `/api/audio-assets/${id}`,
    };
    if (input.task) return { ...saved, publicationToken: reservation };
    finalizeMediaPublication(reservation);
    await cleanupPublicationStaging(reservation).catch(() => undefined);
    return saved;
  } catch (error) {
    if (!bodyConsumptionStarted) {
      await input.body.cancel().catch(() => undefined);
    }
    await handle?.close().catch(() => undefined);
    if (input.task && staged) {
      throw new MediaPublicationDeferredError();
    }
    await compensateMediaPublication(reservation, { profile: routing.profile });
    throw error;
  } finally {
    releaseResources?.();
  }
}

export function saveGeneratedMp3(input: {
  body: ReadableStream<Uint8Array>;
  label: string;
  ownerId: string;
  task?: GeneratedPublicationTask;
}) {
  return saveGeneratedAudio({ ...input, contentType: "audio/mpeg" });
}

export function audioStorage(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void>;
export function audioStorage(
  request: IncomingMessage,
  response: ServerResponse,
  execution: MediaPublicationExecution,
): Promise<void>;
export async function audioStorage(
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

  const path = audioPath(id);
  const format = audioFormat(id);
  if (!format) {
    if (request.method === "POST") rejectUnreadRequestBody(request, response);
    json(response, 400, { error: "Unsupported audio format" });
    return;
  }
  if (request.method === "GET") {
    const media = readableMedia(request, "audio", id);
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
        json(response, 503, { error: "Cloud audio is temporarily unavailable" });
      }
      return;
    }
    try {
      if (media.storageName !== id || media.storageName.includes("/")) {
        throw new Error("Invalid media path");
      }
      const file = join(path.directory, media.storageName);
      const info = await stat(file);
      if (info.size !== media.byteSize) throw new Error("Asset is incomplete");
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
      createReadStream(file, { end, start }).pipe(response);
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
        "audio",
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
      await execution.beforePhysicalDelete?.({ id, kind: "audio", media });
    } catch {
      try {
        markMediaDeletionFailed(request, "audio", id);
      } catch {
        // Preserve the injected physical-boundary failure.
      }
      json(response, 503, { error: "Audio could not be deleted" });
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
        finishMediaDeletion(request, "audio", id, media);
      } catch {
        try {
          markMediaDeletionFailed(request, "audio", id);
        } catch {
          // The original physical-delete failure remains the response cause.
        }
        json(response, 503, { error: "Cloud audio could not be deleted" });
        return;
      }
    } else {
      try {
        if (media.storageName !== id || media.storageName.includes("/")) {
          throw new Error("Invalid media path");
        }
        await rm(join(path.directory, media.storageName), { force: true });
        finishMediaDeletion(request, "audio", id, media);
      } catch {
        try {
          markMediaDeletionFailed(request, "audio", id);
        } catch {
          // The original physical-delete failure remains the response cause.
        }
        json(response, 503, { error: "Audio could not be deleted" });
        return;
      }
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
      String(request.headers["x-file-name"] ?? "Audio.wav"),
    ).slice(0, 240);
    if (
      !format.requestTypes.includes(request.headers["content-type"] ?? "")
    ) {
      throw new Error("Audio type does not match its format");
    }
    assertDeclaredBodyWithin(request, maxAudioBytes);
    const extension = id.split(".").at(-1)?.toLowerCase() ?? "bin";
    const identity = requestIdentity(request)!;
    const ownerId = identity.bypass ? "__test__" : identity.userId;
    releaseResources = await reserveMediaResources({
      bytes: maxAudioBytes,
      directory: path.directory,
      ownerId,
    });
    const reserve = (routing: {
      enabled: boolean;
      profile?: AliyunStorageProfile;
    }) => {
      const objectKey = routing.enabled && routing.profile
        ? createAliyunOssObjectKey("audio", extension)
        : id;
      return {
        objectKey,
        reservation: reserveMediaPublication({
          contentType: format.contentType,
          finalStorageName: id,
          id,
          kind: "audio",
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
    const bytes = await readAudio(request);
    format.validate(bytes);
    await mkdir(path.directory, { recursive: true });
    await writeFile(mediaPublicationStagingPath(reservation), bytes, { flag: "wx" });
    const metadata = await probeTrustedMediaMetadata(
      mediaPublicationStagingPath(reservation),
    );
    const checksumSha256 = createHash("sha256").update(bytes).digest("hex");
    stageMediaPublication(reservation, {
      byteSize: bytes.length,
      checksumSha256,
      contentType: format.contentType,
      durationSeconds: metadata.durationSeconds,
    });
    await execution.afterTransition?.("staged", reservation);
    if (routing.enabled && routing.profile) {
      await uploadPrivateAliyunOssObject({
        byteSize: bytes.length,
        checksumSha256,
        contentType: format.contentType,
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
      contentType: format.contentType,
      durationSeconds: metadata.durationSeconds,
      fileName,
      size: bytes.length,
      storageBackend: routing.enabled && routing.profile ? "oss" : "local",
      url: `/api/audio-assets/${id}`,
    });
  } catch (error) {
    if (request.method === "POST") rejectUnreadRequestBody(request, response);
    if (reservation) await compensateMediaPublication(reservation, { profile });
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
