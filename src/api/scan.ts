/**
 * Typed wrappers around the Phase 3 scan commands, plus a helper that
 * subscribes to one running scan's events and filters them down to
 * just that scan id (the backend broadcasts globally, since this app
 * only ever has one window).
 *
 * The scan id is generated *here*, not by the backend - see the doc
 * comment on `start_scan` in `src-tauri/src/commands/scan.rs` for why:
 * it lets `useScanStore` subscribe before the scan can possibly start
 * emitting, closing a race a backend-generated id can't.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AppError, ScanOptions, ScanProgress, ScanResult } from "@/models/backend";

export function generateScanId(): string {
  return `scan-${crypto.randomUUID()}`;
}

export function startScan(scanId: string, path: string, options: ScanOptions): Promise<void> {
  return invoke("start_scan", { scanId, path, options });
}

export function cancelScan(scanId: string): Promise<void> {
  return invoke("cancel_scan", { scanId });
}

interface ScanCancelledPayload {
  scanId: string;
}

interface ScanErrorPayload {
  scanId: string;
  error: AppError;
}

export interface ScanEventHandlers {
  onProgress?: (progress: ScanProgress) => void;
  onComplete?: (result: ScanResult) => void;
  onCancelled?: () => void;
  onError?: (error: AppError) => void;
}

/** Subscribes to every scan event, filtering to just `scanId`. Await
 * this - and its returned unlisten function - *before* calling
 * `startScan` with the same id, so no event can be missed. Returns one
 * combined unlisten function tearing down all four listeners. */
export async function subscribeScanEvents(
  scanId: string,
  handlers: ScanEventHandlers,
): Promise<() => void> {
  const unlistenFns: UnlistenFn[] = await Promise.all([
    listen<ScanProgress>("scan-progress", (event) => {
      if (event.payload.scanId === scanId) handlers.onProgress?.(event.payload);
    }),
    listen<ScanResult>("scan-complete", (event) => {
      if (event.payload.scanId === scanId) handlers.onComplete?.(event.payload);
    }),
    listen<ScanCancelledPayload>("scan-cancelled", (event) => {
      if (event.payload.scanId === scanId) handlers.onCancelled?.();
    }),
    listen<ScanErrorPayload>("scan-error", (event) => {
      if (event.payload.scanId === scanId) handlers.onError?.(event.payload.error);
    }),
  ]);

  return () => {
    for (const unlisten of unlistenFns) unlisten();
  };
}
