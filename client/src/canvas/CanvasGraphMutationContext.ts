import {
  createContext,
  useContext,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { ProbeNodeType } from "./ProbeNode";
import type { CuttableEdge } from "./canvasTypes";
import type { CanvasGraphCommandPort } from "./canvasPorts";
import type { CanvasModelTransitionPort } from "./CanvasModelTransitionCommand";

export function tryCommitCanvasNodeAdoption(input: {
  commit: (nodes: ProbeNodeType[]) => void;
  currentNodes: () => ProbeNodeType[];
  persistenceReady: () => boolean;
  targetNodeId: string;
  update: SetStateAction<ProbeNodeType[]>;
}) {
  if (!input.persistenceReady()) return false;
  const current = input.currentNodes();
  if (!current.some((node) => node.id === input.targetNodeId)) return false;
  const next = typeof input.update === "function"
    ? input.update(current)
    : input.update;
  if (!input.persistenceReady()) return false;
  input.commit(next);
  return true;
}

function restoreChangedRecordFields(
  current: Record<string, unknown>,
  before: Record<string, unknown>,
  committed: Record<string, unknown>,
  excluded = new Set<string>(),
) {
  let restored = current;
  for (const key of new Set([...Object.keys(before), ...Object.keys(committed)])) {
    if (
      excluded.has(key) ||
      Object.is(before[key], committed[key]) ||
      !Object.is(current[key], committed[key])
    ) continue;
    if (restored === current) restored = { ...current };
    if (Object.prototype.hasOwnProperty.call(before, key)) {
      restored[key] = before[key];
    } else {
      delete restored[key];
    }
  }
  return restored;
}

export function rollbackCanvasNodeAdoption(input: {
  beforeById: ReadonlyMap<string, ProbeNodeType>;
  committedById: ReadonlyMap<string, ProbeNodeType>;
  current: ProbeNodeType[];
}) {
  let changed = false;
  const nodes = input.current.map((node) => {
    const beforeNode = input.beforeById.get(node.id);
    const committedNode = input.committedById.get(node.id);
    if (!beforeNode || !committedNode) return node;

    const currentRecord = node as unknown as Record<string, unknown>;
    const beforeRecord = beforeNode as unknown as Record<string, unknown>;
    const committedRecord = committedNode as unknown as Record<string, unknown>;
    let restoredRecord = restoreChangedRecordFields(
      currentRecord,
      beforeRecord,
      committedRecord,
      new Set(["data", "style"]),
    );
    const restoredData = restoreChangedRecordFields(
      node.data as Record<string, unknown>,
      beforeNode.data as Record<string, unknown>,
      committedNode.data as Record<string, unknown>,
    );
    if (restoredData !== node.data) {
      if (restoredRecord === currentRecord) restoredRecord = { ...currentRecord };
      restoredRecord.data = restoredData;
    }

    const currentStyle = (node.style ?? {}) as Record<string, unknown>;
    const beforeStyle = (beforeNode.style ?? {}) as Record<string, unknown>;
    const committedStyle = (committedNode.style ?? {}) as Record<string, unknown>;
    const restoredStyle = restoreChangedRecordFields(
      currentStyle,
      beforeStyle,
      committedStyle,
    );
    if (restoredStyle !== currentStyle) {
      if (restoredRecord === currentRecord) restoredRecord = { ...currentRecord };
      restoredRecord.style = beforeNode.style === undefined &&
          Object.keys(restoredStyle).length === 0
        ? undefined
        : restoredStyle;
    }
    if (restoredRecord === currentRecord) return node;
    changed = true;
    return restoredRecord as unknown as ProbeNodeType;
  });
  return changed ? nodes : input.current;
}

export const CanvasGraphMutationContext = createContext<{
  applyModelTransition?: CanvasModelTransitionPort["apply"];
  canvasMutationPendingNodeIds: ReadonlySet<string>;
  graphCommandPort?: CanvasGraphCommandPort;
  imageColorFilter?: string;
  mutateGraph: (update: (current: Readonly<{
    edges: CuttableEdge[];
    nodes: ProbeNodeType[];
  }>) => Readonly<{
    edges: CuttableEdge[];
    nodes: ProbeNodeType[];
  }>) => Promise<boolean>;
  readCanvasMutationVersion: (nodeId: string) => number;
  setImageColorFilter: (color?: string) => void;
  setEdges: Dispatch<SetStateAction<CuttableEdge[]>>;
  setNodes: Dispatch<SetStateAction<ProbeNodeType[]>>;
  tryAdoptNodes: (
    targetNodeId: string,
    update: SetStateAction<ProbeNodeType[]>,
    options?: Readonly<{ checkpoint?: boolean }>,
  ) => Promise<boolean>;
  trySetNodes: (update: SetStateAction<ProbeNodeType[]>) => boolean;
}>({
  applyModelTransition: undefined,
  canvasMutationPendingNodeIds: new Set(),
  graphCommandPort: undefined,
  mutateGraph: async () => false,
  readCanvasMutationVersion: () => 0,
  setImageColorFilter: () => undefined,
  setEdges: () => undefined,
  setNodes: () => undefined,
  tryAdoptNodes: async () => false,
  trySetNodes: () => false,
});

export function useCanvasGraphMutation() {
  return useContext(CanvasGraphMutationContext);
}
