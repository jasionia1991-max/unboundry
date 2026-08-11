import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, rm, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import {
  beginMediaDeletion,
  finishMediaDeletion,
  markMediaDeletionFailed,
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
  cleanupPublicationStaging,
  compensateMediaPublication,
  finalizeMediaPublication,
  markExternalMediaPublicationReady,
  mediaPublicationStagingPath,
  MediaPublicationConflictError,
  publishLocalMediaPublication,
  reserveMediaPublication,
  stageMediaPublication,
  type GeneratedPublicationTask,
  type MediaPublicationExecution,
} from "./mediaLifecycle";

const maxVideoBytes = 500 * 1024 * 1024;

function videoPath(id: string) {
  const directory = join(
    process.env.UNBOUNDRY_DATA_DIR ?? join(process.cwd(), "data"),
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
  task?: GeneratedPublicationTask;
}) {
  const id = `${randomUUID()}.mp4`;
  const path = videoPath(id);
  const checksum = createHash("sha256");
  const publication = await withStorageMediaRoutingReservation((routing) => {
    const objectKey = routing.enabled && routing.profile
      ? createAliyunOssObjectKey("video", "mp4")
      : id;
    return {
      objectKey,
      reservation: reserveMediaPublication({
        contentType: "video/mp4",
        finalStorageName: id,
        historyLabel: input.label.slice(0, 120) || "生成视频",
        id,
        kind: "video",
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
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let size = 0;
  let header = Buffer.alloc(0);
  await mkdir(path.directory, { recursive: true });
  try {
    handle = await open(mediaPublicationStagingPath(reservation), "wx");
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
    const metadata = await probeTrustedMediaMetadata(
      mediaPublicationStagingPath(reservation),
    );
    const checksumSha256 = checksum.digest("hex");
    stageMediaPublication(reservation, {
      byteSize: size,
      checksumSha256,
      contentType: "video/mp4",
      durationSeconds: metadata.durationSeconds,
      mediaHeight: metadata.height,
      mediaWidth: metadata.width,
    });
    if (routing.enabled && routing.profile) {
      await uploadPrivateAliyunOssObject({
        byteSize: size,
        checksumSha256,
        contentType: "video/mp4",
        credentials: routing.profile,
        filePath: mediaPublicationStagingPath(reservation),
        objectKey,
      });
      markExternalMediaPublicationReady(reservation);
    } else {
      await publishLocalMediaPublication(reservation);
    }
    finalizeMediaPublication(reservation);
    await cleanupPublicationStaging(reservation).catch(() => undefined);
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
    await compensateMediaPublication(reservation, { profile: routing.profile });
    throw error;
  }
}

export function videoStorage(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void>;
export function videoStorage(
  request: IncomingMessage,
  response: ServerResponse,
  execution: MediaPublicationExecution,
): Promise<void>;
export async function videoStorage(
  request: IncomingMessage,
  response: ServerResponse,
  execution: MediaPublicationExecution = {},
) {
  const id = decodedRequestPath(request).replace(
    /^\/+/,
    "",
  );
  if (!/^[a-z0-9_-]+\.mp4$/i.test(id)) {
    json(response, 400, { error: "Invalid MP4 asset ID" });
    return;
  }

  const path = videoPath(id);
  if (request.method === "GET") {
    const media = readableMedia(request, "video", id);
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
        json(response, 503, { error: "Cloud video is temporarily unavailable" });
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
      response.setHeader("Content-Type", "video/mp4");
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
      deletion = beginMediaDeletion(request, "video", id);
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
      await execution.beforePhysicalDelete?.({ id, kind: "video", media });
    } catch {
      try {
        markMediaDeletionFailed(request, "video", id);
      } catch {
        // Preserve the injected physical-boundary failure.
      }
      json(response, 503, { error: "Video could not be deleted" });
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
        finishMediaDeletion(request, "video", id, media);
      } catch {
        try {
          markMediaDeletionFailed(request, "video", id);
        } catch {
          // The original physical-delete failure remains the response cause.
        }
        json(response, 503, { error: "Cloud video could not be deleted" });
        return;
      }
    } else {
      try {
        if (media.storageName !== id || media.storageName.includes("/")) {
          throw new Error("Invalid media path");
        }
        await rm(join(path.directory, media.storageName), { force: true });
        finishMediaDeletion(request, "video", id, media);
      } catch {
        try {
          markMediaDeletionFailed(request, "video", id);
        } catch {
          // The original physical-delete failure remains the response cause.
        }
        json(response, 503, { error: "Video could not be deleted" });
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
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  const checksum = createHash("sha256");
  try {
    const fileName = decodedRequestHeader(
      request,
      String(request.headers["x-file-name"] ?? "Video.mp4"),
    ).slice(0, 240);
    if (request.headers["content-type"] !== "video/mp4") {
      throw new Error("Only MP4 video is supported");
    }
    const identity = requestIdentity(request)!;
    const reserve = (routing: {
      enabled: boolean;
      profile?: AliyunStorageProfile;
    }) => {
      const objectKey = routing.enabled && routing.profile
        ? createAliyunOssObjectKey("video", "mp4")
        : id;
      return {
        objectKey,
        reservation: reserveMediaPublication({
          contentType: "video/mp4",
          finalStorageName: id,
          id,
          kind: "video",
          objectKey,
          ownerId: identity.bypass ? "__test__" : identity.userId,
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
    await mkdir(path.directory, { recursive: true });
    handle = await open(mediaPublicationStagingPath(reservation), "wx");
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
    const metadata = await probeTrustedMediaMetadata(
      mediaPublicationStagingPath(reservation),
    );
    const checksumSha256 = checksum.digest("hex");
    stageMediaPublication(reservation, {
      byteSize: size,
      checksumSha256,
      contentType: "video/mp4",
      durationSeconds: metadata.durationSeconds,
      mediaHeight: metadata.height,
      mediaWidth: metadata.width,
    });
    await execution.afterTransition?.("staged", reservation);
    if (routing.enabled && routing.profile) {
      await uploadPrivateAliyunOssObject({
        byteSize: size,
        checksumSha256,
        contentType: "video/mp4",
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
      byteSize: size,
      contentType: "video/mp4",
      fileName,
      durationSeconds: metadata.durationSeconds,
      mediaHeight: metadata.height,
      mediaWidth: metadata.width,
      size,
      storageBackend: routing.enabled && routing.profile ? "oss" : "local",
      url: `/api/video-assets/${id}`,
    });
  } catch (error) {
    await handle?.close();
    if (reservation) await compensateMediaPublication(reservation, { profile });
    if (error instanceof HttpRequestError) throw error;
    json(response, error instanceof MediaPublicationConflictError ? 409 : 400, {
      code: error instanceof MediaPublicationConflictError
        ? "MEDIA_ID_UNAVAILABLE"
        : undefined,
      error: error instanceof Error ? error.message : "Upload failed",
    });
  }
}
