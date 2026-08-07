export type PlacementNode = {
  id: string;
  parentId?: string;
  position: { x: number; y: number };
};

export type PlacementRect = {
  bottom: number;
  left: number;
  right: number;
  top: number;
};

export type PlacementSize = {
  height: number;
  width: number;
};

/** 对齐 Unboundry：模板与已有节点/模板之间的间距。 */
export const TEMPLATE_GAP = 100;
/** 对齐 Unboundry：横向最多搜索的列数。 */
export const TEMPLATE_MAX_COLS = 8;
/** 对齐 Unboundry：纵向向上/向下各搜索的行数。 */
export const TEMPLATE_MAX_ROWS = 10;
/** 模板包围盒兜底最小尺寸。 */
export const TEMPLATE_MIN_SIZE = { height: 220, width: 320 };
/** 空画布导入时相对视野中心的随机偏移幅度。 */
export const TEMPLATE_EMPTY_JITTER = 50;

function rectsIntersect(left: PlacementRect, right: PlacementRect) {
  return !(
    left.right <= right.left ||
    left.left >= right.right ||
    left.bottom <= right.top ||
    left.top >= right.bottom
  );
}

/**
 * 计算节点全局坐标：沿 parentId 链逐级累加（子节点坐标是相对父级的）。
 */
export function nodeGlobalPosition<N extends PlacementNode>(
  node: N,
  byId: Map<string, N>,
) {
  let current: N | undefined = node;
  let x = 0;
  let y = 0;
  const seen = new Set<string>();
  while (current) {
    if (seen.has(current.id)) break;
    seen.add(current.id);
    x += current.position?.x ?? 0;
    y += current.position?.y ?? 0;
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return { x, y };
}

export function nodePlacementRect<N extends PlacementNode>(
  node: N,
  byId: Map<string, N>,
  sizeFor: (node: N) => PlacementSize,
): PlacementRect {
  const { x, y } = nodeGlobalPosition(node, byId);
  const size = sizeFor(node);
  return {
    bottom: y + size.height,
    left: x,
    right: x + size.width,
    top: y,
  };
}

/**
 * 模板全部节点的全局包围盒（含 group 子节点）。
 */
export function templateBounds<N extends PlacementNode>(
  nodes: readonly N[],
  sizeFor: (node: N) => PlacementSize,
) {
  if (nodes.length === 0) {
    return {
      ...TEMPLATE_MIN_SIZE,
      bottom: TEMPLATE_MIN_SIZE.height,
      left: 0,
      right: TEMPLATE_MIN_SIZE.width,
      top: 0,
    };
  }
  const byId = new Map(nodes.map((node) => [node.id, node]));
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const node of nodes) {
    const rect = nodePlacementRect(node, byId, sizeFor);
    left = Math.min(left, rect.left);
    top = Math.min(top, rect.top);
    right = Math.max(right, rect.right);
    bottom = Math.max(bottom, rect.bottom);
  }
  return { bottom, left, right, top, width: right - left, height: bottom - top };
}

/**
 * 锚点（模板左上角候选起点）：有选中节点时放选中区右侧，
 * 否则放在视野中心（水平右偏、垂直居中）。
 */
export function templateAnchor(options: {
  gap?: number;
  selectedBounds?: PlacementRect;
  templateSize: PlacementSize;
  viewportCenter: { x: number; y: number };
}) {
  const gap = options.gap ?? TEMPLATE_GAP;
  if (options.selectedBounds) {
    return {
      x: options.selectedBounds.right + gap,
      y: options.selectedBounds.top,
    };
  }
  return {
    x: options.viewportCenter.x + gap,
    y: options.viewportCenter.y - options.templateSize.height / 2,
  };
}

/**
 * 空画布时的落点：视野中心附近，加 ±50 随机抖动，避免每次都正中心。
 */
