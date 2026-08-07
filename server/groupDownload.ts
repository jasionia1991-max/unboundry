import { ZipArchive } from "archiver";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { requestIdentity } from "./auth";
import { createPrivateAliyunOssReadUrl } from "./aliyunOss";
import { appDataDirectory, openAppDatabase } from "./database";
import { storageProfileForMedia } from "./secureStorageProfiles";

const canvasIdPattern = /^[a-z0-9._-]+$/i;
const nodeIdPattern = /^[a-z0-9._:-]{1,200}$/i;
const MAX_DOWNLOAD_BYTES = 500 * 1024 * 1024;
const MAX_DOWNLOAD_FILES = 200;

export type DownloadPlanInput = {
  byteSize: number;
  kind: "audio" | "image" | "text" | "video";
  media?: {
    assetId: string;
    backend: "local" | "oss";
    objectKey?: string;
    storageProfileId?: string | null;
    storageName?: string;
  };
  nodeTitle: string;
  resultText?: string;
  storageExtension?: string;
  taskId: string;
};

export type DownloadPlanEntry = {
  byteSize: number;
  extension: string;
  kind: "media" | "text";
  media?: DownloadPlanInput["media"];
  name: string;
  resultText?: string;
  taskId: string;
};

export type DownloadPlan = {
  entries: DownloadPlanEntry[];
  totalBytes: number;
};

/** 清洗后的 ZIP 条目基础名：去除路径/控制字符，保留中文，最多 80 字符。 */
export function sanitizeDownloadBaseName(title: string) {
  const cleaned = title
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || "节点").slice(0, 80);
}

/** “节点标题-序号.扩展名”命名；序号全局递增，天然去重。 */
export function downloadEntryName(base: string, index: number, extension: string) {
  return `${base}-${index}.${extension}`;
}

export function planGroupDownload(
  inputs: DownloadPlanInput[],
  options?: { maxBytes?: number; maxFiles?: number },
): DownloadPlan {
  const maxBytes = options?.maxBytes ?? MAX_DOWNLOAD_BYTES;
  const maxFiles = options?.maxFiles ?? MAX_DOWNLOAD_FILES;
  if (inputs.length > maxFiles) {
    throw new Error(`下载文件数超过上限（${maxFiles} 个）`);
  }
  const entries = inputs.map((input, index) => {
    const base = sanitizeDownloadBaseName(input.nodeTitle);
    if (input.kind === "text") {
      const text = input.resultText ?? "";
      return {
        byteSize: Buffer.byteLength(text, "utf8"),
        extension: "txt",
        kind: "text" as const,
        name: downloadEntryName(base, index + 1, "txt"),
        resultText: text,
        taskId: input.taskId,
      };
    }
    const extension =
      input.storageExtension && /^[a-z0-9]{1,8}$/i.test(input.storageExtension)
        ? input.storageExtension.toLocaleLowerCase()
        : input.kind === "image"
          ? "png"
          : input.kind === "video"
            ? "mp4"
            : "mp3";
    return {
      byteSize: input.byteSize,
      extension,
      kind: "media" as const,
      media: input.media,
      name: downloadEntryName(base, index + 1, extension),
      taskId: input.taskId,
    };
  });
  const totalBytes = entries.reduce(
    (sum, entry) => sum + Math.max(0, entry.byteSize),
    0,
  );
  if (totalBytes > maxBytes) {
    throw new Error("下载总大小超过上限（500MB）");
  }
  return { entries, totalBytes };
}

let database: DatabaseSync | undefined;
let databaseDirectory = "";

function db() {
  const directory = appDataDirectory();
  if (database && databaseDirectory === directory) return database;
  database?.close();
  database = openAppDatabase();
  databaseDirectory = directory;
  return database;
}

