export function GenerationReconcileControls({
  busy,
  canRetry,
  needsTaskId,
  onReconcile,
  onRetry,
  providerTaskDraft,
  retryEnabled,
  setProviderTaskDraft,
}: {
  busy: boolean;
  canRetry: boolean;
  needsTaskId: boolean;
  onReconcile: () => void;
  onRetry?: () => void;
  providerTaskDraft: string;
  retryEnabled: boolean;
  setProviderTaskDraft: (value: string) => void;
}) {
  return (
    <>
      <button
        aria-label="核对结果"
        data-testid="generation-reconcile"
        disabled={busy || !retryEnabled}
        onClick={onReconcile}
        type="button"
      >
        {busy ? "核对中" : "核对结果"}
      </button>
      {needsTaskId && (
        <label className="generation-reconcile-task-id">
          <span>平台任务号</span>
          <input
            data-testid="generation-reconcile-task-id"
            disabled={busy}
            onChange={(event) => setProviderTaskDraft(event.target.value)}
            placeholder="填写后点核对结果"
            value={providerTaskDraft}
          />
        </label>
      )}
      {canRetry && onRetry && (
        <button
          aria-label="重试生成"
          disabled={busy || !retryEnabled}
          onClick={onRetry}
          type="button"
        >
          重试
        </button>
      )}
    </>
  );
}
