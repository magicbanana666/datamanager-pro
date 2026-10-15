/** The folder comparison's single global run - see `createJobStore`. */
import { cancelComparison, generateComparisonId, startComparison } from "@/api/comparison";
import type { ComparisonRequestOptions, ComparisonResult } from "@/models/comparison";
import { createJobStore } from "@/state/createJobStore";
import { formatNumber } from "@/utils/format";

export const useComparisonStore = createJobStore<
  ComparisonResult,
  [locationA: string, locationB: string, options: ComparisonRequestOptions]
>({
  eventPrefix: "comparison",
  generateId: generateComparisonId,
  startJob: startComparison,
  cancelJob: cancelComparison,
  describeResult: ({ totals: t }) => [
    `${formatNumber(t.differentFiles)} different, ${formatNumber(t.leftOnly)} only in A, ${formatNumber(t.rightOnly)} only in B.`,
    "Comparison complete",
  ],
  cancelledMessage: "Comparison cancelled.",
});
