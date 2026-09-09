import type { InputHTMLAttributes } from "react";
import clsx from "clsx";
import type { LucideIcon } from "lucide-react";

interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  icon?: LucideIcon;
  containerClassName?: string;
}

export function TextInput({ icon: Icon, className, containerClassName, ...rest }: TextInputProps) {
  return (
    <div className={clsx("relative flex items-center", containerClassName)}>
      {Icon && <Icon size={14} className="pointer-events-none absolute left-2.5 text-fg-subtle" />}
      <input
        className={clsx(
          "h-8 w-full rounded-md border border-border-strong bg-surface px-2.5 text-[13px] text-fg placeholder:text-fg-subtle transition-colors",
          "hover:border-fg-subtle focus:border-accent",
          Icon && "pl-8",
          className,
        )}
        {...rest}
      />
    </div>
  );
}
