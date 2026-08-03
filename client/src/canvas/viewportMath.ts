import type { Viewport, XYPosition } from "@xyflow/react";

export function screenToWorld(
  point: XYPosition,
  viewport: Viewport,
): XYPosition {
  return {
    x: (point.x - viewport.x) / viewport.zoom,
    y: (point.y - viewport.y) / viewport.zoom,
  };
}

export function worldToScreen(
  point: XYPosition,
  viewport: Viewport,
): XYPosition {
  return {
    x: point.x * viewport.zoom + viewport.x,
    y: point.y * viewport.zoom + viewport.y,
  };
}
