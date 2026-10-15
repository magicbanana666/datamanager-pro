/**
 * Duplicate finder commands. The job id is generated here so the caller
 * can subscribe (`subscribeJobEvents("duplicate", ...)`) before starting.
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
