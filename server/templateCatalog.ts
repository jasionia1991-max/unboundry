import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import { requestIdentity } from "./auth";
import { appDataDirectory, openAppDatabase } from "./database";
import {
  decodedRequestPath,
  HttpRequestError,
  readJsonBody,
} from "./httpRequest";
import { isRealCategory } from "../types/templateCategories";
import {
  isRegisteredTemplateNodeKind,
} from "../types/persistedNodeSchemaRegistry";
import type { TemplateNodeKind } from "../types/nodeVocabulary";

export function accountDeletionBlocksTemplateMutation(error: unknown) {
  return error instanceof Error &&
    error.message.includes("account deletion blocks template mutation");
}

type RawTemplateNode = {
  data?: {
    contentOnly?: boolean;
    params?: { aspectRatio?: string; imageSize?: string };
    prompt?: string;
    text?: string;
    title?: string;
  };
  height?: number;
  id: string;
  parentId?: string;
  position?: { x: number; y: number };
  type: string;
  width?: number;
};

type RawTemplateEdge = {
  id: string;
  source: string;
  sourceHandle?: string;
  target: string;
  targetHandle?: string;
};

export type TemplateNodeType = TemplateNodeKind;

type TemplateGraphNode = {
  data: Record<string, unknown> & { label: string };
  id: string;
  parentId?: string;
  position: { x: number; y: number };
  style: { height: number; width: number };
  type: TemplateNodeType;
  zIndex: number;
};

type TemplateGraphEdge = {
  data?: Record<string, unknown>;
  id: string;
  source: string;
  sourceHandle: "source";
  target: string;
  targetHandle: "target";
  type: "cuttable";
};

export type TemplateGraph = {
  edges: TemplateGraphEdge[];
  nodes: TemplateGraphNode[];
  version: 1;
};

export type TemplateCatalogDataRecord = {
  categories: string[];
  description: string;
  edges: RawTemplateEdge[];
  id: string;
  nodes: RawTemplateNode[];
  previewImage: string;
  sourceTemplateId: string;
  title: string;
};

type UserTemplateRow = {
  category: string | null;
  cover_asset_id: string | null;
  created_at: string;
  graph: string;
  id: string;
  title: string;
  updated_at: string;
};

export type PublicTemplateStatus = "draft" | "published" | "archived";

export type PublicTemplateRow = {
  archived_at: string | null;
  category: string | null;
  cover_asset_id: string | null;
  created_by: string | null;
  created_at: string;
  description: string | null;
  graph: string;
  id: string;
  preview_image: string | null;
  status: PublicTemplateStatus;
  title: string;
  updated_by: string | null;
  updated_at: string;
};

export type UserTemplateCard = {
  categories: string[];
  cover: { assetId: string; kind: "image" | "video" } | null;
  createdAt: string;
  graph?: TemplateGraph;
  id: string;
  previewImage?: string;
  title: string;
  updatedAt: string;
};

export type PublicTemplateCard = {
  categories: string[];
  cover: { assetId: string; kind: "image" | "video" } | null;
  createdAt: string;
  description: string;
  graph?: TemplateGraph;
  id: string;
  previewImage?: string;
  title: string;
  updatedAt: string;
};

export const categories = [
  "最近使用",
  "我的模板",
  "全部",
  "Seedance 2.0",
  "广告",
  "电商",
  "影视",
  "生活",
  "工具",
  "有趣",
  "ACG",
];

// 可保存/发布使用的真实分类白名单（不含筛选桶：最近使用/我的模板/全部）。
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

function localNodeType(rawType: string): TemplateNodeType {
  if (isRegisteredTemplateNodeKind(rawType)) return rawType;
  return "text";
}

function labelForType(type: TemplateNodeType) {
  if (type === "group") return "Group";
  if (type === "image") return "Image";
  if (type === "audio") return "Audio";
  if (type === "playlist") return "Playlist";
  if (type === "storyboard") return "Storyboard";
  if (type === "video") return "Video";
  return "Text";
}

