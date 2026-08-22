import {
  seedance2ReferenceMediaRules,
  type ModelReferenceMediaRules,
} from "../types/modelParameters";
import {
  type ProviderReferenceKind as MediaKind,
  type ProviderReferenceLease,
  type ProviderReferenceLocator,
  type ProviderReferenceStore,
  ProviderReferenceStoreError,
} from "./providerReferenceStore";

export class ProviderMediaError extends Error {
  constructor(
    readonly code:
      | "MEDIA_INVALID"
      | "MEDIA_NOT_ACCESSIBLE"
      | "MEDIA_UNAVAILABLE",
    message: string,
  ) {
    super(message);
    this.name = "ProviderMediaError";
  }
}

let defaultReferenceStore: ProviderReferenceStore | undefined;

/** Composition hook; Provider code retains only the public reference port. */
export function configureProviderReferenceStore(store: ProviderReferenceStore) {
  defaultReferenceStore = store;
}

/**
 * Generic execution-time guard for tasks whose model schema does not define
 * reference-material rules. Format and size only; duration is model-specific.
 */
export const genericReferenceMediaRules: ModelReferenceMediaRules = {
  audio: {
    contentTypes: ["audio/aac", "audio/mp4", "audio/mpeg", "audio/wav"],
    maxBytes: 50 * 1024 * 1024,
  },
  image: {
    contentTypes: ["image/png"],
    maxBytes: 20 * 1024 * 1024,
  },
  video: {
    contentTypes: ["video/mp4"],
    maxBytes: 500 * 1024 * 1024,
  },
};

export const arkVideoMediaRules = seedance2ReferenceMediaRules;

export const arkVideoBase64BudgetBytes = 64 * 1_024 * 1_024;
export function arkVideoBase64EnvelopeBytes(prompt: string) {
  // Reserve JSON keys, roles and safety headroom before any local file is read.
  // The adapter still checks the exact serialized request immediately before fetch.
  return 32 * 1_024 + Buffer.byteLength(prompt, "utf8");
}

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

type ProviderMediaMetadata = Readonly<{
  byteSize: number;
  checksumSha256: string;
  contentType: string;
  durationSeconds?: number | null;
  durationSource?: "provider-task" | "server-probe" | null;
  durationStatus?: "failed" | "not-applicable" | "pending" | "ready";
  locator?: ProviderReferenceLocator;
  mediaHeight?: number | null;
  mediaWidth?: number | null;
  storageBackend?: "local" | "oss";
}>;

export type ArkVideoMediaRecord = {
  kind: MediaKind;
  media: ProviderMediaMetadata;
};

export function arkVideoBase64Bytes(
  kind: MediaKind,
  media: ProviderMediaMetadata,
) {
  const inline = media.locator
    ? media.locator.transport === "inline-data"
    : media.storageBackend === "local";
  if (!inline || kind === "video") return 0;
  const prefix = kind === "image"
    ? "data:image/png;base64,"
    : media.contentType === "audio/wav"
      ? "data:audio/wav;base64,"
      : "data:audio/mp3;base64,";
  return Buffer.byteLength(prefix, "ascii") + Math.ceil(media.byteSize / 3) * 4;
}

export function assertArkVideoBase64Budget(
  inputs: ArkVideoMediaRecord[],
  envelopeBytes = 0,
) {
  let total = envelopeBytes;
  for (const input of inputs) {
    total += arkVideoBase64Bytes(input.kind, input.media);
    if (total > arkVideoBase64BudgetBytes) {
      throw new ProviderMediaError(
        "MEDIA_INVALID",
        "本机图片和音频转为Base64后的总大小不得超过64MB",
      );
    }
  }
  return total;
}

function mediaFormatLabel(contentType: string) {
  if (contentType === "audio/mpeg") return "MP3";
  if (contentType === "audio/wav") return "WAV";
  if (contentType === "video/mp4") return "MP4";
  if (contentType === "image/png") return "PNG";
  return contentType;
}

