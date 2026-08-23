import { resolveEditableImageSource } from "../canvas/editableImageSource";
import { imageToolMaximums } from "../../../types/imageTools";

export const localImageDimensionLimit = 8_192;

async function decodedImage(assetId: string) {
  const source = await resolveEditableImageSource(assetId);
  const image = new Image();
  image.decoding = "async";
  image.src = source.url;
  try {
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight ||
        image.naturalWidth * image.naturalHeight > imageToolMaximums.inputPixels) {
      throw new Error("图片像素尺寸超出安全范围");
    }
    return { image, release: source.release };
  } catch (error) {
    source.release();
    throw error;
  }
}

function validDimension(value: number) {
  return Number.isSafeInteger(value) && value >= 1 &&
    value <= localImageDimensionLimit;
}

async function pngFile(canvas: HTMLCanvasElement, fileName: string) {
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (result) => result ? resolve(result) : reject(new Error("图片处理失败")),
      "image/png",
    )
  );
  if (blob.size < 1 || blob.size > imageToolMaximums.inputBytes) {
    throw new Error("处理后的图片大小超出安全范围");
  }
  return new File([blob], fileName, { type: "image/png" });
}

export async function resizeLocalImage(input: Readonly<{
  assetId: string;
  fileName: string;
  height: number;
  width: number;
}>) {
  if (!validDimension(input.width) || !validDimension(input.height) ||
      input.width * input.height > imageToolMaximums.inputPixels) {
    throw new Error("请输入安全范围内的宽高");
  }
  const decoded = await decodedImage(input.assetId);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = input.width;
    canvas.height = input.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前浏览器无法处理图片");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(decoded.image, 0, 0, input.width, input.height);
    return pngFile(canvas, input.fileName);
  } finally {
    decoded.release();
  }
}

export async function splitLocalImage(input: Readonly<{
  assetId: string;
  fileNamePrefix: string;
  grid: 2 | 3 | 4;
}>) {
  const decoded = await decodedImage(input.assetId);
  try {
    const files: File[] = [];
    for (let row = 0; row < input.grid; row += 1) {
      const sourceY = Math.round(row * decoded.image.naturalHeight / input.grid);
      const sourceBottom = Math.round(
        (row + 1) * decoded.image.naturalHeight / input.grid,
      );
      for (let column = 0; column < input.grid; column += 1) {
        const sourceX = Math.round(
          column * decoded.image.naturalWidth / input.grid,
        );
        const sourceRight = Math.round(
          (column + 1) * decoded.image.naturalWidth / input.grid,
        );
        const width = sourceRight - sourceX;
        const height = sourceBottom - sourceY;
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("当前浏览器无法处理图片");
        context.drawImage(
          decoded.image,
          sourceX,
          sourceY,
          width,
          height,
          0,
          0,
          width,
          height,
        );
        files.push(await pngFile(
          canvas,
          `${input.fileNamePrefix}-${row + 1}-${column + 1}.png`,
        ));
      }
    }
    return files;
  } finally {
    decoded.release();
  }
}
