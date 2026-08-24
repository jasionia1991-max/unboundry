import type { ProbeNodeType } from "../canvas/ProbeNode";

type Point = Readonly<{ x: number; y: number }>;
type Rect = Point & Readonly<{ height: number; width: number }>;

const defaultNodeSize = Object.freeze({ height: 250, width: 250 });

function finiteDimension(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function nodeSize(node: ProbeNodeType) {
  const styleHeight = finiteDimension(node.style?.height, defaultNodeSize.height);
  const styleWidth = finiteDimension(node.style?.width, defaultNodeSize.width);
  return {
    height: finiteDimension(node.measured?.height, styleHeight),
    width: finiteDimension(node.measured?.width, styleWidth),
  };
}

function absoluteNodePosition(
  node: ProbeNodeType,
  nodesById: ReadonlyMap<string, ProbeNodeType>,
  visiting = new Set<string>(),
): Point {
  if (!node.parentId || visiting.has(node.id)) return node.position;
  const parent = nodesById.get(node.parentId);
  if (!parent) return node.position;
  visiting.add(node.id);
  const parentPosition = absoluteNodePosition(parent, nodesById, visiting);
  visiting.delete(node.id);
  return {
    x: parentPosition.x + node.position.x,
    y: parentPosition.y + node.position.y,
  };
}

function overlaps(left: Rect, right: Rect, gap: number) {
  return left.x < right.x + right.width + gap &&
    left.x + left.width + gap > right.x &&
    left.y < right.y + right.height + gap &&
    left.y + left.height + gap > right.y;
}

function centerOutOffsets(ring: number) {
  const offsets = [0];
  for (let distance = 1; distance <= ring; distance += 1) {
    offsets.push(distance, -distance);
  }
  return offsets;
}

/**
 * Finds the nearest deterministic world-space rectangle beside the source.
 * It reads only graph geometry and never moves existing nodes.
 */
export function findVacantImageToolPlacement(input: Readonly<{
  gap?: number;
  height: number;
  nodes: readonly ProbeNodeType[];
  sourceNodeId: string;
  width: number;
}>): Point {
  const width = finiteDimension(input.width, defaultNodeSize.width);
  const height = finiteDimension(input.height, defaultNodeSize.height);
  const gap = finiteDimension(input.gap, 40);
  const nodesById = new Map(input.nodes.map((node) => [node.id, node]));
  const source = nodesById.get(input.sourceNodeId);
  if (!source) throw new Error("图片工具源节点不存在");
  const sourcePosition = absoluteNodePosition(source, nodesById);
  const sourceSize = nodeSize(source);
  const preferred = {
    x: sourcePosition.x + sourceSize.width + 140,
    y: sourcePosition.y,
  };
  const occupied = input.nodes.map((node) => ({
    ...absoluteNodePosition(node, nodesById),
    ...nodeSize(node),
  }));
  const step = 40;
  const available = (point: Point) => !occupied.some((rect) => overlaps(
    { ...point, height, width },
    rect,
    gap,
  ));
  if (available(preferred)) return preferred;
  for (let ring = 1; ring <= 120; ring += 1) {
    const offsets = centerOutOffsets(ring);
    for (const y of offsets) {
      const right = { x: preferred.x + ring * step, y: preferred.y + y * step };
      if (available(right)) return right;
    }
    for (const x of offsets) {
      const down = { x: preferred.x + x * step, y: preferred.y + ring * step };
      if (available(down)) return down;
    }
    for (const y of offsets) {
      const left = { x: preferred.x - ring * step, y: preferred.y + y * step };
      if (available(left)) return left;
    }
    for (const x of offsets) {
      const up = { x: preferred.x + x * step, y: preferred.y - ring * step };
      if (available(up)) return up;
    }
  }
  throw new Error("画布附近没有足够空白区域，请移动部分节点后重试");
}
