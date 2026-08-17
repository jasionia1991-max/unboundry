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
  readLastGroupRunSummary,
  type GroupRunSummary,
} from "../generation/groupRunSummary";

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
  const [needsTaskId, setNeedsTaskId] = useState(false);
  const [providerTaskDraft, setProviderTaskDraft] = useState("");
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
              }, waitForCanvasRevision, providerTaskDraft, signal)
                .then((result) => {
                  if (!isCurrentScope(canvasScopeId, canvasId)) return;
                  if (result.outcome === "needs-task-id") {
                    setNeedsTaskId(true);
                  }
                  if (result.outcome === "missing") {
                    setConfirmedMissing(true);
                    setNeedsTaskId(false);
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
        {reconcilable && needsTaskId && (
          <input
            aria-label="平台任务号"
            data-testid={`tasks-reconcile-task-id-${task.id}`}
            disabled={busy}
            onChange={(event) => setProviderTaskDraft(event.target.value)}
            placeholder="平台任务号"
            value={providerTaskDraft}
          />
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
  canvasId,
  canvasScopeId,
  open,
  panelRef,
  retryEnabled,
  waitForCanvasRevision,
}: {
  canvasId: string;
  canvasScopeId: string;
  open: boolean;
  panelRef?: Ref<HTMLElement>;
  retryEnabled: boolean;
  waitForCanvasRevision?: () => Promise<number>;
}) {
  const [tasks, setTasks] = useState<GenerationTaskSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState("");
  const [readError, setReadError] = useState("");
  const [groupSummary, setGroupSummary] = useState<GroupRunSummary>();
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
    setGroupSummary(readLastGroupRunSummary(canvasId));
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
  }, [open, canvasId, canvasScopeId]);

  useEffect(() => {
    const onSummary = (event: Event) => {
      const summary = (event as CustomEvent<GroupRunSummary>).detail;
      if (!summary || summary.canvasId !== canvasId) return;
      setGroupSummary(summary);
    };
    window.addEventListener(GROUP_RUN_SUMMARY_EVENT, onSummary);
    return () => window.removeEventListener(GROUP_RUN_SUMMARY_EVENT, onSummary);
  }, [canvasId]);

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
      {loading && tasks.length === 0 ? (
        <p className="tasks-empty">正在读取生成任务…</p>
      ) : tasks.length === 0 ? (
        <p className="tasks-empty" data-testid="tasks-empty">
          还没有生成任务
        </p>
      ) : (
        <div className="tasks-list" data-testid="tasks-list">
          {groupSummary && (
            <p className="tasks-group-summary" data-testid="tasks-group-summary">
              {`本轮整组 ${groupSummary.nodeCount} 个节点 · 共用时 ${formatGenerationDuration(groupSummary.elapsedMs)}`}
            </p>
          )}
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
