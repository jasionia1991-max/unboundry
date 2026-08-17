import { formatGenerationDuration } from "./groupRunSummary";

export const TASK_DURATION_EVENT = "unboundry:task-duration";

const finishedStates = new Set(["cancelled", "failed", "success"]);
const labelByTaskId = new Map<string, string>();
const labelByNode = new Map<string, string>();

export function rememberFinishedTaskDuration(task: {
  canvasId?: string;
  createdAt?: string;
  id?: string;
  nodeId?: string;
  state?: string;
  updatedAt?: string;
}) {
  if (!task.id || !task.state || !finishedStates.has(task.state)) return;
  const started = Date.parse(task.createdAt ?? "");
  const ended = Date.parse(task.updatedAt ?? "");
  if (!Number.isFinite(started) || !Number.isFinite(ended) || ended < started) {
    return;
  }
  const label = `用时 ${formatGenerationDuration(ended - started)}`;
  labelByTaskId.set(task.id, label);
  if (task.canvasId && task.nodeId) {
    labelByNode.set(`${task.canvasId}:${task.nodeId}`, label);
  }
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(TASK_DURATION_EVENT));
}

export function readFinishedTaskDuration(
  taskId?: string,
  canvasId?: string,
  nodeId?: string,
) {
  if (taskId) {
    const exact = labelByTaskId.get(taskId);
    if (exact) return exact;
  }
  if (canvasId && nodeId) return labelByNode.get(`${canvasId}:${nodeId}`);
}
