import { useEffect, useState } from "react";
import {
  getGenerationTask,
  listGenerationTasks,
  type GenerationTaskSummary,
} from "./generationTasks";
import { formatGenerationDuration } from "./groupRunSummary";

const finishedStates = new Set(["cancelled", "failed", "success"]);

function labelForTask(task: GenerationTaskSummary) {
  if (!finishedStates.has(task.state)) return;
  const started = Date.parse(task.createdAt);
  const ended = Date.parse(task.updatedAt);
  if (!Number.isFinite(started) || !Number.isFinite(ended) || ended < started) {
    return;
  }
  return `用时 ${formatGenerationDuration(ended - started)}`;
}

export function useFinishedGenerationDuration(
  taskId: string | undefined,
  enabled: boolean,
  lookup?: { canvasId?: string; nodeId?: string },
) {
  const [label, setLabel] = useState<string>();
  const canvasId = lookup?.canvasId;
  const nodeId = lookup?.nodeId;

  useEffect(() => {
    if (!enabled || (!taskId && !(canvasId && nodeId))) {
      setLabel(undefined);
      return;
    }
    const controller = new AbortController();
    void (async () => {
      if (taskId) {
        try {
          const task = await getGenerationTask(taskId, controller.signal);
          if (controller.signal.aborted) return;
          const next = labelForTask(task);
          if (next) {
            setLabel(next);
            return;
          }
        } catch {
          if (controller.signal.aborted) return;
        }
      }
      if (!canvasId || !nodeId) {
        if (!controller.signal.aborted) setLabel(undefined);
        return;
      }
      try {
        const tasks = await listGenerationTasks(canvasId, controller.signal);
        if (controller.signal.aborted) return;
        const latest = tasks
          .filter((task) => task.nodeId === nodeId && finishedStates.has(task.state))
          .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
        setLabel(latest ? labelForTask(latest) : undefined);
      } catch {
        if (!controller.signal.aborted) setLabel(undefined);
      }
    })();
    return () => controller.abort();
  }, [canvasId, enabled, nodeId, taskId]);

  return label;
}
