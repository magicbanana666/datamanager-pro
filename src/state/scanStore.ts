/**
 * Real, backend-backed state for one Phase 3 recursive scan at a time.
 * Disk Analysis and Folder Analysis both use this store directly (like
 * `filesystemStore`, it's a single active session, not a
 * multi-instance cache) - only one scan runs from the UI at once, even
 * though the backend itself could technically track several.
 *
 * Every async step is self-contained here, the same style as
 * `filesystemStore`: components just call `start`/`cancel` and read
 * state back, never touching `api/scan.ts` or Tauri events directly.
 */
import { create } from "zustand";
import { cancelScan, generateScanId, startScan, subscribeScanEvents } from "@/api/scan";
import { toAppError } from "@/api/backend";
import type { AppError, ScanOptions, ScanProgress, ScanResult } from "@/models/backend";

export type ScanStatus = "idle" | "scanning" | "completed" | "cancelled" | "error";

interface ScanState {
  status: ScanStatus;
  scanId: string | null;
  progress: ScanProgress | null;
  result: ScanResult | null;
  error: AppError | null;

  start: (path: string, options: ScanOptions) => Promise<void>;
  cancel: () => Promise<void>;
  reset: () => void;
}

export const useScanStore = create<ScanState>((set, get) => {
  // Not part of the reactive state on purpose - components never need
  // to read it, and it must survive a `set()` re-render untouched.
  let unlisten: (() => void) | null = null;

  return {
    status: "idle",
    scanId: null,
    progress: null,
    result: null,
    error: null,

    start: async (path, options) => {
      unlisten?.();
      unlisten = null;

      const scanId = generateScanId();
      set({
        status: "scanning",
        scanId,
        progress: null,
        result: null,
        error: null,
      });

      // Subscribed *before* the backend is told to start - see
      // api/scan.ts's doc comment on why order matters here.
      unlisten = await subscribeScanEvents(scanId, {
        onProgress: (progress) => {
          if (get().scanId === scanId) set({ progress });
        },
        onComplete: (result) => {
          if (get().scanId === scanId) set({ status: "completed", result });
        },
        onCancelled: () => {
          if (get().scanId === scanId) set({ status: "cancelled" });
        },
        onError: (error) => {
          if (get().scanId === scanId) set({ status: "error", error });
        },
      });

      try {
        await startScan(scanId, path, options);
      } catch (err) {
        if (get().scanId === scanId) {
          set({ status: "error", error: toAppError(err) });
        }
      }
    },

    cancel: async () => {
      const { scanId, status } = get();
      if (!scanId || status !== "scanning") return;
      try {
        await cancelScan(scanId);
      } catch {
        // The scan may have already finished server-side between the
        // Cancel click and this call landing - the eventual
        // scan-complete/scan-cancelled event is the source of truth,
        // not this promise.
      }
    },

    reset: () => {
      unlisten?.();
      unlisten = null;
      set({ status: "idle", scanId: null, progress: null, result: null, error: null });
    },
  };
});
