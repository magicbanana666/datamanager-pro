import { useMemo, useState } from "react";
import clsx from "clsx";
import { File, Folder, ScanSearch, SlidersHorizontal } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/cards/Card";
import { LocationPicker } from "@/components/controls/LocationPicker";
import { Button } from "@/components/controls/Button";
import { Checkbox } from "@/components/controls/Checkbox";
import { Tabs } from "@/components/controls/Tabs";
import { ProgressBar } from "@/components/charts/ProgressBar";
import { DonutChart } from "@/components/charts/DonutChart";
import { BarChartPanel } from "@/components/charts/BarChartPanel";
import { Treemap } from "@/components/treemap/Treemap";
import { Breadcrumb } from "@/components/treemap/Breadcrumb";
import { DataTable, type DataTableColumn } from "@/components/tables/DataTable";
import { FolderDetailsCard } from "@/components/cards/FolderDetailsCard";
import { drives } from "@/mock/drives";
import { diskTree } from "@/mock/folderTree";
import { diskFileTypeStats, diskLargestFiles, diskTopFolders } from "@/mock/fileTypes";
import { diskExtensions, diskOwners, diskTimeline } from "@/mock/analysisExtra";
import { QUICK_FILTERS, filterChildren, withChildren, type QuickFilterId } from "@/utils/fsFilters";
import { flattenVisible } from "@/utils/fsTree";
import type { FsNode } from "@/models/common";
import { formatBytes, formatDate, formatNumber, formatPercent } from "@/utils/format";
import { useSimulatedProgress } from "@/hooks/useSimulatedProgress";
import { useUiStore } from "@/state/uiStore";
import { toast } from "@/state/toastStore";
import { chartColor } from "@/utils/colors";

const TABS = [
  { id: "treemap", label: "Treemap" },
  { id: "chart", label: "Chart" },
  { id: "file-types", label: "File Types" },
  { id: "top-files", label: "Top Files" },
  { id: "top-folders", label: "Top Folders" },
  { id: "timeline", label: "Timeline" },
  { id: "extensions", label: "Extensions" },
  { id: "users", label: "Users" },
];

const driveD = drives.find((d) => d.letter === "D:")!;

