/** The plan table's columns, shared by Data Transfer and Sync. */
import { ProgressBar } from "@/components/charts/ProgressBar";
import { Badge } from "@/components/controls/Badge";
import type { DataTableColumn } from "@/components/tables/DataTable";
import { RowStatusIcon } from "@/components/transfer/transferUi";
import type { PlanItem } from "@/models/transfer";
import type { RowState } from "@/state/transferStore";
import { formatBytes, formatDate } from "@/utils/format";
import { ACTION_BADGE, isWork, splitPath } from "@/utils/transfer";

/** Status, name, folders, size, action and per-file progress. */
export function planColumns(
  rowStates: Record<number, RowState>,
  active: Map<number, number>,
  extra: DataTableColumn<PlanItem>[] = [],
): DataTableColumn<PlanItem>[] {
  return [
    ...extra,
    { key: "status", header: "", width: 34, render: (r) => <RowStatusIcon item={r} state={rowStates[r.id]} /> },
    {
      key: "name",
      header: "File Name",
      width: 210,
      sortAccessor: (r) => r.relativePath.toLowerCase(),
      render: (r) => <span className="truncate" title={r.relativePath}>{splitPath(r.relativePath).name}{r.isFolder ? "\\" : ""}</span>,
    },
    { key: "source", header: "Source", width: 220, render: (r) => <span className="truncate text-fg-muted" title={r.sourcePath}>{splitPath(r.sourcePath).folder}</span> },
    { key: "dest", header: "Destination", width: 220, render: (r) => <span className="truncate text-fg-muted" title={r.destPath}>{splitPath(r.destPath).folder}</span> },
    { key: "size", header: "Size", width: 90, align: "right", sortAccessor: (r) => r.size, render: (r) => (r.isFolder && !r.size ? "-" : formatBytes(r.size)) },
    { key: "modSource", header: "Modified (Source)", width: 140, sortAccessor: (r) => r.sourceModified ?? "", render: (r) => formatDate(r.sourceModified) },
    { key: "modDest", header: "Modified (Dest)", width: 140, sortAccessor: (r) => r.destModified ?? "", render: (r) => formatDate(r.destModified) },
    {
      key: "action",
      header: "Action",
      width: 150,
      sortAccessor: (r) => r.action,
      render: (r) => <Badge tone={ACTION_BADGE[r.action].tone}>{ACTION_BADGE[r.action].label}</Badge>,
    },
    {
      key: "progress",
      header: "Progress",
      width: 120,
      render: (r) => {
        const state = rowStates[r.id];
        if (!isWork(r.action)) return null;
        const pct = state?.status === "done" ? 100 : active.has(r.id) ? active.get(r.id)! : 0;
        return state?.status === "error" ? (
          <span className="truncate text-[11.5px] text-danger" title={state.message}>{state.message}</span>
        ) : (
          <ProgressBar value={pct} height={6} tone={pct === 100 ? "success" : "accent"} />
        );
      },
    },
  ];
}
