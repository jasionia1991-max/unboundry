import type { IncomingMessage, ServerResponse } from "node:http";
import templateCatalogData from "./templateCatalogData.json";

type RawTemplateNode = {
  data?: {
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

type TemplateGraphNode = {
  data: {
    content?: string;
    imageAspectRatio?: string;
    imagePrompt?: string;
    imagePromptReady?: boolean;
    imageQuality?: string;
    label: string;
    sourceKind?: "image";
    textPrompt?: string;
    textPromptReady?: boolean;
    title?: string;
  };
  id: string;
  parentId?: string;
  position: { x: number; y: number };
  style: { height: number; width: number };
  type: "group" | "image" | "text" | "video";
  zIndex: number;
};

type TemplateGraphEdge = {
  id: string;
  source: string;
  sourceHandle: "source";
  target: string;
  targetHandle: "target";
  type: "cuttable";
};

type TemplateGraph = {
  edges: TemplateGraphEdge[];
  nodes: TemplateGraphNode[];
  version: 1;
};

type TemplateRecord = {
  categories: string[];
  description: string;
  id: string;
  previewImage: string;
  title: string;
};

type TemplateCatalogDataRecord = {
  categories: string[];
  description: string;
  edges: RawTemplateEdge[];
  id: string;
  nodes: RawTemplateNode[];
  previewImage: string;
  sourceTemplateId: string;
  title: string;
};

const categories = ["最近使用", "我的模板", "全部", "电商"];

const records = Object.values(
  templateCatalogData as Record<string, TemplateCatalogDataRecord>,
);

const templates: TemplateRecord[] = records.map((record) => ({
  categories: record.categories,
  description: record.description,
  id: record.id,
  previewImage: record.previewImage,
  title: record.title,
}));

function localNodeType(rawType: string): TemplateGraphNode["type"] {
  if (rawType === "image" || rawType === "text") return rawType;
  if (rawType === "video" || rawType === "group") return rawType;
  return "text";
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
      label: type === "text" ? "Text" : type === "image" ? "Image" : "Group",
      title: raw.data?.title ?? (type === "text" ? "Text" : "Image"),
    };
    if (type === "text") {
      const prompt = raw.data?.prompt ?? "";
      const text = raw.data?.text ?? "";
      data.textPrompt = prompt || text;
      data.textPromptReady = true;
      if (text) data.content = text;
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

export function templateCatalogApi(
  request: IncomingMessage,
  response: ServerResponse,
) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    json(response, 405, { error: "模板目录只支持读取" });
    return;
  }

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
  const matches = space === "mine"
    ? []
    : templates.filter((template) =>
        (!query || template.title.toLocaleLowerCase().includes(query)) &&
        (!category || category === "全部" || category === "最近使用" || template.categories.includes(category)),
      );
  const items = matches.slice(offset, offset + limit).map((template) => {
    const record = records.find((candidate) => candidate.id === template.id);
    return {
      ...template,
      graph: includeGraph && record ? buildTemplateGraph(record) : undefined,
    };
  });

  json(response, 200, {
    categories,
    items,
    pagination: {
      hasMore: offset + items.length < matches.length,
      limit,
      offset,
      total: matches.length,
    },
  });
}
