import { useState } from "react";
import { CalendarPlus, CheckCircle2, ListChecks, Play, Save, Trash2, XCircle } from "lucide-react";
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
import { DataTable, type DataTableColumn } from "@/components/tables/DataTable";
import { useSchedulerStore } from "@/state/schedulerStore";
import type { ScheduledTask } from "@/models/scheduler";
import { formatBytes, formatDate, formatDuration, formatNumber } from "@/utils/format";
import { toast } from "@/state/toastStore";

const TABS = [
  { id: "history", label: "History" },
  { id: "upcoming", label: "Upcoming Runs" },
  { id: "settings", label: "Task Settings" },
];

export function SchedulerPage() {
  const { tasks, history, selectedTaskId, selectTask, toggleEnabled, updateTask, deleteTask, runNow } = useSchedulerStore();
  const [tab, setTab] = useState("history");
  const selectedTask = tasks.find((t) => t.id === selectedTaskId) ?? null;

  const runningThisWeek = tasks.filter((t) => t.enabled).length;
  const completed = history.filter((h) => h.status === "success").length;
  const failed = history.filter((h) => h.status === "failed").length;

  const columns: DataTableColumn<ScheduledTask>[] = [
    { key: "name", header: "Name", width: 160, sortAccessor: (t) => t.name, render: (t) => t.name },
    { key: "type", header: "Type", width: 90, render: (t) => <span className="text-fg-muted">{t.type}</span> },
    { key: "source", header: "Source", width: 190, render: (t) => <span className="truncate text-fg-muted">{t.source}</span> },
    { key: "destination", header: "Destination", width: 190, render: (t) => <span className="truncate text-fg-muted">{t.destination}</span> },
    { key: "schedule", header: "Schedule", width: 150, render: (t) => <span className="text-fg-muted">{t.scheduleDetail}</span> },
    { key: "nextRun", header: "Next Run", width: 140, sortAccessor: (t) => t.nextRun, render: (t) => formatDate(t.nextRun) },
    { key: "lastRun", header: "Last Run", width: 140, sortAccessor: (t) => t.lastRun, render: (t) => formatDate(t.lastRun) },
    {
      key: "status",
      header: "Status",
      width: 130,
      render: (t) => (
        <div className="flex items-center gap-2">
          {t.lastRunStatus === "success" ? (
            <CheckCircle2 size={14} className="text-success" />
          ) : (
            <XCircle size={14} className="text-danger" />
          )}
          <Toggle checked={t.enabled} onChange={() => toggleEnabled(t.id)} />
        </div>
      ),
    },
  ];

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <PageHeader
        title="Scheduler"
        description="Automate your data tasks. Schedule scans, copies, syncs and more."
        actions={
          <>
            <Button icon={CalendarPlus} onClick={() => toast.demo()}>Create Scheduled Task</Button>
            <Button variant="primary" icon={Play} onClick={() => selectedTask && runNow(selectedTask.id)} disabled={!selectedTask}>
              Run Selected Now
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-4 gap-3">
        <StatCard icon={ListChecks} label="Scheduled Tasks" value={String(tasks.length)} sublabel={`${tasks.filter((t) => t.enabled).length} enabled`} tone="accent" />
        <StatCard icon={Play} label="Running This Week" value={String(runningThisWeek)} sublabel="Next run: today" tone="info" />
        <StatCard icon={CheckCircle2} label="Completed Successfully" value={String(completed)} sublabel="Last 7 days" tone="success" />
        <StatCard icon={XCircle} label="Failed Runs" value={String(failed)} sublabel="Last 7 days" tone="danger" />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[1fr_320px] gap-3">
        <div className="flex min-h-0 min-w-0 flex-col gap-3">
          <Card padded={false} bodyClassName="h-[240px]">
            <DataTable
              columns={columns}
              rows={tasks}
              getRowId={(t) => t.id}
              selectedId={selectedTaskId}
              onRowClick={(t) => selectTask(t.id)}
              className="h-full border-0 rounded-none"
            />
          </Card>

          <Tabs tabs={TABS} active={tab} onChange={setTab} />

          {tab === "history" && (
            <Card padded={false} bodyClassName="flex-1 overflow-y-auto" className="min-h-0 flex-1">
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
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id} className="border-b border-border/60 hover:bg-surface-hover">
                      <td className="px-3 py-2 text-fg-muted">{formatDate(h.dateTime)}</td>
                      <td className="px-3 py-2 text-fg">{h.taskName}</td>
                      <td className="px-3 py-2">
                        <Badge tone={h.status === "success" ? "success" : h.status === "failed" ? "danger" : "info"}>{h.status}</Badge>
                      </td>
                      <td className="px-3 py-2 text-fg-muted">{h.details}</td>
                      <td className="px-3 py-2 text-right text-fg-muted">{h.files != null ? formatNumber(h.files) : "-"}</td>
                      <td className="px-3 py-2 text-right text-fg-muted">{h.size != null ? formatBytes(h.size) : "-"}</td>
                      <td className="px-3 py-2 text-right text-fg-muted">{formatDuration(h.durationSeconds)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
          {tab === "upcoming" && (
            <Card bodyClassName="flex flex-col gap-1.5" className="min-h-0 flex-1 overflow-y-auto">
              {tasks
                .filter((t) => t.enabled)
                .sort((a, b) => new Date(a.nextRun).getTime() - new Date(b.nextRun).getTime())
                .map((t) => (
                  <div key={t.id} className="flex items-center justify-between rounded-md border border-border bg-surface-alt px-2.5 py-2 text-[12.5px]">
                    <span className="text-fg">{t.name}</span>
                    <span className="text-fg-muted">{formatDate(t.nextRun)}</span>
                  </div>
                ))}
            </Card>
          )}
          {tab === "settings" && (
            <Card className="min-h-0 flex-1 overflow-y-auto">
              <p className="text-[12.5px] text-fg-muted">
                Global scheduler settings (retry policy, log retention, notification defaults) will be configurable here in a later phase.
              </p>
            </Card>
          )}
        </div>

        <Card title="Task Details" bodyClassName="flex flex-col gap-3 overflow-y-auto p-3">
          {selectedTask ? (
            <>
              <Toggle checked={selectedTask.enabled} onChange={() => toggleEnabled(selectedTask.id)} label="Enabled" />
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-medium text-fg-muted">Task Name</label>
                <TextInput value={selectedTask.name} onChange={(e) => updateTask(selectedTask.id, { name: e.target.value })} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-medium text-fg-muted">Task Type</label>
                <Select
                  value={selectedTask.type}
                  onChange={(e) => updateTask(selectedTask.id, { type: e.target.value as ScheduledTask["type"] })}
                  options={[
                    { value: "Sync", label: "Sync / Incremental" },
                    { value: "Copy", label: "Copy" },
                    { value: "Move", label: "Move" },
                    { value: "Mirror", label: "Mirror" },
                    { value: "Analyze", label: "Disk Analysis" },
                  ]}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-medium text-fg-muted">Source</label>
                <TextInput value={selectedTask.source} onChange={(e) => updateTask(selectedTask.id, { source: e.target.value })} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-medium text-fg-muted">Destination</label>
                <TextInput value={selectedTask.destination} onChange={(e) => updateTask(selectedTask.id, { destination: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] font-medium text-fg-muted">Schedule</label>
                  <Select
                    value={selectedTask.schedule}
                    onChange={(e) => updateTask(selectedTask.id, { schedule: e.target.value as ScheduledTask["schedule"] })}
                    options={[
                      { value: "Daily", label: "Daily" },
                      { value: "Weekly", label: "Weekly" },
                      { value: "Monthly", label: "Monthly" },
                      { value: "Once", label: "Once" },
                    ]}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] font-medium text-fg-muted">Time</label>
                  <TextInput type="time" value={selectedTask.time} onChange={(e) => updateTask(selectedTask.id, { time: e.target.value })} />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-medium text-fg-muted">Options</label>
                <Checkbox checked={selectedTask.options.includeSubfolders} onChange={() => toast.demo()} label="Include subfolders" />
                <Checkbox checked={selectedTask.options.incrementalOnly} onChange={() => toast.demo()} label="Copy only new or changed files" />
                <Checkbox checked={selectedTask.options.deleteAtDestination} onChange={() => toast.demo()} label="Delete files at destination (mirror)" />
                <Checkbox checked={selectedTask.options.skipFilesInUse} onChange={() => toast.demo()} label="Skip files in use" />
                <Checkbox checked={selectedTask.options.logAllOperations} onChange={() => toast.demo()} label="Log all operations" />
                <Checkbox checked={selectedTask.options.sendEmailNotification} onChange={() => toast.demo()} label="Send email notification" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-medium text-fg-muted">Run As</label>
                <Select
                  value={selectedTask.runAs}
                  onChange={(e) => updateTask(selectedTask.id, { runAs: e.target.value })}
                  options={[
                    { value: "Run whether user is logged on or not", label: "Run whether user is logged on or not" },
                    { value: "Run only when user is logged on", label: "Run only when user is logged on" },
                  ]}
                />
              </div>
              <div className="mt-auto flex gap-2 pt-2">
                <Button variant="primary" icon={Save} onClick={() => toast.success("Task settings saved.")}>Save</Button>
                <Button icon={Play} onClick={() => runNow(selectedTask.id)}>Run Now</Button>
                <Button variant="danger" icon={Trash2} onClick={() => deleteTask(selectedTask.id)}>Delete</Button>
              </div>
            </>
          ) : (
            <p className="text-xs text-fg-subtle">Select a task to see and edit its details.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
