type MediaNodeKind = "audio" | "image" | "video";

const sourceKeys = {
  audio: "audioSrc",
  image: "imageSrc",
  video: "videoSrc",
} as const;

const sourcePrefixes = {
  audio: "/api/audio-assets/",
  image: "/api/assets/",
  video: "/api/video-assets/",
} as const;

const expiredPreviewReasons = {
  audio: "旧本地预览已失效，请重新上传原音频",
  image: "旧本地预览已失效，请重新上传原图（PNG、JPEG、WebP或GIF）",
  video: "旧本地预览已失效，请重新上传原视频",
} as const;

const interruptedUploadReasons = {
  audio: "音频上传已中断，请重新上传原音频",
  image: "图片上传已中断，请重新上传原图（PNG、JPEG、WebP或GIF）",
  video: "视频上传已中断，请重新上传原视频",
} as const;

const mediaSourceKeys = Object.values(sourceKeys);
const generationErrorKeys = [
  "textGenerationError",
  "imageGenerationError",
  "videoGenerationError",
  "audioGenerationError",
] as const;
const obsoletePreTaskConfigurationErrors = new Set([
  "Generation provider is not configured",
]);

function mediaNodeKind(value: unknown): value is MediaNodeKind {
  return value === "audio" || value === "image" || value === "video";
}

export type PersistedMediaReference = Readonly<{
  assetId: string;
  kind: MediaNodeKind;
}>;

/** Only top-level durable media nodes can adopt an upload publication. */
export function persistedMediaReferences(
  nodes: readonly unknown[],
): PersistedMediaReference[] {
  const references = new Map<string, PersistedMediaReference>();
  for (const raw of nodes) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const node = raw as Record<string, unknown>;
    if (!mediaNodeKind(node.type)) continue;
    if (!node.data || typeof node.data !== "object" || Array.isArray(node.data)) {
      continue;
    }
    const value = (node.data as Record<string, unknown>).assetId;
    const assetId = typeof value === "string" ? value.trim() : "";
    if (!assetId || assetId.length > 120 || !/^[a-z0-9._-]+$/i.test(assetId)) {
      continue;
    }
    references.set(`${node.type}\0${assetId}`, {
      assetId,
      kind: node.type,
    });
  }
  return [...references.values()];
}

function isTemporaryOrRemoteSource(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^(?:blob:|data:|https?:\/\/)/i.test(value.trim())
  );
}

function sanitizePlaylistClips(data: Record<string, unknown>) {
  if (!Array.isArray(data.playlistClips)) return data;
  const clips = data.playlistClips.filter((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
    const source = (raw as Record<string, unknown>).src;
    return (
      typeof source === "string" &&
      source.trim().length > 0 &&
      !isTemporaryOrRemoteSource(source)
    );
  });
  return clips.length === data.playlistClips.length
    ? data
    : { ...data, playlistClips: clips };
}

function sanitizeLegacyGenerationErrors(data: Record<string, unknown>) {
  let next = data;
  for (const key of generationErrorKeys) {
    const value = data[key];
    if (
      typeof value !== "string" ||
      !obsoletePreTaskConfigurationErrors.has(value.trim())
    ) continue;
    if (next === data) next = { ...data };
    delete next[key];
  }
  return next;
}

/**
 * Canvas documents store durable asset identities, never browser blob URLs or
 * short-lived object-storage URLs. Browser hydration and server writes share
 * this rule so the two sides cannot drift.
 */
export function normalizePersistedMediaNodes<T>(nodes: readonly T[]): T[] {
  return nodes.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
    const node = raw as Record<string, unknown>;
    if (!node.data || typeof node.data !== "object" || Array.isArray(node.data)) {
      return raw;
    }

    const originalData = node.data as Record<string, unknown>;
    let data = sanitizePlaylistClips(sanitizeLegacyGenerationErrors(originalData));
    const setData = (key: string, value: unknown) => {
      if (data[key] === value) return;
      data = { ...data, [key]: value };
    };
    const removeData = (key: string) => {
      if (!Object.prototype.hasOwnProperty.call(data, key)) return;
      const next = { ...data };
      delete next[key];
      data = next;
    };

    if (!mediaNodeKind(node.type)) {
      return data === originalData ? raw : ({ ...node, data } as T);
    }

    const kind = node.type;
    const sourceKey = sourceKeys[kind];
    for (const key of mediaSourceKeys) {
      if (key !== sourceKey) removeData(key);
    }

    const source = data[sourceKey];
    const assetId = typeof data.assetId === "string"
      ? data.assetId.trim()
      : "";

    if (assetId) {
      const durableSource = `${sourcePrefixes[kind]}${encodeURIComponent(assetId)}`;
      setData(sourceKey, durableSource);
      if (data.inputState === "uploading") {
        setData("inputState", "ready");
        removeData("inputStateReason");
      }
      return data === originalData ? raw : ({ ...node, data } as T);
    }

    if (data.inputState === "uploading") {
      const hasDurableSource =
        typeof source === "string" &&
        source.trim().length > 0 &&
        !isTemporaryOrRemoteSource(source);
      if (hasDurableSource) {
        setData("inputState", "ready");
        removeData("inputStateReason");
      } else {
        removeData(sourceKey);
        setData("inputState", "invalid");
        setData("inputStateReason", interruptedUploadReasons[kind]);
      }
      return data === originalData ? raw : ({ ...node, data } as T);
    }

    if (isTemporaryOrRemoteSource(source)) {
      removeData(sourceKey);
      setData("inputState", "invalid");
      setData("inputStateReason", expiredPreviewReasons[kind]);
    }

    return data === originalData ? raw : ({ ...node, data } as T);
  });
}
