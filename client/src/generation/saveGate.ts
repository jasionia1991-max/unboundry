import { friendlyGenerationMessage } from "./friendlyGenerationMessage";
import type { NodeRunResult } from "./workflowExecution";

const canvasSubmitTails = new Map<string, Promise<unknown>>();

/**
 * Serialize one canvas's "wait for save → admit task → persist binding"
 * section. Provider work must stay outside this helper so sibling nodes still
 * generate in parallel. Failures release the queue so the next submit runs.
 */
export function runExclusiveCanvasSubmit<T>(
  canvasId: string,
  work: () => Promise<T>,
): Promise<T> {
  const key = canvasId.trim() || "__missing-canvas__";
  const previous = canvasSubmitTails.get(key) ?? Promise.resolve();
  const run = previous.then(work, work);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  canvasSubmitTails.set(key, tail);
  void tail.then(() => {
    if (canvasSubmitTails.get(key) === tail) canvasSubmitTails.delete(key);
  });
  return run;
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
