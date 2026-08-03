export const NODE_DEFAULT_SIZES = {
  audio: { height: 250, width: 444 },
  image: { height: 250, width: 250 },
  playlist: { height: 104, width: 960 },
  storyboard: { height: 1000, width: 1200 },
  text: { height: 250, width: 250 },
  video: { height: 250, width: 444 },
} as const;

export function fitVisualMediaSize(width: number, height: number) {
  if (width <= 0 || height <= 0) return { height: 250, width: 444 };

  const ratio = width / height;
  return ratio >= 1
    ? { height: 250, width: Math.round(250 * ratio) }
    : { height: Math.round(250 / ratio), width: 250 };
}
