/**
 * Phase 10 auto-update via `tauri-plugin-updater`: checks the GitHub
 * Releases feed (`latest.json`, signed with the project's minisign key),
 * downloads and installs the update, then restarts the app.
 */
import { create } from "zustand";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { toast } from "@/state/toastStore";

export type UpdateStatus = "idle" | "checking" | "none" | "available" | "downloading" | "error";

interface UpdateState {
  status: UpdateStatus;
  update: Update | null;
  downloaded: number;
  total: number | null;
  error: string | null;
  dialogOpen: boolean;
  /** `manual` reports "up to date" and errors; a launch check stays quiet. */
  checkForUpdate: (manual: boolean) => Promise<void>;
  install: () => Promise<void>;
  closeDialog: () => void;
}

export const useUpdateStore = create<UpdateState>((set, get) => ({
  status: "idle",
  update: null,
  downloaded: 0,
  total: null,
  error: null,
  dialogOpen: false,

  checkForUpdate: async (manual) => {
    if (get().status === "checking" || get().status === "downloading") return;
    set({ status: "checking", error: null });
    try {
      const update = await check();
      if (update) {
        set({ status: "available", update, dialogOpen: true });
      } else {
        set({ status: "none" });
        if (manual) toast.success("You're on the latest version.");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ status: "error", error: message });
      if (manual) toast.danger(`Couldn't check for updates: ${message}`);
    }
  },

  install: async () => {
    const { update } = get();
    if (!update) return;
    set({ status: "downloading", downloaded: 0, total: null });
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") set({ total: event.data.contentLength ?? null });
        else if (event.event === "Progress") set((s) => ({ downloaded: s.downloaded + event.data.chunkLength }));
      });
      await relaunch();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ status: "error", error: message });
      toast.danger(`Installing the update failed: ${message}`);
    }
  },

  closeDialog: () => set({ dialogOpen: false }),
}));
