import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Clock, Pause, Play, Square, ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/cards/Card";
import { LocationPicker } from "@/components/controls/LocationPicker";
import { RadioGroup } from "@/components/controls/RadioGroup";
import { Select } from "@/components/controls/Select";
import { Checkbox } from "@/components/controls/Checkbox";
import { Button } from "@/components/controls/Button";
import { Tabs } from "@/components/controls/Tabs";
import { ProgressBar } from "@/components/charts/ProgressBar";
import { LineChartPanel } from "@/components/charts/LineChartPanel";
import { DataTable, type DataTableColumn } from "@/components/tables/DataTable";
import { initialTransferFiles } from "@/mock/transfer";
import type { CollisionPolicy, TransferFileRow, TransferMode } from "@/models/transfer";
import { formatBytes, formatDuration, formatSpeed } from "@/utils/format";
import { useSimulatedProgress } from "@/hooks/useSimulatedProgress";
import { useUiStore } from "@/state/uiStore";
import { toast } from "@/state/toastStore";

const TABS = [
  { id: "file-list", label: "File List" },
  { id: "progress", label: "Progress" },
  { id: "log", label: "Transfer Log" },
];

const STATUS_ICON: Record<TransferFileRow["status"], { icon: typeof CheckCircle2; className: string }> = {
  done: { icon: CheckCircle2, className: "text-success" },
  "in-progress": { icon: ArrowRight, className: "text-accent" },
  queued: { icon: Clock, className: "text-fg-subtle" },
  error: { icon: Square, className: "text-danger" },
  skipped: { icon: Square, className: "text-fg-subtle" },
};

const totalBytes = initialTransferFiles.reduce((s, f) => s + f.size, 0);
const totalFiles = initialTransferFiles.length;

