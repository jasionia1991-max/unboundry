import {
  generationNeedsReconcile,
  safelyRetryableGenerationTask,
} from "./generationRetry";
import {
  getGenerationTask,
  reconcileGenerationTask,
  reconcileOutcomeMessage,
  retryGenerationTask,
  waitForGenerationTask,
  type GenerationRetryGate,
  type GenerationTaskKind,
  type GenerationTaskSummary,
} from "./generationTasks";

export function workflowRecoveryPlan(task: {
  errorCode?: string | null;
  retryAllowed?: boolean;
  retryBlockCode?: string | null;
  state: string;
}) {
  if (task.state === "success") return "success" as const;
  if (task.state !== "failed") return "skip" as const;
  if (task.retryAllowed === true) return "retry" as const;
  if (generationNeedsReconcile(task.errorCode, task.retryBlockCode)) {
    return "reconcile" as const;
  }
  return "stop" as const;
}

export async function recoverWorkflowGenerationOnce(input: {
  canvasId: string;
  generationInputKey: string;
  kind: GenerationTaskKind;
  nodeId: string;
  taskId: string;
  waitForCanvasRevision: GenerationRetryGate;
}): Promise<{
  message?: string;
  status: "failed" | "skipped" | "success";
  task?: GenerationTaskSummary;
}> {
  const target = {
    canvasId: input.canvasId,
    generationInputKey: input.generationInputKey,
    kind: input.kind,
    nodeId: input.nodeId,
    taskId: input.taskId,
  };
  let task = await getGenerationTask(input.taskId);
  const plan = workflowRecoveryPlan(task);
  if (plan === "success") return { status: "success", task };
  if (plan === "skip") return { status: "skipped", task };

  if (plan === "reconcile") {
    const result = await reconcileGenerationTask(
      target,
      input.waitForCanvasRevision,
    );
    if (result.outcome === "recovered") {
      const finished = await waitForGenerationTask(result.task.id);
      return finished.state === "success"
        ? { status: "success", task: finished }
        : {
            message: finished.errorMessage,
            status: "failed",
            task: finished,
          };
    }
    if (result.outcome !== "missing") {
      return {
        message: reconcileOutcomeMessage(result.outcome) || result.task.errorMessage,
        status: "failed",
        task: result.task,
      };
    }
    task = result.task;
  }

  if (!safelyRetryableGenerationTask(task)) {
    return {
      message: task.errorMessage,
      status: "failed",
      task,
    };
  }

  const accepted = await retryGenerationTask(target, input.waitForCanvasRevision);
  const finished = await waitForGenerationTask(accepted.id);
  if (finished.state === "success") return { status: "success", task: finished };
  return {
    message: finished.errorMessage,
    status: "failed",
    task: finished,
  };
}
