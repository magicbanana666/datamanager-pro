/**
 * Global state for one Phase 6/7 transfer job at a time, per feature:
 * `useTransferStore` (Data Transfer), `useSyncStore` (Sync /
 * Incremental) and `useFileActionStore` (copy/move/delete actions from
 * Duplicate Finder and Compare Locations). Global so a running transfer
 * - and its log and report - survive navigating away; terminal states
 * are toasted (and after-completion actions run) from here.
 */
import { create } from "zustand";
import { toAppError } from "@/api/backend";
import {
  cancelShutdown,
  cancelTransfer,
  executeTransfer,
  generateTransferId,
  openFolder,
  resumeInterruptedTransfer,
  scheduleShutdown,
  setTransferPaused,
  startTransfer,
  subscribeTransferEvents,
} from "@/api/transfer";
import type { AppError } from "@/models/backend";
import type {
  ItemOverride,
  ItemStatus,
  TransferPlan,
  TransferProgress,
  TransferReport,
  TransferRequest,
  TransferSpeedSample,
} from "@/models/transfer";
import { toast } from "@/state/toastStore";
import { formatBytes, formatNumber } from "@/utils/format";

export type TransferStatus = "idle" | "analyzing" | "planned" | "running" | "completed" | "cancelled" | "error";

export interface RowState {
  status: ItemStatus;
  message?: string;
}

export interface LogLine {
  time: string;
  text: string;
}

export interface AfterCompletion {
  showReport: boolean;
  openDestination: boolean;
  shutdown: boolean;
}

const MAX_LOG_LINES = 5_000;
const SPEED_HISTORY_POINTS = 60;

export interface TransferStoreState {
  status: TransferStatus;
  jobId: string | null;
  request: TransferRequest | null;
  plan: TransferPlan | null;
  rowStates: Record<number, RowState>;
  progress: TransferProgress | null;
  speedHistory: TransferSpeedSample[];
  log: LogLine[];
  report: TransferReport | null;
  /** The last job was cancelled with a journal kept. */
  resumable: boolean;
  error: AppError | null;
  afterCompletion: AfterCompletion;
  /** Bumped when the report should be shown (after-completion action). */
  reportRequested: number;

  /** Analyze only: the plan waits for `execute`. */
  analyze: (request: TransferRequest) => Promise<void>;
  /** Analyze and execute in one go. */
  start: (request: TransferRequest) => Promise<void>;
  execute: (overrides: ItemOverride[]) => Promise<void>;
  resumeInterrupted: (jobId: string) => Promise<void>;
  setPaused: (paused: boolean) => Promise<void>;
  cancel: () => Promise<void>;
  setAfterCompletion: (patch: Partial<AfterCompletion>) => void;
  /** Sets the form's request without running it (opening a project). */
  setRequest: (request: TransferRequest) => void;
  appendLog: (text: string) => void;
}

function now(): string {
  return new Date().toLocaleTimeString();
}

function describe(report: TransferReport): string {
  const parts = [`${formatNumber(report.filesCopied)} files copied (${formatBytes(report.bytesCopied)})`];
  if (report.filesDeleted) parts.push(`${formatNumber(report.filesDeleted)} deleted`);
  if (report.errorCount) parts.push(`${formatNumber(report.errorCount)} errors`);
  return parts.join(", ") + ".";
}

