import { useEffect, useRef } from "react";
import { useScanStore } from "@/state/scanStore";
import { useUiStore } from "@/state/uiStore";
import { toast } from "@/state/toastStore";
import { formatBytes, formatNumber } from "@/utils/format";

/**
 * Fires the toast/status-bar side effects for `useScanStore`'s
 * terminal states (completed/cancelled/error), exactly once per scan.
 *
 * Shared between Disk Analysis and Folder Analysis - the scan store is
 * a single global session (like `filesystemStore`), not per-page, so a
 * scan started on one page that finishes after the user navigates to
 * the other still needs to notify from wherever the user currently is;
 * both pages call this same hook rather than duplicating the logic.
 */
export function useScanNotifications() {
  const { status, scanId, result, error } = useScanStore();
  const setStatusText = useUiStore((s) => s.setStatusText);
  const lastHandled = useRef<string | null>(null);

  useEffect(() => {
    if (!scanId) return;
    if (status !== "completed" && status !== "cancelled" && status !== "error") return;

    const key = `${scanId}:${status}`;
    if (lastHandled.current === key) return;
    lastHandled.current = key;

    setStatusText("Ready");
    if (status === "completed" && result) {
      const engineLabel = result.engine === "mft" ? "MFT fast scan" : "directory walk";
      const seconds = (result.elapsedMs / 1000).toFixed(1);
      toast.success(
        `Scan completed - ${formatBytes(result.root.size)} across ${formatNumber(result.root.fileCount)} files in ${seconds}s (via ${engineLabel}).`,
      );
    } else if (status === "cancelled") {
      toast.info("Scan cancelled.");
    } else if (status === "error" && error) {
      toast.danger(error.message);
    }
  }, [status, scanId, result, error, setStatusText]);
}
