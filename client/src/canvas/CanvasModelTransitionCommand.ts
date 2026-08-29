import type {
  ModelParameterSchema,
  ModelParameterValue,
} from "../../../types/modelParameters";
import {
  normalizeModelInputs,
  type ModelInputTransitionIntent,
} from "../../../types/modelInputSemanticCompiler";
import {
  defaultNodeInputRole,
  isNodeInputKind,
} from "../../../types/nodeInputs";
import type { CanvasGraphSnapshot } from "./canvasPorts";

export type CanvasModelTransitionRequest = Readonly<{
  expectedBefore?: Readonly<{
    revision?: number;
    semanticFingerprint: string;
  }>;
  intent: Extract<ModelInputTransitionIntent, "execute" | "mode-switch" | "model-switch">;
  model: Readonly<{
    configurationRevision: string;
    displayName: string;
    id: string;
    parameterSchema: ModelParameterSchema;
    releaseRevisionId: string;
  }>;
  nodeId: string;
  requestedParameters: Readonly<Record<string, ModelParameterValue>>;
}>;

function stableTransitionValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableTransitionValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableTransitionValue(item)]),
    );
  }
  return value;
}

/** Target-scoped semantic fence captured before waiting for Canvas admission. */
export function canvasModelTransitionExpectedBefore(
  snapshot: CanvasGraphSnapshot,
  nodeId: string,
): NonNullable<CanvasModelTransitionRequest["expectedBefore"]> {
  const target = snapshot.nodes.find((node) => node.id === nodeId);
  const nodeById = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const incoming = snapshot.edges
    .filter((edge) => edge.target === nodeId)
    .map((edge) => ({
      id: edge.id,
      inputOrder: edge.data?.inputOrder,
      inputRole: edge.data?.inputRole,
      source: edge.source,
      sourceData: nodeById.get(edge.source)?.data,
      sourceHandle: edge.sourceHandle,
      sourceType: nodeById.get(edge.source)?.type,
      targetHandle: edge.targetHandle,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return {
    revision: snapshot.revision,
    semanticFingerprint: JSON.stringify(stableTransitionValue({
      incoming,
      target: target
        ? {
            id: target.id,
            type: target.type,
            videoInputContractFingerprint:
              target.data.videoInputContractFingerprint,
            videoModelConfigurationRevision:
              target.data.videoModelConfigurationRevision,
            videoModelId: target.data.videoModelId,
            videoParameters: target.data.videoParameters,
            videoPrompt: target.data.videoPrompt,
          }
        : undefined,
    })),
  };
}

export type CanvasModelTransitionPlan = Readonly<{
  after?: CanvasGraphSnapshot;
  before: CanvasGraphSnapshot;
  changed?: boolean;
  contractFingerprint?: string;
  problems: readonly string[];
  status: "blocked" | "ready";
  warnings: readonly string[];
}>;

/** Build a complete graph before/after pair without mutating Canvas state. */
export function buildCanvasModelTransitionCommand(input: {
  request: CanvasModelTransitionRequest;
  snapshot: CanvasGraphSnapshot;
}): CanvasModelTransitionPlan {
  const target = input.snapshot.nodes.find((node) =>
    node.id === input.request.nodeId
  );
  if (!target || target.type !== "video") {
    return {
      before: input.snapshot,
      problems: ["目标视频节点已不存在，模型未切换"],
      status: "blocked",
      warnings: [],
    };
  }
  const nodeById = new Map(input.snapshot.nodes.map((node) => [node.id, node]));
  const incoming = input.snapshot.edges
    .map((edge, index) => ({ edge, index }))
    .filter(({ edge }) => edge.target === target.id)
    .map(({ edge, index }) => {
      const source = nodeById.get(edge.source);
      const kind = isNodeInputKind(source?.type) ? source.type : undefined;
      if (!kind) return undefined;
      const configuredOrder = Number(edge.data?.inputOrder);
      return {
        kind,
        order: Number.isSafeInteger(configuredOrder) && configuredOrder >= 1
          ? configuredOrder
          : index + 1,
        role: typeof edge.data?.inputRole === "string"
          ? edge.data.inputRole
          : defaultNodeInputRole(kind, "video"),
        semanticId: edge.id,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  const semantic = normalizeModelInputs({
    connectedInputs: incoming,
    modelReleaseRevision: input.request.model.releaseRevisionId,
    requestedParameters: input.request.requestedParameters,
    schema: input.request.model.parameterSchema,
    transitionIntent: input.request.intent,
  });
  if (semantic.blockingProblems.length > 0) {
    return {
      before: input.snapshot,
      problems: semantic.blockingProblems.map((problem) => problem.message),
      status: "blocked",
      warnings: semantic.warnings,
    };
  }
  const roleByEdge = new Map(
    semantic.normalizedSemanticInputs.map((item) => [item.semanticId, item.role]),
  );
  const previousFingerprint = target.data.videoInputContractFingerprint;
  const clearOldContractError = Boolean(
    previousFingerprint &&
      target.data.videoGenerationContractFingerprint === previousFingerprint,
  );
  const normalizedParameters = { ...semantic.normalizedParameters };
  const targetChanges =
    target.data.videoInputContractFingerprint !== semantic.contractFingerprint ||
    target.data.videoModelConfigurationRevision !==
      input.request.model.configurationRevision ||
    target.data.videoModel !== input.request.model.displayName ||
    target.data.videoModelId !== input.request.model.id ||
    JSON.stringify(target.data.videoParameters ?? {}) !== JSON.stringify(normalizedParameters) ||
    clearOldContractError;
  const afterNodes = input.snapshot.nodes.map((node) => node.id === target.id && targetChanges
    ? {
        ...node,
        data: {
          ...node.data,
          ...(clearOldContractError
            ? {
                videoGenerationError: undefined,
                videoGenerationErrorCode: undefined,
                videoGenerationContractFingerprint: undefined,
              }
            : {}),
          videoInputContractFingerprint: semantic.contractFingerprint,
          videoModel: input.request.model.displayName,
          videoModelConfigurationRevision:
            input.request.model.configurationRevision,
          videoModelId: input.request.model.id,
          videoParameters: normalizedParameters,
        },
      }
    : node);
  const afterEdges = input.snapshot.edges.map((edge) => {
    const normalizedRole = roleByEdge.get(edge.id);
    return normalizedRole && normalizedRole !== edge.data?.inputRole
      ? {
          ...edge,
          data: { ...edge.data, inputRole: normalizedRole },
        }
      : edge;
  });
  const changed = targetChanges || afterEdges.some((edge, index) =>
    edge !== input.snapshot.edges[index]
  );
  return {
    after: {
      ...input.snapshot,
      edges: afterEdges,
      nodes: afterNodes,
    },
    before: input.snapshot,
    changed,
    contractFingerprint: semantic.contractFingerprint,
    problems: [],
    status: "ready",
    warnings: semantic.warnings,
  };
}

export type CanvasModelTransitionResult = Readonly<{
  changed?: boolean;
  contractFingerprint?: string;
  message?: string;
  problems?: readonly string[];
  revision?: number;
  status: "applied" | "blocked" | "rejected" | "rolled-back";
  warnings?: readonly string[];
}>;

export interface CanvasModelTransitionPort {
  apply(request: CanvasModelTransitionRequest): Promise<CanvasModelTransitionResult>;
}

function sameValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/** Three-way rollback: only restore fields still equal to this transition's after-state. */
function rollbackChangedValue(
  before: unknown,
  after: unknown,
  current: unknown,
): unknown {
  if (sameValue(before, after)) return current;
  if (sameValue(current, after)) return before;
  if (!plainRecord(before) || !plainRecord(after) || !plainRecord(current)) {
    return current;
  }
  const result: Record<string, unknown> = { ...current };
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (sameValue(before[key], after[key])) continue;
    const restored = rollbackChangedValue(before[key], after[key], current[key]);
    if (restored === undefined && before[key] === undefined) delete result[key];
    else result[key] = restored;
  }
  return result;
}

export function rollbackCanvasModelTransition(input: {
  after: CanvasGraphSnapshot;
  before: CanvasGraphSnapshot;
  current: CanvasGraphSnapshot;
}): CanvasGraphSnapshot {
  const beforeNodes = new Map(input.before.nodes.map((node) => [node.id, node]));
  const afterNodes = new Map(input.after.nodes.map((node) => [node.id, node]));
  const beforeEdges = new Map(input.before.edges.map((edge) => [edge.id, edge]));
  const afterEdges = new Map(input.after.edges.map((edge) => [edge.id, edge]));
  return {
    ...input.current,
    nodes: input.current.nodes.map((node) => {
      const before = beforeNodes.get(node.id);
      const after = afterNodes.get(node.id);
      return before && after
        ? rollbackChangedValue(before, after, node) as typeof node
        : node;
    }),
    edges: input.current.edges.map((edge) => {
      const before = beforeEdges.get(edge.id);
      const after = afterEdges.get(edge.id);
      return before && after
        ? rollbackChangedValue(before, after, edge) as typeof edge
        : edge;
    }),
  };
}

/**
 * Owns the single Canvas transaction, undo boundary, durable save confirmation,
 * and full local rollback. Provider work is deliberately outside this port.
 */
export function createCanvasModelTransitionPort(input: {
  checkpoint: () => void;
  commitAtomic: (snapshot: CanvasGraphSnapshot) => void;
  flush: () => Promise<void>;
  persistenceReady: () => boolean;
  snapshot: () => CanvasGraphSnapshot;
  waitForRevision: () => Promise<number>;
}): CanvasModelTransitionPort {
  let applying = false;
  return {
    async apply(request) {
      if (applying || !input.persistenceReady()) {
        return {
          message: applying
            ? "模型切换仍在保存，请稍候"
            : "画布尚未安全加载，模型未切换",
          status: "rejected",
        };
      }
      const currentSnapshot = input.snapshot();
      if (request.expectedBefore) {
        const currentExpected = canvasModelTransitionExpectedBefore(
          currentSnapshot,
          request.nodeId,
        );
        if (
          currentExpected.revision !== request.expectedBefore.revision ||
          currentExpected.semanticFingerprint !==
            request.expectedBefore.semanticFingerprint
        ) {
          return {
            message: "画布已在等待期间更新，请按当前内容重新生成",
            status: "rejected",
          };
        }
      }
      const plan = buildCanvasModelTransitionCommand({
        request,
        snapshot: currentSnapshot,
      });
      if (plan.status === "blocked" || !plan.after) {
        return { problems: plan.problems, status: "blocked", warnings: plan.warnings };
      }
      if (!plan.changed) {
        return {
          changed: false,
          contractFingerprint: plan.contractFingerprint,
          revision: plan.before.revision,
          status: "applied",
          warnings: plan.warnings,
        };
      }
      applying = true;
      input.checkpoint();
      input.commitAtomic(plan.after);
      try {
        await input.flush();
        const revision = await input.waitForRevision();
        return {
          contractFingerprint: plan.contractFingerprint,
          changed: true,
          revision,
          status: "applied",
          warnings: plan.warnings,
        };
      } catch (error) {
        input.commitAtomic(rollbackCanvasModelTransition({
          after: plan.after,
          before: plan.before,
          current: input.snapshot(),
        }));
        try {
          await input.flush();
          await input.waitForRevision();
        } catch {
          // Transition-owned fields are restored locally. Persistence remains
          // fail-closed and blocks generation until it is reconciled.
        }
        return {
          message: error instanceof Error ? error.message : "画布保存失败，已恢复切换前状态",
          status: "rolled-back",
        };
      } finally {
        applying = false;
      }
    },
  };
}
