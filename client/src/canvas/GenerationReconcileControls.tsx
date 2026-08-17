export function GenerationReconcileControls({
  busy,
  canRetry,
  onReconcile,
  onRetry,
  retryEnabled,
}: {
  busy: boolean;
  canRetry: boolean;
  onReconcile: () => void;
  onRetry?: () => void;
  retryEnabled: boolean;
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
