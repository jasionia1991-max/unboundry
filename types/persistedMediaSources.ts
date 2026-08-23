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

function validAssetId(value: string) {
  return value.length <= 120 && /^[a-z0-9._-]+$/i.test(value);
}

function durableAssetId(source: string, prefix: string) {
  const normalized = source.trim();
  if (!normalized.startsWith(prefix)) return undefined;
  const encoded = normalized.slice(prefix.length);
  if (!encoded || /[/?#]/.test(encoded)) {
    throw new Error("Invalid persisted media reference");
  }
  let assetId = "";
  try {
    assetId = decodeURIComponent(encoded).trim();
  } catch {
    throw new Error("Invalid persisted media reference");
  }
  if (!assetId || !validAssetId(assetId)) {
    throw new Error("Invalid persisted media reference");
  }
  return assetId;
}

/**
 * Resolve a canonical, durable media API path. Other URLs and static paths are
 * intentionally left alone, while malformed paths for these three endpoints
 * fail closed so callers cannot silently lose a durable reference.
 */
export function persistedMediaReferenceFromSource(
  source: string,
): PersistedMediaReference | undefined {
  const normalized = source.trim();
  for (const kind of ["audio", "image", "video"] as const) {
    const prefix = sourcePrefixes[kind];
    if (!normalized.startsWith(prefix)) continue;
    const assetId = durableAssetId(normalized, prefix);
    if (!assetId) throw new Error("Invalid persisted media reference");
    return { assetId, kind };
  }
  if (/^\/api\/(?:audio-assets|video-assets|assets)(?:\/|$)/.test(normalized)) {
    throw new Error("Invalid persisted media reference");
  }
  return undefined;
}

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
    if (assetId && validAssetId(assetId)) {
      references.set(`${node.type}\0${assetId}`, {
        assetId,
        kind: node.type,
      });
    }
    if (node.type === "image") {
      const rawMaskAssetId = (node.data as Record<string, unknown>)
        .imageToolMaskAssetId;
      const maskAssetId = typeof rawMaskAssetId === "string"
        ? rawMaskAssetId.trim()
        : "";
      if (maskAssetId && validAssetId(maskAssetId)) {
        references.set(`image\0${maskAssetId}`, {
          assetId: maskAssetId,
          kind: "image",
        });
      }
    }
  }
  return [...references.values()];
}

/**
 * Public templates retain playlist clips as durable video API paths instead of
 * top-level asset IDs. Account deletion uses this wider reference set when it
 * transfers a public template; canvas upload adoption must keep using
 * persistedMediaReferences so playlist clips do not become adoption roots.
 */
export function persistedTemplateMediaReferences(
  nodes: readonly unknown[],
): PersistedMediaReference[] {
  const references = new Map(
    persistedMediaReferences(nodes).map((reference) => [
      `${reference.kind}\0${reference.assetId}`,
      reference,
    ]),
  );
  for (const raw of nodes) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const node = raw as Record<string, unknown>;
    if (mediaNodeKind(node.type)) {
      if (!node.data || typeof node.data !== "object" || Array.isArray(node.data)) {
        throw new Error("Invalid persisted media reference");
      }
      const data = node.data as Record<string, unknown>;
      const rawAssetId = data.assetId;
      const assetId = typeof rawAssetId === "string" ? rawAssetId.trim() : "";
      if (
        rawAssetId !== undefined &&
        (typeof rawAssetId !== "string" || assetId && !validAssetId(assetId))
      ) {
        throw new Error("Invalid persisted media reference");
      }
      const source = data[sourceKeys[node.type]];
      if (typeof source === "string") {
        const sourceAssetId = durableAssetId(source, sourcePrefixes[node.type]);
        if (sourceAssetId) {
          if (assetId && assetId !== sourceAssetId) {
            throw new Error("Conflicting persisted media reference");
          }
          references.set(`${node.type}\0${sourceAssetId}`, {
            assetId: sourceAssetId,
            kind: node.type,
          });
        } else if (/^\/api\/(?:audio-assets|video-assets|assets)\//.test(source.trim())) {
          throw new Error("Mismatched persisted media reference");
        }
      }
    }
    if (node.type !== "playlist") continue;
    if (!node.data || typeof node.data !== "object" || Array.isArray(node.data)) {
      continue;
    }
    const clips = (node.data as Record<string, unknown>).playlistClips;
    if (clips === undefined) continue;
    if (!Array.isArray(clips)) {
      throw new Error("Invalid persisted playlist media references");
    }
    for (const rawClip of clips) {
      if (!rawClip || typeof rawClip !== "object" || Array.isArray(rawClip)) {
        throw new Error("Invalid persisted playlist media references");
      }
      const source = (rawClip as Record<string, unknown>).src;
      if (typeof source !== "string") continue;
      const assetId = durableAssetId(source, sourcePrefixes.video);
      if (!assetId) continue;
      references.set(`video\0${assetId}`, { assetId, kind: "video" });
    }
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
