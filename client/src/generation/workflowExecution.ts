import { shouldIgnoreStaleCanvasSaveProblem } from "./groupRunPersist";
import type { GroupResultProjection } from "./groupResultProjection";
import {
  workflowRoleMinimumCanBeSatisfied,
  type NodeInputKind,
  type NodeInputRole,
} from "../../../types/nodeInputs";

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

export type NodeRunSuccessProof = {
  inputFingerprint?: string;
  modelConfigurationRevision?: string;
  modelReleaseRevision?: string;
  ownershipKey: string;
  resultKey: string;
  taskId: string;
};

export type NodeRunResult = {
  errorCode?: string;
  message?: string;
  projection?: GroupResultProjection;
  projectionState?: "applied" | "pending";
  successProof?: NodeRunSuccessProof;
  status: NodeRunStatus;
};

export type WorkflowPreflightPhase = "runtime" | "runtime-final" | "static";

export type WorkflowInputProblem = {
  code: string;
  edgeId?: string;
  kind?: NodeInputKind;
  message: string;
  minimumCount?: number;
  role?: NodeInputRole;
};

export type WorkflowModelSelectionProblem = {
  code: "MODEL_UNAVAILABLE";
  message: string;
};

export type WorkflowResolvedInput = {
  compatibility: "blocked" | "compatible";
  edgeId: string;
  kind: NodeInputKind;
  role?: NodeInputRole;
  sourceNodeId: string;
  state: "empty" | "invalid" | "missing" | "ready" | "uploading";
};

const submissionInvariantProblemCodes = new Set([
  "COMBINATION_UNSUPPORTED",
  "GRAPH_INVALID",
  "MODEL_UNSUPPORTED",
  "MODEL_UNAVAILABLE",
  "ORDER_INVALID",
  "QUANTITY_EXCEEDED",
  "ROLE_CONFLICT",
  "ROLE_UNSUPPORTED",
]);

const modelKindLabels = {
  audio: "音频",
  image: "图片",
  text: "文字",
  video: "视频",
} as const;

/**
 * A disabled, removed or not-yet-loaded model is a static group-run blocker.
 * Without this check an earlier layer could create paid work before the later
 * node discovers that it has no usable model.
 */
export function workflowModelSelectionProblem(input: {
  isFixture: boolean;
  kind: keyof typeof modelKindLabels;
  model?: { generationAvailable?: boolean; generationUnavailableReason?: string };
  status: "error" | "loading" | "ready";
  unavailableReason?: string;
}): WorkflowModelSelectionProblem | undefined {
  if (input.isFixture) return undefined;
  const label = modelKindLabels[input.kind];
  if (input.status !== "ready") {
    return {
      code: "MODEL_UNAVAILABLE",
      message: `${label}模型目录尚未加载完成，请稍后再试`,
    };
  }
  if (!input.model) {
    return {
      code: "MODEL_UNAVAILABLE",
      message: input.unavailableReason || `请明确选择兼容的${label}模型`,
    };
  }
  if (input.model.generationAvailable === false) {
    return {
      code: "MODEL_UNAVAILABLE",
      message: input.model.generationUnavailableReason ||
        `当前${label}模型暂不可生成，请重新选择`,
    };
  }
  return undefined;
}

/**
 * Return a problem that is already certain before any node in the group runs.
 * Empty output from an executable upstream is deferred because the earlier
 * workflow layer may legitimately create it. Model, role, order and graph
 * incompatibilities cannot be repaired by running an upstream node and must
 * therefore block the whole group before the first task submission.
 */
export function workflowSubmissionPreflightProblem<
  Problem extends WorkflowInputProblem,
>(input: {
  executableIds: ReadonlySet<string>;
  inputs: readonly WorkflowResolvedInput[];
  problems: readonly Problem[];
}) {
  for (const problem of input.problems) {
    if (shouldIgnoreStaleCanvasSaveProblem(problem)) continue;
    if (
      workflowRoleMinimumCanBeSatisfied({
        dynamicNodeIds: input.executableIds,
        inputs: input.inputs,
        problem,
      })
    ) continue;
    if (submissionInvariantProblemCodes.has(problem.code)) return problem;
    const resolved = problem.edgeId
      ? input.inputs.find((candidate) => candidate.edgeId === problem.edgeId)
      : undefined;
    if (problem.code === "MISSING") return problem;
    if (
      problem.code === "EMPTY" ||
      problem.code === "UPLOADING" ||
      problem.code === "INVALID"
    ) {
      if (resolved && input.executableIds.has(resolved.sourceNodeId)) continue;
      return problem;
    }
    if (problem.code === "PROMPT_MISSING") {
      const futureText = input.inputs.some((candidate) =>
        candidate.kind === "text" &&
        candidate.state !== "missing" &&
        input.executableIds.has(candidate.sourceNodeId));
      if (futureText) continue;
      return problem;
    }
    if (problem.code === "REQUIRED_MISSING") {
      const futureInput = input.inputs.some((candidate) =>
        candidate.state !== "missing" &&
        input.executableIds.has(candidate.sourceNodeId));
      if (futureInput) continue;
      return problem;
    }
    return problem;
  }
  return undefined;
}

