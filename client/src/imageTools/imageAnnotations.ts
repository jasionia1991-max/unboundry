import type {
  ImageAnnotationDocument,
  ImageAnnotationElement,
  ImageAnnotationPoint,
} from "../../../types/imageTools";
import { imageToolMaximums } from "../../../types/imageTools";

export const imageAnnotationMaximums = Object.freeze({
  elements: 500,
  pointsPerStroke: 2_000,
  totalPoints: 20_000,
});

function finite(value: number) {
  return Number.isFinite(value) && Math.abs(value) <= 100_000;
}

export function emptyImageAnnotationDocument(
  width: number,
  height: number,
): ImageAnnotationDocument {
  return {
    elements: [],
    height: Math.max(1, Math.round(height)),
    version: 1,
    width: Math.max(1, Math.round(width)),
  };
}

export function validateImageAnnotationDocument(
  document: ImageAnnotationDocument,
) {
  if (document.version !== 1 || !finite(document.width) ||
      !finite(document.height) || document.width < 1 || document.height < 1 ||
      document.elements.length > imageAnnotationMaximums.elements) {
    throw new Error("标注文档超出安全范围");
  }
  let totalPoints = 0;
  for (const element of document.elements) {
    if (!element.id || element.id.length > 128 || !element.color ||
        element.color.length > 32) {
      throw new Error("标注元素格式无效");
    }
    if (element.kind === "stroke") {
      totalPoints += element.points.length;
      if (element.points.length < 2 ||
          element.points.length > imageAnnotationMaximums.pointsPerStroke ||
          element.points.some((point) => !finite(point.x) || !finite(point.y))) {
        throw new Error("标注画笔路径超出安全范围");
      }
    } else if (element.kind === "text") {
      if (!element.text.trim() || element.text.length > 2_000 ||
          !finite(element.x) || !finite(element.y) ||
          !finite(element.fontSize) || element.fontSize < 6 ||
          element.fontSize > 256) {
        throw new Error("标注文字超出安全范围");
      }
    } else if (element.kind === "number") {
      if (!Number.isSafeInteger(element.value) || element.value < 1 ||
          element.value > 9_999 || !finite(element.x) || !finite(element.y)) {
        throw new Error("标注编号超出安全范围");
      }
    } else {
      const numericValues = Object.entries(element)
        .filter(([key, value]) =>
          key !== "value" && typeof value === "number"
        )
        .map(([, value]) => Number(value));
      if (numericValues.some((value) => !finite(value))) {
        throw new Error("标注几何超出安全范围");
      }
    }
  }
  if (totalPoints > imageAnnotationMaximums.totalPoints) {
    throw new Error("标注画笔点数超出安全范围");
  }
  const bytes = new TextEncoder().encode(JSON.stringify(document)).byteLength;
  if (bytes > imageToolMaximums.annotationDocumentBytes) {
    throw new Error("标注文档超过 512 KiB 安全上限");
  }
  return { bytes, document } as const;
}

function squaredDistance(point: ImageAnnotationPoint, start: ImageAnnotationPoint) {
  const dx = point.x - start.x;
  const dy = point.y - start.y;
  return dx * dx + dy * dy;
}

function segmentDistanceSquared(
  point: ImageAnnotationPoint,
  start: ImageAnnotationPoint,
  end: ImageAnnotationPoint,
) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return squaredDistance(point, start);
  const amount = Math.max(0, Math.min(1,
    ((point.x - start.x) * dx + (point.y - start.y) * dy) /
      (dx * dx + dy * dy),
  ));
  return squaredDistance(point, {
    x: start.x + amount * dx,
    y: start.y + amount * dy,
  });
}

export function simplifyAnnotationPoints(
  points: readonly ImageAnnotationPoint[],
  tolerance = 1.5,
): readonly ImageAnnotationPoint[] {
  if (points.length <= 2) return points;
  const threshold = tolerance * tolerance;
  let maximum = threshold;
  let split = -1;
  for (let index = 1; index < points.length - 1; index += 1) {
    const distance = segmentDistanceSquared(
      points[index],
      points[0],
      points[points.length - 1],
    );
    if (distance > maximum) {
      maximum = distance;
      split = index;
    }
  }
  if (split < 0) return [points[0], points[points.length - 1]];
  const left = simplifyAnnotationPoints(points.slice(0, split + 1), tolerance);
  const right = simplifyAnnotationPoints(points.slice(split), tolerance);
  return [...left.slice(0, -1), ...right];
}

export function replaceAnnotationElements(
  document: ImageAnnotationDocument,
  elements: readonly ImageAnnotationElement[],
) {
  const next = { ...document, elements };
  validateImageAnnotationDocument(next);
  return next;
}
