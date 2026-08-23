import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  imageToolDescriptors,
  type ImageToolId,
  type ImageToolPresentation,
  type ImageToolSurfaceTone,
} from "./imageToolUiContract";

const viewportGutter = 16;
const anchorGap = 12;

type PopoverPosition = Readonly<{
  left: number;
  placement: "above" | "below";
  top: number;
}>;

function focusableElements(root: HTMLElement) {
  return [...root.querySelectorAll<HTMLElement>([
    "button:not(:disabled)",
    "[href]",
    "input:not(:disabled)",
    "select:not(:disabled)",
    "textarea:not(:disabled)",
    "[tabindex]:not([tabindex='-1'])",
  ].join(","))].filter((element) =>
    !element.hidden && element.getClientRects().length > 0
  );
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

export function ImageToolSurface({
  children,
  className = "",
  tone = "checkerboard",
}: Readonly<{
  children: ReactNode;
  className?: string;
  tone?: ImageToolSurfaceTone;
}>) {
  return (
    <div
      className={`image-tool-surface image-tool-surface-${tone} ${className}`.trim()}
      data-surface-tone={tone}
      data-testid="image-tool-surface"
    >
      {children}
    </div>
  );
}

export function ImageToolModal({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="image-tool-modal">{children}</div>;
}

export function ImageToolPopover({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="image-tool-popover">{children}</div>;
}

export function ImageToolHost({
  activeTool,
  anchor,
  busy = false,
  children,
  onClose,
  returnFocus,
}: Readonly<{
  activeTool: ImageToolId | null;
  anchor?: HTMLElement | null;
  busy?: boolean;
  children?: ReactNode;
  onClose(): void;
  returnFocus?: HTMLElement | null;
}>) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [popoverPosition, setPopoverPosition] = useState<PopoverPosition>();
  const descriptor = activeTool ? imageToolDescriptors[activeTool] : undefined;

  useLayoutEffect(() => {
    if (!descriptor || descriptor.presentation !== "popover") {
      setPopoverPosition(undefined);
      return;
    }
    const panel = panelRef.current;
    if (!panel) return;
    const position = () => {
      const panelBounds = panel.getBoundingClientRect();
      const anchorBounds = anchor?.getBoundingClientRect();
      const fallbackLeft = (window.innerWidth - panelBounds.width) / 2;
      const fallbackTop = (window.innerHeight - panelBounds.height) / 2;
      const desiredLeft = anchorBounds
        ? anchorBounds.left + anchorBounds.width / 2 - panelBounds.width / 2
        : fallbackLeft;
      const below = anchorBounds
        ? anchorBounds.bottom + anchorGap
        : fallbackTop;
      const above = anchorBounds
        ? anchorBounds.top - panelBounds.height - anchorGap
        : fallbackTop;
      const fitsBelow = below + panelBounds.height <= window.innerHeight - viewportGutter;
      setPopoverPosition({
        left: clamp(
          desiredLeft,
          viewportGutter,
          window.innerWidth - panelBounds.width - viewportGutter,
        ),
        placement: fitsBelow ? "below" : "above",
        top: clamp(
          fitsBelow ? below : above,
          viewportGutter,
          window.innerHeight - panelBounds.height - viewportGutter,
        ),
      });
    };
    position();
    const resizeObserver = new ResizeObserver(position);
    resizeObserver.observe(panel);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [activeTool, anchor, descriptor]);

  useEffect(() => {
    if (!descriptor) return;
    const panel = panelRef.current;
    const focusables = panel ? focusableElements(panel) : [];
    (focusables[0] ?? panel)?.focus({ preventScroll: true });
    if (!descriptor.inertBackground) return;
    const applicationRoot = document.getElementById("root");
    if (!applicationRoot) return;
    const previousAriaHidden = applicationRoot.getAttribute("aria-hidden");
    const wasInert = applicationRoot.hasAttribute("inert");
    applicationRoot.setAttribute("aria-hidden", "true");
    applicationRoot.setAttribute("inert", "");
    return () => {
      if (!wasInert) applicationRoot.removeAttribute("inert");
      if (previousAriaHidden === null) applicationRoot.removeAttribute("aria-hidden");
      else applicationRoot.setAttribute("aria-hidden", previousAriaHidden);
    };
  }, [activeTool, descriptor]);

  useEffect(() => {
    if (activeTool) return;
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  }, [activeTool, returnFocus]);

  if (!activeTool || !descriptor) return null;
  const presentation: ImageToolPresentation = descriptor.presentation;
  const panelStyle: CSSProperties = presentation === "popover"
    ? {
        left: popoverPosition?.left,
        maxWidth: `min(${descriptor.maximumWidth}px, calc(100vw - 32px))`,
        top: popoverPosition?.top,
        visibility: popoverPosition ? "visible" : "hidden",
      }
    : { maxWidth: `min(${descriptor.maximumWidth}px, 100vw)` };
  const content = presentation === "modal"
    ? <ImageToolModal>{children}</ImageToolModal>
    : <ImageToolPopover>{children}</ImageToolPopover>;

  return createPortal(
    <div
      className={`image-tool-host image-tool-host-${presentation}`}
      data-active-tool={activeTool}
      data-presentation={presentation}
      data-testid="image-tool-host"
      onMouseDown={(event) => {
        if (
          event.target === event.currentTarget && descriptor.closeOnOutside &&
          !busy
        ) onClose();
      }}
    >
      <div
        aria-label={descriptor.label}
        aria-modal={descriptor.inertBackground ? "true" : undefined}
        className="image-tool-host-panel nodrag nopan nowheel"
        data-placement={popoverPosition?.placement}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            if (!busy) onClose();
            return;
          }
          if (event.key !== "Tab") return;
          const panel = panelRef.current;
          if (!panel) return;
          const focusables = focusableElements(panel);
          if (focusables.length === 0) {
            event.preventDefault();
            panel.focus();
            return;
          }
          const first = focusables[0]!;
          const last = focusables[focusables.length - 1]!;
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
        ref={panelRef}
        role="dialog"
        style={panelStyle}
        tabIndex={-1}
      >
        {content}
      </div>
    </div>,
    document.body,
  );
}
