import { createContext, useContext } from "react";

export const CanvasCheckpointContext = createContext<(history?: boolean) => void>(
  () => {},
);

export function useCanvasCheckpoint() {
  return useContext(CanvasCheckpointContext);
}

/**
 * Text controls own their undo stack. Canvas history must only handle graph
 * operations, otherwise an IME composition can be replayed as its temporary
 * pinyin values and can consume an unrelated node/edge checkpoint.
 */
export function closestEditableControl(target: EventTarget | null) {
  if (!(target instanceof Element)) return null;
  return target.closest(
    'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
  );
}
