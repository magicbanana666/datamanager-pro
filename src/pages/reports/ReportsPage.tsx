import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, ExternalLink, Eye, FileBarChart2, FolderOpen, Loader2, Trash2 } from "lucide-react";
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
import { Dialog } from "@/components/dialogs/Dialog";
import { deleteReport, exportReport, generateReport, listReports, previewReport, reportsFolder } from "@/api/reports";
import { confirmAction, pickSaveFile } from "@/api/dialog";
import { openPath } from "@/api/search";
import { openFolder } from "@/api/transfer";
import { toAppError } from "@/api/backend";
import type { ReportFormat, ReportRecord, ReportRequest, ReportTemplate } from "@/models/reports";
import { useScanAnalysis } from "@/hooks/useScanAnalysis";
import { useScanStore } from "@/state/scanStore";
import { useDuplicateStore } from "@/state/duplicateStore";
import { useSchedulerStore } from "@/state/schedulerStore";
import { useSyncStore, useTransferStore } from "@/state/transferStore";
import { REPORT_KINDS, buildReport, reportSource, type ReportKind } from "@/utils/reportBuilder";
import { formatBytes, formatDate, formatNumber } from "@/utils/format";
import { toast } from "@/state/toastStore";
import { useSettingsStore } from "@/state/settingsStore";
import type { FsNode } from "@/models/common";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "disk-folder", label: "Disk / Folder Reports" },
  { id: "duplicates", label: "Duplicate Reports" },
  { id: "transfer-sync", label: "Transfer / Sync Reports" },
  { id: "scheduled", label: "Scheduled Tasks" },
  { id: "other", label: "Other Reports" },
];

const TAB_TYPE_MATCH: Record<string, string[]> = {
  "disk-folder": ["Disk Analysis", "Folder Analysis", "Network Analysis"],
  duplicates: ["Duplicate Finder"],
  "transfer-sync": ["Data Transfer", "Sync / Incremental"],
  scheduled: ["Scheduler"],
  other: ["Comparison", "File Search"],
};

const EMPTY_NODE: FsNode = {
  id: "none",
  name: "",
  path: "",
  kind: "folder",
  size: 0,
  allocated: 0,
  fileCount: 0,
  folderCount: 0,
  percentOfParent: 100,
  lastModified: null,
  children: [],
};

const fail = (err: unknown) => toast.danger(err instanceof Error ? err.message : toAppError(err).message);

