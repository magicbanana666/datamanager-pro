import { useEffect, useState, type ReactNode } from "react";
import { CheckCircle2, Copy, FolderOpen, Loader2, XCircle } from "lucide-react";
import { Dialog } from "@/components/dialogs/Dialog";
import { Button } from "@/components/controls/Button";
import { TextInput } from "@/components/controls/TextInput";
import { Badge } from "@/components/controls/Badge";
import { confirmAction, pickFile, pickFolder, pickSaveFile } from "@/api/dialog";
import { getFileMetadata, getFolderMetadata, getSystemInfo, listStorageVolumes, toAppError, validatePath } from "@/api/backend";
import { openFolder } from "@/api/transfer";
import { logsFolder } from "@/api/diagnostics";
import {
  diskHealth,
  dnsLookup,
  fileDigests,
  mergeFileParts,
  pingHost,
  readLatestLog,
  runScript,
  shredFiles,
  splitFile,
  unzipArchive,
  wakeOnLan,
  zipFiles,
  type Digests,
  type PhysicalDisk,
} from "@/api/tools";
import type { ToolDialogId } from "@/models/tools";
import type { StorageVolume, SystemInfo } from "@/models/backend";
import { formatBytes, formatDate, formatNumber } from "@/utils/format";
import { toast } from "@/state/toastStore";

const TITLES: Record<ToolDialogId, string> = {
  explorer: "File Explorer",
  properties: "File Properties",
  hash: "Hash Calculator",
  split: "File Splitter",
  merge: "File Merger",
  shred: "File Shredder",
  "disk-health": "Disk Health",
  "system-info": "System Info",
  ping: "Ping Tool",
  dns: "IP Lookup",
  wol: "Wake-on-LAN",
  zip: "Archive / Compress",
  unzip: "Extract Archive",
  verify: "Checksum Verifier",
  script: "Custom Script Runner",
  logs: "Log Viewer",
};

const label = "text-[11px] font-medium text-fg-muted";

function errorText(err: unknown): string {
  return toAppError(err).message;
}

/** A path field with a Browse button. */
function PathField({ title, value, onChange, pick }: { title: string; value: string; onChange: (v: string) => void; pick: () => Promise<string | null> }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className={label}>{title}</label>
      <div className="flex gap-2">
        <TextInput value={value} onChange={(e) => onChange(e.target.value)} containerClassName="flex-1" />
        <Button onClick={() => pick().then((p) => p && onChange(p))}>Browse...</Button>
      </div>
    </div>
  );
}

function Mono({ children }: { children: ReactNode }) {
  return <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap rounded-md border border-border bg-surface-alt p-2 font-mono text-[11.5px] text-fg">{children}</pre>;
}

function HashRow({ name, value }: { name: string; value: string }) {
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <span className="w-14 shrink-0 text-fg-muted">{name}</span>
      <code className="min-w-0 flex-1 break-all font-mono text-fg">{value}</code>
      <button title="Copy" className="cursor-pointer text-fg-muted hover:text-fg" onClick={() => navigator.clipboard.writeText(value).then(() => toast.success(`${name} copied.`))}>
        <Copy size={13} />
      </button>
    </div>
  );
}

/** Runs one async action at a time, with its result or error. */
function useRun<T>() {
  const [state, setState] = useState<{ busy: boolean; result?: T; error?: string }>({ busy: false });
  const run = (f: () => Promise<T>) => {
    setState({ busy: true });
    f().then(
      (result) => setState({ busy: false, result }),
      (err) => setState({ busy: false, error: errorText(err) }),
    );
  };
  return { ...state, run, reset: () => setState({ busy: false }) };
}

function Status({ busy, error, children }: { busy: boolean; error?: string; children?: ReactNode }) {
  if (busy) return <div className="flex items-center gap-2 text-[12px] text-fg-muted"><Loader2 size={14} className="animate-spin" /> Working...</div>;
  if (error) return <p className="text-[12px] text-danger">{error}</p>;
  return <>{children}</>;
}

