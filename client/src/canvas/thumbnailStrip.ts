export type ThumbnailStrip = {
  columns: number;
  count: number;
  frameHeight: number;
  frameWidth: number;
  interval: number;
  rows: number;
  url: string;
};

export type ThumbnailStripLease = {
  release: () => void;
  result: Promise<ThumbnailStrip | null>;
};

type CacheEntry = {
  cached: boolean;
  controller: AbortController;
  disposed: boolean;
  lastUsed: number;
  promise: Promise<ThumbnailStrip | null>;
  refs: number;
  value?: ThumbnailStrip | null;
};

const cache = new Map<string, CacheEntry>();
const maxEntries = 24;

function numberHeader(response: Response, name: string) {
  return Number(response.headers.get(name));
}

function assetIdFromVideoSource(src: string) {
  const url = new URL(src, window.location.origin);
  if (url.origin !== window.location.origin) return undefined;
  const match = url.pathname.match(/^\/api\/video-assets\/([^/]+)$/);
  if (!match) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
}

function dispose(entry: CacheEntry) {
  if (entry.disposed) return;
  entry.disposed = true;
  entry.controller.abort();
  if (entry.value?.url) URL.revokeObjectURL(entry.value.url);
}

function evict(forInsert = false) {
  while (forInsert ? cache.size >= maxEntries : cache.size > maxEntries) {
    const candidate = [...cache.entries()]
      .filter(([, entry]) => entry.refs === 0)
      .sort((left, right) => left[1].lastUsed - right[1].lastUsed)[0];
    if (!candidate) break;
    cache.delete(candidate[0]);
    candidate[1].cached = false;
    dispose(candidate[1]);
  }
}

function createEntry(src: string, assetId: string) {
  const controller = new AbortController();
  const entry = {
    cached: false,
    controller,
    disposed: false,
    lastUsed: Date.now(),
    promise: Promise.resolve<ThumbnailStrip | null>(null),
    refs: 0,
  } as CacheEntry;
  entry.promise = fetch("/api/playlist/thumbnails", {
    body: JSON.stringify({ assetId }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
    signal: controller.signal,
  })
    .then(async (response) => {
      if (!response.ok) throw new Error(await response.text());
      const blob = await response.blob();
      if (controller.signal.aborted) return null;
      return {
        columns: numberHeader(response, "X-Thumbnail-Columns"),
        count: numberHeader(response, "X-Thumbnail-Count"),
        frameHeight: numberHeader(response, "X-Thumbnail-Frame-Height"),
        frameWidth: numberHeader(response, "X-Thumbnail-Frame-Width"),
        interval: numberHeader(response, "X-Thumbnail-Interval"),
        rows: numberHeader(response, "X-Thumbnail-Rows"),
        url: URL.createObjectURL(blob),
      };
    })
    .catch(() => null)
    .then((value) => {
      entry.value = value;
      if (value === null && cache.get(src) === entry) {
        cache.delete(src);
        entry.cached = false;
      }
      return value;
    });
  return entry;
}

export function thumbnailStrip(src: string): ThumbnailStripLease {
  const assetId = assetIdFromVideoSource(src);
  if (!assetId) {
    return { release: () => undefined, result: Promise.resolve(null) };
  }
  let entry = cache.get(src);
  if (!entry) {
    evict(true);
    entry = createEntry(src, assetId);
    if (cache.size < maxEntries) {
      cache.set(src, entry);
      entry.cached = true;
    }
  } else {
    cache.delete(src);
    cache.set(src, entry);
  }
  entry.refs += 1;
  entry.lastUsed = Date.now();
  let released = false;
  return {
    release: () => {
      if (released) return;
      released = true;
      entry!.refs = Math.max(0, entry!.refs - 1);
      entry!.lastUsed = Date.now();
      if (entry!.refs === 0 && entry!.value === undefined) {
        if (cache.get(src) === entry) cache.delete(src);
        entry!.cached = false;
        dispose(entry!);
      } else if (entry!.refs === 0 && cache.get(src) !== entry) {
        entry!.cached = false;
        dispose(entry!);
      }
      evict();
    },
    result: entry.promise,
  };
}

export function clearThumbnailStripCache() {
  for (const [key, entry] of cache) {
    if (entry.refs > 0) continue;
    cache.delete(key);
    entry.cached = false;
    dispose(entry);
  }
}
