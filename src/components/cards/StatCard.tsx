import type { LucideIcon } from "lucide-react";
import clsx from "clsx";
import type { StatusTone } from "@/utils/colors";

interface StatCardProps {
  icon: LucideIcon;
  label: string;
  value: string;
  sublabel?: string;
  tone?: StatusTone;
  className?: string;
}

const toneClasses: Record<StatusTone, string> = {
  accent: "bg-accent-soft text-accent",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-accent-soft text-info",
  neutral: "bg-surface-hover text-fg-muted",
};

export function StatCard({ icon: Icon, label, value, sublabel, tone = "accent", className }: StatCardProps) {
  return (
    <div className={clsx("flex items-center gap-3 rounded-lg border border-border bg-surface p-3.5", className)}>
      <div className={clsx("flex h-10 w-10 shrink-0 items-center justify-center rounded-md", toneClasses[tone])}>
        <Icon size={19} strokeWidth={2} />
      </div>
      <div className="min-w-0">
        <div className="truncate text-[11px] font-medium text-fg-muted">{label}</div>
        <div className="truncate text-lg font-semibold text-fg leading-tight">{value}</div>
        {sublabel && <div className="truncate text-[11px] text-fg-subtle">{sublabel}</div>}
      </div>
    </div>
  );
}