function PropertiesTool() {
  const [path, setPath] = useState("");
  const r = useRun<{ rows: [string, string][] }>();
  const load = (p: string) =>
    r.run(async () => {
      const v = await validatePath(p);
      if (!v.exists) throw new Error("That path doesn't exist.");
      if (v.isDirectory) {
        const m = await getFolderMetadata(v.normalizedPath ?? p);
        return {
          rows: [
            ["Path", m.path],
            ["Type", "Folder"],
            ["Contains", `${formatNumber(m.directFileCount)} files (${formatBytes(m.directFileBytes)}), ${formatNumber(m.directFolderCount)} folders (direct)`],
            ["Created", formatDate(m.created)],
            ["Modified", formatDate(m.modified)],
            ["Accessed", formatDate(m.accessed)],
            ["Attributes", m.attributes.join(", ") || "-"],
          ],
        };
      }
      const m = await getFileMetadata(v.normalizedPath ?? p);
      return {
        rows: [
          ["Path", m.path],
          ["Type", m.extension ? `${m.extension.toUpperCase()} file` : "File"],
          ["Size", `${formatBytes(m.sizeBytes)} (${formatNumber(m.sizeBytes)} bytes)`],
          ["Size on disk", m.allocatedSizeBytes != null ? formatBytes(m.allocatedSizeBytes) : "-"],
          ["Created", formatDate(m.created)],
          ["Modified", formatDate(m.modified)],
          ["Accessed", formatDate(m.accessed)],
          ["Owner", m.owner ?? "-"],
          ["Attributes", m.attributes.join(", ") || "-"],
        ],
      };
    });
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <TextInput value={path} onChange={(e) => setPath(e.target.value)} placeholder="A file or folder" containerClassName="flex-1" onKeyDown={(e) => e.key === "Enter" && load(path)} />
        <Button onClick={() => pickFile().then((p) => p && (setPath(p), load(p)))}>File...</Button>
        <Button onClick={() => pickFolder().then((p) => p && (setPath(p), load(p)))}>Folder...</Button>
        <Button variant="primary" disabled={!path.trim()} onClick={() => load(path)}>Show</Button>
      </div>
      <Status busy={r.busy} error={r.error}>
        {r.result && (
          <dl className="grid grid-cols-[110px_1fr] gap-y-1.5 text-[12.5px]">
            {r.result.rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-fg-muted">{k}:</dt>
                <dd className="break-all text-fg">{v}</dd>
              </div>
            ))}
          </dl>
        )}
      </Status>
    </div>
  );
}

function HashTool({ verify }: { verify: boolean }) {
  const [path, setPath] = useState("");
  const [expected, setExpected] = useState("");
  const r = useRun<Digests>();
  const want = expected.trim().toLowerCase();
  const match = r.result && want ? [r.result.md5, r.result.sha1, r.result.sha256].includes(want) : null;
  return (
    <div className="flex flex-col gap-3">
      <PathField title="File" value={path} onChange={setPath} pick={() => pickFile()} />
      {verify && (
        <div className="flex flex-col gap-1.5">
          <label className={label}>Expected checksum (MD5, SHA-1 or SHA-256)</label>
          <TextInput value={expected} onChange={(e) => setExpected(e.target.value)} placeholder="Paste the published checksum" />
        </div>
      )}
      <Button variant="primary" className="self-start" disabled={!path.trim() || r.busy || (verify && !want)} onClick={() => r.run(() => fileDigests(path.trim()))}>
        {verify ? "Verify" : "Calculate"}
      </Button>
      <Status busy={r.busy} error={r.error}>
        {r.result && (
          <div className="flex flex-col gap-1.5">
            {verify && match != null && (
              <Badge tone={match ? "success" : "danger"} className="self-start">
                {match ? <CheckCircle2 size={12} /> : <XCircle size={12} />} {match ? "Checksum matches" : "Checksum does NOT match"}
              </Badge>
            )}
            <span className="text-[12px] text-fg-muted">{formatBytes(r.result.size)}</span>
            <HashRow name="MD5" value={r.result.md5} />
            <HashRow name="SHA-1" value={r.result.sha1} />
            <HashRow name="SHA-256" value={r.result.sha256} />
          </div>
        )}
      </Status>
    </div>
  );
}

