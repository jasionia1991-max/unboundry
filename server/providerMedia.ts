import { createHash } from "node:crypto";
import { basename, join } from "node:path";
import { open, readFile, stat } from "node:fs/promises";
import {
  seedance2ReferenceMediaRules,
  type ModelReferenceMediaRules,
} from "../types/modelParameters";
import { createPrivateAliyunOssReadUrl } from "./aliyunOss";
import {
  readableMediaForOwner,
  type MediaKind,
  type MediaRecord,
} from "./mediaRegistry";
import { storageProfileForMedia } from "./secureStorageProfiles";

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

export type ArkVideoMediaRecord = {
  kind: MediaKind;
  media: MediaRecord;
};

export function arkVideoBase64Bytes(kind: MediaKind, media: MediaRecord) {
  if (media.storageBackend !== "local" || kind === "video") return 0;
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
  media: MediaRecord,
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

export function arkVideoMediaRecordForOwner(input: {
  assetId: string;
  kind: MediaKind;
  ownerId: string;
}, rules: ModelReferenceMediaRules = arkVideoMediaRules) {
  if (
    !/^[a-z0-9._-]{1,160}$/i.test(input.assetId) ||
    !/^[a-z0-9._-]{1,160}$/i.test(input.ownerId)
  ) {
    throw new ProviderMediaError("MEDIA_INVALID", "参考素材编号无效");
  }
  const media = readableMediaForOwner(input.ownerId, input.kind, input.assetId);
  if (!media || media.storageStatus !== "ready") {
    throw new ProviderMediaError(
      "MEDIA_UNAVAILABLE",
      "参考素材不存在、尚未保存或不属于当前账号",
    );
  }
  const problem = arkVideoMediaProblem(input.kind, media, rules);
  if (problem) throw new ProviderMediaError("MEDIA_INVALID", problem);
  return media;
}

function localMediaPath(storageName: string) {
  if (basename(storageName) !== storageName) {
    throw new ProviderMediaError("MEDIA_INVALID", "参考素材的本机路径无效");
  }
  return join(
    process.env.UNBOUNDRY_DATA_DIR ?? join(process.cwd(), "data"),
    "media",
    storageName,
  );
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

async function verifyLocalHeader(input: {
  byteSize: number;
  contentType: string;
  filePath: string;
  kind: MediaKind;
}) {
  const info = await stat(input.filePath).catch(() => undefined);
  if (!info?.isFile() || info.size !== input.byteSize) {
    throw new ProviderMediaError("MEDIA_INVALID", "参考素材文件不完整");
  }
  const handle = await open(input.filePath, "r").catch(() => undefined);
  if (!handle) {
    throw new ProviderMediaError("MEDIA_UNAVAILABLE", "参考素材暂时无法读取");
  }
  try {
    const header = Buffer.alloc(Math.min(64, input.byteSize));
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    validateHeader(input.kind, input.contentType, header.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

/**
 * Resolve a durable asset id to a Provider-readable value at execution time.
 * The returned short-lived URL/data value must never be written to a task row.
 */
export async function providerMediaUrlForOwner(input: {
  assetId: string;
  kind: MediaKind;
  ownerId: string;
}, options: { rules?: ModelReferenceMediaRules } = {}) {
  const media = arkVideoMediaRecordForOwner(input, options.rules);

  if (media.storageBackend === "oss") {
    const profile = await storageProfileForMedia(media);
    if (!profile) {
      throw new ProviderMediaError("MEDIA_UNAVAILABLE", "参考素材的云端存储暂不可用");
    }
    try {
      return await createPrivateAliyunOssReadUrl(media.objectKey, profile, 300);
    } catch {
      throw new ProviderMediaError("MEDIA_UNAVAILABLE", "参考素材暂时无法安全读取");
    }
  }

  const filePath = localMediaPath(media.storageName);
  await verifyLocalHeader({
    byteSize: media.byteSize,
    contentType: media.contentType,
    filePath,
    kind: input.kind,
  });
  if (input.kind === "video") {
    throw new ProviderMediaError(
      "MEDIA_NOT_ACCESSIBLE",
      "本机视频素材无法安全交给当前视频模型，请先使用私有云端素材",
    );
  }

  const bytes = await readFile(filePath);
  if (
    bytes.length !== media.byteSize ||
    createHash("sha256").update(bytes).digest("hex") !== media.checksumSha256
  ) {
    throw new ProviderMediaError("MEDIA_INVALID", "参考素材校验失败");
  }
  validateHeader(input.kind, media.contentType, bytes.subarray(0, 64));
  if (input.kind === "image") {
    return `data:image/png;base64,${bytes.toString("base64")}`;
  }
  const format = media.contentType === "audio/wav" ? "wav" : "mp3";
  return `data:audio/${format};base64,${bytes.toString("base64")}`;
}
