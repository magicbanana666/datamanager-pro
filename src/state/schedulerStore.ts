/**
 * The scheduler's tasks, history and settings - owned by the backend
 * (`commands::scheduler`), mirrored here and refreshed on every
 * `scheduler-changed` event. Finished runs are toasted from here, so
 * they're announced on whichever page is open.
 */
import { create } from "zustand";
import { toAppError } from "@/api/backend";
import {
  clearTaskHistory,
  deleteScheduledTask,
  getScheduler,
  onSchedulerChanged,
  onTaskRunFinished,
  runTaskNow,
  saveScheduledTask,
  setTaskEnabled,
  updateSchedulerSettings,
} from "@/api/scheduler";
import type { ScheduledTask, SchedulerSettings, TaskRunHistoryEntry } from "@/models/scheduler";
import { toast } from "@/state/toastStore";

interface SchedulerState {
  loaded: boolean;
  tasks: ScheduledTask[];
  history: TaskRunHistoryEntry[];
  settings: SchedulerSettings;
  selectedTaskId: string | null;
  selectTask: (id: string | null) => void;
  /** Loads once and subscribes to changes; later calls are no-ops. */
  init: () => Promise<void>;
  save: (task: ScheduledTask) => Promise<ScheduledTask | null>;
  toggleEnabled: (id: string) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  runNow: (id: string) => Promise<void>;
  updateSettings: (patch: Partial<SchedulerSettings>) => Promise<void>;
  clearHistory: () => Promise<void>;
}

const fail = (err: unknown) => {
  toast.danger(toAppError(err).message);
};

export const useSchedulerStore = create<SchedulerState>((set, get) => {
  let initialized = false;
  const refresh = async () => {
    try {
      const data = await getScheduler();
      set({ loaded: true, tasks: data.tasks, history: data.history, settings: data.settings });
    } catch (err) {
      fail(err);
    }
  };

  return {
    loaded: false,
    tasks: [],
    history: [],
    settings: { runMissedOnStartup: true, historyLimit: 500 },
    selectedTaskId: null,
    selectTask: (id) => set({ selectedTaskId: id }),

    init: async () => {
      if (initialized) return;
      initialized = true;
      await onSchedulerChanged(() => void refresh());
      await onTaskRunFinished(({ taskName, status, details }) => {
        if (status === "success") toast.success(details, `Scheduled task "${taskName}" finished`);
        else if (status === "cancelled") toast.info(details, `Scheduled task "${taskName}" stopped`);
        else toast.danger(details, `Scheduled task "${taskName}" failed`);
      });
      await refresh();
    },

    save: async (task) => {
      try {
        const saved = await saveScheduledTask(task);
        set({ selectedTaskId: saved.id });
        toast.success(`"${saved.name}" saved.`);
        return saved;
      } catch (err) {
        fail(err);
        return null;
      }
    },

    toggleEnabled: async (id) => {
      const task = get().tasks.find((t) => t.id === id);
      if (task) await setTaskEnabled(id, !task.enabled).catch(fail);
    },

    deleteTask: async (id) => {
      await deleteScheduledTask(id).catch(fail);
      if (get().selectedTaskId === id) set({ selectedTaskId: null });
    },

    runNow: async (id) => {
      try {
        await runTaskNow(id);
        const task = get().tasks.find((t) => t.id === id);
        toast.info(`"${task?.name ?? "Task"}" started.`);
      } catch (err) {
        fail(err);
      }
    },

    updateSettings: async (patch) => {
      await updateSchedulerSettings({ ...get().settings, ...patch }).catch(fail);
    },

    clearHistory: async () => {
      await clearTaskHistory().catch(fail);
    },
  };
});
