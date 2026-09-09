import { create } from "zustand";
import { DEFAULT_SETTINGS, type AppSettings } from "@/models/settings";

interface SettingsState {
  settings: AppSettings;
  updateSection: <K extends keyof AppSettings>(section: K, patch: Partial<AppSettings[K]>) => void;
  reset: () => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: DEFAULT_SETTINGS,
  updateSection: (section, patch) =>
    set((s) => ({
      settings: { ...s.settings, [section]: { ...s.settings[section], ...patch } },
    })),
  reset: () => set({ settings: DEFAULT_SETTINGS }),
}));
