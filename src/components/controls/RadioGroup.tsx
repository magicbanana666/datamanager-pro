import clsx from "clsx";

export interface RadioOption<T extends string> {
  value: T;
  label: string;
  description?: string;
}

interface RadioGroupProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: RadioOption<T>[];
  name: string;
  direction?: "vertical" | "horizontal";
  disabled?: boolean;
}

export function RadioGroup<T extends string>({
  value,
  onChange,
  options,
  name,
  direction = "vertical",
  disabled,
}: RadioGroupProps<T>) {
  return (
    <div className={clsx("flex min-w-0 gap-2.5", direction === "vertical" ? "flex-col" : "flex-row flex-wrap items-center")}>
      {options.map((opt) => {
        const checked = opt.value === value;
        return (
          <label
            key={opt.value}
            className={clsx(
              "flex min-w-0 items-start gap-2 select-none",
              disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer",
            )}
          >
            <input
              type="radio"
              name={name}
              className="sr-only"
              checked={checked}
              disabled={disabled}
              onChange={() => onChange(opt.value)}
            />
            <span
              className={clsx(
                "mt-[1px] flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full border transition-colors",
                checked ? "border-accent" : "border-border-strong",
              )}
            >
              {checked && <span className="h-[7px] w-[7px] rounded-full bg-accent" />}
            </span>
            <span className="min-w-0 leading-tight">
              <span className="block text-[13px] text-fg">{opt.label}</span>
              {opt.description && <span className="block text-xs text-fg-muted">{opt.description}</span>}
            </span>
          </label>
        );
      })}
    </div>
  );
}