function SplitTool() {
  const [path, setPath] = useState("");
  const [dest, setDest] = useState("");
  const [mb, setMb] = useState("1024");
  const r = useRun<string[]>();
  const size = Math.round(Number(mb.replace(",", ".")) * 1024 * 1024);
  return (
    <div className="flex flex-col gap-3">
      <PathField title="File to split" value={path} onChange={setPath} pick={() => pickFile()} />
      <PathField title="Save the parts in" value={dest} onChange={setDest} pick={() => pickFolder()} />
      <div className="flex flex-col gap-1.5">
        <label className={label}>Part size (MB)</label>
        <TextInput value={mb} onChange={(e) => setMb(e.target.value)} containerClassName="w-[140px]" />
      </div>
      <Button variant="primary" className="self-start" disabled={!path || !dest || !(size > 0) || r.busy} onClick={() => r.run(() => splitFile(path, size, dest))}>
        Split
      </Button>
      <Status busy={r.busy} error={r.error}>
        {r.result && <p className="text-[12px] text-success">{r.result.length} parts written ({r.result[0]} ...). Join them with the File Merger.</p>}
      </Status>
    </div>
  );
}

function MergeTool() {
  const [first, setFirst] = useState("");
  const [dest, setDest] = useState("");
  const r = useRun<string>();
  return (
    <div className="flex flex-col gap-3">
      <PathField title="First part (.001)" value={first} onChange={setFirst} pick={() => pickFile()} />
      <PathField title="Save the joined file in" value={dest} onChange={setDest} pick={() => pickFolder()} />
      <Button variant="primary" className="self-start" disabled={!first || !dest || r.busy} onClick={() => r.run(() => mergeFileParts(first, dest))}>
        Join parts
      </Button>
      <Status busy={r.busy} error={r.error}>{r.result && <p className="text-[12px] text-success">Joined into {r.result}.</p>}</Status>
    </div>
  );
}

function ShredTool() {
  const [path, setPath] = useState("");
  const r = useRun<string>();
  async function shred() {
    const ok = await confirmAction(
      `Overwrite and permanently delete ${path}? This can't be undone and the file does NOT go to the Recycle Bin.`,
      "Shred file",
      "Shred",
    );
    if (!ok) return;
    r.run(async () => {
      const out = await shredFiles([path]);
      if (out.errors.length) throw new Error(out.errors[0].message);
      setPath("");
      return "The file was overwritten and deleted.";
    });
  }
  return (
    <div className="flex flex-col gap-3">
      <PathField title="File" value={path} onChange={setPath} pick={() => pickFile()} />
      <p className="text-[11.5px] text-fg-muted">
        The file is overwritten once with random data, renamed and deleted. On SSDs and USB sticks the drive itself may keep old copies of
        blocks (wear levelling), so for those, full-disk encryption is the reliable protection.
      </p>
      <Button variant="danger" className="self-start" disabled={!path || r.busy} onClick={() => void shred()}>Shred</Button>
      <Status busy={r.busy} error={r.error}>{r.result && <p className="text-[12px] text-success">{r.result}</p>}</Status>
    </div>
  );
}

function ZipTool() {
  const [source, setSource] = useState("");
  const r = useRun<string>();
  async function zip() {
    const name = (source.split("\\").filter(Boolean).pop() ?? "archive").replace(/:$/, "");
    const dest = await pickSaveFile(`${name}.zip`, [{ name: "ZIP", extensions: ["zip"] }]);
    if (!dest) return;
    r.run(async () => `${formatNumber(await zipFiles(source, dest))} files compressed into ${dest}.`);
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label className={label}>File or folder to compress</label>
        <div className="flex gap-2">
          <TextInput value={source} onChange={(e) => setSource(e.target.value)} containerClassName="flex-1" />
          <Button onClick={() => pickFile().then((p) => p && setSource(p))}>File...</Button>
          <Button onClick={() => pickFolder().then((p) => p && setSource(p))}>Folder...</Button>
        </div>
      </div>
      <Button variant="primary" className="self-start" disabled={!source || r.busy} onClick={() => void zip()}>Create ZIP...</Button>
      <Status busy={r.busy} error={r.error}>{r.result && <p className="text-[12px] text-success">{r.result}</p>}</Status>
    </div>
  );
}

function UnzipTool() {
  const [archive, setArchive] = useState("");
  const [dest, setDest] = useState("");
  const r = useRun<number>();
  return (
    <div className="flex flex-col gap-3">
      <PathField title="ZIP archive" value={archive} onChange={setArchive} pick={() => pickFile()} />
      <PathField title="Extract to" value={dest} onChange={setDest} pick={() => pickFolder()} />
      <Button variant="primary" className="self-start" disabled={!archive || !dest || r.busy} onClick={() => r.run(() => unzipArchive(archive, dest))}>Extract</Button>
      <Status busy={r.busy} error={r.error}>
        {r.result != null && (
          <div className="flex items-center gap-2 text-[12px] text-success">
            {formatNumber(r.result)} files extracted.
            <Button size="sm" icon={FolderOpen} onClick={() => openFolder(dest).catch(() => {})}>Open</Button>
          </div>
        )}
      </Status>
    </div>
  );
}

