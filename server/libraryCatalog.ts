import type { IncomingMessage, ServerResponse } from "node:http";
import { requestIdentity } from "./auth";
import { readBoundedBody, rejectUnreadRequestBody } from "./boundedBody";
import { decodedRequestPath } from "./httpRequest";
import type { MediaLibraryReferenceLease } from "./mediaLibraryReferencePort";
import {
  assertLibraryMediaDeletionAllowed,
  beginLibraryEntrySave,
  listLibraryEntries,
  removeLibraryEntry,
  removeOwnerLibraryEntries,
  type LibraryKind,
} from "./library/internal/libraryStore";

const spaces = [
  { id: "personal", label: "个人", readOnly: false },
  { id: "team", label: "团队", readOnly: true },
] as const;

const folders = [
  { id: "favorites", label: "收藏", kind: "system" },
  { id: "subjects", label: "主体库", kind: "system" },
  { id: "characters", label: "角色", kind: "folder" },
  { id: "scenes", label: "场景", kind: "folder" },
  { id: "props", label: "道具", kind: "folder" },
  { id: "styles", label: "风格", kind: "folder" },
  { id: "sound-effects", label: "音效", kind: "folder" },
  { id: "others", label: "Others", kind: "folder" },
] as const;

type LibraryApiExecution = Readonly<{
  beginMediaReference: (input: Readonly<{
    assetId: string;
    kind: LibraryKind;
    ownerId: string;
  }>) => MediaLibraryReferenceLease;
}>;

function boundedInteger(value: string | null, fallback: number, maximum: number) {
  if (value === null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= maximum
    ? parsed
    : undefined;
}

function json(response: ServerResponse, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function assetSource(kind: LibraryKind, assetId: string) {
  const base = kind === "image"
    ? "/api/assets"
    : kind === "audio"
      ? "/api/audio-assets"
      : "/api/video-assets";
  return `${base}/${encodeURIComponent(assetId)}`;
}

function validKind(value: unknown): value is LibraryKind {
  return value === "audio" || value === "image" || value === "video";
}

export function deleteAccountLibraryEntries(ownerId: string) {
  return removeOwnerLibraryEntries(ownerId);
}

export function assertLibraryDeletionAllowed(
  _database: unknown,
  input: Readonly<{ assetId: string; kind: LibraryKind; ownerId: string }>,
) {
  assertLibraryMediaDeletionAllowed(input);
}

export async function libraryCatalogApi(
  request: IncomingMessage,
  response: ServerResponse,
  execution: LibraryApiExecution,
) {
  const identity = requestIdentity(request);
  if (!identity) {
    if (request.method !== "GET") rejectUnreadRequestBody(request, response);
    json(response, 401, { error: "请先登录" });
    return;
  }
  const ownerId = identity.bypass ? "__test__" : identity.userId;
  const path = decodedRequestPath(request).replace(/^\/+/, "");

  if (request.method === "GET" && !path) {
    const url = new URL(request.url ?? "", "http://127.0.0.1");
    const spaceId = (url.searchParams.get("space") ?? "personal").trim();
    const folderId = (url.searchParams.get("folder") ?? "favorites").trim();
    const query = (url.searchParams.get("q") ?? "").trim();
    const limit = boundedInteger(url.searchParams.get("limit"), 20, 100);
    const offset = boundedInteger(url.searchParams.get("offset"), 0, 100_000);
    if (!spaces.some((space) => space.id === spaceId) ||
        !folders.some((folder) => folder.id === folderId) ||
        limit === undefined || offset === undefined || limit === 0 ||
        query.length > 120) {
      json(response, 400, { error: "素材空间、文件夹或分页参数无效" });
      return;
    }
    const visibleFolders = folders.filter(
      (folder) => !query || folder.label.toLocaleLowerCase().includes(
        query.toLocaleLowerCase(),
      ),
    );
    const page = spaceId === "team"
      ? { items: [], total: 0 }
      : listLibraryEntries({ folderId, limit, offset, ownerId, query });
    json(response, 200, {
      spaces,
      folders: visibleFolders,
      items: page.items.map((entry) => ({
        id: entry.assetId,
        kind: entry.kind,
        label: entry.label,
        revision: entry.revision,
        src: assetSource(entry.kind, entry.assetId),
      })),
      pagination: {
        hasMore: offset + page.items.length < page.total,
        limit,
        offset,
        total: page.total,
      },
    });
    return;
  }

  if (request.method === "POST" && !path) {
    let mediaLease: MediaLibraryReferenceLease | undefined;
    let libraryLease: ReturnType<typeof beginLibraryEntrySave> | undefined;
    try {
      const body = JSON.parse((await readBoundedBody(request, {
        idleTimeoutMs: 5_000,
        maximumBytes: 16 * 1_024,
        totalTimeoutMs: 10_000,
      })).toString("utf8")) as Record<string, unknown>;
      const assetId = typeof body.assetId === "string" ? body.assetId.trim() : "";
      const kind = body.kind;
      const label = typeof body.label === "string" ? body.label.trim() : "";
      const folderId = typeof body.folderId === "string"
        ? body.folderId.trim()
        : "others";
      if (!/^[a-z0-9._-]{1,160}$/i.test(assetId) || !validKind(kind) ||
          label.length < 1 || label.length > 120 ||
          !folders.some((folder) => folder.id === folderId)) {
        json(response, 400, { error: "素材信息无效" });
        return;
      }
      mediaLease = execution.beginMediaReference({ assetId, kind, ownerId });
      libraryLease = beginLibraryEntrySave({
        assetId,
        folderId,
        kind,
        label,
        ownerId,
        timestamp: new Date().toISOString(),
      });
      mediaLease.commit();
      libraryLease.commit();
      json(response, 200, {
        item: {
          id: libraryLease.entry.assetId,
          kind: libraryLease.entry.kind,
          label: libraryLease.entry.label,
          revision: libraryLease.entry.revision,
          src: assetSource(libraryLease.entry.kind, libraryLease.entry.assetId),
        },
      });
    } catch (error) {
      libraryLease?.rollback();
      mediaLease?.rollback();
      json(response, 409, {
        error: error instanceof Error ? error.message : "素材保存失败",
      });
    }
    return;
  }

  const deleteMatch = path.match(/^(image|audio|video)\/([a-z0-9._-]{1,160})$/i);
  if (request.method === "DELETE" && deleteMatch) {
    const removed = removeLibraryEntry({
      assetId: deleteMatch[2],
      kind: deleteMatch[1].toLowerCase() as LibraryKind,
      ownerId,
    });
    if (!removed) {
      json(response, 404, { error: "素材条目不存在" });
      return;
    }
    response.statusCode = 204;
    response.end();
    return;
  }

  response.setHeader("Allow", "GET, POST, DELETE");
  json(response, 405, { error: "素材目录请求方法无效" });
}
