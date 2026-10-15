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

/** Toast helpers usable outside React components. */
export const toast = {
  info: (message: string, title?: string) => useToastStore.getState().push({ message, title, tone: "info" }),
  success: (message: string, title?: string) => useToastStore.getState().push({ message, title, tone: "success" }),
  warning: (message: string, title?: string) => useToastStore.getState().push({ message, title, tone: "warning" }),
  danger: (message: string, title?: string) => useToastStore.getState().push({ message, title, tone: "danger" }),
  /** Notice for actions that aren't available yet. */
  demo: (message = "Demo only: this action isn't available yet.") =>
    useToastStore.getState().push({ message, tone: "warning", title: "Demo Mode" }),
  /** The Duplicate Finder / destructive-action specific wording from the spec. */
  demoNoFilesModified: () =>
    useToastStore.getState().push({ message: "Demo mode - no files were modified.", tone: "warning", title: "Demo Mode" }),
};
