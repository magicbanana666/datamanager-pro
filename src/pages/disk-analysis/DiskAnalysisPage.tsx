import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { File, Folder, ScanSearch, SlidersHorizontal } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/cards/Card";
import { LocationPicker } from "@/components/controls/LocationPicker";
import { Button } from "@/components/controls/Button";
import { Checkbox } from "@/components/controls/Checkbox";
import { Tabs } from "@/components/controls/Tabs";
import { VolumeSelector } from "@/components/filesystem/VolumeSelector";
import { ProgressBar } from "@/components/charts/ProgressBar";
import { DonutChart } from "@/components/charts/DonutChart";
import { BarChartPanel } from "@/components/charts/BarChartPanel";
import { Treemap } from "@/components/treemap/Treemap";
import { Breadcrumb } from "@/components/treemap/Breadcrumb";
import { DataTable, type DataTableColumn } from "@/components/tables/DataTable";
import { FolderDetailsCard } from "@/components/cards/FolderDetailsCard";
import { OwnersTab } from "@/components/analysis/OwnersTab";
import { QUICK_FILTERS, filterChildren, withChildren, type QuickFilterId } from "@/utils/fsFilters";
import { EMPTY_SCAN_ROOT, flattenVisible, hasExpandableChildren } from "@/utils/fsTree";
import { useScanAnalysis } from "@/hooks/useScanAnalysis";
import type { FsNode } from "@/models/common";
import type { StorageVolume } from "@/models/backend";
import { scanOptionsFromSettings } from "@/state/settingsStore";
import { formatBytes, formatDate, formatNumber, formatPercent } from "@/utils/format";
import { useScanNotifications } from "@/hooks/useScanNotifications";
import { useFilesystemStore } from "@/state/filesystemStore";
import { toAppError } from "@/api/backend";
import { useScanStore } from "@/state/scanStore";
import { toast } from "@/state/toastStore";
import { useUiStore } from "@/state/uiStore";
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

