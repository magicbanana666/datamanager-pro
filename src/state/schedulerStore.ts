import { create } from "zustand";
import { scheduledTasks as seedTasks, taskRunHistory as seedHistory } from "@/mock/scheduler";
import type { ScheduledTask, TaskRunHistoryEntry } from "@/models/scheduler";
import { toast } from "@/state/toastStore";

interface SchedulerState {
  tasks: ScheduledTask[];
  history: TaskRunHistoryEntry[];
  selectedTaskId: string | null;
  selectTask: (id: string | null) => void;
  toggleEnabled: (id: string) => void;
  updateTask: (id: string, patch: Partial<ScheduledTask>) => void;
  deleteTask: (id: string) => void;
  runNow: (id: string) => void;
}

export const useSchedulerStore = create<SchedulerState>((set, get) => ({
  tasks: seedTasks,
  history: seedHistory,
  selectedTaskId: seedTasks[0]?.id ?? null,
  selectTask: (id) => set({ selectedTaskId: id }),
  toggleEnabled: (id) =>
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === id ? { ...t, enabled: !t.enabled } : t)),
    })),
  updateTask: (id, patch) =>
    set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
  deleteTask: (id) =>
    set((s) => ({
      tasks: s.tasks.filter((t) => t.id !== id),
      selectedTaskId: s.selectedTaskId === id ? null : s.selectedTaskId,
    })),
  runNow: (id) => {
    const task = get().tasks.find((t) => t.id === id);
    toast.demo(
      task
        ? `"${task.name}" would run now. Phase 1 Demo Mode — this action is not connected to the backend yet.`
        : undefined,
    );
  },
}));