export function DiskAnalysisPage() {
  const [location, setLocation] = useState("D:\\Data");
  const [tab, setTab] = useState("treemap");
  const [quickFilter, setQuickFilter] = useState<QuickFilterId>("all");
  const [breadcrumb, setBreadcrumb] = useState<FsNode[]>([diskTree]);
  const [selectedNode, setSelectedNode] = useState<FsNode | null>(diskTree.children?.[0] ?? null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [options, setOptions] = useState({
    includeSubfolders: true,
    followJunctions: true,
    showFileTypes: true,
    scanInBackground: false,
  });
  const setStatusText = useUiStore((s) => s.setStatusText);

  const scan = useSimulatedProgress(() => {
    setStatusText("Ready");
    toast.success(`Scan completed - ${formatBytes(diskTree.size)} across ${formatNumber(diskTree.fileCount)} files.`);
  });

  const currentNode = breadcrumb[breadcrumb.length - 1];
  const filteredCurrentNode = useMemo(
    () => withChildren(currentNode, filterChildren(currentNode.children ?? [], quickFilter)),
    [currentNode, quickFilter],
  );

  const visibleRows = useMemo(() => flattenVisible(filteredCurrentNode, expandedIds), [filteredCurrentNode, expandedIds]);

  function drillInto(node: FsNode) {
    setBreadcrumb((b) => [...b, node]);
    setSelectedNode(node);
  }

  function navigateBreadcrumb(index: number) {
    setBreadcrumb((b) => b.slice(0, index + 1));
  }

  function startScan() {
    setStatusText(`Scanning ${location}...`);
    scan.start(3.5);
  }

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const columns: DataTableColumn<FsNode>[] = [
    {
      key: "name",
      header: "Name",
      width: 300,
      minWidth: 160,
      sortAccessor: (n) => n.name,
      render: (n) => {
        const row = visibleRows.find((r) => r.node.id === n.id);
        const depth = row?.depth ?? 0;
        const hasChildren = !!n.children && n.children.length > 0;
        return (
          <div className="flex min-w-0 items-center gap-1" style={{ paddingLeft: depth * 16 }}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (hasChildren) toggleExpand(n.id);
              }}
              className={clsx(
                "flex h-4 w-4 shrink-0 items-center justify-center text-fg-subtle",
                hasChildren ? "cursor-pointer hover:text-fg" : "invisible",
              )}
            >
              {expandedIds.has(n.id) ? "▾" : "▸"}
            </button>
            {n.kind === "file" ? (
              <File size={13} className="shrink-0 text-fg-subtle" />
            ) : (
              <Folder size={13} className="shrink-0 text-warning" />
            )}
            <span className="truncate">{n.name}</span>
          </div>
        );
      },
    },
    { key: "size", header: "Size", width: 100, align: "right", sortAccessor: (n) => n.size, render: (n) => formatBytes(n.size) },
    { key: "allocated", header: "Allocated", width: 100, align: "right", sortAccessor: (n) => n.allocated, render: (n) => formatBytes(n.allocated) },
    { key: "files", header: "Files", width: 90, align: "right", sortAccessor: (n) => n.fileCount, render: (n) => formatNumber(n.fileCount) },
    { key: "folders", header: "Folders", width: 90, align: "right", sortAccessor: (n) => n.folderCount, render: (n) => formatNumber(n.folderCount) },
    {
      key: "percent",
      header: "% of Parent",
      width: 150,
      sortAccessor: (n) => n.percentOfParent,
      render: (n) => (
        <div className="flex w-full items-center gap-2">
          <ProgressBar value={n.percentOfParent} className="flex-1" height={6} />
          <span className="w-9 shrink-0 text-right text-fg-muted">{formatPercent(n.percentOfParent, 1)}</span>
        </div>
      ),
    },
    { key: "modified", header: "Last Modified", width: 150, sortAccessor: (n) => n.lastModified, render: (n) => formatDate(n.lastModified) },
  ];

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <PageHeader title="Disk Analysis" description="Reproduce a WizTree / TreeSize style breakdown of an entire drive." />

      <div className="flex items-stretch gap-3">
        <Card title="Select Location" className="flex-1">
          <div className="flex flex-col gap-2.5">
            <LocationPicker value={location} onChange={setLocation} />
            <Button variant="primary" icon={ScanSearch} onClick={startScan} disabled={scan.status === "running"} className="self-start">
              {scan.status === "running" ? `Scanning... ${scan.progress.toFixed(0)}%` : "Scan"}
            </Button>
            {scan.status === "running" && <ProgressBar value={scan.progress} tone="accent" />}
          </div>
        </Card>

        <Card title="Scan Options" className="w-[230px] shrink-0">
          <div className="grid grid-cols-1 gap-2">
            <Checkbox checked={options.includeSubfolders} onChange={(v) => setOptions((o) => ({ ...o, includeSubfolders: v }))} label="Include subfolders" />
            <Checkbox checked={options.followJunctions} onChange={(v) => setOptions((o) => ({ ...o, followJunctions: v }))} label="Follow junctions" />
            <Checkbox checked={options.showFileTypes} onChange={(v) => setOptions((o) => ({ ...o, showFileTypes: v }))} label="Show file types" />
            <Checkbox checked={options.scanInBackground} onChange={(v) => setOptions((o) => ({ ...o, scanInBackground: v }))} label="Scan in background" />
          </div>
        </Card>

        <Card title="Quick Filters" className="w-[280px] shrink-0">
          <div className="flex flex-wrap gap-1.5">
            {QUICK_FILTERS.map((f) => (
              <button
                key={f.id}
                onClick={() => setQuickFilter(f.id)}
                className={clsx(
                  "rounded-md border px-2.5 py-1.5 text-[12px] font-medium transition-colors cursor-pointer",
                  quickFilter === f.id
                    ? "border-accent bg-accent text-fg-on-accent"
                    : "border-border-strong bg-surface-alt text-fg-muted hover:text-fg",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </Card>
      </div>

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      <div className="grid min-h-0 flex-1 grid-cols-[1fr_300px] gap-3">
        <Card padded={false} bodyClassName="p-3 flex flex-col gap-2 min-h-[360px]" className="min-h-0">
          {tab === "treemap" && (
            <>
              <Breadcrumb segments={breadcrumb.map((n) => ({ id: n.id, label: n.name }))} onNavigate={navigateBreadcrumb} />
              <Treemap node={filteredCurrentNode} selectedId={selectedNode?.id} onSelect={setSelectedNode} onDrillDown={drillInto} className="flex-1" />
            </>
          )}
          {tab === "chart" && (
            <BarChartPanel
              data={diskTopFolders.map((f) => ({ name: f.path.split("\\").pop(), size: f.size }))}
              categoryKey="name"
              series={[{ key: "size", label: "Size", color: "var(--color-chart-1)" }]}
              height={360}
            />
          )}
          {tab === "file-types" && (
            <div className="flex h-full items-center justify-center">
              <DonutChart data={diskFileTypeStats} centerLabel="Total Size" centerValue={formatBytes(diskTree.size)} size={220} />
            </div>
          )}
          {tab === "top-files" && (
            <div className="flex flex-col gap-1.5 overflow-y-auto">
              {diskLargestFiles.map((f, i) => (
                <div key={f.path} className="flex items-center gap-3 rounded-md border border-border bg-surface-alt px-3 py-2">
                  <span className="w-5 text-fg-subtle">#{i + 1}</span>
                  <File size={14} className="text-fg-subtle" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] text-fg">{f.name}</div>
                    <div className="truncate text-[11px] text-fg-subtle">{f.path}</div>
                  </div>
                  <span className="shrink-0 text-[12.5px] font-medium text-fg">{formatBytes(f.size)}</span>
                </div>
              ))}
            </div>
          )}
          {tab === "top-folders" && (
            <div className="flex flex-col gap-1.5 overflow-y-auto">
              {diskTopFolders.map((f, i) => (
                <div key={f.path} className="flex items-center gap-3 rounded-md border border-border bg-surface-alt px-3 py-2">
                  <span className="w-5 text-fg-subtle">#{i + 1}</span>
                  <Folder size={14} className="text-warning" />
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg">{f.path}</span>
                  <span className="shrink-0 text-[12.5px] font-medium text-fg">{formatBytes(f.size)}</span>
                </div>
              ))}
            </div>
          )}
          {tab === "timeline" && (
            <BarChartPanel
              data={diskTimeline}
              categoryKey="label"
              series={[{ key: "size", label: "Size modified", color: "var(--color-chart-5)" }]}
              height={360}
            />
          )}
          {tab === "extensions" && (
            <div className="overflow-y-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] font-semibold text-fg-muted">
                    <th className="py-2">Extension</th>
                    <th className="py-2 text-right">Files</th>
                    <th className="py-2 text-right">Size</th>
                    <th className="py-2 text-right">% of Total</th>
                  </tr>
                </thead>
                <tbody>
                  {diskExtensions.map((e, i) => (
                    <tr key={e.extension} className="border-b border-border/60">
                      <td className="flex items-center gap-2 py-2">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: chartColor(i) }} />
                        {e.extension}
                      </td>
                      <td className="py-2 text-right text-fg-muted">{formatNumber(e.files)}</td>
                      <td className="py-2 text-right text-fg-muted">{formatBytes(e.size)}</td>
                      <td className="py-2 text-right text-fg-muted">{formatPercent(e.percent)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {tab === "users" && (
            <div className="overflow-y-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] font-semibold text-fg-muted">
                    <th className="py-2">Owner</th>
                    <th className="py-2 text-right">Files</th>
                    <th className="py-2 text-right">Size</th>
                    <th className="py-2 text-right">%</th>
                  </tr>
                </thead>
                <tbody>
                  {diskOwners.map((o) => (
                    <tr key={o.user} className="border-b border-border/60">
                      <td className="py-2">{o.user}</td>
                      <td className="py-2 text-right text-fg-muted">{formatNumber(o.files)}</td>
                      <td className="py-2 text-right text-fg-muted">{formatBytes(o.size)}</td>
                      <td className="py-2 text-right text-fg-muted">{formatPercent(o.percent)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="flex flex-col gap-3 overflow-y-auto">
          <Card title="Drive Usage">
            <DonutChart data={diskFileTypeStats} centerLabel="Total Size" centerValue={formatBytes(diskTree.size)} size={130} />
          </Card>
          <Card title="Drive Information">
            <dl className="grid grid-cols-[80px_1fr] gap-y-1.5 text-[12.5px]">
              <dt className="text-fg-muted">Drive:</dt>
              <dd className="text-fg">{driveD.label} ({driveD.letter})</dd>
              <dt className="text-fg-muted">Total:</dt>
              <dd className="text-fg">{formatBytes(driveD.totalBytes)}</dd>
              <dt className="text-fg-muted">Used:</dt>
              <dd className="text-fg">{formatBytes(driveD.usedBytes)} ({formatPercent((driveD.usedBytes / driveD.totalBytes) * 100)})</dd>
              <dt className="text-fg-muted">Free:</dt>
              <dd className="text-fg">{formatBytes(driveD.freeBytes)}</dd>
            </dl>
            <ProgressBar value={(driveD.usedBytes / driveD.totalBytes) * 100} className="mt-2.5" />
          </Card>
          <Card title="Top File Types" bodyClassName="flex flex-col gap-1.5 p-3">
            {diskFileTypeStats.slice(0, 5).map((s, i) => (
              <div key={s.label} className="flex items-center justify-between text-[12px]">
                <span className="flex items-center gap-1.5 text-fg-muted">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: chartColor(i) }} />
                  {s.label}
                </span>
                <span className="text-fg">{formatBytes(s.value)}</span>
              </div>
            ))}
          </Card>
          <FolderDetailsCard node={selectedNode} />
        </div>
      </div>

      <Card title="Files & Folders" padded={false} bodyClassName="h-[230px]" action={<SlidersHorizontal size={13} className="text-fg-subtle" />}>
        <DataTable
          columns={columns}
          rows={visibleRows.map((r) => r.node)}
          getRowId={(n) => n.id}
          selectedId={selectedNode?.id}
          onRowClick={setSelectedNode}
          onRowDoubleClick={(n) => n.children && n.children.length > 0 && drillInto(n)}
          className="h-full border-0 rounded-none"
        />
      </Card>
    </div>
  );
}
