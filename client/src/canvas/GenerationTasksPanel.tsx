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
  GROUP_RUN_CHECKPOINT_EVENT,
  readGroupRunCheckpoint,
  requestGroupRunContinue,
  requestGroupRunStop,
  type GroupRunCheckpoint,
} from "../generation/groupRunCheckpoint";

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
  const [confirmedMissing, setConfirmedMissing] = useState(false);
  const active = activeStates.has(task.state);
  const abandonable = task.state === "failed" && task.abandonAllowed === true;
  const retryable = task.state === "failed" && task.retryAllowed === true;
  const reconcilable = task.state === "failed";
  const rowIsCurrent =
    task.canvasId === canvasId && isCurrentScope(canvasScopeId, canvasId);
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
              void cancelGenerationTask(task.id, signal)
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
              !task.generationInputKey
            }
            onClick={() => {
              if (
                task.canvasId !== canvasId ||
                !isCurrentScope(canvasScopeId, canvasId) ||
                !retryEnabled ||
                !waitForCanvasRevision ||
                !task.generationInputKey
              ) return;
              const signal = getActionSignal(canvasScopeId, canvasId);
              if (!signal) return;
              setBusy(true);
              void reconcileGenerationTask({
                canvasId: task.canvasId,
                generationInputKey: task.generationInputKey,
                kind: task.kind,
                nodeId: task.nodeId,
                taskId: task.id,
              }, waitForCanvasRevision, undefined, signal)
                .then((result) => {
                  if (!isCurrentScope(canvasScopeId, canvasId)) return;
                  if (result.outcome === "missing") {
                    setConfirmedMissing(true);
                  }
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
              !task.generationInputKey
            }
            onClick={() => {
              if (
                task.canvasId !== canvasId ||
                !isCurrentScope(canvasScopeId, canvasId) ||
                !retryEnabled ||
                !waitForCanvasRevision ||
                !task.generationInputKey
              ) return;
              const signal = getActionSignal(canvasScopeId, canvasId);
              if (!signal) return;
              setBusy(true);
              void retryGenerationTask({
                canvasId: task.canvasId,
                generationInputKey: task.generationInputKey,
                kind: task.kind,
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
              void abandonGenerationTask(task, signal)
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
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState("");
  const [readError, setReadError] = useState("");
  const [groupSummary, setGroupSummary] = useState<GroupRunSummary>();
  const [groupCheckpoint, setGroupCheckpoint] =
    useState<GroupRunCheckpoint>();
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
    listGenerationTasks(requestedCanvasId, controller.signal)
      .then((next) => {
        if (
          controller.signal.aborted ||
          refreshEpoch.current !== epoch ||
          !isCurrentScope(requestedScopeId, requestedCanvasId)
        ) return;
        setTasks(next.filter((task) => task.canvasId === requestedCanvasId));
        setReadError("");
      })
      .catch(() => {
        if (
          controller.signal.aborted ||
          refreshEpoch.current !== epoch ||
          !isCurrentScope(requestedScopeId, requestedCanvasId)
        ) return;
        setReadError("生成任务读取失败，请稍后再试");
      })
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
    setActionError("");
    setReadError("");
    setGroupSummary(visibleGroupRunSummary(readLastGroupRunSummary(groupRunScope)));
    setGroupCheckpoint(readGroupRunCheckpoint(groupRunScope));
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
    if (!groupSummary || !isActiveGroupRunStatus(groupSummary.status)) return;
    setSummaryClock(Date.now());
    const timer = window.setInterval(() => setSummaryClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [groupSummary?.runId, groupSummary?.status]);

  useEffect(() => {
    const onCheckpoint = () => {
      setGroupCheckpoint(readGroupRunCheckpoint(groupRunScope));
    };
    window.addEventListener(GROUP_RUN_CHECKPOINT_EVENT, onCheckpoint);
    window.addEventListener("storage", onCheckpoint);
    return () => {
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
  const visibleError = actionError || readError;

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
      {groupCheckpoint &&
        !isActiveGroupRunStatus(groupSummary?.status ?? "cancelled") && (
        <section
          className="tasks-group-summary"
          data-status="interrupted"
          data-testid="tasks-group-checkpoint"
        >
          <div className="tasks-group-summary-header">
            <strong>上次整组未完成</strong>
          </div>
          <p>
            已记录 {Object.keys(groupCheckpoint.successProofs).length}/
            {groupCheckpoint.executableNodeIds.length} 个成功节点。继续前会核对任务凭证，
            不会自动重新生成。
          </p>
          <button
            className="tasks-group-summary-locate"
            data-testid="tasks-group-continue"
            onClick={() => requestGroupRunContinue(groupCheckpoint)}
            type="button"
          >
            继续剩余节点
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
      )}
      {loading && tasks.length === 0 ? (
        <p className="tasks-empty">正在读取生成任务…</p>
      ) : tasks.length === 0 ? (
        <p className="tasks-empty" data-testid="tasks-empty">
          还没有生成任务
        </p>
      ) : (
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
      )}
    </section>
  );
}
