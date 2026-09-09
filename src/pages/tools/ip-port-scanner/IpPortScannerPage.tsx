import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Copy,
  Download,
  ExternalLink,
  Play,
  Radar,
  Square,
  Star,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/cards/Card";
import { RadioGroup } from "@/components/controls/RadioGroup";
import { TextInput } from "@/components/controls/TextInput";
import { Select } from "@/components/controls/Select";
import { Checkbox } from "@/components/controls/Checkbox";
import { Button } from "@/components/controls/Button";
import { Tabs } from "@/components/controls/Tabs";
import { Badge } from "@/components/controls/Badge";
import { ProgressBar } from "@/components/charts/ProgressBar";
import { commonPortsTop100, mockHosts } from "@/mock/portscan";
import type { HostScanResult, PortSettingMode, ScanTargetMode } from "@/models/portscan";
import { formatDuration } from "@/utils/format";
import { useSimulatedProgress } from "@/hooks/useSimulatedProgress";
import { toast } from "@/state/toastStore";

const TABS = [
  { id: "scan", label: "Scan" },
  { id: "results", label: "Results" },
  { id: "live-view", label: "Live View" },
  { id: "export", label: "Export" },
  { id: "favorites", label: "Favorites" },
];

const TOTAL_HOSTS = 254;
const REVEAL_THRESHOLDS = mockHosts.map((_, i) => Math.round(((i + 1) / mockHosts.length) * TOTAL_HOSTS));

interface PortRow {
  host: HostScanResult;
  port: number;
  service: string;
  banner: string;
}