export function DataTransferPage() {
  const [source, setSource] = useState("D:\\Data\\Projects");
  const [destination, setDestination] = useState("E:\\Archive\\Projects");
  const [mode, setMode] = useState<TransferMode>("copy");
  const [collision, setCollision] = useState<CollisionPolicy>("skip-same");
  const [options, setOptions] = useState({
    createMissingFolders: true,
    verifyAfterTransfer: true,
    preservePermissions: true,
    includeSubfolders: true,
  });
  const [tab, setTab] = useState("progress");
  const [log, setLog] = useState<string[]>(["Ready. Configure the transfer above and press Start Transfer."]);
  const [speedHistory, setSpeedHistory] = useState<{ t: number; mbps: number }[]>([]);
  const lastSecondRef = useRef(-1);
  const setStatusText = useUiStore((s) => s.setStatusText);

  const transfer = useSimulatedProgress(() => {
    setStatusText("Ready");
    setLog((l) => [...l, `Transfer completed - ${totalFiles} files, ${formatBytes(totalBytes)}.`]);
    toast.success("Transfer completed successfully.");
  });

  const speedBps = 60 * 1024 * 1024 + Math.sin(transfer.elapsedSeconds / 2) * 25 * 1024 * 1024;

  useEffect(() => {
    if (transfer.status !== "running") return;
    const sec = Math.floor(transfer.elapsedSeconds);
    if (sec !== lastSecondRef.current) {
      lastSecondRef.current = sec;
      setSpeedHistory((h) => [...h.slice(-29), { t: sec, mbps: Math.round(speedBps / (1024 * 1024)) }]);
    }
  }, [transfer.elapsedSeconds, transfer.status, speedBps]);

  const { rows, bytesProcessed, filesProcessed, currentFile } = useMemo(() => {
    const bytesDone = totalBytes * (transfer.progress / 100);
    const initial = { cursor: 0, rows: [] as TransferFileRow[], doneCount: 0, currentFileName: "-" };
    const result = initialTransferFiles.reduce((state, f) => {
      const start = state.cursor;
      const cursor = start + f.size;
      if (bytesDone >= cursor) {
        return {
          ...state,
          cursor,
          rows: [...state.rows, { ...f, status: "done" as const, progress: 100, speedBps: 0, etaSeconds: 0 }],
          doneCount: state.doneCount + 1,
        };
      }
      if (bytesDone > start) {
        const fileProgress = ((bytesDone - start) / f.size) * 100;
        const remaining = f.size - (bytesDone - start);
        return {
          ...state,
          cursor,
          rows: [
            ...state.rows,
            {
              ...f,
              status: "in-progress" as const,
              progress: fileProgress,
              speedBps,
              etaSeconds: speedBps > 0 ? remaining / speedBps : null,
            },
          ],
          currentFileName: f.fileName,
        };
      }
      return { ...state, cursor, rows: [...state.rows, { ...f, status: "queued" as const, progress: 0, speedBps: 0, etaSeconds: null }] };
    }, initial);
    return {
      rows: result.rows,
      bytesProcessed: Math.min(bytesDone, totalBytes),
      filesProcessed: result.doneCount,
      currentFile: result.currentFileName,
    };
  }, [transfer.progress, speedBps]);

  const remainingSeconds = speedBps > 0 ? (totalBytes - bytesProcessed) / speedBps : 0;

  function startTransfer() {
    setLog((l) => [...l, `Starting ${mode} from ${source} to ${destination}...`]);
    setSpeedHistory([]);
    lastSecondRef.current = -1;
    setStatusText(`${mode[0].toUpperCase()}${mode.slice(1)}ing files...`);
    transfer.start(20);
  }

  const columns: DataTableColumn<TransferFileRow>[] = [
    {
      key: "status",
      header: "Status",
      width: 90,
      render: (r) => {
        const s = STATUS_ICON[r.status];
        return <s.icon size={14} className={s.className} />;
      },
    },
    { key: "fileName", header: "File Name", width: 200, sortAccessor: (r) => r.fileName, render: (r) => r.fileName },
    { key: "source", header: "Source Path", width: 200, render: (r) => <span className="truncate text-fg-muted">{r.sourcePath}</span> },
    { key: "dest", header: "Destination Path", width: 200, render: (r) => <span className="truncate text-fg-muted">{r.destPath}</span> },
    { key: "size", header: "Size", width: 90, align: "right", sortAccessor: (r) => r.size, render: (r) => formatBytes(r.size) },
    { key: "progress", header: "Progress", width: 140, render: (r) => <ProgressBar value={r.progress} showLabel height={6} /> },
    { key: "speed", header: "Speed", width: 100, align: "right", render: (r) => (r.status === "in-progress" ? formatSpeed(r.speedBps) : "-") },
    { key: "eta", header: "ETA", width: 90, align: "right", render: (r) => (r.etaSeconds != null && r.status === "in-progress" ? formatDuration(r.etaSeconds) : "-") },
  ];

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <PageHeader title="Data Transfer" description="Copy, move, sync or mirror files and folders with detailed progress." />

      <div className="flex items-stretch gap-3">
        <Card title="Source" className="flex-1">
          <LocationPicker value={source} onChange={setSource} />
        </Card>
        <Card title="Destination" className="flex-1">
          <LocationPicker value={destination} onChange={setDestination} />
        </Card>
        <Card title="Transfer Mode" className="w-[170px] shrink-0">
          <RadioGroup
            name="mode"
            value={mode}
            onChange={setMode}
            options={[
              { value: "copy", label: "Copy" },
              { value: "move", label: "Move" },
              { value: "sync", label: "Sync" },
              { value: "mirror", label: "Mirror" },
            ]}
          />
        </Card>
        <Card title="If File Exists" className="w-[230px] shrink-0">
          <Select
            value={collision}
            onChange={(e) => setCollision(e.target.value as CollisionPolicy)}
            options={[
              { value: "skip-same", label: "Skip if same size/date" },
              { value: "compare-hash", label: "Compare hash" },
              { value: "rename-new", label: "Rename new file" },
              { value: "overwrite-older", label: "Overwrite older file" },
            ]}
          />
          <div className="mt-2.5 flex flex-col gap-1.5">
            <Checkbox checked={options.createMissingFolders} onChange={(v) => setOptions((o) => ({ ...o, createMissingFolders: v }))} label="Create missing folders" />
            <Checkbox checked={options.verifyAfterTransfer} onChange={(v) => setOptions((o) => ({ ...o, verifyAfterTransfer: v }))} label="Verify files after transfer" />
            <Checkbox checked={options.preservePermissions} onChange={(v) => setOptions((o) => ({ ...o, preservePermissions: v }))} label="Preserve NTFS permissions" />
            <Checkbox checked={options.includeSubfolders} onChange={(v) => setOptions((o) => ({ ...o, includeSubfolders: v }))} label="Include subfolders" />
          </div>
        </Card>
      </div>

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {tab === "file-list" && (
          <Card padded={false} bodyClassName="h-full" className="min-h-0 flex-1">
            <DataTable columns={columns} rows={rows} getRowId={(r) => r.id} className="h-full border-0 rounded-none" />
          </Card>
        )}

        {tab === "progress" && (
          <>
            <Card>
              <div className="flex items-center justify-between text-[12.5px] text-fg-muted">
                <span>
                  {transfer.status === "running" ? "Transferring files..." : transfer.status === "completed" ? "Completed successfully" : "Idle"}
                </span>
                <span className="font-semibold text-fg">{transfer.progress.toFixed(0)}%</span>
              </div>
              <ProgressBar value={transfer.progress} tone={transfer.status === "completed" ? "success" : "accent"} className="mt-2" height={10} />
              <div className="mt-2 grid grid-cols-5 gap-3 text-[12px] text-fg-muted">
                <div>Processed: <span className="text-fg">{filesProcessed} / {totalFiles} files</span></div>
                <div>Bytes: <span className="text-fg">{formatBytes(bytesProcessed)} / {formatBytes(totalBytes)}</span></div>
                <div>Speed: <span className="text-fg">{transfer.status === "running" ? formatSpeed(speedBps) : "-"}</span></div>
                <div>Elapsed: <span className="text-fg">{formatDuration(transfer.elapsedSeconds)}</span></div>
                <div>Remaining: <span className="text-fg">{transfer.status === "running" ? formatDuration(remainingSeconds) : "-"}</span></div>
              </div>
              <div className="mt-2 text-[12px] text-fg-muted">
                Current file: <span className="text-fg">{transfer.status === "running" ? currentFile : "-"}</span>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <Button variant="primary" icon={Play} onClick={startTransfer} disabled={transfer.status === "running"}>
                  Start Transfer
                </Button>
                <Button
                  icon={Pause}
                  disabled={transfer.status !== "running"}
                  onClick={() => {
                    transfer.pause();
                    setLog((l) => [...l, "Transfer paused by user."]);
                  }}
                >
                  Pause
                </Button>
                <Button
                  variant="danger"
                  icon={Square}
                  disabled={transfer.status !== "running" && transfer.status !== "paused"}
                  onClick={() => {
                    transfer.stop();
                    setLog((l) => [...l, "Transfer stopped by user."]);
                  }}
                >
                  Stop
                </Button>
                {transfer.status === "paused" && <Button icon={Play} onClick={transfer.resume}>Resume</Button>}
              </div>
            </Card>

            <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
              <Card title="Transfer Statistics">
                <dl className="grid grid-cols-[110px_1fr] gap-y-1.5 text-[12.5px]">
                  <dt className="text-fg-muted">Files processed:</dt>
                  <dd className="text-fg">{filesProcessed} / {totalFiles}</dd>
                  <dt className="text-fg-muted">Total size:</dt>
                  <dd className="text-fg">{formatBytes(totalBytes)}</dd>
                  <dt className="text-fg-muted">Average speed:</dt>
                  <dd className="text-fg">{transfer.status === "running" ? formatSpeed(speedBps) : "-"}</dd>
                  <dt className="text-fg-muted">Errors:</dt>
                  <dd className="text-fg">0</dd>
                </dl>
              </Card>
              <Card title="Transfer Speed">
                <LineChartPanel
                  data={speedHistory.length ? speedHistory : [{ t: 0, mbps: 0 }]}
                  categoryKey="t"
                  series={[{ key: "mbps", label: "MB/s", color: "var(--color-chart-1)" }]}
                  valueFormatter={(v) => `${v} MB/s`}
                  height={140}
                />
              </Card>
            </div>

            <Card title="Actions After Completion">
              <div className="flex flex-wrap gap-4">
                <Checkbox checked onChange={() => toast.demo()} label="Show report" />
                <Checkbox checked onChange={() => toast.demo()} label="Open destination folder" />
                <Checkbox checked={false} onChange={() => toast.demo()} label="Shut down computer" />
              </div>
            </Card>
          </>
        )}

        {tab === "log" && (
          <Card padded={false} bodyClassName="h-full overflow-y-auto p-3 font-mono text-[12px] text-fg-muted" className="flex-1">
            {log.map((line, i) => (
              <div key={i}>[{new Date().toLocaleTimeString()}] {line}</div>
            ))}
          </Card>
        )}
      </div>
    </div>
  );
}
