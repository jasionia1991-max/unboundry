import {
  GenerationRequestError,
  waitForGenerationTask,
  type GenerationTaskSummary,
} from "./generationTasks";

export const POLLING_PAUSED_MESSAGE = "任务状态查询失败，点击重试重新检查";

export function workflowBlocksSingleNodeRecovery(input: {
  locked: boolean;
  workflowExecutionRunId?: unknown;
}) {
  return input.locked || Boolean(input.workflowExecutionRunId);
}

function isPollingAbortError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "name" in error &&
      error.name === "AbortError",
  );
}

/**
 * An exhausted transient status read pauses the local poll instead of marking
 * the durable task failed. The caller keeps the task
 * id and offers a “重新检查” action that resumes polling.
 */
export function isTransientPollingError(error: unknown): boolean {
  if (isPollingAbortError(error)) return false;
  if (!(error instanceof GenerationRequestError)) return true;
  return error.status === 0 || error.status >= 500;
}

export async function waitForGenerationTaskWithPause(
  taskId: string,
  onPause: () => void,
  signal?: AbortSignal,
  fixtureScopeId = "",
): Promise<GenerationTaskSummary> {
  try {
    const task = await waitForGenerationTask(taskId, signal, fixtureScopeId, {
      retryTransientStatusReads: true,
    });
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    return task;
  } catch (error) {
    if (isPollingAbortError(error)) throw error;
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (isTransientPollingError(error)) onPause();
    throw error;
  }
}
