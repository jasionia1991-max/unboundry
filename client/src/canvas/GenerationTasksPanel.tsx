import { useEffect, useRef, useState, type Ref } from "react";
import {
  abandonGenerationTask,
  cancelGenerationTask,
  GENERATION_TASK_RETRY_ACCEPTED_EVENT,
  getGenerationTask,
  listGenerationTasks,
  reconcileGenerationTask,
  reconcileOutcomeMessage,
  retryGenerationTask,
  type GenerationTaskSummary,
} from "../generation/generationTasks";
import {
  formatGenerationDuration,
  GROUP_RUN_SUMMARY_EVENT,
  dismissGroupRunSummary,
  groupRunSummaryMatchesScope,
  isActiveGroupRunStatus,
  isGroupRunSummaryDismissed,
  readLastGroupRunSummary,
  type GroupRunSummary,
  type GroupRunSummaryScope,
} from "../generation/groupRunSummary";
import {
  clearGroupRunCheckpoint,
  GROUP_RUN_AUTHORITY_EVENT,
  GROUP_RUN_CHECKPOINT_EVENT,
  groupRunAuthorityRecoverySupported,
  isGroupRunAuthoritySettledEmpty,
  readGroupRunCheckpointCache,
  requestGroupRunContinue,
  requestGroupRunStop,
  type GroupRunCheckpoint,
} from "../generation/groupRunCheckpoint";
import {
  listServerWorkflowRuns,
  mergeServerWorkflowRuns,
  parseServerWorkflowRunUpdatedEventDetail,
  SERVER_WORKFLOW_RUN_UPDATED_EVENT,
  getServerWorkflowContinuation,
  getServerWorkflowContinuationPreview,
  stopServerWorkflowRunAndConfirm,
  workflowRunStatusReadIsRetryable,
  type ServerWorkflowRun,
} from "../generation/workflowRuns";
import {
  recoveryStatusLabel,
} from "../generation/generationRecoveryClient";
import { useGenerationRecovery } from "../generation/GenerationRecoveryContext";
import { GENERATION_SUBMIT_SETTLED_EVENT } from "../generation/saveGate";
import { useWorkflowExecution } from "../generation/WorkflowExecutionProvider";
import type { RecoveryCaseSummary } from "../../../types/generationRecovery";
import type { WorkflowContinuationPreview } from "../../../types/workflowRuns";
import {
  generationTaskErrorText,
  isFriendlyChineseMessage,
  userFacingErrorMessage,
} from "./generationErrorText";

const kindLabels: Record<GenerationTaskSummary["kind"], string> = {
  audio: "音频",
  image: "图片",
  text: "文字",
  video: "视频",
};

const stateLabels: Record<GenerationTaskSummary["state"], string> = {
  cancelled: "已取消",
  failed: "失败",
  queued: "排队中",
  recovering: "恢复中",
  retrying: "重试中",
  running: "运行中",
  success: "已完成",
};

const activeStates = new Set<GenerationTaskSummary["state"]>([
  "queued",
  "recovering",
  "retrying",
  "running",
]);

// Continuation reads are GET-only and may safely retry a transient transport
// failure. Keep each burst bounded, then leave a slow read-only recheck alive
// so a brief backend restart does not strand the action until the user reloads
// the page.
const continuationReadRetryDelaysMs = [250, 750, 1_500] as const;
const continuationReadRecheckDelayMs = 15_000;

function waitForContinuationReadRetry(signal: AbortSignal, delayMs: number) {
  if (signal.aborted) {
    return Promise.reject(
      signal.reason ?? new DOMException("Aborted", "AbortError"),
    );
  }
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    };
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function visibleGroupRunSummary(summary: GroupRunSummary | undefined) {
  return summary && (
    isActiveGroupRunStatus(summary.status) ||
    !isGroupRunSummaryDismissed(summary)
  )
    ? summary
    : undefined;
}

