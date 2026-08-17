import { useEffect, useState } from "react";
import {
  readFinishedTaskDuration,
  TASK_DURATION_EVENT,
} from "./taskDurationCache";

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
    const read = () => {
      setLabel(readFinishedTaskDuration(taskId, canvasId, nodeId));
    };
    read();
    window.addEventListener(TASK_DURATION_EVENT, read);
    return () => window.removeEventListener(TASK_DURATION_EVENT, read);
  }, [canvasId, enabled, nodeId, taskId]);

  return label;
}
