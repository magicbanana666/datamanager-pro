import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, File, Folder, Loader2, ScanSearch } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/cards/Card";
import { LocationPicker } from "@/components/controls/LocationPicker";
import { Button } from "@/components/controls/Button";
import { Checkbox } from "@/components/controls/Checkbox";
import { Tabs } from "@/components/controls/Tabs";
import { DemoBadge } from "@/components/controls/DemoBadge";
import { PathBreadcrumb } from "@/components/filesystem/PathBreadcrumb";
import { DirectoryTree } from "@/components/filesystem/DirectoryTree";
import { ProgressBar } from "@/components/charts/ProgressBar";
import { DonutChart } from "@/components/charts/DonutChart";
import { BarChartPanel } from "@/components/charts/BarChartPanel";
import { Treemap } from "@/components/treemap/Treemap";
import { Breadcrumb } from "@/components/treemap/Breadcrumb";
import { DataTable, type DataTableColumn } from "@/components/tables/DataTable";
import { FolderDetailsCard } from "@/components/cards/FolderDetailsCard";
import { projectsFolderTree } from "@/mock/folderTree";
import { folderFileTypeStats, folderLargestFiles, folderSizeDistribution } from "@/mock/fileTypes";
import { diskTimeline } from "@/mock/analysisExtra";
import { duplicateGroups } from "@/mock/duplicates";
import { flattenVisible } from "@/utils/fsTree";
import type { FsNode } from "@/models/common";
import { formatBytes, formatDate, formatNumber, formatPercent } from "@/utils/format";
import { useSimulatedProgress } from "@/hooks/useSimulatedProgress";
import { useFilesystemStore } from "@/state/filesystemStore";
import { useUiStore } from "@/state/uiStore";
import { toast } from "@/state/toastStore";

const TABS = [
  { id: "treemap", label: "Treemap" },
  { id: "chart", label: "Chart" },
  { id: "file-types", label: "File Types" },
  { id: "top-files", label: "Top Files" },
  { id: "top-folders", label: "Top Folders" },
  { id: "timeline", label: "Timeline" },
  { id: "duplicates", label: "Duplicates" },
];

