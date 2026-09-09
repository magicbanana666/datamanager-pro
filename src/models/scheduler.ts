export type ScheduledTaskType = "Sync" | "Copy" | "Move" | "Mirror" | "Analyze";

export type ScheduleFrequency = "Daily" | "Weekly" | "Monthly" | "Once";

export type TaskRunStatus = "success" | "failed" | "running";

export interface ScheduledTask {
  id: string;
  name: string;
  type: ScheduledTaskType;
  description: string;
  source: string;
  destination: string;
  schedule: ScheduleFrequency;
  scheduleDetail: string;
  time: string;
  nextRun: string;
  lastRun: string;
  lastRunStatus: TaskRunStatus;
  enabled: boolean;
  options: {
    includeSubfolders: boolean;
    incrementalOnly: boolean;
    deleteAtDestination: boolean;
    skipFilesInUse: boolean;
    logAllOperations: boolean;
    sendEmailNotification: boolean;
  };
  runAs: string;
}

export interface TaskRunHistoryEntry {
  id: string;
  dateTime: string;
  taskName: string;
  status: TaskRunStatus;
  details: string;
  files: number | null;
  size: number | null;
  durationSeconds: number;
}
