import type { ReactNode } from "react";
import clsx from "clsx";
import { Check, Minus } from "lucide-react";

interface CheckboxProps {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
  className?: string;
}

export function Checkbox({ checked, indeterminate, onChange, label, disabled, className }: CheckboxProps) {
  return (
    <label
      className={clsx(
        "flex min-w-0 items-center gap-2 select-none",
        disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer",
        className,
      )}
    >
      <span
        role="checkbox"
        aria-checked={indeterminate ? "mixed" : checked}
        tabIndex={disabled ? -1 : 0}
        onClick={() => !disabled && onChange(!checked)}
        onKeyDown={(e) => {
          if (!disabled && (e.key === " " || e.key === "Enter")) {
            e.preventDefault();
            onChange(!checked);
          }
        }}
        className={clsx(
          "flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-[3px] border transition-colors",
          checked || indeterminate
            ? "bg-accent border-accent"
            : "bg-surface border-border-strong",
        )}
      >
        {indeterminate ? (
          <Minus size={11} strokeWidth={3} className="text-fg-on-accent" />
        ) : checked ? (
          <Check size={11} strokeWidth={3} className="text-fg-on-accent" />
        ) : null}
      </span>
      {label && <span className="min-w-0 text-[13px] text-fg">{label}</span>}
    </label>
  );
}
