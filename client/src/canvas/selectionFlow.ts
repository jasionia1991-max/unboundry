import {
  buildWorkflowLayers,
  type WorkflowEdgeShape,
  type WorkflowNodeShape,
} from "../generation/workflowExecution";

export type EdgeFlowDirection = 1 | -1;

/** 同时开流动动画的高亮边上限，避免多选/框选时整片线都在动。 */
export const MAX_ANIMATED_SELECTION_EDGES = 10;

/**
 * 计算选中节点所在连通子图的拓扑分层，并为每条边给出流动方向：
 * 1 = 从源节点流向目标节点（等价于低层→高层），-1 = 反向。
 * 图存在环或分层失败时安全回退为全部正向，绝不抛错影响画布。
 */
export function connectedEdgeFlowDirections(
  nodes: readonly WorkflowNodeShape[],
  edges: readonly WorkflowEdgeShape[],
  selectedIds: ReadonlySet<string>,
): Map<string, EdgeFlowDirection> {
  const directions = new Map<string, EdgeFlowDirection>();
  if (selectedIds.size === 0) return directions;

  const adjacency = new Map<string, string[]>();
  for (const node of nodes) adjacency.set(node.id, []);
  for (const edge of edges) {
    if (!adjacency.has(edge.source) || !adjacency.has(edge.target)) continue;
    adjacency.get(edge.source)?.push(edge.target);
    adjacency.get(edge.target)?.push(edge.source);
  }

  const component = new Set<string>();
  const queue = [...selectedIds];
  while (queue.length > 0) {
    const id = queue.pop()!;
    if (component.has(id)) continue;
    component.add(id);
    for (const next of adjacency.get(id) ?? []) {
      if (!component.has(next)) queue.push(next);
    }
  }

  const componentNodes = nodes.filter((node) => component.has(node.id));
  const componentEdges = edges.filter(
    (edge) => component.has(edge.source) && component.has(edge.target),
  );

  let layerIndex = new Map<string, number>();
  try {
    buildWorkflowLayers(componentNodes, componentEdges).forEach(
      (layer, index) => {
        for (const nodeId of layer) layerIndex.set(nodeId, index);
      },
    );
  } catch {
    // 环或异常图：保持回退（全部正向），高亮与流动仍可用。
    layerIndex = new Map();
  }

  for (const edge of componentEdges) {
    const sourceLayer = layerIndex.get(edge.source);
    const targetLayer = layerIndex.get(edge.target);
    if (
      sourceLayer !== undefined &&
      targetLayer !== undefined &&
      sourceLayer > targetLayer
    ) {
      directions.set(edge.id, -1);
    } else {
      directions.set(edge.id, 1);
    }
  }
  return directions;
}

/**
 * 从选中节点直接相连的边里，挑选前 limit 条允许播放流动动画；
 * 其余仍保持静态提亮，防止大量边同时动画造成视觉噪音。
 */
export function selectionFlowAnimatedEdgeIds(
  edges: readonly WorkflowEdgeShape[],
  selectedIds: ReadonlySet<string>,
  limit = MAX_ANIMATED_SELECTION_EDGES,
): Set<string> {
  if (selectedIds.size === 0) return new Set();
  const connected = edges.filter(
    (edge) =>
      selectedIds.has(edge.source) || selectedIds.has(edge.target),
  );
  return new Set(connected.slice(0, Math.max(0, limit)).map((edge) => edge.id));
}

/**
 * 从边对象里剥掉“选中高亮/流动”的渲染标记。
 * 这些标记只应存在于渲染层，绝不能进入历史记录、撤销还原或画布持久化。
 */
export function stripSelectionFlowMarkers<
  E extends {
    className?: string;
    data?: Record<string, unknown> | undefined;
  },
>(edge: E): E {
  const className = (edge.className ?? "")
    .split(/\s+/)
    .filter((part) => part && part !== "connected-to-selected-node")
    .join(" ") || undefined;
  const data =
    edge.data && typeof edge.data === "object"
      ? Object.fromEntries(
          Object.entries(edge.data).filter(
            ([key]) => key !== "flowAnimated" && key !== "flowDirection",
          ),
        )
      : edge.data;
  return { ...edge, className, data: data as E["data"] };
}
