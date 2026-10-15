import { useMemo, useState } from "react";
import { FolderOpen, Pause, Play, Square } from "lucide-react";
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
import { DataTable } from "@/components/tables/DataTable";
import {
  InterruptedTransfersCard,
  TransferLogCard,
  TransferReportCard,
} from "@/components/transfer/transferUi";
import { planColumns } from "@/components/transfer/planColumns";
import { openFolder } from "@/api/transfer";
import { toAppError } from "@/api/backend";
import {
  DEFAULT_TRANSFER_OPTIONS,
  type BackendTransferMode,
  type CollisionPolicy,
  type TransferMode,
} from "@/models/transfer";
import { formatBytes, formatDuration, formatNumber, formatSpeed } from "@/utils/format";
import { cancelScheduledShutdown, useTransferStore } from "@/state/transferStore";
import { toast } from "@/state/toastStore";
import { useSettingsStore } from "@/state/settingsStore";

const TABS = [
  { id: "file-list", label: "File List" },
  { id: "progress", label: "Progress" },
  { id: "report", label: "Report" },
  { id: "log", label: "Transfer Log" },
];

const TO_BACKEND: Record<TransferMode, BackendTransferMode> = {
  copy: "copy",
  move: "move",
  sync: "incremental",
  mirror: "mirror",
};

function fromBackend(mode: BackendTransferMode | undefined): TransferMode {
  if (mode === "move" || mode === "mirror") return mode;
  if (mode === "incremental" || mode === "update-newer" || mode === "two-way") return "sync";
  return "copy";
}

