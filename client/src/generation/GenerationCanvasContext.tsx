import { createContext, useContext } from "react";

export type GenerationCanvasState = {
  /** 当前登录账号 ID，用于把本地草稿/同步频道按账号隔离。 */
  accountId: string;
  canvasId: string;
  /** fixture 验收页面不触发真实生成；真实画布（含项目画布）不受限。 */
  isFixture: boolean;
  /** Present only when the exact graph currently on screen is durably saved. */
  canvasRevision?: number;
  /** Wait until the current on-screen graph is durably saved before submitting. */
  flushCanvasSave: () => Promise<void>;
  /**
   * Wait until the canvas is durably saved AND the latest React render has a
   * confirmed revision. Used by generation paths that must not read a stale
   * "canvas is still saving" state from an older render closure.
   */
  waitForCanvasRevision: (timeoutMs?: number) => Promise<number>;
};

export const GenerationCanvasContext = createContext<GenerationCanvasState>({
  accountId: "",
  canvasId: "",
  isFixture: false,
  flushCanvasSave: async () => {},
  waitForCanvasRevision: async () => -1,
});

export function useGenerationCanvas() {
  return useContext(GenerationCanvasContext);
}
