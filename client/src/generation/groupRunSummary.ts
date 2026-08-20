export const GROUP_RUN_SUMMARY_EVENT = "unboundry:group-run-summary";
export const GROUP_RUN_SUMMARY_CACHE_LIMIT = 128;
export const GROUP_RUN_SUMMARY_DISMISSAL_LIMIT = 256;

export type GroupRunSummaryScope = {
  accountId: string;
  canvasId: string;
  fixtureScopeId: string;
};

export type GroupRunSummary = GroupRunSummaryScope & {
  blockedCount: number;
  blockedNodeIds: string[];
  completedAt: number;
  elapsedMs: number;
  errorCode?: string;
  failedCount: number;
  failedNodeIds: string[];
  firstFailedNodeId?: string;
  firstFailedNodeTitle?: string;
  groupId: string;
  nodeCount: number;
  reason?: string;
  runId: string;
  runSequence: number;
  skippedCount: number;
  skippedNodeIds: string[];
  status: "cancelled" | "failed" | "skipped" | "success";
  startedAt: number;
  successCount: number;
};

const lastGroupRunById = new Map<string, GroupRunSummary>();
const dismissedGroupRuns = new Set<string>();
let groupRunSequence = 0;

export function createGroupRunSummaryScope(
  accountId: string,
  canvasId: string,
  fixtureScopeId: string,
): GroupRunSummaryScope {
  return { accountId, canvasId, fixtureScopeId };
}

export function nextGroupRunSequence() {
  groupRunSequence += 1;
  return groupRunSequence;
}

export function groupRunSummaryScopeKey(scope: GroupRunSummaryScope) {
  return JSON.stringify([
    scope.accountId,
    scope.canvasId,
    scope.fixtureScopeId,
  ]);
}

function groupRunSummaryCacheKey(
  scope: GroupRunSummaryScope,
  groupId: string,
) {
  return `${groupRunSummaryScopeKey(scope)}:${JSON.stringify(groupId)}`;
}

function groupRunSummaryDismissalKey(summary: GroupRunSummary) {
  return `${groupRunSummaryCacheKey(summary, summary.groupId)}:${JSON.stringify(summary.runId)}`;
}

function rememberBounded<T>(collection: Map<string, T>, key: string, value: T) {
  collection.delete(key);
  collection.set(key, value);
  while (collection.size > GROUP_RUN_SUMMARY_CACHE_LIMIT) {
    const oldest = collection.keys().next().value;
    if (oldest === undefined) break;
    collection.delete(oldest);
  }
}

function rememberBoundedDismissal(key: string) {
  dismissedGroupRuns.delete(key);
  dismissedGroupRuns.add(key);
  while (dismissedGroupRuns.size > GROUP_RUN_SUMMARY_DISMISSAL_LIMIT) {
    const oldest = dismissedGroupRuns.values().next().value;
    if (oldest === undefined) break;
    dismissedGroupRuns.delete(oldest);
  }
}

export function groupRunSummaryMatchesScope(
  summary: GroupRunSummary,
  scope: GroupRunSummaryScope,
) {
  return groupRunSummaryScopeKey(summary) === groupRunSummaryScopeKey(scope);
}

export function publishGroupRunSummary(summary: GroupRunSummary) {
  if (
    !summary.accountId ||
    !summary.canvasId ||
    !summary.groupId ||
    !summary.runId ||
    !Number.isSafeInteger(summary.runSequence) ||
    summary.runSequence < 1
  ) return;
  const cacheKey = groupRunSummaryCacheKey(summary, summary.groupId);
  const current = lastGroupRunById.get(cacheKey);
  if (current && current.runSequence > summary.runSequence) return;
  rememberBounded(
    lastGroupRunById,
    cacheKey,
    summary,
  );
  window.dispatchEvent(
    new CustomEvent<GroupRunSummary>(GROUP_RUN_SUMMARY_EVENT, {
      detail: summary,
    }),
  );
}

export function readLastGroupRunSummary(scope: GroupRunSummaryScope) {
  let latest: GroupRunSummary | undefined;
  for (const summary of lastGroupRunById.values()) {
    if (groupRunSummaryMatchesScope(summary, scope)) latest = summary;
  }
  return latest;
}

export function readLastGroupRunSummaryForGroup(
  scope: GroupRunSummaryScope,
  groupId: string,
) {
  return lastGroupRunById.get(groupRunSummaryCacheKey(scope, groupId));
}

export function dismissGroupRunSummary(summary: GroupRunSummary) {
  rememberBoundedDismissal(groupRunSummaryDismissalKey(summary));
}

export function isGroupRunSummaryDismissed(summary: GroupRunSummary) {
  return dismissedGroupRuns.has(groupRunSummaryDismissalKey(summary));
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
