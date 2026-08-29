import type { ProbeNodeType } from "./ProbeNode";
import type { CuttableEdge } from "./canvasTypes";

export type CanvasGenerationKind = "audio" | "image" | "text" | "video";

export type CanvasGraphSnapshot = Readonly<{
  edges: readonly CuttableEdge[];
  nodes: readonly ProbeNodeType[];
  revision?: number;
}>;

/**
 * Evidence a graph adapter must re-check immediately before committing a
 * generation-owned write. A task may be absent before the Provider boundary,
 * but run/node/kind and ownership must always remain explicit.
 */
export type CanvasGraphWriteFence = Readonly<{
  expectedRevision: number;
  kind: CanvasGenerationKind;
  nodeId: string;
  ownershipKey: string;
  runId: string;
  taskId?: string;
}>;

export type CanvasImageToolWriteFence = Readonly<{
  expectedRevision: number;
  kind: "image";
  nodeId: string;
  operationId: string;
  ownershipKey: string;
  runId: string;
  sourceAssetId: string;
}>;

export type CanvasGraphCommand = Readonly<{
  fence: CanvasGraphWriteFence;
  scope: "generation";
  update: (snapshot: CanvasGraphSnapshot) => CanvasGraphSnapshot;
}> | Readonly<{
  fence: CanvasImageToolWriteFence;
  scope: "image-tool";
  update: (snapshot: CanvasGraphSnapshot) => CanvasGraphSnapshot;
}>;

export type CanvasGraphCommandResult = Readonly<{
  reason?: "fence-rejected" | "persistence-unavailable";
  status: "applied" | "rejected";
}>;

export type CanvasGraphCommandCommit = (
  command: CanvasGraphCommand,
) => Promise<CanvasGraphCommandResult>;

/** React state, in-memory graphs and future persistence adapters implement this. */
export interface CanvasGraphCommandPort {
  apply(command: CanvasGraphCommand): CanvasGraphCommandResult;
  snapshot(): CanvasGraphSnapshot;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function generationFenceMatches(
  snapshot: CanvasGraphSnapshot,
  fence: CanvasGraphWriteFence,
) {
  if (
    !Number.isSafeInteger(fence.expectedRevision) ||
    snapshot.revision !== fence.expectedRevision ||
    !nonEmptyString(fence.runId) ||
    !nonEmptyString(fence.nodeId) ||
    !nonEmptyString(fence.ownershipKey)
  ) return false;
  const node = snapshot.nodes.find((candidate) => candidate.id === fence.nodeId);
  if (!node || node.type !== fence.kind) return false;
  const currentRunId = node.data.workflowExecutionRunId;
  const currentOwnershipKey = node.data[`${fence.kind}GenerationOwnershipKey`];
  const currentTaskId = node.data[`${fence.kind}GenerationTaskId`];
  if (nonEmptyString(currentRunId) && currentRunId !== fence.runId) return false;
  if (
    nonEmptyString(currentOwnershipKey) &&
    currentOwnershipKey !== fence.ownershipKey
  ) return false;
  if (nonEmptyString(currentTaskId)) {
    if (!nonEmptyString(fence.taskId) || currentTaskId !== fence.taskId) return false;
  }
  return true;
}

function imageToolFenceMatches(
  snapshot: CanvasGraphSnapshot,
  fence: CanvasImageToolWriteFence,
) {
  if (
    !Number.isSafeInteger(fence.expectedRevision) ||
    snapshot.revision !== fence.expectedRevision ||
    !nonEmptyString(fence.operationId) ||
    !nonEmptyString(fence.runId) ||
    !nonEmptyString(fence.nodeId) ||
    !nonEmptyString(fence.ownershipKey) ||
    !nonEmptyString(fence.sourceAssetId)
  ) return false;
  const node = snapshot.nodes.find((candidate) => candidate.id === fence.nodeId);
  return Boolean(
    node && node.type === "image" && node.data.assetId === fence.sourceAssetId &&
      node.data.imageToolGraphOperationRevision !== fence.expectedRevision,
  );
}

function attachImageToolGraphReceipt(
  snapshot: CanvasGraphSnapshot,
  fence: CanvasImageToolWriteFence,
): CanvasGraphSnapshot {
  return {
    ...snapshot,
    nodes: snapshot.nodes.map((node) => node.id === fence.nodeId
      ? {
          ...node,
          data: {
            ...node.data,
            imageToolGraphOperationId: fence.operationId,
            imageToolGraphOperationRevision: fence.expectedRevision,
            imageToolGraphOwnershipKey: fence.ownershipKey,
            imageToolGraphRunId: fence.runId,
            imageToolGraphSourceAssetId: fence.sourceAssetId,
          },
        }
      : node),
  };
}

function commandFenceMatches(
  snapshot: CanvasGraphSnapshot,
  command: CanvasGraphCommand,
) {
  return command.scope === "generation"
    ? generationFenceMatches(snapshot, command.fence)
    : imageToolFenceMatches(snapshot, command.fence);
}

/** Framework-neutral adapter used by React state and in-memory replacement tests. */
export function createCanvasGraphCommandPort(input: {
  commit: (snapshot: CanvasGraphSnapshot) => void;
  persistenceReady: () => boolean;
  snapshot: () => CanvasGraphSnapshot;
}): CanvasGraphCommandPort {
  let pendingCommand:
    | Readonly<{
        edges: readonly CuttableEdge[];
        nodes: readonly ProbeNodeType[];
        revision: number;
      }>
    | undefined;
  return {
    apply(command) {
      if (!input.persistenceReady()) {
        return { reason: "persistence-unavailable", status: "rejected" };
      }
      const observed = input.snapshot();
      const current = Number.isSafeInteger(observed.revision)
        ? observed
        : pendingCommand &&
            observed.edges === pendingCommand.edges &&
            observed.nodes === pendingCommand.nodes
          ? { ...observed, revision: pendingCommand.revision }
          : observed;
      if (!commandFenceMatches(current, command)) {
        return { reason: "fence-rejected", status: "rejected" };
      }
      const updated = command.update(current);
      const next = command.scope === "image-tool"
        ? attachImageToolGraphReceipt(updated, command.fence)
        : updated;
      if (!input.persistenceReady() || !commandFenceMatches(current, command)) {
        return { reason: "persistence-unavailable", status: "rejected" };
      }
      const nextNode = next.nodes.find((node) => node.id === command.fence.nodeId);
      if (!nextNode || nextNode.type !== command.fence.kind) {
        return { reason: "fence-rejected", status: "rejected" };
      }
      input.commit(next);
      const committed = input.snapshot();
      pendingCommand = {
        edges: committed.edges,
        nodes: committed.nodes,
        revision: command.fence.expectedRevision,
      };
      return { status: "applied" };
    },
    snapshot: input.snapshot,
  };
}

export type CanvasSaveReceipt = Readonly<{
  revision: number;
}>;

/** Durable save/revision boundary; journal and retry policy stay behind it. */
export interface CanvasSavePort {
  flush(): Promise<void>;
  waitForRevision(timeoutMs?: number): Promise<CanvasSaveReceipt>;
}
