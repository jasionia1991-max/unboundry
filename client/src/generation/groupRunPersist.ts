import type { NodeRunResult } from "./workflowExecution";

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
  flushCanvasSave: () => Promise<void>;
  waitForCanvasRevision: () => Promise<unknown>;
  waitForPaint?: () => Promise<void>;
}): Promise<string | undefined> {
  try {
    await (input.waitForPaint ?? waitForPaint)();
    await input.flushCanvasSave();
    await input.waitForCanvasRevision();
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
  run: () => Promise<NodeRunResult>;
}): Promise<NodeRunResult> {
  let result = await input.run();
  if (isCanvasNotSavedMessage(result.message) && result.status === "failed") {
    const persistError = await input.persist();
    if (persistError) return { message: persistError, status: "failed" };
    if (input.isCancelled?.()) {
      return { message: "整组执行已取消", status: "skipped" };
    }
    result = await input.run();
  }
  const persistError = await input.persist();
  if (persistError && result.status === "success") {
    return { message: persistError, status: "failed" };
  }
  return result;
}
