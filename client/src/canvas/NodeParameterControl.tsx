import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CompositionEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type {
  ModelParameterField,
  ModelParameterSchema,
  ModelParameterValue,
} from "../../../types/modelParameters";
import {
  parameterFieldEnabled,
  parameterFieldVisible,
  parameterOptionEnabled,
} from "../../../types/modelParameters";
import { useCompositionSafeText } from "./CompositionSafeText";

function TextParameterField({
  disabled,
  field,
  onChange,
  onEditSessionStart,
  value,
}: {
  disabled: boolean;
  field: ModelParameterField;
  onChange: (value: string) => void;
  onEditSessionStart?: () => void;
  value: string;
}) {
  const control = useCompositionSafeText({
    onCommit: onChange,
    onEditSessionStart,
    value,
  });
  const shared = {
    "aria-label": field.label,
    "data-canvas-text-edit": "graph",
    "data-composition-active": control.composing || undefined,
    disabled,
    maxLength: field.maxLength,
    onBlur: () => control.blur(),
    onChange: (
      event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) =>
      control.change(
        event.target.value,
        (event.nativeEvent as InputEvent).isComposing,
      ),
    onCompositionEnd: (
      event: CompositionEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => control.compositionEnd(event.currentTarget.value),
    onCompositionStart: () => control.compositionStart(),
    onKeyDown: (
      event: ReactKeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => {
      control.keyDown(event);
    },
    placeholder: field.placeholder,
    value: control.value,
  };

  return field.type === "textarea" ? (
    <textarea {...shared} />
  ) : (
    <input {...shared} type="text" />
  );
}

function valueLabel(
  schema: ModelParameterSchema,
  key: string,
  value: ModelParameterValue | undefined,
) {
  const item = schema.fields.find((field) => field.key === key);
  return item?.options.find((option) => option.value === value)?.label ?? String(value ?? "");
}

export function NodeParameterControl({
  disabled = false,
  dialogKeys,
  emptyLabel = "参数",
  keys,
  onChange,
  onEditSessionStart,
  schema,
  values,
}: {
  disabled?: boolean;
  /**
   * Fields shown inside this trigger's dialog. The trigger summary continues
   * to use `keys`, so adding an administrator-defined text field does not
   * change an already accepted node toolbar layout.
   */
  dialogKeys?: string[];
  emptyLabel?: string;
  keys: string[];
  onChange: (key: string, value: ModelParameterValue) => void;
  onEditSessionStart?: () => void;
  schema: ModelParameterSchema;
  values: Record<string, ModelParameterValue>;
}) {
  const [open, setOpen] = useState(false);
  const controlRef = useRef<HTMLDivElement>(null);
  const summaryFields = useMemo(
    () => keys.flatMap((key) => schema.fields.filter((field) =>
      field.key === key && parameterFieldVisible(field, values))),
    [keys, schema.fields, values],
  );
  const fields = useMemo(
    () => (dialogKeys ?? keys).flatMap((key) => schema.fields.filter((field) =>
      field.key === key && parameterFieldVisible(field, values))),
    [dialogKeys, keys, schema.fields, values],
  );

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!controlRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeEscape);
    };
  }, [open]);

  // A parameter control is an editor, not a layout placeholder. Models are
  // allowed to publish no fields for a group (for example, a text model whose
  // only input mode is fixed). In that case rendering a disabled button made
  // the creator show a permanent "暂无参数" row. Keep the creator clean and
  // let its flex layout close the gap naturally.
  if (fields.length === 0) return null;

  const summary = summaryFields
    .map((field) => valueLabel(schema, field.key, values[field.key]))
    .filter(Boolean)
    .join(" · ");
  const triggerLabel = summary ||
    [...new Set(fields.map((field) => field.label))].join(" · ") ||
    emptyLabel;

  return (
    <div
      className="node-parameter-control nodrag nopan"
      data-open={open ? "true" : "false"}
      ref={controlRef}
    >
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        className="node-parameter-trigger"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        {triggerLabel}
      </button>
      {open && !disabled && (
        <div
          aria-label="模型参数"
          className="node-parameter-panel"
          role="dialog"
        >
          {fields.map((field) => {
            const fieldDisabled = !parameterFieldEnabled(field, values);
            return (
            <section data-enabled={fieldDisabled ? "false" : "true"} key={field.key}>
              <span>{field.label}</span>
              <div role="group" aria-label={field.label}>
                {(field.type === "select" || field.type === "boolean") && field.options.map((option) => {
                  const optionDisabled = fieldDisabled || !parameterOptionEnabled(option, values);
                  return (
                  <button
                    aria-pressed={values[field.key] === option.value}
                    data-selected={values[field.key] === option.value ? "true" : "false"}
                    disabled={optionDisabled}
                    key={`${field.key}-${String(option.value)}`}
                    onClick={() => {
                      onEditSessionStart?.();
                      onChange(field.key, option.value);
                    }}
                    title={optionDisabled ? option.disabledReason : undefined}
                    type="button"
                  >
                    {option.label}
                  </button>
                  );
                })}
                {(field.type === "text" || field.type === "textarea") && (
                  <TextParameterField
                    disabled={fieldDisabled}
                    field={field}
                    onChange={(value) => onChange(field.key, value)}
                    onEditSessionStart={onEditSessionStart}
                    value={String(values[field.key] ?? "")}
                  />
                )}
                {field.type === "number" && (
                  <input
                    aria-label={field.label}
                    data-canvas-text-edit="graph"
                    disabled={fieldDisabled}
                    max={field.max}
                    min={field.min}
                    onChange={(event) => {
                      onEditSessionStart?.();
                      onChange(field.key, Number(event.target.value));
                    }}
                    step={field.step}
                    type="number"
                    value={Number(values[field.key] ?? field.defaultValue)}
                  />
                )}
              </div>
            </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
