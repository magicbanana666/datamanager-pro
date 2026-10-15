/** The app's own right-click menu (`components/menu/ContextMenu`). */
import type { MouseEvent as ReactMouseEvent } from "react";
import type { LucideIcon } from "lucide-react";
import { create } from "zustand";

export type ContextMenuItem =
  | { kind?: "item"; label: string; icon?: LucideIcon; onSelect: () => void; danger?: boolean; disabled?: boolean }
  | { kind: "separator" }
  | { kind: "header"; label: string };

interface ContextMenuState {
  menu: { x: number; y: number; items: ContextMenuItem[] } | null;
  /** Opens the menu at the mouse position (and suppresses the webview's). */
  show: (event: ReactMouseEvent | MouseEvent, items: ContextMenuItem[]) => void;
  close: () => void;
}

export const useContextMenuStore = create<ContextMenuState>((set) => ({
  menu: null,
  show: (event, items) => {
    event.preventDefault();
    event.stopPropagation();
    if (items.length) set({ menu: { x: event.clientX, y: event.clientY, items } });
  },
  close: () => set({ menu: null }),
}));
