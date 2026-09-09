import { useMemo, useState } from "react";
import { Copy, Download, FileBarChart2, FolderOpen, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/cards/Card";
import { StatCard } from "@/components/cards/StatCard";
import { Tabs } from "@/components/controls/Tabs";
import { Select } from "@/components/controls/Select";
import { Checkbox } from "@/components/controls/Checkbox";
import { TextInput } from "@/components/controls/TextInput";
import { Button } from "@/components/controls/Button";
import { DonutChart } from "@/components/charts/DonutChart";
import { BarChartPanel } from "@/components/charts/BarChartPanel";
import { LineChartPanel } from "@/components/charts/LineChartPanel";
import {
  dataGrowthHistory,
  reportFileTypeDistribution,
  reportRecords,
  reportTopFolders,
} from "@/mock/reports";
import type { ReportFormat } from "@/models/reports";
import { formatBytes, formatDate } from "@/utils/format";
import { toast } from "@/state/toastStore";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "disk-folder", label: "Disk / Folder Reports" },
  { id: "duplicates", label: "Duplicate Reports" },
  { id: "transfer-sync", label: "Transfer / Sync Reports" },
  { id: "scheduled", label: "Scheduled Tasks" },
  { id: "custom", label: "Custom Reports" },
];

const TAB_TYPE_MATCH: Record<string, string[]> = {
  "disk-folder": ["Disk Analysis", "Folder Analysis"],
  duplicates: ["Duplicate Finder"],
  "transfer-sync": ["Data Transfer", "Sync / Incremental"],
  scheduled: ["Scheduler"],
  custom: ["Custom"],
};