function relativeTime(timestamp: string) {
  const delta = Math.max(0, Date.now() - new Date(timestamp).getTime());
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

function taskDurationLabel(task: GenerationTaskSummary) {
  if (activeStates.has(task.state)) return relativeTime(task.updatedAt);
  const started = Date.parse(task.createdAt);
  const ended = Date.parse(task.updatedAt);
  if (!Number.isFinite(started) || !Number.isFinite(ended) || ended < started) {
    return relativeTime(task.updatedAt);
  }
  return `用时 ${formatGenerationDuration(ended - started)}`;
}

function safeTaskResultSource(task: GenerationTaskSummary) {
  const value = task.resultUrl?.trim();
  if (!value || !(value.startsWith("/") || /^https?:\/\//i.test(value))) {
    return undefined;
  }
  return value;
}

// Polling cadence: fast while something can change soon, slow when idle.
const activePollIntervalMs = 3_000;
const idlePollIntervalMs = 15_000;
// After opening the panel or any local submit, stay fast briefly so a new
// task appears promptly even before the list shows it as active.
const fastPollGraceMs = 60_000;

function documentIsVisible() {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

const stuckRunningThresholdMs: Record<GenerationTaskSummary["kind"], number> = {
  audio: 10 * 60_000,
  image: 10 * 60_000,
  text: 10 * 60_000,
  video: 20 * 60_000,
};

/**
 * Plain explanation for a task that has been waiting unusually long. The
 * server keeps recovering it automatically and closes it after its safety
 * window, so the owner is told what is happening instead of seeing a spinner.
 */
export function stuckTaskHint(task: GenerationTaskSummary, now = Date.now()) {
  if (task.state !== "recovering" && task.state !== "running" && task.state !== "retrying") {
    return undefined;
  }
  const started = Date.parse(task.createdAt);
  if (!Number.isFinite(started)) return undefined;
  const elapsed = Math.max(0, now - started);
  if (task.state !== "recovering" && elapsed < stuckRunningThresholdMs[task.kind]) {
    return undefined;
  }
  const waited = `已等待 ${formatGenerationDuration(elapsed)}。`;
  return task.state === "recovering"
    ? `${waited}系统仍在自动找回结果，最长约 1 天后会自动结束；如果平台稍后生成成功，结果会出现在素材库，不会重复扣费。`
    : `${waited}平台仍在生成，系统会继续等待结果，最长约 1 天后会自动结束；期间不会重复扣费。`;
}

const projectionRecoverableStates = new Set(["conflict", "failed"]);

/** A successful media result that never made it back onto the canvas. */
export function taskResultNeedsCanvasPlacement(
  task: GenerationTaskSummary,
  workflowProjectionState?: string,
) {
  return task.state === "success" &&
    (task.kind === "image" || task.kind === "video" || task.kind === "audio") &&
    Boolean(task.resultAssetId?.trim()) &&
    Boolean(safeTaskResultSource(task)) &&
    (projectionRecoverableStates.has(task.canvasProjectionState ?? "") ||
      projectionRecoverableStates.has(workflowProjectionState ?? ""));
}

function TaskErrorLine({
  conflict,
  task,
}: {
  conflict: boolean;
  task: GenerationTaskSummary;
}) {
  const showError = task.state === "failed" || task.state === "cancelled";
  if (!conflict && !(showError && (task.errorCode || task.errorMessage))) return null;
  const text = conflict
    ? generationTaskErrorText({
        code: task.canvasProjectionState === "failed"
          ? "CANVAS_PROJECTION_FAILED"
          : "CANVAS_SERVER_OWNERSHIP_CONFLICT",
        kind: task.kind,
      })
    : generationTaskErrorText({
        code: task.errorCode,
        kind: task.kind,
        message: task.errorMessage,
      });
  return (
    <div className="tasks-row-error" data-testid={`tasks-row-error-${task.id}`}>
      <span>{text.summary}</span>
      {text.action && (
        <span className="tasks-row-error-action">{`（${text.action}）`}</span>
      )}
      {!conflict && text.detail && (
        <details>
          <summary>详情</summary>
          <p>{text.detail}</p>
        </details>
      )}
    </div>
  );
}

function groupProblemText(summary: GroupRunSummary) {
  if (summary.reason && isFriendlyChineseMessage(summary.reason)) return summary.reason;
  const text = generationTaskErrorText({ code: summary.errorCode, message: summary.reason });
  return text.action ? `${text.summary}（${text.action}）` : text.summary;
}

function RecoveryTaskResult({ task }: { task: GenerationTaskSummary }) {
  const source = safeTaskResultSource(task);
  const text = task.resultText?.trim();
  return (
    <div className="tasks-recovery-result-body">
      <span className="tasks-recovery-result-state">
        {kindLabels[task.kind]} · {stateLabels[task.state]}
      </span>
      {task.kind === "text" && text ? (
        <pre>{text}</pre>
      ) : source ? (
        <a
          href={source}
          rel="noreferrer"
          target="_blank"
        >
          打开原任务结果
        </a>
      ) : task.state === "success" ? (
        <p>原任务结果已找回，并保留在这条任务记录中。</p>
      ) : (
        <p>原任务仍保留，结果暂时无法读取。</p>
      )}
    </div>
  );
}

function recoveryHistoryHint(
  cases: readonly RecoveryCaseSummary[],
) {
  if (cases.some((item) => item.status === "result_pending")) {
    return "结果已找回，系统正在写回画布；你不用重复点击生成。";
  }
  if (cases.some((item) => item.status === "recovering" || item.status === "scheduled")) {
    return "系统会继续自动核对原请求；你不用重复点击生成。";
  }
  if (cases.some((item) => item.status === "queued")) {
    return "这项处理已登记，平台或维护人员会继续跟进；你不用重复点击生成。";
  }
  if (cases.some((item) => item.status === "claimed")) {
    return "维护人员已接手这项处理，原任务记录会保留。";
  }
  if (cases.some((item) => item.status === "waiting_provider")) {
    return "正在等待平台回复，原任务记录会保留。";
  }
  return "这里显示已登记的处理结果，原任务记录会保留。";
}

function TaskRow({
  canvasId,
  canvasScopeId,
  groupRunScope,
  getActionSignal,
  isCurrentScope,
  onActionError,
  onApplyToCanvas,
  onChanged,
  retryEnabled,
  task,
  waitForCanvasRevision,
  workflowProjectionState,
}: {
  canvasId: string;
  canvasScopeId: string;
  groupRunScope: GroupRunSummaryScope;
  getActionSignal: (
    scopeId: string,
    canvasId: string,
  ) => AbortSignal | undefined;
  isCurrentScope: (scopeId: string, canvasId: string) => boolean;
  onActionError: (message: string) => void;
  onApplyToCanvas?: (task: GenerationTaskSummary) => boolean;
  onChanged: () => void;
  retryEnabled: boolean;
  task: GenerationTaskSummary;
  waitForCanvasRevision?: () => Promise<number>;
  workflowProjectionState?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState(false);
  const needsPlacement = taskResultNeedsCanvasPlacement(task, workflowProjectionState);
  const stuckHint = stuckTaskHint(task);
  const active = activeStates.has(task.state);
  const abandonable = task.state === "failed" && task.abandonAllowed === true;
  const retryable = task.state === "failed" && task.retryAllowed === true;
  const reconcilable =
    task.state === "failed" && task.reconcileAllowed === true;
  const rowIsCurrent =
    task.canvasId === canvasId &&
    (task.fixtureScopeId ?? "") === groupRunScope.fixtureScopeId &&
    isCurrentScope(canvasScopeId, canvasId);
  return (
    <li
      className="tasks-row"
      data-state={task.state}
      data-testid={`tasks-row-${task.id}`}
    >
      <span className="tasks-row-kind" title={kindLabels[task.kind]}>
        {kindLabels[task.kind]}
      </span>
      <span className="tasks-row-prompt" title={task.prompt}>
        {task.prompt}
      </span>
      <span className={`tasks-row-state tasks-state-${task.state}`}>
        {stateLabels[task.state]}
      </span>
      <span
        className="tasks-row-time"
        data-testid={`tasks-row-time-${task.id}`}
        title={relativeTime(task.updatedAt)}
      >
        {taskDurationLabel(task)}
      </span>
      <span className="tasks-row-actions">
        {active && (
          <button
            disabled={busy || !rowIsCurrent}
            onClick={() => {
              if (
                task.canvasId !== canvasId ||
                !isCurrentScope(canvasScopeId, canvasId)
              ) return;
              const signal = getActionSignal(canvasScopeId, canvasId);
              if (!signal) return;
              setBusy(true);
              void cancelGenerationTask(
                task.id,
                signal,
                groupRunScope.fixtureScopeId,
              )
                .then(() => {
                  if (isCurrentScope(canvasScopeId, canvasId)) onActionError("");
                })
                .catch((error: unknown) => {
                  if (signal.aborted || !isCurrentScope(canvasScopeId, canvasId)) return;
                  onActionError(userFacingErrorMessage(
                    error,
                    "暂时无法取消该任务，系统会继续自动处理，请稍后再试",
                  ));
                })
                .finally(() => {
                  if (!isCurrentScope(canvasScopeId, canvasId)) return;
                  setBusy(false);
                  onChanged();
                });
            }}
            type="button"
          >
            取消
          </button>
        )}
        {reconcilable && (
          <button
            data-testid={`tasks-reconcile-${task.id}`}
            disabled={
              busy ||
              !rowIsCurrent ||
              !retryEnabled ||
              !waitForCanvasRevision ||
              !task.generationInputKey ||
              !task.generationOwnershipKey ||
              !task.modelInputContractFingerprint ||
              !task.modelConfigurationRevision ||
              !task.modelReleaseRevision
            }
            onClick={() => {
              if (
                task.canvasId !== canvasId ||
                !isCurrentScope(canvasScopeId, canvasId) ||
                !retryEnabled ||
                !waitForCanvasRevision ||
                !task.generationInputKey ||
                !task.generationOwnershipKey ||
                !task.modelInputContractFingerprint ||
                !task.modelConfigurationRevision ||
                !task.modelReleaseRevision
              ) return;
              const signal = getActionSignal(canvasScopeId, canvasId);
              if (!signal) return;
              setBusy(true);
              void reconcileGenerationTask({
                accountId: groupRunScope.accountId,
                canvasId: task.canvasId,
                fixtureScopeId: groupRunScope.fixtureScopeId,
                generationInputKey: task.generationInputKey,
                generationOwnershipKey: task.generationOwnershipKey,
                kind: task.kind,
                modelInputContractFingerprint:
                  task.modelInputContractFingerprint,
                modelConfigurationRevision: task.modelConfigurationRevision,
                modelReleaseRevision: task.modelReleaseRevision,
                nodeId: task.nodeId,
                taskId: task.id,
              }, waitForCanvasRevision, undefined, signal)
                .then((result) => {
                  if (!isCurrentScope(canvasScopeId, canvasId)) return;
                  onActionError(reconcileOutcomeMessage(result.outcome));
                  if (result.outcome === "recovered") {
                    window.dispatchEvent(new CustomEvent(
                      GENERATION_TASK_RETRY_ACCEPTED_EVENT,
                      {
                        detail: {
                          attempt: result.task.attempt,
                          canvasId: result.task.canvasId,
                          kind: result.task.kind,
                          nodeId: result.task.nodeId,
                          taskId: result.task.id,
                          updatedAt: result.task.updatedAt,
                        },
                      },
                    ));
                  }
                  onChanged();
                })
                .catch((error: unknown) => {
                  if (!isCurrentScope(canvasScopeId, canvasId)) return;
                  onActionError(
                    userFacingErrorMessage(error, "核对结果失败，请稍后再试"),
                  );
                })
                .finally(() => {
                  if (!isCurrentScope(canvasScopeId, canvasId)) return;
                  setBusy(false);
                });
            }}
            type="button"
          >
            {busy ? "核对中" : "核对结果"}
          </button>
        )}
        {retryable && (
          <button
            data-testid={`tasks-retry-${task.id}`}
            disabled={
              busy ||
              !rowIsCurrent ||
              !retryEnabled ||
              !waitForCanvasRevision ||
              !task.generationInputKey ||
              !task.generationOwnershipKey ||
              !task.modelInputContractFingerprint ||
              !task.modelConfigurationRevision ||
              !task.modelReleaseRevision
            }
            onClick={() => {
              if (
                task.canvasId !== canvasId ||
                !isCurrentScope(canvasScopeId, canvasId) ||
                !retryEnabled ||
                !waitForCanvasRevision ||
                !task.generationInputKey ||
                !task.generationOwnershipKey ||
                !task.modelInputContractFingerprint ||
                !task.modelConfigurationRevision ||
                !task.modelReleaseRevision
              ) return;
              const signal = getActionSignal(canvasScopeId, canvasId);
              if (!signal) return;
              setBusy(true);
              void retryGenerationTask({
                accountId: groupRunScope.accountId,
                canvasId: task.canvasId,
                fixtureScopeId: groupRunScope.fixtureScopeId,
                generationInputKey: task.generationInputKey,
                generationOwnershipKey: task.generationOwnershipKey,
                kind: task.kind,
                modelInputContractFingerprint:
                  task.modelInputContractFingerprint,
                modelConfigurationRevision: task.modelConfigurationRevision,
                modelReleaseRevision: task.modelReleaseRevision,
                nodeId: task.nodeId,
                taskId: task.id,
              }, waitForCanvasRevision, signal)
                .then((accepted) => {
                  if (!isCurrentScope(canvasScopeId, canvasId)) return;
                  onActionError("");
                  window.dispatchEvent(new CustomEvent(
                    GENERATION_TASK_RETRY_ACCEPTED_EVENT,
                    {
                      detail: {
                        attempt: accepted.attempt,
                        canvasId: accepted.canvasId,
                        kind: accepted.kind,
                        nodeId: accepted.nodeId,
                        taskId: accepted.id,
                        updatedAt: accepted.updatedAt,
                      },
                    },
                  ));
                  onChanged();
                })
                .catch((error: unknown) => {
                  if (!isCurrentScope(canvasScopeId, canvasId)) return;
                  onActionError(
                    userFacingErrorMessage(error, "生成任务重试失败，请稍后再试"),
                  );
                })
                .finally(() => {
                  if (!isCurrentScope(canvasScopeId, canvasId)) return;
                  setBusy(false);
                });
            }}
            type="button"
          >
            重试
          </button>
        )}
        {abandonable && (
          <button
            data-testid={`tasks-abandon-${task.id}`}
            disabled={busy || !rowIsCurrent}
            onClick={() => {
              if (
                task.canvasId !== canvasId ||
                !isCurrentScope(canvasScopeId, canvasId)
              ) return;
              if (!window.confirm(
                "放弃后将不再尝试恢复该平台结果，平台那边如果其实已经生成成功，这个结果可能就找不回来了。本操作不会重新付费，也不会向平台发送新的生成请求。确认放弃平台结果？",
              )) return;
              const signal = getActionSignal(canvasScopeId, canvasId);
              if (!signal) return;
              setBusy(true);
              void abandonGenerationTask(
                task,
                signal,
                groupRunScope.fixtureScopeId,
              )
                .then(() => {
                  if (isCurrentScope(canvasScopeId, canvasId)) onActionError("");
                })
                .catch((error: unknown) => {
                  if (signal.aborted || !isCurrentScope(canvasScopeId, canvasId)) return;
                  onActionError(userFacingErrorMessage(
                    error,
                    "暂时无法放弃该平台结果，请刷新后再试",
                  ));
                })
                .finally(() => {
                  if (!isCurrentScope(canvasScopeId, canvasId)) return;
                  setBusy(false);
                  onChanged();
                });
            }}
            type="button"
          >
            放弃平台结果
          </button>
        )}
        {needsPlacement && onApplyToCanvas && (
          <button
            data-testid={`tasks-apply-to-canvas-${task.id}`}
            disabled={busy || !rowIsCurrent}
            onClick={() => {
              if (!isCurrentScope(canvasScopeId, canvasId)) return;
              if (onApplyToCanvas(task)) {
                setApplied(true);
                onActionError("");
              } else {
                onActionError("画布还没准备好，请稍等画布加载完成后再放到画布");
              }
            }}
            title="把素材库里的这个结果作为新节点放到画布上"
            type="button"
          >
            {applied ? "再放一份" : "放到画布"}
          </button>
        )}
      </span>
      {stuckHint && (
        <span className="tasks-row-stuck-hint" data-testid={`tasks-stuck-hint-${task.id}`}>
          {stuckHint}
        </span>
      )}
      <TaskErrorLine conflict={needsPlacement} task={task} />
    </li>
  );
}

export function GenerationTasksPanel({
  canvasScopeId,
  groupRunScope,
  onApplyResultToCanvas,
  onLocateNode,
  open,
  panelRef,
  retryEnabled,
  waitForCanvasRevision,
}: {
  canvasScopeId: string;
  groupRunScope: GroupRunSummaryScope;
  /** Inserts a successful library result as a new canvas node; false when not possible now. */
  onApplyResultToCanvas?: (task: GenerationTaskSummary) => boolean;
  onLocateNode: (nodeId: string) => void;
  open: boolean;
  panelRef?: Ref<HTMLElement>;
  retryEnabled: boolean;
  waitForCanvasRevision?: () => Promise<number>;
}) {
  const canvasId = groupRunScope.canvasId;
  const [tasks, setTasks] = useState<GenerationTaskSummary[]>([]);
  const [workflowRuns, setWorkflowRuns] = useState<ServerWorkflowRun[]>([]);
  const [stoppingRunIds, setStoppingRunIds] = useState<ReadonlySet<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState("");
  const [readError, setReadError] = useState("");
  const [workflowReadError, setWorkflowReadError] = useState("");
  const [groupSummary, setGroupSummary] = useState<GroupRunSummary>();
  const [groupCheckpoints, setGroupCheckpoints] =
    useState<GroupRunCheckpoint[]>([]);
  const [groupRecoveryPending, setGroupRecoveryPending] = useState(false);
  const [summaryClock, setSummaryClock] = useState(() => Date.now());
  const [documentVisible, setDocumentVisible] = useState(documentIsVisible);
  const fastPollUntil = useRef(Date.now() + fastPollGraceMs);
  const [recoveryResultTaskId, setRecoveryResultTaskId] = useState<string>();
  const [recoveryResultTask, setRecoveryResultTask] =
    useState<GenerationTaskSummary>();
  const [recoveryResultLoading, setRecoveryResultLoading] = useState(false);
  const [continuationPreviews, setContinuationPreviews] = useState<
    Readonly<Record<string, WorkflowContinuationPreview | undefined>>
  >({});
  const [continuationLoading, setContinuationLoading] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [continuationReadFailures, setContinuationReadFailures] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [continuationReadAutoRetrying, setContinuationReadAutoRetrying] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [continuationCreated, setContinuationCreated] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [continuationSubmitting, setContinuationSubmitting] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const recovery = useGenerationRecovery();
  const workflowExecution = useWorkflowExecution();
  const mounted = useRef(false);
  const scope = useRef({
    accountId: groupRunScope.accountId,
    canvasId,
    canvasScopeId,
  });
  const refreshController = useRef<AbortController | null>(null);
  const refreshEpoch = useRef(0);
  const actionController = useRef<AbortController | null>(null);
  const recoveryResultController = useRef<AbortController | null>(null);
  const continuationPreviewController = useRef<AbortController | null>(null);
  const continuationPreviewRetryTimers = useRef<Map<string, number>>(new Map());
  const continuationPreviewRetryCounts = useRef<Record<string, number>>({});
  const [continuationPreviewRetryTick, setContinuationPreviewRetryTick] = useState(0);
  scope.current = {
    accountId: groupRunScope.accountId,
    canvasId,
    canvasScopeId,
  };

  const recoveryTaskIdsKey = tasks.map((task) => task.id).join("\u0000");
  const failedWorkflowRunsKey = workflowRuns
    .filter((run) => run.state === "failed")
    .map((run) => `${run.id}:${run.updatedAt}`)
    .join("\u0000");
  useEffect(() => {
    const taskIds = tasks.map((task) => task.id);
    if (taskIds.length === 0) return;
    recovery.registerTaskIds(taskIds);
    return () => recovery.unregisterTaskIds(taskIds);
  }, [recovery.registerTaskIds, recovery.unregisterTaskIds, recoveryTaskIdsKey]);

  useEffect(() => {
    continuationPreviewController.current?.abort("workflow-continuation-preview-superseded");
    for (const timer of continuationPreviewRetryTimers.current.values()) {
      window.clearTimeout(timer);
    }
    continuationPreviewRetryTimers.current.clear();
    const requestedAccountId = groupRunScope.accountId;
    const failedRuns = workflowRuns.filter((run) => run.state === "failed");
    if (
      !open ||
      !canvasId ||
      groupRunScope.fixtureScopeId ||
      failedRuns.length === 0
    ) {
      setContinuationLoading(new Set());
      return;
    }
    const controller = new AbortController();
    continuationPreviewController.current = controller;
    const failedRunIds = failedRuns.map((run) => run.id);
    for (const runId of Object.keys(continuationPreviewRetryCounts.current)) {
      if (!failedRunIds.includes(runId)) {
        delete continuationPreviewRetryCounts.current[runId];
      }
    }
    setContinuationLoading((current) => new Set([...current, ...failedRunIds]));
    const scheduleReadRetry = (runId: string) => {
      const previousAttempts = continuationPreviewRetryCounts.current[runId] ?? 0;
      const nextAttempt = previousAttempts + 1;
      continuationPreviewRetryCounts.current[runId] = nextAttempt;
      const delay = continuationReadRetryDelaysMs[nextAttempt - 1] ??
        continuationReadRecheckDelayMs;
      // A slow, read-only recheck is retained after the short bounded burst.
      // Resetting the burst counter keeps the retry budget bounded per cycle
      // without turning a backend restart into a permanent stuck panel.
      if (nextAttempt > continuationReadRetryDelaysMs.length) {
        continuationPreviewRetryCounts.current[runId] = 0;
      }
      const existing = continuationPreviewRetryTimers.current.get(runId);
      if (existing !== undefined) window.clearTimeout(existing);
      const timer = window.setTimeout(() => {
        continuationPreviewRetryTimers.current.delete(runId);
        setContinuationPreviewRetryTick((current) => current + 1);
      }, delay);
      continuationPreviewRetryTimers.current.set(runId, timer);
    };
    const readWithRetry = async <T,>(read: () => Promise<T>, runId: string) => {
      let lastError: unknown;
      for (let attempt = 0; attempt <= continuationReadRetryDelaysMs.length; attempt += 1) {
        try {
          const value = await read();
          return value;
        } catch (error) {
          lastError = error;
          if (
            controller.signal.aborted ||
            !workflowRunStatusReadIsRetryable(error) ||
            attempt === continuationReadRetryDelaysMs.length
          ) throw error;
          await waitForContinuationReadRetry(
            controller.signal,
            continuationReadRetryDelaysMs[attempt],
          );
        }
      }
      throw lastError instanceof Error ? lastError : new Error("继续状态读取失败");
    };
    void Promise.allSettled(failedRuns.map(async (run) => {
      try {
        const relation = await readWithRetry(
          () => getServerWorkflowContinuation(run.id, controller.signal),
          run.id,
        );
        if (
          controller.signal.aborted ||
          !isCurrentScope(canvasScopeId, canvasId, requestedAccountId)
        ) {
          return;
        }
        if (relation.continuation) {
          continuationPreviewRetryCounts.current[run.id] = 0;
          setContinuationCreated((current) => new Set([...current, run.id]));
          setContinuationPreviews((current) => {
            if (!(run.id in current)) return current;
            const next = { ...current };
            delete next[run.id];
            return next;
          });
          setContinuationReadFailures((current) => {
            if (!current.has(run.id)) return current;
            const next = new Set(current);
            next.delete(run.id);
            return next;
          });
          setContinuationReadAutoRetrying((current) => {
            if (!current.has(run.id)) return current;
            const next = new Set(current);
            next.delete(run.id);
            return next;
          });
          return;
        }
        const preview = await readWithRetry(
          () => getServerWorkflowContinuationPreview(run.id, controller.signal),
          run.id,
        );
        if (
          controller.signal.aborted ||
          !isCurrentScope(canvasScopeId, canvasId, requestedAccountId)
        ) {
          return;
        }
        continuationPreviewRetryCounts.current[run.id] = 0;
        setContinuationPreviews((current) => ({ ...current, [run.id]: preview }));
        setContinuationReadFailures((current) => {
          if (!current.has(run.id)) return current;
          const next = new Set(current);
          next.delete(run.id);
          return next;
        });
        setContinuationReadAutoRetrying((current) => {
          if (!current.has(run.id)) return current;
          const next = new Set(current);
          next.delete(run.id);
          return next;
        });
      } catch (error) {
        if (!controller.signal.aborted) {
          const retryable = workflowRunStatusReadIsRetryable(error);
          setContinuationReadFailures((current) => new Set([...current, run.id]));
          setContinuationReadAutoRetrying((current) => {
            const next = new Set(current);
            if (retryable) next.add(run.id);
            else next.delete(run.id);
            return next;
          });
          if (retryable) scheduleReadRetry(run.id);
        }
      } finally {
        if (!controller.signal.aborted) {
          setContinuationLoading((current) => {
            const next = new Set(current);
            next.delete(run.id);
            return next;
          });
        }
      }
    })).finally(() => {
      if (continuationPreviewController.current === controller) {
        continuationPreviewController.current = null;
      }
    });
    return () => controller.abort("workflow-continuation-preview-scope-changed");
    // The key prevents the 3-second task refresh from restarting identical
    // preview reads while the bounded read-only retry tick handles a transient
    // backend restart even when the failed run's updatedAt is unchanged.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    canvasId,
    canvasScopeId,
    failedWorkflowRunsKey,
    groupRunScope.accountId,
    groupRunScope.fixtureScopeId,
    open,
    continuationPreviewRetryTick,
  ]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      refreshController.current?.abort("generation-task-panel-unmounted");
      actionController.current?.abort("generation-task-panel-unmounted");
      recoveryResultController.current?.abort("generation-task-panel-unmounted");
      continuationPreviewController.current?.abort("generation-task-panel-unmounted");
      for (const timer of continuationPreviewRetryTimers.current.values()) {
        window.clearTimeout(timer);
      }
      continuationPreviewRetryTimers.current.clear();
    };
  }, []);

  const isCurrentScope = (
    scopeId: string,
    targetCanvasId: string,
    targetAccountId?: string,
  ) =>
    mounted.current &&
    (targetAccountId === undefined || scope.current.accountId === targetAccountId) &&
    scope.current.canvasScopeId === scopeId &&
    scope.current.canvasId === targetCanvasId;

  const getActionSignal = (scopeId: string, targetCanvasId: string) => {
    if (!isCurrentScope(scopeId, targetCanvasId)) return undefined;
    const controller = actionController.current;
    return controller && !controller.signal.aborted
      ? controller.signal
      : undefined;
  };

  const checkpointRecoveryPending = () => {
    const checkpointCache = readGroupRunCheckpointCache(groupRunScope);
    return {
      checkpoints: checkpointCache.checkpoints,
      pending: (checkpointCache.corrupted || checkpointCache.quarantined) &&
        !isGroupRunAuthoritySettledEmpty(groupRunScope),
    };
  };

  const refresh = (
    requestedScopeId = canvasScopeId,
    requestedCanvasId = canvasId,
  ) => {
    if (!requestedCanvasId || !isCurrentScope(requestedScopeId, requestedCanvasId)) {
      return;
    }
    refreshController.current?.abort("generation-task-list-superseded");
    const controller = new AbortController();
    refreshController.current = controller;
    const epoch = ++refreshEpoch.current;
    setLoading(true);
    const tasksRequest = listGenerationTasks(
      requestedCanvasId,
      controller.signal,
      groupRunScope.fixtureScopeId,
    ).then((next) => {
        if (
          controller.signal.aborted ||
          refreshEpoch.current !== epoch ||
          !isCurrentScope(requestedScopeId, requestedCanvasId)
        ) return;
        setTasks(next.filter((task) =>
          task.canvasId === requestedCanvasId &&
          (task.fixtureScopeId ?? "") === groupRunScope.fixtureScopeId
        ));
        setReadError("");
      })
      .catch(() => {
        if (
          controller.signal.aborted ||
          refreshEpoch.current !== epoch ||
          !isCurrentScope(requestedScopeId, requestedCanvasId)
        ) return;
        setReadError("生成任务读取失败，请稍后再试");
      });
    const workflowRunsRequest = groupRunScope.fixtureScopeId
      ? Promise.resolve().then(() => {
          if (
            controller.signal.aborted || refreshEpoch.current !== epoch ||
            !isCurrentScope(requestedScopeId, requestedCanvasId)
          ) return;
          setWorkflowRuns([]);
          setWorkflowReadError("");
        })
      : listServerWorkflowRuns(requestedCanvasId, controller.signal)
          .then((runs) => {
            if (
              controller.signal.aborted || refreshEpoch.current !== epoch ||
              !isCurrentScope(requestedScopeId, requestedCanvasId)
            ) return;
            setWorkflowRuns((current) => mergeServerWorkflowRuns(current, runs));
            setWorkflowReadError("");
          })
          .catch(() => {
            if (
              controller.signal.aborted || refreshEpoch.current !== epoch ||
              !isCurrentScope(requestedScopeId, requestedCanvasId)
            ) return;
            setWorkflowReadError("整组执行记录读取失败，请稍后再试");
          });
    void Promise.allSettled([tasksRequest, workflowRunsRequest])
      .finally(() => {
        if (
          controller.signal.aborted ||
          refreshEpoch.current !== epoch ||
          !isCurrentScope(requestedScopeId, requestedCanvasId)
        ) return;
        setLoading(false);
      });
  };

  useEffect(() => {
    refreshController.current?.abort("generation-task-scope-changed");
    refreshEpoch.current += 1;
    actionController.current?.abort("generation-task-scope-changed");
    continuationPreviewController.current?.abort("generation-task-scope-changed");
    const currentActionController = new AbortController();
    actionController.current = currentActionController;
    setTasks([]);
    setWorkflowRuns([]);
    setStoppingRunIds(new Set());
    setActionError("");
    setReadError("");
    setWorkflowReadError("");
    setContinuationPreviews({});
    setContinuationLoading(new Set());
    setContinuationReadFailures(new Set());
    setContinuationReadAutoRetrying(new Set());
    setContinuationCreated(new Set());
    setContinuationSubmitting(new Set());
    continuationPreviewRetryCounts.current = {};
    for (const timer of continuationPreviewRetryTimers.current.values()) {
      window.clearTimeout(timer);
    }
    continuationPreviewRetryTimers.current.clear();
    const checkpointState = checkpointRecoveryPending();
    const checkpoints = checkpointState.checkpoints;
    setGroupRecoveryPending(checkpointState.pending);
    const summary = visibleGroupRunSummary(readLastGroupRunSummary(groupRunScope));
    setGroupCheckpoints(checkpoints);
    setGroupSummary(
      checkpoints.some((checkpoint) =>
        checkpoint.status === "interrupted" &&
        checkpoint.runId === summary?.runId
      ) &&
        isActiveGroupRunStatus(summary?.status ?? "cancelled")
        ? undefined
        : summary,
    );
    setLoading(true);
    if (!open || !canvasId) {
      return () => currentActionController.abort("generation-task-scope-closed");
    }
    refresh(canvasScopeId, canvasId);
    fastPollUntil.current = Date.now() + fastPollGraceMs;
    return () => {
      refreshController.current?.abort("generation-task-scope-closed");
      refreshEpoch.current += 1;
      currentActionController.abort("generation-task-scope-closed");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    open,
    canvasScopeId,
    groupRunScope.accountId,
    groupRunScope.canvasId,
    groupRunScope.fixtureScopeId,
  ]);

  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const needsFastPoll =
    tasks.some((task) => activeStates.has(task.state)) ||
    workflowRuns.some((run) => run.state === "running" || run.state === "stopping") ||
    Boolean(groupSummary && isActiveGroupRunStatus(groupSummary.status)) ||
    groupRecoveryPending ||
    Boolean(readError || workflowReadError);

  // Poll quickly only while something can still change; back off when idle
  // and stop entirely while the browser tab is hidden.
  useEffect(() => {
    if (!open || !canvasId || !documentVisible) return;
    let timer: number | undefined;
    const schedule = () => {
      const fast = needsFastPoll || Date.now() < fastPollUntil.current;
      timer = window.setTimeout(() => {
        refreshRef.current(canvasScopeId, canvasId);
        schedule();
      }, fast ? activePollIntervalMs : idlePollIntervalMs);
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, [
    canvasId,
    canvasScopeId,
    documentVisible,
    groupRunScope.accountId,
    groupRunScope.fixtureScopeId,
    needsFastPoll,
    open,
  ]);

  useEffect(() => {
    const onVisibilityChange = () => {
      const visible = documentIsVisible();
      setDocumentVisible(visible);
      if (!visible || !open) return;
      fastPollUntil.current = Date.now() + fastPollGraceMs;
      refreshRef.current(scope.current.canvasScopeId, scope.current.canvasId);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let timer: number | undefined;
    const onLocalSubmit = () => {
      fastPollUntil.current = Date.now() + fastPollGraceMs;
      if (!documentIsVisible()) return;
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = undefined;
        refreshRef.current(scope.current.canvasScopeId, scope.current.canvasId);
      }, 300);
    };
    const onRemoteActivity = () => {
      fastPollUntil.current = Date.now() + fastPollGraceMs;
    };
    window.addEventListener(GENERATION_SUBMIT_SETTLED_EVENT, onLocalSubmit);
    window.addEventListener(GENERATION_TASK_RETRY_ACCEPTED_EVENT, onLocalSubmit);
    window.addEventListener(SERVER_WORKFLOW_RUN_UPDATED_EVENT, onRemoteActivity);
    window.addEventListener(GROUP_RUN_SUMMARY_EVENT, onRemoteActivity);
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      window.removeEventListener(GENERATION_SUBMIT_SETTLED_EVENT, onLocalSubmit);
      window.removeEventListener(GENERATION_TASK_RETRY_ACCEPTED_EVENT, onLocalSubmit);
      window.removeEventListener(SERVER_WORKFLOW_RUN_UPDATED_EVENT, onRemoteActivity);
      window.removeEventListener(GROUP_RUN_SUMMARY_EVENT, onRemoteActivity);
    };
  }, [open]);

  useEffect(() => {
    const onSummary = (event: Event) => {
      const summary = (event as CustomEvent<GroupRunSummary>).detail;
      if (!summary || !groupRunSummaryMatchesScope(summary, groupRunScope)) return;
      setGroupSummary(visibleGroupRunSummary(summary));
    };
    window.addEventListener(GROUP_RUN_SUMMARY_EVENT, onSummary);
    return () => window.removeEventListener(GROUP_RUN_SUMMARY_EVENT, onSummary);
  }, [groupRunScope.accountId, groupRunScope.canvasId, groupRunScope.fixtureScopeId]);

  useEffect(() => {
    const onServerRun = (event: Event) => {
      let detail: ReturnType<typeof parseServerWorkflowRunUpdatedEventDetail>;
      try {
        detail = parseServerWorkflowRunUpdatedEventDetail(
          (event as CustomEvent<unknown>).detail,
        );
      } catch {
        return;
      }
      if (
        detail.accountId !== groupRunScope.accountId ||
        detail.canvasId !== canvasId ||
        detail.fixtureScopeId !== groupRunScope.fixtureScopeId
      ) return;
      const run = detail.run;
      setWorkflowRuns((current) => mergeServerWorkflowRuns(current, [run]));
    };
    window.addEventListener(SERVER_WORKFLOW_RUN_UPDATED_EVENT, onServerRun);
    return () => window.removeEventListener(SERVER_WORKFLOW_RUN_UPDATED_EVENT, onServerRun);
  }, [canvasId, groupRunScope.accountId, groupRunScope.fixtureScopeId]);

  useEffect(() => {
    if (
      !open ||
      !documentVisible ||
      !groupSummary ||
      !isActiveGroupRunStatus(groupSummary.status)
    ) return;
    setSummaryClock(Date.now());
    const timer = window.setInterval(() => setSummaryClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [documentVisible, groupSummary?.runId, groupSummary?.status, open]);

  useEffect(() => {
    const onCheckpoint = () => {
      const checkpointState = checkpointRecoveryPending();
      const checkpoints = checkpointState.checkpoints;
      setGroupCheckpoints(checkpoints);
      setGroupRecoveryPending(checkpointState.pending);
      if (checkpoints.some((checkpoint) => checkpoint.status === "interrupted")) {
        setGroupSummary((current) =>
          checkpoints.some((checkpoint) => current?.runId === checkpoint.runId) &&
            isActiveGroupRunStatus(current?.status ?? "cancelled")
            ? undefined
            : current
        );
      }
    };
    window.addEventListener(GROUP_RUN_AUTHORITY_EVENT, onCheckpoint);
    window.addEventListener(GROUP_RUN_CHECKPOINT_EVENT, onCheckpoint);
    window.addEventListener("storage", onCheckpoint);
    return () => {
      window.removeEventListener(GROUP_RUN_AUTHORITY_EVENT, onCheckpoint);
      window.removeEventListener(GROUP_RUN_CHECKPOINT_EVENT, onCheckpoint);
      window.removeEventListener("storage", onCheckpoint);
    };
  }, [groupRunScope.accountId, groupRunScope.canvasId, groupRunScope.fixtureScopeId]);

  const active = tasks
    .filter((task) => activeStates.has(task.state))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const failed = tasks
    .filter((task) => task.state === "failed")
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 12);
  const recent = tasks
    .filter((task) => task.state === "success" || task.state === "cancelled")
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 8);
  const recoveryCases = recovery.cases.filter((item) => item.canvasId === canvasId);
  const changed = () => refresh(canvasScopeId, canvasId);
  const visibleError = actionError || workflowReadError || readError;
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const workflowProjectionByTaskId = new Map<string, string>();
  for (const run of workflowRuns) {
    for (const node of run.nodes) {
      if (node.taskId && node.projectionState && !workflowProjectionByTaskId.has(node.taskId)) {
        workflowProjectionByTaskId.set(node.taskId, node.projectionState);
      }
    }
  }
  const openRecoveryResult = (taskId: string) => {
    if (!isCurrentScope(canvasScopeId, canvasId)) return;
    recoveryResultController.current?.abort("generation-recovery-result-superseded");
    setRecoveryResultTaskId(taskId);
    const controller = new AbortController();
    recoveryResultController.current = controller;
    setRecoveryResultTask(undefined);
    setRecoveryResultLoading(true);
    void getGenerationTask(
      taskId,
      controller.signal,
      groupRunScope.fixtureScopeId,
      { followReplacementTask: true },
    )
      .then((task) => {
        if (!controller.signal.aborted && isCurrentScope(canvasScopeId, canvasId)) {
          setRecoveryResultTask(task);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted && isCurrentScope(canvasScopeId, canvasId)) {
          setActionError("原任务结果暂时无法读取，原任务记录已保留");
        }
      })
      .finally(() => {
        if (recoveryResultController.current === controller) {
          recoveryResultController.current = null;
          if (!controller.signal.aborted) setRecoveryResultLoading(false);
        }
      });
  };
  const stopWorkflowRun = (run: ServerWorkflowRun) => {
    const signal = getActionSignal(canvasScopeId, canvasId);
    if (!signal || stoppingRunIds.has(run.id)) return;
    setStoppingRunIds((current) => new Set([...current, run.id]));
    void stopServerWorkflowRunAndConfirm(run.id, signal)
      .then((stopped) => {
        if (!isCurrentScope(canvasScopeId, canvasId)) return;
        if (
          stopped.id !== run.id || stopped.canvasId !== canvasId ||
          stopped.groupId !== run.groupId || stopped.state === "running"
        ) {
          throw new Error("服务端没有确认本次停止请求");
        }
        setWorkflowRuns((current) => [
          stopped,
          ...current.filter(({ id }) => id !== stopped.id),
        ]);
        setActionError("");
      })
      .catch((error: unknown) => {
        if (!isCurrentScope(canvasScopeId, canvasId)) return;
        setActionError(userFacingErrorMessage(error, "暂时无法确认停止状态"));
      })
      .finally(() => {
        if (!isCurrentScope(canvasScopeId, canvasId)) return;
        setStoppingRunIds((current) => {
          const next = new Set(current);
          next.delete(run.id);
          return next;
        });
      });
  };
  const continueWorkflowRun = (
    run: ServerWorkflowRun,
    preview: WorkflowContinuationPreview,
  ) => {
    if (
      !isCurrentScope(canvasScopeId, canvasId) ||
      continuationSubmitting.has(run.id) ||
      continuationCreated.has(run.id) ||
      preview.candidateNodeIds.length === 0
    ) return;
    const intentId = crypto.randomUUID();
    setContinuationSubmitting((current) => new Set([...current, run.id]));
    void workflowExecution.continueFailedWorkflow({
      groupId: run.groupId,
      intentId,
      parentRunId: run.id,
      previewDigest: preview.previewDigest,
    })
      .then((child) => {
        if (!isCurrentScope(canvasScopeId, canvasId)) return;
        setContinuationCreated((current) => new Set([...current, run.id]));
        setContinuationPreviews((current) => {
          if (!(run.id in current)) return current;
          const next = { ...current };
          delete next[run.id];
          return next;
        });
        setContinuationReadFailures((current) => {
          if (!current.has(run.id)) return current;
          const next = new Set(current);
          next.delete(run.id);
          return next;
        });
        setWorkflowRuns((current) => mergeServerWorkflowRuns(current, [child]));
        setActionError("");
      })
      .catch((error: unknown) => {
        if (!isCurrentScope(canvasScopeId, canvasId)) return;
        // A stale preview is only a read fence failure. Drop it so the next
        // automatic read obtains the current graph before another user intent.
        if (
          error instanceof Error &&
          /画布|输入|预览|身份|变化|核对/.test(error.message)
        ) {
          setContinuationPreviews((current) => {
            if (!(run.id in current)) return current;
            const next = { ...current };
            delete next[run.id];
            return next;
          });
          setContinuationPreviewRetryTick((current) => current + 1);
        }
        setActionError(
          userFacingErrorMessage(error, "继续未完成节点失败，请稍后再试"),
        );
      })
      .finally(() => {
        if (!isCurrentScope(canvasScopeId, canvasId)) return;
        setContinuationSubmitting((current) => {
          const next = new Set(current);
          next.delete(run.id);
          return next;
        });
      });
  };

  return (
    <section
      aria-label="生成任务"
      className="tasks-panel"
      data-testid="tasks-panel"
      ref={panelRef}
    >
      <header className="tasks-panel-header">
        <strong>生成任务</strong>
        <span>最近任务</span>
      </header>
      <div className="tasks-divider" />
      {visibleError && (
        <p className="tasks-error" role="alert">{visibleError}</p>
      )}
      {groupRecoveryPending && groupCheckpoints.length === 0 && (
        <section
          className="tasks-group-summary"
          data-status="recovering"
          data-testid="tasks-group-recovery"
        >
          <div className="tasks-group-summary-header">
            <strong>{groupRunAuthorityRecoverySupported()
              ? "正在安全核对整组任务"
              : "当前浏览器无法安全自动恢复"}</strong>
          </div>
          <p>{groupRunAuthorityRecoverySupported()
            ? "系统会根据画布与已接收任务自动恢复，不会重复提交。"
            : "请刷新页面或使用支持 Web Locks 的浏览器后重试；系统不会重复提交。"}</p>
        </section>
      )}
      {groupSummary && (
        <section
          className="tasks-group-summary"
          data-status={groupSummary.status}
          data-testid="tasks-group-summary"
        >
          <div className="tasks-group-summary-header">
            <strong>
              {groupSummary.status === "preparing"
                ? "整组正在准备"
                : groupSummary.status === "running"
                  ? "整组正在执行"
                  : groupSummary.status === "stopping"
                    ? "正在停止后续节点"
                    : groupSummary.status === "success"
                ? "最近一轮整组完成"
                : groupSummary.status === "failed"
                  ? "最近一轮整组部分失败"
                  : groupSummary.status === "cancelled"
                    ? "最近一轮已停止后续"
                    : "最近一轮整组已停止"}
            </strong>
            {!isActiveGroupRunStatus(groupSummary.status) && (
              <button
                aria-label="关闭最近一轮整组摘要"
                onClick={() => {
                  dismissGroupRunSummary(groupSummary);
                  setGroupSummary(undefined);
                }}
                type="button"
              >
                ×
              </button>
            )}
          </div>
          <p>
            {isActiveGroupRunStatus(groupSummary.status)
              ? `已完成 ${groupSummary.completedCount ?? 0}/${groupSummary.nodeCount} · 正在处理 ${groupSummary.activeCount ?? 0} · 已用时 ${formatGenerationDuration(summaryClock - groupSummary.startedAt)}`
              : `${groupSummary.nodeCount} 个节点 · 成功 ${groupSummary.successCount} · 失败 ${groupSummary.failedCount} · 跳过 ${groupSummary.skippedCount} · 未运行 ${groupSummary.blockedCount} · 共用时 ${formatGenerationDuration(groupSummary.elapsedMs)}`}
          </p>
          {groupSummary.firstFailedNodeId && (
            <p className="tasks-group-summary-problem">
              <span>
                {`首个失败：${groupSummary.firstFailedNodeTitle ?? groupSummary.firstFailedNodeId}`}
              </span>
              {(groupSummary.reason || groupSummary.errorCode) && (
                <span>{groupProblemText(groupSummary)}</span>
              )}
            </p>
          )}
          {!groupSummary.firstFailedNodeId && groupSummary.reason && (
            <p className="tasks-group-summary-problem">
              <span>{groupProblemText(groupSummary)}</span>
            </p>
          )}
          {isActiveGroupRunStatus(groupSummary.status) && (
            <button
              className="tasks-group-summary-locate"
              data-testid="tasks-group-stop"
              disabled={groupSummary.status === "stopping"}
              onClick={() => requestGroupRunStop({
                groupId: groupSummary.groupId,
                runId: groupSummary.runId,
                scope: groupRunScope,
              })}
              type="button"
            >
              {groupSummary.status === "stopping" ? "正在停止" : "停止后续节点"}
            </button>
          )}
          {groupSummary.firstFailedNodeId && (
            <button
              className="tasks-group-summary-locate"
              data-testid="tasks-group-summary-locate"
              onClick={() => onLocateNode(groupSummary.firstFailedNodeId!)}
              type="button"
            >
              定位失败节点
            </button>
          )}
        </section>
      )}
      {groupCheckpoints
        .filter((groupCheckpoint) => !(
          isActiveGroupRunStatus(groupSummary?.status ?? "cancelled") &&
          groupSummary?.groupId === groupCheckpoint.groupId &&
          groupSummary.runId === groupCheckpoint.runId
        ))
        .map((groupCheckpoint) => (
        <section
          key={groupCheckpoint.runId}
          className="tasks-group-summary"
          data-status="interrupted"
          data-testid="tasks-group-checkpoint"
        >
          <div className="tasks-group-summary-header">
            <strong>旧版整组记录待核对</strong>
          </div>
          <p>
            已记录 {Object.keys(groupCheckpoint.successProofs).length}/
            {groupCheckpoint.executableNodeIds.length} 个成功节点。这里只退出旧版浏览器调度，
            不会继续提交剩余节点或重新生成。
          </p>
          <button
            className="tasks-group-summary-locate"
            data-testid="tasks-group-continue"
            onClick={() => requestGroupRunContinue(groupCheckpoint)}
            type="button"
          >
            退出旧版续跑
          </button>
          <button
            className="tasks-group-summary-locate"
            data-testid="tasks-group-abandon"
            onClick={() => {
              if (!window.confirm(
                "放弃后不会自动删除已经提交或完成的任务；再次整组执行可能重新生成。确定放弃这条续跑记录吗？",
              )) return;
              if (!clearGroupRunCheckpoint(
                groupRunScope,
                undefined,
                groupCheckpoint.runId,
              )) {
                setActionError("续跑记录无法安全清理，请保留当前记录并稍后重试");
              }
            }}
            type="button"
          >
            放弃续跑记录
          </button>
        </section>
      ))}
      {recoveryCases.length > 0 && (
        <section
          aria-label="生成处理记录"
          className="tasks-recovery-history"
          data-testid="tasks-recovery-history"
        >
          <div className="tasks-recovery-history-header">
            <strong>生成处理记录</strong>
            <span>{recoveryCases.length}</span>
          </div>
          <p>
            {recoveryHistoryHint(recoveryCases)}
          </p>
          <ul>
            {recoveryCases.map((item) => (
              <li
                className="tasks-recovery-row"
                data-status={item.status}
                data-testid="tasks-recovery-case"
                key={item.caseId}
              >
                <span className="tasks-recovery-kind">{kindLabels[item.kind]}</span>
                <span className="tasks-recovery-state">
                  {recoveryStatusLabel(item.status)}
                </span>
                <span className="tasks-recovery-summary">{item.summary}</span>
                <span className="tasks-recovery-actions">
                  <button
                    data-testid="tasks-recovery-locate"
                    onClick={() => onLocateNode(item.nodeId)}
                    type="button"
                  >
                    查看节点
                  </button>
                  {item.action === "view_result" && (
                    <button
                      data-testid="tasks-recovery-view-result"
                      onClick={() => openRecoveryResult(item.taskId)}
                      type="button"
                    >
                      查看原任务结果
                    </button>
                  )}
                  {item.unread && (
                    <button
                      data-testid="tasks-recovery-read"
                      onClick={() => void recovery.markRead(item)}
                      type="button"
                    >
                      标记已读
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {recoveryResultTaskId && (
            <section
              aria-label="原任务结果"
              className="tasks-recovery-result"
              data-testid="tasks-recovery-result-detail"
            >
              <div className="tasks-recovery-result-header">
                <strong>原任务结果</strong>
                <button
                  aria-label="关闭原任务结果"
                  onClick={() => {
                    recoveryResultController.current?.abort(
                      "generation-recovery-result-closed",
                    );
                    setRecoveryResultTaskId(undefined);
                    setRecoveryResultTask(undefined);
                    setRecoveryResultLoading(false);
                  }}
                  type="button"
                >
                  ×
                </button>
              </div>
              {recoveryResultLoading && <p>正在读取原任务结果…</p>}
              {!recoveryResultLoading && recoveryResultTask && (
                <RecoveryTaskResult task={recoveryResultTask} />
              )}
              {!recoveryResultLoading && !recoveryResultTask && (
                <p>原任务结果暂时无法读取，原任务记录已保留。</p>
              )}
            </section>
          )}
        </section>
      )}
      {recovery.observationState === "unavailable" &&
        recoveryCases.length === 0 && recovery.trackedTaskCount > 0 && (
          <p
            className="tasks-recovery-unavailable"
            data-testid="tasks-recovery-unavailable"
            role="status"
          >
            {recovery.error ?? "恢复状态暂时无法读取，原任务记录已保留"}
          </p>
        )}
      {workflowRuns.length > 0 && (
        <div className="tasks-list" data-testid="workflow-runs-list">
          <section className="tasks-group">
            <h3>
              整组执行历史
              <span data-testid="workflow-runs-count">{workflowRuns.length}</span>
            </h3>
            <ul>
              {workflowRuns.slice(0, 12).map((run) => {
                const linkedTasks = run.nodes.flatMap(({ taskId }) => {
                  const task = taskId ? taskById.get(taskId) : undefined;
                  return task ? [task] : [];
                });
                const providerTaskBound = linkedTasks.filter(
                  (task) => task.providerTaskBound,
                ).length;
                const acceptedTaskCount = run.nodes.filter(
                  ({ taskId }) => Boolean(taskId),
                ).length;
                const providerTaskPending = linkedTasks.length - providerTaskBound;
                const providerTaskUnknown = acceptedTaskCount - linkedTasks.length;
                const firstFailed = run.nodes.find(({ state }) => state === "failed");
                const runProblem = run.state === "running" ? undefined : (
                  firstFailed && (firstFailed.errorCode || firstFailed.errorMessage)
                    ? generationTaskErrorText({
                        code: firstFailed.errorCode,
                        kind: firstFailed.kind,
                        message: firstFailed.errorMessage,
                      })
                    : (run.state === "failed" || run.state === "cancelled") &&
                        (run.errorCode || run.errorMessage)
                      ? generationTaskErrorText({
                          code: run.errorCode,
                          message: run.errorMessage,
                        })
                      : undefined
                );
                const applied = run.nodes.filter(
                  ({ projectionState }) => projectionState === "applied",
                ).length;
                const projectionPending = run.nodes.filter(
                  ({ projectionState }) => projectionState === "pending",
                ).length;
                const projectionConflict = run.nodes.filter(
                  ({ projectionState }) => projectionState === "conflict",
                ).length;
                const projectionFailed = run.nodes.filter(
                  ({ projectionState }) => projectionState === "failed",
                ).length;
                const activeRun = run.state === "running" || run.state === "stopping";
                const continuationPreview = continuationPreviews[run.id];
                const continuationIsLoading = continuationLoading.has(run.id);
                const continuationIsSubmitting = continuationSubmitting.has(run.id);
                const continuationHasCreated = continuationCreated.has(run.id);
                return (
                  <li
                    className="tasks-row"
                    data-state={run.state}
                    data-testid={`workflow-run-${run.id}`}
                    key={run.id}
                  >
                    <span className="tasks-row-kind">整组</span>
                    <span
                      className="tasks-row-prompt"
                      title="整组执行历史"
                    >
                      {`整组执行 · 节点 ${run.nodes.length} · 服务端任务已受理 ${acceptedTaskCount} · 平台任务已确认 ${providerTaskBound}${providerTaskPending ? ` / 未绑定 ${providerTaskPending}` : ""}${providerTaskUnknown ? ` / 任务记录未载入 ${providerTaskUnknown}` : ""} · 投影已应用 ${applied} / 待写回 ${projectionPending} / 冲突 ${projectionConflict} / 失败 ${projectionFailed}`}
                      {firstFailed && <span> · 有节点未完成</span>}
                    </span>
                    <span className={`tasks-row-state tasks-state-${run.state}`}>
                      {run.state === "running"
                        ? "服务端执行中"
                        : run.state === "stopping"
                          ? "服务端正在停止"
                          : run.state === "success"
                            ? "整组完成"
                            : run.state === "failed"
                              ? "整组失败"
                              : "整组已停止"}
                    </span>
                    <span className="tasks-row-time">{relativeTime(run.updatedAt)}</span>
                    <span className="tasks-row-actions">
                      {activeRun && (
                        <button
                          data-testid={`workflow-run-stop-${run.id}`}
                          disabled={run.state === "stopping" || stoppingRunIds.has(run.id)}
                          onClick={() => stopWorkflowRun(run)}
                          type="button"
                        >
                          {run.state === "stopping" || stoppingRunIds.has(run.id)
                            ? "正在停止"
                            : "停止后续节点"}
                        </button>
                      )}
                      {run.state === "failed" && !groupRunScope.fixtureScopeId && (
                        <span
                          className="tasks-row-continuation"
                          data-testid={`workflow-run-continuation-${run.id}`}
                        >
                          {continuationHasCreated ? (
                            <span className="tasks-row-continuation-status" role="status">
                              已有后继执行，正在继续未完成节点
                            </span>
                          ) : continuationPreview ? (
                            continuationPreview.candidateNodeIds.length > 0 ? (
                              <>
                                <button
                                  data-testid={`workflow-run-continue-${run.id}`}
                                  disabled={continuationIsSubmitting}
                                  onClick={() => continueWorkflowRun(run, continuationPreview)}
                                  type="button"
                                >
                                  {continuationIsSubmitting
                                    ? "正在继续…"
                                    : "继续未完成节点"}
                                </button>
                                <span className="tasks-row-continuation-hint">
                                  保留 {continuationPreview.preservedNodeIds.length} 个已完成节点，
                                  只继续 {continuationPreview.candidateNodeIds.length} 个未完成节点；
                                  后续生成可能产生费用。
                                </span>
                              </>
                            ) : (
                              <span className="tasks-row-continuation-status" role="status">
                                当前没有可以安全继续的节点
                              </span>
                            )
                          ) : continuationIsLoading ? (
                            <span className="tasks-row-continuation-status" role="status">
                              正在读取可继续的节点…
                            </span>
                          ) : continuationReadFailures.has(run.id) ? (
                            <span
                              className="tasks-row-continuation-status tasks-row-continuation-status-unavailable"
                              role="status"
                            >
                              {continuationReadAutoRetrying.has(run.id)
                                ? "继续状态暂时无法读取，系统会自动再试"
                                : "继续状态暂时无法读取，请稍后再试"}
                            </span>
                          ) : null}
                        </span>
                      )}
                    </span>
                    {runProblem && (
                      <div
                        className="tasks-row-error"
                        data-testid={`workflow-run-error-${run.id}`}
                      >
                        <span>{runProblem.summary}</span>
                        {runProblem.action && (
                          <span className="tasks-row-error-action">
                            {`（${runProblem.action}）`}
                          </span>
                        )}
                        {runProblem.detail && (
                          <details>
                            <summary>详情</summary>
                            <p>{runProblem.detail}</p>
                          </details>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      )}
      {loading && tasks.length === 0 && workflowRuns.length === 0 ? (
        <p className="tasks-empty">正在读取生成任务与整组执行记录…</p>
      ) : tasks.length === 0 && workflowRuns.length === 0 && !visibleError ? (
        <p className="tasks-empty" data-testid="tasks-empty">
          还没有生成任务
        </p>
      ) : tasks.length > 0 ? (
        <div className="tasks-list" data-testid="tasks-list">
          {active.length > 0 && (
            <section className="tasks-group">
              <h3>
                进行中
                <span data-testid="tasks-active-count">{active.length}</span>
              </h3>
              <ul>
                {active.map((task) => (
                  <TaskRow
                    canvasId={canvasId}
                    canvasScopeId={canvasScopeId}
                    getActionSignal={getActionSignal}
                    groupRunScope={groupRunScope}
                    isCurrentScope={isCurrentScope}
                    key={task.id}
                    onActionError={setActionError}
                    onApplyToCanvas={onApplyResultToCanvas}
                    onChanged={changed}
                    retryEnabled={retryEnabled}
                    task={task}
                    waitForCanvasRevision={waitForCanvasRevision}
                    workflowProjectionState={workflowProjectionByTaskId.get(task.id)}
                  />
                ))}
              </ul>
            </section>
          )}
          {failed.length > 0 && (
            <section className="tasks-group">
              <h3>
                失败
                <span data-testid="tasks-failed-count">{failed.length}</span>
              </h3>
              <ul>
                {failed.map((task) => (
                  <TaskRow
                    canvasId={canvasId}
                    canvasScopeId={canvasScopeId}
                    getActionSignal={getActionSignal}
                    groupRunScope={groupRunScope}
                    isCurrentScope={isCurrentScope}
                    key={task.id}
                    onActionError={setActionError}
                    onApplyToCanvas={onApplyResultToCanvas}
                    onChanged={changed}
                    retryEnabled={retryEnabled}
                    task={task}
                    waitForCanvasRevision={waitForCanvasRevision}
                    workflowProjectionState={workflowProjectionByTaskId.get(task.id)}
                  />
                ))}
              </ul>
            </section>
          )}
          {recent.length > 0 && (
            <section className="tasks-group">
              <h3>最近完成</h3>
              <ul>
                {recent.map((task) => (
                  <TaskRow
                    canvasId={canvasId}
                    canvasScopeId={canvasScopeId}
                    getActionSignal={getActionSignal}
                    groupRunScope={groupRunScope}
                    isCurrentScope={isCurrentScope}
                    key={task.id}
                    onActionError={setActionError}
                    onApplyToCanvas={onApplyResultToCanvas}
                    onChanged={changed}
                    retryEnabled={retryEnabled}
                    task={task}
                    waitForCanvasRevision={waitForCanvasRevision}
                    workflowProjectionState={workflowProjectionByTaskId.get(task.id)}
                  />
                ))}
              </ul>
            </section>
          )}
        </div>
      ) : null}
    </section>
  );
}
