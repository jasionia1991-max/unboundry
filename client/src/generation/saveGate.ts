import { friendlyGenerationMessage } from "./friendlyGenerationMessage";
import type { NodeRunResult } from "./workflowExecution";

const canvasSubmitTails = new Map<string, Promise<unknown>>();

type CanvasSubmitLane = "generation" | "server-workflow";

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException("Aborted", "AbortError");
  }
}

function runInProcessCanvasSubmit<T>(
  key: string,
  work: () => Promise<T>,
  signal?: AbortSignal,
) {
  const guardedWork = () => {
    throwIfAborted(signal);
    return work();
  };
  const previous = canvasSubmitTails.get(key) ?? Promise.resolve();
  const waitForPrevious = signal
    ? new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
        };
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
        void previous.finally(() => {
          signal.removeEventListener("abort", onAbort);
          resolve();
        });
      })
    : previous.then(() => undefined);
  const run = waitForPrevious.then(guardedWork);
  const tail = Promise.allSettled([previous, run]).then(() => undefined);
  canvasSubmitTails.set(key, tail);
  void tail.then(() => {
    if (canvasSubmitTails.get(key) === tail) canvasSubmitTails.delete(key);
  });
  return run;
}

/**
 * Serialize one canvas's "wait for save → admit task → persist binding"
 * section. Provider work must stay outside this helper so sibling nodes still
 * generate in parallel. Failures release the queue so the next submit runs.
 */
function runExclusiveCanvasSubmitLane<T>(
  canvasId: string,
  work: () => Promise<T>,
  lane: CanvasSubmitLane,
  signal?: AbortSignal,
): Promise<T> {
  const canvasKey = canvasId.trim() || "__missing-canvas__";
  const key = `${lane}:${canvasKey}`;
  throwIfAborted(signal);
  if (typeof navigator !== "undefined" && navigator.locks) {
    const lockName = lane === "generation"
      ? `unboundry:canvas-submit:${encodeURIComponent(canvasKey)}`
      : `unboundry:server-workflow-submit:${encodeURIComponent(canvasKey)}`;
    return navigator.locks.request(
      lockName,
      { mode: "exclusive", signal },
      async () => {
        throwIfAborted(signal);
        return work();
      },
    );
  }
  return runInProcessCanvasSubmit(key, work, signal);
}

export function runExclusiveCanvasSubmit<T>(
  canvasId: string,
  work: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  return runExclusiveCanvasSubmitLane(canvasId, work, "generation", signal);
}

/**
 * Server-owned workflows have their own short create lane. They must not wait
 * behind legacy/single-node browser admissions: the server transaction is the
 * authoritative graph, active-task, overlap and idempotency fence.
 */
export function runExclusiveServerWorkflowSubmit<T>(
  canvasId: string,
  work: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  return runExclusiveCanvasSubmitLane(
    canvasId,
    work,
    "server-workflow",
    signal,
  );
}

export function createSaveGateRun(
  waitForCanvasRevision: () => Promise<number>,
  run: () => Promise<NodeRunResult>,
  kind: "audio" | "image" | "text" | "video",
): () => Promise<NodeRunResult> {
  return async () => {
    try {
      await waitForCanvasRevision();
    } catch (error) {
      return {
        message: friendlyGenerationMessage(
          error instanceof Error ? error.message : undefined,
          kind,
        ),
        status: "failed",
      };
    }
    return run();
  };
}
