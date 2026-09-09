import { useLocation, useNavigate } from "react-router-dom";
import {
  Calendar,
  ClipboardList,
  FolderOpen,
  GitCompare,
  HelpCircle,
  Save,
  ScanSearch,
  Settings,
} from "lucide-react";
import clsx from "clsx";
import type { LucideIcon } from "lucide-react";
import { useUiStore } from "@/state/uiStore";

interface ToolbarButtonConfig {
  id: string;
  label: string;
  icon: LucideIcon;
  path?: string;
  action?: () => void;
}

function ToolbarButton({ label, icon: Icon, active, onClick }: { label: string; icon: LucideIcon; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12.5px] font-medium transition-colors cursor-pointer",
        active ? "bg-accent text-fg-on-accent" : "text-fg-muted hover:bg-surface-hover hover:text-fg",
      )}
    >
      <Icon size={15} strokeWidth={2} />
      {label}
    </button>
  );
}

export function Toolbar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { showPlaceholderDialog, openSettings, openHelp } = useUiStore();

  const leftButtons: ToolbarButtonConfig[] = [
    {
      id: "new-scan",
      label: "New Scan",
      icon: ScanSearch,
      action: () =>
        showPlaceholderDialog(
          "New Scan",
          "Phase 1 Demo Mode — this action is not connected to the backend yet. Use the sidebar to explore Disk, Folder or Network Analysis with sample data instead.",
        ),
    },
    {
      id: "open-project",
      label: "Open Project",
      icon: FolderOpen,
      action: () =>
        showPlaceholderDialog(
          "Open Project",
          "Phase 1 Demo Mode — project files aren't implemented yet. This will let you reopen a saved scan/transfer configuration in a later phase.",
        ),
    },
    {
      id: "save-project",
      label: "Save Project",
      icon: Save,
      action: () =>
        showPlaceholderDialog(
          "Save Project",
          "Phase 1 Demo Mode — project files aren't implemented yet. This will let you save the current scan/transfer configuration in a later phase.",
        ),
    },
    { id: "compare", label: "Compare", icon: GitCompare, path: "/comparison" },
    { id: "scheduler", label: "Scheduler", icon: Calendar, path: "/scheduler" },
    { id: "reports", label: "Reports", icon: ClipboardList, path: "/reports" },
  ];

  return (
    <header className="flex h-11 shrink-0 items-center justify-between border-b border-border bg-canvas-alt px-3">
      <div className="flex items-center gap-1">
        {leftButtons.map((btn) => (
          <ToolbarButton
            key={btn.id}
            label={btn.label}
            icon={btn.icon}
            active={!!btn.path && location.pathname === btn.path}
            onClick={() => (btn.path ? navigate(btn.path) : btn.action?.())}
          />
        ))}
      </div>
      <div className="flex items-center gap-1">
        <ToolbarButton label="Settings" icon={Settings} active={false} onClick={openSettings} />
        <ToolbarButton label="Help" icon={HelpCircle} active={false} onClick={openHelp} />
      </div>
    </header>
  );
}
