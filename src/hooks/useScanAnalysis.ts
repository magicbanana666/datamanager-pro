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
 * Every analytical-tab dataset for `node`, scoped to the current
 * breadcrumb position. With a real scan (`scanId` set) this comes from
 * the backend's `analyze_subtree`, run against the full cached tree -
 * the frontend only holds a depth-truncated copy, so walking it here
 * would silently miss every deeper file. Without one (Phase 1 mock
 * data, which the frontend does hold in full) it's computed locally.
 *
 * Returns an empty analysis while a real one is in flight rather than
 * the previous folder's, so tabs never show stale numbers under a new
 * breadcrumb.
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