export function DataTransferPage() {
  const run = useTransferStore();
  // Starts from the last request, so navigating back mid-transfer
  // shows what's running.
  const [source, setSource] = useState(() => useTransferStore.getState().request?.source ?? "");
  const [destination, setDestination] = useState(() => useTransferStore.getState().request?.destination ?? "");
  const [mode, setMode] = useState<TransferMode>(() => fromBackend(useTransferStore.getState().request?.mode));
  // A new transfer starts from Settings > File Operations.
  const [collision, setCollision] = useState<CollisionPolicy>(
    () => useTransferStore.getState().request?.collision ?? useSettingsStore.getState().settings.fileOperations.defaultCollisionBehavior,
  );
  const [options, setOptions] = useState(() => {
    const ops = useSettingsStore.getState().settings.fileOperations;
    return (
      useTransferStore.getState().request?.options ?? {
        ...DEFAULT_TRANSFER_OPTIONS,
        verifyAfterTransfer: ops.verifyAfterCopy,
        preserveTimestamps: ops.preserveTimestamps,
      }
    );
  });
  const [tab, setTab] = useState("progress");
  const [shutdownPending, setShutdownPending] = useState(false);

  // "Show report" after completion: switch to the Report tab (adjusting
  // state during render, the same pattern the analysis pages use).
  const [seenReportRequest, setSeenReportRequest] = useState(run.reportRequested);
  if (run.reportRequested !== seenReportRequest) {
    setSeenReportRequest(run.reportRequested);
    setTab("report");
  }

  const busy = run.status === "running" || run.status === "analyzing";
  const progress = run.progress;
  const paused = !!progress?.paused;
  const rows = run.plan?.rows ?? [];
  const active = useMemo(
    () => new Map((progress?.active ?? []).map((a) => [a.id, a.size ? (a.bytesDone / a.size) * 100 : 0])),
    [progress?.active],
  );
  const columns = useMemo(() => planColumns(run.rowStates, active), [run.rowStates, active]);

  const bytesTotal = progress?.bytesTotal ?? 0;
  const bytesDone = progress?.bytesDone ?? 0;
  const percent =
    run.status === "completed" ? 100 : bytesTotal > 0 ? (bytesDone / bytesTotal) * 100 : progress?.filesTotal ? (progress.filesDone / progress.filesTotal) * 100 : 0;
  const speed = busy && !paused ? (progress?.speedBps ?? 0) : 0;
  const remainingSeconds = speed > 0 ? (bytesTotal - bytesDone) / speed : null;
  const elapsed = (progress?.elapsedMs ?? 0) / 1000;
  const averageSpeed = elapsed > 0 ? bytesDone / elapsed : 0;

  function startTransfer() {
    if (!source.trim() || !destination.trim()) {
      toast.warning("Choose a source and a destination folder first.");
      return;
    }
    if (mode === "mirror") {
      toast.warning("Mirror deletes files at the destination that aren't in the source (to the Recycle Bin).", "Mirror mode");
    }
    setTab("progress");
    void run.start({ source, destination, mode: TO_BACKEND[mode], collision, options });
  }

  const statusText = {
    idle: "Idle",
    analyzing: `Analyzing... ${formatNumber(progress?.filesFound ?? 0)} files listed`,
    planned: "Planned",
    running: paused ? "Paused" : progress?.phase === "deleting" ? "Deleting extras..." : "Transferring files...",
    completed: "Completed",
    cancelled: run.resumable ? "Stopped - can be resumed" : "Cancelled",
    error: run.error?.message ?? "Failed",
  }[run.status];

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <PageHeader title="Data Transfer" description="Copy, move, sync or mirror files and folders with detailed progress." />

      <div className="flex items-stretch gap-3">
        <Card title="Source" className="flex-1">
          <LocationPicker value={source} onChange={setSource} placeholder="Folder to copy from" />
        </Card>
        <Card title="Destination" className="flex-1">
          <LocationPicker value={destination} onChange={setDestination} placeholder="Folder to copy to" />
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
            disabled={mode === "sync" || mode === "mirror"}
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

      <InterruptedTransfersCard
        status={run.status}
        onResume={(job) => {
          setSource(job.source);
          setDestination(job.destination);
          setMode(fromBackend(job.mode));
          setTab("progress");
          void run.resumeInterrupted(job.jobId);
        }}
      />

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {tab === "file-list" && (
          <Card padded={false} bodyClassName="h-full" className="min-h-0 flex-1">
            <DataTable
              columns={columns}
              rows={rows}
              getRowId={(r) => String(r.id)}
              className="h-full border-0 rounded-none"
              emptyMessage={run.status === "analyzing" ? "Analyzing..." : "Start a transfer to see its files here."}
            />
          </Card>
        )}

        {tab === "progress" && (
          <>
            <Card>
              <div className="flex items-center justify-between text-[12.5px] text-fg-muted">
                <span className={run.status === "error" ? "text-danger" : undefined}>{statusText}</span>
                <span className="font-semibold text-fg">{percent.toFixed(0)}%</span>
              </div>
              <ProgressBar
                value={percent}
                indeterminate={run.status === "analyzing"}
                tone={run.status === "completed" ? "success" : run.status === "error" ? "danger" : "accent"}
                className="mt-2"
                height={10}
              />
              <div className="mt-2 grid grid-cols-5 gap-3 text-[12px] text-fg-muted">
                <div>Processed: <span className="text-fg">{formatNumber(progress?.filesDone ?? 0)} / {formatNumber(progress?.filesTotal ?? 0)} files</span></div>
                <div>Bytes: <span className="text-fg">{formatBytes(bytesDone)} / {formatBytes(bytesTotal)}</span></div>
                <div>Speed: <span className="text-fg">{speed > 0 ? formatSpeed(speed) : "-"}</span></div>
                <div>Elapsed: <span className="text-fg">{formatDuration(elapsed)}</span></div>
                <div>Remaining: <span className="text-fg">{remainingSeconds != null ? formatDuration(remainingSeconds) : "-"}</span></div>
              </div>
              <div className="mt-2 truncate text-[12px] text-fg-muted">
                Current file: <span className="text-fg">{busy ? progress?.currentFile || "-" : "-"}</span>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <Button variant="primary" icon={Play} onClick={startTransfer} disabled={busy}>
                  Start Transfer
                </Button>
                {paused ? (
                  <Button icon={Play} onClick={() => void run.setPaused(false)}>Resume</Button>
                ) : (
                  <Button icon={Pause} disabled={run.status !== "running"} onClick={() => void run.setPaused(true)}>Pause</Button>
                )}
                <Button variant="danger" icon={Square} disabled={!busy} onClick={() => void run.cancel()}>
                  Stop
                </Button>
                {run.status === "completed" && run.report && (
                  <Button
                    icon={FolderOpen}
                    onClick={() => openFolder(run.report!.destination).catch((e) => toast.danger(toAppError(e).message))}
                  >
                    Open destination
                  </Button>
                )}
              </div>
            </Card>

            <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
              <Card title="Transfer Statistics">
                <dl className="grid grid-cols-[130px_1fr] gap-y-1.5 text-[12.5px]">
                  <dt className="text-fg-muted">Files processed:</dt>
                  <dd className="text-fg">{formatNumber(progress?.filesDone ?? 0)} / {formatNumber(progress?.filesTotal ?? 0)}</dd>
                  <dt className="text-fg-muted">Total size:</dt>
                  <dd className="text-fg">{formatBytes(bytesTotal)}</dd>
                  <dt className="text-fg-muted">Average speed:</dt>
                  <dd className="text-fg">{averageSpeed > 0 ? formatSpeed(averageSpeed) : "-"}</dd>
                  <dt className="text-fg-muted">Unchanged/skipped:</dt>
                  <dd className="text-fg">{formatNumber(run.plan?.summary.unchangedFiles ?? 0)}</dd>
                  <dt className="text-fg-muted">Errors:</dt>
                  <dd className={progress?.errors ? "text-danger" : "text-fg"}>{formatNumber(progress?.errors ?? 0)}</dd>
                </dl>
              </Card>
              <Card title="Transfer Speed">
                <LineChartPanel
                  data={run.speedHistory.length ? run.speedHistory : [{ t: 0, mbps: 0 }]}
                  categoryKey="t"
                  series={[{ key: "mbps", label: "MB/s", color: "var(--color-chart-1)" }]}
                  valueFormatter={(v) => `${v} MB/s`}
                  height={140}
                />
              </Card>
            </div>

            <Card title="Actions After Completion">
              <div className="flex flex-wrap items-center gap-4">
                <Checkbox checked={run.afterCompletion.showReport} onChange={(v) => run.setAfterCompletion({ showReport: v })} label="Show report" />
                <Checkbox checked={run.afterCompletion.openDestination} onChange={(v) => run.setAfterCompletion({ openDestination: v })} label="Open destination folder" />
                <Checkbox
                  checked={run.afterCompletion.shutdown}
                  onChange={(v) => {
                    run.setAfterCompletion({ shutdown: v });
                    setShutdownPending(v);
                    if (v) toast.warning("Windows will shut down 60 seconds after this transfer completes.", "Shut down computer");
                  }}
                  label="Shut down computer"
                />
                {shutdownPending && run.status === "completed" && (
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => {
                      cancelScheduledShutdown();
                      setShutdownPending(false);
                      run.setAfterCompletion({ shutdown: false });
                    }}
                  >
                    Cancel shutdown
                  </Button>
                )}
              </div>
            </Card>
          </>
        )}

        {tab === "report" && <TransferReportCard report={run.report} />}
        {tab === "log" && <TransferLogCard log={run.log} />}
      </div>
    </div>
  );
}
