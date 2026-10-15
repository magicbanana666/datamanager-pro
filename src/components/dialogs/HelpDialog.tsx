import { BookOpen, FolderOpen, LifeBuoy, MessageSquare, Plug, PlugZap } from "lucide-react";
import { logsFolder } from "@/api/diagnostics";
import { openFolder } from "@/api/transfer";
import { Dialog } from "@/components/dialogs/Dialog";
import { Button } from "@/components/controls/Button";
import { Badge } from "@/components/controls/Badge";
import { useUiStore } from "@/state/uiStore";
import { useBackendStatus } from "@/hooks/useBackendStatus";
import { formatBytes } from "@/utils/format";

export function HelpDialog() {
  const { helpOpen, closeHelp, appVersion } = useUiStore();
  const backend = useBackendStatus(helpOpen);

  return (
    <Dialog
      open={helpOpen}
      onClose={closeHelp}
      title="Help & About"
      footer={<Button variant="primary" onClick={closeHelp}>Close</Button>}
    >
      <div className="flex flex-col gap-4">
        <div>
          <div className="text-[15px] font-semibold text-fg">DataManager Pro</div>
          <div className="text-xs text-fg-muted">Analyze. Migrate. Manage. Your Data. — v{appVersion}</div>
        </div>
        <div className="flex flex-col gap-2 text-[13px] text-fg-muted">
          <div className="flex items-start gap-2.5">
            <BookOpen size={15} className="mt-0.5 shrink-0 text-accent" />
            <span>
              Scans, analysis, duplicates, comparison and search only read your files. Data Transfer, Sync, the Scheduler
              and the delete/move actions write - only when you start them; deletions go to the Recycle Bin.
            </span>
          </div>
          <div className="flex items-start gap-2.5">
            <LifeBuoy size={15} className="mt-0.5 shrink-0 text-accent" />
            <span>An interrupted transfer can be resumed from Data Transfer. Scheduled tasks run while the app is open.</span>
          </div>
          <div className="flex items-start gap-2.5">
            <MessageSquare size={15} className="mt-0.5 shrink-0 text-accent" />
            <span className="flex flex-wrap items-center gap-2">
              Problems? The log files help:
              <Button size="sm" icon={FolderOpen} onClick={() => logsFolder().then(openFolder).catch(() => {})}>
                Open logs folder
              </Button>
            </span>
          </div>
        </div>

        <div className="rounded-md border border-border bg-surface-alt p-3">
          <div className="mb-1.5 flex items-center gap-2 text-[12px] font-semibold text-fg">
            {backend.state === "connected" ? (
              <PlugZap size={14} className="text-success" />
            ) : (
              <Plug size={14} className="text-fg-subtle" />
            )}
            Rust Backend Bridge
            <Badge
              tone={backend.state === "connected" ? "success" : backend.state === "checking" ? "info" : "danger"}
              dot
              className="ml-auto"
            >
              {backend.state === "connected" ? "Connected" : backend.state === "checking" ? "Checking..." : "Unavailable"}
            </Badge>
          </div>
          {backend.state === "connected" && backend.appVersion && backend.systemInfo && (
            <dl className="grid grid-cols-[90px_1fr] gap-y-1 text-[11.5px] text-fg-muted">
              <dt>ping_backend:</dt>
              <dd className="text-fg">"{backend.ping}"</dd>
              <dt>get_app_version:</dt>
              <dd className="text-fg">
                {backend.appVersion.name} v{backend.appVersion.version} (Tauri {backend.appVersion.tauriVersion})
              </dd>
              <dt>get_system_info:</dt>
              <dd className="text-fg">
                {backend.systemInfo.os} {backend.systemInfo.osVersion} · {backend.systemInfo.cpuLogicalCores} logical
                cores · {formatBytes(backend.systemInfo.totalMemoryBytes)} RAM
              </dd>
            </dl>
          )}
          {backend.state === "unavailable" && (
            <p className="text-[11.5px] text-fg-subtle">
              Couldn't reach the Rust backend - this view only responds inside the Tauri app (via `npm run tauri dev`).
            </p>
          )}
        </div>
      </div>
    </Dialog>
  );
}
