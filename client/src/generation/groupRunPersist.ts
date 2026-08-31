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

function isRetryableAdmissionFailure(result: NodeRunResult): boolean {
  return result.status === "failed" && (
    result.errorCode === "CANVAS_NOT_SAVED" ||
    result.errorCode === "PREFLIGHT_RETRYABLE" ||
    isCanvasNotSavedMessage(result.message)
  );
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
 * Persist the canvas after every group-run node. A deterministic moving-canvas
 * rejection stays in the same intent and retries only inside one deadline.
 */
export async function runGroupNodeWithPersist(input: {
  admissionDeadlineMs?: number;
  isCancelled?: () => boolean;
  now?: () => number;
  persist: () => Promise<string | undefined>;
  project?: (projection: GroupResultProjection) => void;
  run: (admissionRemainingMs: () => number) => Promise<NodeRunResult>;
  waitForAdmissionRetry?: (milliseconds: number) => Promise<void>;
}): Promise<NodeRunResult> {
  const now = input.now ?? (() => globalThis.performance?.now() ?? Date.now());
  const deadline = now() + (input.admissionDeadlineMs ?? 30_000);
  const admissionRemainingMs = () => Math.max(0, deadline - now());
  let result = await input.run(admissionRemainingMs);
  while (
    isRetryableAdmissionFailure(result) &&
    now() < deadline
  ) {
    if (
      result.errorCode === "CANVAS_NOT_SAVED" ||
      isCanvasNotSavedMessage(result.message)
    ) {
      const persistError = await input.persist();
      if (persistError) return { message: persistError, status: "failed" };
    }
    if (input.isCancelled?.()) {
      return { message: "已停止后续节点", status: "skipped" };
    }
    if (result.errorCode === "PREFLIGHT_RETRYABLE") {
      const waitMs = Math.min(250, admissionRemainingMs());
      if (waitMs > 0) {
        await (input.waitForAdmissionRetry ?? ((milliseconds) =>
          new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds))))(
            waitMs,
          );
      }
    }
    result = await input.run(admissionRemainingMs);
  }
  if (isRetryableAdmissionFailure(result)) {
    result = result.errorCode === "PREFLIGHT_RETRYABLE"
      ? {
          errorCode: "PREFLIGHT_TIMEOUT",
          message: "生成预检持续不可用，本次没有创建生成任务。请稍后再试。",
          status: "failed",
        }
      : {
          errorCode: "SAVE_STABILITY_TIMEOUT",
          message: "画布持续变化，本次没有创建生成任务。请停止编辑后再试。",
          status: "failed",
        };
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
