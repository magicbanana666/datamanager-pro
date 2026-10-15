import { useMemo, useState } from "react";
import { CalendarPlus, CheckCircle2, Clock, FileText, Info, ListChecks, Loader2, MinusCircle, Play, Save, Square, Trash2, XCircle } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/cards/Card";
import { StatCard } from "@/components/cards/StatCard";
import { Tabs } from "@/components/controls/Tabs";
import { Toggle } from "@/components/controls/Toggle";
import { TextInput } from "@/components/controls/TextInput";
import { Select } from "@/components/controls/Select";
import { Checkbox } from "@/components/controls/Checkbox";
import { Button } from "@/components/controls/Button";
import { Badge } from "@/components/controls/Badge";
import { LocationPicker } from "@/components/controls/LocationPicker";
import { DataTable, type DataTableColumn } from "@/components/tables/DataTable";
import { useSchedulerStore } from "@/state/schedulerStore";
import { confirmAction } from "@/api/dialog";
import { openPath } from "@/api/search";
import { cancelTransfer } from "@/api/transfer";
import { toAppError } from "@/api/backend";
import {
  WEEKDAY_OPTIONS,
  describeSchedule,
  newTask,
  type ScheduledTask,
  type TaskRunStatus,
} from "@/models/scheduler";
import { formatBytes, formatDate, formatDuration, formatNumber } from "@/utils/format";
import { toast } from "@/state/toastStore";

const TABS = [
  { id: "history", label: "History" },
  { id: "upcoming", label: "Upcoming Runs" },
  { id: "settings", label: "Scheduler Settings" },
];

const STATUS_TONE: Record<TaskRunStatus, "success" | "danger" | "info" | "warning"> = {
  success: "success",
  failed: "danger",
  cancelled: "info",
  missed: "warning",
};

const WEEK_MS = 7 * 24 * 3600 * 1000;

function StatusIcon({ task }: { task: ScheduledTask }) {
  if (task.runningJob) return <Loader2 size={14} className="animate-spin text-accent" />;
  switch (task.lastRunStatus) {
    case "success":
      return <CheckCircle2 size={14} className="text-success" />;
    case "failed":
      return <XCircle size={14} className="text-danger" />;
    case null:
      return <MinusCircle size={14} className="text-fg-subtle" />;
    default:
      return <Clock size={14} className="text-warning" />;
  }
}

