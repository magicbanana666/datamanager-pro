import type { LucideIcon } from "lucide-react";

/** Windows' own tools the app can open (`launch_system_tool`). */
export type SystemTool =
  | "command-prompt"
  | "power-shell"
  | "task-manager"
  | "services"
  | "event-viewer"
  | "disk-cleanup"
  | "file-history";

/** Built-in tool dialogs (`src/pages/tools/ToolDialog.tsx`). */
export type ToolDialogId =
  | "explorer"
  | "properties"
  | "hash"
  | "split"
  | "merge"
  | "shred"
  | "disk-health"
  | "system-info"
  | "ping"
  | "dns"
  | "wol"
  | "zip"
  | "unzip"
  | "verify"
  | "script"
  | "logs";

export type ToolAction =
  | { kind: "route"; to: string }
  | { kind: "dialog"; dialog: ToolDialogId }
  | { kind: "system"; tool: SystemTool }
  | { kind: "settings" };

export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  action: ToolAction;
  accentColorIndex: number;
}

export interface ToolCategoryGroup {
  id: string;
  title: string;
  tools: ToolDefinition[];
}
