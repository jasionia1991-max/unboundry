import { useEffect, useRef, useState } from "react";
import {
  cancelGenerationTask,
  listGenerationTasks,
  retryGenerationTask,
  type GenerationTaskSummary,
} from "../generation/generationTasks";

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

function TaskRow({
  onChanged,
  task,
}: {
  onChanged: () => void;
  task: GenerationTaskSummary;
}) {
  const [busy, setBusy] = useState(false);
  const active = activeStates.has(task.state);
  const retryable = task.state === "failed" && task.retryAllowed === true;
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
      <span className="tasks-row-time">
        {relativeTime(task.updatedAt)}
      </span>
      <span className="tasks-row-actions">
        {active && (
          <button
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void cancelGenerationTask(task.id)
                .catch(() => undefined)
                .finally(() => {
                  setBusy(false);
                  onChanged();
                });
            }}
            type="button"
          >
            取消
          </button>
        )}
        {retryable && (
          <button
            data-testid={`tasks-retry-${task.id}`}
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void retryGenerationTask(task.id)
                .catch(() => undefined)
                .finally(() => {
                  setBusy(false);
                  onChanged();
                });
            }}
            type="button"
          >
            重试
          </button>
        )}
      </span>
    </li>
  );
}

export function GenerationTasksPanel({
  canvasId,
  open,
}: {
  canvasId: string;
  open: boolean;
}) {
  const [tasks, setTasks] = useState<GenerationTaskSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = () => {
    if (!canvasId) return;
    listGenerationTasks(canvasId)
      .then((next) => {
        if (!mounted.current) return;
        setTasks(next);
        setError("");
      })
      .catch(() => {
        if (!mounted.current) return;
        setError("生成任务读取失败，请稍后再试");
      })
      .finally(() => {
        if (mounted.current) setLoading(false);
      });
  };

  useEffect(() => {
    if (!open || !canvasId) return;
    refresh();
    const timer = window.setInterval(refresh, 3_000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, canvasId]);

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
  const changed = () => refresh();

  return (
    <section
      aria-label="生成任务"
      className="tasks-panel"
      data-testid="tasks-panel"
    >
      <header className="tasks-panel-header">
        <strong>生成任务</strong>
        <span>最近任务</span>
      </header>
      <div className="tasks-divider" />
      {error && <p className="tasks-error" role="alert">{error}</p>}
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
                  <TaskRow key={task.id} onChanged={changed} task={task} />
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
                  <TaskRow key={task.id} onChanged={changed} task={task} />
                ))}
              </ul>
            </section>
          )}
          {recent.length > 0 && (
            <section className="tasks-group">
              <h3>最近完成</h3>
              <ul>
                {recent.map((task) => (
                  <TaskRow key={task.id} onChanged={changed} task={task} />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </section>
  );
}
