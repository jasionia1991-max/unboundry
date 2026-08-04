import { createContext, useContext } from "react";

type CanvasSelectionUiState = {
  selectedNodeCount: number;
};

export const CanvasSelectionUiContext = createContext<CanvasSelectionUiState>({
  selectedNodeCount: 1,
});

export function useSingleNodeChrome(selected: boolean) {
  const { selectedNodeCount } = useContext(CanvasSelectionUiContext);
  return selected && selectedNodeCount === 1;
}
