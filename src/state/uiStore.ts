import { create } from "zustand";

export interface PlaceholderDialogState {
  open: boolean;
  title: string;
  message: string;
}

interface UiState {
  settingsOpen: boolean;
  helpOpen: boolean;
  openSettings: () => void;
  closeSettings: () => void;
  openHelp: () => void;
  closeHelp: () => void;

  placeholderDialog: PlaceholderDialogState;
  showPlaceholderDialog: (title: string, message: string) => void;
  closePlaceholderDialog: () => void;

  /** Persistent status bar text (left side), configurable from app state
   * rather than hardcoded in the component. */
  statusText: string;
  setStatusText: (text: string) => void;
  memoryMb: number;
  setMemoryMb: (mb: number) => void;
  appVersion: string;
}

export const useUiStore = create<UiState>((set) => ({
  settingsOpen: false,
  helpOpen: false,
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  openHelp: () => set({ helpOpen: true }),
  closeHelp: () => set({ helpOpen: false }),

  placeholderDialog: { open: false, title: "", message: "" },
  showPlaceholderDialog: (title, message) =>
    set({ placeholderDialog: { open: true, title, message } }),
  closePlaceholderDialog: () =>
    set((s) => ({ placeholderDialog: { ...s.placeholderDialog, open: false } })),

  statusText: "Ready",
  setStatusText: (statusText) => set({ statusText }),
  memoryMb: 0,
  setMemoryMb: (memoryMb) => set({ memoryMb }),
  appVersion: "0.1.0",
}));
