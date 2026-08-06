import { createContext, useContext } from "react";

export type GenerationCanvasState = {
  /** 当前登录账号 ID，用于把本地草稿/同步频道按账号隔离。 */
  accountId: string;
  canvasId: string;
  /** Present only when the exact graph currently on screen is durably saved. */
  canvasRevision?: number;
  /** Wait until the current on-screen graph is durably saved before submitting. */
  flushCanvasSave: () => Promise<void>;
};

export const GenerationCanvasContext = createContext<GenerationCanvasState>({
  accountId: "",
  canvasId: "",
  flushCanvasSave: async () => {},
});

export function useGenerationCanvas() {
  return useContext(GenerationCanvasContext);
}
