import type { IncomingMessage, ServerResponse } from "node:http";
import { requestIdentity } from "./auth";
import { decodedRequestPath } from "./httpRequest";
import {
  mayReadMedia,
  readableMediaForOwner,
  type MediaKind,
} from "./mediaRegistry";

function json(response: ServerResponse, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader("Cache-Control", "private, no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

export function mediaMetadataApi(
  request: IncomingMessage,
  response: ServerResponse,
) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    json(response, 405, { error: "Method not allowed" });
    return;
  }
  const [kind, id, ...rest] = decodedRequestPath(request)
    .replace(/^\/+/, "")
    .split("/");
  if (
    rest.length ||
    (kind !== "image" && kind !== "video" && kind !== "audio") ||
    !/^[a-z0-9._-]{1,160}$/i.test(id ?? "")
  ) {
    json(response, 400, { error: "Invalid media metadata request" });
    return;
  }
  const identity = requestIdentity(request);
  if (!identity || !mayReadMedia(request, kind as MediaKind, id)) {
    json(response, 404, { error: "Asset not found" });
    return;
  }
  const media = readableMediaForOwner(
    identity.bypass ? "__test__" : identity.userId,
    kind as MediaKind,
    id,
  );
  if (!media || media.storageStatus !== "ready") {
    json(response, 404, { error: "Asset not found" });
    return;
  }
  json(response, 200, {
    assetId: id,
    byteSize: media.byteSize,
    contentType: media.contentType,
    durationSeconds: media.durationSeconds,
    durationStatus: media.durationStatus,
    kind,
    mediaHeight: media.mediaHeight,
    mediaWidth: media.mediaWidth,
    storageBackend: media.storageBackend,
  });
}