export function DiskAnalysisPage() {
  const { volumes, volumesLoading, volumesError, loadVolumes } = useFilesystemStore();
  const [selectedVolume, setSelectedVolume] = useState<StorageVolume | null>(null);
  // Follows the active/last scan, so navigating away mid-scan and back
  // doesn't reset this to the default while a different path is scanning.
  const [location, setLocation] = useState(() => useScanStore.getState().path ?? "");
  const [tab, setTab] = useState("treemap");
  const [quickFilter, setQuickFilter] = useState<QuickFilterId>("all");
  // A real scan's result is global (`useScanStore`) and can already
  // exist when this page first mounts (e.g. navigating back after
  // scanning) - the lazy initializer reads the store directly
  // (`.getState()`, not the hook) so the very first render starts on
  // the real root instead of briefly showing the empty pre-scan root. See the render-time sync below for the case where
  // a scan completes *while* this page is already mounted.
  const [breadcrumb, setBreadcrumb] = useState<FsNode[]>(() => [useScanStore.getState().result?.root ?? EMPTY_SCAN_ROOT]);
  const [selectedNode, setSelectedNode] = useState<FsNode | null>(() => {
    const root = useScanStore.getState().result?.root ?? EMPTY_SCAN_ROOT;
    return root.children?.[0] ?? null;
  });
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [options, setOptions] = useState({
    includeSubfolders: true,
    followJunctions: true,
    showFileTypes: true,
    scanInBackground: false,
  });
  const setStatusText = useUiStore((s) => s.setStatusText);
  const realScan = useScanStore();
  useScanNotifications();

  useEffect(() => {
    void loadVolumes();
    // Volumes only need to be enumerated once when the page mounts;
    // the Refresh button in VolumeSelector handles re-enumeration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A completed real scan replaces what the treemap/table are looking
  // at - reset to its root rather than leaving the view on whatever
  // mock/previous node was selected. Done inline during render (React's
  // documented "adjusting state when a prop changes" pattern) rather
  // than in a useEffect, so it takes effect in the same render instead
  // of triggering an extra cascading one.
  const [lastSeenResult, setLastSeenResult] = useState(realScan.result);
  if (realScan.result !== lastSeenResult) {
    setLastSeenResult(realScan.result);
    if (realScan.result) {
      const root = realScan.result.root;
      setBreadcrumb([root]);
      setSelectedNode(root.children?.[0] ?? root);
      setExpandedIds(new Set());
    }
  }

  // Derived rather than effect-driven: once volumes load, fall back to
  // the first fixed volume for display without needing a setState pass.
  // Explicitly picking a volume (below) still updates real state, since
  // that's a genuine user action tied to the location field.
  const displayVolume = selectedVolume ?? volumes.find((v) => v.volumeType === "fixed") ?? volumes[0] ?? null;

  function selectVolume(volume: StorageVolume) {
    setSelectedVolume(volume);
    setLocation(volume.mountPoint);
  }

  // True once a real scan has completed - the treemap/table already
  // work off `currentNode` generically, so the only thing this gates
  // is whether the analysis comes from the backend. Before any scan
  // the page shows the empty root's empty states.
  const isReal = realScan.status === "completed" && !!realScan.result;

  const currentNode = breadcrumb[breadcrumb.length - 1];
  const filteredCurrentNode = useMemo(
    () => withChildren(currentNode, filterChildren(currentNode.children ?? [], quickFilter)),
    [currentNode, quickFilter],
  );

  const visibleRows = useMemo(() => flattenVisible(filteredCurrentNode, expandedIds), [filteredCurrentNode, expandedIds]);
  // O(1) per-row depth lookup for the Name column - a linear `find`
  // per row made rendering a wide expanded folder quadratic.
  const depthById = useMemo(() => new Map(visibleRows.map((r) => [r.node.id, r.depth])), [visibleRows]);

  // Scoped to the current breadcrumb position, not always the whole
  // scan root - drilling into a subfolder re-scopes File Types/Top
  // Files/Top Folders/Timeline/Extensions to it, same as a real
  // WizTree/TreeSize-style tool. Only recomputed on navigation.
  const analysis = useScanAnalysis(currentNode, isReal ? realScan.scanId : null);
  const categoryStats = analysis.categoryStats;
  const topFilesData = analysis.topFiles;
  const topFoldersData = analysis.topFolders;
  const extensionData = analysis.extensionStats;
  const timelineData = analysis.timeline;

  // A real scan's tree arrives depth-truncated, so a folder may need
  // its children fetched first (see `needsChildren`) - a no-op for
  // the empty pre-scan root and already-loaded folders.
  function drillInto(node: FsNode) {
    realScan
      .loadChildren(node)
      .then((loaded) => {
        if (!loaded.children?.length) return;
        setBreadcrumb((b) => [...b, loaded]);
        setSelectedNode(loaded);
      })
      .catch((err) => toast.danger(toAppError(err).message));
  }

  function navigateBreadcrumb(index: number) {
    setBreadcrumb((b) => b.slice(0, index + 1));
  }

  function startScan() {
    setStatusText(`Scanning ${location}...`);
    void realScan.start(location, scanOptionsFromSettings());
  }

  function toggleExpand(node: FsNode) {
    realScan
      .loadChildren(node)
      .then(() =>
        setExpandedIds((prev) => {
          const next = new Set(prev);
          if (next.has(node.id)) next.delete(node.id);
          else next.add(node.id);
          return next;
        }),
      )
      .catch((err) => toast.danger(toAppError(err).message));
  }

  const columns: DataTableColumn<FsNode>[] = [
    {
      key: "name",
      header: "Name",
      width: 300,
      minWidth: 160,
      sortAccessor: (n) => n.name,
      render: (n) => {
        const depth = depthById.get(n.id) ?? 0;
        const hasChildren = hasExpandableChildren(n);
        return (
          <div className="flex min-w-0 items-center gap-1" style={{ paddingLeft: depth * 16 }}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (hasChildren) toggleExpand(n);
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
    { key: "modified", header: "Last Modified", width: 150, sortAccessor: (n) => n.lastModified ?? "", render: (n) => formatDate(n.lastModified) },
  ];

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <PageHeader title="Disk Analysis" description="Reproduce a WizTree / TreeSize style breakdown of an entire drive." />

      <Card>
        <VolumeSelector
          volumes={volumes}
          loading={volumesLoading}
          error={volumesError}
          selectedMountPoint={displayVolume?.mountPoint ?? null}
          onSelect={selectVolume}
          onRefresh={() => loadVolumes(true)}
        />
      </Card>

      <div className="flex items-stretch gap-3">
        <Card title="Select Location" className="flex-1">
          <div className="flex flex-col gap-2.5">
            <LocationPicker value={location} onChange={setLocation} />
            {/* Kept to exactly two rows (LocationPicker + this one, plus
                the progress bar only while actively scanning) regardless
                of scan state - folding the completed summary in here
                rather than a separate paragraph avoids regrowing this
                card's height and squeezing the treemap row below it
                (see PHASE2.md's identical layout-overflow note). */}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                icon={ScanSearch}
                onClick={startScan}
                disabled={realScan.status === "scanning"}
                className="self-start"
              >
                {realScan.status === "scanning"
                  ? `Scanning... ${formatNumber(realScan.progress?.scannedFiles ?? 0)} files`
                  : "Scan"}
              </Button>
              {realScan.status === "scanning" && (
                <Button variant="secondary" onClick={() => void realScan.cancel()} className="self-start">
                  Cancel
                </Button>
              )}
              {realScan.status === "completed" && realScan.result && (
                <span className="text-[11.5px] text-fg-muted">
                  {formatBytes(realScan.result.root.size)} · {formatNumber(realScan.result.root.fileCount)} files ·{" "}
                  {formatNumber(realScan.result.root.folderCount)} folders
                </span>
              )}
            </div>
            {realScan.status === "scanning" && <ProgressBar indeterminate tone="accent" />}
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

      <div className="flex items-center justify-between gap-3">
        <Tabs tabs={TABS} active={tab} onChange={setTab} className="min-w-0 flex-1" />
        {/* "Users" has no real backend (no owner lookup - see PHASE2.md) so it stays badged regardless. */}
      </div>

      {/* auto-rows-fr: keeps this grid's one implicit row stretched to the
          available height (rather than shrink-to-content) - belt-and-
          suspenders alongside the real fix below (Files & Folders'
          `flex-none`), which is what actually mattered: without it, a
          sibling `Card` with a fixed `bodyClassName="h-[…px]"` loses that
          height to `Card`'s own default `flex-1` (flex-basis:0% beats an
          explicit `height` in flexbox), so the table grows to fit every
          real row instead of scrolling within its box - starving this
          flex-1 grid (and the Treemap's ResizeObserver-measured height)
          down to 0 once real data had enough rows for it to show. See
          PHASE4.md. */}
      <div className="grid min-h-0 flex-1 auto-rows-fr grid-cols-[1fr_300px] gap-3">
        <Card padded={false} bodyClassName="p-3 flex flex-col gap-2 min-h-0 overflow-y-auto" className="min-h-0">
          {tab === "treemap" && (
            <>
              <Breadcrumb segments={breadcrumb.map((n) => ({ id: n.id, label: n.name }))} onNavigate={navigateBreadcrumb} />
              <Treemap node={filteredCurrentNode} selectedId={selectedNode?.id} onSelect={setSelectedNode} onDrillDown={drillInto} canDrillDown={hasExpandableChildren} className="flex-1" />
            </>
          )}
          {tab === "chart" && (
            <BarChartPanel
              data={topFoldersData.map((f) => ({ name: f.path.split("\\").pop(), size: f.size }))}
              categoryKey="name"
              series={[{ key: "size", label: "Size", color: "var(--color-chart-1)" }]}
              height={360}
            />
          )}
          {tab === "file-types" && (
            <div className="flex h-full items-center justify-center">
              <DonutChart data={categoryStats} centerLabel="Total Size" centerValue={formatBytes(currentNode.size)} size={180} />
            </div>
          )}
          {tab === "top-files" && (
            <div className="flex flex-col gap-1.5 overflow-y-auto">
              {topFilesData.map((f, i) => (
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
              {topFoldersData.map((f, i) => (
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
              data={timelineData}
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
                    <th className="px-3 py-2">Extension</th>
                    <th className="px-3 py-2 text-right">Files</th>
                    <th className="px-3 py-2 text-right">Size</th>
                    <th className="px-3 py-2 text-right">% of Total</th>
                  </tr>
                </thead>
                <tbody>
                  {extensionData.map((e, i) => (
                    <tr key={e.extension} className="border-b border-border/60">
                      <td className="flex items-center gap-2 px-3 py-2">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: chartColor(i) }} />
                        {e.extension}
                      </td>
                      <td className="px-3 py-2 text-right text-fg-muted">{formatNumber(e.files)}</td>
                      <td className="px-3 py-2 text-right text-fg-muted">{formatBytes(e.size)}</td>
                      <td className="px-3 py-2 text-right text-fg-muted">{formatPercent(e.percent)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {tab === "users" && <OwnersTab scanId={isReal ? realScan.scanId : null} node={currentNode} />}
        </Card>

        <div className="flex min-w-0 flex-col gap-3 overflow-y-auto">
          <Card title="Drive Usage">
            <DonutChart data={categoryStats} centerLabel="Total Size" centerValue={formatBytes(currentNode.size)} size={130} />
          </Card>
          <Card title="Drive Information">
            {displayVolume ? (
              <>
                <dl className="grid grid-cols-[80px_1fr] gap-y-1.5 text-[12.5px]">
                  <dt className="text-fg-muted">Drive:</dt>
                  <dd className="text-fg">{displayVolume.name}</dd>
                  <dt className="text-fg-muted">File system:</dt>
                  <dd className="text-fg">{displayVolume.fileSystem ?? "Unknown"}</dd>
                  <dt className="text-fg-muted">Total:</dt>
                  <dd className="text-fg">{formatBytes(displayVolume.totalBytes)}</dd>
                  <dt className="text-fg-muted">Used:</dt>
                  <dd className="text-fg">
                    {formatBytes(displayVolume.usedBytes)} ({formatPercent(displayVolume.usagePercent)})
                  </dd>
                  <dt className="text-fg-muted">Free:</dt>
                  <dd className="text-fg">{formatBytes(displayVolume.freeBytes)}</dd>
                </dl>
                <ProgressBar value={displayVolume.usagePercent} className="mt-2.5" />
              </>
            ) : (
              <p className="text-xs text-fg-subtle">
                {volumesLoading ? "Enumerating storage volumes..." : "Select a volume above to see its real capacity."}
              </p>
            )}
          </Card>
          <Card title="Top File Types" bodyClassName="flex flex-col gap-1.5 p-3">
            {categoryStats.slice(0, 5).map((s, i) => (
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

      <Card
        title="Files & Folders"
        padded={false}
        // flex-none: cancels Card's default flex-1 (flex-basis:0%), which
        // otherwise beats this fixed height in a flex-col layout - see the
        // comment above the treemap/sidebar grid.
        bodyClassName="h-[230px] flex-none"
        action={
          <div className="flex items-center gap-2">
            <SlidersHorizontal size={13} className="text-fg-subtle" />
          </div>
        }
      >
        <DataTable
          columns={columns}
          rows={visibleRows.map((r) => r.node)}
          getRowId={(n) => n.id}
          selectedId={selectedNode?.id}
          onRowClick={setSelectedNode}
          onRowDoubleClick={(n) => hasExpandableChildren(n) && drillInto(n)}
          className="h-full border-0 rounded-none"
        />
      </Card>
    </div>
  );
}
