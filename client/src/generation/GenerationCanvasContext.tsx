import { createContext, useContext } from "react";
import type { CuttableEdge } from "../canvas/canvasTypes";
import type { ProbeNodeType } from "../canvas/ProbeNode";
import type { Viewport } from "@xyflow/react";

export type AuthoritativeGenerationCanvasMutation = {
  clearedFields?: readonly string[];
  dataPatch: Record<string, unknown>;
  document: {
    edges: CuttableEdge[];
    graphRevision: number;
    loadToken: string;
    nodes: ProbeNodeType[];
    revision: number;
    viewport: Viewport;
  };
  expected: {
    inputFingerprint: string;
    kind: "audio" | "image" | "text" | "video";
    nodeDataFingerprint: string;
    nodeId: string;
    ownershipKey: string;
    runId: string;
    taskId: string;
  };
};

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
  /** Read the current durable server graph revision while holding Canvas admission. */
  readAuthoritativeCanvasRevision: () => Promise<number>;
  /** Reload a newer authoritative Canvas document after server-side projection. */
  refreshAuthoritativeCanvasDocument: (signal?: AbortSignal) => Promise<boolean>;
  adoptAuthoritativeGenerationMutation: (
    mutation: AuthoritativeGenerationCanvasMutation,
  ) => boolean;
  /** Wait until the current on-screen graph is durably saved before submitting. */
  flushCanvasSave: (signal?: AbortSignal) => Promise<void>;
  /**
   * Wait until the canvas is durably saved AND the latest React render has a
   * confirmed revision. Used by generation paths that must not read a stale
   * "canvas is still saving" state from an older render closure.
   */
  waitForCanvasRevision: (
    timeoutMs?: number,
    signal?: AbortSignal,
  ) => Promise<number>;
};

export const GenerationCanvasContext = createContext<GenerationCanvasState>({
  accountId: "",
  canvasId: "",
  fixtureScopeId: "",
  isFixture: false,
  notify: () => undefined,
  adoptAuthoritativeGenerationMutation: () => false,
  persistenceReady: true,
  retryGenerationEnabled: false,
  readAuthoritativeCanvasRevision: async () => -1,
  refreshAuthoritativeCanvasDocument: async () => false,
  flushCanvasSave: async () => {},
  waitForCanvasRevision: async () => -1,
});

export function useGenerationCanvas() {
  return useContext(GenerationCanvasContext);
}
