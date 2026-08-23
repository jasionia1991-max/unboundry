import { imageToolMaximums } from "../../../types/imageTools";

export function redrawCanvasPoint(input: Readonly<{
  canvasHeight: number;
  canvasWidth: number;
  clientX: number;
  clientY: number;
  rect: Readonly<{ height: number; left: number; top: number; width: number }>;
}>) {
  if (
    input.canvasWidth < 1 || input.canvasHeight < 1 ||
    input.rect.width <= 0 || input.rect.height <= 0
  ) throw new Error("重绘蒙版坐标不可用");
  return {
    x: Math.max(0, Math.min(
      input.canvasWidth,
      (input.clientX - input.rect.left) / input.rect.width * input.canvasWidth,
    )),
    y: Math.max(0, Math.min(
      input.canvasHeight,
      (input.clientY - input.rect.top) / input.rect.height * input.canvasHeight,
    )),
  };
}

function blurLine(
  source: Float32Array,
  target: Float32Array,
  length: number,
  lines: number,
  radius: number,
  stride: number,
) {
  const window = radius * 2 + 1;
  for (let line = 0; line < lines; line += 1) {
    const base = stride === 1 ? line * length : line;
    let sum = 0;
    for (let offset = -radius; offset <= radius; offset += 1) {
      const index = Math.max(0, Math.min(length - 1, offset));
      sum += source[base + index * stride] ?? 0;
    }
    for (let position = 0; position < length; position += 1) {
      target[base + position * stride] = sum / window;
      const leaving = Math.max(0, position - radius);
      const entering = Math.min(length - 1, position + radius + 1);
      sum += (source[base + entering * stride] ?? 0) -
        (source[base + leaving * stride] ?? 0);
    }
  }
}

function featherCoverage(
  source: Float32Array,
  width: number,
  height: number,
  radius: number,
) {
  if (radius < 1) return source;
  const horizontal = new Float32Array(source.length);
  const vertical = new Float32Array(source.length);
  blurLine(source, horizontal, width, height, radius, 1);
  blurLine(horizontal, vertical, height, width, radius, width);
  return vertical;
}

function canvasPng(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error("重绘遮罩导出失败"));
      else resolve(blob);
    }, "image/png");
  });
}

export async function createRedrawMaskFile(
  canvas: HTMLCanvasElement,
  input: Readonly<{ featherPixels: number; fileName?: string }>,
) {
  if (
    canvas.width < 1 || canvas.height < 1 ||
    canvas.width * canvas.height > imageToolMaximums.inputPixels ||
    !Number.isSafeInteger(input.featherPixels) ||
    input.featherPixels < 0 || input.featherPixels > 64
  ) throw new Error("重绘遮罩尺寸或羽化参数超出安全范围");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("浏览器无法读取重绘遮罩");
  const painted = context.getImageData(0, 0, canvas.width, canvas.height);
  const coverage = new Float32Array(canvas.width * canvas.height);
  let selected = false;
  for (let index = 0; index < coverage.length; index += 1) {
    const alpha = painted.data[index * 4 + 3] ?? 0;
    if (alpha > 0) selected = true;
    coverage[index] = Math.min(1, alpha / 128);
  }
  if (!selected) throw new Error("请先绘制需要重绘的区域");
  const feathered = featherCoverage(
    coverage,
    canvas.width,
    canvas.height,
    input.featherPixels,
  );
  const output = document.createElement("canvas");
  output.width = canvas.width;
  output.height = canvas.height;
  const outputContext = output.getContext("2d");
  if (!outputContext) throw new Error("浏览器无法生成重绘遮罩");
  const pixels = outputContext.createImageData(output.width, output.height);
  for (let index = 0; index < feathered.length; index += 1) {
    const offset = index * 4;
    pixels.data[offset] = 255;
    pixels.data[offset + 1] = 255;
    pixels.data[offset + 2] = 255;
    pixels.data[offset + 3] = Math.round(255 * (1 - (feathered[index] ?? 0)));
  }
  outputContext.putImageData(pixels, 0, 0);
  const blob = await canvasPng(output);
  if (blob.size < 1 || blob.size > imageToolMaximums.maskBytes) {
    throw new Error("重绘遮罩超过 4 MiB 安全上限");
  }
  return new File(
    [blob],
    input.fileName ?? `image-redraw-mask-${crypto.randomUUID()}.png`,
    { type: "image/png" },
  );
}
