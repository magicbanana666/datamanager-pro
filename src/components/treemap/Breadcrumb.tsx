import { ChevronRight, Folder } from "lucide-react";
import clsx from "clsx";

export interface BreadcrumbSegment {
  id: string;
  label: string;
}

interface BreadcrumbProps {
  segments: BreadcrumbSegment[];
  onNavigate: (index: number) => void;
}

export function Breadcrumb({ segments, onNavigate }: BreadcrumbProps) {
  return (
    <div className="flex min-w-0 items-center gap-1 overflow-x-auto text-[12px]">
      <Folder size={13} className="shrink-0 text-fg-subtle" />
      {segments.map((seg, i) => {
        const isLast = i === segments.length - 1;
        return (
          <span key={seg.id} className="flex shrink-0 items-center gap-1">
            <button
              onClick={() => onNavigate(i)}
              disabled={isLast}
              className={clsx(
                "rounded px-1 py-0.5 transition-colors cursor-pointer",
                isLast ? "text-fg font-medium cursor-default" : "text-fg-muted hover:text-accent hover:bg-surface-hover",
              )}
            >
              {seg.label}
            </button>
            {!isLast && <ChevronRight size={12} className="text-fg-subtle" />}
          </span>
        );
      })}
    </div>
  );
}