export function emptyCanvasTemplateSpot(options: {
  random?: () => number;
  templateSize: PlacementSize;
  viewportCenter: { x: number; y: number };
}) {
  const random = options.random ?? Math.random;
  const jitterX = (random() * 2 - 1) * TEMPLATE_EMPTY_JITTER;
  const jitterY = (random() * 2 - 1) * TEMPLATE_EMPTY_JITTER;
  return {
    x: options.viewportCenter.x - options.templateSize.width / 2 + jitterX,
    y: options.viewportCenter.y - options.templateSize.height / 2 + jitterY,
  };
}

/**
 * 网格扫描：从锚点开始，横向 0..maxCols、纵向 0,±1..±maxRows，
 * 每步间隔 模板宽/高 + gap，返回第一个不与任何障碍相交的左上角；
 * 全部重叠时回落锚点（与 Unboundry 一致）。
 */
export function findTemplateSpot(options: {
  anchor: { x: number; y: number };
  gap?: number;
  maxCols?: number;
  maxRows?: number;
  obstacles: readonly PlacementRect[];
  templateSize: PlacementSize;
}) {
  const gap = options.gap ?? TEMPLATE_GAP;
  const maxCols = options.maxCols ?? TEMPLATE_MAX_COLS;
  const maxRows = options.maxRows ?? TEMPLATE_MAX_ROWS;
  const width = Math.max(TEMPLATE_MIN_SIZE.width, options.templateSize.width);
  const height = Math.max(TEMPLATE_MIN_SIZE.height, options.templateSize.height);
  const rows = [0];
  for (let index = 1; index <= maxRows; index += 1) {
    rows.push(index, -index);
  }
  for (let column = 0; column <= maxCols; column += 1) {
    const x = options.anchor.x + column * (width + gap);
    for (const row of rows) {
      const y = options.anchor.y + row * (height + gap);
      const candidate = {
        bottom: y + height,
        left: x,
        right: x + width,
        top: y,
      };
      if (!options.obstacles.some((obstacle) => rectsIntersect(candidate, obstacle))) {
        return { x, y };
      }
    }
  }
  return { ...options.anchor };
}

/**
 * 整块平移模板：只改顶层节点（无 parentId），子节点随父级移动。
 */
export function offsetTemplate<N extends PlacementNode>(
  nodes: readonly N[],
  delta: { x: number; y: number },
): N[] {
  return nodes.map((node) =>
    node.parentId
      ? node
      : {
          ...node,
          position: {
            x: (node.position?.x ?? 0) + delta.x,
            y: (node.position?.y ?? 0) + delta.y,
          },
        },
  );
}

function parsePadding(padding: number | string, size: number) {
  if (typeof padding === "number") return padding * size;
  if (typeof padding === "string" && padding.endsWith("%")) {
    return (Number(padding.slice(0, -1)) / 100) * size;
  }
  if (typeof padding === "string" && padding.endsWith("px")) {
    return Number(padding.slice(0, -2));
  }
  return 0;
}

/**
 * 与 React Flow `getViewportForBounds` 相同语义：给定要聚焦的矩形，
 * 返回让该矩形以 padding 边距完整进入视野的 viewport。
 */
export function viewportForBounds(
  bounds: { x: number; y: number; width: number; height: number },
  width: number,
  height: number,
  minZoom: number,
  maxZoom: number,
  padding: number | string = 0.1,
) {
  const paddingY = parsePadding(padding, height);
  const paddingX = parsePadding(padding, width);
  const xZoom = (width - paddingX * 2) / bounds.width;
  const yZoom = (height - paddingY * 2) / bounds.height;
  const zoom = Math.min(xZoom, yZoom);
  const clampedZoom = Math.min(maxZoom, Math.max(minZoom, zoom));
  const boundsCenterX = bounds.x + bounds.width / 2;
  const boundsCenterY = bounds.y + bounds.height / 2;
  const x = width / 2 - boundsCenterX * clampedZoom;
  const y = height / 2 - boundsCenterY * clampedZoom;
  return { x, y, zoom: clampedZoom };
}
