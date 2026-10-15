import { useEffect, useState } from "react";
import { Loader2, Users } from "lucide-react";
import { Button } from "@/components/controls/Button";
import { analyzeOwners, type OwnerStat } from "@/api/scan";
import { toAppError } from "@/api/backend";
import type { FsNode } from "@/models/common";
import { formatBytes, formatNumber, formatPercent } from "@/utils/format";

/** Size per file owner of the folder in view. Reading every file's
 * owner takes a while on big trees, so it runs on request (and again
 * when the folder in view changes). */
export function OwnersTab({ scanId, node }: { scanId: string | null; node: FsNode }) {
  const key = scanId ? `${scanId}|${node.path}` : null;
  const [requested, setRequested] = useState<string | null>(null);
  const [state, setState] = useState<{ key: string; stats?: OwnerStat[]; error?: string } | null>(null);

  useEffect(() => {
    if (!key || requested !== key || !scanId) return;
    let alive = true;
    analyzeOwners(scanId, node.path).then(
      (stats) => alive && setState({ key, stats }),
      (err) => alive && setState({ key, error: toAppError(err).message }),
    );
    return () => {
      alive = false;
    };
  }, [key, requested, scanId, node.path]);

  if (!scanId) return <p className="p-2 text-xs text-fg-subtle">Scan a drive or folder to see who owns its files.</p>;
  const current = state?.key === key ? state : null;
  if (requested !== key) {
    return (
      <div className="flex flex-col items-start gap-2 p-2">
        <p className="text-xs text-fg-muted">
          Reads the NTFS owner of every file in {node.path} ({formatNumber(node.fileCount)} files) - that can take a while on a whole drive.
        </p>
        <Button icon={Users} onClick={() => setRequested(key)}>Analyze owners</Button>
      </div>
    );
  }
  if (!current) {
    return (
      <div className="flex items-center gap-2 p-2 text-xs text-fg-muted">
        <Loader2 size={14} className="animate-spin" /> Reading file owners...
      </div>
    );
  }
  if (current.error) return <p className="p-2 text-xs text-danger">{current.error}</p>;
  return (
    <div className="overflow-y-auto">
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="border-b border-border text-left text-[11px] font-semibold text-fg-muted">
            <th className="px-3 py-2">Owner</th>
            <th className="px-3 py-2 text-right">Files</th>
            <th className="px-3 py-2 text-right">Size</th>
            <th className="px-3 py-2 text-right">%</th>
          </tr>
        </thead>
        <tbody>
          {current.stats!.map((o) => (
            <tr key={o.owner} className="border-b border-border/60">
              <td className="px-3 py-2">{o.owner}</td>
              <td className="px-3 py-2 text-right text-fg-muted">{formatNumber(o.files)}</td>
              <td className="px-3 py-2 text-right text-fg-muted">{formatBytes(o.size)}</td>
              <td className="px-3 py-2 text-right text-fg-muted">{formatPercent(o.percent)}</td>
            </tr>
          ))}
          {current.stats!.length === 0 && (
            <tr>
              <td colSpan={4} className="px-3 py-6 text-center text-fg-subtle">No files in this folder.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
