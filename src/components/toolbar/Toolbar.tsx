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
import { pickFile, pickSaveFile } from "@/api/dialog";
import { readProjectFile, saveTextFile } from "@/api/fileops";
import { toAppError } from "@/api/backend";
import { toast } from "@/state/toastStore";
import { applyProject, collectProject, parseProject } from "@/utils/project";

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
  const { openNewScan, openSettings, openHelp, remountPages } = useUiStore();

  async function openProject() {
    const path = await pickFile();
    if (!path) return;
    try {
      const project = parseProject(await readProjectFile(path));
      applyProject(project);
      remountPages();
      navigate(project.page || "/");
      toast.success(`Opened ${path.split("\\").pop()}.`, "Project opened");
    } catch (err) {
      toast.danger(err instanceof Error ? err.message : toAppError(err).message);
    }
  }

  async function saveProject() {
    const path = await pickSaveFile("DataManager Project.dmproj", [{ name: "DataManager Pro project", extensions: ["dmproj"] }]);
    if (!path) return;
    saveTextFile(path, JSON.stringify(collectProject(), null, 2))
      .then(() => toast.success("The locations and options of every page were saved.", "Project saved"))
      .catch((err) => toast.danger(toAppError(err).message));
  }

  const leftButtons: ToolbarButtonConfig[] = [
    {
      id: "new-scan",
      label: "New Scan",
      icon: ScanSearch,
      action: openNewScan,
    },
    {
      id: "open-project",
      label: "Open Project",
      icon: FolderOpen,
      action: () => void openProject(),
    },
    {
      id: "save-project",
      label: "Save Project",
      icon: Save,
      action: () => void saveProject(),
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
