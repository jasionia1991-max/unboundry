import { friendlyGenerationMessage } from "./friendlyGenerationMessage";
import type { NodeRunResult } from "./workflowExecution";

/**
 * Workflow node entry that first waits for the canvas to be durably saved and
 * for the latest render to carry a confirmed revision, then runs the real
 * generation routine. A save failure becomes a friendly node result instead
 * of silently skipping the rest of the group run.
 */
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
