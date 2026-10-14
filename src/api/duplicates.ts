/**
 * Typed wrappers around the Phase 5 duplicate-finder commands - same
 * shape as `api/scan.ts`, including generating the run id here so the
 * caller can subscribe before the run can emit anything.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AppError } from "@/models/backend";
import type { DuplicateOptions, DuplicateProgress, DuplicateResult } from "@/models/duplicates";

export function generateDuplicateScanId(): string {
  return `dup-${crypto.randomUUID()}`;
}

export function startDuplicateScan(scanId: string, roots: string[], options: DuplicateOptions): Promise<void> {
  return invoke("start_duplicate_scan", { scanId, roots, options });
}

export function cancelDuplicateScan(scanId: string): Promise<void> {
  return invoke("cancel_duplicate_scan", { scanId });
}

export interface DuplicateEventHandlers {
  onProgress?: (progress: DuplicateProgress) => void;
  onComplete?: (result: DuplicateResult) => void;
  onCancelled?: () => void;
  onError?: (error: AppError) => void;
}

/** Subscribes to every duplicate-run event, filtered to `scanId`. Await
 * this before calling `startDuplicateScan` with the same id. */
export async function subscribeDuplicateEvents(
  scanId: string,
  handlers: DuplicateEventHandlers,
): Promise<() => void> {
  const unlistenFns: UnlistenFn[] = await Promise.all([
    listen<DuplicateProgress>("duplicate-progress", (event) => {
      if (event.payload.scanId === scanId) handlers.onProgress?.(event.payload);
    }),
    listen<DuplicateResult>("duplicate-complete", (event) => {
      if (event.payload.scanId === scanId) handlers.onComplete?.(event.payload);
    }),
    listen<{ scanId: string }>("duplicate-cancelled", (event) => {
      if (event.payload.scanId === scanId) handlers.onCancelled?.();
    }),
    listen<{ scanId: string; error: AppError }>("duplicate-error", (event) => {
      if (event.payload.scanId === scanId) handlers.onError?.(event.payload.error);
    }),
  ]);

  return () => {
    for (const unlisten of unlistenFns) unlisten();
  };
}
