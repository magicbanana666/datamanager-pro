import { BookOpen, LifeBuoy, MessageSquare, Plug, PlugZap } from "lucide-react";
import { Dialog } from "@/components/dialogs/Dialog";
import { Button } from "@/components/controls/Button";
import { Badge } from "@/components/controls/Badge";
import { useUiStore } from "@/state/uiStore";
import { useBackendStatus } from "@/hooks/useBackendStatus";

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
          <div className="text-xs text-fg-muted">
            Analyze. Migrate. Manage. Your Data. — v{appVersion} (Phase 1 - UI Preview)
          </div>
        </div>
        <div className="flex flex-col gap-2 text-[13px] text-fg-muted">
          <div className="flex items-start gap-2.5">
            <BookOpen size={15} className="mt-0.5 shrink-0 text-accent" />
            <span>
              This build is a Phase 1 interface preview. All scans, transfers, and system actions run on mock data -
              no files are read, copied, moved, or deleted.
            </span>
          </div>
          <div className="flex items-start gap-2.5">
            <LifeBuoy size={15} className="mt-0.5 shrink-0 text-accent" />
            <span>Real filesystem, network, and scheduling engines arrive in later phases (see ROADMAP.md).</span>
          </div>
          <div className="flex items-start gap-2.5">
            <MessageSquare size={15} className="mt-0.5 shrink-0 text-accent" />
            <span>Questions or feedback about this preview can be tracked alongside the project README.</span>
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
              <dd className="text-fg">{backend.appVersion.name} v{backend.appVersion.version} (Tauri {backend.appVersion.tauri_version})</dd>
              <dt>system_info:</dt>
              <dd className="text-fg">{backend.systemInfo.cpu} · {backend.systemInfo.total_memory_mb} MB (mock)</dd>
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
