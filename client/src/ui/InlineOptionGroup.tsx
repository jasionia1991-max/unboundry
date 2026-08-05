export type InlineOptionGroupOption = {
  disabled?: boolean;
  label: string;
  value: string;
};

export function InlineOptionGroup({
  ariaLabel,
  className = "",
  disabled = false,
  onChange,
  options,
  testId,
  value,
}: {
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  options: InlineOptionGroupOption[];
  testId?: string;
  value: string;
}) {
  return (
    <div
      aria-label={ariaLabel}
      className={["inline-option-group", className].filter(Boolean).join(" ")}
      data-testid={testId}
      role="group"
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            aria-checked={selected}
            className="inline-option-group-option"
            data-selected={selected ? "true" : "false"}
            data-value={option.value}
            disabled={disabled || option.disabled}
            key={option.value}
            onClick={() => onChange(option.value)}
            role="radio"
            type="button"
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
