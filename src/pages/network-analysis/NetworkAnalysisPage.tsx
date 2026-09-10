import { useMemo, useState } from "react";
import clsx from "clsx";
import { File, Folder, ScanSearch, Server } from "lucide-react";
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
import { networkTree } from "@/mock/folderTree";
import { networkFileTypeStats, networkTopFiles } from "@/mock/fileTypes";
import {
  accessRights,
  generateThroughputSeries,
  networkConnectionStatus,
  networkScanSummary,
  networkSessions,
  networkShares,
} from "@/mock/network";
import { flattenVisible } from "@/utils/fsTree";
import type { FsNode } from "@/models/common";
import { formatBytes, formatDate, formatDuration, formatNumber, formatPercent } from "@/utils/format";
import { useSimulatedProgress } from "@/hooks/useSimulatedProgress";
import { useUiStore } from "@/state/uiStore";
import { toast } from "@/state/toastStore";

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

const shareStatusTone = { online: "success", offline: "danger", degraded: "warning" } as const;

export function NetworkAnalysisPage() {
  const [location, setLocation] = useState("\\\\NAS\\CompanyData");
  const [tab, setTab] = useState("overview");
  const [breadcrumb, setBreadcrumb] = useState<FsNode[]>([networkTree]);
  const [selectedNode, setSelectedNode] = useState<FsNode | null>(networkTree.children?.[0] ?? null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const throughput = useMemo(() => generateThroughputSeries(40), []);
  const setStatusText = useUiStore((s) => s.setStatusText);

  const scan = useSimulatedProgress(() => {
    setStatusText("Ready");
    toast.success(`Network scan completed - ${formatBytes(networkTree.size)} across ${formatNumber(networkTree.fileCount)} files.`);
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
    scan.start(4);
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
      <PageHeader title="Network Analysis" description="Scan and analyse network shares, NAS devices and remote folders." />

      <div className="flex items-stretch gap-3">
        <Card title="Network Location" className="flex-1">
          <div className="flex flex-col gap-2.5">
            <LocationPicker value={location} onChange={setLocation} network placeholder="\\Server\Share" />
            <div className="flex items-center gap-2">
              <Button variant="primary" icon={ScanSearch} onClick={startScan} disabled={scan.status === "running"}>
                {scan.status === "running" ? `Scanning... ${scan.progress.toFixed(0)}%` : "Scan"}
              </Button>
              <Button onClick={() => toast.demo()}>Scan Options</Button>
            </div>
            {scan.status === "running" && <ProgressBar value={scan.progress} tone="accent" />}
          </div>
        </Card>

        <Card title="Connection Status" className="w-[230px] shrink-0">
          <div className="flex flex-col gap-1.5 text-[12.5px]">
            <Badge tone="success" dot className="self-start">
              Connected
            </Badge>
            <dl className="mt-1 grid grid-cols-[62px_1fr] gap-y-1">
              <dt className="text-fg-muted">Server:</dt>
              <dd className="text-fg">{networkConnectionStatus.server}</dd>
              <dt className="text-fg-muted">Share:</dt>
              <dd className="text-fg">{networkConnectionStatus.share}</dd>
              <dt className="text-fg-muted">User:</dt>
              <dd className="truncate text-fg">{networkConnectionStatus.user}</dd>
              <dt className="text-fg-muted">Protocol:</dt>
              <dd className="text-fg">{networkConnectionStatus.protocol}</dd>
              <dt className="text-fg-muted">Latency:</dt>
              <dd className="text-fg">{networkConnectionStatus.latencyMs} ms</dd>
            </dl>
          </div>
        </Card>

        <Card title="Scan Summary" className="w-[230px] shrink-0">
          <dl className="grid grid-cols-[62px_1fr] gap-y-1 text-[12.5px]">
            <dt className="text-fg-muted">Folders:</dt>
            <dd className="text-fg">{formatNumber(networkScanSummary.folders)}</dd>
            <dt className="text-fg-muted">Files:</dt>
            <dd className="text-fg">{formatNumber(networkScanSummary.files)}</dd>
            <dt className="text-fg-muted">Size:</dt>
            <dd className="text-fg">{formatBytes(networkScanSummary.totalBytes)}</dd>
            <dt className="text-fg-muted">Time:</dt>
            <dd className="text-fg">{formatDuration(networkScanSummary.scanTimeSeconds)}</dd>
            <dt className="text-fg-muted">Rate:</dt>
            <dd className="text-fg">{(networkScanSummary.transferRateMbps / 1000).toFixed(1)} Gbit/s</dd>
          </dl>
        </Card>
      </div>

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {/* auto-rows-fr: without it this grid's implicit row defaults to
          auto (content-based) sizing instead of stretching to fill this
          flex-1 container - starves the Treemap's ResizeObserver-measured
          height down to 0 whenever the row's content doesn't happen to be
          tall enough on its own (found live while wiring real data into
          the same pattern on Disk/Folder Analysis - see PHASE4.md). */}
      <div className="grid min-h-0 flex-1 auto-rows-fr grid-cols-[1fr_300px] gap-3">
        <Card padded={false} bodyClassName="p-3 flex flex-col gap-3 min-h-0 overflow-y-auto" className="min-h-0">
          {tab === "overview" && (
            <>
              <div className="grid grid-cols-3 gap-2.5">
                <StatCard icon={Server} label="Total Size" value={formatBytes(networkScanSummary.totalBytes)} tone="accent" />
                <StatCard icon={File} label="Files" value={formatNumber(networkScanSummary.files)} tone="info" />
                <StatCard icon={Folder} label="Folders" value={formatNumber(networkScanSummary.folders)} tone="info" />
              </div>
              <DonutChart data={networkFileTypeStats} centerLabel="Total Size" centerValue={formatBytes(networkScanSummary.totalBytes)} size={112} />
            </>
          )}
          {tab === "shares" && (
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-border text-left text-[11px] font-semibold text-fg-muted">
                  <th className="px-3 py-2">Share Name</th>
                  <th className="px-3 py-2">Path</th>
                  <th className="px-3 py-2 text-right">Total Size</th>
                  <th className="px-3 py-2 text-right">Free Space</th>
                  <th className="px-3 py-2">File System</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {networkShares.map((s) => (
                  <tr key={s.name} className="border-b border-border/60 hover:bg-surface-hover">
                    <td className="px-3 py-2 font-medium text-fg">{s.name}</td>
                    <td className="px-3 py-2 text-fg-muted">{s.path}</td>
                    <td className="px-3 py-2 text-right text-fg-muted">{formatBytes(s.totalBytes)}</td>
                    <td className="px-3 py-2 text-right text-fg-muted">{formatBytes(s.freeBytes)}</td>
                    <td className="px-3 py-2 text-fg-muted">{s.fileSystem}</td>
                    <td className="px-3 py-2">
                      <Badge tone={shareStatusTone[s.status]} dot>
                        {s.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
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
              series={[{ key: "size", label: "Size", color: "var(--color-chart-1)" }]}
              height={320}
            />
          )}
          {tab === "top-folders" && (
            <div className="flex flex-col gap-1.5 overflow-y-auto">
              {[...(networkTree.children ?? [])].sort((a, b) => b.size - a.size).map((f, i) => (
                <div key={f.id} className="flex items-center gap-3 rounded-md border border-border bg-surface-alt px-3 py-2">
                  <span className="w-5 text-fg-subtle">#{i + 1}</span>
                  <Folder size={14} className="text-warning" />
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg">{f.path}</span>
                  <span className="shrink-0 text-[12.5px] font-medium text-fg">{formatBytes(f.size)}</span>
                </div>
              ))}
            </div>
          )}
          {tab === "top-files" && (
            <div className="flex flex-col gap-1.5 overflow-y-auto">
              {networkTopFiles.map((f) => (
                <div key={f.rank} className="flex items-center gap-3 rounded-md border border-border bg-surface-alt px-3 py-2">
                  <span className="w-5 text-fg-subtle">#{f.rank}</span>
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
          {tab === "file-types" && (
            <div className="flex h-full items-center justify-center">
              <DonutChart data={networkFileTypeStats} centerLabel="Total Size" centerValue={formatBytes(networkScanSummary.totalBytes)} size={180} />
            </div>
          )}
          {tab === "access-rights" && (
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-border text-left text-[11px] font-semibold text-fg-muted">
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Permissions</th>
                  <th className="px-3 py-2">Inherited</th>
                </tr>
              </thead>
              <tbody>
                {accessRights.map((a) => (
                  <tr key={a.name} className="border-b border-border/60">
                    <td className="px-3 py-2 text-fg-muted">{a.type}</td>
                    <td className="px-3 py-2 text-fg">{a.name}</td>
                    <td className="px-3 py-2 text-fg-muted">{a.permissions}</td>
                    <td className="px-3 py-2 text-fg-muted">{a.inherited ? "Yes" : "No"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {tab === "sessions" && (
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-border text-left text-[11px] font-semibold text-fg-muted">
                  <th className="px-3 py-2">User</th>
                  <th className="px-3 py-2">Host</th>
                  <th className="px-3 py-2">Connected Since</th>
                  <th className="px-3 py-2 text-right">Open Files</th>
                </tr>
              </thead>
              <tbody>
                {networkSessions.map((s) => (
                  <tr key={s.host} className="border-b border-border/60">
                    <td className="px-3 py-2 text-fg">{s.user}</td>
                    <td className="px-3 py-2 text-fg-muted">{s.host}</td>
                    <td className="px-3 py-2 text-fg-muted">{formatDate(s.connectedSince)}</td>
                    <td className="px-3 py-2 text-right text-fg-muted">{s.openFiles}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <div className="flex min-w-0 flex-col gap-3 overflow-y-auto">
          <Card title="Network Throughput" action={<span className="text-[11px] text-fg-muted">Current: {throughput[throughput.length - 1]?.mbps} Mbit/s</span>}>
            <LineChartPanel
              data={throughput}
              categoryKey="t"
              series={[{ key: "mbps", label: "Mbit/s", color: "var(--color-chart-1)" }]}
              valueFormatter={(v) => `${v} Mbit/s`}
              height={130}
            />
          </Card>
          <Card title="Top Network Files" bodyClassName="flex flex-col gap-1.5 p-3">
            {networkTopFiles.slice(0, 5).map((f) => (
              <div key={f.rank} className="flex items-center justify-between gap-2 text-[12px]">
                <span className="min-w-0 flex-1 truncate text-fg-muted">
                  {f.rank}. {f.name}
                </span>
                <span className="shrink-0 text-fg">{formatBytes(f.size)}</span>
              </div>
            ))}
          </Card>
          <FolderDetailsCard node={selectedNode} />
        </div>
      </div>

      {/* flex-none: cancels Card's default flex-1 (flex-basis:0%), which
          otherwise beats this fixed height in a flex-col layout - see the
          identical fix/comment in DiskAnalysisPage.tsx (PHASE4.md). */}
      <Card title="Folders" padded={false} bodyClassName="h-[200px] flex-none">
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
