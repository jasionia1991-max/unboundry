import {
  GenerationRequestError,
  waitForGenerationTask,
  type GenerationTaskSummary,
} from "./generationTasks";

export const POLLING_PAUSED_MESSAGE = "任务状态查询失败，点击重试重新检查";

function isPollingAbortError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "name" in error &&
      error.name === "AbortError",
  );
}

/**
 * A transient polling failure (network or server-side 5xx) pauses the local
 * poll instead of marking the durable task failed. The caller keeps the task
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
    return await waitForGenerationTask(taskId, signal, fixtureScopeId);
  } catch (error) {
    if (isPollingAbortError(error)) throw error;
    if (isTransientPollingError(error)) onPause();
    throw error;
  }
}
