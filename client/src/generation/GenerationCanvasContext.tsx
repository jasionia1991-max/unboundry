import { createContext, useContext } from "react";

export type GenerationCanvasState = {
  canvasId: string;
  /** Present only when the exact graph currently on screen is durably saved. */
  canvasRevision?: number;
  /** Wait until the current on-screen graph is durably saved before submitting. */
  flushCanvasSave: () => Promise<void>;
};

export const GenerationCanvasContext = createContext<GenerationCanvasState>({
  canvasId: "",
  flushCanvasSave: async () => {},
});

export function useGenerationCanvas() {
  return useContext(GenerationCanvasContext);
}
