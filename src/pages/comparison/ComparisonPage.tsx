import { useMemo, useState } from "react";
import {
  ArrowRightLeft,
  Copy,
  Download,
  Eye,
  FileX2,
  FolderOpen,
  Info,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/cards/Card";
import { LocationPicker } from "@/components/controls/LocationPicker";
import { Button } from "@/components/controls/Button";
import { Checkbox } from "@/components/controls/Checkbox";
import { Select } from "@/components/controls/Select";
import { Tabs } from "@/components/controls/Tabs";
import { Badge } from "@/components/controls/Badge";
import { DemoBadge } from "@/components/controls/DemoBadge";
import { DonutChart } from "@/components/charts/DonutChart";
import { BarChartPanel } from "@/components/charts/BarChartPanel";
import { ProgressBar } from "@/components/charts/ProgressBar";
import { DataTable, type DataTableColumn } from "@/components/tables/DataTable";
import {
  comparisonFileTypesA,
  comparisonFileTypesB,
  comparisonRows,
  comparisonSummaryA,
  comparisonSummaryB,
  comparisonTotals,
  fileCountComparisonByType,
  sizeComparisonByType,
} from "@/mock/comparison";
import { FILE_TYPE_CATEGORIES } from "@/models/common";
import type { ComparisonMode, ComparisonRow, ComparisonStatus } from "@/models/comparison";
import type { HashJobProgress } from "@/models/duplicates";
import { useComparisonStore } from "@/state/comparisonStore";
import { categoryComparison, sideCategoryStats, toUiRows } from "@/utils/comparison";
import { formatBytes, formatDate, formatNumber } from "@/utils/format";
import { toast } from "@/state/toastStore";

const STATUS_MAP: Record<string, ComparisonStatus> = {
  differences: "different",
  "left-only": "left-only",
  "right-only": "right-only",
  identical: "identical",
};

const STATUS_BADGE: Record<ComparisonStatus, { tone: "danger" | "info" | "success" | "warning"; label: string }> = {
  identical: { tone: "success", label: "Identical" },
  different: { tone: "warning", label: "Different" },
  "left-only": { tone: "info", label: "Left only" },
  "right-only": { tone: "info", label: "Right only" },
};

const PHASE_LABELS: Record<HashJobProgress["phase"], string> = {
  collecting: "Listing files",
  comparing: "Comparing",
  hashing: "Comparing contents",
};

const CATEGORY_LABELS = FILE_TYPE_CATEGORIES.map((c) => c.label);

export function ComparisonPage() {
  const run = useComparisonStore();
  const [locationA, setLocationA] = useState(() => run.result?.a.location ?? "D:\\Data\\Projects");
  const [locationB, setLocationB] = useState(() => run.result?.b.location ?? "E:\\Archive\\Projects");
  const [mode, setMode] = useState<ComparisonMode>("content-hash");
  const [options, setOptions] = useState({ includeSubfolders: true, ignoreTimestamps: false, ignoreSmallFiles: false });
  const [tab, setTab] = useState("summary");
  const [selectedRow, setSelectedRow] = useState<ComparisonRow | null>(null);
  const [hiddenCategories, setHiddenCategories] = useState<Set<string>>(new Set());

  const isReal = run.status === "completed" && !!run.result;
  const running = run.status === "running";
  const result = isReal ? run.result : null;

  const allRows = useMemo(() => (result ? toUiRows(result) : comparisonRows), [result]);
  const totals = result?.totals ?? comparisonTotals;
  const summaryA = result
    ? { ...result.a, lastModified: result.a.lastModified ?? "" }
    : comparisonSummaryA;
  const summaryB = result
    ? { ...result.b, lastModified: result.b.lastModified ?? "" }
    : comparisonSummaryB;
  const fileTypesA = useMemo(() => (result ? sideCategoryStats(result.a) : comparisonFileTypesA), [result]);
  const fileTypesB = useMemo(() => (result ? sideCategoryStats(result.b) : comparisonFileTypesB), [result]);
  const byCategory = useMemo(
    () => (result ? categoryComparison(result) : { bytes: sizeComparisonByType, files: fileCountComparisonByType }),
    [result],
  );

  const tabs = [
    { id: "summary", label: "Summary" },
    { id: "differences", label: "Differences", badge: totals.differentFiles },
    { id: "left-only", label: "Left Only", badge: totals.leftOnly },
    { id: "right-only", label: "Right Only", badge: totals.rightOnly },
    { id: "identical", label: "Identical", badge: totals.identicalFiles },
    { id: "file-types", label: "File Types" },
    { id: "timeline", label: "File Counts" },
    { id: "size-differences", label: "Size Differences" },
    { id: "filters", label: "Filters" },
  ];

  const visibleRows = useMemo(() => {
    const status = STATUS_MAP[tab];
    return allRows.filter((r) => (!status || r.status === status) && !hiddenCategories.has(r.category));
  }, [tab, allRows, hiddenCategories]);

  const statusTotal = STATUS_MAP[tab]
    ? {
        different: totals.differentFiles,
        "left-only": totals.leftOnly,
        "right-only": totals.rightOnly,
        identical: totals.identicalFiles,
      }[STATUS_MAP[tab]]
    : totals.differentFiles + totals.leftOnly + totals.rightOnly + totals.identicalFiles;

  const progress = run.progress;
  const percent =
    progress && progress.phase !== "collecting" && progress.bytesToHash > 0
      ? Math.min(100, (progress.bytesHashed / progress.bytesToHash) * 100)
      : null;

  function startComparison() {
    void run.start(locationA, locationB, { mode, ...options });
  }

  const columns: DataTableColumn<ComparisonRow>[] = [
    {
      key: "status",
      header: "Status",
      width: 100,
      sortAccessor: (r) => r.status,
      render: (r) => {
        const b = STATUS_BADGE[r.status];
        return <Badge tone={b.tone}>{b.label}</Badge>;
      },
    },
    { key: "name", header: "Name", width: 180, sortAccessor: (r) => r.name, render: (r) => <span title={r.name}>{r.name}</span> },
    { key: "pathA", header: "Path A", width: 200, render: (r) => <span className="truncate text-fg-muted" title={r.pathA ?? ""}>{r.pathA ?? "-"}</span> },
    { key: "pathB", header: "Path B", width: 200, render: (r) => <span className="truncate text-fg-muted" title={r.pathB ?? ""}>{r.pathB ?? "-"}</span> },
    { key: "sizeA", header: "Size A", width: 90, align: "right", sortAccessor: (r) => r.sizeA ?? -1, render: (r) => (r.sizeA != null ? formatBytes(r.sizeA) : "-") },
    { key: "sizeB", header: "Size B", width: 90, align: "right", sortAccessor: (r) => r.sizeB ?? -1, render: (r) => (r.sizeB != null ? formatBytes(r.sizeB) : "-") },
    { key: "modA", header: "Modified A", width: 140, render: (r) => (r.modifiedA ? formatDate(r.modifiedA) : "-") },
    { key: "modB", header: "Modified B", width: 140, render: (r) => (r.modifiedB ? formatDate(r.modifiedB) : "-") },
  ];

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <PageHeader title="Compare Locations" description="Compare two folders, drives or network locations and see what's different." />

      <div className="flex items-stretch gap-3">
        <Card title="Location A" className="flex-1">
          <LocationPicker value={locationA} onChange={setLocationA} />
        </Card>
        <button
          onClick={() => {
            setLocationA(locationB);
            setLocationB(locationA);
          }}
          className="mt-6 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border-strong bg-surface text-fg-muted hover:text-fg cursor-pointer"
          title="Swap locations"
        >
          <ArrowRightLeft size={15} />
        </button>
        <Card title="Location B" className="flex-1">
          <LocationPicker value={locationB} onChange={setLocationB} />
        </Card>
        <Card title="Options" className="w-[300px] shrink-0">
          <div className="flex flex-col gap-2">
            <Select
              value={mode}
              onChange={(e) => setMode(e.target.value as ComparisonMode)}
              options={[
                { value: "size-timestamp", label: "Size + timestamp" },
                { value: "content-hash", label: "File content / hash" },
                { value: "name-only", label: "Name only" },
              ]}
            />
            <Checkbox checked={options.includeSubfolders} onChange={(v) => setOptions((o) => ({ ...o, includeSubfolders: v }))} label="Include subfolders" />
            <Checkbox
              checked={options.ignoreTimestamps}
              onChange={(v) => setOptions((o) => ({ ...o, ignoreTimestamps: v }))}
              label="Ignore timestamps"
              disabled={mode !== "size-timestamp"}
            />
            <Checkbox checked={options.ignoreSmallFiles} onChange={(v) => setOptions((o) => ({ ...o, ignoreSmallFiles: v }))} label="Ignore small files (< 4 KB)" />
            {running ? (
              <Button icon={X} onClick={() => void run.cancel()}>
                Cancel
              </Button>
            ) : (
              <Button variant="primary" onClick={startComparison}>
                Start Comparison
              </Button>
            )}
            {running && (
              <>
                {percent !== null && <ProgressBar value={percent} />}
                <span className="truncate text-[11px] text-fg-muted" title={progress?.currentPath}>
                  {progress
                    ? `${PHASE_LABELS[progress.phase]}${percent !== null ? ` ${percent.toFixed(0)}%` : ` - ${formatNumber(progress.filesFound)} files`}`
                    : "Starting..."}
                </span>
              </>
            )}
          </div>
        </Card>
      </div>

      <div className="flex items-center gap-2">
        <Tabs tabs={tabs} active={tab} onChange={setTab} />
        {!isReal && <DemoBadge label="Demo Comparison" />}
      </div>

      {tab === "summary" && (
        <div className="grid grid-cols-3 gap-3">
          <Card title={`Location A — ${summaryA.location}`}>
            <DonutChart data={fileTypesA} centerLabel="Total Size" centerValue={formatBytes(summaryA.totalBytes)} size={120} />
            <div className="mt-2 text-[11.5px] text-fg-subtle">
              {formatNumber(summaryA.files)} files · {formatNumber(summaryA.folders)} folders
            </div>
          </Card>
          <Card title="Comparison Result">
            <dl className="grid grid-cols-[1fr_auto] gap-y-2 text-[12.5px]">
              <dt className="flex items-center gap-2 text-fg-muted"><Badge tone="success" dot /> Identical files</dt>
              <dd className="text-right text-fg">{formatNumber(totals.identicalFiles)}</dd>
              <dt className="flex items-center gap-2 text-fg-muted"><Badge tone="warning" dot /> Different files</dt>
              <dd className="text-right text-fg">{formatNumber(totals.differentFiles)}</dd>
              <dt className="flex items-center gap-2 text-fg-muted"><Badge tone="info" dot /> Left only (A)</dt>
              <dd className="text-right text-fg">{formatNumber(totals.leftOnly)}</dd>
              <dt className="flex items-center gap-2 text-fg-muted"><Badge tone="info" dot /> Right only (B)</dt>
              <dd className="text-right text-fg">{formatNumber(totals.rightOnly)}</dd>
              <dt className="text-fg-muted">Different data</dt>
              <dd className="text-right text-fg">{formatBytes(totals.differentDataBytes)}</dd>
              <dt className="text-fg-muted">Left only size</dt>
              <dd className="text-right text-fg">{formatBytes(totals.leftOnlyBytes)}</dd>
              <dt className="text-fg-muted">Right only size</dt>
              <dd className="text-right text-fg">{formatBytes(totals.rightOnlyBytes)}</dd>
            </dl>
            {result && (
              <p className="mt-2 text-[11.5px] text-fg-subtle">
                Compared in {(result.elapsedMs / 1000).toFixed(1)} s
                {result.skipped.length > 0 && ` · ${formatNumber(result.skipped.length)} unreadable items skipped`}
              </p>
            )}
          </Card>
          <Card title={`Location B — ${summaryB.location}`}>
            <DonutChart data={fileTypesB} centerLabel="Total Size" centerValue={formatBytes(summaryB.totalBytes)} size={120} />
            <div className="mt-2 text-[11.5px] text-fg-subtle">
              {formatNumber(summaryB.files)} files · {formatNumber(summaryB.folders)} folders
            </div>
          </Card>
        </div>
      )}

      {tab === "file-types" && (
        <div className="grid grid-cols-2 gap-3">
          <Card title="Location A file types">
            <DonutChart data={fileTypesA} centerLabel="Total Size" centerValue={formatBytes(summaryA.totalBytes)} size={160} />
          </Card>
          <Card title="Location B file types">
            <DonutChart data={fileTypesB} centerLabel="Total Size" centerValue={formatBytes(summaryB.totalBytes)} size={160} />
          </Card>
        </div>
      )}

      {tab === "size-differences" && (
        <Card title="Size Comparison by File Type">
          <BarChartPanel
            data={byCategory.bytes}
            categoryKey="type"
            series={[
              { key: "a", label: "Location A", color: "var(--color-chart-1)" },
              { key: "b", label: "Location B", color: "var(--color-chart-2)" },
            ]}
            height={260}
          />
        </Card>
      )}

      {tab === "timeline" && (
        <Card title="File Count Comparison">
          <BarChartPanel
            data={byCategory.files}
            categoryKey="type"
            series={[
              { key: "a", label: "Location A", color: "var(--color-chart-1)" },
              { key: "b", label: "Location B", color: "var(--color-chart-2)" },
            ]}
            valueFormatter={(v) => formatNumber(v)}
            height={260}
          />
        </Card>
      )}

      {tab === "filters" && (
        <Card title="Show file types in the table below">
          <div className="grid grid-cols-3 gap-3">
            {CATEGORY_LABELS.map((c) => (
              <Checkbox
                key={c}
                checked={!hiddenCategories.has(c)}
                onChange={(v) =>
                  setHiddenCategories((prev) => {
                    const next = new Set(prev);
                    if (v) next.delete(c);
                    else next.add(c);
                    return next;
                  })
                }
                label={c}
              />
            ))}
          </div>
        </Card>
      )}

      <Card
        title="Detailed Comparison"
        padded={false}
        // flex-none: cancels Card's default flex-1 (flex-basis:0%), which
        // otherwise beats this fixed height in a flex-col layout - see
        // the identical fix/comment in DiskAnalysisPage.tsx (PHASE4.md).
        bodyClassName="h-[280px] flex-none"
        action={
          <div className="flex items-center gap-2 text-[11.5px] text-fg-subtle">
            {isReal && statusTotal > visibleRows.length && hiddenCategories.size === 0 && (
              <span>
                Largest {formatNumber(visibleRows.length)} of {formatNumber(statusTotal)}
              </span>
            )}
            <Info size={13} />
          </div>
        }
      >
        <DataTable
          columns={columns}
          rows={visibleRows}
          getRowId={(r) => r.id}
          selectedId={selectedRow?.id ?? null}
          onRowClick={setSelectedRow}
          emptyMessage={running ? "Comparing..." : "No entries in this category."}
          className="h-full border-0 rounded-none"
        />
      </Card>

      {/* File actions (open, copy, move, delete, ...) arrive with the
          Phase 6 file-operations engine - this phase is read-only. */}
      <div className="flex flex-wrap items-center gap-2">
        <Button icon={Eye} onClick={() => toast.demo()}>Open</Button>
        <Button icon={FolderOpen} onClick={() => toast.demo()}>Open Location</Button>
        <Button icon={Copy} onClick={() => toast.demo()}>Copy To...</Button>
        <Button icon={ArrowRightLeft} onClick={() => toast.demo()}>Move To...</Button>
        <Button icon={Trash2} variant="danger" onClick={() => toast.demoNoFilesModified()}>Delete</Button>
        <Button icon={FileX2} onClick={() => toast.demo()}>Exclude</Button>
        <Button icon={Info} onClick={() => toast.demo()}>Properties</Button>
        <div className="ml-auto flex items-center gap-2">
          <Button icon={Download} onClick={() => toast.demo()}>Export Report</Button>
          <Button icon={Save} variant="primary" onClick={() => toast.demo()}>Save Comparison</Button>
        </div>
      </div>
    </div>
  );
}
