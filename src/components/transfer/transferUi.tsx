/**
 * UI pieces shared by Data Transfer and Sync / Incremental: plan-action
 * badges, per-row status, the log, the completion report and the list
 * of interrupted (resumable) transfers.
 */
import { useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, Clock, MinusCircle, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/controls/Button";
import { Card } from "@/components/cards/Card";
import { discardInterruptedTransfer, listInterruptedTransfers } from "@/api/transfer";
import { toAppError } from "@/api/backend";
import type { InterruptedTransfer, PlanItem, TransferReport } from "@/models/transfer";
import { isWork } from "@/utils/transfer";
import type { LogLine, RowState, TransferStatus } from "@/state/transferStore";
import { toast } from "@/state/toastStore";
import { formatBytes, formatDate, formatDuration, formatNumber } from "@/utils/format";

export function RowStatusIcon({ item, state }: { item: PlanItem; state?: RowState }) {
  if (state?.status === "done") return <CheckCircle2 size={14} className="text-success" />;
  if (state?.status === "error")
    return (
      <span title={state.message}>
        <AlertTriangle size={14} className="text-danger" />
      </span>
    );
  if (state?.status === "in-progress") return <ArrowRight size={14} className="text-accent" />;
  if (state?.status === "skipped" || !isWork(item.action)) return <MinusCircle size={14} className="text-fg-subtle" />;
  return <Clock size={14} className="text-fg-subtle" />;
}

export function TransferLogCard({ log }: { log: LogLine[] }) {
  return (
    <Card padded={false} bodyClassName="h-full overflow-y-auto p-3 font-mono text-[12px] text-fg-muted" className="min-h-0 flex-1">
      {log.length === 0 && <div>Ready.</div>}
      {log.map((line, i) => (
        <div key={i} className={line.text.startsWith("ERROR") ? "text-danger" : line.text.startsWith("WARNING") ? "text-warning" : undefined}>
          [{line.time}] {line.text}
        </div>
      ))}
    </Card>
  );
}

export function TransferReportCard({ report }: { report: TransferReport | null }) {
  if (!report) {
    return (
      <Card title="Report">
        <p className="text-[12.5px] text-fg-muted">The report appears here once a transfer completes.</p>
      </Card>
    );
  }
  return (
    <Card title="Report" className="min-h-0 flex-1" bodyClassName="flex min-h-0 flex-col gap-3 overflow-y-auto">
      <dl className="grid grid-cols-[170px_1fr] gap-y-1.5 text-[12.5px]">
        <dt className="text-fg-muted">From / to:</dt>
        <dd className="text-fg">{report.source} → {report.destination}</dd>
        <dt className="text-fg-muted">Mode:</dt>
        <dd className="text-fg">{report.mode}{report.resumed ? " (resumed)" : ""}</dd>
        <dt className="text-fg-muted">Files copied:</dt>
        <dd className="text-fg">{formatNumber(report.filesCopied)} ({formatBytes(report.bytesCopied)})</dd>
        <dt className="text-fg-muted">Verified:</dt>
        <dd className="text-fg">{formatNumber(report.filesVerified)}</dd>
        <dt className="text-fg-muted">Deleted:</dt>
        <dd className="text-fg">{formatNumber(report.filesDeleted)}</dd>
        <dt className="text-fg-muted">Folders created:</dt>
        <dd className="text-fg">{formatNumber(report.foldersCreated)}</dd>
        <dt className="text-fg-muted">Duration:</dt>
        <dd className="text-fg">{formatDuration(report.elapsedMs / 1000)}</dd>
        <dt className="text-fg-muted">Errors:</dt>
        <dd className={report.errorCount ? "text-danger" : "text-fg"}>{formatNumber(report.errorCount)}</dd>
      </dl>
      {report.errors.length > 0 && (
        <div className="flex flex-col gap-1 font-mono text-[11.5px]">
          {report.errors.map((e, i) => (
            <div key={i} className="text-danger">
              {e.path}: {e.message}
            </div>
          ))}
          {report.errorCount > report.errors.length && (
            <div className="text-fg-muted">... and {formatNumber(report.errorCount - report.errors.length)} more (see the log).</div>
          )}
        </div>
      )}
    </Card>
  );
}

/** Unfinished transfers kept in the journal, with Resume / Discard.
 * Refreshed whenever `status` changes (a job that just stopped). */
export function InterruptedTransfersCard({
  status,
  onResume,
}: {
  status: TransferStatus;
  onResume: (job: InterruptedTransfer) => void;
}) {
  const [jobs, setJobs] = useState<InterruptedTransfer[]>([]);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (status === "running" || status === "analyzing") return;
    let alive = true;
    listInterruptedTransfers()
      .then((j) => alive && setJobs(j))
      .catch(() => alive && setJobs([]));
    return () => {
      alive = false;
    };
  }, [status, refresh]);

  if (jobs.length === 0) return null;
  return (
    <Card title="Interrupted Transfers" bodyClassName="flex flex-col gap-1.5">
      {jobs.map((j) => (
        <div key={j.jobId} className="flex items-center gap-3 text-[12.5px]">
          <div className="min-w-0 flex-1 truncate">
            <span className="text-fg">{j.source} → {j.destination}</span>
            <span className="text-fg-muted">
              {" "}· {j.mode} · {formatNumber(j.filesDone)} / {formatNumber(j.filesTotal)} files · {formatBytes(j.bytesDone)} / {formatBytes(j.bytesTotal)} · started {formatDate(j.startedAt)}
            </span>
          </div>
          <Button size="sm" icon={RotateCcw} onClick={() => onResume(j)}>Resume</Button>
          <Button
            size="sm"
            variant="ghost"
            icon={Trash2}
            onClick={() =>
              discardInterruptedTransfer(j.jobId)
                .then(() => setRefresh((n) => n + 1))
                .catch((e) => toast.danger(toAppError(e).message))
            }
          >
            Discard
          </Button>
        </div>
      ))}
    </Card>
  );
}
