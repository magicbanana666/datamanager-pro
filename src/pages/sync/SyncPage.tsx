import { useFsContextMenu } from "@/hooks/useFsContextMenu";
import { useMemo, useState } from "react";
import { Pause, Play, ScanSearch, Square } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/cards/Card";
import { LocationPicker } from "@/components/controls/LocationPicker";
import { RadioGroup } from "@/components/controls/RadioGroup";
import { Checkbox } from "@/components/controls/Checkbox";
import { TextInput } from "@/components/controls/TextInput";
import { Select } from "@/components/controls/Select";
import { Button } from "@/components/controls/Button";
import { Tabs } from "@/components/controls/Tabs";
import { ProgressBar } from "@/components/charts/ProgressBar";
import { LineChartPanel } from "@/components/charts/LineChartPanel";
import { DataTable, type DataTableColumn } from "@/components/tables/DataTable";
import { InterruptedTransfersCard, TransferLogCard } from "@/components/transfer/transferUi";
import { planColumns } from "@/components/transfer/planColumns";
import { isWork } from "@/utils/transfer";
import type { SyncMode } from "@/models/sync";
import {
  DEFAULT_TRANSFER_OPTIONS,
  type ItemOverride,
  type PlanAction,
  type PlanItem,
  type TransferRequest,
} from "@/models/transfer";
import { formatBytes, formatDuration, formatNumber, formatSpeed } from "@/utils/format";
import { useSyncStore } from "@/state/transferStore";
import { toast } from "@/state/toastStore";

const TABS = [
  { id: "file-list", label: "File List" },
  { id: "changes", label: "Changes" },
  { id: "conflicts", label: "Conflicts" },
  { id: "filters", label: "Filters" },
  { id: "options", label: "Options" },
  { id: "preview", label: "Preview" },
  { id: "log", label: "Log" },
];

/** What a conflict can be resolved to. */
const RESOLUTIONS: { value: string; label: string }[] = [
  { value: "", label: "Skip (decide later)" },
  { value: "source", label: "Keep source (copy →)" },
  { value: "dest", label: "Keep destination (copy ←)" },
];

