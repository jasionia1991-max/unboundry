import {
  resolvePublishedModelSelection,
  useModelCatalogStatus,
  usePublishedModels,
  type ModelCapability,
} from "../models/ModelCatalog";
import { useEffect, useRef, useState } from "react";

export function NodeModelControl({
  capability,
  disabled = false,
  icon = "media",
  onChange,
  selectedId,
  selectedName,
}: {
  capability: ModelCapability;
  disabled?: boolean;
  icon?: "media" | "text";
  onChange: (id: string, displayName: string) => void;
  selectedId?: string;
  selectedName?: string;
}) {
  const models = usePublishedModels(capability);
  const catalogStatus = useModelCatalogStatus();
  const [open, setOpen] = useState(false);
  const controlRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!controlRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  if (catalogStatus === "loading" || models === undefined) {
    return (
      <button disabled type="button">
        {icon === "text" ? (
          <span className="text-creator-model-mark">✦</span>
        ) : (
          <span className="image-creator-model-mark" />
        )}
        加载模型…
      </button>
    );
  }

  if (catalogStatus === "error") {
    return (
      <button data-model-status="error" disabled type="button">
        {icon === "text" ? (
          <span className="text-creator-model-mark">✦</span>
        ) : (
          <span className="image-creator-model-mark" />
        )}
        模型加载失败
      </button>
    );
  }

  const selection = resolvePublishedModelSelection({
    models,
    savedId: selectedId,
    savedName: selectedName,
    status: catalogStatus,
  });
  const current = selection.model;
  const currentUnavailable = Boolean(selection.unavailableReason);
  const currentUnavailableReason = selection.unavailableReason;
  const controlDisabled = disabled || models.length === 0;
  return (
    <div
      className="node-model-control nodrag nopan"
      data-capability={capability}
      data-generation-available={
        selection.savedModelUnavailable
          ? "false"
          : current?.generationAvailable === true
          ? "true"
          : current?.generationAvailable === false
            ? "false"
            : undefined
      }
      data-generation-reason-code={
        selection.savedModelUnavailable
          ? "SAVED_MODEL_UNAVAILABLE"
          : current?.generationUnavailableReasonCode ?? undefined
      }
      data-model-status={models.length ? "ready" : "empty"}
      data-open={open ? "true" : "false"}
      data-testid={`${capability}-model-control`}
      ref={controlRef}
    >
      {icon === "text" ? (
        <span className="text-creator-model-mark">✦</span>
      ) : (
        <span className="image-creator-model-mark" />
      )}
      <button
        aria-controls={`${capability}-model-options`}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`${capability}模型`}
        aria-description={
          currentUnavailable ? currentUnavailableReason : undefined
        }
        className="node-model-control-trigger"
        data-value={selection.selectedId ?? ""}
        disabled={controlDisabled}
        onClick={() => setOpen((value) => !value)}
        role="combobox"
        title={currentUnavailable ? currentUnavailableReason : undefined}
        type="button"
      >
        <span>
          {selection.displayName ?? "暂无可用模型"}
          {selection.savedModelUnavailable
            ? " · 原模型不可用"
            : currentUnavailable
              ? " · 暂不可生成"
              : ""}
        </span>
        <span aria-hidden="true" className="node-model-control-chevron" />
      </button>
      {open && !controlDisabled && (
        <div
          aria-label={`${capability}模型选项`}
          className="node-model-control-menu"
          id={`${capability}-model-options`}
          role="listbox"
        >
          {models.map((model) => {
            const unavailable = model.generationAvailable === false;
            const reason = model.generationUnavailableReason ||
              "当前模型暂不可生成";
            return (
              <button
                aria-label={unavailable
                  ? `${model.displayName}，暂不可生成：${reason}`
                  : model.displayName}
                aria-selected={model.id === selection.selectedId}
                className="node-model-control-option"
                data-generation-available={model.generationAvailable === true
                  ? "true"
                  : model.generationAvailable === false
                    ? "false"
                    : undefined}
                data-generation-reason-code={
                  model.generationUnavailableReasonCode ?? undefined
                }
                data-selected={model.id === selection.selectedId ? "true" : "false"}
                key={model.id}
                onClick={() => {
                  onChange(model.id, model.displayName);
                  setOpen(false);
                }}
                role="option"
                title={unavailable ? reason : undefined}
                type="button"
              >
                <span>
                  {model.displayName}
                  {unavailable ? " · 暂不可生成" : ""}
                </span>
                {model.id === selection.selectedId && <span aria-hidden="true">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