export function FolderAnalysisPage() {
  const navigate = useNavigate();
  const [location, setLocation] = useState("D:\\Data\\Projects");
  const [tab, setTab] = useState("treemap");
  const [breadcrumb, setBreadcrumb] = useState<FsNode[]>([projectsFolderTree]);
  const [selectedNode, setSelectedNode] = useState<FsNode | null>(projectsFolderTree.children?.[0] ?? null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [options, setOptions] = useState({
    includeSubfolders: true,
    followJunctions: true,
    showHiddenFiles: false,
    calculateFolderSizes: true,
    fastScan: true,
  });
  const setStatusText = useUiStore((s) => s.setStatusText);
  const { currentPath, directorySummary, loading: browsing, error: browseError, browse } = useFilesystemStore();

  useEffect(() => {
    void browse(location);
    // Only re-browse when the page first mounts or the user explicitly
    // browses/scans a new location - not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scan = useSimulatedProgress(() => {
    setStatusText("Ready");
    toast.success(`Scan completed - ${formatBytes(projectsFolderTree.size)} across ${formatNumber(projectsFolderTree.fileCount)} files.`);
  });

  const currentNode = breadcrumb[breadcrumb.length - 1];
  const visibleRows = useMemo(() => flattenVisible(currentNode, expandedIds), [currentNode, expandedIds]);

  function drillInto(node: FsNode) {
    setBreadcrumb((b) => [...b, node]);
    setSelectedNode(node);
  }

  function navigateBreadcrumb(index: number) {
    setBreadcrumb((b) => b.slice(0, index + 1));
  }

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function startScan() {
    setStatusText(`Scanning ${location}...`);
    scan.start(3);
    void browse(location);
  }

  const columns: DataTableColumn<FsNode>[] = [
    {
      key: "name",
      header: "Name",
      width: 320,
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
            {n.kind === "file" ? <File size={13} className="shrink-0 text-fg-subtle" /> : <Folder size={13} className="shrink-0 text-warning" />}
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
      <PageHeader title="Folder Analysis" description="Drill into a single folder to see exactly what's using space inside it." />

      <div className="flex items-stretch gap-3">
        <Card title="Select Folder" className="flex-1">
          <div className="flex flex-col gap-2.5">
            <LocationPicker value={location} onChange={setLocation} />
            <Button variant="primary" icon={ScanSearch} onClick={startScan} disabled={scan.status === "running"} className="self-start">
              {scan.status === "running" ? `Scanning... ${scan.progress.toFixed(0)}%` : "Scan"}
            </Button>
            {scan.status === "running" && <ProgressBar value={scan.progress} tone="accent" />}

            <div className="mt-1 flex flex-col gap-1.5 border-t border-border pt-2">
              <PathBreadcrumb
                path={currentPath ?? location}
                onNavigate={(p) => {
                  setLocation(p);
                  void browse(p);
                }}
              />
              {browsing && (
                <div className="flex items-center gap-2 text-[12px] text-fg-subtle">
                  <Loader2 size={13} className="animate-spin" /> Reading folder...
                </div>
              )}
              {browseError && (
                <div className="flex items-center gap-2 text-[12px] text-danger">
                  <AlertTriangle size={13} /> {browseError.message}
                </div>
              )}
              {!browsing && !browseError && directorySummary && (
                <div className="flex flex-wrap gap-4 text-[12.5px] text-fg-muted">
                  <span>
                    Direct files: <span className="font-medium text-fg">{formatNumber(directorySummary.directFileCount)}</span>
                  </span>
                  <span>
                    Direct folders: <span className="font-medium text-fg">{formatNumber(directorySummary.directFolderCount)}</span>
                  </span>
                  <span>
                    Direct size: <span className="font-medium text-fg">{formatBytes(directorySummary.directFileBytes)}</span>
                  </span>
                  {directorySummary.lastModified && (
                    <span>
                      Modified: <span className="font-medium text-fg">{formatDate(directorySummary.lastModified)}</span>
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </Card>

        <Card title="Scan Options" className="w-[260px] shrink-0">
          <div className="grid grid-cols-1 gap-2">
            <Checkbox checked={options.includeSubfolders} onChange={(v) => setOptions((o) => ({ ...o, includeSubfolders: v }))} label="Include subfolders" />
            <Checkbox checked={options.followJunctions} onChange={(v) => setOptions((o) => ({ ...o, followJunctions: v }))} label="Follow junctions" />
            <Checkbox checked={options.showHiddenFiles} onChange={(v) => setOptions((o) => ({ ...o, showHiddenFiles: v }))} label="Show hidden files" />
            <Checkbox checked={options.calculateFolderSizes} onChange={(v) => setOptions((o) => ({ ...o, calculateFolderSizes: v }))} label="Calculate folder sizes" />
            <Checkbox checked={options.fastScan} onChange={(v) => setOptions((o) => ({ ...o, fastScan: v }))} label="Fast scan (recommended)" />
          </div>
        </Card>
      </div>

      <div className="flex items-center justify-between gap-3">
        <Tabs tabs={TABS} active={tab} onChange={setTab} className="min-w-0 flex-1" />
        <DemoBadge />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[1fr_300px] gap-3">
        <Card padded={false} bodyClassName="p-3 flex flex-col gap-2 min-h-0 overflow-y-auto" className="min-h-0">
          {tab === "treemap" && (
            <>
              <Breadcrumb segments={breadcrumb.map((n) => ({ id: n.id, label: n.name }))} onNavigate={navigateBreadcrumb} />
              <Treemap node={currentNode} selectedId={selectedNode?.id} onSelect={setSelectedNode} onDrillDown={drillInto} className="flex-1" />
            </>
          )}
          {tab === "chart" && (
            <BarChartPanel
              data={(currentNode.children ?? []).map((c) => ({ name: c.name, size: c.size }))}
              categoryKey="name"
              series={[{ key: "size", label: "Size", color: "var(--color-chart-3)" }]}
              height={360}
            />
          )}
          {tab === "file-types" && (
            <div className="flex h-full items-center justify-center">
              <DonutChart data={folderFileTypeStats} centerLabel="Selected Folder" centerValue={formatBytes(currentNode.size)} size={180} />
            </div>
          )}
          {tab === "top-files" && (
            <div className="flex flex-col gap-1.5 overflow-y-auto">
              {folderLargestFiles.map((f, i) => (
                <div key={f.name + i} className="flex items-center gap-3 rounded-md border border-border bg-surface-alt px-3 py-2">
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
              {[...(currentNode.children ?? [])]
                .sort((a, b) => b.size - a.size)
                .map((f, i) => (
                  <div key={f.id} className="flex items-center gap-3 rounded-md border border-border bg-surface-alt px-3 py-2">
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
          {tab === "duplicates" && (
            <div className="flex flex-col gap-2.5 overflow-y-auto">
              <p className="text-xs text-fg-muted">Duplicate files detected within this folder (sample):</p>
              {duplicateGroups.slice(0, 3).map((g) => (
                <div key={g.id} className="rounded-md border border-border bg-surface-alt px-3 py-2">
                  <div className="flex items-center justify-between text-[12.5px] font-medium text-fg">
                    <span>{g.label}</span>
                    <span className="text-fg-muted">{g.files.length} copies · {formatBytes(g.size)}</span>
                  </div>
                </div>
              ))}
              <Button className="self-start" onClick={() => navigate("/duplicate-finder")}>
                Open in Duplicate Finder
              </Button>
            </div>
          )}
        </Card>

        <div className="flex min-w-0 flex-col gap-3 overflow-y-auto">
          <Card title="Browse (Real)" padded={false} bodyClassName="h-[160px] p-2">
            <DirectoryTree
              rootPath={currentPath ?? location}
              selectedPath={currentPath}
              onSelect={(p) => {
                setLocation(p);
                void browse(p);
              }}
              className="h-full"
            />
          </Card>
          <FolderDetailsCard node={selectedNode ?? currentNode} />
          <Card title="Size Distribution" action={<DemoBadge />}>
            <DonutChart data={folderSizeDistribution} centerLabel="Distribution" centerValue={formatBytes(currentNode.size)} size={120} />
          </Card>
          <Card title="File Types (in selected folder)" bodyClassName="flex flex-col gap-1.5 p-3" action={<DemoBadge />}>
            {folderFileTypeStats.map((s) => (
              <div key={s.label} className="flex items-center justify-between text-[12px]">
                <span className="text-fg-muted">{s.label}</span>
                <span className="text-fg">{formatBytes(s.value)} ({formatPercent(s.percent)})</span>
              </div>
            ))}
          </Card>
          <Card title="Top 10 Largest Files" bodyClassName="flex flex-col gap-1 p-3" action={<DemoBadge />}>
            {folderLargestFiles.slice(0, 10).map((f, i) => (
              <div key={f.name + i} className="flex items-center justify-between gap-2 text-[12px]">
                <span className="min-w-0 flex-1 truncate text-fg-muted">
                  {i + 1}. {f.name}
                </span>
                <span className="shrink-0 text-fg">{formatBytes(f.size)}</span>
              </div>
            ))}
          </Card>
        </div>
      </div>

      <Card title="Files & Folders" padded={false} bodyClassName="h-[220px]" action={<DemoBadge />}>
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
