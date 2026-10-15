/**
 * Typed wrappers around the Phase 5 duplicate-finder commands - same
 * shape as `api/scan.ts`, including generating the run id here so the
 * caller can subscribe (`subscribeJobEvents("duplicate", ...)`) before
 * the run can emit anything.
 */
import { invoke } from "@tauri-apps/api/core";
import type { DuplicateOptions } from "@/models/duplicates";

export function generateDuplicateScanId(): string {
  return `dup-${crypto.randomUUID()}`;
}

export function startDuplicateScan(scanId: string, roots: string[], options: DuplicateOptions): Promise<void> {
  return invoke("start_duplicate_scan", { scanId, roots, options });
}

export function cancelDuplicateScan(scanId: string): Promise<void> {
  return invoke("cancel_duplicate_scan", { scanId });
}
