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

export function zoomViewportAtScreenPoint(
  viewport: Viewport,
  point: XYPosition,
  wheel: {
    deltaMode: number;
    deltaY: number;
    macOs?: boolean;
    maxZoom?: number;
    minZoom?: number;
  },
): Viewport {
  const minZoom = wheel.minZoom ?? 0.15;
  const maxZoom = wheel.maxZoom ?? 2;
  const factor = wheel.macOs ? 10 : 1;
  const delta =
    -wheel.deltaY *
    (wheel.deltaMode === 1 ? 0.05 : wheel.deltaMode ? 1 : 0.002) *
    factor;
  const zoom = Math.max(
    minZoom,
    Math.min(maxZoom, viewport.zoom * Math.pow(2, delta)),
  );
  if (zoom === viewport.zoom) return viewport;
  const world = screenToWorld(point, viewport);
  return {
    x: point.x - world.x * zoom,
    y: point.y - world.y * zoom,
    zoom,
  };
}
