import type { IncomingMessage, ServerResponse } from "node:http";

type LibraryAsset = {
  folderId: string;
  id: string;
  kind: "audio" | "image" | "video";
  label: string;
  spaceId: "personal" | "team";
  src: string;
};

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

const assets: LibraryAsset[] = [
  {
    folderId: "others",
    id: "library-image-forest",
    kind: "image",
    label: "森林光影",
    spaceId: "personal",
    src: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='800' viewBox='0 0 800 800'%3E%3Cdefs%3E%3ClinearGradient id='g' x2='1' y2='1'%3E%3Cstop stop-color='%232b4a42'/%3E%3Cstop offset='1' stop-color='%23b89b64'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='800' height='800' fill='url(%23g)'/%3E%3Ccircle cx='620' cy='160' r='92' fill='%23f4dfaa' opacity='.78'/%3E%3Cpath d='M0 650 180 360 310 650 470 270 700 650Z' fill='%231a302b' opacity='.82'/%3E%3C/svg%3E",
  },
  {
    folderId: "others",
    id: "library-video-sample",
    kind: "video",
    label: "海边镜头",
    spaceId: "personal",
    src: "/fixtures/video-success.mp4",
  },
  {
    folderId: "others",
    id: "library-audio-sample",
    kind: "audio",
    label: "环境音乐",
    spaceId: "personal",
    src: "/fixtures/audio-success.mp3",
  },
];

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

export function libraryCatalogApi(
  request: IncomingMessage,
  response: ServerResponse,
) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    json(response, 405, { error: "素材目录只支持读取" });
    return;
  }

  const url = new URL(request.url ?? "", "http://127.0.0.1");
  const spaceId = (url.searchParams.get("space") ?? "personal").trim();
  const folderId = (url.searchParams.get("folder") ?? "favorites").trim();
  const query = (url.searchParams.get("q") ?? "").trim().toLocaleLowerCase();
  const limit = boundedInteger(url.searchParams.get("limit"), 20, 100);
  const offset = boundedInteger(url.searchParams.get("offset"), 0, 100_000);

  if (!spaces.some((space) => space.id === spaceId)) {
    json(response, 400, { error: "素材空间无效" });
    return;
  }
  if (!folders.some((folder) => folder.id === folderId)) {
    json(response, 400, { error: "素材文件夹无效" });
    return;
  }
  if (limit === undefined || offset === undefined || limit === 0 || query.length > 120) {
    json(response, 400, { error: "素材分页或搜索参数无效" });
    return;
  }

  const visibleFolders = folders.filter(
    (folder) => !query || folder.label.toLocaleLowerCase().includes(query),
  );
  const matches = assets.filter(
    (asset) =>
      asset.spaceId === spaceId &&
      asset.folderId === folderId &&
      (!query || asset.label.toLocaleLowerCase().includes(query)),
  );
  const items = matches.slice(offset, offset + limit).map(
    ({ id, kind, label, src }) => ({ id, kind, label, src }),
  );

  json(response, 200, {
    spaces,
    folders: visibleFolders,
    items,
    pagination: {
      hasMore: offset + items.length < matches.length,
      limit,
      offset,
      total: matches.length,
    },
  });
}
