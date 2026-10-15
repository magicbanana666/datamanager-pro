import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeftRight,
  Calendar,
  ClipboardList,
  Copy,
  FileText,
  Folder,
  GitCompare,
  HardDrive,
  ScanSearch,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatCard } from "@/components/cards/StatCard";
import { Card } from "@/components/cards/Card";
import { Button } from "@/components/controls/Button";
import { Badge } from "@/components/controls/Badge";
import { ProgressBar } from "@/components/charts/ProgressBar";
import { listStorageVolumes } from "@/api/backend";
import { listReports } from "@/api/reports";
import { openPath } from "@/api/search";
import type { StorageVolume } from "@/models/backend";
import type { ReportRecord } from "@/models/reports";
import { useActivityStore, type ActivityStatus } from "@/state/activityStore";
import { useDuplicateStore } from "@/state/duplicateStore";
import { useScanStore } from "@/state/scanStore";
import { useSchedulerStore } from "@/state/schedulerStore";
import { formatBytes, formatDate, formatNumber, formatPercent } from "@/utils/format";
import type { StatusTone } from "@/utils/colors";

const STATUS_TONE: Record<ActivityStatus, StatusTone> = {
  completed: "success",
  cancelled: "neutral",
  error: "danger",
};

const KIND_LABEL: Record<string, string> = {
  scan: "Disk / Folder",
  "network-scan": "Network",
  transfer: "Transfer",
  sync: "Sync",
  "file-action": "File action",
  duplicates: "Duplicates",
};

