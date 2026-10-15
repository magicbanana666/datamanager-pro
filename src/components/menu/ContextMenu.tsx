import { useEffect, useLayoutEffect, useRef, useState } from "react";
import clsx from "clsx";
import { useContextMenuStore } from "@/state/contextMenuStore";

/** Renders the open context menu, kept inside the window; closes on any
 * click outside, Escape, scrolling or resizing. */
export function ContextMenu() {
  const { menu, close } = useContextMenuStore();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!menu || !ref.current) {
      setPos(null);
      return;
    }
    const { width, height } = ref.current.getBoundingClientRect();
    setPos({
      left: Math.max(4, Math.min(menu.x, window.innerWidth - width - 4)),
      top: Math.max(4, Math.min(menu.y, window.innerHeight - height - 4)),
    });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    window.addEventListener("wheel", close, { passive: true });
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      window.removeEventListener("wheel", close);
      window.removeEventListener("blur", close);
    };
  }, [menu, close]);

  if (!menu) return null;
  return (
    <div
      ref={ref}
      role="menu"
      onContextMenu={(e) => e.preventDefault()}
      style={{ left: pos?.left ?? menu.x, top: pos?.top ?? menu.y, visibility: pos ? "visible" : "hidden" }}
      className="fixed z-[60] min-w-[220px] rounded-md border border-border-strong bg-surface py-1 text-[12.5px] shadow-2xl"
    >
      {menu.items.map((item, i) => {
        if (item.kind === "separator") return <div key={i} className="my-1 h-px bg-border" />;
        if (item.kind === "header")
          return (
            <div key={i} className="truncate px-3 pb-1 pt-1.5 text-[11px] font-semibold text-fg-subtle" title={item.label}>
              {item.label}
            </div>
          );
        const Icon = item.icon;
        return (
          <button
            key={i}
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              close();
              item.onSelect();
            }}
            className={clsx(
              "flex w-full cursor-pointer items-center gap-2.5 px-3 py-1.5 text-left disabled:cursor-default disabled:opacity-40",
              item.danger ? "text-danger hover:bg-danger-soft" : "text-fg hover:bg-surface-hover",
            )}
          >
            <span className="flex w-4 shrink-0 justify-center">{Icon && <Icon size={14} />}</span>
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
