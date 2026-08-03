import type { GenerationTaskKind } from "../generation/generationTasks";

/**
 * Real-canvas runtime blockers are visible without changing the accepted
 * creator layout when a model is runnable. Fixture pages remain zero-Provider
 * visual states and keep their frozen geometry.
 */
export function GenerationAvailabilityNotice({
  canvasId,
  kind,
  reason,
}: {
  canvasId: string;
  kind: GenerationTaskKind;
  reason?: string;
}) {
  const message = reason?.trim() ?? "";
  if (canvasId !== "default" || !message) return null;
  return (
    <div
      className="upstream-input-problem generation-availability-notice"
      data-testid={`${kind}-generation-unavailable`}
      role="status"
    >
      当前无法生成：{message}
    </div>
  );
}
