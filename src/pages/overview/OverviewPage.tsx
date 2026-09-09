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
import { LineChartPanel } from "@/components/charts/LineChartPanel";
import {
  overviewStats,
  recentReports,
  recentScans,
  recentTransfers,
  storageUsageHistory,
} from "@/mock/overview";
import { formatDate } from "@/utils/format";
import type { StatusTone } from "@/utils/colors";

const STAT_ICONS: Record<string, typeof HardDrive> = {
  storage: HardDrive,
  files: FileText,
  folders: Folder,
  duplicates: Copy,
  transfers: ArrowLeftRight,
  scheduled: Calendar,
};

const STATUS_TONE: Record<string, StatusTone> = {
  completed: "success",
  running: "accent",
  error: "danger",
};

export function OverviewPage() {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col gap-4 p-4">
      <PageHeader title="Overview" description="Your data at a glance, across every scanned location." />

      <div className="grid grid-cols-6 gap-3">
        {overviewStats.map((stat) => (
          <StatCard
            key={stat.id}
            icon={STAT_ICONS[stat.id]}
            label={stat.label}
            value={stat.value}
            sublabel={stat.sublabel}
            tone={stat.tone}
          />
        ))}
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2 flex flex-col gap-4">
          <Card title="Storage Usage (last 6 months)">
            <LineChartPanel
              data={storageUsageHistory}
              categoryKey="month"
              series={[{ key: "usedTb", label: "Used (TB)", color: "var(--color-chart-1)" }]}
              valueFormatter={(v) => `${v.toFixed(1)} TB`}
              height={180}
            />
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
                {recentScans.map((s) => (
                  <tr key={s.id} className="border-b border-border/60 hover:bg-surface-hover">
                    <td className="truncate px-3.5 py-2 font-medium text-fg">{s.location}</td>
                    <td className="px-3.5 py-2 text-fg-muted">{s.type}</td>
                    <td className="px-3.5 py-2 text-fg-muted">{s.size}</td>
                    <td className="px-3.5 py-2 text-fg-muted">{formatDate(s.date)}</td>
                    <td className="px-3.5 py-2">
                      <Badge tone={STATUS_TONE[s.status]} dot>
                        {s.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card title="Quick Actions">
            <div className="grid grid-cols-2 gap-2">
              <Button icon={HardDrive} onClick={() => navigate("/disk-analysis")} className="justify-start">
                Disk Analysis
              </Button>
              <Button icon={ScanSearch} onClick={() => navigate("/file-search")} className="justify-start">
                File Search
              </Button>
              <Button icon={GitCompare} onClick={() => navigate("/comparison")} className="justify-start">
                Compare
              </Button>
              <Button icon={ArrowLeftRight} onClick={() => navigate("/data-transfer")} className="justify-start">
                Transfer
              </Button>
              <Button icon={Calendar} onClick={() => navigate("/scheduler")} className="justify-start">
                Scheduler
              </Button>
              <Button icon={ClipboardList} onClick={() => navigate("/reports")} className="justify-start">
                Reports
              </Button>
            </div>
          </Card>

          <Card title="Recent Transfers" bodyClassName="flex flex-col gap-2.5 p-3">
            {recentTransfers.map((t) => (
              <div key={t.id} className="flex items-center justify-between rounded-md border border-border bg-surface-alt px-2.5 py-2">
                <div className="min-w-0">
                  <div className="truncate text-[12.5px] font-medium text-fg">
                    {t.mode}: {t.source}
                  </div>
                  <div className="truncate text-[11px] text-fg-subtle">→ {t.destination}</div>
                </div>
                <Badge tone={STATUS_TONE[t.status]} dot className="shrink-0">
                  {t.status}
                </Badge>
              </div>
            ))}
          </Card>

          <Card title="Recent Reports" bodyClassName="flex flex-col gap-2 p-3">
            {recentReports.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-[12.5px] text-fg">{r.name}</div>
                  <div className="text-[11px] text-fg-subtle">{r.type}</div>
                </div>
                <span className="shrink-0 text-[11px] text-fg-subtle">{formatDate(r.date)}</span>
              </div>
            ))}
          </Card>
        </div>
      </div>
    </div>
  );
}
