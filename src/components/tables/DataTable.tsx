import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useElementSize } from "@/hooks/useElementSize";
import { useSettingsStore } from "@/state/settingsStore";

export interface DataTableColumn<T> {
  key: string;
  header: string;
  width?: number;
  minWidth?: number;
  align?: "left" | "right" | "center";
  sortAccessor?: (row: T) => string | number;
  render: (row: T) => ReactNode;
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  selectedId?: string | null;
  onRowClick?: (row: T) => void;
  onRowDoubleClick?: (row: T) => void;
  /** Right-click on a row (the app's own menu; see useFsContextMenu). */
  onRowContextMenu?: (row: T, event: React.MouseEvent) => void;
  rowClassName?: (row: T) => string;
  emptyMessage?: string;
  className?: string;
  defaultSortKey?: string;
  defaultSortDir?: "asc" | "desc";
}

const DEFAULT_WIDTH = 140;
/** Rows rendered beyond each edge of the visible area, so fast
 * scrolling doesn't flash blank space before React catches up. */
const OVERSCAN = 10;
/** Used until `--row-h` is read from CSS (comfortable density's value). */
const FALLBACK_ROW_HEIGHT = 34;

export function DataTable<T>({
  columns,
  rows,
  getRowId,
  selectedId,
  onRowClick,
  onRowDoubleClick,
  onRowContextMenu,
  rowClassName,
  emptyMessage = "No results.",
  className,
  defaultSortKey,
  defaultSortDir = "asc",
}: DataTableProps<T>) {
  const [colWidths, setColWidths] = useState<Record<string, number>>(() =>
    Object.fromEntries(columns.map((c) => [c.key, c.width ?? DEFAULT_WIDTH])),
  );
  const [sort, setSort] = useState<{ key: string | null; dir: "asc" | "desc" }>({
    key: defaultSortKey ?? null,
    dir: defaultSortDir,
  });
  const dragState = useRef<{ key: string; startX: number; startWidth: number } | null>(null);

  const startResize = (key: string, startWidth: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    dragState.current = { key, startX: e.clientX, startWidth };
    const onMove = (ev: PointerEvent) => {
      if (!dragState.current) return;
      const delta = ev.clientX - dragState.current.startX;
      const col = columns.find((c) => c.key === dragState.current!.key);
      const min = col?.minWidth ?? 48;
      setColWidths((w) => ({
        ...w,
        [dragState.current!.key]: Math.max(min, dragState.current!.startWidth + delta),
      }));
    };
    const onUp = () => {
      dragState.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const sortedRows = useMemo(() => {
    if (!sort.key) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortAccessor) return rows;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = col.sortAccessor!(a);
      const bv = col.sortAccessor!(b);
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [rows, sort, columns]);

  const totalWidth = columns.reduce((s, c) => s + (colWidths[c.key] ?? DEFAULT_WIDTH), 0);

  // Only the rows actually in view (plus `OVERSCAN` either side) are
  // rendered, with spacer divs standing in for the rest - a real scan
  // folder can have hundreds of children, and expanding a few of them
  // in the Files & Folders tree otherwise mounts thousands of row
  // elements at once. Every row is exactly `--row-h` tall, so the
  // window is plain arithmetic, no per-row measuring.
  const { ref: scrollRef, size } = useElementSize<HTMLDivElement>();
  const [scrollTop, setScrollTop] = useState(0);
  const [rowHeight, setRowHeight] = useState(FALLBACK_ROW_HEIGHT);
  const density = useSettingsStore((s) => s.settings.appearance.density);
  useEffect(() => {
    // `AppShell` applies `data-density` in its own effect, which runs
    // after this (child) one - read `--row-h` on the next frame so it's
    // the new value.
    const frame = requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (!el) return;
      const value = parseFloat(getComputedStyle(el).getPropertyValue("--row-h"));
      if (value > 0) setRowHeight(value);
    });
    return () => cancelAnimationFrame(frame);
  }, [density, scrollRef]);

  const windowStart = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN);
  const windowEnd = Math.min(
    sortedRows.length,
    // Before the first measurement `size.height` is 0 - fall back to a
    // generous window rather than rendering nothing.
    windowStart + Math.ceil((size.height || 1200) / rowHeight) + 2 * OVERSCAN,
  );

  return (
    <div
      ref={scrollRef}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      className={clsx("h-full overflow-auto rounded-md border border-border", className)}
    >
      <div style={{ minWidth: totalWidth }}>
        <div className="sticky top-0 z-10 flex border-b border-border bg-surface-alt">
          {columns.map((col) => {
            const width = colWidths[col.key] ?? DEFAULT_WIDTH;
            const isSorted = sort.key === col.key;
            return (
              <div
                key={col.key}
                style={{ width }}
                className={clsx(
                  "group relative flex shrink-0 items-center gap-1 px-2.5 text-[11.5px] font-semibold text-fg-muted",
                  col.align === "right" && "justify-end",
                  col.align === "center" && "justify-center",
                )}
              >
                <button
                  onClick={() =>
                    col.sortAccessor &&
                    setSort((s) => ({
                      key: col.key,
                      dir: s.key === col.key && s.dir === "asc" ? "desc" : "asc",
                    }))
                  }
                  disabled={!col.sortAccessor}
                  className={clsx(
                    "flex items-center gap-1 truncate py-2",
                    col.sortAccessor && "cursor-pointer hover:text-fg",
                  )}
                >
                  <span className="truncate">{col.header}</span>
                  {isSorted && (sort.dir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
                </button>
                <span
                  onPointerDown={startResize(col.key, width)}
                  className="absolute right-0 top-0 h-full w-2 cursor-col-resize select-none opacity-0 group-hover:opacity-100"
                >
                  <span className="absolute right-0 top-1/2 h-3.5 w-[2px] -translate-y-1/2 bg-border-strong" />
                </span>
              </div>
            );
          })}
        </div>
        {sortedRows.length === 0 ? (
          <div className="flex h-24 items-center justify-center text-xs text-fg-subtle">{emptyMessage}</div>
        ) : (
          <div style={{ height: windowStart * rowHeight }} />
        )}
        {sortedRows.length > 0 &&
          sortedRows.slice(windowStart, windowEnd).map((row) => {
            const id = getRowId(row);
            const isSelected = id === selectedId;
            return (
              <div
                key={id}
                onClick={() => onRowClick?.(row)}
                onDoubleClick={() => onRowDoubleClick?.(row)}
                onContextMenu={onRowContextMenu ? (e) => onRowContextMenu(row, e) : undefined}
                style={{ height: "var(--row-h)" }}
                className={clsx(
                  "flex border-b border-border/60 text-[12.5px] transition-colors",
                  onRowClick && "cursor-pointer",
                  isSelected ? "bg-surface-selected text-fg" : "text-fg hover:bg-surface-hover",
                  rowClassName?.(row),
                )}
              >
                {columns.map((col) => (
                  <div
                    key={col.key}
                    style={{ width: colWidths[col.key] ?? DEFAULT_WIDTH }}
                    className={clsx(
                      "flex shrink-0 items-center gap-1.5 truncate px-2.5",
                      col.align === "right" && "justify-end",
                      col.align === "center" && "justify-center",
                    )}
                  >
                    {col.render(row)}
                  </div>
                ))}
              </div>
            );
          })}
        {windowEnd < sortedRows.length && <div style={{ height: (sortedRows.length - windowEnd) * rowHeight }} />}
      </div>
    </div>
  );
}
