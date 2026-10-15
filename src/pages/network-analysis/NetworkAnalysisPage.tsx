import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Activity, File, Folder, RefreshCw, ScanSearch, Server, X } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/cards/Card";
import { StatCard } from "@/components/cards/StatCard";
import { LocationPicker } from "@/components/controls/LocationPicker";
import { Button } from "@/components/controls/Button";
import { Badge } from "@/components/controls/Badge";
import { Tabs } from "@/components/controls/Tabs";
import { ProgressBar } from "@/components/charts/ProgressBar";
import { DonutChart } from "@/components/charts/DonutChart";
import { BarChartPanel } from "@/components/charts/BarChartPanel";
import { LineChartPanel } from "@/components/charts/LineChartPanel";
import { Treemap } from "@/components/treemap/Treemap";
import { Breadcrumb } from "@/components/treemap/Breadcrumb";
import { DataTable, type DataTableColumn } from "@/components/tables/DataTable";
import { FolderDetailsCard } from "@/components/cards/FolderDetailsCard";
import { getAccessRights, getShareConnection, listServerSessions, listServerShares, measureReadSpeed } from "@/api/network";
import { toAppError } from "@/api/backend";
import { flattenVisible, hasExpandableChildren } from "@/utils/fsTree";
import { useScanAnalysis } from "@/hooks/useScanAnalysis";
import type { FsNode } from "@/models/common";
import type { AppError } from "@/models/backend";
import { scanOptionsFromSettings } from "@/state/settingsStore";
import type { AccessRightEntry, NetworkSession, NetworkShare, ReadSpeedResult, ShareConnection } from "@/models/network";
import { formatBytes, formatDate, formatDuration, formatNumber, formatPercent } from "@/utils/format";
import { useNetworkScanStore } from "@/state/scanStore";
import { useUiStore } from "@/state/uiStore";
import { toast } from "@/state/toastStore";
import { useFsContextMenu } from "@/hooks/useFsContextMenu";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "shares", label: "Shares" },
  { id: "treemap", label: "Treemap" },
  { id: "chart", label: "Chart" },
  { id: "top-folders", label: "Top Folders" },
  { id: "top-files", label: "Top Files" },
  { id: "file-types", label: "File Types" },
  { id: "access-rights", label: "Access Rights" },
  { id: "sessions", label: "Sessions" },
];

const shareStatusTone = { online: "success", "no-access": "danger", "n/a": "neutral" } as const;

const EMPTY_ROOT: FsNode = {
  id: "empty",
  name: "No scan yet",
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

/** `\\server\share\...` → `server`, or null for a local path. */
function serverOf(path: string): string | null {
  const m = /^[\\/]{2}([^\\/]+)/.exec(path.trim());
  return m ? m[1] : null;
}

/** Loads something for a key, keeping the result keyed so a stale one
 * is never shown for a new key. */
function useKeyedLoad<T>(key: string | null, load: (key: string) => Promise<T>) {
  const [state, setState] = useState<{ key: string; data?: T; error?: AppError } | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!key) return;
    let alive = true;
    load(key).then(
      (data) => alive && setState({ key, data }),
      (err) => alive && setState({ key, error: toAppError(err) }),
    );
    return () => {
      alive = false;
    };
    // `load` is a stable module function at every call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reload]);
  const current = state && state.key === key ? state : null;
  return { data: current?.data, error: current?.error, loading: !!key && !current, refresh: () => setReload((n) => n + 1) };
}

