/** Scheduler commands. */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ScheduledTask, SchedulerData, SchedulerSettings, TaskRunStatus } from "@/models/scheduler";

export function getScheduler(): Promise<SchedulerData> {
  return invoke("get_scheduler");
}

export function saveScheduledTask(task: ScheduledTask): Promise<ScheduledTask> {
  return invoke("save_scheduled_task", { task });
}

export function deleteScheduledTask(id: string): Promise<void> {
  return invoke("delete_scheduled_task", { id });
}

export function setTaskEnabled(id: string, enabled: boolean): Promise<void> {
  return invoke("set_task_enabled", { id, enabled });
}

export function updateSchedulerSettings(settings: SchedulerSettings): Promise<void> {
  return invoke("update_scheduler_settings", { settings });
}

export function clearTaskHistory(): Promise<void> {
  return invoke("clear_task_history");
}

/** Resolves to the run's job id (its transfer events use it). */
export function runTaskNow(id: string): Promise<string> {
  return invoke("run_task_now", { id });
}

export function onSchedulerChanged(handler: () => void) {
  return listen("scheduler-changed", handler);
}

export interface TaskRunFinished {
  taskName: string;
  status: TaskRunStatus;
  details: string;
}

export function onTaskRunFinished(handler: (e: TaskRunFinished) => void) {
  return listen<TaskRunFinished>("scheduler-run-finished", (e) => handler(e.payload));
}
