import { create } from "zustand";

interface UiState {
  settingsOpen: boolean;
  helpOpen: boolean;
  openSettings: () => void;
  closeSettings: () => void;
  openHelp: () => void;
  closeHelp: () => void;

  /** The toolbar's New Scan dialog. */
  newScanOpen: boolean;
  openNewScan: () => void;
  closeNewScan: () => void;

  /** Bumped when a project is opened, so every page remounts and reads
   * the restored locations. */
  pageEpoch: number;
  remountPages: () => void;

  /** Persistent status bar text (left side), configurable from app state
   * rather than hardcoded in the component. */
  statusText: string;
  setStatusText: (text: string) => void;
  memoryMb: number;
  setMemoryMb: (mb: number) => void;
  /** From the backend (`get_app_version`), set at launch. */
  appVersion: string;
  setAppVersion: (version: string) => void;
}

export const useUiStore = create<UiState>((set) => ({
  settingsOpen: false,
  helpOpen: false,
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  openHelp: () => set({ helpOpen: true }),
  closeHelp: () => set({ helpOpen: false }),

  newScanOpen: false,
  openNewScan: () => set({ newScanOpen: true }),
  closeNewScan: () => set({ newScanOpen: false }),

  pageEpoch: 0,
  remountPages: () => set((s) => ({ pageEpoch: s.pageEpoch + 1 })),

  statusText: "Ready",
  setStatusText: (statusText) => set({ statusText }),
  memoryMb: 0,
  setMemoryMb: (memoryMb) => set({ memoryMb }),
  appVersion: "",
  setAppVersion: (appVersion) => set({ appVersion }),
}));