export function buildTemplateGraph(record: TemplateCatalogDataRecord): TemplateGraph {
  const rawNodes = record.nodes;
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const raw of rawNodes) {
    const position = raw.position ?? { x: 0, y: 0 };
    const width = raw.width ?? 250;
    const height = raw.height ?? 250;
    left = Math.min(left, position.x);
    top = Math.min(top, position.y);
    right = Math.max(right, position.x + width);
    bottom = Math.max(bottom, position.y + height);
  }
  if (!Number.isFinite(left) || !Number.isFinite(top)) {
    left = 0;
    top = 0;
    right = 800;
    bottom = 600;
  }
  const groupId = "template-group";
  const groupPosition = { x: left - 24, y: top - 24 };
  const idMap = new Map<string, string>();
  const incomingByNode = new Map<string, RawTemplateEdge[]>();
  for (const edge of record.edges) {
    incomingByNode.set(edge.target, [
      ...(incomingByNode.get(edge.target) ?? []),
      edge,
    ]);
  }
  const nodes: TemplateGraphNode[] = [];
  rawNodes.forEach((raw, index) => {
    const localId = `template-node-${index + 1}`;
    idMap.set(raw.id, localId);
    const position = raw.position ?? { x: 0, y: 0 };
    const type = localNodeType(raw.type);
    const data: TemplateGraphNode["data"] = {
      label: labelForType(type),
      title: raw.data?.title ?? labelForType(type),
    };
    if (type === "text") {
      const prompt = raw.data?.prompt ?? "";
      const text = raw.data?.text ?? "";
      if (raw.data?.contentOnly === true) {
        // 母版节点：只保存内容供下游引用，不参与文字生成执行。
        data.textPromptReady = false;
        if (text) data.content = text;
      } else {
        data.textPrompt = prompt || text;
        data.textPromptReady = true;
        if (text) data.content = text;
      }
    } else if (type === "image") {
      data.sourceKind = "image";
      const prompt = raw.data?.prompt?.trim() ?? "";
      const isPureInput = !prompt && (incomingByNode.get(raw.id)?.length ?? 0) === 0;
      data.imagePromptReady = !isPureInput;
      if (prompt) data.imagePrompt = prompt;
      if (raw.data?.params?.aspectRatio) {
        data.imageAspectRatio = raw.data.params.aspectRatio;
      }
      if (raw.data?.params?.imageSize) {
        data.imageQuality = raw.data.params.imageSize.toLocaleLowerCase();
      }
    }
    nodes.push({
      id: localId,
      type,
      position: {
        x: position.x - groupPosition.x,
        y: position.y - groupPosition.y,
      },
      parentId: groupId,
      data,
      style: {
        height: raw.height ?? 250,
        width: raw.width ?? 250,
      },
      zIndex: 1,
    });
  });
  nodes.unshift({
    id: groupId,
    type: "group",
    position: groupPosition,
    data: { label: "Group", title: record.title },
    style: {
      height: bottom - top + 48,
      width: right - left + 48,
    },
    zIndex: 0,
  });
  const edges: TemplateGraphEdge[] = record.edges.map((edge, index) => ({
    id: `template-edge-${index + 1}`,
    source: idMap.get(edge.source) ?? edge.source,
    target: idMap.get(edge.target) ?? edge.target,
    sourceHandle: "source",
    targetHandle: "target",
    type: "cuttable",
  }));
  return { edges, nodes, version: 1 };
}