export function arkVideoMediaProblem(
  kind: MediaKind,
  media: ProviderMediaMetadata,
  rules: ModelReferenceMediaRules = arkVideoMediaRules,
) {
  const rule = rules[kind];
  if (
    !Number.isSafeInteger(media.byteSize) ||
    media.byteSize < 1 ||
    !/^[a-f0-9]{64}$/i.test(media.checksumSha256)
  ) {
    return "参考素材的大小或校验信息无效";
  }
  if (!rule) return undefined;
  if (!rule.contentTypes.includes(media.contentType)) {
    return kind === "audio"
      ? `参考音频仅支持${rule.contentTypes.map(mediaFormatLabel).join("或")}格式`
      : "参考素材的文件类型不受当前视频模型支持";
  }
  if (media.byteSize > rule.maxBytes) {
    return kind === "video"
      ? `单个参考视频不得超过${Math.round(rule.maxBytes / (1024 * 1024))}MB`
      : kind === "audio"
        ? `单个参考音频不得超过${Math.round(rule.maxBytes / (1024 * 1024))}MB`
        : "单张参考图片超过本项目安全上限";
  }
  const dimensionFields = [
    rule.maxAspectRatio,
    rule.maxHeight,
    rule.maxPixelCount,
    rule.maxWidth,
    rule.minAspectRatio,
    rule.minHeight,
    rule.minPixelCount,
    rule.minWidth,
  ];
  if (dimensionFields.some((value) => value !== undefined)) {
    const label = kind === "video" ? "参考视频" : "参考图片";
    if (
      !Number.isSafeInteger(media.mediaWidth) ||
      !Number.isSafeInteger(media.mediaHeight) ||
      media.mediaWidth! < 1 ||
      media.mediaHeight! < 1
    ) {
      return `${label}分辨率尚未经过服务端校验，请重新上传`;
    }
    const width = media.mediaWidth!;
    const height = media.mediaHeight!;
    if (rule.minWidth !== undefined && width < rule.minWidth) {
      return `${label}宽度需至少${rule.minWidth}px`;
    }
    if (rule.maxWidth !== undefined && width > rule.maxWidth) {
      return `${label}宽度需不超过${rule.maxWidth}px`;
    }
    if (rule.minHeight !== undefined && height < rule.minHeight) {
      return `${label}高度需至少${rule.minHeight}px`;
    }
    if (rule.maxHeight !== undefined && height > rule.maxHeight) {
      return `${label}高度需不超过${rule.maxHeight}px`;
    }
    const pixels = width * height;
    if (rule.minPixelCount !== undefined && pixels < rule.minPixelCount) {
      return kind === "video"
        ? `参考视频分辨率过低，总像素需至少${rule.minPixelCount}（例如640×640或1280×720）`
        : `${label}总像素需至少${rule.minPixelCount}`;
    }
    if (rule.maxPixelCount !== undefined && pixels > rule.maxPixelCount) {
      return `${label}总像素需不超过${rule.maxPixelCount}`;
    }
    const aspectRatio = width / height;
    if (rule.minAspectRatio !== undefined && aspectRatio < rule.minAspectRatio) {
      return `${label}宽高比需至少${rule.minAspectRatio}`;
    }
    if (rule.maxAspectRatio !== undefined && aspectRatio > rule.maxAspectRatio) {
      return `${label}宽高比需不超过${rule.maxAspectRatio}`;
    }
  }
  if (kind === "image") return undefined;
  if (
    rule.minDurationSeconds === undefined &&
    rule.maxDurationSeconds === undefined
  ) {
    return undefined;
  }
  if (
    media.durationStatus !== "ready" ||
    !media.durationSource ||
    !Number.isFinite(media.durationSeconds)
  ) {
    return kind === "video"
      ? "参考视频时长尚未经过服务端校验，请重新上传"
      : "参考音频时长尚未经过服务端校验，请重新上传";
  }
  const minimum = rule.minDurationSeconds ?? 0;
  const maximum = rule.maxDurationSeconds ?? Number.POSITIVE_INFINITY;
  if (media.durationSeconds! < minimum || media.durationSeconds! > maximum) {
    const label = rule.minDurationSeconds !== undefined &&
        rule.maxDurationSeconds !== undefined
      ? `${rule.minDurationSeconds}至${rule.maxDurationSeconds}秒之间`
      : rule.minDurationSeconds !== undefined
        ? `至少${rule.minDurationSeconds}秒`
        : `不超过${rule.maxDurationSeconds}秒`;
    return kind === "video"
      ? `单个参考视频时长必须在${label}`
      : `单个参考音频时长必须在${label}`;
  }
}

export function assertArkVideoMediaCombination(
  inputs: ArkVideoMediaRecord[],
  rules: ModelReferenceMediaRules = arkVideoMediaRules,
) {
  let audioDuration = 0;
  let videoDuration = 0;
  let visualReferences = 0;
  for (const input of inputs) {
    const problem = arkVideoMediaProblem(input.kind, input.media, rules);
    if (problem) throw new ProviderMediaError("MEDIA_INVALID", problem);
    if (input.kind === "image") visualReferences += 1;
    if (input.kind === "video") {
      visualReferences += 1;
      videoDuration += input.media.durationSeconds!;
    }
    if (input.kind === "audio") audioDuration += input.media.durationSeconds!;
  }
  const videoTotalMaximum = rules.video?.maxTotalDurationSeconds;
  if (
    videoTotalMaximum !== undefined &&
    videoDuration > videoTotalMaximum
  ) {
    throw new ProviderMediaError(
      "MEDIA_INVALID",
      `所有参考视频的总时长不得超过${videoTotalMaximum}秒`,
    );
  }
  const audioTotalMaximum = rules.audio?.maxTotalDurationSeconds;
  if (
    audioTotalMaximum !== undefined &&
    audioDuration > audioTotalMaximum
  ) {
    throw new ProviderMediaError(
      "MEDIA_INVALID",
      `所有参考音频的总时长不得超过${audioTotalMaximum}秒`,
    );
  }
  if (
    rules.audioRequiresVisual === true &&
    audioDuration > 0 &&
    visualReferences === 0
  ) {
    throw new ProviderMediaError(
      "MEDIA_INVALID",
      "参考音频不能单独用于当前视频模型，请至少再连接一个图片或视频",
    );
  }
}

