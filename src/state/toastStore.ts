import { create } from "zustand";

export type ToastTone = "info" | "success" | "warning" | "danger";

export interface ToastItem {
  id: string;
  title?: string;
  message: string;
  tone: ToastTone;
}

interface ToastState {
  toasts: ToastItem[];
  push: (t: Omit<ToastItem, "id">) => void;
  dismiss: (id: string) => void;
}

let nextId = 0;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (t) => {
    const id = `toast-${++nextId}`;
    set((s) => ({ toasts: [...s.toasts, { ...t, id }] }));
    window.setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }));
    }, 4500);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));

/** Fire-and-forget helpers usable from anywhere - components, mock hooks,
 * or plain callbacks - without needing to be inside a React render. */
export const toast = {
  info: (message: string, title?: string) => useToastStore.getState().push({ message, title, tone: "info" }),
  success: (message: string, title?: string) => useToastStore.getState().push({ message, title, tone: "success" }),
  warning: (message: string, title?: string) => useToastStore.getState().push({ message, title, tone: "warning" }),
  danger: (message: string, title?: string) => useToastStore.getState().push({ message, title, tone: "danger" }),
  /** The standard Phase 1 "not wired up yet" notice for toolbar/action buttons. */
  demo: (message = "Phase 1 Demo Mode — this action is not connected to the backend yet.") =>
    useToastStore.getState().push({ message, tone: "warning", title: "Demo Mode" }),
  /** The Duplicate Finder / destructive-action specific wording from the spec. */
  demoNoFilesModified: () =>
    useToastStore.getState().push({ message: "Demo mode - no files were modified.", tone: "warning", title: "Demo Mode" }),
};
