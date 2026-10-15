/**
 * Builds a `ReportDocument` from the results the app holds: the last
 * scan (Disk/Folder or Network Analysis), the
 * duplicate finder, the comparison, the file search, the last transfer
 * and sync, and the scheduler. Each throws a readable message when its
 * data source has nothing yet.
 */
import { analyzeSubtree } from "@/api/scan";
import type { ReportCategory, ReportDocument, ReportSection } from "@/models/reports";
import { describeSchedule } from "@/models/scheduler";
import { useComparisonStore } from "@/state/comparisonStore";
import { useDuplicateStore } from "@/state/duplicateStore";
import { useNetworkScanStore, useScanStore } from "@/state/scanStore";
import { useSchedulerStore } from "@/state/schedulerStore";
import { useSearchStore } from "@/state/searchStore";
import { useSyncStore, useTransferStore } from "@/state/transferStore";
import { formatBytes, formatDate, formatDuration, formatNumber } from "@/utils/format";
import { finalizeAnalysis } from "@/utils/scanAnalysis";

export type ReportKind = "disk" | "network" | "duplicates" | "comparison" | "search" | "transfer" | "scheduler";

export const REPORT_KINDS: { value: ReportKind; label: string }[] = [
  { value: "disk", label: "Disk / Folder Analysis Report" },
  { value: "network", label: "Network Analysis Report" },
  { value: "duplicates", label: "Duplicate Finder Report" },
  { value: "comparison", label: "Folder Comparison Report" },
  { value: "search", label: "File Search Report" },
  { value: "transfer", label: "Transfer / Sync Report" },
  { value: "scheduler", label: "Scheduled Tasks Report" },
];

export interface ReportIncludes {
  summary: boolean;
  fileTypes: boolean;
  largest: boolean;
  duplicates: boolean;
  transferHistory: boolean;
}

/** What a report of this kind would be built from (for the form). */
export function reportSource(kind: ReportKind): string | null {
  switch (kind) {
    case "disk":
      return useScanStore.getState().result?.root.path ?? null;
    case "network":
      return useNetworkScanStore.getState().result?.root.path ?? null;
    case "duplicates": {
      const s = useDuplicateStore.getState();
      return s.result ? (s.args?.[0].join("; ") ?? "Duplicate scan") : null;
    }
    case "comparison": {
      const r = useComparisonStore.getState().result;
      return r ? `${r.a.location} ↔ ${r.b.location}` : null;
    }
    case "search": {
      const s = useSearchStore.getState();
      return s.result ? (s.args?.[0] ?? "File search") : null;
    }
    case "transfer": {
      const r = useTransferStore.getState().report ?? useSyncStore.getState().report;
      return r ? `${r.source} → ${r.destination}` : useSchedulerStore.getState().history.length ? "Scheduler history" : null;
    }
    case "scheduler":
      return "All scheduled tasks";
  }
}

function category(kind: ReportKind): ReportCategory {
  return (
    {
      disk: "Disk Analysis",
      network: "Network Analysis",
      duplicates: "Duplicate Finder",
      comparison: "Comparison",
      search: "File Search",
      transfer: "Data Transfer",
      scheduler: "Scheduler",
    } as const
  )[kind];
}

async function scanSections(kind: "disk" | "network", inc: ReportIncludes): Promise<{ source: string; sections: ReportSection[] }> {
  const store = kind === "disk" ? useScanStore.getState() : useNetworkScanStore.getState();
  const result = store.status === "completed" ? store.result : null;
  if (!result || !store.scanId) {
    throw new Error(kind === "disk" ? "Run a scan on Disk Analysis or Folder Analysis first." : "Scan a network share on Network Analysis first.");
  }
  const root = result.root;
  const analysis = finalizeAnalysis(await analyzeSubtree(store.scanId, root.path));
  const sections: ReportSection[] = [];
  if (inc.summary) {
    sections.push({
      kind: "keyValues",
      title: "Summary",
      items: [
        { label: "Location", value: root.path },
        { label: "Total size", value: formatBytes(root.size) },
        { label: "Size on disk", value: formatBytes(root.allocated) },
        { label: "Files", value: formatNumber(root.fileCount) },
        { label: "Folders", value: formatNumber(root.folderCount) },
        { label: "Scan engine", value: result.engine.toUpperCase() },
        { label: "Scan time", value: `${(result.elapsedMs / 1000).toFixed(1)} s` },
        { label: "Unreadable paths", value: formatNumber(result.skipped.length) },
      ],
    });
  }
  if (inc.fileTypes) {
    sections.push({
      kind: "bars",
      title: "File types by size",
      items: analysis.categoryStats.map((c) => ({ label: c.label, value: c.value, display: `${formatBytes(c.value)} (${c.percent.toFixed(1)}%)` })),
    });
    sections.push({
      kind: "table",
      title: "Extensions",
      columns: ["Extension", "Files", "Size (bytes)", "Size", "% of total"],
      rows: analysis.extensionStats.map((e) => [e.extension || "(none)", e.files, e.size, formatBytes(e.size), Number(e.percent.toFixed(2))]),
    });
  }
  if (inc.largest) {
    sections.push({
      kind: "table",
      title: "Largest folders",
      columns: ["Folder", "Size (bytes)", "Size"],
      rows: analysis.topFolders.map((f) => [f.path, f.size, formatBytes(f.size)]),
    });
    sections.push({
      kind: "table",
      title: "Largest files",
      columns: ["File", "Folder", "Size (bytes)", "Size"],
      rows: analysis.topFiles.map((f) => [f.name, f.path, f.size, formatBytes(f.size)]),
    });
    sections.push({
      kind: "bars",
      title: "Last modified",
      items: analysis.timeline.map((t) => ({ label: t.label, value: t.size, display: formatBytes(t.size) })),
    });
  }
  return { source: root.path, sections };
}

