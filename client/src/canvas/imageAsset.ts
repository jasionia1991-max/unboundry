import {
  fetchTrustedMediaMetadata,
  hasTrustedMediaDimensions,
} from "./mediaInputMetadata";

export type ImageAsset = {
  assetId: string;
  byteSize: number;
  contentType: "image/png";
  fileName: string;
  hasTransparency: boolean;
  height: number;
  mediaHeight?: number;
  mediaWidth?: number;
  storageBackend: "local" | "oss";
  url: string;
  width: number;
};

const maximumImageBytes = 20 * 1024 * 1024;
const maximumImagePixels = 40_000_000;
const acceptedImageTypes = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

type DecodedImage = {
  close: () => void;
  height: number;
  source: CanvasImageSource;
  width: number;
};

async function decodeImage(file: File): Promise<DecodedImage> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, {
        imageOrientation: "from-image",
      });
      return {
        close: () => bitmap.close(),
        height: bitmap.height,
        source: bitmap,
        width: bitmap.width,
      };
    } catch {
      // Some WebKit versions cannot decode every supported type through
      // createImageBitmap. Fall back to the browser image decoder, but never
      // turn an undecodable file into a blob-only node.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    return {
      close: () => URL.revokeObjectURL(url),
      height: image.naturalHeight,
      source: image,
      width: image.naturalWidth,
    };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error("图片无法解码，请换一张PNG、JPEG、WebP或GIF图片");
  }
}

function canvasPng(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("图片转换失败，请换一张图片重试"));
        return;
      }
      resolve(blob);
    }, "image/png");
  });
}

async function imageFileHasTransparency(file: File) {
  const decoded = await decodeImage(file);
  try {
    if (
      !decoded.width ||
      !decoded.height ||
      decoded.width * decoded.height > maximumImagePixels
    ) {
      throw new Error("图片尺寸过大，请缩小后重试");
    }
    const canvas = document.createElement("canvas");
    canvas.width = decoded.width;
    canvas.height = decoded.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("当前浏览器无法处理这张图片");
    context.drawImage(decoded.source, 0, 0, decoded.width, decoded.height);
    const rowsPerRead = 128;
    for (let y = 0; y < decoded.height; y += rowsPerRead) {
      const height = Math.min(rowsPerRead, decoded.height - y);
      const pixels = context.getImageData(0, y, decoded.width, height).data;
      for (let offset = 3; offset < pixels.length; offset += 4) {
        if (pixels[offset] < 255) return true;
      }
    }
    return false;
  } finally {
    decoded.close();
  }
}

export async function normalizeImageToPng(file: File): Promise<File> {
  if (!acceptedImageTypes.has(file.type)) {
    throw new Error("仅支持PNG、JPEG、WebP或GIF图片");
  }
  if (!file.size || file.size > maximumImageBytes) {
    throw new Error("请选择20MB以内的图片");
  }

  const decoded = await decodeImage(file);
  try {
    if (
      !decoded.width ||
      !decoded.height ||
      decoded.width * decoded.height > maximumImagePixels
    ) {
      throw new Error("图片尺寸过大，请缩小后重试");
    }
    const canvas = document.createElement("canvas");
    canvas.width = decoded.width;
    canvas.height = decoded.height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("当前浏览器无法处理这张图片");
    }
    // Drawing a decoded bitmap strips source metadata and animation. GIF and
    // APNG uploads therefore become the single static frame used by the node.
    context.drawImage(decoded.source, 0, 0, decoded.width, decoded.height);
    const blob = await canvasPng(canvas);
    if (blob.size > maximumImageBytes) {
      throw new Error("转换后的PNG超过20MB，请压缩后重试");
    }
    const baseName = file.name.replace(/\.[^.]+$/, "") || "Image";
    return new File([blob], `${baseName}.png`, { type: "image/png" });
  } finally {
    decoded.close();
  }
}

export async function uploadPngAsset(file: File): Promise<ImageAsset> {
  if (file.type !== "image/png" || file.size > maximumImageBytes) {
    throw new Error("请选择20MB以内的PNG图片");
  }

  const hasTransparency = await imageFileHasTransparency(file);
  const requestedAssetId = crypto.randomUUID();
  let shouldCompensate = true;
  try {
    const response = await fetch(`/api/assets/${requestedAssetId}`, {
      body: file,
      headers: {
        "Content-Type": file.type,
        "X-File-Name": encodeURIComponent(file.name),
      },
      method: "POST",
    });
    if (response.status === 409) shouldCompensate = false;
    const asset = await response.json() as ImageAsset & {
      error?: string;
    };
    if (!response.ok) {
      throw new Error(asset.error ?? "上传失败");
    }
    if (asset.assetId !== requestedAssetId) {
      throw new Error("服务端返回的图片素材标识不一致");
    }
    if (hasTrustedMediaDimensions(asset)) return { ...asset, hasTransparency };

    const metadata = await fetchTrustedMediaMetadata("image", requestedAssetId);
    if (!hasTrustedMediaDimensions(metadata)) {
      throw new Error("服务端返回的图片尺寸未经可信校验");
    }
    return {
      ...asset,
      hasTransparency,
      mediaHeight: metadata.mediaHeight,
      mediaWidth: metadata.mediaWidth,
    };
  } catch (error) {
    // The request id is known before the POST. If the server committed but the
    // browser lost the response, this exact-id DELETE prevents a ready orphan.
    // An observable HTTP 409 is the server's reservation no-clobber result, so
    // the id may belong to an earlier asset even when its body is unreadable.
    // Every other failure is ambiguous and must compensate the fresh request id.
    if (shouldCompensate) await discardImageAsset(requestedAssetId);
    throw error;
  }
}

export async function discardImageAsset(assetId: string) {
  try {
    await fetch(`/api/assets/${encodeURIComponent(assetId)}`, {
      method: "DELETE",
    });
  } catch {
    // A fresh upload that was never adopted must stay detached even when the
    // best-effort cleanup request is temporarily unavailable.
  }
}

export async function uploadImageAsset(
  file: File,
  onNormalized?: (file: File) => void,
): Promise<ImageAsset> {
  const normalized = await normalizeImageToPng(file);
  onNormalized?.(normalized);
  return uploadPngAsset(normalized);
}