export type WorkflowRuntimePreflightDisposition<
  Problem extends WorkflowInputProblem,
> =
  | { problem: Problem; status: "blocked" }
  | { problem: Problem; status: "waiting" }
  | { status: "ready" };

/**
 * Reclassify a node's current input state immediately before its task is
 * submitted. A dynamic problem that belongs to a producer participating in
 * this run is transient: React may still be rendering the producer's newly
 * persisted output. Everything else is a real runtime blocker.
 */
export function workflowRuntimePreflightDisposition<
  Problem extends WorkflowInputProblem,
>(input: {
  executableIds: ReadonlySet<string>;
  inputs: readonly WorkflowResolvedInput[];
  problems: readonly Problem[];
}): WorkflowRuntimePreflightDisposition<Problem> {
  for (const problem of input.problems) {
    if (shouldIgnoreStaleCanvasSaveProblem(problem)) continue;
    if (
      workflowRoleMinimumCanBeSatisfied({
        dynamicNodeIds: input.executableIds,
        inputs: input.inputs,
        problem,
      })
    ) {
      return { problem, status: "waiting" };
    }
    if (submissionInvariantProblemCodes.has(problem.code)) {
      return { problem, status: "blocked" };
    }
    const resolved = problem.edgeId
      ? input.inputs.find((candidate) => candidate.edgeId === problem.edgeId)
      : undefined;
    if (
      problem.code === "EMPTY" ||
      problem.code === "UPLOADING" ||
      problem.code === "INVALID"
    ) {
      return resolved && input.executableIds.has(resolved.sourceNodeId)
        ? { problem, status: "waiting" }
        : { problem, status: "blocked" };
    }
    if (problem.code === "PROMPT_MISSING") {
      const futureText = input.inputs.some((candidate) =>
        candidate.kind === "text" &&
        candidate.state !== "missing" &&
        input.executableIds.has(candidate.sourceNodeId));
      return futureText
        ? { problem, status: "waiting" }
        : { problem, status: "blocked" };
    }
    if (problem.code === "REQUIRED_MISSING") {
      const futureInput = input.inputs.some((candidate) =>
        candidate.state !== "missing" &&
        input.executableIds.has(candidate.sourceNodeId));
      return futureInput
        ? { problem, status: "waiting" }
        : { problem, status: "blocked" };
    }
    return { problem, status: "blocked" };
  }
  return { status: "ready" };
}

/**
 * Outcome returned by a node's own generation routine. It lets the workflow
 * runner surface the real reason (for example a cost limit) instead of
 * guessing from unchanged node data.
 */
export type NodeGenerationOutcome =
  | { message?: string; status: "failed" }
  | { status: "skipped" }
  | { status: "success"; successProof?: NodeRunSuccessProof };

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
 * Unboundry) or when cancelled. Already submitted tasks in the current layer are
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

export type WorkflowGraphNodeState =
  | "blocked"
  | "failed"
  | "pending"
  | "running"
  | "skipped"
  | "success";

export type WorkflowGraphRunResult =
  | {
      blockedNodeIds: string[];
      errorCode?: string;
      failedNodeIds: string[];
      firstFailure?: {
        errorCode?: string;
        message?: string;
        nodeId: string;
      };
      message?: string;
      status: "failed";
    }
  | {
      blockedNodeIds: string[];
      message?: string;
      skippedNodeIds: string[];
      status: "skipped";
    }
  | {
      completedNodeIds: string[];
      pendingNodeIds: string[];
      status: "cancelled";
    }
  | { status: "success" };

/**
 * Dependency-driven workflow runner. It deliberately has no layer barrier:
 * once all direct producers of a node have succeeded in this run, that node
 * may start even while an unrelated branch is still running. A failed branch
 * blocks only its descendants.
 */