function duplicateSections(inc: ReportIncludes): { source: string; sections: ReportSection[] } {
  const s = useDuplicateStore.getState();
  const r = s.status === "completed" ? s.result : null;
  if (!r) throw new Error("Run the Duplicate Finder first.");
  const sections: ReportSection[] = [];
  if (inc.summary) {
    sections.push({
      kind: "keyValues",
      title: "Summary",
      items: [
        { label: "Locations", value: s.args?.[0].join("; ") ?? "-" },
        { label: "Criteria", value: s.args?.[1].criteria ?? "-" },
        { label: "Files compared", value: formatNumber(r.filesCompared) },
        { label: "Duplicate groups", value: formatNumber(r.totalGroups) },
        { label: "Duplicate files", value: formatNumber(r.totalDuplicateFiles) },
        { label: "Recoverable space", value: formatBytes(r.totalWastedBytes) },
        { label: "Time", value: `${(r.elapsedMs / 1000).toFixed(1)} s` },
      ],
    });
  }
  if (inc.duplicates || inc.largest) {
    sections.push({
      kind: "table",
      title: "Duplicate files",
      columns: ["Group", "File", "Folder", "Size (bytes)", "Modified", "Recoverable in group"],
      rows: r.groups.flatMap((g, i) =>
        g.files.map((f) => {
          const folder = f.path.slice(0, Math.max(0, f.path.length - f.name.length - 1));
          return [i + 1, f.name, folder, f.size, formatDate(f.lastModified), formatBytes(g.wastedBytes)];
        }),
      ),
    });
  }
  return { source: s.args?.[0].join("; ") ?? "", sections };
}

function comparisonSections(inc: ReportIncludes): { source: string; sections: ReportSection[] } {
  const r = useComparisonStore.getState().result;
  if (!r) throw new Error("Compare two locations first.");
  const t = r.totals;
  const sections: ReportSection[] = [];
  if (inc.summary) {
    sections.push({
      kind: "keyValues",
      title: "Summary",
      items: [
        { label: "Location A", value: `${r.a.location} - ${formatNumber(r.a.files)} files, ${formatBytes(r.a.totalBytes)}` },
        { label: "Location B", value: `${r.b.location} - ${formatNumber(r.b.files)} files, ${formatBytes(r.b.totalBytes)}` },
        { label: "Identical", value: formatNumber(t.identicalFiles) },
        { label: "Different", value: `${formatNumber(t.differentFiles)} (${formatBytes(t.differentDataBytes)})` },
        { label: "Only in A", value: `${formatNumber(t.leftOnly)} (${formatBytes(t.leftOnlyBytes)})` },
        { label: "Only in B", value: `${formatNumber(t.rightOnly)} (${formatBytes(t.rightOnlyBytes)})` },
      ],
    });
  }
  sections.push({
    kind: "table",
    title: "Differences",
    columns: ["Status", "Relative path", "Size A", "Size B", "Modified A", "Modified B"],
    rows: r.rows
      .filter((row) => row.status !== "identical" || inc.largest)
      .map((row) => [row.status, row.relativePath, row.sizeA, row.sizeB, formatDate(row.modifiedA), formatDate(row.modifiedB)]),
  });
  return { source: `${r.a.location} ↔ ${r.b.location}`, sections };
}

function searchSections(inc: ReportIncludes): { source: string; sections: ReportSection[] } {
  const s = useSearchStore.getState();
  const r = s.status === "completed" ? s.result : null;
  if (!r) throw new Error("Run a file search first.");
  const sections: ReportSection[] = [];
  if (inc.summary) {
    sections.push({
      kind: "keyValues",
      title: "Summary",
      items: [
        { label: "Location", value: s.args?.[0] ?? "-" },
        { label: "Query", value: s.args?.[1].query ?? "-" },
        { label: "Files searched", value: formatNumber(r.filesSearched) },
        { label: "Matches", value: formatNumber(r.totalHits) },
        { label: "Time", value: `${(r.elapsedMs / 1000).toFixed(1)} s` },
      ],
    });
  }
  sections.push({
    kind: "table",
    title: "Results",
    columns: ["Name", "Path", "Size (bytes)", "Modified", "Matched in", "Occurrences"],
    rows: r.hits.map((h) => [h.name, h.path, h.size, formatDate(h.lastModified), h.matchedIn, h.occurrences]),
  });
  return { source: s.args?.[0] ?? "", sections };
}

