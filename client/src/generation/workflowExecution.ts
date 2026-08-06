export type WorkflowNodeShape = {
  data: Record<string, unknown>;
  id: string;
  type: string;
};

export type WorkflowEdgeShape = {
  id: string;
  source: string;
  target: string;
};

export type NodeRunStatus = "busy" | "failed" | "skipped" | "success";

export type NodeRunResult = {
  message?: string;
  status: NodeRunStatus;
};

/**
 * Outcome returned by a node's own generation routine. It lets the workflow
 * runner surface the real reason (for example a cost limit) instead of
 * guessing from unchanged node data.
 */
export type NodeGenerationOutcome =
  | { message?: string; status: "failed" }
  | { status: "skipped" }
  | { status: "success" };

/**
 * A node is executable when it is a real generation node. Pure upload slots,
 * notes without a prompt, and container nodes are not part of a group run.
 * Image/video/audio nodes only count when they can actually generate: they
 * need their own prompt or an upstream Text node (which may generate its
 * content during the same run). Upload/reference slots never qualify, even
 * when legacy canvas data still carries a stale generation-ready flag.
 */
export function isExecutableWorkflowNode(
  node: WorkflowNodeShape,
  options?: { hasIncomingText?: boolean },
): boolean {
  const data = node.data ?? {};
  const hasOwnPrompt = (key: string) =>
    typeof data[key] === "string" && String(data[key]).trim().length > 0;
  switch (node.type) {
    case "text":
      return data.textPromptReady === true &&
        hasOwnPrompt("textPrompt");
    case "image":
      return data.imagePromptReady === true &&
        (hasOwnPrompt("imagePrompt") || options?.hasIncomingText === true);
    case "video":
      return data.videoPromptReady === true &&
        (hasOwnPrompt("videoPrompt") || options?.hasIncomingText === true);
    case "audio":
      return data.audioPromptReady === true &&
        (hasOwnPrompt("audioPrompt") || options?.hasIncomingText === true);
    default:
      return false;
  }
}

/** Whether a node currently has a generation or upload in flight. */
export function isWorkflowNodeGenerating(node: WorkflowNodeShape): boolean {
  const data = node.data ?? {};
  return data.imageGenerating === true ||
    data.textGenerating === true ||
    data.videoGenerating === true ||
    data.audioGenerating === true ||
    data.inputState === "uploading";
}

/**
 * Layered topological order (Kahn). Only edges whose two ends are inside the
 * submitted node set participate; external upstreams are treated as ready.
 * Returns layers where every node in layer N+1 depends only on nodes in
 * layers <= N, so each layer can run in parallel.
 */
export function buildWorkflowLayers(
  nodes: readonly WorkflowNodeShape[],
  edges: readonly WorkflowEdgeShape[],
): string[][] {
  const ids = new Set(nodes.map((node) => node.id));
  const adjacency = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  for (const node of nodes) {
    adjacency.set(node.id, []);
    inDegree.set(node.id, 0);
  }
  for (const edge of edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) continue;
    if (edge.source === edge.target) continue;
    adjacency.get(edge.source)?.push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }
  const remaining = new Map(inDegree);
  const layers: string[][] = [];
  while (remaining.size > 0) {
    const ready = Array.from(remaining.entries())
      .filter(([, degree]) => degree === 0)
      .map(([nodeId]) => nodeId);
    if (ready.length === 0) throw new Error("工作流存在循环依赖");
    layers.push(ready);
    for (const nodeId of ready) {
      remaining.delete(nodeId);
      for (const next of adjacency.get(nodeId) ?? []) {
        const degree = remaining.get(next);
        if (degree !== undefined) remaining.set(next, degree - 1);
      }
    }
  }
  return layers;
}

export type WorkflowLayerRunResult =
  | { message?: string; status: "cancelled" }
  | { failedNodeIds: string[]; message?: string; status: "failed" }
  | { message?: string; skippedNodeIds: string[]; status: "skipped" }
  | { status: "success" };

/**
 * Executes executable nodes layer by layer. Nodes in the same layer run in
 * parallel; the run stops on the first failed, skipped or busy node (matching
 * TapNow) or when cancelled. Already submitted tasks in the current layer are
 * allowed to finish; only later layers are cancelled.
 */
export async function runWorkflowLayers(input: {
  executableIds: ReadonlySet<string>;
  isCancelled: () => boolean;
  layers: readonly string[][];
  onLayer?: (current: number, total: number) => void;
  runNode: (nodeId: string) => Promise<NodeRunResult>;
}): Promise<WorkflowLayerRunResult> {
  const executableLayers = input.layers
    .map((layer) => layer.filter((nodeId) => input.executableIds.has(nodeId)))
    .filter((layer) => layer.length > 0);
  const total = executableLayers.length;
  let current = 0;
  for (const layer of executableLayers) {
    if (input.isCancelled()) return { status: "cancelled" };
    current += 1;
    if (total > 1) input.onLayer?.(current, total);
    const results = await Promise.all(
      layer.map(async (nodeId) => {
        try {
          return { nodeId, result: await input.runNode(nodeId) };
        } catch {
          return { nodeId, result: { status: "failed" as const } };
        }
      }),
    );
    const failed = results.filter(
      (result) => result.result.status === "failed",
    );
    if (failed.length > 0) {
      return {
        failedNodeIds: failed.map((result) => result.nodeId),
        message: failed.find((result) => result.result.message)
          ?.result.message,
        status: "failed",
      };
    }
    const skipped = results.filter(
      (result) =>
        result.result.status === "skipped" ||
        result.result.status === "busy",
    );
    if (skipped.length > 0) {
      return {
        message: skipped.find((result) => result.result.message)
          ?.result.message,
        skippedNodeIds: skipped.map((result) => result.nodeId),
        status: "skipped",
      };
    }
  }
  return { status: "success" };
}