function json(response: ServerResponse, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function readBody<T>(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > 64 * 1_024) throw new Error("Payload too large");
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

async function localMediaPath(
  ownerId: string,
  kind: string,
  assetId: string,
) {
  const row = db()
    .prepare(`
      SELECT storage_name, byte_size, storage_status
      FROM media_assets
      WHERE kind = ? AND id = ? AND owner_id = ?
    `)
    .get(kind, assetId, ownerId) as
    | {
        byte_size: number;
        storage_name: string;
        storage_status: string;
      }
    | undefined;
  if (!row || row.storage_status !== "ready") return undefined;
  if (basename(row.storage_name) !== row.storage_name) return undefined;
  return {
    byteSize: Number(row.byte_size),
    file: join(appDataDirectory(), "media", row.storage_name),
  };
}

async function spoolOssEntry(
  entry: DownloadPlanEntry,
): Promise<{ file: string; tempDirectory: string } | undefined> {
  const media = entry.media;
  if (!media?.objectKey) return undefined;
  const profile = await storageProfileForMedia(media);
  if (!profile) return undefined;
  let location: string;
  try {
    location = await createPrivateAliyunOssReadUrl(media.objectKey, profile, 600);
  } catch {
    return undefined;
  }
  let response: Response;
  try {
    response = await fetch(location, { redirect: "error" });
  } catch {
    return undefined;
  }
  if (!response.ok || !response.body) return undefined;
  const tempDirectory = await mkdtemp(
    join(tmpdir(), "tapnow-group-download-"),
  );
  const file = join(tempDirectory, entry.name);
  const writer = createWriteStream(file);
  const reader = response.body.getReader();
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > entry.byteSize) {
        writer.destroy();
        await rm(tempDirectory, { force: true, recursive: true });
        return undefined;
      }
      if (!writer.write(Buffer.from(value))) {
        await new Promise<void>((resolve) => writer.once("drain", resolve));
      }
    }
    writer.end();
    await new Promise<void>((resolve, reject) => {
      writer.once("finish", resolve);
      writer.once("error", reject);
    });
    const info = await stat(file);
    if (info.size !== entry.byteSize) {
      await rm(tempDirectory, { force: true, recursive: true });
      return undefined;
    }
    return { file, tempDirectory };
  } catch {
    writer.destroy();
    await rm(tempDirectory, { force: true, recursive: true }).catch(() => undefined);
    return undefined;
  }
}

