import { useMemo } from "react";
import { Folder } from "lucide-react";
import clsx from "clsx";
import type { FsNode } from "@/models/common";
import { useElementSize } from "@/hooks/useElementSize";
import { squarify } from "@/components/treemap/treemapLayout";
import { chartColor } from "@/utils/colors";
import { formatBytes } from "@/utils/format";

interface TreemapProps {
  /** The node whose direct children are laid out as tiles. */
  node: FsNode;
  selectedId?: string | null;
  onSelect?: (node: FsNode) => void;
  onDrillDown?: (node: FsNode) => void;
  className?: string;
}

const GAP = 2;

export function Treemap({ node, selectedId, onSelect, onDrillDown, className }: TreemapProps) {
  const { ref, size } = useElementSize<HTMLDivElement>();

  const rects = useMemo(() => {
    const children = node.children ?? [];
    if (children.length === 0 || size.width === 0 || size.height === 0) return [];
    const items = children.map((c) => ({ value: Math.max(c.size, 1), node: c }));
    return squarify(items, 0, 0, size.width, size.height);
  }, [node, size.width, size.height]);

  return (
    <div ref={ref} className={clsx("relative h-full w-full min-h-0", className)}>
      {rects.length === 0 && (
        <div className="flex h-full items-center justify-center text-xs text-fg-subtle">No data to display</div>
      )}
      {rects.map((r, i) => {
        const isSelected = r.node.id === selectedId;
        const color = chartColor(i);
        const canShowLabel = r.w > 56 && r.h > 30;
        const canShowSize = r.w > 56 && r.h > 46;
        return (
          <button
            key={r.node.id}
            onClick={() => onSelect?.(r.node)}
            onDoubleClick={() => r.node.children && r.node.children.length > 0 && onDrillDown?.(r.node)}
            title={`${r.node.name} — ${formatBytes(r.node.size)}`}
            style={{
              position: "absolute",
              left: r.x + GAP / 2,
              top: r.y + GAP / 2,
              width: Math.max(0, r.w - GAP),
              height: Math.max(0, r.h - GAP),
              backgroundColor: color,
            }}
            className={clsx(
              "flex flex-col items-start justify-start overflow-hidden rounded-[3px] p-1.5 text-left transition-[filter] cursor-pointer",
              "hover:brightness-110",
              isSelected ? "ring-2 ring-white ring-inset" : "ring-1 ring-black/20 ring-inset",
            )}
          >
            {canShowLabel && (
              <span className="flex items-center gap-1 text-[11px] font-semibold text-white drop-shadow-sm">
                <Folder size={11} className="shrink-0 opacity-90" />
                <span className="truncate">{r.node.name}</span>
              </span>
            )}
            {canShowSize && (
              <span className="text-[10px] text-white/85 drop-shadow-sm">{formatBytes(r.node.size)}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
