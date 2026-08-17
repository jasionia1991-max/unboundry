export const GROUP_RUN_SUMMARY_EVENT = "unboundry:group-run-summary";

export type GroupRunSummary = {
  canvasId: string;
  elapsedMs: number;
  groupId: string;
  nodeCount: number;
  status: "cancelled" | "failed" | "skipped" | "success";
};

let lastGroupRunSummary: GroupRunSummary | undefined;
const lastGroupRunById = new Map<string, GroupRunSummary>();

export function publishGroupRunSummary(summary: GroupRunSummary) {
  lastGroupRunSummary = summary;
  lastGroupRunById.set(`${summary.canvasId}:${summary.groupId}`, summary);
  window.dispatchEvent(
    new CustomEvent<GroupRunSummary>(GROUP_RUN_SUMMARY_EVENT, {
      detail: summary,
    }),
  );
}

export function readLastGroupRunSummary(canvasId: string) {
  return lastGroupRunSummary?.canvasId === canvasId
    ? lastGroupRunSummary
    : undefined;
}

export function readLastGroupRunSummaryForGroup(canvasId: string, groupId: string) {
  return lastGroupRunById.get(`${canvasId}:${groupId}`);
}

export function formatGenerationDuration(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 1) return "不足 1 秒";
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  if (minutes > 0) {
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }
  return `${seconds} 秒`;
}
