import { useEffect, useId, useRef } from "react";

export function ConfirmDialog({
  busy = false,
  cancelLabel = "取消",
  confirmLabel = "删除",
  danger = false,
  message,
  onCancel,
  onConfirm,
  title,
}: {
  busy?: boolean;
  cancelLabel?: string;
  confirmLabel?: string;
  danger?: boolean;
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const busyRef = useRef(busy);
  const onCancelRef = useRef(onCancel);
  const descriptionId = useId();
  const titleId = useId();
  busyRef.current = busy;
  onCancelRef.current = onCancel;

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : undefined;
    const focusInsideDialog = () => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )];
      (focusable[0] ?? dialog).focus();
    };
    focusInsideDialog();

    const containFocus = (event: FocusEvent) => {
      const dialog = dialogRef.current;
      if (dialog && event.target instanceof Node && !dialog.contains(event.target)) {
        focusInsideDialog();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      if (event.key === "Escape") {
        event.preventDefault();
        if (!busyRef.current) onCancelRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )];
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1)!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("focusin", containFocus);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("focusin", containFocus);
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, []);

  useEffect(() => {
    if (busy) {
      dialogRef.current?.focus();
    } else if (
      dialogRef.current &&
      !dialogRef.current.contains(document.activeElement)
    ) {
      cancelRef.current?.focus();
    }
  }, [busy]);

  return (
    <div
      className="confirm-overlay"
      data-testid="confirm-dialog"
      onMouseDown={(event) => {
        if (!busy && event.target === event.currentTarget) onCancel();
      }}
      role="presentation"
    >
      <section
        aria-busy={busy}
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="confirm-dialog"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <strong id={titleId}>{title}</strong>
        <p id={descriptionId}>{message}</p>
        <div className="confirm-dialog-actions">
          <button
            className="confirm-cancel"
            disabled={busy}
            onClick={onCancel}
            ref={cancelRef}
            type="button"
          >
            {cancelLabel}
          </button>
          <button
            className={danger ? "confirm-danger" : "confirm-primary"}
            disabled={busy}
            onClick={onConfirm}
            type="button"
          >
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
