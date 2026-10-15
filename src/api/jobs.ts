/**
 * Subscribes to one job's `<prefix>-progress`, `-complete`, `-cancelled`
 * and `-error` events (duplicates, comparison, search). Await it before
 * starting the job so no event is missed.
 */
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AppError } from "@/models/backend";
import type { HashJobProgress } from "@/models/duplicates";

export interface JobEventHandlers<TResult> {
  onProgress?: (progress: HashJobProgress) => void;
  onComplete?: (result: TResult) => void;
  onCancelled?: () => void;
  onError?: (error: AppError) => void;
}

export async function subscribeJobEvents<TResult extends { scanId: string }>(
  prefix: "duplicate" | "comparison" | "search",
  scanId: string,
  handlers: JobEventHandlers<TResult>,
): Promise<() => void> {
  const unlistenFns: UnlistenFn[] = await Promise.all([
    listen<HashJobProgress>(`${prefix}-progress`, (event) => {
      if (event.payload.scanId === scanId) handlers.onProgress?.(event.payload);
    }),
    listen<TResult>(`${prefix}-complete`, (event) => {
      if (event.payload.scanId === scanId) handlers.onComplete?.(event.payload);
    }),
    listen<{ scanId: string }>(`${prefix}-cancelled`, (event) => {
      if (event.payload.scanId === scanId) handlers.onCancelled?.();
    }),
    listen<{ scanId: string; error: AppError }>(`${prefix}-error`, (event) => {
      if (event.payload.scanId === scanId) handlers.onError?.(event.payload.error);
    }),
  ]);
  return () => {
    for (const unlisten of unlistenFns) unlisten();
  };
}