export async function groupDownloadApi(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const identity = requestIdentity(request);
  if (!identity) {
    json(response, 401, { error: "请先登录" });
    return;
  }
  const url = new URL(request.url ?? "", "http://127.0.0.1");
  const path = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  // Vite/Connect 的 mount 中间件会把 /api/canvas 前缀从 request.url 中剥掉，
  // 因此这里收到的是 “<canvasId>/group-download”。
  const match = path.match(/^([^/]+)\/group-download$/i);
  if (!match || !canvasIdPattern.test(match[1])) {
    json(response, 404, { error: "下载接口不存在" });
    return;
  }
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    json(response, 405, { error: "批量下载只支持 POST" });
    return;
  }

  const canvasId = match[1];
  const ownerId = identity.bypass ? "__test__" : identity.userId;
  const store = db();
  const canvas = (
    identity.bypass
      ? store
          .prepare("SELECT nodes FROM canvas_documents WHERE id = ? ORDER BY owner_id IS NULL DESC LIMIT 1")
          .get(canvasId)
      : store
          .prepare("SELECT nodes FROM canvas_documents WHERE owner_id = ? AND id = ?")
          .get(ownerId, canvasId)
  ) as { nodes: string } | undefined;
  if (!canvas) {
    json(response, 404, { error: "画布不存在" });
    return;
  }

  let body: { groupId?: unknown; nodeIds?: unknown };
  try {
    body = await readBody<{ groupId?: unknown; nodeIds?: unknown }>(request);
  } catch {
    json(response, 400, { error: "下载请求无效" });
    return;
  }

  let nodes: Array<Record<string, unknown>> = [];
  try {
    const parsed = JSON.parse(canvas.nodes) as unknown;
    if (Array.isArray(parsed)) nodes = parsed.filter(isRecord);
  } catch {
    json(response, 400, { error: "画布数据异常" });
    return;
  }

  let nodeIds: string[] = [];
  if (typeof body.groupId === "string" && body.groupId) {
    const group = nodes.find(
      (node) => node.id === body.groupId && node.type === "group",
    );
    if (!group) {
      json(response, 404, { error: "组不存在" });
      return;
    }
    nodeIds = nodes
      .filter(
        (node) =>
          node.parentId === body.groupId &&
          typeof node.id === "string" &&
          nodeIdPattern.test(node.id),
      )
      .map((node) => node.id as string);
    if (nodeIds.length === 0) {
      json(response, 400, { error: "该组没有可下载的子节点" });
      return;
    }
  } else if (Array.isArray(body.nodeIds)) {
    nodeIds = body.nodeIds.filter(
      (value): value is string =>
        typeof value === "string" && nodeIdPattern.test(value),
    );
    if (nodeIds.length === 0 || nodeIds.length > 500) {
      json(response, 400, { error: "下载节点列表无效" });
      return;
    }
  } else {
    json(response, 400, { error: "缺少 groupId 或 nodeIds" });
    return;
  }

  const titleByNode = new Map<string, string>();
  for (const node of nodes) {
    if (typeof node.id !== "string") continue;
    const data = isRecord(node.data) ? node.data : {};
    titleByNode.set(
      node.id,
      typeof data.title === "string" && data.title.trim()
        ? data.title
        : typeof data.label === "string" && data.label.trim()
          ? data.label
          : node.id,
    );
  }

  const placeholders = nodeIds.map(() => "?").join(",");
  const rows = store
    .prepare(`
      SELECT id, node_id, kind, result_asset_id, result_text
      FROM generation_tasks
      WHERE
        canvas_id = ?
        AND owner_id = ?
        AND state = 'success'
        AND node_id IN (${placeholders})
        AND (result_asset_id IS NOT NULL OR result_text IS NOT NULL)
      ORDER BY updated_at ASC, rowid ASC
    `)
    .all(canvasId, ownerId, ...nodeIds) as Array<{
    id: string;
    kind: "audio" | "image" | "text" | "video";
    node_id: string;
    result_asset_id: string | null;
    result_text: string | null;
  }>;
  if (rows.length === 0) {
    json(response, 400, { error: "该组还没有可下载的生成结果" });
    return;
  }
  // 用户决定（2026-08-07）：每个节点只打包最近一次成功结果。
  // 查询按 updated_at ASC 排序，逐节点覆盖 Map 后即保留每个节点的最新一条。
  const latestByNode = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    latestByNode.set(row.node_id, row);
  }
  const dedupedRows = [...latestByNode.values()];

  const assetIds = dedupedRows
    .map((row) => row.result_asset_id)
    .filter((value): value is string => Boolean(value));
  const mediaRows = assetIds.length
    ? (store
        .prepare(`
          SELECT id, kind, storage_name, storage_backend, object_key,
            storage_profile_id, byte_size
          FROM media_assets
          WHERE owner_id = ? AND id IN (${assetIds.map(() => "?").join(",")})
        `)
        .all(ownerId, ...assetIds) as Array<{
        byte_size: number;
        id: string;
        kind: "audio" | "image" | "video";
        object_key: string | null;
        storage_backend: "local" | "oss";
        storage_profile_id: string | null;
        storage_name: string;
      }>)
    : [];
  const mediaById = new Map(
    mediaRows.map((row) => [`${row.id}:${row.kind}`, row]),
  );

  const skipped: Array<{ nodeTitle: string; reason: string; taskId: string }> =
    [];
  const inputs: DownloadPlanInput[] = [];
  for (const row of dedupedRows) {
    const nodeTitle = titleByNode.get(row.node_id) ?? "节点";
    if (row.kind === "text") {
      if (!row.result_text) {
        skipped.push({ nodeTitle, reason: "文字结果为空", taskId: row.id });
      } else {
        inputs.push({
          byteSize: Buffer.byteLength(row.result_text, "utf8"),
          kind: "text",
          nodeTitle,
          resultText: row.result_text,
          taskId: row.id,
        });
      }
      continue;
    }
    if (!row.result_asset_id) {
      skipped.push({ nodeTitle, reason: "结果素材缺失", taskId: row.id });
      continue;
    }
    const media = mediaById.get(`${row.result_asset_id}:${row.kind}`);
    if (!media) {
      skipped.push({ nodeTitle, reason: "结果素材已不存在", taskId: row.id });
      continue;
    }
    if (media.storage_backend === "local") {
      const local = await localMediaPath(
        ownerId,
        row.kind,
        row.result_asset_id,
      );
      if (!local) {
        skipped.push({ nodeTitle, reason: "结果素材文件缺失", taskId: row.id });
        continue;
      }
      try {
        const info = await stat(local.file);
        if (info.size !== local.byteSize) {
          skipped.push({ nodeTitle, reason: "结果素材大小不一致", taskId: row.id });
          continue;
        }
      } catch {
        skipped.push({ nodeTitle, reason: "结果素材文件缺失", taskId: row.id });
        continue;
      }
      inputs.push({
        byteSize: local.byteSize,
        kind: row.kind,
        media: {
          assetId: row.result_asset_id,
          backend: "local",
          storageName: local.file,
        },
        nodeTitle,
        storageExtension: local.file.split(".").at(-1) ?? undefined,
        taskId: row.id,
      });
    } else {
      inputs.push({
        byteSize: Number(media.byte_size),
        kind: row.kind,
        media: {
          assetId: row.result_asset_id,
          backend: "oss",
          objectKey: media.object_key ?? undefined,
          storageProfileId: media.storage_profile_id,
        },
        nodeTitle,
        storageExtension: media.storage_name.split(".").at(-1) ?? undefined,
        taskId: row.id,
      });
    }
  }
  if (inputs.length === 0) {
    json(response, 400, { error: "该组还没有可下载的生成结果" });
    return;
  }

  let plan: DownloadPlan;
  try {
    plan = planGroupDownload(inputs);
  } catch (error) {
    json(response, 400, {
      error: error instanceof Error ? error.message : "下载内容超过上限",
    });
    return;
  }

  const tempDirectories: string[] = [];
  const failedOssTaskIds = new Set<string>();
  for (const entry of plan.entries) {
    if (entry.kind !== "media" || entry.media?.backend !== "oss") continue;
    const spooled = await spoolOssEntry(entry);
    if (!spooled) {
      skipped.push({
        nodeTitle: entry.name,
        reason: "云端结果读取失败，已跳过",
        taskId: entry.taskId,
      });
      failedOssTaskIds.add(entry.taskId);
      continue;
    }
    entry.media = { ...entry.media, storageName: spooled.file };
    tempDirectories.push(spooled.tempDirectory);
  }
  const remaining = plan.entries.filter(
    (entry) => !failedOssTaskIds.has(entry.taskId),
  );
  if (remaining.length === 0) {
    json(response, 400, { error: "该组还没有可下载的生成结果" });
    return;
  }

  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .slice(0, 19);
  const archive = new ZipArchive({ zlib: { level: 6 } });
  response.statusCode = 200;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/zip");
  response.setHeader(
    "Content-Disposition",
    `attachment; filename="workflow-results-${timestamp}.zip"; filename*=UTF-8''${encodeURIComponent(`工作流结果-${timestamp}.zip`)}`,
  );
  if (skipped.length > 0) {
    response.setHeader("X-Download-Skipped", String(skipped.length));
  }
  archive.on("error", () => response.destroy());
  archive.pipe(response);
  if (skipped.length > 0) {
    const lines = skipped.map(
      (item) => `- ${item.nodeTitle}（任务 ${item.taskId}）：${item.reason}`,
    );
    archive.append(
      `以下 ${skipped.length} 项结果未能打包：\n${lines.join("\n")}\n`,
      { name: "下载说明.txt" },
    );
  }
  for (const entry of remaining) {
    if (entry.kind === "text") {
      archive.append(entry.resultText ?? "", { name: entry.name });
      continue;
    }
    if (entry.media?.backend === "local" && entry.media.storageName) {
      archive.file(entry.media.storageName, { name: entry.name });
    } else if (entry.media?.storageName) {
      archive.file(entry.media.storageName, { name: entry.name });
    }
  }
  try {
    await archive.finalize();
  } finally {
    for (const directory of tempDirectories) {
      await rm(directory, { force: true, recursive: true }).catch(
        () => undefined,
      );
    }
  }
}
