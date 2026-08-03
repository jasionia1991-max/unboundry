import { createContext, useContext } from "react";

export type GenerationCanvasState = {
  canvasId: string;
  /** Present only when the exact graph currently on screen is durably saved. */
  canvasRevision?: number;
};

export const GenerationCanvasContext = createContext<GenerationCanvasState>({
  canvasId: "",
});

export function useGenerationCanvas() {
  return useContext(GenerationCanvasContext);
}
