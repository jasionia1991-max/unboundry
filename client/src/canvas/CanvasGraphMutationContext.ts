import {
  createContext,
  useContext,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { ProbeNodeType } from "./ProbeNode";
import type { CuttableEdge } from "./canvasTypes";

export const CanvasGraphMutationContext = createContext<{
  setEdges: Dispatch<SetStateAction<CuttableEdge[]>>;
  setNodes: Dispatch<SetStateAction<ProbeNodeType[]>>;
}>({
  setEdges: () => undefined,
  setNodes: () => undefined,
});

export function useCanvasGraphMutation() {
  return useContext(CanvasGraphMutationContext);
}