function transferSections(inc: ReportIncludes): { source: string; sections: ReportSection[] } {
  const reports = [useTransferStore.getState().report, useSyncStore.getState().report].filter((r) => r != null);
  const history = useSchedulerStore.getState().history.filter((h) => h.files != null);
  if (reports.length === 0 && history.length === 0) throw new Error("No transfer, sync or scheduled run has completed yet.");
  const sections: ReportSection[] = [];
  for (const r of reports) {
    if (inc.summary) {
      sections.push({
        kind: "keyValues",
        title: `${r.mode} - ${r.source} → ${r.destination}`,
        items: [
          { label: "Files copied", value: `${formatNumber(r.filesCopied)} (${formatBytes(r.bytesCopied)})` },
          { label: "Verified", value: formatNumber(r.filesVerified) },
          { label: "Deleted", value: formatNumber(r.filesDeleted) },
          { label: "Folders created", value: formatNumber(r.foldersCreated) },
          { label: "Errors", value: formatNumber(r.errorCount) },
          { label: "Duration", value: formatDuration(r.elapsedMs / 1000) },
        ],
      });
    }
    if (r.errors.length) {
      sections.push({ kind: "table", title: "Errors", columns: ["Path", "Error"], rows: r.errors.map((e) => [e.path, e.message]) });
    }
  }
  if (inc.transferHistory && history.length) {
    sections.push({
      kind: "table",
      title: "Scheduled runs",
      columns: ["Date", "Task", "Status", "Details", "Files", "Size (bytes)", "Duration (s)"],
      rows: history.map((h) => [formatDate(h.dateTime), h.taskName, h.status, h.details, h.files, h.size, Math.round(h.durationSeconds)]),
    });
  }
  const r = reports[0];
  return { source: r ? `${r.source} → ${r.destination}` : "Scheduler history", sections };
}

function schedulerSections(inc: ReportIncludes): { source: string; sections: ReportSection[] } {
  const { tasks, history } = useSchedulerStore.getState();
  const sections: ReportSection[] = [
    {
      kind: "table",
      title: "Scheduled tasks",
      columns: ["Name", "Type", "Source", "Destination", "Schedule", "Enabled", "Next run", "Last run", "Last status"],
      rows: tasks.map((t) => [
        t.name,
        t.type,
        t.source,
        t.type === "Analyze" ? "" : t.destination,
        describeSchedule(t.schedule),
        t.enabled ? "yes" : "no",
        formatDate(t.nextRun),
        formatDate(t.lastRun),
        t.lastRunStatus ?? "",
      ]),
    },
  ];
  if (inc.summary) {
    const count = (s: string) => history.filter((h) => h.status === s).length;
    sections.unshift({
      kind: "keyValues",
      title: "Summary",
      items: [
        { label: "Tasks", value: `${tasks.length} (${tasks.filter((t) => t.enabled).length} enabled)` },
        { label: "Runs recorded", value: formatNumber(history.length) },
        { label: "Succeeded / failed / missed", value: `${count("success")} / ${count("failed")} / ${count("missed")}` },
      ],
    });
  }
  if (inc.transferHistory) {
    sections.push({
      kind: "table",
      title: "Run history",
      columns: ["Date", "Task", "Status", "Details", "Files", "Size (bytes)", "Duration (s)"],
      rows: history.map((h) => [formatDate(h.dateTime), h.taskName, h.status, h.details, h.files, h.size, Math.round(h.durationSeconds)]),
    });
  }
  return { source: "All scheduled tasks", sections };
}

export async function buildReport(kind: ReportKind, inc: ReportIncludes, notes: string | null): Promise<ReportDocument> {
  const built =
    kind === "disk" || kind === "network"
      ? await scanSections(kind, inc)
      : kind === "duplicates"
        ? duplicateSections(inc)
        : kind === "comparison"
          ? comparisonSections(inc)
          : kind === "search"
            ? searchSections(inc)
            : kind === "transfer"
              ? transferSections(inc)
              : schedulerSections(inc);
  return {
    title: REPORT_KINDS.find((k) => k.value === kind)!.label,
    // A scan of a drive root is a disk analysis; anything deeper a folder analysis.
    category: kind === "disk" && !/^[A-Za-z]:\\?$/.test(built.source) ? "Folder Analysis" : category(kind),
    source: built.source,
    notes: notes?.trim() ? notes.trim() : null,
    sections: built.sections,
  };
}