function PingTool() {
  const [host, setHost] = useState("");
  const r = useRun<string>();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <TextInput value={host} onChange={(e) => setHost(e.target.value)} placeholder="Host name or IP address" containerClassName="flex-1" onKeyDown={(e) => e.key === "Enter" && host && r.run(() => pingHost(host))} />
        <Button variant="primary" disabled={!host.trim() || r.busy} onClick={() => r.run(() => pingHost(host))}>Ping</Button>
      </div>
      <Status busy={r.busy} error={r.error}>{r.result && <Mono>{r.result}</Mono>}</Status>
    </div>
  );
}

function DnsTool() {
  const [host, setHost] = useState("");
  const r = useRun<string[]>();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <TextInput value={host} onChange={(e) => setHost(e.target.value)} placeholder="Host name, e.g. server.domain.local" containerClassName="flex-1" onKeyDown={(e) => e.key === "Enter" && host && r.run(() => dnsLookup(host))} />
        <Button variant="primary" disabled={!host.trim() || r.busy} onClick={() => r.run(() => dnsLookup(host))}>Look up</Button>
      </div>
      <Status busy={r.busy} error={r.error}>
        {r.result && (r.result.length ? <Mono>{r.result.join("\n")}</Mono> : <p className="text-[12px] text-fg-muted">No addresses.</p>)}
      </Status>
    </div>
  );
}

function WolTool() {
  const [mac, setMac] = useState("");
  const [broadcast, setBroadcast] = useState("");
  const r = useRun<string>();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label className={label}>MAC address</label>
        <TextInput value={mac} onChange={(e) => setMac(e.target.value)} placeholder="AA:BB:CC:DD:EE:FF" />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className={label}>Broadcast address (optional, e.g. 192.168.1.255)</label>
        <TextInput value={broadcast} onChange={(e) => setBroadcast(e.target.value)} placeholder="255.255.255.255" />
      </div>
      <Button variant="primary" className="self-start" disabled={!mac.trim() || r.busy} onClick={() => r.run(async () => (await wakeOnLan(mac, broadcast), `Magic packet sent to ${mac}.`))}>
        Wake
      </Button>
      <p className="text-[11.5px] text-fg-muted">The target needs Wake-on-LAN enabled in its BIOS/UEFI and network adapter settings.</p>
      <Status busy={r.busy} error={r.error}>{r.result && <p className="text-[12px] text-success">{r.result}</p>}</Status>
    </div>
  );
}

