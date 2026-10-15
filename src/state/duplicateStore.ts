/** The duplicate finder's single global run - see `createJobStore`. */
import { cancelDuplicateScan, generateDuplicateScanId, startDuplicateScan } from "@/api/duplicates";
import type { DuplicateOptions, DuplicateResult } from "@/models/duplicates";
import { createJobStore } from "@/state/createJobStore";
import { formatBytes, formatNumber } from "@/utils/format";

export const useDuplicateStore = createJobStore<DuplicateResult, [roots: string[], options: DuplicateOptions]>({
  eventPrefix: "duplicate",
  generateId: generateDuplicateScanId,
  startJob: startDuplicateScan,
  cancelJob: cancelDuplicateScan,
  describeResult: (result) => [
    result.totalGroups === 0
      ? `No duplicates among ${formatNumber(result.filesCompared)} files.`
      : `${formatNumber(result.totalGroups)} duplicate groups - ${formatBytes(result.totalWastedBytes)} recoverable.`,
    "Duplicate scan complete",
  ],
  cancelledMessage: "Duplicate scan cancelled.",
});