function json(response: ServerResponse, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function boundedInteger(value: string | null, fallback: number, maximum: number) {
  if (value === null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= maximum
    ? parsed
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function validTemplateGraph(value: unknown): value is TemplateGraph {
  if (!isRecord(value)) return false;
  if (value.version !== 1) return false;
  const nodes = value.nodes;
  const edges = value.edges;
  if (!Array.isArray(nodes) || nodes.length > 500) return false;
  if (!Array.isArray(edges) || edges.length > 1000) return false;
  const nodeById = new Map<string, Record<string, unknown>>();
  for (const rawNode of nodes) {
    if (!isRecord(rawNode)) return false;
    const type = rawNode.type;
    if (
      !isRegisteredTemplateNodeKind(type)
    ) {
      return false;
    }
    if (
      typeof rawNode.id !== "string" ||
      rawNode.id.length === 0 ||
      rawNode.id.length > 200
    ) {
      return false;
    }
    if (nodeById.has(rawNode.id)) return false;
    if (
      !isRecord(rawNode.position) ||
      !isFiniteNumber(rawNode.position.x) ||
      !isFiniteNumber(rawNode.position.y)
    ) {
      return false;
    }
    if (rawNode.parentId !== undefined && typeof rawNode.parentId !== "string") {
      return false;
    }
    if (rawNode.style !== undefined) {
      if (!isRecord(rawNode.style)) return false;
      if (
        rawNode.style.height !== undefined &&
        !isFiniteNumber(rawNode.style.height)
      ) {
        return false;
      }
      if (
        rawNode.style.width !== undefined &&
        !isFiniteNumber(rawNode.style.width)
      ) {
        return false;
      }
    }
    if (rawNode.zIndex !== undefined && !isFiniteNumber(rawNode.zIndex)) {
      return false;
    }
    if (!isRecord(rawNode.data) || typeof rawNode.data.label !== "string") {
      return false;
    }
    nodeById.set(rawNode.id, rawNode);
  }
  let topLevelNodes = 0;
  for (const rawNode of nodeById.values()) {
    if (rawNode.parentId === undefined) {
      topLevelNodes += 1;
      continue;
    }
    if (
      rawNode.parentId === rawNode.id ||
      rawNode.type === "group" ||
      nodeById.get(rawNode.parentId as string)?.type !== "group"
    ) {
      return false;
    }
  }
  if (nodes.length > 0 && topLevelNodes === 0) return false;
  const edgeIds = new Set<string>();
  const edgePairs = new Set<string>();
  for (const rawEdge of edges) {
    if (!isRecord(rawEdge)) return false;
    for (const key of ["id", "source", "target"] as const) {
      const value = rawEdge[key];
      if (
        typeof value !== "string" ||
        value.length === 0 ||
        value.length > 200
      ) {
        return false;
      }
    }
    const edgeId = rawEdge.id as string;
    const sourceId = rawEdge.source as string;
    const targetId = rawEdge.target as string;
    if (
      edgeIds.has(edgeId) ||
      sourceId === targetId ||
      !nodeById.has(sourceId) ||
      !nodeById.has(targetId)
    ) {
      return false;
    }
    const edgePair = `${sourceId}\0${targetId}`;
    if (edgePairs.has(edgePair)) return false;
    edgeIds.add(edgeId);
    edgePairs.add(edgePair);
    if (
      rawEdge.sourceHandle !== undefined &&
      typeof rawEdge.sourceHandle !== "string"
    ) {
      return false;
    }
    if (
      rawEdge.targetHandle !== undefined &&
      typeof rawEdge.targetHandle !== "string"
    ) {
      return false;
    }
    if (rawEdge.type !== undefined && typeof rawEdge.type !== "string") {
      return false;
    }
    if (rawEdge.data !== undefined && !isRecord(rawEdge.data)) {
      return false;
    }
  }
  return true;
}

export function parseTemplateGraph(value: string): TemplateGraph | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    return validTemplateGraph(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function readyCoverKind(
  store: DatabaseSync,
  ownerId: string | null,
  assetId: string,
  expectedKind?: "image" | "video",
) {
  if (!ownerId) return undefined;
  const media = store.prepare(`
    SELECT kind
    FROM media_assets
    WHERE
      id = ?
      AND owner_id = ?
      AND storage_status = 'ready'
      AND kind IN ('image', 'video')
  `).all(assetId, ownerId) as Array<{ kind: "image" | "video" }>;
  const matches = expectedKind
    ? media.filter((row) => row.kind === expectedKind)
    : media;
  if (matches.length !== 1) return undefined;
  return matches[0].kind;
}

function resolveTemplateCover(
  store: DatabaseSync,
  ownerId: string,
  sourceCanvasId: string,
  nodeIds: string[],
  graph: TemplateGraph,
) {
  if (sourceCanvasId && nodeIds.length > 0) {
    const placeholders = nodeIds.map(() => "?").join(",");
    const task = store
      .prepare(`
        SELECT tasks.result_asset_id
        FROM generation_tasks AS tasks
        JOIN media_assets AS media
          ON media.id = tasks.result_asset_id
          AND media.kind = tasks.kind
          AND media.owner_id = tasks.owner_id
          AND media.storage_status = 'ready'
        WHERE
          tasks.canvas_id = ?
          AND tasks.owner_id = ?
          AND tasks.state = 'success'
          AND tasks.kind IN ('image', 'video')
          AND tasks.result_asset_id IS NOT NULL
          AND tasks.node_id IN (${placeholders})
        ORDER BY tasks.updated_at DESC, tasks.rowid DESC
        LIMIT 1
      `)
      .get(sourceCanvasId, ownerId, ...nodeIds) as
      | { result_asset_id: string }
      | undefined;
    if (task?.result_asset_id) return task.result_asset_id;
  }
  for (const node of graph.nodes) {
    if (node.type !== "image" && node.type !== "video") continue;
    const assetId = node.data.assetId;
    if (
      typeof assetId === "string" &&
      assetId.trim() &&
      readyCoverKind(store, ownerId, assetId.trim(), node.type)
    ) return assetId.trim();
  }
  return null;
}

export function userTemplateCard(
  store: DatabaseSync,
  ownerId: string,
  row: UserTemplateRow,
  includeGraph: boolean,
): UserTemplateCard {
  let cover: UserTemplateCard["cover"] = null;
  if (row.cover_asset_id) {
    const kind = readyCoverKind(store, ownerId, row.cover_asset_id);
    if (kind) {
      cover = { assetId: row.cover_asset_id, kind };
    }
  }
  return {
    categories: row.category ? [row.category] : [],
    cover,
    createdAt: row.created_at,
    graph: includeGraph ? parseTemplateGraph(row.graph) : undefined,
    id: row.id,
    previewImage: cover
      ? cover.kind === "video"
        ? `/api/video-assets/${encodeURIComponent(cover.assetId)}`
        : `/api/assets/${encodeURIComponent(cover.assetId)}`
      : undefined,
    title: row.title,
    updatedAt: row.updated_at,
  };
}

export function parsePublicCategory(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

export function publicTemplateCard(
  store: DatabaseSync,
  row: PublicTemplateRow,
  includeGraph: boolean,
): PublicTemplateCard {
  let cover: PublicTemplateCard["cover"] = null;
  if (row.cover_asset_id) {
    // Public cards remain publicly listable, but resolving their cover must not
    // grant cross-account media access. Only the creator's ready media may be
    // referenced; seed templates without an owner use preview_image instead.
    const kind = readyCoverKind(store, row.created_by, row.cover_asset_id);
    if (kind) {
      cover = { assetId: row.cover_asset_id, kind };
    }
  }
  const previewImage =
    row.preview_image ??
    (cover
      ? cover.kind === "video"
        ? `/api/video-assets/${encodeURIComponent(cover.assetId)}`
        : `/api/assets/${encodeURIComponent(cover.assetId)}`
      : undefined);
  return {
    categories: parsePublicCategory(row.category),
    cover,
    createdAt: row.created_at,
    description: row.description ?? "",
    graph: includeGraph ? parseTemplateGraph(row.graph) : undefined,
    id: row.id,
    previewImage,
    title: row.title,
    updatedAt: row.updated_at,
  };
}

export function listPublicTemplates(
  store: DatabaseSync,
  options: {
    category: string;
    includeGraph: boolean;
    limit: number;
    offset: number;
    query: string;
    status: PublicTemplateStatus | "";
  },
) {
  const parameters: Array<string | number> = [];
  const conditions: string[] = [];
  if (options.status) {
    conditions.push("status = ?");
    parameters.push(options.status);
  }
  if (options.query) {
    conditions.push("title LIKE ? ESCAPE '\\'");
    parameters.push(
      `%${options.query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`,
    );
  }
  if (
    options.category &&
    options.category !== "全部" &&
    options.category !== "最近使用"
  ) {
    conditions.push(`
      EXISTS (
        SELECT 1 FROM json_each(public_templates.category)
        WHERE json_each.value = ?
      )
    `);
    parameters.push(options.category);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = store
    .prepare(`
      SELECT
        id, title, description, category, graph, cover_asset_id,
        preview_image, status, created_by, created_at,
        updated_by, updated_at, archived_at
      FROM public_templates
      ${where}
      ORDER BY updated_at DESC, rowid DESC
      LIMIT ? OFFSET ?
    `)
    .all(...parameters, options.limit, options.offset) as PublicTemplateRow[];
  const total = Number(
    (
      store
        .prepare(
          `SELECT COUNT(*) AS count FROM public_templates ${where}`,
        )
        .get(...parameters) as { count: number }
    ).count,
  );
  return {
    items: rows.map((row) =>
      publicTemplateCard(store, row, options.includeGraph),
    ),
    rows,
    total,
  };
}

export function listUserTemplates(
  store: DatabaseSync,
  ownerId: string,
  options: {
    category: string;
    limit: number;
    offset: number;
    query: string;
  },
) {
  const parameters: Array<string | number> = [ownerId];
  const conditions = ["owner_id = ?"];
  if (options.query) {
    conditions.push("title LIKE ? ESCAPE '\\'");
    parameters.push(`%${options.query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`);
  }
  if (
    options.category &&
    options.category !== "全部" &&
    options.category !== "我的模板" &&
    options.category !== "最近使用"
  ) {
    conditions.push("category = ?");
    parameters.push(options.category);
  }
  const where = conditions.join(" AND ");
  const rows = store
    .prepare(`
      SELECT
        id, title, category, graph, cover_asset_id, created_at, updated_at
      FROM user_templates
      WHERE ${where}
      ORDER BY updated_at DESC
      LIMIT ? OFFSET ?
    `)
    .all(...parameters, options.limit, options.offset) as UserTemplateRow[];
  const total = Number(
    (
      store
        .prepare(`SELECT COUNT(*) AS count FROM user_templates WHERE ${where}`)
        .get(...parameters) as { count: number }
    ).count,
  );
  return { rows, total };
}

export function saveUserTemplate(
  store: DatabaseSync,
  ownerId: string,
  input: Record<string, unknown>,
): UserTemplateRow {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (title.length < 1 || title.length > 40) {
    throw new Error("模板标题需为 1–40 个字符");
  }
  const category = typeof input.category === "string" ? input.category.trim() : "";
  if (category && !isRealCategory(category)) {
    throw new Error("模板分类无效");
  }
  if (!validTemplateGraph(input.graph)) {
    throw new Error("模板图结构无效");
  }
  const sourceCanvasId =
    typeof input.sourceCanvasId === "string" ? input.sourceCanvasId.trim() : "";
  const nodeIds = Array.isArray(input.nodeIds)
    ? input.nodeIds.filter(
        (value): value is string => typeof value === "string" && value.length > 0,
      )
    : [];
  const coverAssetId = resolveTemplateCover(
    store,
    ownerId,
    sourceCanvasId,
    nodeIds,
    input.graph,
  );
  const id = randomUUID();
  const timestamp = new Date().toISOString();
  store
    .prepare(`
      INSERT INTO user_templates (
        id, owner_id, title, category, graph, cover_asset_id,
        created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      id,
      ownerId,
      title,
      category || null,
      JSON.stringify(input.graph),
      coverAssetId,
      timestamp,
      timestamp,
    );
  return {
    category: category || null,
    cover_asset_id: coverAssetId,
    created_at: timestamp,
    graph: JSON.stringify(input.graph),
    id,
    title,
    updated_at: timestamp,
  };
}

export function deleteUserTemplate(
  store: DatabaseSync,
  ownerId: string,
  templateId: string,
) {
  const result = store
    .prepare(`
      DELETE FROM user_templates
      WHERE id = ? AND owner_id = ?
    `)
    .run(templateId, ownerId);
  return result.changes === 1;
}

export async function templateCatalogApi(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const identity = requestIdentity(request);
  const path = decodedRequestPath(request).replace(
    /^\/+/,
    "",
  );
  const store = db();

  if (request.method === "GET" && !path) {
    const url = new URL(request.url ?? "", "http://127.0.0.1");
    const limit = boundedInteger(url.searchParams.get("limit"), 20, 100);
    const offset = boundedInteger(url.searchParams.get("offset"), 0, 100_000);
    if (limit === undefined || offset === undefined || limit === 0) {
      json(response, 400, { error: "模板分页参数无效" });
      return;
    }
    const space = url.searchParams.get("space") ?? "public";
    if (space !== "public" && space !== "mine") {
      json(response, 400, { error: "模板空间无效" });
      return;
    }
    const query = (url.searchParams.get("q") ?? "").trim().toLocaleLowerCase();
    const category = (url.searchParams.get("category") ?? "全部").trim();
    if (category && !categories.includes(category)) {
      json(response, 400, { error: "模板分类无效" });
      return;
    }
    const includeGraph = url.searchParams.get("includeGraph") === "true";

    if (space === "mine") {
      if (!identity) {
        json(response, 401, { error: "请先登录" });
        return;
      }
      const { rows, total } = listUserTemplates(store, identity.userId, {
        category,
        limit,
        offset,
        query,
      });
      const items = rows.map((row) =>
        userTemplateCard(store, identity.userId, row, includeGraph),
      );
      json(response, 200, {
        categories,
        items,
        pagination: {
          hasMore: offset + items.length < total,
          limit,
          offset,
          total,
        },
      });
      return;
    }

    const { items, total } = listPublicTemplates(store, {
      category,
      includeGraph,
      limit,
      offset,
      query,
      status: "published",
    });

    json(response, 200, {
      categories,
      items,
      pagination: {
        hasMore: offset + items.length < total,
        limit,
        offset,
        total,
      },
    });
    return;
  }

  if (request.method === "POST" && !path) {
    if (!identity) {
      json(response, 401, { error: "请先登录" });
      return;
    }
    try {
      const input = await readJsonBody<Record<string, unknown>>(
        request,
        512 * 1_024,
      );
      const row = saveUserTemplate(store, identity.userId, input);
      json(response, 201, {
        template: userTemplateCard(store, identity.userId, row, false),
      });
    } catch (error) {
      if (error instanceof HttpRequestError) throw error;
      if (accountDeletionBlocksTemplateMutation(error)) {
        json(response, 409, {
          code: "ACCOUNT_DELETE_ACTIVE",
          error: "账号删除正在进行，不能再保存模板",
        });
        return;
      }
      const message = error instanceof Error ? error.message : "模板保存失败";
      json(response, 400, { error: message });
    }
    return;
  }

  if (request.method === "DELETE" && /^[a-f0-9-]{36}$/i.test(path)) {
    if (!identity) {
      json(response, 401, { error: "请先登录" });
      return;
    }
    if (!deleteUserTemplate(store, identity.userId, path.toLocaleLowerCase())) {
      json(response, 404, { error: "模板不存在" });
      return;
    }
    json(response, 200, { deleted: true, id: path.toLocaleLowerCase() });
    return;
  }

  response.setHeader("Allow", "GET, POST, DELETE");
  json(response, 404, { error: "模板接口不存在" });
}