function validateHeader(kind: MediaKind, contentType: string, header: Buffer) {
  if (kind === "image") {
    if (header.length < pngSignature.length || !header.subarray(0, 8).equals(pngSignature)) {
      throw new ProviderMediaError("MEDIA_INVALID", "参考图片内容无效");
    }
    return;
  }
  if (kind === "video") {
    if (header.length < 12 || header.toString("ascii", 4, 8) !== "ftyp") {
      throw new ProviderMediaError("MEDIA_INVALID", "参考视频内容无效");
    }
    return;
  }
  const valid = contentType === "audio/wav"
    ? header.length >= 12 &&
      header.toString("ascii", 0, 4) === "RIFF" &&
      header.toString("ascii", 8, 12) === "WAVE"
    : contentType === "audio/mp4"
      ? header.length >= 12 && header.toString("ascii", 4, 8) === "ftyp"
      : contentType === "audio/aac"
        ? header.length >= 7 && header[0] === 0xff && (header[1] & 0xf6) === 0xf0
        : header.length >= 4 && (
          header.toString("ascii", 0, 3) === "ID3" ||
          (header[0] === 0xff && (header[1] & 0xe0) === 0xe0)
        );
  if (!valid) {
    throw new ProviderMediaError("MEDIA_INVALID", "参考音频内容无效");
  }
}

/**
 * Resolve a durable asset id through the Media-owned reference port. The
 * caller owns the lease through the Provider boundary and must release it.
 */
export async function providerMediaReferenceForOwner(input: {
  assetId: string;
  kind: MediaKind;
  ownerId: string;
}, options: {
  rules?: ModelReferenceMediaRules;
  signal?: AbortSignal;
  store: ProviderReferenceStore;
}) {
  const rules = options.rules ?? arkVideoMediaRules;
  let reference: ProviderReferenceLease;
  try {
    reference = await options.store.acquire({
      assetId: input.assetId,
      kind: input.kind,
      maximumBytes: rules[input.kind]?.maxBytes ??
        genericReferenceMediaRules[input.kind]!.maxBytes,
      ownerId: input.ownerId,
      preferredTransports: ["signed-url", "inline-data"],
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof ProviderReferenceStoreError) {
      const code = error.code === "INVALID"
        ? "MEDIA_INVALID"
        : error.code === "NOT_ACCESSIBLE"
          ? "MEDIA_NOT_ACCESSIBLE"
          : "MEDIA_UNAVAILABLE";
      throw new ProviderMediaError(code, error.message);
    }
    throw error;
  }
  const problem = arkVideoMediaProblem(input.kind, reference, rules);
  if (problem) {
    await options.store.release(reference).catch(() => undefined);
    throw new ProviderMediaError("MEDIA_INVALID", problem);
  }
  if (reference.locator.transport === "inline-data") {
    const comma = reference.locator.dataUrl.indexOf(",");
    const bytes = comma < 0
      ? Buffer.alloc(0)
      : Buffer.from(reference.locator.dataUrl.slice(comma + 1), "base64");
    try {
      validateHeader(input.kind, reference.contentType, bytes.subarray(0, 64));
    } catch (error) {
      await options.store.release(reference).catch(() => undefined);
      throw error;
    }
  }
  return reference;
}

/**
 * Compatibility helper for Provider payload builders. Inline data and signed
 * URLs remain valid after the durable-asset lease is released.
 */
export async function providerMediaUrlForOwner(input: {
  assetId: string;
  kind: MediaKind;
  ownerId: string;
}, options: {
  rules?: ModelReferenceMediaRules;
  signal?: AbortSignal;
  store?: ProviderReferenceStore;
} = {}) {
  const store = options.store ?? defaultReferenceStore;
  if (!store) {
    throw new ProviderMediaError(
      "MEDIA_UNAVAILABLE",
      "参考素材读取服务尚未就绪",
    );
  }
  const reference = await providerMediaReferenceForOwner(input, {
    ...options,
    store,
  });
  try {
    return reference.locator.transport === "signed-url"
      ? reference.locator.url
      : reference.locator.transport === "inline-data"
        ? reference.locator.dataUrl
        : reference.locator.fileId;
  } finally {
    await store.release(reference).catch(() => undefined);
  }
}
