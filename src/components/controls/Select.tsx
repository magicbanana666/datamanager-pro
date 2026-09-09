import type { SelectHTMLAttributes } from "react";
import clsx from "clsx";
import { ChevronDown } from "lucide-react";

interface Option {
  value: string;
  label: string;
}

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "children"> {
  options: Option[];
  containerClassName?: string;
}

export function Select({ options, className, containerClassName, ...rest }: SelectProps) {
  return (
    <div className={clsx("relative", containerClassName)}>
      <select
        className={clsx(
          "h-8 w-full cursor-pointer appearance-none rounded-md border border-border-strong bg-surface pl-2.5 pr-7 text-[13px] text-fg transition-colors",
          "hover:border-fg-subtle focus:border-accent",
          className,
        )}
        {...rest}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" />
    </div>
  );
}
