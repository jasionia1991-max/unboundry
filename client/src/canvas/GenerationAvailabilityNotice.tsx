import { useState } from "react";
import type { GenerationTaskKind } from "../generation/generationTasks";
import { useCreatorOverlayCoordinator } from "./CreatorOverlayCoordinator";

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
  const [open, setOpen] = useState(false);
  const announceOpen = useCreatorOverlayCoordinator(() => setOpen(false));
  const message = reason?.trim() ?? "";
  if (canvasId !== "default" || !message) return null;
  return (
    <details
      className="generation-availability-notice"
      data-testid={`${kind}-generation-unavailable`}
      onToggle={(event) => {
        const nextOpen = event.currentTarget.open;
        if (nextOpen && !open) announceOpen();
        if (nextOpen !== open) setOpen(nextOpen);
      }}
      open={open}
      role="status"
    >
      <summary aria-label="暂不可生成" title={`当前无法生成：${message}`}>
        <span aria-hidden="true" />
      </summary>
      <p>当前无法生成：{message}</p>
    </details>
  );
}
