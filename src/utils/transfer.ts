/** Labels and helpers for transfer plans. */
import type { PlanAction } from "@/models/transfer";
import type { StatusTone } from "@/utils/colors";

export const ACTION_BADGE: Record<PlanAction, { tone: StatusTone; label: string }> = {
  "copy-new": { tone: "success", label: "Copy (new)" },
  update: { tone: "warning", label: "Update" },
  "rename-copy": { tone: "info", label: "Copy (renamed)" },
  "copy-back": { tone: "success", label: "Copy back (new)" },
  "update-back": { tone: "warning", label: "Update back" },
  "delete-dest": { tone: "danger", label: "Delete (destination)" },
  "delete-source": { tone: "danger", label: "Delete (source)" },
  "create-folder": { tone: "info", label: "Create folder" },
  "skip-same": { tone: "neutral", label: "Skip (same)" },
  "skip-older": { tone: "neutral", label: "Skip (older)" },
  excluded: { tone: "neutral", label: "Excluded (filter)" },
  conflict: { tone: "danger", label: "Conflict" },
};

/** Whether executing an item of this action does anything. */
export function isWork(action: PlanAction): boolean {
  return !["skip-same", "skip-older", "excluded", "conflict"].includes(action);
}

export function splitPath(path: string): { name: string; folder: string } {
  const i = path.lastIndexOf("\\");
  return i < 0 ? { name: path, folder: "" } : { name: path.slice(i + 1), folder: path.slice(0, i) };
}