export function SchedulerPage() {
  const store = useSchedulerStore();
  const { tasks, history, settings, selectedTaskId, selectTask } = store;
  const [tab, setTab] = useState("history");
  // The editor works on a draft; Save sends it to the backend.
  const [draft, setDraft] = useState<ScheduledTask | null>(null);
  const selectedTask = tasks.find((t) => t.id === selectedTaskId) ?? null;
  const [draftFor, setDraftFor] = useState<string | null>(null);
  if (selectedTask && draftFor !== selectedTask.id) {
    setDraftFor(selectedTask.id);
    setDraft(structuredClone(selectedTask));
  }
  const editing = draft && (draft.id === "" || draft.id === selectedTaskId) ? draft : null;
  const live = editing?.id ? tasks.find((t) => t.id === editing.id) : null;

  // Fixed per visit to the page: "now" read during render is impure.
  const [weekAgo] = useState(() => Date.now() - WEEK_MS);
  const recent = history.filter((h) => new Date(h.dateTime).getTime() >= weekAgo);
  const nextUp = useMemo(
    () => tasks.filter((t) => t.enabled && t.nextRun).sort((a, b) => a.nextRun!.localeCompare(b.nextRun!)),
    [tasks],
  );

  function patch(p: Partial<ScheduledTask>) {
    setDraft((d) => (d ? { ...d, ...p } : d));
  }
  function patchSchedule(p: Partial<ScheduledTask["schedule"]>) {
    setDraft((d) => (d ? { ...d, schedule: { ...d.schedule, ...p } } : d));
  }
  function patchOptions(p: Partial<ScheduledTask["options"]>) {
    setDraft((d) => (d ? { ...d, options: { ...d.options, ...p } } : d));
  }

  function createTask() {
    selectTask(null);
    setDraftFor(null);
    setDraft(newTask());
  }

  async function saveDraft() {
    if (!editing) return;
    const saved = await store.save(editing);
    if (saved) {
      setDraftFor(saved.id);
      setDraft(structuredClone(saved));
    }
  }

  async function deleteSelected() {
    if (!editing?.id) {
      setDraft(null);
      return;
    }
    if (await confirmAction(`Delete the task "${editing.name}"? Its history is kept.`, "Delete task", "Delete")) {
      await store.deleteTask(editing.id);
      setDraft(null);
    }
  }

  const columns: DataTableColumn<ScheduledTask>[] = [
    { key: "name", header: "Name", width: 160, sortAccessor: (t) => t.name, render: (t) => t.name },
    { key: "type", header: "Type", width: 80, render: (t) => <span className="text-fg-muted">{t.type}</span> },
    { key: "source", header: "Source", width: 190, render: (t) => <span className="truncate text-fg-muted" title={t.source}>{t.source}</span> },
    { key: "destination", header: "Destination", width: 190, render: (t) => <span className="truncate text-fg-muted" title={t.destination}>{t.type === "Analyze" ? "-" : t.destination}</span> },
    { key: "schedule", header: "Schedule", width: 170, render: (t) => <span className="text-fg-muted">{describeSchedule(t.schedule)}</span> },
    { key: "nextRun", header: "Next Run", width: 140, sortAccessor: (t) => t.nextRun ?? "", render: (t) => (t.enabled ? formatDate(t.nextRun) : "Disabled") },
    { key: "lastRun", header: "Last Run", width: 140, sortAccessor: (t) => t.lastRun ?? "", render: (t) => formatDate(t.lastRun) },
    {
      key: "status",
      header: "Status",
      width: 100,
      render: (t) => (
        <div className="flex items-center gap-2">
          <StatusIcon task={t} />
          <Toggle checked={t.enabled} onChange={() => void store.toggleEnabled(t.id)} />
        </div>
      ),
    },
  ];

  const field = "flex flex-col gap-1.5";
  const label = "text-[11px] font-medium text-fg-muted";

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <PageHeader
        title="Scheduler"
        description="Automate your data tasks. Schedule scans, copies, syncs and more."
        actions={
          <>
            <Button icon={CalendarPlus} onClick={createTask}>Create Scheduled Task</Button>
            <Button
              variant="primary"
              icon={Play}
              onClick={() => selectedTask && void store.runNow(selectedTask.id)}
              disabled={!selectedTask || !!selectedTask.runningJob}
            >
              Run Selected Now
            </Button>
          </>
        }
      />

      <div className="flex items-center gap-2 rounded-md border border-border bg-surface-alt px-3 py-2 text-[12px] text-fg-muted">
        <Info size={14} className="shrink-0 text-accent" />
        Tasks run inside DataManager Pro, only while the app is open - not through Windows Task Scheduler.{" "}
        {settings.runMissedOnStartup
          ? "A run missed while the app was closed runs once at the next start."
          : "Runs missed while the app was closed are recorded as missed."}
      </div>

      <div className="grid grid-cols-4 gap-3">
        <StatCard icon={ListChecks} label="Scheduled Tasks" value={String(tasks.length)} sublabel={`${tasks.filter((t) => t.enabled).length} enabled`} tone="accent" />
        <StatCard
          icon={Play}
          label="Next Run"
          value={nextUp[0] ? formatDate(nextUp[0].nextRun) : "-"}
          sublabel={nextUp[0]?.name ?? "Nothing scheduled"}
          tone="info"
        />
        <StatCard icon={CheckCircle2} label="Completed Successfully" value={String(recent.filter((h) => h.status === "success").length)} sublabel="Last 7 days" tone="success" />
        <StatCard icon={XCircle} label="Failed Runs" value={String(recent.filter((h) => h.status === "failed").length)} sublabel="Last 7 days" tone="danger" />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[1fr_340px] gap-3">
        <div className="flex min-h-0 min-w-0 flex-col gap-3">
          {/* The task list gets most of the height; the tabs below share the rest. */}
          <Card padded={false} className="min-h-[180px] flex-[3]">
            <DataTable
              columns={columns}
              rows={tasks}
              getRowId={(t) => t.id}
              selectedId={selectedTaskId}
              onRowClick={(t) => selectTask(t.id)}
              emptyMessage={store.loaded ? "No scheduled tasks yet - press Create Scheduled Task." : "Loading..."}
              className="h-full border-0 rounded-none"
            />
          </Card>

          <Tabs tabs={TABS} active={tab} onChange={setTab} />

          {tab === "history" && (
            <Card padded={false} bodyClassName="flex-1 overflow-y-auto" className="min-h-[140px] flex-[2]">
              <table className="w-full text-[12.5px]">
                <thead className="sticky top-0 bg-surface-alt">
                  <tr className="border-b border-border text-left text-[11px] font-semibold text-fg-muted">
                    <th className="px-3 py-2">Date &amp; Time</th>
                    <th className="px-3 py-2">Task Name</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Details</th>
                    <th className="px-3 py-2 text-right">Files</th>
                    <th className="px-3 py-2 text-right">Size</th>
                    <th className="px-3 py-2 text-right">Duration</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id} className="border-b border-border/60 hover:bg-surface-hover">
                      <td className="px-3 py-2 text-fg-muted">{formatDate(h.dateTime)}</td>
                      <td className="px-3 py-2 text-fg">{h.taskName}</td>
                      <td className="px-3 py-2">
                        <Badge tone={STATUS_TONE[h.status]}>{h.status}</Badge>
                      </td>
                      <td className="max-w-[360px] truncate px-3 py-2 text-fg-muted" title={h.details}>{h.details}</td>
                      <td className="px-3 py-2 text-right text-fg-muted">{h.files != null ? formatNumber(h.files) : "-"}</td>
                      <td className="px-3 py-2 text-right text-fg-muted">{h.size != null ? formatBytes(h.size) : "-"}</td>
                      <td className="px-3 py-2 text-right text-fg-muted">{formatDuration(h.durationSeconds)}</td>
                      <td className="px-3 py-2 text-right">
                        {h.logPath && (
                          <button
                            title="Open the run's log"
                            onClick={() => openPath(h.logPath!).catch((e) => toast.danger(toAppError(e).message))}
                            className="cursor-pointer text-fg-muted hover:text-fg"
                          >
                            <FileText size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {history.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-3 py-6 text-center text-fg-subtle">No runs yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </Card>
          )}
          {tab === "upcoming" && (
            <Card bodyClassName="flex flex-col gap-1.5" className="min-h-[140px] flex-[2] overflow-y-auto">
              {nextUp.length === 0 && <p className="text-[12.5px] text-fg-subtle">No enabled tasks.</p>}
              {nextUp.map((t) => (
                <div key={t.id} className="flex items-center justify-between rounded-md border border-border bg-surface-alt px-2.5 py-2 text-[12.5px]">
                  <span className="text-fg">{t.name} <span className="text-fg-muted">· {describeSchedule(t.schedule)}</span></span>
                  <span className="text-fg-muted">{formatDate(t.nextRun)}</span>
                </div>
              ))}
            </Card>
          )}
          {tab === "settings" && (
            <Card className="min-h-[140px] flex-[2] overflow-y-auto" bodyClassName="flex flex-col gap-3">
              <Checkbox
                checked={settings.runMissedOnStartup}
                onChange={(v) => void store.updateSettings({ runMissedOnStartup: v })}
                label="Run tasks missed while the app was closed, once, at startup"
              />
              <div className={field}>
                <label className={label}>History entries to keep</label>
                <Select
                  value={String(settings.historyLimit)}
                  onChange={(e) => void store.updateSettings({ historyLimit: Number(e.target.value) })}
                  options={["100", "500", "2000"].map((v) => ({ value: v, label: v }))}
                  className="w-[120px]"
                />
              </div>
              <Button
                variant="danger"
                icon={Trash2}
                className="self-start"
                disabled={history.length === 0}
                onClick={async () => {
                  if (await confirmAction("Clear the whole run history?", "Clear history", "Clear")) void store.clearHistory();
                }}
              >
                Clear history
              </Button>
            </Card>
          )}
        </div>

        <Card title={editing?.id === "" ? "New Task" : "Task Details"} bodyClassName="flex flex-col gap-3 overflow-y-auto p-3">
          {editing ? (
            <>
              <Toggle checked={editing.enabled} onChange={(v) => patch({ enabled: v })} label="Enabled" />
              {live?.runningJob && (
                <div className="flex items-center gap-2 rounded-md bg-surface-alt px-2.5 py-2 text-[12px] text-fg-muted">
                  <Loader2 size={13} className="animate-spin text-accent" /> Running now
                  {live.type !== "Analyze" && (
                    <Button size="sm" icon={Square} className="ml-auto" onClick={() => void cancelTransfer(live.runningJob!)}>
                      Stop
                    </Button>
                  )}
                </div>
              )}
              <div className={field}>
                <label className={label}>Task Name</label>
                <TextInput value={editing.name} onChange={(e) => patch({ name: e.target.value })} />
              </div>
              <div className={field}>
                <label className={label}>Task Type</label>
                <Select
                  value={editing.type}
                  onChange={(e) => patch({ type: e.target.value as ScheduledTask["type"] })}
                  options={[
                    { value: "Sync", label: "Sync / Incremental" },
                    { value: "Copy", label: "Copy" },
                    { value: "Move", label: "Move" },
                    { value: "Mirror", label: "Mirror" },
                    { value: "Analyze", label: "Folder Analysis (scan)" },
                  ]}
                />
              </div>
              <div className={field}>
                <label className={label}>Source</label>
                <LocationPicker value={editing.source} onChange={(v) => patch({ source: v })} placeholder="Folder" />
              </div>
              {editing.type !== "Analyze" && (
                <div className={field}>
                  <label className={label}>Destination</label>
                  <LocationPicker value={editing.destination} onChange={(v) => patch({ destination: v })} placeholder="Folder" />
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div className={field}>
                  <label className={label}>Schedule</label>
                  <Select
                    value={editing.schedule.frequency}
                    onChange={(e) => patchSchedule({ frequency: e.target.value as ScheduledTask["schedule"]["frequency"] })}
                    options={[
                      { value: "Daily", label: "Daily" },
                      { value: "Weekly", label: "Weekly" },
                      { value: "Monthly", label: "Monthly" },
                      { value: "Once", label: "Once" },
                    ]}
                  />
                </div>
                <div className={field}>
                  <label className={label}>Time</label>
                  <TextInput type="time" value={editing.schedule.time} onChange={(e) => patchSchedule({ time: e.target.value })} />
                </div>
              </div>
              {editing.schedule.frequency === "Weekly" && (
                <div className={field}>
                  <label className={label}>Day</label>
                  <Select value={String(editing.schedule.weekday)} onChange={(e) => patchSchedule({ weekday: Number(e.target.value) })} options={WEEKDAY_OPTIONS} />
                </div>
              )}
              {editing.schedule.frequency === "Monthly" && (
                <div className={field}>
                  <label className={label}>Day of month (clamped to the last day)</label>
                  <TextInput
                    type="number"
                    min={1}
                    max={31}
                    value={editing.schedule.dayOfMonth}
                    onChange={(e) => patchSchedule({ dayOfMonth: Math.min(31, Math.max(1, Number(e.target.value) || 1)) })}
                  />
                </div>
              )}
              {editing.schedule.frequency === "Once" && (
                <div className={field}>
                  <label className={label}>Date</label>
                  <TextInput type="date" value={editing.schedule.date} onChange={(e) => patchSchedule({ date: e.target.value })} />
                </div>
              )}
              <div className={field}>
                <label className={label}>Options</label>
                <Checkbox checked={editing.options.includeSubfolders} onChange={(v) => patchOptions({ includeSubfolders: v })} label="Include subfolders" />
                {editing.type !== "Analyze" && (
                  <>
                    {(editing.type === "Copy" || editing.type === "Move") && (
                      <Checkbox checked={editing.options.incrementalOnly} onChange={(v) => patchOptions({ incrementalOnly: v })} label="Skip files that are unchanged (same size and date)" />
                    )}
                    {editing.type === "Sync" && (
                      <Checkbox checked={editing.options.deleteAtDestination} onChange={(v) => patchOptions({ deleteAtDestination: v })} label="Delete files at destination (to the Recycle Bin)" />
                    )}
                    <Checkbox checked={editing.options.verifyAfterTransfer} onChange={(v) => patchOptions({ verifyAfterTransfer: v })} label="Verify files after transfer" />
                    <Checkbox checked={editing.options.skipFilesInUse} onChange={(v) => patchOptions({ skipFilesInUse: v })} label="Files in use don't fail the run" />
                    <Checkbox checked={editing.options.logAllOperations} onChange={(v) => patchOptions({ logAllOperations: v })} label="Keep the full log of every run" />
                  </>
                )}
              </div>
              {live && (
                <p className="text-[11.5px] text-fg-muted">
                  Next run: {live.enabled ? formatDate(live.nextRun) : "disabled"} · Last run: {formatDate(live.lastRun)}
                </p>
              )}
              <div className="mt-auto flex gap-2 pt-2">
                <Button variant="primary" icon={Save} onClick={() => void saveDraft()}>Save</Button>
                <Button icon={Play} disabled={!editing.id || !!live?.runningJob} onClick={() => void store.runNow(editing.id)}>Run Now</Button>
                <Button variant="danger" icon={Trash2} onClick={() => void deleteSelected()}>Delete</Button>
              </div>
            </>
          ) : (
            <p className="text-xs text-fg-subtle">Select a task to see and edit its details, or create one.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
