import { useEffect, useState } from "react";
import { AlertTriangle, Download, FolderOpen } from "lucide-react";
import { Dialog } from "@/components/dialogs/Dialog";
import { Button } from "@/components/controls/Button";
import { ProgressBar } from "@/components/charts/ProgressBar";
import { dismissCrashReports, logsFolder, takeCrashReports, type CrashReport } from "@/api/diagnostics";
import { openPath } from "@/api/search";
import { openFolder } from "@/api/transfer";
import { useSettingsStore } from "@/state/settingsStore";
import { useUpdateStore } from "@/state/updateStore";
import { formatBytes } from "@/utils/format";

/** "DataManager Pro closed unexpectedly" (crash reports from the last
 * run) and "Update available" - both checked once at launch. */
export function StartupDialogs() {
  const [crashes, setCrashes] = useState<CrashReport[]>([]);
  const updates = useUpdateStore();

  useEffect(() => {
    takeCrashReports().then(setCrashes).catch(() => {});
    // Only release builds update; a dev build has nothing to update to.
    if (import.meta.env.PROD && useSettingsStore.getState().settings.general.checkForUpdates) {
      void useUpdateStore.getState().checkForUpdate(false);
    }
  }, []);

  function dismiss() {
    setCrashes([]);
    void dismissCrashReports();
  }

  const update = updates.update;
  return (
    <>
      <Dialog
        open={crashes.length > 0}
        onClose={dismiss}
        title="DataManager Pro closed unexpectedly"
        footer={
          <>
            <Button icon={FolderOpen} onClick={() => logsFolder().then(openFolder).catch(() => {})}>Open logs folder</Button>
            <Button variant="primary" onClick={dismiss}>OK</Button>
          </>
        }
      >
        <div className="flex flex-col gap-2 text-[12.5px] text-fg-muted">
          <div className="flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-danger" />
            <span>
              The last session ended with an internal error. A crash report was saved; interrupted transfers can be resumed from
              Data Transfer.
            </span>
          </div>
          {crashes.slice(0, 3).map((c) => (
            <button
              key={c.path}
              onClick={() => openPath(c.path).catch(() => {})}
              className="cursor-pointer truncate rounded border border-border bg-surface-alt px-2 py-1.5 text-left font-mono text-[11.5px] hover:text-fg"
              title="Open the crash report"
            >
              {c.fileName}: {c.summary || "(no message)"}
            </button>
          ))}
        </div>
      </Dialog>

      <Dialog
        open={updates.dialogOpen && !!update}
        onClose={updates.closeDialog}
        title={`Update available: v${update?.version ?? ""}`}
        footer={
          updates.status === "downloading" ? null : (
            <>
              <Button onClick={updates.closeDialog}>Later</Button>
              <Button variant="primary" icon={Download} onClick={() => void updates.install()}>Install and restart</Button>
            </>
          )
        }
      >
        <div className="flex flex-col gap-2 text-[12.5px] text-fg-muted">
          <p>
            You have v{update?.currentVersion}. {update?.date ? `Released ${update.date.slice(0, 10)}.` : ""}
          </p>
          {update?.body && <pre className="max-h-[240px] overflow-y-auto whitespace-pre-wrap rounded bg-surface-alt p-2 text-[12px] text-fg">{update.body}</pre>}
          {updates.status === "downloading" && (
            <>
              <ProgressBar value={updates.total ? (updates.downloaded / updates.total) * 100 : 0} indeterminate={!updates.total} />
              <span>
                Downloading {formatBytes(updates.downloaded)}
                {updates.total ? ` / ${formatBytes(updates.total)}` : ""}... the app restarts when it's installed.
              </span>
            </>
          )}
        </div>
      </Dialog>
    </>
  );
}
