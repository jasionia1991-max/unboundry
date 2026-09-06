/** Resolve durable geometry only when adopting media, never on load. */
export type MediaSizingMode = "auto" | "manual";
export function validMediaDimensions(w: unknown, h: unknown): boolean {
  return typeof w === "number" && Number.isFinite(w) && w > 0 &&
    typeof h === "number" && Number.isFinite(h) && h > 0;
}
export function fitVisualMediaSize(width: number, height: number) {
  if (!validMediaDimensions(width, height)) return { height: 250, width: 444 };
  const ratio = width / height;
  const size = ratio >= 1 ? { height: 250, width: Math.round(250 * ratio) }
    : { height: Math.round(250 / ratio), width: 250 };
  return Number.isSafeInteger(size.width) && Number.isSafeInteger(size.height)
    ? size : { height: 250, width: 444 };
}
export function adoptedMediaStyle(node: { type?: unknown; style?: unknown }, data: Record<string, unknown>) {
  if ((node.type !== "image" && node.type !== "video") || data.mediaSizingMode !== "auto" ||
      !validMediaDimensions(data.mediaWidth, data.mediaHeight)) return undefined;
  return { ...(node.style && typeof node.style === "object" ? node.style : {}),
    ...fitVisualMediaSize(Number(data.mediaWidth), Number(data.mediaHeight)) };
}