function createTransferStore(label: string) {
  return create<TransferStoreState>((set, get) => {
    let unlisten: (() => void) | null = null;
    let lastSecond = -1;

    const appendLog = (lines: string[]) => {
      if (lines.length === 0) return;
      const time = now();
      set((s) => {
        const log = [...s.log, ...lines.map((text) => ({ time, text }))];
        return { log: log.length > MAX_LOG_LINES ? log.slice(-MAX_LOG_LINES) : log };
      });
    };

    const runAfterCompletion = (report: TransferReport) => {
      const { afterCompletion } = get();
      if (afterCompletion.showReport) set((s) => ({ reportRequested: s.reportRequested + 1 }));
      if (afterCompletion.openDestination) {
        openFolder(report.destination).catch((e) => toast.danger(toAppError(e).message));
      }
      if (afterCompletion.shutdown) {
        scheduleShutdown()
          .then(() =>
            toast.warning(
              "Windows will shut down in 60 seconds. Run \"shutdown /a\" or press Cancel shutdown on the Data Transfer page to stop it.",
              "Shutting down",
            ),
          )
          .catch((e) => toast.danger(toAppError(e).message));
      }
    };

    /** Subscribes for a new job id and resets per-job state. */
    const begin = async (jobId: string, status: TransferStatus, request: TransferRequest | null) => {
      unlisten?.();
      unlisten = null;
      lastSecond = -1;
      set({
        status,
        jobId,
        request,
        plan: null,
        rowStates: {},
        progress: null,
        speedHistory: [],
        report: null,
        resumable: false,
        error: null,
      });
      unlisten = await subscribeTransferEvents(jobId, {
        onProgress: (progress) => {
          if (get().jobId !== jobId) return;
          const patch: Partial<TransferStoreState> = { progress };
          if (progress.updates.length) {
            const rowStates = { ...get().rowStates };
            for (const u of progress.updates) rowStates[u.id] = { status: u.status, message: u.message };
            patch.rowStates = rowStates;
          }
          if (progress.phase !== "analyzing" && progress.phase !== "planned") {
            const sec = Math.floor(progress.elapsedMs / 1000);
            if (sec !== lastSecond) {
              lastSecond = sec;
              const sample = { t: sec, mbps: Math.round((progress.speedBps / (1024 * 1024)) * 10) / 10 };
              patch.speedHistory = [...get().speedHistory.slice(-(SPEED_HISTORY_POINTS - 1)), sample];
            }
          }
          set(patch);
          appendLog(progress.log);
        },
        onPlanned: (plan) => {
          if (get().jobId !== jobId) return;
          const s = plan.summary;
          set((state) => ({ plan, status: state.status === "analyzing" ? "planned" : state.status }));
          if (plan.elapsedMs > 0) {
            appendLog([
              `Analysis done in ${(plan.elapsedMs / 1000).toFixed(1)} s: ${formatNumber(s.newFiles)} new, ${formatNumber(s.updatedFiles)} changed, ` +
                `${formatNumber(s.unchangedFiles)} unchanged, ${formatNumber(s.deletions)} to delete, ${formatNumber(s.conflicts)} conflicts.`,
              ...plan.skipped.map((sk) => `Skipped ${sk.path}: ${sk.reason}`),
            ]);
          }
        },
        onComplete: (report) => {
          if (get().jobId !== jobId) return;
          set({ status: "completed", report });
          appendLog([`Completed in ${(report.elapsedMs / 1000).toFixed(1)} s - ${describe(report)}`]);
          if (report.errorCount) toast.warning(describe(report), `${label} finished with errors`);
          else toast.success(describe(report), `${label} complete`);
          runAfterCompletion(report);
        },
        onCancelled: (resumable) => {
          if (get().jobId !== jobId) return;
          set({ status: "cancelled", resumable });
          appendLog([resumable ? "Stopped. The transfer can be resumed later." : "Cancelled."]);
          toast.info(resumable ? `${label} stopped - it can be resumed later.` : `${label} cancelled.`);
        },
        onError: (error) => {
          if (get().jobId !== jobId) return;
          set({ status: "error", error });
          appendLog([`ERROR: ${error.message}`]);
          toast.danger(error.message);
        },
      });
    };

    const fail = (jobId: string, err: unknown) => {
      if (get().jobId !== jobId) return;
      const error = toAppError(err);
      set({ status: "error", error });
      appendLog([`ERROR: ${error.message}`]);
      toast.danger(error.message);
    };

    const startJob = async (request: TransferRequest, execute: boolean) => {
      const jobId = generateTransferId();
      await begin(jobId, execute ? "running" : "analyzing", request);
      appendLog([`${execute ? "Starting" : "Analyzing"} ${request.mode}: ${request.source} -> ${request.destination}`]);
      try {
        await startTransfer(jobId, request, execute);
      } catch (err) {
        fail(jobId, err);
      }
    };

    return {
      status: "idle",
      jobId: null,
      request: null,
      plan: null,
      rowStates: {},
      progress: null,
      speedHistory: [],
      log: [],
      report: null,
      resumable: false,
      error: null,
      afterCompletion: { showReport: true, openDestination: false, shutdown: false },
      reportRequested: 0,

      analyze: (request) => startJob(request, false),
      start: (request) => startJob(request, true),

      execute: async (overrides) => {
        const { jobId, status } = get();
        if (!jobId || status !== "planned") return;
        set({ status: "running" });
        try {
          await executeTransfer(jobId, overrides);
        } catch (err) {
          fail(jobId, err);
        }
      },

      resumeInterrupted: async (jobId) => {
        await begin(jobId, "running", null);
        try {
          await resumeInterruptedTransfer(jobId);
        } catch (err) {
          fail(jobId, err);
        }
      },

      setPaused: async (paused) => {
        const { jobId, status } = get();
        if (!jobId || status !== "running") return;
        await setTransferPaused(jobId, paused).catch(() => {});
      },

      cancel: async () => {
        const { jobId, status } = get();
        if (!jobId || !["analyzing", "planned", "running"].includes(status)) return;
        await cancelTransfer(jobId).catch(() => {});
      },

      setRequest: (request) => {
        if (!["running", "analyzing"].includes(get().status)) set({ request });
      },
      setAfterCompletion: (patch) => set((s) => ({ afterCompletion: { ...s.afterCompletion, ...patch } })),
      appendLog: (text) => appendLog([text]),
    };
  });
}

export const useTransferStore = createTransferStore("Transfer");
export const useSyncStore = createTransferStore("Sync");
export const useFileActionStore = createTransferStore("File operation");

export function cancelScheduledShutdown(): void {
  cancelShutdown()
    .then(() => toast.info("Shutdown cancelled."))
    .catch((e) => toast.danger(toAppError(e).message));
}
