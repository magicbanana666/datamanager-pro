/**
 * Typed wrappers around the Phase 6/7 transfer commands, plus the
 * event subscription for one job (`transfer-progress`, `-planned`,
 * `-complete`, `-cancelled`, `-error`). Await the subscription before
 * starting the job, so no event can be missed.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AppError } from "@/models/backend";
import type {
  InterruptedTransfer,
  ItemOverride,
  TransferPlan,
  TransferProgress,
  TransferReport,
  TransferRequest,
} from "@/models/transfer";

export function generateTransferId(): string {
  return `xfer-${crypto.randomUUID()}`;
}

/** Analyzes, then (with `execute`) carries the plan out straight away. */
export function startTransfer(jobId: string, request: TransferRequest, execute: boolean): Promise<void> {
  return invoke("start_transfer", { jobId, request, execute });
}

export function executeTransfer(jobId: string, overrides: ItemOverride[]): Promise<void> {
  return invoke("execute_transfer", { jobId, overrides });
}

export function setTransferPaused(jobId: string, paused: boolean): Promise<void> {
  return invoke("set_transfer_paused", { jobId, paused });
}

export function cancelTransfer(jobId: string): Promise<void> {
  return invoke("cancel_transfer", { jobId });
}

export function listInterruptedTransfers(): Promise<InterruptedTransfer[]> {
  return invoke("list_interrupted_transfers");
}

export function resumeInterruptedTransfer(jobId: string): Promise<void> {
  return invoke("resume_interrupted_transfer", { jobId });
}

export function discardInterruptedTransfer(jobId: string): Promise<void> {
  return invoke("discard_interrupted_transfer", { jobId });
}

export function scheduleShutdown(): Promise<void> {
  return invoke("schedule_shutdown");
}

export function cancelShutdown(): Promise<void> {
  return invoke("cancel_shutdown");
}

export function openFolder(path: string): Promise<void> {
  return invoke("open_folder", { path });
}

export interface TransferEventHandlers {
  onProgress: (progress: TransferProgress) => void;
  onPlanned: (plan: TransferPlan) => void;
  onComplete: (report: TransferReport) => void;
  onCancelled: (resumable: boolean) => void;
  onError: (error: AppError) => void;
}

export async function subscribeTransferEvents(jobId: string, handlers: TransferEventHandlers): Promise<() => void> {
  const unlistenFns: UnlistenFn[] = await Promise.all([
    listen<TransferProgress>("transfer-progress", (e) => {
      if (e.payload.jobId === jobId) handlers.onProgress(e.payload);
    }),
    listen<TransferPlan>("transfer-planned", (e) => {
      if (e.payload.jobId === jobId) handlers.onPlanned(e.payload);
    }),
    listen<TransferReport>("transfer-complete", (e) => {
      if (e.payload.jobId === jobId) handlers.onComplete(e.payload);
    }),
    listen<{ jobId: string; resumable: boolean }>("transfer-cancelled", (e) => {
      if (e.payload.jobId === jobId) handlers.onCancelled(e.payload.resumable);
    }),
    listen<{ jobId: string; error: AppError }>("transfer-error", (e) => {
      if (e.payload.jobId === jobId) handlers.onError(e.payload.error);
    }),
  ]);
  return () => {
    for (const unlisten of unlistenFns) unlisten();
  };
}
