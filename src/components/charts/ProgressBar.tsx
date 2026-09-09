import clsx from "clsx";
import type { StatusTone } from "@/utils/colors";

interface ProgressBarProps {
  value: number;
  tone?: StatusTone;
  showLabel?: boolean;
  height?: number;
  className?: string;
}

const toneClasses: Record<StatusTone, string> = {
  accent: "bg-accent",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
  neutral: "bg-fg-subtle",
};

export function ProgressBar({ value, tone = "accent", showLabel, height = 8, className }: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, value));
  return (
    <div className={clsx("flex items-center gap-2", className)}>
      <div className="flex-1 overflow-hidden rounded-full bg-surface-hover" style={{ height }}>
        <div
          className={clsx("h-full rounded-full transition-[width]", toneClasses[tone])}
          style={{ width: `${clamped}%` }}
        />
      </div>
      {showLabel && <span className="w-11 shrink-0 text-right text-[12px] text-fg-muted">{clamped.toFixed(0)}%</span>}
    </div>
  );
}
