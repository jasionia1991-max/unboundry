import type { ProbeNodeType } from "../canvas/ProbeNode";
import type { CuttableEdge } from "../canvas/canvasTypes";
import type { PublishedModel, ModelCatalogStatus } from "../models/ModelCatalog";
import type { Dispatch, SetStateAction } from "react";
import type {
  NodeRunResult,
  WorkflowPreflightPhase,
} from "./workflowExecution";

export type WorkflowExecutorKind = "audio" | "image" | "text" | "video";

export type NodeExecutorContext = {
  accountId: string;
  canvasId: string;
  fixtureScopeId: string;
  flushCanvasSave: () => Promise<void>;
  getEdges: () => CuttableEdge[];
  getNodes: () => ProbeNodeType[];
  isCancelled: () => boolean;
  isFixture: boolean;
  modelCatalog: {
    models: Partial<Record<WorkflowExecutorKind, PublishedModel[] | undefined>>;
    status: ModelCatalogStatus;
  };
  runId: string;
  setNodes: Dispatch<SetStateAction<ProbeNodeType[]>>;
  waitForCanvasRevision: (timeoutMs?: number) => Promise<number>;
};

export type NodeExecutor = {
  kind: WorkflowExecutorKind;
  preflight: (
    nodeId: string,
    context: NodeExecutorContext,
    executableIds: ReadonlySet<string>,
    phase: WorkflowPreflightPhase,
  ) => Promise<NodeRunResult>;
  recover: (
    nodeId: string,
    context: NodeExecutorContext,
  ) => Promise<NodeRunResult>;
  run: (
    nodeId: string,
    context: NodeExecutorContext,
    executableIds: ReadonlySet<string>,
  ) => Promise<NodeRunResult>;
};

/**
 * Process-owned workflow executors. Unlike the old node-component registration
 * map, entries are installed once from execution modules and do not disappear
 * when React Flow virtualizes a node.
 */
export class NodeExecutorRegistry {
  readonly #executors = new Map<WorkflowExecutorKind, NodeExecutor>();

  constructor(executors: readonly NodeExecutor[] = []) {
    for (const executor of executors) this.add(executor);
  }

  add(executor: NodeExecutor) {
    if (this.#executors.has(executor.kind)) {
      throw new Error(`节点执行器重复注册：${executor.kind}`);
    }
    this.#executors.set(executor.kind, executor);
    return this;
  }

  get(node: Pick<ProbeNodeType, "type"> | undefined) {
    if (!node || !isWorkflowExecutorKind(node.type)) return undefined;
    return this.#executors.get(node.type);
  }

  kinds() {
    return [...this.#executors.keys()];
  }
}

export function isWorkflowExecutorKind(
  value: unknown,
): value is WorkflowExecutorKind {
  return value === "audio" || value === "image" || value === "text" ||
    value === "video";
}
