/**
 * Real, backend-backed state for one duplicate-finder run at a time -
 * same single-session shape as `scanStore`. Global rather than page
 * state so a run started on the Duplicate Finder keeps going (and its
 * result survives) when the user navigates away and back.
 */
import { create } from "zustand";
import {
  cancelDuplicateScan,
  generateDuplicateScanId,
  startDuplicateScan,
  subscribeDuplicateEvents,
} from "@/api/duplicates";
import { toAppError } from "@/api/backend";
import type { AppError } from "@/models/backend";
import type { DuplicateOptions, DuplicateProgress, DuplicateResult } from "@/models/duplicates";
import { toast } from "@/state/toastStore";
import { formatBytes, formatNumber } from "@/utils/format";

export type DuplicateRunStatus = "idle" | "running" | "completed" | "cancelled" | "error";

interface DuplicateState {
  status: DuplicateRunStatus;
  scanId: string | null;
  progress: DuplicateProgress | null;
  result: DuplicateResult | null;
  error: AppError | null;

  start: (roots: string[], options: DuplicateOptions) => Promise<void>;
  cancel: () => Promise<void>;
}

export const useDuplicateStore = create<DuplicateState>((set, get) => {
  let unlisten: (() => void) | null = null;

  return {
    status: "idle",
    scanId: null,
    progress: null,
    result: null,
    error: null,

    start: async (roots, options) => {
      unlisten?.();
      unlisten = null;

      const scanId = generateDuplicateScanId();
      set({ status: "running", scanId, progress: null, result: null, error: null });

      // Notified from here rather than a page hook: a run can finish
      // while the user is on another page, and should still say so.
      unlisten = await subscribeDuplicateEvents(scanId, {
        onProgress: (progress) => {
          if (get().scanId === scanId) set({ progress });
        },
        onComplete: (result) => {
          if (get().scanId !== scanId) return;
          set({ status: "completed", result });
          toast.success(
            result.totalGroups === 0
              ? `No duplicates among ${formatNumber(result.filesCompared)} files.`
              : `${formatNumber(result.totalGroups)} duplicate groups - ${formatBytes(result.totalWastedBytes)} recoverable.`,
            "Duplicate scan complete",
          );
        },
        onCancelled: () => {
          if (get().scanId !== scanId) return;
          set({ status: "cancelled" });
          toast.info("Duplicate scan cancelled.");
        },
        onError: (error) => {
          if (get().scanId !== scanId) return;
          set({ status: "error", error });
          toast.danger(error.message);
        },
      });

      try {
        await startDuplicateScan(scanId, roots, options);
      } catch (err) {
        if (get().scanId === scanId) {
          const error = toAppError(err);
          set({ status: "error", error });
          toast.danger(error.message);
        }
      }
    },

    cancel: async () => {
      const { scanId, status } = get();
      if (!scanId || status !== "running") return;
      try {
        await cancelDuplicateScan(scanId);
      } catch {
        // Already finished - the terminal event is the source of truth.
      }
    },
  };
});
