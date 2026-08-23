import type {
  ImageAnnotationDocument,
  ImageAnnotationElement,
} from "../../../types/imageTools";
import { imageToolMaximums } from "../../../types/imageTools";
import { resolveEditableImageSource } from "../canvas/editableImageSource";
import { validateImageAnnotationDocument } from "./imageAnnotations";

function drawArrow(
  context: CanvasRenderingContext2D,
  element: Extract<ImageAnnotationElement, { kind: "arrow" }>,
) {
  const angle = Math.atan2(element.y2 - element.y1, element.x2 - element.x1);
  const head = Math.max(12, element.strokeWidth * 4);
  context.beginPath();
  context.moveTo(element.x1, element.y1);
  context.lineTo(element.x2, element.y2);
  context.lineTo(
    element.x2 - head * Math.cos(angle - Math.PI / 6),
    element.y2 - head * Math.sin(angle - Math.PI / 6),
  );
  context.moveTo(element.x2, element.y2);
  context.lineTo(
    element.x2 - head * Math.cos(angle + Math.PI / 6),
    element.y2 - head * Math.sin(angle + Math.PI / 6),
  );
  context.stroke();
}

function drawElement(
  context: CanvasRenderingContext2D,
  element: ImageAnnotationElement,
) {
  context.save();
  context.strokeStyle = element.color;
  context.fillStyle = element.color;
  context.lineCap = "round";
  context.lineJoin = "round";
  if (element.kind === "stroke") {
    context.lineWidth = element.strokeWidth;
    context.beginPath();
    context.moveTo(element.points[0].x, element.points[0].y);
    for (const point of element.points.slice(1)) context.lineTo(point.x, point.y);
    context.stroke();
  } else if (element.kind === "rectangle") {
    context.lineWidth = element.strokeWidth;
    context.strokeRect(element.x, element.y, element.width, element.height);
  } else if (element.kind === "arrow") {
    context.lineWidth = element.strokeWidth;
    drawArrow(context, element);
  } else if (element.kind === "number") {
    context.beginPath();
    context.arc(element.x, element.y, 18, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#111111";
    context.font = "bold 22px -apple-system, BlinkMacSystemFont, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(String(element.value), element.x, element.y);
  } else {
    context.font = `600 ${element.fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
    context.textBaseline = "top";
    context.fillText(element.text, element.x, element.y);
  }
  context.restore();
}

export async function renderAnnotatedImage(input: Readonly<{
  assetId: string;
  document: ImageAnnotationDocument;
  fileName: string;
}>) {
  validateImageAnnotationDocument(input.document);
  const source = await resolveEditableImageSource(input.assetId);
  const image = new Image();
  image.decoding = "async";
  image.src = source.url;
  try {
    await image.decode();
    if (image.naturalWidth !== input.document.width ||
        image.naturalHeight !== input.document.height) {
      throw new Error("原图片尺寸已变化，请重新打开标注");
    }
    const canvas = document.createElement("canvas");
    canvas.width = input.document.width;
    canvas.height = input.document.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前浏览器无法导出标注");
    context.drawImage(image, 0, 0);
    for (const element of input.document.elements) drawElement(context, element);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (result) => result ? resolve(result) : reject(new Error("标注导出失败")),
        "image/png",
      )
    );
    if (blob.size < 1 || blob.size > imageToolMaximums.inputBytes) {
      throw new Error("标注导出结果超出安全范围");
    }
    return new File([blob], input.fileName, { type: "image/png" });
  } finally {
    source.release();
  }
}
