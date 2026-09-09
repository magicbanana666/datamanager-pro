import type { LucideIcon } from "lucide-react";

export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  /** Route to navigate to, when the tool has a real Phase 1 page (e.g. the
   * IP / Port Scanner). Everything else just shows a demo-mode toast. */
  route?: string;
  accentColorIndex: number;
}

export interface ToolCategoryGroup {
  id: string;
  title: string;
  tools: ToolDefinition[];
}
