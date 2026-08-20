import { createContext, useContext } from "react";

export type GenerationCanvasState = {
  /** 当前登录账号 ID，用于把本地草稿/同步频道按账号隔离。 */
  accountId: string;
  canvasId: string;
  /** fixture 的真实身份；普通项目画布为空。 */
  fixtureScopeId: string;
  /** fixture 验收页面不触发真实生成；真实画布（含项目画布）不受限。 */
  isFixture: boolean;
  /** 画布级短暂反馈（toast），供节点工具栏等深色浮层复用。 */
  notify: (message: string, kind?: "error" | "info" | "success") => void;
  /** Present only when the exact graph currently on screen is durably saved. */
  canvasRevision?: number;
  /** The current account/canvas scope has finished safe persistence hydration. */
  persistenceReady: boolean;
  /** Retry may enter the save gate; unlike canvasRevision, dirty state does not disable it. */
  retryGenerationEnabled: boolean;
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
  fixtureScopeId: "",
  isFixture: false,
  notify: () => undefined,
  persistenceReady: true,
  retryGenerationEnabled: false,
  flushCanvasSave: async () => {},
  waitForCanvasRevision: async () => -1,
});

export function useGenerationCanvas() {
  return useContext(GenerationCanvasContext);
}