export function OverviewPage() {
  const navigate = useNavigate();
  const [volumes, setVolumes] = useState<StorageVolume[] | null>(null);
  const [reports, setReports] = useState<ReportRecord[]>([]);
  const entries = useActivityStore((s) => s.entries);
  const scan = useScanStore((s) => (s.status === "completed" ? s.result : null));
  const duplicates = useDuplicateStore((s) => s.result);
  const { tasks, history } = useSchedulerStore();

  useEffect(() => {
    listStorageVolumes().then(setVolumes).catch(() => setVolumes([]));
    listReports().then(setReports).catch(() => setReports([]));
  }, []);

  const storage = useMemo(() => {
    const vols = volumes ?? [];
    return {
      used: vols.reduce((s, v) => s + v.usedBytes, 0),
      total: vols.reduce((s, v) => s + v.totalBytes, 0),
    };
  }, [volumes]);
  const scans = entries.filter((e) => e.kind === "scan" || e.kind === "network-scan");
  const transfers = entries.filter((e) => e.kind === "transfer" || e.kind === "sync" || e.kind === "file-action");
  const lastScan = scans.find((e) => e.status === "completed");
  const scheduledRuns = history.filter((h) => h.files != null);

  return (
    <div className="flex flex-col gap-4 p-4">
      <PageHeader title="Overview" description="Your data at a glance, across every scanned location." />

      <div className="grid grid-cols-6 gap-3">
        <StatCard
          icon={HardDrive}
          label="Storage Used"
          value={volumes ? formatBytes(storage.used) : "..."}
          sublabel={volumes ? `of ${formatBytes(storage.total)} on ${volumes.length} drives` : "Reading drives"}
          tone="accent"
        />
        <StatCard
          icon={FileText}
          label="Files (last scan)"
          value={scan ? formatNumber(scan.root.fileCount) : "-"}
          sublabel={scan?.root.path ?? lastScan?.title ?? "No scan yet"}
          tone="info"
        />
        <StatCard icon={Folder} label="Folders (last scan)" value={scan ? formatNumber(scan.root.folderCount) : "-"} sublabel={scan ? formatBytes(scan.root.size) : "-"} tone="info" />
        <StatCard
          icon={Copy}
          label="Duplicates"
          value={duplicates ? formatNumber(duplicates.totalDuplicateFiles) : "-"}
          sublabel={duplicates ? `${formatBytes(duplicates.totalWastedBytes)} recoverable` : "No duplicate scan yet"}
          tone="warning"
        />
        <StatCard
          icon={ArrowLeftRight}
          label="Transfers"
          value={formatNumber(transfers.filter((t) => t.status === "completed").length + scheduledRuns.length)}
          sublabel={formatBytes(transfers.reduce((s, t) => s + (t.size ?? 0), 0) + scheduledRuns.reduce((s, h) => s + (h.size ?? 0), 0)) + " copied"}
          tone="success"
        />
        <StatCard
          icon={Calendar}
          label="Scheduled Tasks"
          value={String(tasks.length)}
          sublabel={`${tasks.filter((t) => t.enabled).length} enabled`}
          tone="accent"
        />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2 flex flex-col gap-4">
          <Card title="Drives" bodyClassName="flex flex-col gap-2.5 p-3">
            {volumes == null && <p className="text-[12px] text-fg-subtle">Reading drives...</p>}
            {volumes?.length === 0 && <p className="text-[12px] text-fg-subtle">No drives found.</p>}
            {volumes?.map((v) => (
              <div key={v.id} className="flex items-center gap-3 text-[12.5px]">
                <HardDrive size={15} className="shrink-0 text-fg-muted" />
                <span className="w-[200px] shrink-0 truncate text-fg" title={v.name}>{v.name}</span>
                <ProgressBar
                  value={v.usagePercent}
                  tone={v.usagePercent > 90 ? "danger" : v.usagePercent > 75 ? "warning" : "accent"}
                  className="flex-1"
                  height={8}
                />
                <span className="w-[190px] shrink-0 text-right text-fg-muted">
                  {formatBytes(v.freeBytes)} free of {formatBytes(v.totalBytes)} ({formatPercent(v.usagePercent)} used)
                </span>
              </div>
            ))}
          </Card>

          <Card title="Recent Scans" bodyClassName="p-0">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-border text-left text-[11px] font-semibold text-fg-muted">
                  <th className="px-3.5 py-2">Location</th>
                  <th className="px-3.5 py-2">Type</th>
                  <th className="px-3.5 py-2">Size</th>
                  <th className="px-3.5 py-2">Date</th>
                  <th className="px-3.5 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {scans.slice(0, 8).map((s) => (
                  <tr key={s.id} className="border-b border-border/60 hover:bg-surface-hover">
                    <td className="max-w-[320px] truncate px-3.5 py-2 font-medium text-fg" title={s.detail}>{s.title}</td>
                    <td className="px-3.5 py-2 text-fg-muted">{KIND_LABEL[s.kind]}</td>
                    <td className="px-3.5 py-2 text-fg-muted">{s.size != null ? formatBytes(s.size) : "-"}</td>
                    <td className="px-3.5 py-2 text-fg-muted">{formatDate(s.date)}</td>
                    <td className="px-3.5 py-2">
                      <Badge tone={STATUS_TONE[s.status]} dot>{s.status}</Badge>
                    </td>
                  </tr>
                ))}
                {scans.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3.5 py-6 text-center text-fg-subtle">No scans yet - start one from Disk Analysis or Folder Analysis.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card title="Quick Actions">
            <div className="grid grid-cols-2 gap-2">
              <Button icon={HardDrive} onClick={() => navigate("/disk-analysis")} className="justify-start">Disk Analysis</Button>
              <Button icon={ScanSearch} onClick={() => navigate("/file-search")} className="justify-start">File Search</Button>
              <Button icon={GitCompare} onClick={() => navigate("/comparison")} className="justify-start">Compare</Button>
              <Button icon={ArrowLeftRight} onClick={() => navigate("/data-transfer")} className="justify-start">Transfer</Button>
              <Button icon={Calendar} onClick={() => navigate("/scheduler")} className="justify-start">Scheduler</Button>
              <Button icon={ClipboardList} onClick={() => navigate("/reports")} className="justify-start">Reports</Button>
            </div>
          </Card>

          <Card title="Recent Transfers" bodyClassName="flex flex-col gap-2.5 p-3">
            {transfers.slice(0, 5).map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface-alt px-2.5 py-2">
                <div className="min-w-0">
                  <div className="truncate text-[12.5px] font-medium text-fg" title={t.title}>{t.title}</div>
                  <div className="truncate text-[11px] text-fg-subtle">{t.detail} · {formatDate(t.date)}</div>
                </div>
                <Badge tone={STATUS_TONE[t.status]} dot className="shrink-0">{t.status}</Badge>
              </div>
            ))}
            {transfers.length === 0 && <p className="text-[12px] text-fg-subtle">No transfers yet.</p>}
          </Card>

          <Card title="Recent Reports" bodyClassName="flex flex-col gap-2 p-3">
            {reports.slice(0, 5).map((r) => (
              <button
                key={r.id}
                onClick={() => openPath(r.path).catch(() => {})}
                className="flex cursor-pointer items-center justify-between gap-2 text-left"
                title="Open the report"
              >
                <div className="min-w-0">
                  <div className="truncate text-[12.5px] text-fg hover:underline">{r.name}</div>
                  <div className="text-[11px] text-fg-subtle">{r.type}</div>
                </div>
                <span className="shrink-0 text-[11px] text-fg-subtle">{formatDate(r.dateCreated)}</span>
              </button>
            ))}
            {reports.length === 0 && <p className="text-[12px] text-fg-subtle">No reports yet.</p>}
          </Card>
        </div>
      </div>
    </div>
  );
}
