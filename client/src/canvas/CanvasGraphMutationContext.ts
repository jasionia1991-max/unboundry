import {
  createContext,
  useContext,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { ProbeNodeType } from "./ProbeNode";
import type { CuttableEdge } from "./canvasTypes";
import type { CanvasGraphCommandPort } from "./canvasPorts";

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

export const CanvasGraphMutationContext = createContext<{
  graphCommandPort?: CanvasGraphCommandPort;
  setEdges: Dispatch<SetStateAction<CuttableEdge[]>>;
  setNodes: Dispatch<SetStateAction<ProbeNodeType[]>>;
  tryAdoptNodes: (
    targetNodeId: string,
    update: SetStateAction<ProbeNodeType[]>,
  ) => boolean;
  trySetNodes: (update: SetStateAction<ProbeNodeType[]>) => boolean;
}>({
  graphCommandPort: undefined,
  setEdges: () => undefined,
  setNodes: () => undefined,
  tryAdoptNodes: () => false,
  trySetNodes: () => false,
});

export function useCanvasGraphMutation() {
  return useContext(CanvasGraphMutationContext);
}