export function IpPortScannerPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("scan");
  const [targetMode, setTargetMode] = useState<ScanTargetMode>("ip-range");
  const [singleIp, setSingleIp] = useState("192.168.1.1");
  const [rangeFrom, setRangeFrom] = useState("192.168.1.1");
  const [rangeTo, setRangeTo] = useState("192.168.1.254");
  const [cidr, setCidr] = useState("192.168.1.0/24");
  const [hostnames, setHostnames] = useState("server1.domain.local\nserver2.domain.local");
  const [portMode, setPortMode] = useState<PortSettingMode>("common");
  const [customPorts, setCustomPorts] = useState("22,80,443,445,3389");
  const [scanOptions, setScanOptions] = useState({
    pingBeforeScan: true,
    detectServiceVersion: true,
    resolveHostnames: true,
    multithreaded: true,
    threadCount: 100,
  });
  const [selectedHostId, setSelectedHostId] = useState<string | null>(mockHosts[0]?.id ?? null);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());

  const scan = useSimulatedProgress(() => toast.success("Scan completed."));

  const scannedHosts = Math.floor(TOTAL_HOSTS * (scan.progress / 100));
  const revealedHosts = useMemo(
    () => mockHosts.filter((_, i) => scannedHosts >= REVEAL_THRESHOLDS[i] || scan.status === "completed" || scan.status === "idle"),
    [scannedHosts, scan.status],
  );
  const openPortsFound = revealedHosts.reduce((s, h) => s + h.ports.length, 0);
  const hostsPerSecond = scan.elapsedSeconds > 0 ? scannedHosts / scan.elapsedSeconds : 0;
  const estimatedSeconds = hostsPerSecond > 0 ? (TOTAL_HOSTS - scannedHosts) / hostsPerSecond : 0;

  const portRows: PortRow[] = useMemo(
    () => revealedHosts.flatMap((host) => host.ports.map((p) => ({ host, port: p.port, service: p.service, banner: p.banner }))),
    [revealedHosts],
  );

  const selectedHost = mockHosts.find((h) => h.id === selectedHostId) ?? null;

  function startScan() {
    scan.start(9);
  }

  function toggleFavorite(id: string) {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <button
        onClick={() => navigate("/tools")}
        className="flex items-center gap-1.5 text-[12px] text-fg-muted hover:text-fg cursor-pointer self-start"
      >
        <ArrowLeft size={13} /> Back to Tools
      </button>
      <PageHeader title="IP / Port Scanner" description="Scan IP ranges or hostnames to discover devices and open ports." />

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {tab === "scan" && (
        <div className="grid grid-cols-[1fr_1fr_260px] gap-3">
          <Card title="Target">
            <RadioGroup
              name="target-mode"
              value={targetMode}
              onChange={setTargetMode}
              options={[
                { value: "single-ip", label: "Single IP" },
                { value: "ip-range", label: "IP Range" },
                { value: "cidr", label: "Subnet (CIDR)" },
                { value: "hostname-list", label: "Hostname / List" },
              ]}
            />
            <div className="mt-3 flex flex-col gap-2">
              {targetMode === "single-ip" && <TextInput value={singleIp} onChange={(e) => setSingleIp(e.target.value)} />}
              {targetMode === "ip-range" && (
                <div className="flex items-center gap-2">
                  <TextInput value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)} containerClassName="flex-1" />
                  <span className="text-fg-subtle">to</span>
                  <TextInput value={rangeTo} onChange={(e) => setRangeTo(e.target.value)} containerClassName="flex-1" />
                </div>
              )}
              {targetMode === "cidr" && <TextInput value={cidr} onChange={(e) => setCidr(e.target.value)} />}
              {targetMode === "hostname-list" && (
                <textarea
                  value={hostnames}
                  onChange={(e) => setHostnames(e.target.value)}
                  rows={4}
                  placeholder="Enter one per line"
                  className="w-full rounded-md border border-border-strong bg-surface px-2.5 py-2 text-[13px] text-fg placeholder:text-fg-subtle focus:border-accent"
                />
              )}
            </div>
          </Card>

          <div className="flex flex-col gap-3">
            <Card title="Port Settings">
              <RadioGroup
                name="port-mode"
                value={portMode}
                onChange={setPortMode}
                options={[
                  { value: "common", label: "Common ports (fast)" },
                  { value: "custom", label: "Custom ports" },
                  { value: "all", label: "Scan all ports (1-65535)" },
                ]}
              />
              <div className="mt-2.5">
                {portMode === "common" && (
                  <Select options={[{ value: "top20", label: "Top 20" }, { value: "top100", label: "Top 100" }, { value: "top1000", label: "Top 1000" }]} defaultValue="top100" />
                )}
                {portMode === "custom" && (
                  <TextInput value={customPorts} onChange={(e) => setCustomPorts(e.target.value)} placeholder="e.g. 22,80,443,445,3389" />
                )}
                {portMode === "all" && <p className="text-[11.5px] text-fg-subtle">Ports 1-65535 will be probed ({commonPortsTop100.split(",").length}+ well-known ports prioritized first).</p>}
              </div>
            </Card>
            <Card title="Scan Options">
              <div className="flex flex-col gap-1.5">
                <Checkbox checked={scanOptions.pingBeforeScan} onChange={(v) => setScanOptions((o) => ({ ...o, pingBeforeScan: v }))} label="Ping hosts before scan" />
                <Checkbox checked={scanOptions.detectServiceVersion} onChange={(v) => setScanOptions((o) => ({ ...o, detectServiceVersion: v }))} label="Detect service version" />
                <Checkbox checked={scanOptions.resolveHostnames} onChange={(v) => setScanOptions((o) => ({ ...o, resolveHostnames: v }))} label="Resolve hostnames" />
                <div className="flex items-center gap-2">
                  <Checkbox checked={scanOptions.multithreaded} onChange={(v) => setScanOptions((o) => ({ ...o, multithreaded: v }))} label="Multithreaded scan" />
                  {scanOptions.multithreaded && (
                    <TextInput
                      type="number"
                      value={scanOptions.threadCount}
                      onChange={(e) => setScanOptions((o) => ({ ...o, threadCount: Number(e.target.value) }))}
                      containerClassName="w-16"
                    />
                  )}
                </div>
              </div>
            </Card>
          </div>

          <Card title="Scan Progress" bodyClassName="flex flex-col gap-3 p-3">
            <div className="flex gap-2">
              <Button variant="primary" icon={Play} onClick={startScan} disabled={scan.status === "running"} className="flex-1">
                Start Scan
              </Button>
              <Button icon={Square} disabled={scan.status !== "running"} onClick={scan.stop}>Stop</Button>
            </div>
            <ProgressBar value={scan.progress} showLabel tone={scan.status === "completed" ? "success" : "accent"} />
            <dl className="grid grid-cols-[1fr_auto] gap-y-1.5 text-[12px]">
              <dt className="text-fg-muted">Scanned:</dt>
              <dd className="text-right text-fg">{scannedHosts} / {TOTAL_HOSTS} hosts</dd>
              <dt className="text-fg-muted">Current IP:</dt>
              <dd className="text-right text-fg">192.168.1.{Math.min(254, scannedHosts)}</dd>
              <dt className="text-fg-muted">Open ports found:</dt>
              <dd className="text-right text-fg">{openPortsFound}</dd>
              <dt className="text-fg-muted">Elapsed time:</dt>
              <dd className="text-right text-fg">{formatDuration(scan.elapsedSeconds)}</dd>
              <dt className="text-fg-muted">Estimated time:</dt>
              <dd className="text-right text-fg">{scan.status === "running" ? formatDuration(estimatedSeconds) : "-"}</dd>
              <dt className="text-fg-muted">Scan speed:</dt>
              <dd className="text-right text-fg">{hostsPerSecond.toFixed(0)} hosts/sec</dd>
            </dl>
          </Card>
        </div>
      )}

      {(tab === "results" || tab === "live-view") && (
        <div className="grid min-h-0 flex-1 grid-cols-[1fr_280px] gap-3">
          <Card
            title={`Scan Results (${openPortsFound} open ports found)`}
            padded={false}
            bodyClassName="min-h-0 overflow-y-auto"
            className="min-h-0 flex-1"
          >
            <table className="w-full text-[12.5px]">
              <thead className="sticky top-0 bg-surface-alt">
                <tr className="border-b border-border text-left text-[11px] font-semibold text-fg-muted">
                  <th className="px-3 py-2">IP Address</th>
                  <th className="px-3 py-2">Hostname</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Port</th>
                  <th className="px-3 py-2">Service</th>
                  <th className="px-3 py-2">Version / Banner</th>
                </tr>
              </thead>
              <tbody>
                {portRows.map((row, i) => (
                  <tr
                    key={`${row.host.id}-${row.port}-${i}`}
                    onClick={() => setSelectedHostId(row.host.id)}
                    className={
                      "cursor-pointer border-b border-border/60 " +
                      (selectedHostId === row.host.id ? "bg-surface-selected" : "hover:bg-surface-hover")
                    }
                  >
                    <td className="px-3 py-1.5 font-medium text-fg">{row.host.ip}</td>
                    <td className="px-3 py-1.5 text-fg-muted">{row.host.hostname}</td>
                    <td className="px-3 py-1.5"><Badge tone="success" dot>Up</Badge></td>
                    <td className="px-3 py-1.5 text-right text-fg">{row.port}</td>
                    <td className="px-3 py-1.5 text-fg-muted">{row.service}</td>
                    <td className="px-3 py-1.5 text-fg-muted">{row.banner}</td>
                  </tr>
                ))}
                {portRows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-fg-subtle">
                      No hosts scanned yet - press Start Scan on the Scan tab.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {tab === "live-view" && scan.status === "running" && (
              <div className="border-t border-border p-2 text-[11px] text-fg-subtle">
                Live scanning in progress - {scannedHosts}/{TOTAL_HOSTS} hosts checked...
              </div>
            )}
          </Card>

          <Card title="Host Details" bodyClassName="flex flex-col gap-3 p-3">
            {selectedHost ? (
              <>
                <dl className="grid grid-cols-[70px_1fr] gap-y-1.5 text-[12.5px]">
                  <dt className="text-fg-muted">IP:</dt>
                  <dd className="text-fg">{selectedHost.ip}</dd>
                  <dt className="text-fg-muted">Hostname:</dt>
                  <dd className="text-fg">{selectedHost.hostname}</dd>
                  <dt className="text-fg-muted">MAC:</dt>
                  <dd className="text-fg">{selectedHost.mac}</dd>
                  <dt className="text-fg-muted">Vendor:</dt>
                  <dd className="text-fg">{selectedHost.vendor}</dd>
                  <dt className="text-fg-muted">Response:</dt>
                  <dd className="text-fg">{selectedHost.responseTimeMs} ms</dd>
                </dl>
                <div>
                  <div className="mb-1 text-[11px] font-medium text-fg-muted">Open Ports</div>
                  <div className="flex flex-col gap-1">
                    {selectedHost.ports.map((p) => (
                      <div key={p.port} className="flex items-center justify-between text-[12px]">
                        <span className="text-fg">{p.port} / {p.service}</span>
                        <span className="text-fg-subtle">{p.banner}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="mt-auto flex flex-col gap-1.5">
                  <div className="mb-1 text-[11px] font-medium text-fg-muted">Quick Actions</div>
                  <Button size="sm" icon={Copy} onClick={() => toast.success(`Copied ${selectedHost.ip} to clipboard.`)}>Copy IP</Button>
                  <Button size="sm" icon={Radar} onClick={() => toast.demo()}>Ping Host</Button>
                  <Button size="sm" icon={ExternalLink} onClick={() => toast.demo()}>Open in Browser</Button>
                  <Button size="sm" icon={Play} onClick={() => toast.demo()}>Scan Only This Host</Button>
                  <Button
                    size="sm"
                    icon={Star}
                    onClick={() => toggleFavorite(selectedHost.id)}
                    className={favorites.has(selectedHost.id) ? "text-warning" : ""}
                  >
                    {favorites.has(selectedHost.id) ? "Remove Favorite" : "Add to Favorites"}
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-xs text-fg-subtle">Select a host to see its details.</p>
            )}
          </Card>
        </div>
      )}

      {tab === "export" && (
        <Card title="Export Results">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-fg-muted">Format</label>
              <Select options={[{ value: "csv", label: "CSV" }, { value: "json", label: "JSON" }, { value: "html", label: "HTML report" }]} />
            </div>
            <Button variant="primary" icon={Download} className="self-start" onClick={() => toast.demo()}>
              Export Results...
            </Button>
          </div>
        </Card>
      )}

      {tab === "favorites" && (
        <Card title="Favorite Hosts" padded={false} bodyClassName="min-h-0">
          {favorites.size === 0 ? (
            <p className="p-4 text-xs text-fg-subtle">No favorites yet - star a host from the Results tab.</p>
          ) : (
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-border text-left text-[11px] font-semibold text-fg-muted">
                  <th className="px-3 py-2">IP Address</th>
                  <th className="px-3 py-2">Hostname</th>
                  <th className="px-3 py-2">Vendor</th>
                </tr>
              </thead>
              <tbody>
                {mockHosts.filter((h) => favorites.has(h.id)).map((h) => (
                  <tr key={h.id} className="border-b border-border/60">
                    <td className="px-3 py-2 text-fg">{h.ip}</td>
                    <td className="px-3 py-2 text-fg-muted">{h.hostname}</td>
                    <td className="px-3 py-2 text-fg-muted">{h.vendor}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </div>
  );
}
