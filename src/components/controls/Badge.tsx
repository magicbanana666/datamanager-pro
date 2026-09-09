import type { ReactNode } from "react";
import clsx from "clsx";
import type { StatusTone } from "@/utils/colors";

interface BadgeProps {
  tone?: StatusTone;
  children?: ReactNode;
  dot?: boolean;
  className?: string;
}

const toneClasses: Record<StatusTone, string> = {
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-accent-soft text-info",
  neutral: "bg-surface-hover text-fg-muted",
  accent: "bg-accent-soft text-accent",
};

const dotClasses: Record<StatusTone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
  neutral: "bg-fg-subtle",
  accent: "bg-accent",
};

export function Badge({ tone = "neutral", children, dot, className }: BadgeProps) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium",
        toneClasses[tone],
        className,
      )}
    >
      {dot && <span className={clsx("h-[6px] w-[6px] rounded-full", dotClasses[tone])} />}
      {children}
    </span>
  );
}
