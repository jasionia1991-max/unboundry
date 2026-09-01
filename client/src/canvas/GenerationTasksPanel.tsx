import { useEffect, useRef, useState, type Ref } from "react";
import {
  abandonGenerationTask,
  cancelGenerationTask,
  GENERATION_TASK_RETRY_ACCEPTED_EVENT,
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
  stopServerWorkflowRunAndConfirm,
  type ServerWorkflowRun,
} from "../generation/workflowRuns";

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

function TaskRow({
  canvasId,
  canvasScopeId,
  groupRunScope,
  getActionSignal,
  isCurrentScope,
  onActionError,
  onChanged,
  retryEnabled,
  task,
  waitForCanvasRevision,
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
  onChanged: () => void;
  retryEnabled: boolean;
  task: GenerationTaskSummary;
  waitForCanvasRevision?: () => Promise<number>;
}) {
  const [busy, setBusy] = useState(false);
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
                .catch(() => undefined)
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
                    error instanceof Error
                      ? error.message
                      : "核对结果失败，请稍后再试",
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
                    error instanceof Error
                      ? error.message
                      : "生成任务重试失败，请稍后再试",
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
                "放弃后将不再尝试恢复该平台结果。本操作不会重新付费，也不会向平台发送新的生成请求。确认放弃平台结果？",
              )) return;
              const signal = getActionSignal(canvasScopeId, canvasId);
              if (!signal) return;
              setBusy(true);
              void abandonGenerationTask(
                task,
                signal,
                groupRunScope.fixtureScopeId,
              )
                .catch(() => undefined)
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
      </span>
    </li>
  );
}

export function GenerationTasksPanel({
  canvasScopeId,
  groupRunScope,
  onLocateNode,
  open,
  panelRef,
  retryEnabled,
  waitForCanvasRevision,
}: {
  canvasScopeId: string;
  groupRunScope: GroupRunSummaryScope;
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
  const mounted = useRef(false);
  const scope = useRef({ canvasId, canvasScopeId });
  const refreshController = useRef<AbortController | null>(null);
  const refreshEpoch = useRef(0);
  const actionController = useRef<AbortController | null>(null);
  scope.current = { canvasId, canvasScopeId };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      refreshController.current?.abort("generation-task-panel-unmounted");
      actionController.current?.abort("generation-task-panel-unmounted");
    };
  }, []);

  const isCurrentScope = (scopeId: string, targetCanvasId: string) =>
    mounted.current &&
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
    const currentActionController = new AbortController();
    actionController.current = currentActionController;
    setTasks([]);
    setWorkflowRuns([]);
    setStoppingRunIds(new Set());
    setActionError("");
    setReadError("");
    setWorkflowReadError("");
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
    const requestedScopeId = canvasScopeId;
    const requestedCanvasId = canvasId;
    refresh(requestedScopeId, requestedCanvasId);
    const timer = window.setInterval(
      () => refresh(requestedScopeId, requestedCanvasId),
      3_000,
    );
    return () => {
      window.clearInterval(timer);
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
    if (!groupSummary || !isActiveGroupRunStatus(groupSummary.status)) return;
    setSummaryClock(Date.now());
    const timer = window.setInterval(() => setSummaryClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [groupSummary?.runId, groupSummary?.status]);

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
  const changed = () => refresh(canvasScopeId, canvasId);
  const visibleError = actionError || workflowReadError || readError;
  const taskById = new Map(tasks.map((task) => [task.id, task]));
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
        setActionError(
          error instanceof Error ? error.message : "暂时无法确认停止状态",
        );
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
                {`首个失败：${groupSummary.firstFailedNodeTitle ?? groupSummary.firstFailedNodeId}${groupSummary.errorCode ? `（${groupSummary.errorCode}）` : ""}`}
              </span>
              {groupSummary.reason && <span>{groupSummary.reason}</span>}
            </p>
          )}
          {!groupSummary.firstFailedNodeId && groupSummary.reason && (
            <p className="tasks-group-summary-problem">
              <span>{groupSummary.reason}</span>
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
                      title={`run id: ${run.id}`}
                    >
                      {`run id: ${run.id} · 节点 ${run.nodes.length} · 服务端任务已受理 ${acceptedTaskCount} · Provider 任务号已确认 ${providerTaskBound}${providerTaskPending ? ` / 未绑定 ${providerTaskPending}` : ""}${providerTaskUnknown ? ` / 任务记录未载入 ${providerTaskUnknown}` : ""} · 投影 已应用 ${applied} / 待写回 ${projectionPending} / 冲突 ${projectionConflict} / 失败 ${projectionFailed}`}
                      {(firstFailed?.errorMessage || run.errorMessage) && (
                        <span>{` · 首错：${firstFailed?.errorMessage ?? run.errorMessage}`}</span>
                      )}
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
                    </span>
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
                    onChanged={changed}
                    retryEnabled={retryEnabled}
                    task={task}
                    waitForCanvasRevision={waitForCanvasRevision}
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
                    onChanged={changed}
                    retryEnabled={retryEnabled}
                    task={task}
                    waitForCanvasRevision={waitForCanvasRevision}
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
                    onChanged={changed}
                    retryEnabled={retryEnabled}
                    task={task}
                    waitForCanvasRevision={waitForCanvasRevision}
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
