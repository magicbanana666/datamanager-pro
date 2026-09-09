import { useMemo, useState } from "react";
import { Pause, Play, Square } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/cards/Card";
import { LocationPicker } from "@/components/controls/LocationPicker";
import { RadioGroup } from "@/components/controls/RadioGroup";
import { Checkbox } from "@/components/controls/Checkbox";
import { TextInput } from "@/components/controls/TextInput";
import { Button } from "@/components/controls/Button";
import { Tabs } from "@/components/controls/Tabs";
import { Badge } from "@/components/controls/Badge";
import { ProgressBar } from "@/components/charts/ProgressBar";
import { LineChartPanel } from "@/components/charts/LineChartPanel";
import { DataTable, type DataTableColumn } from "@/components/tables/DataTable";
import { initialSyncRows } from "@/mock/sync";
import type { SyncAction, SyncMode, SyncRow } from "@/models/sync";
import { formatBytes, formatDate, formatDuration } from "@/utils/format";
import { useSimulatedProgress } from "@/hooks/useSimulatedProgress";
import { useUiStore } from "@/state/uiStore";
import { toast } from "@/state/toastStore";

const TABS = [
  { id: "file-list", label: "File List" },
  { id: "changes", label: "Changes" },
  { id: "conflicts", label: "Conflicts" },
  { id: "filters", label: "Filters" },
  { id: "options", label: "Options" },
  { id: "preview", label: "Preview" },
  { id: "log", label: "Log" },
];

const ACTION_BADGE: Record<SyncAction, { tone: "success" | "warning" | "info" | "danger" | "neutral"; label: string }> = {
  "copy-new": { tone: "success", label: "Copy (new)" },
  "update-newer": { tone: "warning", label: "Update (newer)" },
  "skip-same": { tone: "neutral", label: "Skip (same)" },
  "skip-older": { tone: "neutral", label: "Skip (older)" },
  "exclude-filter": { tone: "danger", label: "Exclude (filter)" },
  conflict: { tone: "danger", label: "Conflict" },
};

