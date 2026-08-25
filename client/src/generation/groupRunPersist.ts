import type { NodeRunResult } from "./workflowExecution";
import type { CanvasSavePort } from "../canvas/canvasPorts";
import {
  enqueueGroupResultProjection,
  type GroupResultProjection,
} from "./groupResultProjection";

export function workflowToastDurationMs(
  kind: "error" | "info" | "success",
): number {
  return kind === "error" ? 8_000 : 2_600;
}

export function shouldAcceptCanvasRevision(input: {
  dirty: boolean;
  revision: number | undefined;
  saving: boolean;
}): input is { dirty: false; revision: number; saving: false } {
  return !input.dirty && !input.saving && input.revision !== undefined;
}

export function isCanvasNotSavedMessage(message?: string): boolean {
  if (!message) return false;
  return message.includes("画布内容还在保存") ||
    message.includes("画布还在保存");
}

export function shouldIgnoreStaleCanvasSaveProblem(problem?: {
  message?: string;
}): boolean {
  return isCanvasNotSavedMessage(problem?.message);
}

const staleCanvasSaveErrorFields = [
  ["audioGenerationError", "audioGenerationErrorCode"],
  ["imageGenerationError", "imageGenerationErrorCode"],
  ["textGenerationError", "textGenerationErrorCode"],
  ["videoGenerationError", "videoGenerationErrorCode"],
] as const;

export function stripStaleCanvasSaveErrors<
  Node extends { data?: Record<string, unknown>; parentId?: string },
>(nodes: readonly Node[], groupId: string): { changed: boolean; nodes: Node[] } {
  let changed = false;
  const next = nodes.map((node) => {
    if (node.parentId !== groupId) return node;
    const data = node.data;
    if (!data) return node;
    let nextData: Record<string, unknown> | undefined;
    for (const [errorKey, codeKey] of staleCanvasSaveErrorFields) {
      const message = data[errorKey];
      if (typeof message !== "string" || !isCanvasNotSavedMessage(message)) {
        continue;
      }
      if (!nextData) nextData = { ...data };
      delete nextData[errorKey];
      delete nextData[codeKey];
    }
    if (!nextData) return node;
    changed = true;
    return { ...node, data: nextData };
  });
  return { changed, nodes: changed ? next : [...nodes] };
}

export function waitForPaint(): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    if (
      typeof window === "undefined" ||
      typeof window.requestAnimationFrame !== "function"
    ) {
      setTimeout(done, 0);
      return;
    }
    const fallback = window.setTimeout(done, 100);
    window.requestAnimationFrame(() => {
      window.clearTimeout(fallback);
      done();
    });
  });
}

export async function persistGroupCanvasAfterNode(input: {
  save: CanvasSavePort;
  waitForPaint?: () => Promise<void>;
}): Promise<string | undefined> {
  try {
    await (input.waitForPaint ?? waitForPaint)();
    await input.save.flush();
    await input.save.waitForRevision();
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : "画布还在保存，请稍后再试";
  }
}

/**
 * Persist the canvas after every group-run node, and retry once when the node
 * failed only because the canvas revision was still moving.
 */
export async function runGroupNodeWithPersist(input: {
  isCancelled?: () => boolean;
  persist: () => Promise<string | undefined>;
  project?: (projection: GroupResultProjection) => void;
  run: () => Promise<NodeRunResult>;
}): Promise<NodeRunResult> {
  let result = await input.run();
  if (isCanvasNotSavedMessage(result.message) && result.status === "failed") {
    const persistError = await input.persist();
    if (persistError) return { message: persistError, status: "failed" };
    if (input.isCancelled?.()) {
      return { message: "已停止后续节点", status: "skipped" };
    }
    result = await input.run();
  }
  const persistError = await input.persist();
  if (persistError && result.status === "success") {
    if (result.projection) {
      if (input.project) input.project(result.projection);
      else void enqueueGroupResultProjection(result.projection);
      return { ...result, projectionState: "pending" };
    }
    // Execution truth has already been established. A display projection
    // failure must never be reclassified as a Provider or node failure.
    return result;
  }
  return result.projection && result.status === "success"
    ? { ...result, projectionState: "applied" }
    : result;
}
