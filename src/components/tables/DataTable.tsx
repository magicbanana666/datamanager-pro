import { useMemo, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { ArrowDown, ArrowUp } from "lucide-react";

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
  rowClassName?: (row: T) => string;
  emptyMessage?: string;
  className?: string;
  defaultSortKey?: string;
  defaultSortDir?: "asc" | "desc";
}

const DEFAULT_WIDTH = 140;

export function DataTable<T>({
  columns,
  rows,
  getRowId,
  selectedId,
  onRowClick,
  onRowDoubleClick,
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

  return (
    <div className={clsx("h-full overflow-auto rounded-md border border-border", className)}>
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
          sortedRows.map((row) => {
            const id = getRowId(row);
            const isSelected = id === selectedId;
            return (
              <div
                key={id}
                onClick={() => onRowClick?.(row)}
                onDoubleClick={() => onRowDoubleClick?.(row)}
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
          })
        )}
      </div>
    </div>
  );
}
