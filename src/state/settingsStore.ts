/** App settings, persisted in the webview's local storage (Phase 10).
 * Stored sections are merged over the defaults, so a setting added in a
 * later version starts at its default instead of undefined. */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { DEFAULT_SETTINGS, type AppSettings } from "@/models/settings";

interface SettingsState {
  settings: AppSettings;
  updateSection: <K extends keyof AppSettings>(section: K, patch: Partial<AppSettings[K]>) => void;
  reset: () => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      settings: DEFAULT_SETTINGS,
      updateSection: (section, patch) =>
        set((s) => ({
          settings: { ...s.settings, [section]: { ...s.settings[section], ...patch } },
        })),
      reset: () => set({ settings: DEFAULT_SETTINGS }),
    }),
    {
      name: "dmp-settings",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ settings: s.settings }),
      merge: (persisted, current) => {
        const stored = (persisted as { settings?: Partial<AppSettings> } | undefined)?.settings ?? {};
        const settings = { ...current.settings };
        for (const key of Object.keys(settings) as (keyof AppSettings)[]) {
          settings[key] = { ...settings[key], ...(stored[key] ?? {}) } as never;
        }
        return { ...current, settings };
      },
    },
  ),
);

/** Scan options from Settings > Scanning. */
export function scanOptionsFromSettings(): import("@/models/backend").ScanOptions {
  const s = useSettingsStore.getState().settings.scanning;
  return {
    showHidden: s.includeHiddenFiles,
    showSystem: s.includeHiddenFiles,
    threads: s.defaultThreadCount > 0 ? s.defaultThreadCount : null,
  };
}