export function SyncPage() {
  const fsMenu = useFsContextMenu();
  const run = useSyncStore();
  const last = useSyncStore.getState().request;
  const [source, setSource] = useState(last?.source ?? "");
  const [destination, setDestination] = useState(last?.destination ?? "");
  const [mode, setMode] = useState<SyncMode>(() => {
    const m = last?.mode;
    return m === "mirror" || m === "update-newer" || m === "two-way" ? m : "incremental";
  });
  const [options, setOptions] = useState(() => last?.options ?? { ...DEFAULT_TRANSFER_OPTIONS, excludeFilters: "*.tmp;~$*" });
  const [tab, setTab] = useState("changes");
  // Per-plan decisions: rows the user unticked, and conflict resolutions.
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [resolutions, setResolutions] = useState<Map<number, "source" | "dest">>(new Map());
  const [lastSeenPlan, setLastSeenPlan] = useState(run.plan);
  if (run.plan !== lastSeenPlan) {
    setLastSeenPlan(run.plan);
    setExcluded(new Set());
    setResolutions(new Map());
  }

  const busy = run.status === "running" || run.status === "analyzing";
  const progress = run.progress;
  const paused = !!progress?.paused;
  const rows = useMemo(() => run.plan?.rows ?? [], [run.plan]);
  const summary = run.plan?.summary;
  const active = useMemo(
    () => new Map((progress?.active ?? []).map((a) => [a.id, a.size ? (a.bytesDone / a.size) * 100 : 0])),
    [progress?.active],
  );

  const editable = run.status === "planned";
  const includeColumn: DataTableColumn<PlanItem> = {
    key: "included",
    header: "",
    width: 36,
    render: (r) =>
      isWork(r.action) || r.action === "conflict" ? (
        <Checkbox
          checked={!excluded.has(r.id) && (r.action !== "conflict" || resolutions.has(r.id))}
          disabled={!editable}
          onChange={(v) => {
            if (r.action === "conflict") {
              if (!v) setResolutions((m) => { const n = new Map(m); n.delete(r.id); return n; });
              else setResolutions((m) => new Map(m).set(r.id, "source"));
              return;
            }
            setExcluded((s) => {
              const n = new Set(s);
              if (v) n.delete(r.id);
              else n.add(r.id);
              return n;
            });
          }}
        />
      ) : null,
  };
  const columns = useMemo(
    () => planColumns(run.rowStates, active, [includeColumn]),
    // includeColumn closes over excluded/resolutions/editable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [run.rowStates, active, excluded, resolutions, editable],
  );
  const conflictColumns: DataTableColumn<PlanItem>[] = useMemo(
    () => [
      ...columns.filter((c) => c.key !== "included" && c.key !== "progress"),
      {
        key: "resolution",
        header: "Resolution",
        width: 200,
        render: (r) => (
          <Select
            value={resolutions.get(r.id) ?? ""}
            disabled={!editable}
            onChange={(e) => {
              const v = e.target.value as "" | "source" | "dest";
              setResolutions((m) => {
                const n = new Map(m);
                if (v) n.set(r.id, v);
                else n.delete(r.id);
                return n;
              });
            }}
            options={RESOLUTIONS}
          />
        ),
      },
    ],
    [columns, resolutions, editable],
  );

  const visibleRows =
    tab === "changes" ? rows.filter((r) => isWork(r.action)) : tab === "conflicts" ? rows.filter((r) => r.action === "conflict") : rows;

  function request(): TransferRequest | null {
    if (!source.trim() || !destination.trim()) {
      toast.warning("Choose a source and a destination folder first.");
      return null;
    }
    return { source, destination, mode, collision: "skip-same", options };
  }

  function analyze() {
    const r = request();
    if (r) void run.analyze(r);
  }

  function overrides(): ItemOverride[] {
    const list: ItemOverride[] = [...excluded].map((id) => ({ id, included: false }));
    for (const [id, side] of resolutions) {
      const row = rows.find((r) => r.id === id);
      const destExists = !!row?.destModified;
      const sourceExists = !!row?.sourceModified;
      const action: PlanAction = side === "source" ? (destExists ? "update" : "copy-new") : sourceExists ? "update-back" : "copy-back";
      list.push({ id, included: true, action });
    }
    return list;
  }

  function startSync() {
    if (run.status === "planned") {
      if ((summary?.deletions ?? 0) > 0 && options.useRecycleBin) {
        toast.info(`${formatNumber(summary!.deletions)} items will be moved to the Recycle Bin.`);
      }
      void run.execute(overrides());
      return;
    }
    const r = request();
    if (r) void run.start(r);
  }

  const bytesTotal = progress?.bytesTotal ?? 0;
  const bytesDone = progress?.bytesDone ?? 0;
  const percent =
    run.status === "completed" ? 100 : run.status === "running" && bytesTotal > 0 ? (bytesDone / bytesTotal) * 100 : 0;
  const unresolved = (summary?.conflicts ?? 0) - resolutions.size;

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <PageHeader title="Sync / Incremental" description="Synchronize directories with advanced options; copy only new or changed files." />

      <div className="flex items-stretch gap-3">
        <Card title="Source" className="flex-1">
          <LocationPicker value={source} onChange={setSource} placeholder="Source folder" />
        </Card>
        <Card title="Destination" className="flex-1">
          <LocationPicker value={destination} onChange={setDestination} placeholder="Destination folder" />
        </Card>
        <Card title="Sync Mode" className="w-[190px] shrink-0">
          <RadioGroup
            name="sync-mode"
            value={mode}
            onChange={setMode}
            options={[
              { value: "mirror", label: "Mirror" },
              { value: "incremental", label: "Incremental" },
              { value: "update-newer", label: "Update newer only" },
              { value: "two-way", label: "Two-way sync" },
            ]}
          />
        </Card>
        <Card title="Additional Options" className="w-[260px] shrink-0">
          <div className="flex flex-col gap-1.5">
            <Checkbox
              checked={mode === "mirror" || options.deleteExtras}
              disabled={mode === "mirror" || mode === "two-way"}
              onChange={(v) => setOptions((o) => ({ ...o, deleteExtras: v }))}
              label="Delete files at destination"
            />
            <Checkbox checked={options.skipSameSizeDate} onChange={(v) => setOptions((o) => ({ ...o, skipSameSizeDate: v }))} label="Skip same size and date" />
            <Checkbox checked={options.compareHash} onChange={(v) => setOptions((o) => ({ ...o, compareHash: v }))} label="Compare file content (hash)" />
            <Checkbox checked={options.preservePermissions} onChange={(v) => setOptions((o) => ({ ...o, preservePermissions: v }))} label="Preserve permissions" />
            <Checkbox checked={options.preserveTimestamps} onChange={(v) => setOptions((o) => ({ ...o, preserveTimestamps: v }))} label="Preserve timestamps" />
          </div>
        </Card>
      </div>

      <InterruptedTransfersCard
        status={run.status}
        onResume={(job) => {
          setSource(job.source);
          setDestination(job.destination);
          void run.resumeInterrupted(job.jobId);
        }}
      />

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {tab === "filters" && (
          <Card title="Filters">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-medium text-fg-muted">Include filters (empty or *.* = everything)</label>
                <TextInput value={options.includeFilters} placeholder="*.*" onChange={(e) => setOptions((o) => ({ ...o, includeFilters: e.target.value }))} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-medium text-fg-muted">Exclude filters (files and folder names)</label>
                <TextInput value={options.excludeFilters} placeholder="*.tmp;node_modules" onChange={(e) => setOptions((o) => ({ ...o, excludeFilters: e.target.value }))} />
              </div>
            </div>
            <p className="mt-2 text-[11.5px] text-fg-muted">
              Separate patterns with ";". "*" and "?" are wildcards; a pattern with "\" matches the path relative to the source. Analyze again after changing filters.
            </p>
          </Card>
        )}

        {tab === "options" && (
          <Card title="Sync Options">
            <div className="flex flex-col gap-1.5 text-[12.5px] text-fg-muted">
              <Checkbox checked={options.useRecycleBin} onChange={(v) => setOptions((o) => ({ ...o, useRecycleBin: v }))} label="Move deleted files to the Recycle Bin (where available)" />
              <Checkbox checked={options.verifyAfterTransfer} onChange={(v) => setOptions((o) => ({ ...o, verifyAfterTransfer: v }))} label="Verify copied files (hash)" />
              <Checkbox checked={options.includeSubfolders} onChange={(v) => setOptions((o) => ({ ...o, includeSubfolders: v }))} label="Include subfolders" />
              <p className="mt-1">
                {mode === "mirror" && "Mirror: the destination becomes an exact copy - new and changed files are copied, files only at the destination are deleted."}
                {mode === "incremental" && "Incremental: new and changed files are copied; extras at the destination are kept unless \"Delete files at destination\" is ticked."}
                {mode === "update-newer" && "Update newer only: a destination file is only replaced by a newer source copy."}
                {mode === "two-way" &&
                  "Two-way: changes on either side are carried to the other. The first run only copies; later runs also carry deletions over, using what the previous run saw. Files changed on both sides are conflicts."}
              </p>
            </div>
          </Card>
        )}

        {tab === "log" ? (
          <TransferLogCard log={run.log} />
        ) : tab === "preview" ? (
          <Card title="Preview">
            {summary ? (
              <p className="text-[12.5px] text-fg-muted">
                {formatNumber(summary.totalToCopyFiles)} files ({formatBytes(summary.totalToCopyBytes)}) will be copied or updated,{" "}
                {formatNumber(summary.deletions)} items ({formatBytes(summary.deletionBytes)}) deleted, {formatNumber(summary.foldersToCreate)} folders created.{" "}
                {formatNumber(summary.excludedFiles)} excluded, {formatNumber(summary.conflicts)} conflicts
                {unresolved > 0 ? ` (${unresolved} unresolved - skipped)` : ""}.
                {summary.destFreeBytes != null && ` Free at destination: ${formatBytes(summary.destFreeBytes)} (needs ${formatBytes(summary.netBytesNeeded)}).`}
                {(run.plan?.skipped.length ?? 0) > 0 && ` ${run.plan!.skipped.length} paths could not be read (see the log).`}
              </p>
            ) : (
              <p className="text-[12.5px] text-fg-muted">Press Analyze to preview what the sync will do.</p>
            )}
          </Card>
        ) : tab === "filters" || tab === "options" ? null : (
          // flex-none on the body: see the identical fix/comment in
          // DiskAnalysisPage.tsx (PHASE4.md).
          <Card padded={false} bodyClassName="h-[280px] flex-none" className="flex-1">
            <DataTable
              columns={tab === "conflicts" ? conflictColumns : columns}
              rows={visibleRows}
              getRowId={(r) => String(r.id)}
              onRowContextMenu={(r, e) =>
                fsMenu.open(e, {
                  path: ["delete-dest", "copy-back", "update-back"].includes(r.action) ? r.destPath : r.sourcePath,
                  kind: r.isFolder ? "folder" : "file",
                })
              }
              className="h-full border-0 rounded-none"
              emptyMessage={
                run.status === "analyzing"
                  ? "Analyzing..."
                  : run.plan
                    ? tab === "conflicts" ? "No conflicts." : "Nothing to do - everything is in sync."
                    : "Press Analyze to see what would change."
              }
            />
          </Card>
        )}

        <div className="grid grid-cols-3 gap-3">
          <Card title="Sync Summary">
            <dl className="grid grid-cols-[1fr_auto] gap-y-1.5 text-[12.5px]">
              <dt className="text-fg-muted">New files:</dt>
              <dd className="text-right text-fg">{formatNumber(summary?.newFiles ?? 0)}</dd>
              <dt className="text-fg-muted">Updated files:</dt>
              <dd className="text-right text-fg">{formatNumber(summary?.updatedFiles ?? 0)}</dd>
              <dt className="text-fg-muted">Unchanged files:</dt>
              <dd className="text-right text-fg">{formatNumber(summary?.unchangedFiles ?? 0)}</dd>
              <dt className="text-fg-muted">To delete:</dt>
              <dd className="text-right text-fg">{formatNumber(summary?.deletions ?? 0)}</dd>
              <dt className="text-fg-muted">Excluded files:</dt>
              <dd className="text-right text-fg">{formatNumber(summary?.excludedFiles ?? 0)}</dd>
              <dt className="text-fg-muted">Conflicts:</dt>
              <dd className={summary?.conflicts ? "text-right text-danger" : "text-right text-fg"}>{formatNumber(summary?.conflicts ?? 0)}</dd>
              <dt className="text-fg-muted">Total to copy:</dt>
              <dd className="text-right text-fg">
                {formatNumber(summary?.totalToCopyFiles ?? 0)} files ({formatBytes(summary?.totalToCopyBytes ?? 0)})
              </dd>
            </dl>
          </Card>
          <Card title="Transfer Progress">
            <div className="flex items-center justify-between text-[12px] text-fg-muted">
              <span>
                {run.status === "analyzing"
                  ? `Analyzing... ${formatNumber(progress?.filesFound ?? 0)} files`
                  : run.status === "running"
                    ? paused ? "Paused" : "Syncing..."
                    : run.status === "planned"
                      ? "Ready - review the changes, then Start Sync"
                      : run.status === "completed"
                        ? "Completed"
                        : run.status === "cancelled"
                          ? "Stopped"
                          : run.status === "error"
                            ? "Failed"
                            : "Idle"}
              </span>
              <span className="font-semibold text-fg">{percent.toFixed(0)}%</span>
            </div>
            <ProgressBar
              value={percent}
              indeterminate={run.status === "analyzing"}
              tone={run.status === "completed" ? "success" : "accent"}
              className="mt-1.5"
            />
            <div className="mt-2 text-[11.5px] text-fg-muted">
              {formatBytes(bytesDone)} / {formatBytes(bytesTotal)} · {progress?.speedBps && run.status === "running" ? formatSpeed(progress.speedBps) + " · " : ""}
              Elapsed {formatDuration((progress?.elapsedMs ?? 0) / 1000)}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button size="sm" icon={ScanSearch} onClick={analyze} disabled={busy}>
                Analyze
              </Button>
              <Button variant="primary" size="sm" icon={Play} onClick={startSync} disabled={busy}>
                Start Sync
              </Button>
              {paused ? (
                <Button size="sm" icon={Play} onClick={() => void run.setPaused(false)}>Resume</Button>
              ) : (
                <Button size="sm" icon={Pause} disabled={run.status !== "running"} onClick={() => void run.setPaused(true)}>Pause</Button>
              )}
              <Button size="sm" variant="danger" icon={Square} disabled={!busy && run.status !== "planned"} onClick={() => void run.cancel()}>
                Stop
              </Button>
            </div>
          </Card>
          <Card title="Realtime Speed">
            <LineChartPanel
              data={run.speedHistory.length ? run.speedHistory : [{ t: 0, mbps: 0 }]}
              categoryKey="t"
              series={[{ key: "mbps", label: "MB/s", color: "var(--color-chart-3)" }]}
              valueFormatter={(v) => `${v} MB/s`}
              height={110}
            />
          </Card>
        </div>
      </div>
    </div>
  );
}
