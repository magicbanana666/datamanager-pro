/**
 * A short history of finished scans, transfers and duplicate runs for
 * the Overview dashboard, persisted in the webview's local storage.
 * Recorded by watching the feature stores (`startActivityTracking`),
 * so none of them needs to know about it.
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { useDuplicateStore } from "@/state/duplicateStore";
import { useNetworkScanStore, useScanStore } from "@/state/scanStore";
import { useFileActionStore, useSyncStore, useTransferStore } from "@/state/transferStore";
import { formatBytes, formatNumber } from "@/utils/format";

export type ActivityKind = "scan" | "network-scan" | "transfer" | "sync" | "file-action" | "duplicates";
export type ActivityStatus = "completed" | "cancelled" | "error";

export interface Activity {
  id: string;
  kind: ActivityKind;
  /** The location(s) involved. */
  title: string;
  detail: string;
  /** Bytes scanned or copied. */
  size: number | null;
  date: string;
  status: ActivityStatus;
}

const MAX_ENTRIES = 100;

interface ActivityState {
  entries: Activity[];
  add: (entry: Omit<Activity, "id" | "date">) => void;
  clear: () => void;
}

export const useActivityStore = create<ActivityState>()(
  persist(
    (set) => ({
      entries: [],
      add: (entry) =>
        set((s) => ({
          entries: [{ ...entry, id: crypto.randomUUID(), date: new Date().toISOString() }, ...s.entries].slice(0, MAX_ENTRIES),
        })),
      clear: () => set({ entries: [] }),
    }),
    { name: "dmp-activity", storage: createJSONStorage(() => localStorage) },
  ),
);

let started = false;

/** Subscribes once to every store whose finished runs are recorded. */
export function startActivityTracking(): void {
  if (started) return;
  started = true;
  const add = (entry: Omit<Activity, "id" | "date">) => useActivityStore.getState().add(entry);

  for (const [store, kind] of [
    [useScanStore, "scan"],
    [useNetworkScanStore, "network-scan"],
  ] as const) {
    store.subscribe((s, prev) => {
      if (s.status === prev.status || s.scanId !== prev.scanId) return;
      if (s.status === "completed" && s.result) {
        const r = s.result.root;
        add({
          kind,
          title: r.path,
          detail: `${formatNumber(r.fileCount)} files, ${formatNumber(r.folderCount)} folders`,
          size: r.size,
          status: "completed",
        });
      } else if (s.status === "error" || s.status === "cancelled") {
        add({ kind, title: s.path ?? "", detail: s.error?.message ?? "Cancelled", size: null, status: s.status });
      }
    });
  }

  for (const [store, kind] of [
    [useTransferStore, "transfer"],
    [useSyncStore, "sync"],
    [useFileActionStore, "file-action"],
  ] as const) {
    store.subscribe((s, prev) => {
      if (s.status === prev.status || s.jobId !== prev.jobId) return;
      const title = s.request ? `${s.request.source} → ${s.request.destination}` : (s.report ? `${s.report.source} → ${s.report.destination}` : "");
      if (s.status === "completed" && s.report) {
        add({
          kind,
          title,
          detail: `${s.report.mode}: ${formatNumber(s.report.filesCopied)} files copied${s.report.errorCount ? `, ${formatNumber(s.report.errorCount)} errors` : ""}`,
          size: s.report.bytesCopied,
          status: s.report.errorCount ? "error" : "completed",
        });
      } else if (s.status === "error" || s.status === "cancelled") {
        add({ kind, title, detail: s.error?.message ?? "Stopped", size: null, status: s.status });
      }
    });
  }

  useDuplicateStore.subscribe((s, prev) => {
    if (s.status === prev.status || s.status !== "completed" || !s.result) return;
    add({
      kind: "duplicates",
      title: s.args?.[0].join("; ") ?? "",
      detail: `${formatNumber(s.result.totalGroups)} groups, ${formatBytes(s.result.totalWastedBytes)} recoverable`,
      size: s.result.totalWastedBytes,
      status: "completed",
    });
  });
}
