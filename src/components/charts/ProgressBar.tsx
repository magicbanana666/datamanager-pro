import clsx from "clsx";
import type { StatusTone } from "@/utils/colors";

interface ProgressBarProps {
  /** Ignored when `indeterminate` is set. */
  value?: number;
  tone?: StatusTone;
  showLabel?: boolean;
  height?: number;
  className?: string;
  /** Renders a full-width, pulsing bar instead of one driven by
   * `value` - for a real, in-progress operation with no cheap way to
   * know a total ahead of time (e.g. a Phase 3 recursive scan, whose
   * item count isn't known until it finishes). `value` is ignored. */
  indeterminate?: boolean;
}

const toneClasses: Record<StatusTone, string> = {
  accent: "bg-accent",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
  neutral: "bg-fg-subtle",
};

export function ProgressBar({
  value = 0,
  tone = "accent",
  showLabel,
  height = 8,
  className,
  indeterminate,
}: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, value));
  return (
    <div className={clsx("flex items-center gap-2", className)}>
      <div className="flex-1 overflow-hidden rounded-full bg-surface-hover" style={{ height }}>
        <div
          className={clsx(
            "h-full rounded-full",
            toneClasses[tone],
            indeterminate ? "w-full animate-pulse" : "transition-[width]",
          )}
          style={indeterminate ? undefined : { width: `${clamped}%` }}
        />
      </div>
      {showLabel && !indeterminate && (
        <span className="w-11 shrink-0 text-right text-[12px] text-fg-muted">{clamped.toFixed(0)}%</span>
      )}
    </div>
  );
}
