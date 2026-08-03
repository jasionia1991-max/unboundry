import type { IncomingMessage, ServerResponse } from "node:http";

const categories = [
  "全部角色",
  "古代历史",
  "近代历史",
  "当代现实",
  "科幻未来",
  "架空幻想",
];

const filters: Record<string, string[]> = {
  性别: ["男", "女", "中性"],
  年龄段: ["青年", "中年", "老年", "少年", "幼年"],
  物种: ["人类", "机械体", "妖怪", "其他", "神明", "亡灵", "外星种族", "精灵", "兽人", "矮人"],
  体格: ["纤细", "标准", "健壮", "壮硕", "非人形"],
  身高: ["中等", "高挑", "矮小"],
  肤色: ["中等", "浅", "深", "极浅", "极深", "非自然色"],
  发长: ["短发", "长发", "中长", "极短", "遮盖", "光头"],
  发色: ["黑", "无", "灰白", "深棕", "金", "白", "浅棕", "彩色", "红"],
  气质: ["飒爽", "清冷", "稚嫩", "威严", "温柔", "儒雅", "憨厚", "沧桑", "霸气", "阴鸷", "妩媚", "癫狂"],
};

const names = [
  "诸侯国君", "游说学子", "从军女将", "饱经战乱的农夫", "贵族卿大夫之女",
  "幕后权谋策士", "守城士卒", "私塾学子", "宫廷乐舞伎", "统兵大将军",
  "山野隐逸狂人", "铸剑名匠", "墨家游侠", "失国公主", "奔走列国的使臣",
  "王府侍女", "通灵大祝", "一方诸侯国君", "卿大夫之女", "游学士子",
  "边境守将", "刺客组织成员", "王室幼子", "掌权王后", "纵横家说客",
  "隐遁老农", "将门习武少女", "墨家工匠", "宫廷舞姬", "落魄雇佣兵",
  "王府老乳母", "死士死刑犯", "跨国大商人", "统兵将帅", "士大夫之女",
  "游说诸子", "宫廷侍女", "赵国骑兵", "城防工匠", "贵族主母",
  "秦国密探", "战国诸侯", "乐府舞姬", "求学学子", "边境女猎户",
  "跨国商人", "宫廷舞姬", "当朝高官", "清流名士", "码头苦力",
  "市井货郎之女", "内廷近侍", "宫廷炼丹术士", "禁卫军统领", "富户幼童",
  "市井女侠客", "黑市商贾", "落魄乐伎", "酒楼掌柜", "书院小童",
];

const metadata = [
  ["男", "中年", "壮硕", "威严"],
  ["男", "青年", "纤细", "儒雅"],
  ["女", "青年", "健壮", "飒爽"],
  ["男", "老年", "纤细", "沧桑"],
  ["女", "青年", "标准", "温柔"],
  ["男", "中年", "纤细", "阴鸷"],
  ["男", "青年", "壮硕", "憨厚"],
  ["男", "少年", "纤细", "稚嫩"],
  ["女", "青年", "纤细", "妩媚"],
  ["男", "中年", "壮硕", "霸气"],
  ["中性", "青年", "标准", "清冷"],
  ["女", "幼年", "标准", "稚嫩"],
];

const colors = [
  ["#202c37", "#9d5b36", "#202020"],
  ["#edf0ec", "#8aa9be", "#2b3541"],
  ["#704436", "#b75c43", "#252525"],
  ["#8b765f", "#a69472", "#474038"],
  ["#ead9cf", "#c89ba0", "#4c3838"],
  ["#332b3d", "#745162", "#16151a"],
];

const characters = Array.from({ length: 80 }, (_, index) => {
  const meta = metadata[index % metadata.length];
  const category = categories[(index % 5) + 1];
  return {
    category,
    colors: colors[index % colors.length],
    id: `ai-character-${index + 1}`,
    meta,
    name: names[index] ?? `${category}角色 ${index + 1}`,
    tags: [
      ...meta,
      "人类",
      index % 3 === 0 ? "高挑" : index % 3 === 1 ? "中等" : "矮小",
      index % 4 === 0 ? "浅" : index % 4 === 1 ? "中等" : "深",
      index % 3 === 0 ? "长发" : index % 3 === 1 ? "短发" : "中长",
      index % 4 === 0 ? "黑" : index % 4 === 1 ? "深棕" : "灰白",
    ],
  };
});

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

export function characterCatalogApi(
  request: IncomingMessage,
  response: ServerResponse,
) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    json(response, 405, { error: "角色目录只支持读取" });
    return;
  }
  const url = new URL(request.url ?? "", "http://127.0.0.1");
  const limit = boundedInteger(url.searchParams.get("limit"), 60, 100);
  const offset = boundedInteger(url.searchParams.get("offset"), 0, 100_000);
  const category = (url.searchParams.get("category") ?? "全部角色").trim();
  if (limit === undefined || offset === undefined || limit === 0) {
    json(response, 400, { error: "角色分页参数无效" });
    return;
  }
  if (!categories.includes(category)) {
    json(response, 400, { error: "角色分类无效" });
    return;
  }
  const selections = new Map<string, string[]>();
  for (const selection of url.searchParams.getAll("filter")) {
    const separator = selection.indexOf(":");
    const key = separator > 0 ? selection.slice(0, separator) : "";
    const value = separator > 0 ? selection.slice(separator + 1) : "";
    if (!filters[key]?.includes(value)) {
      json(response, 400, { error: "角色筛选参数无效" });
      return;
    }
    selections.set(key, [...(selections.get(key) ?? []), value]);
  }
  const matches = characters.filter((character) =>
    (category === "全部角色" || character.category === category) &&
    Array.from(selections.values()).every((values) =>
      values.some((value) => character.tags.includes(value)),
    ),
  );
  const items = matches.slice(offset, offset + limit);
  json(response, 200, {
    categories,
    filters,
    items,
    pagination: {
      hasMore: offset + items.length < matches.length,
      limit,
      offset,
      total: matches.length,
    },
  });
}