export function SyncPage() {
  const [source, setSource] = useState("D:\\Data\\Projects");
  const [destination, setDestination] = useState("E:\\Archive\\Projects");
  const [mode, setMode] = useState<SyncMode>("incremental");
  const [options, setOptions] = useState({
    deleteExtras: false,
    skipSameSizeDate: true,
    compareHash: false,
    preservePermissions: true,
    preserveTimestamps: true,
  });
  const [includeFilter, setIncludeFilter] = useState("*.*");
  const [excludeFilter, setExcludeFilter] = useState("*.tmp;*.log");
  const [tab, setTab] = useState("changes");
  const [log, setLog] = useState<string[]>(["Ready. Configure sync above and press Start Sync."]);
  const setStatusText = useUiStore((s) => s.setStatusText);

  const rows: SyncRow[] = initialSyncRows;
  const toCopy = rows.filter((r) => r.action === "copy-new" || r.action === "update-newer");
  const totalToCopyBytes = toCopy.reduce((s, r) => s + r.size, 0);

  const sync = useSimulatedProgress(() => {
    setStatusText("Ready");
    setLog((l) => [...l, `Sync completed - ${toCopy.length} files updated.`]);
    toast.success("Sync completed successfully.");
  });

  const speedHistory = useMemo(() => {
    if (sync.status !== "running") return [{ t: 0, mbps: 0 }];
    const points = Math.max(1, Math.floor(sync.elapsedSeconds));
    return Array.from({ length: points + 1 }, (_, i) => ({
      t: i,
      mbps: Math.round((45 + Math.sin(i / 2) * 15) * 10) / 10,
    }));
  }, [sync.elapsedSeconds, sync.status]);

  const bytesCopied = totalToCopyBytes * (sync.progress / 100);

  const summary = {
    newFiles: rows.filter((r) => r.action === "copy-new").length,
    updatedFiles: rows.filter((r) => r.action === "update-newer").length,
    unchangedFiles: rows.filter((r) => r.action === "skip-same" || r.action === "skip-older").length,
    excludedFiles: rows.filter((r) => r.action === "exclude-filter").length,
    conflicts: rows.filter((r) => r.action === "conflict").length,
  };

  function startSync() {
    setLog((l) => [...l, `Starting ${mode} sync from ${source} to ${destination}...`]);
    setStatusText("Syncing files...");
    sync.start(16);
  }

  const columns: DataTableColumn<SyncRow>[] = [
    { key: "included", header: "", width: 40, render: (r) => <Checkbox checked={r.included} onChange={() => toast.demo()} /> },
    { key: "fileName", header: "File Name", width: 190, sortAccessor: (r) => r.fileName, render: (r) => r.fileName },
    { key: "source", header: "Source Path", width: 190, render: (r) => <span className="truncate text-fg-muted">{r.sourcePath}</span> },
    { key: "dest", header: "Destination Path", width: 190, render: (r) => <span className="truncate text-fg-muted">{r.destPath}</span> },
    { key: "size", header: "Size", width: 90, align: "right", sortAccessor: (r) => r.size, render: (r) => formatBytes(r.size) },
    { key: "modSource", header: "Modified (Source)", width: 150, render: (r) => (r.modifiedSource ? formatDate(r.modifiedSource) : "-") },
    { key: "modDest", header: "Modified (Dest)", width: 150, render: (r) => (r.modifiedDest ? formatDate(r.modifiedDest) : "-") },
    {
      key: "action",
      header: "Action",
      width: 140,
      sortAccessor: (r) => r.action,
      render: (r) => <Badge tone={ACTION_BADGE[r.action].tone}>{ACTION_BADGE[r.action].label}</Badge>,
    },
  ];

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <PageHeader title="Sync / Incremental" description="Synchronize directories with advanced options; copy only new or changed files." />

      <div className="flex items-stretch gap-3">
        <Card title="Source" className="flex-1">
          <LocationPicker value={source} onChange={setSource} />
        </Card>
        <Card title="Destination" className="flex-1">
          <LocationPicker value={destination} onChange={setDestination} />
        </Card>
        <Card title="Sync Mode" className="w-[190px] shrink-0">
          <RadioGroup
            name="sync-mode"
            value={mode}
            onChange={setMode}
            options={[
              { value: "mirror", label: "Mirror" },
              { value: "incremental", label: "Incremental" },
              { value: "update-newer", label: "Update newer only" },
              { value: "two-way", label: "Two-way sync" },
            ]}
          />
        </Card>
        <Card title="Additional Options" className="w-[260px] shrink-0">
          <div className="flex flex-col gap-1.5">
            <Checkbox checked={options.deleteExtras} onChange={(v) => setOptions((o) => ({ ...o, deleteExtras: v }))} label="Delete files at destination" />
            <Checkbox checked={options.skipSameSizeDate} onChange={(v) => setOptions((o) => ({ ...o, skipSameSizeDate: v }))} label="Skip same size and date" />
            <Checkbox checked={options.compareHash} onChange={(v) => setOptions((o) => ({ ...o, compareHash: v }))} label="Compare file content (hash)" />
            <Checkbox checked={options.preservePermissions} onChange={(v) => setOptions((o) => ({ ...o, preservePermissions: v }))} label="Preserve permissions" />
            <Checkbox checked={options.preserveTimestamps} onChange={(v) => setOptions((o) => ({ ...o, preserveTimestamps: v }))} label="Preserve timestamps" />
          </div>
        </Card>
      </div>

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {tab === "filters" && (
          <Card title="Filters">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-medium text-fg-muted">Include filters</label>
                <TextInput value={includeFilter} onChange={(e) => setIncludeFilter(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-medium text-fg-muted">Exclude filters</label>
                <TextInput value={excludeFilter} onChange={(e) => setExcludeFilter(e.target.value)} />
              </div>
            </div>
          </Card>
        )}

        {tab === "options" && (
          <Card title="Sync Options Summary">
            <p className="text-[12.5px] text-fg-muted">
              Mode: <span className="text-fg">{mode}</span> · Include: <span className="text-fg">{includeFilter}</span> · Exclude:{" "}
              <span className="text-fg">{excludeFilter}</span>
            </p>
          </Card>
        )}

        {tab === "log" ? (
          <Card padded={false} bodyClassName="h-full overflow-y-auto p-3 font-mono text-[12px] text-fg-muted" className="flex-1">
            {log.map((line, i) => (
              <div key={i}>[{new Date().toLocaleTimeString()}] {line}</div>
            ))}
          </Card>
        ) : tab === "preview" ? (
          <Card>
            <p className="text-[12.5px] text-fg-muted">
              {toCopy.length} files ({formatBytes(totalToCopyBytes)}) would be copied or updated. {summary.excludedFiles} excluded, {summary.conflicts} conflicts.
            </p>
          </Card>
        ) : (
          <Card padded={false} bodyClassName="h-[280px]" className="flex-1">
            <DataTable
              columns={columns}
              rows={tab === "conflicts" ? rows.filter((r) => r.action === "conflict") : rows}
              getRowId={(r) => r.id}
              className="h-full border-0 rounded-none"
            />
          </Card>
        )}

        <div className="grid grid-cols-3 gap-3">
          <Card title="Sync Summary">
            <dl className="grid grid-cols-[1fr_auto] gap-y-1.5 text-[12.5px]">
              <dt className="text-fg-muted">New files:</dt>
              <dd className="text-right text-fg">{summary.newFiles}</dd>
              <dt className="text-fg-muted">Updated files:</dt>
              <dd className="text-right text-fg">{summary.updatedFiles}</dd>
              <dt className="text-fg-muted">Unchanged files:</dt>
              <dd className="text-right text-fg">{summary.unchangedFiles}</dd>
              <dt className="text-fg-muted">Excluded files:</dt>
              <dd className="text-right text-fg">{summary.excludedFiles}</dd>
              <dt className="text-fg-muted">Conflicts:</dt>
              <dd className="text-right text-fg">{summary.conflicts}</dd>
              <dt className="text-fg-muted">Total to copy:</dt>
              <dd className="text-right text-fg">{toCopy.length} files ({formatBytes(totalToCopyBytes)})</dd>
            </dl>
          </Card>
          <Card title="Transfer Progress">
            <div className="flex items-center justify-between text-[12px] text-fg-muted">
              <span>{sync.status === "running" ? "Syncing..." : sync.status === "completed" ? "Completed" : "Idle"}</span>
              <span className="font-semibold text-fg">{sync.progress.toFixed(0)}%</span>
            </div>
            <ProgressBar value={sync.progress} tone={sync.status === "completed" ? "success" : "accent"} className="mt-1.5" />
            <div className="mt-2 text-[11.5px] text-fg-muted">
              {formatBytes(bytesCopied)} / {formatBytes(totalToCopyBytes)} · Elapsed {formatDuration(sync.elapsedSeconds)}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <Button variant="primary" size="sm" icon={Play} onClick={startSync} disabled={sync.status === "running"}>
                Start Sync
              </Button>
              <Button size="sm" icon={Pause} disabled={sync.status !== "running"} onClick={sync.pause}>Pause</Button>
              <Button size="sm" variant="danger" icon={Square} disabled={sync.status !== "running" && sync.status !== "paused"} onClick={sync.stop}>
                Stop
              </Button>
              {sync.status === "paused" && <Button size="sm" icon={Play} onClick={sync.resume}>Resume</Button>}
            </div>
          </Card>
          <Card title="Realtime Speed">
            <LineChartPanel
              data={speedHistory}
              categoryKey="t"
              series={[{ key: "mbps", label: "MB/s", color: "var(--color-chart-3)" }]}
              valueFormatter={(v) => `${v} MB/s`}
              height={110}
            />
          </Card>
        </div>
      </div>
    </div>
  );
}
