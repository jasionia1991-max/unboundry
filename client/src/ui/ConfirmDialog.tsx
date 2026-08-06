import { useEffect, useRef } from "react";

export function ConfirmDialog({
  cancelLabel = "取消",
  confirmLabel = "删除",
  danger = false,
  message,
  onCancel,
  onConfirm,
  title,
}: {
  cancelLabel?: string;
  confirmLabel?: string;
  danger?: boolean;
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onCancel]);

  return (
    <div
      className="confirm-overlay"
      data-testid="confirm-dialog"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
      role="presentation"
    >
      <section
        aria-modal="true"
        className="confirm-dialog"
        role="dialog"
      >
        <strong>{title}</strong>
        <p>{message}</p>
        <div className="confirm-dialog-actions">
          <button
            className="confirm-cancel"
            onClick={onCancel}
            ref={cancelRef}
            type="button"
          >
            {cancelLabel}
          </button>
          <button
            className={danger ? "confirm-danger" : "confirm-primary"}
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
