/**
 * Real, backend-backed state for one folder comparison at a time - same
 * single-session shape as `duplicateStore`, global so a running
 * comparison survives navigating away and back.
 */
import { create } from "zustand";
import { cancelComparison, generateComparisonId, startComparison } from "@/api/comparison";
import { subscribeJobEvents } from "@/api/jobs";
import { toAppError } from "@/api/backend";
import type { AppError } from "@/models/backend";
import type { ComparisonRequestOptions, ComparisonResult } from "@/models/comparison";
import type { HashJobProgress } from "@/models/duplicates";
import { toast } from "@/state/toastStore";
import { formatNumber } from "@/utils/format";

export type ComparisonRunStatus = "idle" | "running" | "completed" | "cancelled" | "error";

interface ComparisonState {
  status: ComparisonRunStatus;
  scanId: string | null;
  progress: HashJobProgress | null;
  result: ComparisonResult | null;
  error: AppError | null;

  start: (locationA: string, locationB: string, options: ComparisonRequestOptions) => Promise<void>;
  cancel: () => Promise<void>;
}

export const useComparisonStore = create<ComparisonState>((set, get) => {
  let unlisten: (() => void) | null = null;

  return {
    status: "idle",
    scanId: null,
    progress: null,
    result: null,
    error: null,

    start: async (locationA, locationB, options) => {
      unlisten?.();
      unlisten = null;

      const scanId = generateComparisonId();
      set({ status: "running", scanId, progress: null, result: null, error: null });

      unlisten = await subscribeJobEvents<ComparisonResult>("comparison", scanId, {
        onProgress: (progress) => {
          if (get().scanId === scanId) set({ progress });
        },
        onComplete: (result) => {
          if (get().scanId !== scanId) return;
          set({ status: "completed", result });
          const t = result.totals;
          toast.success(
            `${formatNumber(t.differentFiles)} different, ${formatNumber(t.leftOnly)} only in A, ${formatNumber(t.rightOnly)} only in B.`,
            "Comparison complete",
          );
        },
        onCancelled: () => {
          if (get().scanId !== scanId) return;
          set({ status: "cancelled" });
          toast.info("Comparison cancelled.");
        },
        onError: (error) => {
          if (get().scanId !== scanId) return;
          set({ status: "error", error });
          toast.danger(error.message);
        },
      });

      try {
        await startComparison(scanId, locationA, locationB, options);
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
        await cancelComparison(scanId);
      } catch {
        // Already finished - the terminal event is the source of truth.
      }
    },
  };
});