export async function runWorkflowGraph(input: {
  edges: readonly WorkflowEdgeShape[];
  executableIds: ReadonlySet<string>;
  initialSuccessNodeIds?: ReadonlySet<string>;
  isCancelled: () => boolean;
  onNodeStateChange?: (
    nodeId: string,
    state: WorkflowGraphNodeState,
    completed: number,
    total: number,
    result?: NodeRunResult,
  ) => void;
  runNode: (nodeId: string) => Promise<NodeRunResult>;
}): Promise<WorkflowGraphRunResult> {
  const nodeIds = Array.from(input.executableIds);
  const parents = new Map(nodeIds.map((nodeId) => [nodeId, new Set<string>()]));
  for (const edge of input.edges) {
    if (
      edge.source !== edge.target &&
      input.executableIds.has(edge.source) &&
      input.executableIds.has(edge.target)
    ) {
      parents.get(edge.target)?.add(edge.source);
    }
  }
  const states = new Map<string, WorkflowGraphNodeState>(
    nodeIds.map((nodeId) => [
      nodeId,
      input.initialSuccessNodeIds?.has(nodeId) ? "success" : "pending",
    ]),
  );
  const active = new Map<
    string,
    Promise<{ nodeId: string; result: NodeRunResult }>
  >();
  const messages = new Map<string, string>();
  const failures: Array<{
    errorCode?: string;
    message?: string;
    nodeId: string;
  }> = [];
  let completed = nodeIds.filter((nodeId) => states.get(nodeId) === "success")
    .length;

  for (const nodeId of nodeIds) {
    if (states.get(nodeId) === "success") {
      input.onNodeStateChange?.(nodeId, "success", completed, nodeIds.length);
    }
  }

  const transition = (
    nodeId: string,
    state: WorkflowGraphNodeState,
    result?: NodeRunResult,
  ) => {
    states.set(nodeId, state);
    if (["blocked", "failed", "skipped", "success"].includes(state)) {
      completed += 1;
    }
    input.onNodeStateChange?.(nodeId, state, completed, nodeIds.length, result);
  };

  while (completed < nodeIds.length) {
    let changed = false;
    if (!input.isCancelled()) {
      for (const nodeId of nodeIds) {
        if (states.get(nodeId) !== "pending") continue;
        const dependencyStates = Array.from(parents.get(nodeId) ?? [])
          .map((parentId) => states.get(parentId));
        if (dependencyStates.some((state) =>
          state === "blocked" || state === "failed" || state === "skipped"
        )) {
          transition(nodeId, "blocked");
          changed = true;
        }
      }
      for (const nodeId of nodeIds) {
        if (states.get(nodeId) !== "pending") continue;
        const dependencyStates = Array.from(parents.get(nodeId) ?? [])
          .map((parentId) => states.get(parentId));
        if (!dependencyStates.every((state) => state === "success")) continue;
        transition(nodeId, "running");
        const pending = (async () => {
          try {
            return { nodeId, result: await input.runNode(nodeId) };
          } catch {
            return {
              nodeId,
              result: { status: "failed" as const },
            };
          }
        })();
        active.set(nodeId, pending);
        changed = true;
      }
    }

    if (active.size === 0) {
      if (input.isCancelled()) {
        return {
          completedNodeIds: nodeIds.filter((nodeId) =>
            ["failed", "skipped", "success"].includes(states.get(nodeId) ?? "")
          ),
          pendingNodeIds: nodeIds.filter((nodeId) =>
            states.get(nodeId) === "pending" || states.get(nodeId) === "blocked"
          ),
          status: "cancelled",
        };
      }
      if (!changed && completed < nodeIds.length) {
        const unresolved = nodeIds.filter((nodeId) => states.get(nodeId) === "pending");
        return {
          blockedNodeIds: unresolved,
          failedNodeIds: [],
          message: "工作流存在无法解析的依赖",
          status: "failed",
        };
      }
      continue;
    }

    const settled = await Promise.race(active.values());
    active.delete(settled.nodeId);
    if (settled.result.message) {
      messages.set(settled.nodeId, settled.result.message);
    }
    if (settled.result.status === "failed") {
      failures.push({
        errorCode: settled.result.errorCode,
        message: settled.result.message,
        nodeId: settled.nodeId,
      });
    }
    transition(
      settled.nodeId,
      settled.result.status === "success"
        ? "success"
        : settled.result.status === "failed"
          ? "failed"
          : "skipped",
      settled.result,
    );
  }

  if (input.isCancelled()) {
    return {
      completedNodeIds: nodeIds.filter((nodeId) => states.get(nodeId) === "success"),
      pendingNodeIds: [],
      status: "cancelled",
    };
  }
  const failedNodeIds = nodeIds.filter((nodeId) => states.get(nodeId) === "failed");
  const skippedNodeIds = nodeIds.filter((nodeId) => states.get(nodeId) === "skipped");
  const blockedNodeIds = nodeIds.filter((nodeId) => states.get(nodeId) === "blocked");
  if (failedNodeIds.length > 0) {
    const firstFailure = failures[0];
    return {
      blockedNodeIds,
      errorCode: firstFailure?.errorCode,
      failedNodeIds,
      firstFailure,
      message: firstFailure?.message,
      status: "failed",
    };
  }
  if (skippedNodeIds.length > 0) {
    return {
      blockedNodeIds,
      message: skippedNodeIds.map((nodeId) => messages.get(nodeId)).find(Boolean),
      skippedNodeIds,
      status: "skipped",
    };
  }
  return { status: "success" };
}