export function ReportsPage() {
  const [tab, setTab] = useState("overview");
  const [kind, setKind] = useState<ReportKind>("disk");
  const [format, setFormat] = useState<ReportFormat>(() => useSettingsStore.getState().settings.reports.defaultFormat);
  const outputDir = useSettingsStore((s) => s.settings.reports.defaultOutputFolder);
  const [template, setTemplate] = useState<ReportTemplate>("professional");
  const [notes, setNotes] = useState("");
  const [include, setInclude] = useState({
    summary: true,
    fileTypes: true,
    largest: true,
    charts: true,
    duplicates: true,
    transferHistory: true,
    notes: false,
  });
  const [records, setRecords] = useState<ReportRecord[]>([]);
  const [busy, setBusy] = useState<"preview" | "generate" | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const refresh = useCallback(() => {
    listReports().then(setRecords).catch(fail);
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Overview: the data the app holds right now.
  const scan = useScanStore();
  const scanRoot = scan.status === "completed" && scan.result ? scan.result.root : null;
  const analysis = useScanAnalysis(scanRoot ?? EMPTY_NODE, scanRoot ? scan.scanId : null);
  const duplicates = useDuplicateStore((s) => s.result);
  const transferReport = useTransferStore((s) => s.report);
  const syncReport = useSyncStore((s) => s.report);
  const { tasks, history } = useSchedulerStore();
  const transferred = useMemo(() => {
    const runs = history.filter((h) => h.files != null);
    const fromReports = [transferReport, syncReport].filter((r) => r != null);
    return {
      files: runs.reduce((s, h) => s + (h.files ?? 0), 0) + fromReports.reduce((s, r) => s + r.filesCopied, 0),
      bytes: runs.reduce((s, h) => s + (h.size ?? 0), 0) + fromReports.reduce((s, r) => s + r.bytesCopied, 0),
    };
  }, [history, transferReport, syncReport]);
  const runsByDay = useMemo(() => {
    const days = new Map<string, number>();
    for (const h of history) {
      if (h.size == null) continue;
      const day = h.dateTime.slice(0, 10);
      days.set(day, (days.get(day) ?? 0) + h.size);
    }
    return [...days.entries()].sort().slice(-14).map(([day, size]) => ({ name: day.slice(5), size }));
  }, [history]);

  const filtered = useMemo(() => {
    const types = TAB_TYPE_MATCH[tab];
    return types ? records.filter((r) => types.includes(r.type)) : records;
  }, [tab, records]);

  const source = reportSource(kind);

  async function request(): Promise<ReportRequest> {
    const document = await buildReport(
      kind,
      {
        summary: include.summary,
        fileTypes: include.fileTypes,
        largest: include.largest,
        duplicates: include.duplicates,
        transferHistory: include.transferHistory,
      },
      include.notes ? notes : null,
    );
    return {
      document,
      format,
      template,
      includeCharts: include.charts,
      description: include.notes && notes.trim() ? notes.trim() : document.source,
      outputDir: outputDir.trim() || null,
    };
  }

  async function runPreview() {
    setBusy("preview");
    try {
      setPreview(await previewReport(await request()));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  }

  async function runGenerate() {
    setBusy("generate");
    try {
      const record = await generateReport(await request());
      toast.success(`${record.name} saved to the reports folder.`, "Report generated");
      refresh();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  }

  async function saveCopy(r: ReportRecord) {
    const ext = r.format.toLowerCase();
    const destination = await pickSaveFile(r.name, [{ name: r.format, extensions: [ext] }]);
    if (!destination) return;
    exportReport(r.id, destination)
      .then(() => toast.success("Report copy saved."))
      .catch(fail);
  }

  async function remove(r: ReportRecord) {
    if (!(await confirmAction(`Move ${r.name} to the Recycle Bin?`, "Delete report", "Delete"))) return;
    deleteReport(r.id).then(refresh).catch(fail);
  }

  const field = "flex flex-col gap-1.5";
  const label = "text-[11px] font-medium text-fg-muted";
  const isScanKind = kind === "disk" || kind === "network";

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <PageHeader
        title="Reports"
        description="Generate detailed reports about your data, scans and operations."
        actions={
          <Button icon={FolderOpen} onClick={() => reportsFolder().then(openFolder).catch(fail)}>
            Open Report Folder
          </Button>
        }
      />

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      <div className="grid min-h-0 flex-1 grid-cols-[1fr_320px] gap-3">
        <div className="flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto pr-1">
          {tab === "overview" && (
            <>
              <div className="grid grid-cols-5 gap-2.5">
                <StatCard
                  icon={FileBarChart2}
                  label="Data Scanned"
                  value={scanRoot ? formatBytes(scanRoot.size) : "-"}
                  sublabel={scanRoot ? `${formatNumber(scanRoot.fileCount)} files` : "No scan yet"}
                  tone="accent"
                />
                <StatCard icon={FileBarChart2} label="Folders" value={scanRoot ? formatNumber(scanRoot.folderCount) : "-"} sublabel={scanRoot?.path ?? "-"} tone="info" />
                <StatCard
                  icon={FileBarChart2}
                  label="Duplicate Files"
                  value={duplicates ? formatNumber(duplicates.totalDuplicateFiles) : "-"}
                  sublabel={duplicates ? `${formatBytes(duplicates.totalWastedBytes)} recoverable` : "No duplicate scan yet"}
                  tone="warning"
                />
                <StatCard icon={FileBarChart2} label="Files Transferred" value={formatNumber(transferred.files)} sublabel={formatBytes(transferred.bytes)} tone="success" />
                <StatCard
                  icon={FileBarChart2}
                  label="Scheduled Tasks"
                  value={String(tasks.length)}
                  sublabel={`${tasks.filter((t) => t.enabled).length} enabled, ${tasks.filter((t) => !t.enabled).length} disabled`}
                  tone="accent"
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Card title="Top 10 Folders by Size">
                  {scanRoot ? (
                    <BarChartPanel
                      data={[...(scanRoot.children ?? [])]
                        .filter((c) => c.kind === "folder")
                        .sort((a, b) => b.size - a.size)
                        .slice(0, 10)
                        .map((f) => ({ name: f.name, size: f.size }))}
                      categoryKey="name"
                      series={[{ key: "size", label: "Size", color: "var(--color-chart-1)" }]}
                      height={200}
                    />
                  ) : (
                    <p className="text-[12px] text-fg-subtle">Scan a disk or folder to see this.</p>
                  )}
                </Card>
                <Card title="File Types Distribution">
                  {scanRoot ? (
                    <DonutChart
                      data={analysis.categoryStats}
                      centerLabel="Files"
                      centerValue={formatNumber(scanRoot.fileCount)}
                      size={140}
                      valueFormatter={(v) => formatBytes(v)}
                    />
                  ) : (
                    <p className="text-[12px] text-fg-subtle">Scan a disk or folder to see this.</p>
                  )}
                </Card>
                <Card title="Data Copied by Scheduled Runs">
                  {runsByDay.length ? (
                    <BarChartPanel
                      data={runsByDay}
                      categoryKey="name"
                      series={[{ key: "size", label: "Copied", color: "var(--color-chart-3)" }]}
                      height={200}
                    />
                  ) : (
                    <p className="text-[12px] text-fg-subtle">No scheduled transfer runs yet.</p>
                  )}
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
                    <td className="max-w-[260px] truncate px-3 py-2 text-fg-muted" title={r.description}>{r.description}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2 text-fg-muted">
                        <button title="Open" onClick={() => openPath(r.path).catch(fail)} className="cursor-pointer hover:text-fg"><ExternalLink size={14} /></button>
                        <button title="Save a copy..." onClick={() => void saveCopy(r)} className="cursor-pointer hover:text-fg"><Download size={14} /></button>
                        <button title="Show in folder" onClick={() => reportsFolder().then(openFolder).catch(fail)} className="cursor-pointer hover:text-fg"><FolderOpen size={14} /></button>
                        <button title="Delete" onClick={() => void remove(r)} className="cursor-pointer hover:text-danger"><Trash2 size={14} /></button>
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
          <div className={field}>
            <label className={label}>Report Type</label>
            <Select value={kind} onChange={(e) => setKind(e.target.value as ReportKind)} options={REPORT_KINDS} />
          </div>
          <div className={field}>
            <label className={label}>Source</label>
            <p className={source ? "text-[12.5px] text-fg break-all" : "text-[12px] text-warning"}>
              {source ?? "Nothing to report yet - run the matching scan, search or transfer first."}
            </p>
          </div>
          <div className={field}>
            <label className={label}>Report Format</label>
            <Select
              value={format}
              onChange={(e) => setFormat(e.target.value as ReportFormat)}
              options={[
                { value: "PDF", label: "PDF (Recommended)" },
                { value: "HTML", label: "HTML" },
                { value: "XLSX", label: "Excel (.xlsx)" },
                { value: "CSV", label: "CSV" },
              ]}
            />
          </div>
          <div className={field}>
            <label className={label}>Include in Report</label>
            <Checkbox checked={include.summary} onChange={(v) => setInclude((o) => ({ ...o, summary: v }))} label="Summary statistics" />
            {isScanKind && <Checkbox checked={include.fileTypes} onChange={(v) => setInclude((o) => ({ ...o, fileTypes: v }))} label="File type breakdown" />}
            {(isScanKind || kind === "comparison") && (
              <Checkbox
                checked={include.largest}
                onChange={(v) => setInclude((o) => ({ ...o, largest: v }))}
                label={kind === "comparison" ? "Identical files too" : "Largest files and folders"}
              />
            )}
            <Checkbox checked={include.charts} onChange={(v) => setInclude((o) => ({ ...o, charts: v }))} label="Charts (HTML/PDF)" />
            {kind === "duplicates" && <Checkbox checked={include.duplicates} onChange={(v) => setInclude((o) => ({ ...o, duplicates: v }))} label="Every duplicate file" />}
            {(kind === "transfer" || kind === "scheduler") && (
              <Checkbox checked={include.transferHistory} onChange={(v) => setInclude((o) => ({ ...o, transferHistory: v }))} label="Scheduled run history" />
            )}
            <Checkbox checked={include.notes} onChange={(v) => setInclude((o) => ({ ...o, notes: v }))} label="Custom notes" />
          </div>
          {include.notes && <TextInput value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Custom notes..." />}
          <div className={field}>
            <label className={label}>Report Template</label>
            <Select
              value={template}
              onChange={(e) => setTemplate(e.target.value as ReportTemplate)}
              options={[
                { value: "professional", label: "Professional (up to 100 rows per table)" },
                { value: "compact", label: "Compact (up to 25 rows)" },
                { value: "detailed", label: "Detailed (up to 1,000 rows)" },
              ]}
            />
          </div>
          <p className="text-[11.5px] text-fg-muted">
            XLSX and CSV always contain every row. Reports are saved in {outputDir.trim() || "Documents\\DataManager Pro Reports"} (Settings → Reports).
          </p>
          <div className="mt-auto flex gap-2 pt-2">
            <Button icon={busy === "preview" ? Loader2 : Eye} disabled={!source || !!busy} onClick={() => void runPreview()}>
              Preview
            </Button>
            <Button variant="primary" icon={busy === "generate" ? Loader2 : FileBarChart2} disabled={!source || !!busy} onClick={() => void runGenerate()}>
              {busy === "generate" ? "Generating..." : "Generate Report"}
            </Button>
          </div>
        </Card>
      </div>

      <Dialog open={preview != null} onClose={() => setPreview(null)} title="Report Preview" width={900}>
        <iframe title="Report preview" srcDoc={preview ?? ""} className="h-[70vh] w-full rounded border border-border bg-white" sandbox="" />
      </Dialog>
    </div>
  );
}
