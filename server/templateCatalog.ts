import type { IncomingMessage, ServerResponse } from "node:http";

type TemplateNode = {
  data: { title: string };
  id: string;
  position: { x: number; y: number };
  type: "group" | "image" | "text" | "video";
};

type TemplateEdge = {
  id: string;
  source: string;
  target: string;
  type: "cuttable";
};

type TemplateRecord = {
  categories: string[];
  id: string;
  title: string;
  tone: string;
};

const categories = [
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

const templates: TemplateRecord[] = [
  { categories: ["广告", "电商"], id: "tech-product-ad", title: "Tech Product Ad", tone: "tech" },
  { categories: ["广告", "有趣"], id: "f1-rapid-tire-swap", title: "F1 Rapid Tire Swap", tone: "racing" },
  { categories: ["影视", "有趣"], id: "monster-clash-pov", title: "Monster Clash POV", tone: "monster" },
  { categories: ["影视"], id: "cave-monster-clash", title: "Cave Monster Clash", tone: "cave" },
  { categories: ["影视", "ACG"], id: "heroic-film-hymn", title: "英雄史诗电影赞歌", tone: "hero" },
  { categories: ["影视", "工具"], id: "nine-shot-film", title: "九宫格多景别电影演绎", tone: "storyboard" },
  { categories: ["影视", "工具"], id: "camera-angle-effects", title: "景别×视角×特效镜头大全", tone: "camera" },
  { categories: ["Seedance 2.0", "ACG"], id: "one-tap-idol-stage", title: "One-Tap Idol Stage", tone: "idol" },
  { categories: ["Seedance 2.0", "有趣"], id: "riding-flight-pov", title: "Riding Flight POV", tone: "flight" },
  { categories: ["广告", "电商"], id: "product-commerce-set", title: "通用产品全套电商图", tone: "product" },
  { categories: ["影视", "工具"], id: "json-film-storyboard", title: "Json大师电影分镜", tone: "json" },
  { categories: ["影视", "工具"], id: "storyboard-master", title: "分镜大师", tone: "shots" },
];

function storyboardMasterGraph() {
  const nodes: TemplateNode[] = [
    {
      data: { title: "分镜大师" },
      id: "template-group",
      position: { x: 0, y: 0 },
      type: "group",
    },
    {
      data: { title: "分镜描述" },
      id: "template-text",
      position: { x: 80, y: 80 },
      type: "text",
    },
    ...Array.from({ length: 15 }, (_, index): TemplateNode => ({
      data: { title: `分镜图片 ${index + 1}` },
      id: `template-image-${index + 1}`,
      position: { x: 480 + (index % 3) * 320, y: 80 + Math.floor(index / 3) * 300 },
      type: "image",
    })),
    ...Array.from({ length: 9 }, (_, index): TemplateNode => ({
      data: { title: `分镜视频 ${index + 1}` },
      id: `template-video-${index + 1}`,
      position: { x: 1500 + (index % 2) * 500, y: 80 + Math.floor(index / 2) * 330 },
      type: "video",
    })),
  ];
  const chainEdges = nodes.slice(1).map((node, index): TemplateEdge => ({
    id: `template-edge-${index + 1}`,
    source: nodes[index].id,
    target: node.id,
    type: "cuttable",
  }));
  const branchEdges = Array.from({ length: 6 }, (_, index): TemplateEdge => ({
    id: `template-branch-${index + 1}`,
    source: `template-image-${index + 1}`,
    target: `template-video-${index + 1}`,
    type: "cuttable",
  }));
  return { edges: [...chainEdges, ...branchEdges], nodes, version: 1 };
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
  const items = matches.slice(offset, offset + limit).map((template) => ({
    ...template,
    graph: includeGraph && template.id === "storyboard-master"
      ? storyboardMasterGraph()
      : undefined,
  }));

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