export function ReportsPage() {
  const [tab, setTab] = useState("overview");
  const [reportType, setReportType] = useState("Disk Analysis Report");
  const [source, setSource] = useState("D:\\Data\\Projects\\");
  const [format, setFormat] = useState<ReportFormat>("PDF");
  const [notes, setNotes] = useState("Monthly project report");
  const [include, setInclude] = useState({
    summary: true,
    fileTypes: true,
    largest: true,
    charts: true,
    duplicates: false,
    transferHistory: false,
    notes: true,
  });

  const filtered = useMemo(() => {
    const types = TAB_TYPE_MATCH[tab];
    return types ? reportRecords.filter((r) => types.includes(r.type)) : reportRecords;
  }, [tab]);

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <PageHeader
        title="Reports"
        description="Generate detailed reports about your data, scans and operations."
        actions={<Button icon={FolderOpen} onClick={() => toast.demo()}>Open Report Folder</Button>}
      />

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      <div className="grid min-h-0 flex-1 grid-cols-[1fr_320px] gap-3">
        <div className="flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto pr-1">
          {tab === "overview" && (
            <>
              <div className="grid grid-cols-5 gap-2.5">
                <StatCard icon={FileBarChart2} label="Total Data Scanned" value="2.48 TB" sublabel="124,532 files" tone="accent" />
                <StatCard icon={FileBarChart2} label="Folders" value="18,427" sublabel="Across all sources" tone="info" />
                <StatCard icon={FileBarChart2} label="Duplicate Files" value="1,247" sublabel="18.6 GB" tone="warning" />
                <StatCard icon={FileBarChart2} label="Files Transferred" value="765,432" sublabel="178.4 GB" tone="success" />
                <StatCard icon={FileBarChart2} label="Scheduled Tasks" value="6" sublabel="4 enabled, 2 disabled" tone="accent" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Card title="Top 10 Folders by Size">
                  <BarChartPanel
                    data={reportTopFolders.map((f) => ({ name: f.path.split("\\").pop(), size: f.size }))}
                    categoryKey="name"
                    series={[{ key: "size", label: "Size", color: "var(--color-chart-1)" }]}
                    height={200}
                  />
                </Card>
                <Card title="File Types Distribution">
                  <DonutChart data={reportFileTypeDistribution} centerLabel="Total" centerValue="1,234,567" size={140} valueFormatter={(v) => formatBytes(v)} />
                </Card>
                <Card title="Data Growth (Last 6 Months)">
                  <LineChartPanel
                    data={dataGrowthHistory.map((d) => ({ month: d.month, source: d.sourceBytes / 1024 ** 3, dest: d.destBytes / 1024 ** 3 }))}
                    categoryKey="month"
                    series={[
                      { key: "source", label: "Source (GB)", color: "var(--color-chart-1)" },
                      { key: "dest", label: "Destination (GB)", color: "var(--color-chart-3)" },
                    ]}
                    valueFormatter={(v) => `${v.toFixed(0)} GB`}
                    height={200}
                  />
                </Card>
              </div>
            </>
          )}

          <Card title="Recent Reports" padded={false} bodyClassName="min-h-0">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-border text-left text-[11px] font-semibold text-fg-muted">
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Date Created</th>
                  <th className="px-3 py-2 text-right">Size</th>
                  <th className="px-3 py-2">Description</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="border-b border-border/60 hover:bg-surface-hover">
                    <td className="px-3 py-2 font-medium text-fg">{r.name}</td>
                    <td className="px-3 py-2 text-fg-muted">{r.type}</td>
                    <td className="px-3 py-2 text-fg-muted">{formatDate(r.dateCreated)}</td>
                    <td className="px-3 py-2 text-right text-fg-muted">{formatBytes(r.size)}</td>
                    <td className="px-3 py-2 text-fg-muted">{r.description}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2 text-fg-muted">
                        <button onClick={() => toast.demo()} className="cursor-pointer hover:text-fg"><Download size={14} /></button>
                        <button onClick={() => toast.demo()} className="cursor-pointer hover:text-fg"><FolderOpen size={14} /></button>
                        <button onClick={() => toast.demo()} className="cursor-pointer hover:text-danger"><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-fg-subtle">No reports in this category yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </Card>
        </div>

        <Card title="Generate New Report" bodyClassName="flex flex-col gap-3 overflow-y-auto p-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-medium text-fg-muted">Report Type</label>
            <Select
              value={reportType}
              onChange={(e) => setReportType(e.target.value)}
              options={[
                { value: "Disk Analysis Report", label: "Disk Analysis Report" },
                { value: "Folder Analysis Report", label: "Folder Analysis Report" },
                { value: "Duplicate Finder Report", label: "Duplicate Finder Report" },
                { value: "Transfer / Sync Report", label: "Transfer / Sync Report" },
                { value: "Scheduled Tasks Report", label: "Scheduled Tasks Report" },
              ]}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-medium text-fg-muted">Source</label>
            <div className="flex gap-2">
              <TextInput value={source} onChange={(e) => setSource(e.target.value)} containerClassName="flex-1" />
              <Button onClick={() => toast.demo()}>Browse...</Button>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-medium text-fg-muted">Report Format</label>
            <Select value={format} onChange={(e) => setFormat(e.target.value as ReportFormat)} options={[
              { value: "PDF", label: "PDF (Recommended)" },
              { value: "HTML", label: "HTML" },
              { value: "XLSX", label: "Excel (.xlsx)" },
              { value: "CSV", label: "CSV" },
            ]} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-medium text-fg-muted">Include in Report</label>
            <Checkbox checked={include.summary} onChange={(v) => setInclude((o) => ({ ...o, summary: v }))} label="Summary statistics" />
            <Checkbox checked={include.fileTypes} onChange={(v) => setInclude((o) => ({ ...o, fileTypes: v }))} label="File type breakdown" />
            <Checkbox checked={include.largest} onChange={(v) => setInclude((o) => ({ ...o, largest: v }))} label="Largest files and folders" />
            <Checkbox checked={include.charts} onChange={(v) => setInclude((o) => ({ ...o, charts: v }))} label="Charts and graphs" />
            <Checkbox checked={include.duplicates} onChange={(v) => setInclude((o) => ({ ...o, duplicates: v }))} label="Duplicate files (if available)" />
            <Checkbox checked={include.transferHistory} onChange={(v) => setInclude((o) => ({ ...o, transferHistory: v }))} label="Transfer history (if available)" />
            <Checkbox checked={include.notes} onChange={(v) => setInclude((o) => ({ ...o, notes: v }))} label="Custom notes" />
          </div>
          {include.notes && (
            <TextInput value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Custom notes..." />
          )}
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-medium text-fg-muted">Report Template</label>
            <Select options={[
              { value: "professional", label: "Professional (Default)" },
              { value: "compact", label: "Compact" },
              { value: "detailed", label: "Detailed" },
            ]} />
          </div>
          <div className="mt-auto flex gap-2 pt-2">
            <Button icon={Copy} onClick={() => toast.demo()}>Preview Report</Button>
            <Button variant="primary" icon={FileBarChart2} onClick={() => toast.success("Report generated (Phase 1 demo - no file written).")}>
              Generate Report
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
