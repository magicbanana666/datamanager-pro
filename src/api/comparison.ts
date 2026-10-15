/** Folder comparison commands. Events: `subscribeJobEvents("comparison", ...)`. */
import { invoke } from "@tauri-apps/api/core";
import type { ComparisonRequestOptions } from "@/models/comparison";

export function generateComparisonId(): string {
  return `cmp-${crypto.randomUUID()}`;
}

export function startComparison(
  scanId: string,
  locationA: string,
  locationB: string,
  options: ComparisonRequestOptions,
): Promise<void> {
  return invoke("start_comparison", { scanId, locationA, locationB, options });
}

export function cancelComparison(scanId: string): Promise<void> {
  return invoke("cancel_comparison", { scanId });
}
