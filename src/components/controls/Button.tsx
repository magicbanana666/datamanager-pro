import type { ButtonHTMLAttributes, ReactNode } from "react";
import clsx from "clsx";
import type { LucideIcon } from "lucide-react";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "success";
type Size = "sm" | "md";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: LucideIcon;
  iconPosition?: "left" | "right";
  children?: ReactNode;
}

const variantClasses: Record<Variant, string> = {
  primary: "bg-accent hover:bg-accent-hover text-fg-on-accent border-transparent",
  secondary: "bg-surface hover:bg-surface-hover text-fg border-border-strong",
  ghost: "bg-transparent hover:bg-surface-hover text-fg-muted hover:text-fg border-transparent",
  danger: "bg-danger hover:brightness-110 text-fg-on-accent border-transparent",
  success: "bg-success hover:brightness-110 text-fg-on-accent border-transparent",
};

const sizeClasses: Record<Size, string> = {
  sm: "h-7 px-2.5 text-xs gap-1.5",
  md: "h-8 px-3.5 text-[13px] gap-2",
};

export function Button({
  variant = "secondary",
  size = "md",
  icon: Icon,
  iconPosition = "left",
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={clsx(
        "inline-flex items-center justify-center rounded-md border font-medium whitespace-nowrap transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer",
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      disabled={disabled}
      {...rest}
    >
      {Icon && iconPosition === "left" && <Icon size={size === "sm" ? 14 : 15} strokeWidth={2} />}
      {children}
      {Icon && iconPosition === "right" && <Icon size={size === "sm" ? 14 : 15} strokeWidth={2} />}
    </button>
  );
}
