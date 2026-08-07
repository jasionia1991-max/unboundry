// 真实模板分类白名单（不含筛选桶：最近使用/我的模板/全部）。
// 前后端与 OpenAPI 共用；新增分类必须先改这里。
export const REAL_CATEGORIES = [
  "电商",
  "广告",
  "影视",
  "生活",
  "工具",
  "有趣",
  "ACG",
  "Seedance 2.0",
] as const;

export type TemplateCategory = (typeof REAL_CATEGORIES)[number];

export function isRealCategory(value: string): boolean {
  return (REAL_CATEGORIES as readonly string[]).includes(value);
}
