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
import { PathBreadcrumb } from "@/components/filesystem/PathBreadcrumb";
import { DirectoryTree } from "@/components/filesystem/DirectoryTree";
import { ProgressBar } from "@/components/charts/ProgressBar";
import { DonutChart } from "@/components/charts/DonutChart";
import { BarChartPanel } from "@/components/charts/BarChartPanel";
import { Treemap } from "@/components/treemap/Treemap";
import { Breadcrumb } from "@/components/treemap/Breadcrumb";
import { DataTable, type DataTableColumn } from "@/components/tables/DataTable";
import { FolderDetailsCard } from "@/components/cards/FolderDetailsCard";
import { EMPTY_SCAN_ROOT, flattenVisible, hasExpandableChildren } from "@/utils/fsTree";
import { topChildrenWithOthers } from "@/utils/scanAnalysis";
import { useScanAnalysis } from "@/hooks/useScanAnalysis";
import type { FsNode } from "@/models/common";
import { scanOptionsFromSettings } from "@/state/settingsStore";
import { formatBytes, formatDate, formatNumber, formatPercent } from "@/utils/format";
import { useScanNotifications } from "@/hooks/useScanNotifications";
import { useFilesystemStore } from "@/state/filesystemStore";
import { toAppError } from "@/api/backend";
import { useScanStore } from "@/state/scanStore";
import { useDuplicateStore } from "@/state/duplicateStore";
import { toast } from "@/state/toastStore";
import { useUiStore } from "@/state/uiStore";

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
  // Follows the active/last scan, so navigating away mid-scan and back
  // doesn't reset this to the default while a different path is scanning.
  const [location, setLocation] = useState(() => useScanStore.getState().path ?? "D:\\Data\\Projects");
  const [tab, setTab] = useState("treemap");
  // A real scan's result is global (`useScanStore`) and can already
  // exist when this page first mounts (e.g. navigating back after
  // scanning) - the lazy initializer reads the store directly
  // (`.getState()`, not the hook) so the very first render starts on
  // the real root instead of briefly showing the empty pre-scan root.
  // See the render-time sync below for the case where a scan completes
  // *while* this page is already mounted.
  const [breadcrumb, setBreadcrumb] = useState<FsNode[]>(() => [
    useScanStore.getState().result?.root ?? EMPTY_SCAN_ROOT,
  ]);
  const [selectedNode, setSelectedNode] = useState<FsNode | null>(() => {
    const root = useScanStore.getState().result?.root ?? EMPTY_SCAN_ROOT;
    return root.children?.[0] ?? null;
  });
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
  const realScan = useScanStore();
  useScanNotifications();

  useEffect(() => {
    void browse(location);
    // Only re-browse when the page first mounts or the user explicitly
    // browses/scans a new location - not on every keystroke.
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

  // True once a real scan has completed - the treemap/table already
  // work off `currentNode` generically, so the only thing this gates
  // is whether the analysis comes from the backend. Before any scan
  // the page shows the empty root's empty states.
  const isReal = realScan.status === "completed" && !!realScan.result;

  const currentNode = breadcrumb[breadcrumb.length - 1];

  // The Duplicates tab runs the real duplicate finder on the folder in
  // view (the global run, so the Duplicate Finder page shows the same
  // result) and only shows it while that run covers exactly this folder.
  const dupRun = useDuplicateStore();
  const dupForThisFolder =
    isReal &&
    dupRun.args?.[0].length === 1 &&
    dupRun.args[0][0].toLowerCase() === currentNode.path.toLowerCase();
  const dupResult = dupForThisFolder && dupRun.status === "completed" ? dupRun.result : null;
  function findDuplicatesHere() {
    void dupRun.start([currentNode.path], {
      criteria: "exact",
      ignoreCase: true,
      ignoreHidden: true,
      ignoreSystem: true,
      minSize: 0,
      maxSize: null,
    });
  }
  const visibleRows = useMemo(() => flattenVisible(currentNode, expandedIds), [currentNode, expandedIds]);
  // O(1) per-row depth lookup for the Name column - a linear `find`
  // per row made rendering a wide expanded folder quadratic.
  const depthById = useMemo(() => new Map(visibleRows.map((r) => [r.node.id, r.depth])), [visibleRows]);

  // Scoped to the current breadcrumb position - drilling into a
  // subfolder re-scopes File Types/Top Files/Top Folders/Timeline to
  // it. Only recomputed on navigation.
  const analysis = useScanAnalysis(currentNode, isReal ? realScan.scanId : null);
  const topFilesData = analysis.topFiles;
  const topFoldersData = analysis.topFolders;
  const fileTypeStats = analysis.categoryStats;
  const timelineData = analysis.timeline;
  const sizeDistribution = topChildrenWithOthers(currentNode.children ?? [], 3);

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

  function startScan() {
    setStatusText(`Scanning ${location}...`);
    void realScan.start(location, scanOptionsFromSettings());
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
    { key: "modified", header: "Last Modified", width: 150, sortAccessor: (n) => n.lastModified ?? "", render: (n) => formatDate(n.lastModified) },
  ];

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <PageHeader title="Folder Analysis" description="Drill into a single folder to see exactly what's using space inside it." />

      <div className="flex items-stretch gap-3">
        <Card title="Select Folder" className="flex-1">
          <div className="flex flex-col gap-2.5">
            <LocationPicker value={location} onChange={setLocation} />
            {/* Kept to exactly two rows (LocationPicker + this one, plus
                the progress bar only while actively scanning) regardless
                of scan state - folding the completed summary in here
                rather than a separate paragraph avoids regrowing this
                already-crowded card's height and squeezing the treemap
                row below it (see PHASE2.md's identical layout-overflow
                note about this exact card). */}
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
      </div>

      {/* auto-rows-fr: see the identical comment in DiskAnalysisPage.tsx -
          same shared layout bug, same fix. */}
      <div className="grid min-h-0 flex-1 auto-rows-fr grid-cols-[1fr_300px] gap-3">
        <Card padded={false} bodyClassName="p-3 flex flex-col gap-2 min-h-0 overflow-y-auto" className="min-h-0">
          {tab === "treemap" && (
            <>
              <Breadcrumb segments={breadcrumb.map((n) => ({ id: n.id, label: n.name }))} onNavigate={navigateBreadcrumb} />
              <Treemap node={currentNode} selectedId={selectedNode?.id} onSelect={setSelectedNode} onDrillDown={drillInto} canDrillDown={hasExpandableChildren} className="flex-1" />
            </>
          )}
          {tab === "chart" && (
            <BarChartPanel
              data={topFoldersData.map((f) => ({ name: f.path.split("\\").pop(), size: f.size }))}
              categoryKey="name"
              series={[{ key: "size", label: "Size", color: "var(--color-chart-3)" }]}
              height={360}
            />
          )}
          {tab === "file-types" && (
            <div className="flex h-full items-center justify-center">
              <DonutChart data={fileTypeStats} centerLabel="Selected Folder" centerValue={formatBytes(currentNode.size)} size={180} />
            </div>
          )}
          {tab === "top-files" && (
            <div className="flex flex-col gap-1.5 overflow-y-auto">
              {topFilesData.map((f, i) => (
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
          {tab === "duplicates" && (
            <div className="flex flex-col gap-2.5 overflow-y-auto">
              {dupResult ? (
                <>
                  <p className="text-xs text-fg-muted">
                    {dupResult.totalGroups === 0
                      ? `No duplicates among ${formatNumber(dupResult.filesCompared)} files in this folder.`
                      : `${formatNumber(dupResult.totalGroups)} groups of identical files in this folder - ${formatBytes(dupResult.totalWastedBytes)} recoverable. Largest:`}
                  </p>
                  {dupResult.groups.slice(0, 10).map((g) => (
                    <div key={g.key} className="rounded-md border border-border bg-surface-alt px-3 py-2">
                      <div className="flex items-center justify-between gap-3 text-[12.5px] font-medium text-fg">
                        <span className="truncate">{g.files[0]?.name}</span>
                        <span className="shrink-0 text-fg-muted">
                          {g.files.length} copies · {formatBytes(g.files[0]?.size ?? 0)} · {formatBytes(g.wastedBytes)} recoverable
                        </span>
                      </div>
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <Button onClick={() => navigate("/duplicate-finder")}>Open in Duplicate Finder</Button>
                    <Button onClick={findDuplicatesHere}>Search again</Button>
                  </div>
                </>
              ) : isReal ? (
                dupForThisFolder && dupRun.status === "running" ? (
                  <div className="flex items-center gap-2 text-[12.5px] text-fg-muted">
                    <Loader2 size={14} className="animate-spin" />
                    {dupRun.progress?.phase === "hashing" || dupRun.progress?.phase === "comparing"
                      ? `Comparing contents... ${formatBytes(dupRun.progress.bytesHashed)} / ${formatBytes(dupRun.progress.bytesToHash)}`
                      : `Listing files... ${formatNumber(dupRun.progress?.filesFound ?? 0)}`}
                    <Button size="sm" onClick={() => void dupRun.cancel()}>Cancel</Button>
                  </div>
                ) : (
                  <>
                    <p className="text-xs text-fg-muted">Find files with identical content in {currentNode.path}.</p>
                    <Button variant="primary" icon={ScanSearch} className="self-start" onClick={findDuplicatesHere} disabled={dupRun.status === "running"}>
                      Find duplicates in this folder
                    </Button>
                    {dupRun.status === "running" && <p className="text-xs text-fg-muted">Another duplicate scan is running.</p>}
                  </>
                )
              ) : (
                <p className="text-xs text-fg-subtle">Scan a folder first, then find the duplicates in it here.</p>
              )}
            </div>
          )}
        </Card>

        <div className="flex min-w-0 flex-col gap-3 overflow-y-auto">
          {/* flex-none: cancels Card's default flex-1 (flex-basis:0%),
              which otherwise beats this fixed height in a flex-col layout
              - see the comment above the treemap/sidebar grid. */}
          <Card title="Browse (Real)" padded={false} bodyClassName="h-[160px] p-2 flex-none">
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
          <Card title="Size Distribution">
            <DonutChart data={sizeDistribution} centerLabel="Distribution" centerValue={formatBytes(currentNode.size)} size={120} />
          </Card>
          <Card title="File Types (in selected folder)" bodyClassName="flex flex-col gap-1.5 p-3">
            {fileTypeStats.map((s) => (
              <div key={s.label} className="flex items-center justify-between text-[12px]">
                <span className="text-fg-muted">{s.label}</span>
                <span className="text-fg">{formatBytes(s.value)} ({formatPercent(s.percent)})</span>
              </div>
            ))}
          </Card>
          <Card title="Top 10 Largest Files" bodyClassName="flex flex-col gap-1 p-3">
            {topFilesData.slice(0, 10).map((f, i) => (
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

      <Card title="Files & Folders" padded={false} bodyClassName="h-[220px] flex-none">
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
