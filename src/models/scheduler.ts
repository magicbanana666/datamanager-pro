/** Mirrors `src-tauri/src/models/scheduler.rs` (Phase 9). */
export type ScheduledTaskType = "Sync" | "Copy" | "Move" | "Mirror" | "Analyze";

export type ScheduleFrequency = "Daily" | "Weekly" | "Monthly" | "Once";

export type TaskRunStatus = "success" | "failed" | "cancelled" | "missed";

export interface Schedule {
  frequency: ScheduleFrequency;
  /** Local `HH:MM`. */
  time: string;
  /** Weekly: 0 = Monday ... 6 = Sunday. */
  weekday: number;
  /** Monthly: 1-31. */
  dayOfMonth: number;
  /** Once: `YYYY-MM-DD`. */
  date: string;
}

export interface TaskOptions {
  includeSubfolders: boolean;
  incrementalOnly: boolean;
  deleteAtDestination: boolean;
  skipFilesInUse: boolean;
  logAllOperations: boolean;
  verifyAfterTransfer: boolean;
}

export interface ScheduledTask {
  /** Empty for a task not saved yet. */
  id: string;
  name: string;
  type: ScheduledTaskType;
  source: string;
  destination: string;
  schedule: Schedule;
  enabled: boolean;
  options: TaskOptions;
  nextRun: string | null;
  lastRun: string | null;
  lastRunStatus: TaskRunStatus | null;
  runningJob: string | null;
}

export interface TaskRunHistoryEntry {
  id: string;
  taskId: string;
  taskName: string;
  dateTime: string;
  status: TaskRunStatus;
  details: string;
  files: number | null;
  size: number | null;
  durationSeconds: number;
  logPath: string | null;
}

export interface SchedulerSettings {
  runMissedOnStartup: boolean;
  historyLimit: number;
}

export interface SchedulerData {
  tasks: ScheduledTask[];
  history: TaskRunHistoryEntry[];
  settings: SchedulerSettings;
}

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function describeSchedule(s: Schedule): string {
  switch (s.frequency) {
    case "Daily":
      return `Daily ${s.time}`;
    case "Weekly":
      return `Weekly on ${WEEKDAYS[s.weekday] ?? "?"} ${s.time}`;
    case "Monthly":
      return `Monthly on day ${s.dayOfMonth} ${s.time}`;
    case "Once":
      return `Once on ${s.date} ${s.time}`;
  }
}

export const WEEKDAY_OPTIONS = WEEKDAYS.map((label, i) => ({ value: String(i), label }));

export function newTask(): ScheduledTask {
  const today = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    id: "",
    name: "New task",
    type: "Sync",
    source: "",
    destination: "",
    schedule: {
      frequency: "Daily",
      time: "22:00",
      weekday: 0,
      dayOfMonth: 1,
      date: `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`,
    },
    enabled: true,
    options: {
      includeSubfolders: true,
      incrementalOnly: true,
      deleteAtDestination: false,
      skipFilesInUse: true,
      logAllOperations: true,
      verifyAfterTransfer: false,
    },
    nextRun: null,
    lastRun: null,
    lastRunStatus: null,
    runningJob: null,
  };
}
