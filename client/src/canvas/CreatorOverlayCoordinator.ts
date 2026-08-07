import { useCallback, useEffect, useId, useRef } from "react";

const creatorOverlayOpenEvent = "unboundry:creator-overlay-open";

/**
 * Creator popovers share one global open surface. This keeps reference detail,
 * overflow, input-blocker and generation-blocker panels from stacking while
 * leaving their trigger buttons visible.
 */
export function useCreatorOverlayCoordinator(onForeignOpen: () => void) {
  const ownerId = useId();
  const closeRef = useRef(onForeignOpen);
  closeRef.current = onForeignOpen;

  useEffect(() => {
    const closeForForeignOwner = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== ownerId) {
        closeRef.current();
      }
    };
    window.addEventListener(creatorOverlayOpenEvent, closeForForeignOwner);
    return () => window.removeEventListener(
      creatorOverlayOpenEvent,
      closeForForeignOwner,
    );
  }, [ownerId]);

  return useCallback(() => {
    window.dispatchEvent(new CustomEvent(creatorOverlayOpenEvent, {
      detail: ownerId,
    }));
  }, [ownerId]);
}