function ScriptTool() {
  const [path, setPath] = useState("");
  const r = useRun<string>();
  return (
    <div className="flex flex-col gap-3">
      <PathField title="Script (.bat, .cmd or .ps1)" value={path} onChange={setPath} pick={() => pickFile()} />
      <p className="text-[11.5px] text-fg-muted">The script runs in its own console window (with the app's rights - administrator), starting in its own folder.</p>
      <Button variant="primary" className="self-start" disabled={!path || r.busy} onClick={() => r.run(async () => (await runScript(path), "Started."))}>Run</Button>
      <Status busy={r.busy} error={r.error}>{r.result && <p className="text-[12px] text-success">{r.result}</p>}</Status>
    </div>
  );
}

function DiskHealthTool() {
  const r = useRun<PhysicalDisk[]>();
  const [started, setStarted] = useState(false);
  if (!started) {
    setStarted(true);
    r.run(diskHealth);
  }
  const tone = (s: string | null) => (s === "Healthy" ? "success" : s === "Warning" ? "warning" : s ? "danger" : "neutral");
  return (
    <Status busy={r.busy} error={r.error}>
      {r.result && (
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] font-semibold text-fg-muted">
              <th className="px-2 py-1.5">Disk</th>
              <th className="px-2 py-1.5">Type</th>
              <th className="px-2 py-1.5 text-right">Size</th>
              <th className="px-2 py-1.5">Health</th>
              <th className="px-2 py-1.5">Status</th>
            </tr>
          </thead>
          <tbody>
            {r.result.map((d, i) => (
              <tr key={i} className="border-b border-border/60">
                <td className="px-2 py-1.5 text-fg">{d.FriendlyName}</td>
                <td className="px-2 py-1.5 text-fg-muted">{[d.MediaType, d.BusType].filter((x) => x && x !== "Unspecified").join(" / ") || "-"}</td>
                <td className="px-2 py-1.5 text-right text-fg-muted">{d.Size != null ? formatBytes(d.Size) : "-"}</td>
                <td className="px-2 py-1.5"><Badge tone={tone(d.HealthStatus)}>{d.HealthStatus ?? "Unknown"}</Badge></td>
                <td className="px-2 py-1.5 text-fg-muted">{d.OperationalStatus}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Status>
  );
}

function SystemInfoTool() {
  const [info, setInfo] = useState<{ system: SystemInfo; volumes: StorageVolume[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    Promise.all([getSystemInfo(), listStorageVolumes()]).then(
      ([system, volumes]) => setInfo({ system, volumes }),
      (err) => setError(errorText(err)),
    );
  }, []);
  if (error) return <p className="text-[12px] text-danger">{error}</p>;
  if (!info) return <Status busy />;
  const s = info.system;
  return (
    <div className="flex flex-col gap-3 text-[12.5px]">
      <dl className="grid grid-cols-[130px_1fr] gap-y-1.5">
        <dt className="text-fg-muted">Computer:</dt>
        <dd className="text-fg">{s.hostname ?? "-"}</dd>
        <dt className="text-fg-muted">Operating system:</dt>
        <dd className="text-fg">{s.os} {s.osVersion} ({s.architecture})</dd>
        <dt className="text-fg-muted">Logical CPU cores:</dt>
        <dd className="text-fg">{s.cpuLogicalCores}</dd>
        <dt className="text-fg-muted">Memory:</dt>
        <dd className="text-fg">{formatBytes(s.totalMemoryBytes)} ({formatBytes(s.availableMemoryBytes)} available)</dd>
      </dl>
      <div className="flex flex-col gap-1">
        {info.volumes.map((v) => (
          <div key={v.id} className="flex justify-between gap-2">
            <span className="text-fg">{v.name} · {v.fileSystem ?? "?"}</span>
            <span className="text-fg-muted">{formatBytes(v.freeBytes)} free of {formatBytes(v.totalBytes)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LogTool() {
  const r = useRun<string>();
  const [started, setStarted] = useState(false);
  if (!started) {
    setStarted(true);
    r.run(() => readLatestLog(1000));
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Button size="sm" onClick={() => r.run(() => readLatestLog(1000))}>Refresh</Button>
        <Button size="sm" icon={FolderOpen} onClick={() => logsFolder().then(openFolder).catch(() => {})}>Open logs folder</Button>
      </div>
      <Status busy={r.busy} error={r.error}>{r.result != null && <Mono>{r.result || "(empty)"}</Mono>}</Status>
    </div>
  );
}

function ExplorerTool({ onDone }: { onDone: () => void }) {
  const [path, setPath] = useState("");
  return (
    <div className="flex flex-col gap-3">
      <PathField title="Folder" value={path} onChange={setPath} pick={() => pickFolder()} />
      <Button
        variant="primary"
        icon={FolderOpen}
        className="self-start"
        disabled={!path.trim()}
        onClick={() =>
          openFolder(path.trim())
            .then(onDone)
            .catch((e) => toast.danger(errorText(e)))
        }
      >
        Open in Explorer
      </Button>
    </div>
  );
}

export function ToolDialog({ dialog, onClose }: { dialog: ToolDialogId | null; onClose: () => void }) {
  if (!dialog) return null;
  const body = {
    explorer: <ExplorerTool onDone={onClose} />,
    properties: <PropertiesTool />,
    hash: <HashTool verify={false} />,
    verify: <HashTool verify />,
    split: <SplitTool />,
    merge: <MergeTool />,
    shred: <ShredTool />,
    "disk-health": <DiskHealthTool />,
    "system-info": <SystemInfoTool />,
    ping: <PingTool />,
    dns: <DnsTool />,
    wol: <WolTool />,
    zip: <ZipTool />,
    unzip: <UnzipTool />,
    script: <ScriptTool />,
    logs: <LogTool />,
  }[dialog];
  return (
    <Dialog open onClose={onClose} title={TITLES[dialog]} width={dialog === "logs" || dialog === "disk-health" ? 820 : 600} footer={<Button onClick={onClose}>Close</Button>}>
      {body}
    </Dialog>
  );
}
