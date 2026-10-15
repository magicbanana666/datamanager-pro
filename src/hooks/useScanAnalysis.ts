import { useEffect, useMemo, useState } from "react";
import { analyzeSubtree } from "@/api/scan";
import { toAppError } from "@/api/backend";
import type { FsNode } from "@/models/common";
import { toast } from "@/state/toastStore";
import { analyzeTree, finalizeAnalysis, type ScanAnalysis } from "@/utils/scanAnalysis";

const EMPTY_ANALYSIS: ScanAnalysis = {
  categoryStats: [],
  extensionStats: [],
  topFiles: [],
  topFolders: [],
  timeline: [],
};

/**
 * Analysis tab data for `node`. With a `scanId` it comes from the
 * backend (`analyze_subtree`, full tree); otherwise it's computed from
 * `node` itself. Empty while loading, so no stale numbers are shown.
 */
export function useScanAnalysis(node: FsNode, scanId: string | null): ScanAnalysis {
  const [fetched, setFetched] = useState<{ key: string; analysis: ScanAnalysis } | null>(null);
  const key = scanId ? `${scanId}|${node.path}` : null;

  useEffect(() => {
    if (!scanId) return;
    let cancelled = false;
    analyzeSubtree(scanId, node.path).then(
      (raw) => {
        if (!cancelled) setFetched({ key: `${scanId}|${node.path}`, analysis: finalizeAnalysis(raw) });
      },
      (err) => {
        if (!cancelled) toast.danger(toAppError(err).message);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [scanId, node.path]);

  const local = useMemo(() => (scanId ? null : analyzeTree(node)), [scanId, node]);
  if (local) return local;
  return fetched?.key === key ? fetched.analysis : EMPTY_ANALYSIS;
}
