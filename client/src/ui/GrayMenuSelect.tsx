import { useEffect, useRef, useState } from "react";

export type GrayMenuSelectOption = {
  disabled?: boolean;
  label: string;
  value: string;
};

export function GrayMenuSelect({
  ariaLabel,
  chevronClassName = "gray-menu-select-chevron",
  className = "",
  disabled = false,
  menuClassName = "gray-menu-select-menu",
  onChange,
  optionClassName = "gray-menu-select-option",
  options,
  placeholder = "请选择",
  testId,
  triggerClassName = "gray-menu-select-trigger",
  value,
}: {
  ariaLabel?: string;
  chevronClassName?: string;
  className?: string;
  disabled?: boolean;
  menuClassName?: string;
  onChange: (value: string) => void;
  optionClassName?: string;
  options: GrayMenuSelectOption[];
  placeholder?: string;
  testId?: string;
  triggerClassName?: string;
  value: string;
}) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<"down" | "up">("down");
  const controlRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!controlRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeEscape);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const updatePlacement = () => {
      const control = controlRef.current;
      const menu = menuRef.current;
      if (!control || !menu) return;
      const controlBox = control.getBoundingClientRect();
      const menuHeight = menu.getBoundingClientRect().height;
      const spaceBelow = window.innerHeight - controlBox.bottom - 8;
      const spaceAbove = controlBox.top - 8;
      setPlacement(
        spaceBelow < menuHeight && spaceAbove > spaceBelow ? "up" : "down",
      );
    };
    updatePlacement();
    window.addEventListener("resize", updatePlacement);
    window.addEventListener("scroll", updatePlacement, true);
    return () => {
      window.removeEventListener("resize", updatePlacement);
      window.removeEventListener("scroll", updatePlacement, true);
    };
  }, [open, options.length]);

  return (
    <div
      className={["gray-menu-select", className].filter(Boolean).join(" ")}
      data-open={open ? "true" : "false"}
      data-placement={placement}
      data-testid={testId}
      ref={controlRef}
    >
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        className={triggerClassName}
        data-value={value}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        ref={triggerRef}
        role="combobox"
        type="button"
      >
        <span>{selected?.label ?? placeholder}</span>
        <span aria-hidden="true" className={chevronClassName} />
      </button>
      {open && !disabled && (
        <div className={menuClassName} ref={menuRef} role="listbox">
          {options.map((option) => {
            const selectedOption = option.value === value;
            return (
              <button
                aria-selected={selectedOption}
                className={optionClassName}
                data-selected={selectedOption ? "true" : "false"}
                data-value={option.value}
                disabled={option.disabled}
                key={option.value}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                role="option"
                type="button"
              >
                <span>{option.label}</span>
                {selectedOption && <span aria-hidden="true">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
