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
import type { ComparisonMode, ComparisonRow, ComparisonStatus } from "@/models/comparison";
import { formatBytes, formatDate, formatNumber } from "@/utils/format";
import { useSimulatedProgress } from "@/hooks/useSimulatedProgress";
import { toast } from "@/state/toastStore";

const TABS = [
  { id: "summary", label: "Summary" },
  { id: "differences", label: "Differences", badge: comparisonTotals.differentFiles },
  { id: "left-only", label: "Left Only", badge: comparisonTotals.leftOnly },
  { id: "right-only", label: "Right Only", badge: comparisonTotals.rightOnly },
  { id: "identical", label: "Identical", badge: comparisonTotals.identicalFiles },
  { id: "file-types", label: "File Types" },
  { id: "timeline", label: "Timeline" },
  { id: "size-differences", label: "Size Differences" },
  { id: "filters", label: "Filters" },
];

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

export function ComparisonPage() {
  const [locationA, setLocationA] = useState("D:\\Data\\Projects");
  const [locationB, setLocationB] = useState("E:\\Archive\\Projects");
  const [mode, setMode] = useState<ComparisonMode>("content-hash");
  const [options, setOptions] = useState({ includeSubfolders: true, ignoreTimestamps: false, ignoreSmallFiles: false });
  const [tab, setTab] = useState("summary");
  const [selectedRow, setSelectedRow] = useState<ComparisonRow | null>(null);
  const [hasResults, setHasResults] = useState(true);

  const compare = useSimulatedProgress(() => {
    setHasResults(true);
    toast.success(`Comparison completed - ${formatNumber(comparisonRows.length)} entries compared.`);
  });

  const visibleRows = useMemo(() => {
    if (!hasResults) return [];
    const status = STATUS_MAP[tab];
    return status ? comparisonRows.filter((r) => r.status === status) : comparisonRows;
  }, [tab, hasResults]);

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
    { key: "name", header: "Name", width: 180, sortAccessor: (r) => r.name, render: (r) => r.name },
    { key: "pathA", header: "Path A", width: 200, render: (r) => <span className="truncate text-fg-muted">{r.pathA ?? "-"}</span> },
    { key: "pathB", header: "Path B", width: 200, render: (r) => <span className="truncate text-fg-muted">{r.pathB ?? "-"}</span> },
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
            <Checkbox checked={options.ignoreTimestamps} onChange={(v) => setOptions((o) => ({ ...o, ignoreTimestamps: v }))} label="Ignore timestamps" />
            <Checkbox checked={options.ignoreSmallFiles} onChange={(v) => setOptions((o) => ({ ...o, ignoreSmallFiles: v }))} label="Ignore small files" />
            <Button
              variant="primary"
              onClick={() => {
                setHasResults(false);
                compare.start(2.5);
              }}
              disabled={compare.status === "running"}
            >
              {compare.status === "running" ? `Comparing... ${compare.progress.toFixed(0)}%` : "Start Comparison"}
            </Button>
            {compare.status === "running" && <ProgressBar value={compare.progress} />}
          </div>
        </Card>
      </div>

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {tab === "summary" && (
        <div className="grid grid-cols-3 gap-3">
          <Card title={`Location A — ${comparisonSummaryA.location}`}>
            <DonutChart data={comparisonFileTypesA} centerLabel="Total Size" centerValue={formatBytes(comparisonSummaryA.totalBytes)} size={120} />
            <div className="mt-2 text-[11.5px] text-fg-subtle">
              {formatNumber(comparisonSummaryA.files)} files · {formatNumber(comparisonSummaryA.folders)} folders
            </div>
          </Card>
          <Card title="Comparison Result">
            <dl className="grid grid-cols-[1fr_auto] gap-y-2 text-[12.5px]">
              <dt className="flex items-center gap-2 text-fg-muted"><Badge tone="success" dot /> Identical files</dt>
              <dd className="text-right text-fg">{formatNumber(comparisonTotals.identicalFiles)}</dd>
              <dt className="flex items-center gap-2 text-fg-muted"><Badge tone="warning" dot /> Different files</dt>
              <dd className="text-right text-fg">{formatNumber(comparisonTotals.differentFiles)}</dd>
              <dt className="flex items-center gap-2 text-fg-muted"><Badge tone="info" dot /> Left only (A)</dt>
              <dd className="text-right text-fg">{formatNumber(comparisonTotals.leftOnly)}</dd>
              <dt className="flex items-center gap-2 text-fg-muted"><Badge tone="info" dot /> Right only (B)</dt>
              <dd className="text-right text-fg">{formatNumber(comparisonTotals.rightOnly)}</dd>
              <dt className="text-fg-muted">Different data</dt>
              <dd className="text-right text-fg">{formatBytes(comparisonTotals.differentDataBytes)}</dd>
              <dt className="text-fg-muted">Left only size</dt>
              <dd className="text-right text-fg">{formatBytes(comparisonTotals.leftOnlyBytes)}</dd>
              <dt className="text-fg-muted">Right only size</dt>
              <dd className="text-right text-fg">{formatBytes(comparisonTotals.rightOnlyBytes)}</dd>
            </dl>
          </Card>
          <Card title={`Location B — ${comparisonSummaryB.location}`}>
            <DonutChart data={comparisonFileTypesB} centerLabel="Total Size" centerValue={formatBytes(comparisonSummaryB.totalBytes)} size={120} />
            <div className="mt-2 text-[11.5px] text-fg-subtle">
              {formatNumber(comparisonSummaryB.files)} files · {formatNumber(comparisonSummaryB.folders)} folders
            </div>
          </Card>
        </div>
      )}

      {tab === "file-types" && (
        <div className="grid grid-cols-2 gap-3">
          <Card title="Location A file types">
            <DonutChart data={comparisonFileTypesA} centerLabel="Total Size" centerValue={formatBytes(comparisonSummaryA.totalBytes)} size={160} />
          </Card>
          <Card title="Location B file types">
            <DonutChart data={comparisonFileTypesB} centerLabel="Total Size" centerValue={formatBytes(comparisonSummaryB.totalBytes)} size={160} />
          </Card>
        </div>
      )}

      {tab === "size-differences" && (
        <Card title="Size Comparison by File Type">
          <BarChartPanel
            data={sizeComparisonByType}
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
            data={fileCountComparisonByType}
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
        <Card title="Comparison Filters">
          <div className="grid grid-cols-3 gap-3">
            {["Documents", "Images", "Videos", "Archives", "Executables", "Others"].map((c) => (
              <Checkbox key={c} checked onChange={() => toast.demo()} label={c} />
            ))}
          </div>
        </Card>
      )}

      <Card
        title="Detailed Comparison"
        padded={false}
        bodyClassName="h-[280px]"
        action={
          <div className="flex items-center gap-2">
            <DemoBadge label="Demo Comparison" />
            <Info size={13} className="text-fg-subtle" />
          </div>
        }
      >
        <DataTable
          columns={columns}
          rows={visibleRows}
          getRowId={(r) => r.id}
          selectedId={selectedRow?.id ?? null}
          onRowClick={setSelectedRow}
          emptyMessage={hasResults ? "No entries in this category." : "Run a comparison to see results."}
          className="h-full border-0 rounded-none"
        />
      </Card>

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
