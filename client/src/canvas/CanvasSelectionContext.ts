import { createContext, useContext } from "react";

type CanvasSelectionUiState = {
  selectedNodeCount: number;
};

export const CanvasSelectionUiContext = createContext<CanvasSelectionUiState>({
  selectedNodeCount: 1,
});

export function useSingleNodeChrome(selected: boolean, dragging?: boolean) {
  const { selectedNodeCount } = useContext(CanvasSelectionUiContext);
  // 对齐 Unboundry：拖动过程中隐藏功能栏/创作框，松手后恢复。
  return selected && selectedNodeCount === 1 && !dragging;
}