export function NetworkAnalysisPage() {
  const fsMenu = useFsContextMenu();
  // Right-click: select the item and open its file/folder menu.
  const onItemMenu = (node: FsNode, event: React.MouseEvent) => {
    setSelectedNode(node);
    fsMenu.forNode(event, node);
  };
  const scan = useNetworkScanStore();
  const [location, setLocation] = useState(() => useNetworkScanStore.getState().path ?? "");
  const [tab, setTab] = useState("overview");
  const isReal = scan.status === "completed" && !!scan.result;
  const root = isReal ? scan.result!.root : EMPTY_ROOT;
  const [breadcrumb, setBreadcrumb] = useState<FsNode[]>([root]);
  const [selectedNode, setSelectedNode] = useState<FsNode | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [speed, setSpeed] = useState<{ running: boolean; result: ReadSpeedResult | null }>({ running: false, result: null });
  const setStatusText = useUiStore((s) => s.setStatusText);

  // A new result resets the view to its root (adjusting state during
  // render, as the analysis pages do).
  const [lastSeenResult, setLastSeenResult] = useState(scan.result);
  if (scan.result !== lastSeenResult) {
    setLastSeenResult(scan.result);
    if (scan.result) {
      setBreadcrumb([scan.result.root]);
      setSelectedNode(scan.result.root.children?.[0] ?? scan.result.root);
      setExpandedIds(new Set());
      setStatusText("Ready");
      toast.success(
        `Network scan complete - ${formatBytes(scan.result.root.size)} in ${formatNumber(scan.result.root.fileCount)} files.`,
      );
    }
  }

  const currentNode = isReal ? breadcrumb[breadcrumb.length - 1] : EMPTY_ROOT;
  const analysis = useScanAnalysis(currentNode, isReal ? scan.scanId : null);
  const visibleRows = useMemo(() => flattenVisible(currentNode, expandedIds), [currentNode, expandedIds]);
  const depthById = useMemo(() => new Map(visibleRows.map((r) => [r.node.id, r.depth])), [visibleRows]);

  const scannedPath = scan.path ?? location;
  const server = serverOf(scannedPath);
  const connection = useKeyedLoad<ShareConnection>(serverOf(scannedPath) ? scannedPath : null, getShareConnection);
  const shares = useKeyedLoad<NetworkShare[]>(tab === "shares" ? server : null, listServerShares);
  const sessions = useKeyedLoad<NetworkSession[]>(tab === "sessions" ? server : null, listServerSessions);
  const rightsPath = selectedNode && isReal ? selectedNode.path : scannedPath.trim() || null;
  const rights = useKeyedLoad<AccessRightEntry[]>(tab === "access-rights" ? rightsPath : null, getAccessRights);

  function drillInto(node: FsNode) {
    scan
      .loadChildren(node)
      .then((loaded) => {
        if (!loaded.children?.length) return;
        setBreadcrumb((b) => [...b, loaded]);
        setSelectedNode(loaded);
      })
      .catch((err) => toast.danger(toAppError(err).message));
  }

  function toggleExpand(node: FsNode) {
    scan
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
    if (!location.trim()) {
      toast.warning("Enter a network location like \\\\server\\share first.");
      return;
    }
    setStatusText(`Scanning ${location}...`);
    setSpeed({ running: false, result: null });
    void scan.start(location, scanOptionsFromSettings());
  }

  function runSpeedTest() {
    const file = analysis.topFiles[0];
    if (!file) {
      toast.warning("Scan a share first - the test reads its largest file.");
      return;
    }
    setSpeed({ running: true, result: null });
    measureReadSpeed(file.path)
      .then((result) => setSpeed({ running: false, result }))
      .catch((err) => {
        setSpeed({ running: false, result: null });
        toast.danger(toAppError(err).message);
      });
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

  const running = scan.status === "scanning";
  const elapsedSeconds = (scan.result?.elapsedMs ?? 0) / 1000;
  const filesPerSecond = isReal && elapsedSeconds > 0 ? root.fileCount / elapsedSeconds : 0;
  const conn = connection.data;

  const emptyHint = (text: string) => <p className="p-2 text-xs text-fg-subtle">{text}</p>;

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <PageHeader title="Network Analysis" description="Scan and analyse network shares, NAS devices and remote folders." />

      <div className="flex items-stretch gap-3">
        <Card title="Network Location" className="flex-1">
          <div className="flex flex-col gap-2.5">
            <LocationPicker value={location} onChange={setLocation} network placeholder="\\Server\Share" />
            <div className="flex items-center gap-2">
              {running ? (
                <Button icon={X} onClick={() => void scan.cancel()}>
                  Cancel ({formatNumber(scan.progress?.scannedFiles ?? 0)} files)
                </Button>
              ) : (
                <Button variant="primary" icon={ScanSearch} onClick={startScan}>
                  Scan
                </Button>
              )}
              <Button
                icon={Server}
                disabled={!serverOf(location)}
                onClick={() => {
                  setTab("shares");
                  shares.refresh();
                }}
              >
                Show server shares
              </Button>
            </div>
            {running && <ProgressBar indeterminate tone="accent" />}
            {scan.status === "error" && <p className="text-[12px] text-danger">{scan.error?.message}</p>}
          </div>
        </Card>

        <Card title="Connection Status" className="w-[250px] shrink-0">
          {!serverOf(scannedPath) ? (
            <p className="text-[12px] text-fg-muted">Enter a \\server\share path to see its connection.</p>
          ) : connection.loading ? (
            <p className="text-[12px] text-fg-muted">Checking...</p>
          ) : connection.error ? (
            <p className="text-[12px] text-danger">{connection.error.message}</p>
          ) : conn ? (
            <div className="flex flex-col gap-1.5 text-[12.5px]">
              <Badge tone={conn.reachable ? "success" : "danger"} dot className="self-start">
                {conn.reachable ? "Connected" : "Not reachable"}
              </Badge>
              <dl className="mt-1 grid grid-cols-[62px_1fr] gap-y-1">
                <dt className="text-fg-muted">Server:</dt>
                <dd className="truncate text-fg">{conn.server}</dd>
                <dt className="text-fg-muted">Share:</dt>
                <dd className="truncate text-fg">{conn.share || "-"}</dd>
                <dt className="text-fg-muted">User:</dt>
                <dd className="truncate text-fg" title={conn.user}>{conn.user}</dd>
                <dt className="text-fg-muted">Protocol:</dt>
                <dd className="text-fg">{conn.protocol ?? "SMB"}</dd>
                <dt className="text-fg-muted">Latency:</dt>
                <dd className="text-fg">{conn.latencyMs != null ? `${conn.latencyMs} ms` : "port 445 closed"}</dd>
              </dl>
            </div>
          ) : null}
        </Card>

        <Card title="Scan Summary" className="w-[230px] shrink-0">
          <dl className="grid grid-cols-[62px_1fr] gap-y-1 text-[12.5px]">
            <dt className="text-fg-muted">Folders:</dt>
            <dd className="text-fg">{isReal ? formatNumber(root.folderCount) : "-"}</dd>
            <dt className="text-fg-muted">Files:</dt>
            <dd className="text-fg">{isReal ? formatNumber(root.fileCount) : "-"}</dd>
            <dt className="text-fg-muted">Size:</dt>
            <dd className="text-fg">{isReal ? formatBytes(root.size) : "-"}</dd>
            <dt className="text-fg-muted">Time:</dt>
            <dd className="text-fg">{isReal ? formatDuration(elapsedSeconds) : "-"}</dd>
            <dt className="text-fg-muted">Rate:</dt>
            <dd className="text-fg">{isReal ? `${formatNumber(Math.round(filesPerSecond))} files/s` : "-"}</dd>
          </dl>
        </Card>
      </div>

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {/* auto-rows-fr: see the identical comment in DiskAnalysisPage.tsx
          (PHASE4.md) - without it the Treemap's measured height is 0. */}
      <div className="grid min-h-0 flex-1 auto-rows-fr grid-cols-[1fr_300px] gap-3">
        <Card padded={false} bodyClassName="p-3 flex flex-col gap-3 min-h-0 overflow-y-auto" className="min-h-0">
          {tab === "overview" &&
            (isReal ? (
              <>
                <div className="grid grid-cols-3 gap-2.5">
                  <StatCard icon={Server} label="Total Size" value={formatBytes(currentNode.size)} tone="accent" />
                  <StatCard icon={File} label="Files" value={formatNumber(currentNode.fileCount)} tone="info" />
                  <StatCard icon={Folder} label="Folders" value={formatNumber(currentNode.folderCount)} tone="info" />
                </div>
                <DonutChart data={analysis.categoryStats} centerLabel="Total Size" centerValue={formatBytes(currentNode.size)} size={112} />
              </>
            ) : (
              emptyHint("Scan a network share to see its size, file types and largest files.")
            ))}
          {tab === "shares" &&
            (!server && !serverOf(location) ? (
              emptyHint("Enter a \\\\server or \\\\server\\share path to list the server's shares.")
            ) : shares.loading ? (
              emptyHint("Loading shares...")
            ) : shares.error ? (
              <p className="p-2 text-xs text-danger">{shares.error.message}</p>
            ) : (
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] font-semibold text-fg-muted">
                    <th className="px-3 py-2">Share Name</th>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2 text-right">Total Size</th>
                    <th className="px-3 py-2 text-right">Free Space</th>
                    <th className="px-3 py-2">File System</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {(shares.data ?? []).map((s) => (
                    <tr key={s.name} className="border-b border-border/60 hover:bg-surface-hover">
                      <td className="px-3 py-2 font-medium text-fg" title={s.remark || s.path}>
                        {s.name}
                        {s.special && <span className="ml-1.5 text-[11px] text-fg-subtle">(admin)</span>}
                      </td>
                      <td className="px-3 py-2 text-fg-muted">{s.kind}</td>
                      <td className="px-3 py-2 text-right text-fg-muted">{s.totalBytes != null ? formatBytes(s.totalBytes) : "-"}</td>
                      <td className="px-3 py-2 text-right text-fg-muted">{s.freeBytes != null ? formatBytes(s.freeBytes) : "-"}</td>
                      <td className="px-3 py-2 text-fg-muted">{s.fileSystem ?? "-"}</td>
                      <td className="px-3 py-2">
                        <Badge tone={shareStatusTone[s.status]} dot>{s.status}</Badge>
                      </td>
                      <td className="px-3 py-2 text-right">
                        {s.kind === "disk" && (
                          <Button size="sm" onClick={() => setLocation(s.path)}>Use</Button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {shares.data?.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-3 py-6 text-center text-fg-subtle">No shares found.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            ))}
          {tab === "treemap" &&
            (isReal ? (
              <>
                <Breadcrumb segments={breadcrumb.map((n) => ({ id: n.id, label: n.name }))} onNavigate={(i) => setBreadcrumb((b) => b.slice(0, i + 1))} />
                <Treemap node={currentNode} selectedId={selectedNode?.id} onSelect={setSelectedNode} onDrillDown={drillInto} canDrillDown={hasExpandableChildren} onNodeContextMenu={onItemMenu} className="flex-1" />
              </>
            ) : (
              emptyHint("Scan a network share to see its treemap.")
            ))}
          {tab === "chart" &&
            (isReal ? (
              <BarChartPanel
                data={[...(currentNode.children ?? [])].sort((a, b) => b.size - a.size).slice(0, 20).map((c) => ({ name: c.name, size: c.size }))}
                categoryKey="name"
                series={[{ key: "size", label: "Size", color: "var(--color-chart-1)" }]}
                height={320}
              />
            ) : (
              emptyHint("Scan a network share to see the chart.")
            ))}
          {tab === "top-folders" && (
            <div className="flex flex-col gap-1.5 overflow-y-auto">
              {!isReal && emptyHint("Scan a network share first.")}
              {analysis.topFolders.map((f, i) => (
                <div key={f.path} className="flex items-center gap-3 rounded-md border border-border bg-surface-alt px-3 py-2">
                  <span className="w-5 text-fg-subtle">#{i + 1}</span>
                  <Folder size={14} className="text-warning" />
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg" title={f.path}>{f.path}</span>
                  <span className="shrink-0 text-[12.5px] font-medium text-fg">{formatBytes(f.size)}</span>
                </div>
              ))}
            </div>
          )}
          {tab === "top-files" && (
            <div className="flex flex-col gap-1.5 overflow-y-auto">
              {!isReal && emptyHint("Scan a network share first.")}
              {analysis.topFiles.map((f, i) => (
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
          {tab === "file-types" &&
            (isReal ? (
              <div className="flex h-full items-center justify-center">
                <DonutChart data={analysis.categoryStats} centerLabel="Total Size" centerValue={formatBytes(currentNode.size)} size={180} />
              </div>
            ) : (
              emptyHint("Scan a network share first.")
            ))}
          {tab === "access-rights" &&
            (!rightsPath ? (
              emptyHint("Enter or scan a location to see its access rights.")
            ) : rights.loading ? (
              emptyHint("Reading permissions...")
            ) : rights.error ? (
              <p className="p-2 text-xs text-danger">{rights.error.message}</p>
            ) : (
              <>
                <p className="text-[11.5px] text-fg-muted">NTFS permissions of {rightsPath}</p>
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="border-b border-border text-left text-[11px] font-semibold text-fg-muted">
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2">Name</th>
                      <th className="px-3 py-2">Access</th>
                      <th className="px-3 py-2">Permissions</th>
                      <th className="px-3 py-2">Inherited</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(rights.data ?? []).map((a, i) => (
                      <tr key={`${a.name}-${i}`} className="border-b border-border/60">
                        <td className="px-3 py-2 text-fg-muted">{a.type}</td>
                        <td className="px-3 py-2 text-fg">{a.name}</td>
                        <td className="px-3 py-2">
                          <Badge tone={a.allow ? "success" : "danger"}>{a.allow ? "Allow" : "Deny"}</Badge>
                        </td>
                        <td className="px-3 py-2 text-fg-muted">{a.permissions}</td>
                        <td className="px-3 py-2 text-fg-muted">{a.inherited ? "Yes" : "No"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ))}
          {tab === "sessions" &&
            (!server ? (
              emptyHint("Scan a \\\\server\\share location to see who is connected to that server.")
            ) : sessions.loading ? (
              emptyHint("Loading sessions...")
            ) : sessions.error ? (
              <p className="p-2 text-xs text-danger">{sessions.error.message}</p>
            ) : (
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] font-semibold text-fg-muted">
                    <th className="px-3 py-2">User</th>
                    <th className="px-3 py-2">Host</th>
                    <th className="px-3 py-2 text-right">Connected</th>
                    <th className="px-3 py-2 text-right">Idle</th>
                  </tr>
                </thead>
                <tbody>
                  {(sessions.data ?? []).map((s, i) => (
                    <tr key={`${s.host}-${s.user}-${i}`} className="border-b border-border/60">
                      <td className="px-3 py-2 text-fg">{s.user || "-"}</td>
                      <td className="px-3 py-2 text-fg-muted">{s.host}</td>
                      <td className="px-3 py-2 text-right text-fg-muted">{formatDuration(s.connectedSeconds)}</td>
                      <td className="px-3 py-2 text-right text-fg-muted">{formatDuration(s.idleSeconds)}</td>
                    </tr>
                  ))}
                  {sessions.data?.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-3 py-6 text-center text-fg-subtle">No sessions.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            ))}
        </Card>

        <div className="flex min-w-0 flex-col gap-3 overflow-y-auto">
          <Card
            title="Read Speed"
            action={
              <Button size="sm" icon={speed.running ? RefreshCw : Activity} disabled={speed.running || !isReal} onClick={runSpeedTest}>
                {speed.running ? "Measuring..." : "Measure"}
              </Button>
            }
          >
            {speed.result ? (
              <>
                <div className="mb-1 text-[11.5px] text-fg-muted">
                  Average <span className="font-semibold text-fg">{speed.result.averageMbps.toFixed(0)} Mbit/s</span> ·{" "}
                  {formatBytes(speed.result.bytesRead)} in {(speed.result.elapsedMs / 1000).toFixed(1)} s
                </div>
                <LineChartPanel
                  data={speed.result.samples.map((s) => ({ t: (s.tMs / 1000).toFixed(1), mbps: Math.round(s.mbps) }))}
                  categoryKey="t"
                  series={[{ key: "mbps", label: "Mbit/s", color: "var(--color-chart-1)" }]}
                  valueFormatter={(v) => `${v} Mbit/s`}
                  height={120}
                />
              </>
            ) : (
              <p className="text-[12px] text-fg-muted">
                Reads the scanned share's largest file (up to 512 MB or 8 s, bypassing the cache) to measure real throughput.
              </p>
            )}
          </Card>
          <Card title="Top Network Files" bodyClassName="flex flex-col gap-1.5 p-3">
            {analysis.topFiles.length === 0 && <p className="text-[12px] text-fg-subtle">-</p>}
            {analysis.topFiles.slice(0, 5).map((f, i) => (
              <div key={f.path} className="flex items-center justify-between gap-2 text-[12px]">
                <span className="min-w-0 flex-1 truncate text-fg-muted" title={f.path}>
                  {i + 1}. {f.name}
                </span>
                <span className="shrink-0 text-fg">{formatBytes(f.size)}</span>
              </div>
            ))}
          </Card>
          <FolderDetailsCard node={isReal ? selectedNode : null} />
        </div>
      </div>

      {/* flex-none: see the identical fix/comment in DiskAnalysisPage.tsx (PHASE4.md). */}
      <Card title="Folders" padded={false} bodyClassName="h-[200px] flex-none">
        <DataTable
          columns={columns}
          rows={isReal ? visibleRows.map((r) => r.node) : []}
          getRowId={(n) => n.id}
          selectedId={selectedNode?.id}
          onRowClick={setSelectedNode}
          onRowDoubleClick={(n) => hasExpandableChildren(n) && drillInto(n)}
          onRowContextMenu={onItemMenu}
          emptyMessage={running ? "Scanning..." : "Scan a network share to browse its folders."}
          className="h-full border-0 rounded-none"
        />
      </Card>
    </div>
  );
}
