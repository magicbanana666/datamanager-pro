/**
 * Factory for the Phase 5 job stores (duplicate finder, folder
 * comparison, file search): one backend job at a time, global rather
 * than page state so a running job - and its result - survive
 * navigating away and back. Terminal states are toasted from here, not
 * a page hook, so a job that finishes while the user is on another page
 * still says so.
 */
import { create } from "zustand";
import { subscribeJobEvents } from "@/api/jobs";
import { toAppError } from "@/api/backend";
import type { AppError } from "@/models/backend";
import type { HashJobProgress } from "@/models/duplicates";
import { toast } from "@/state/toastStore";

export type JobStatus = "idle" | "running" | "completed" | "cancelled" | "error";

export interface JobState<TResult, TArgs extends unknown[]> {
  status: JobStatus;
  scanId: string | null;
  progress: HashJobProgress | null;
  result: TResult | null;
  error: AppError | null;

  start: (...args: TArgs) => Promise<void>;
  cancel: () => Promise<void>;
}

interface JobConfig<TResult, TArgs extends unknown[]> {
  eventPrefix: "duplicate" | "comparison" | "search";
  generateId: () => string;
  startJob: (id: string, ...args: TArgs) => Promise<void>;
  cancelJob: (id: string) => Promise<void>;
  /** The success toast: `[message, title]`. */
  describeResult: (result: TResult) => [string, string];
  cancelledMessage: string;
}

export function createJobStore<TResult extends { scanId: string }, TArgs extends unknown[]>(
  config: JobConfig<TResult, TArgs>,
) {
  return create<JobState<TResult, TArgs>>((set, get) => {
    // Not reactive state: components never read it, and it must survive
    // a `set()` untouched.
    let unlisten: (() => void) | null = null;

    return {
      status: "idle",
      scanId: null,
      progress: null,
      result: null,
      error: null,

      start: async (...args) => {
        unlisten?.();
        unlisten = null;

        const scanId = config.generateId();
        set({ status: "running", scanId, progress: null, result: null, error: null });

        // Subscribed before the job starts - see api/scan.ts on why.
        unlisten = await subscribeJobEvents<TResult>(config.eventPrefix, scanId, {
          onProgress: (progress) => {
            if (get().scanId === scanId) set({ progress });
          },
          onComplete: (result) => {
            if (get().scanId !== scanId) return;
            set({ status: "completed", result });
            toast.success(...config.describeResult(result));
          },
          onCancelled: () => {
            if (get().scanId !== scanId) return;
            set({ status: "cancelled" });
            toast.info(config.cancelledMessage);
          },
          onError: (error) => {
            if (get().scanId !== scanId) return;
            set({ status: "error", error });
            toast.danger(error.message);
          },
        });

        try {
          await config.startJob(scanId, ...args);
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
          await config.cancelJob(scanId);
        } catch {
          // Already finished - the terminal event is the source of truth.
        }
      },
    };
  });
}
