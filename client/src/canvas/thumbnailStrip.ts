export type ThumbnailStrip = {
  columns: number;
  count: number;
  frameHeight: number;
  frameWidth: number;
  interval: number;
  rows: number;
  url: string;
};

const cache = new Map<string, Promise<ThumbnailStrip | null>>();

function numberHeader(response: Response, name: string) {
  return Number(response.headers.get(name));
}

export function thumbnailStrip(src: string) {
  const cached = cache.get(src);
  if (cached) return cached;
  const pending = fetch(src)
    .then((response) => {
      if (!response.ok) throw new Error("无法读取视频");
      return response.blob();
    })
    .then((blob) =>
      fetch("/api/playlist/thumbnails", {
        body: blob,
        headers: { "Content-Type": "application/octet-stream" },
        method: "POST",
      }),
    )
    .then(async (response) => {
      if (!response.ok) throw new Error(await response.text());
      return {
        columns: numberHeader(response, "X-Thumbnail-Columns"),
        count: numberHeader(response, "X-Thumbnail-Count"),
        frameHeight: numberHeader(response, "X-Thumbnail-Frame-Height"),
        frameWidth: numberHeader(response, "X-Thumbnail-Frame-Width"),
        interval: numberHeader(response, "X-Thumbnail-Interval"),
        rows: numberHeader(response, "X-Thumbnail-Rows"),
        url: URL.createObjectURL(await response.blob()),
      };
    })
    .catch(() => null);
  cache.set(src, pending);
  return pending;
}
