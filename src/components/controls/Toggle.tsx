import clsx from "clsx";

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
}

export function Toggle({ checked, onChange, label, disabled }: ToggleProps) {
  return (
    <label
      className={clsx(
        "inline-flex items-center gap-2.5 select-none",
        disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer",
      )}
    >
      <span
        role="switch"
        aria-checked={checked}
        tabIndex={disabled ? -1 : 0}
        onClick={() => !disabled && onChange(!checked)}
        onKeyDown={(e) => {
          if (!disabled && (e.key === " " || e.key === "Enter")) {
            e.preventDefault();
            onChange(!checked);
          }
        }}
        className={clsx(
          "relative h-[18px] w-8 shrink-0 rounded-full transition-colors",
          checked ? "bg-success" : "bg-border-strong",
        )}
      >
        <span
          className={clsx(
            "absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white transition-transform",
            checked ? "translate-x-[16px]" : "translate-x-[2px]",
          )}
        />
      </span>
      {label && <span className="text-[13px] text-fg">{label}</span>}
    </label>
  );
}
