/**
 * Projects (toolbar Open/Save Project) and the remembered session.
 *
 * A project is the set of locations and options the pages were last used
 * with - the folder/disk scan, the network share, Data Transfer, Sync,
 * Compare Locations, File Search and the Duplicate Finder - saved as a
 * `.dmproj` JSON file. Opening one puts those back into the stores (each
 * page reads them when it mounts) without running anything.
 *
 * With Settings > General > "Remember last location", the same snapshot
 * is kept in local storage and restored at launch.
 */
import type { ComparisonRequestOptions } from "@/models/comparison";
import type { DuplicateOptions } from "@/models/duplicates";
import type { SearchRequest } from "@/models/search";
import type { TransferRequest } from "@/models/transfer";
import { useComparisonStore } from "@/state/comparisonStore";
import { useDuplicateStore } from "@/state/duplicateStore";
import { useNetworkScanStore, useScanStore } from "@/state/scanStore";
import { useSearchStore } from "@/state/searchStore";
import { useSettingsStore } from "@/state/settingsStore";
import { useSyncStore, useTransferStore } from "@/state/transferStore";

export interface ProjectFile {
  app: "DataManager Pro";
  version: 1;
  savedAt: string;
  /** The page that was open (route). */
  page: string;
  scanPath?: string | null;
  networkPath?: string | null;
  transfer?: TransferRequest | null;
  sync?: TransferRequest | null;
  comparison?: [string, string, ComparisonRequestOptions] | null;
  search?: [string, SearchRequest] | null;
  duplicates?: [string[], DuplicateOptions] | null;
}

const SESSION_KEY = "dmp-session";

function currentPage(): string {
  const hash = window.location.hash.replace(/^#/, "");
  return hash.startsWith("/") ? hash : "/";
}

export function collectProject(): ProjectFile {
  return {
    app: "DataManager Pro",
    version: 1,
    savedAt: new Date().toISOString(),
    page: currentPage(),
    scanPath: useScanStore.getState().path,
    networkPath: useNetworkScanStore.getState().path,
    transfer: useTransferStore.getState().request,
    sync: useSyncStore.getState().request,
    comparison: useComparisonStore.getState().args,
    search: useSearchStore.getState().args,
    duplicates: useDuplicateStore.getState().args,
  };
}

/** Parses and checks a project file's text. */
export function parseProject(text: string): ProjectFile {
  const data = JSON.parse(text) as Partial<ProjectFile>;
  if (data?.app !== "DataManager Pro" || data.version !== 1) {
    throw new Error("This isn't a DataManager Pro project file.");
  }
  return data as ProjectFile;
}

/** Puts a project's locations and options back. Runs nothing. */
export function applyProject(p: ProjectFile): void {
  if (p.scanPath) useScanStore.getState().setPath(p.scanPath);
  if (p.networkPath) useNetworkScanStore.getState().setPath(p.networkPath);
  if (p.transfer) useTransferStore.getState().setRequest(p.transfer);
  if (p.sync) useSyncStore.getState().setRequest(p.sync);
  if (p.comparison) useComparisonStore.getState().setArgs(p.comparison);
  if (p.search) useSearchStore.getState().setArgs(p.search);
  if (p.duplicates) useDuplicateStore.getState().setArgs(p.duplicates);
}

function readSession(): ProjectFile | null {
  try {
    const text = localStorage.getItem(SESSION_KEY);
    return text ? parseProject(text) : null;
  } catch {
    return null;
  }
}

/**
 * At launch, before the first render: restores the last session's
 * locations (if remembered) and picks the start page per Settings >
 * General > Launch behavior. Returns whether to open New Scan.
 */
export function restoreSessionAtLaunch(): { openNewScan: boolean } {
  const { general } = useSettingsStore.getState().settings;
  const session = readSession();
  if (session && general.rememberLastLocation) applyProject(session);
  if (general.launchBehavior === "restore-last-session" && session?.page && session.page !== currentPage()) {
    window.location.hash = session.page;
  }
  return { openNewScan: general.launchBehavior === "show-new-scan" };
}

let saveTimer: number | undefined;

/** Keeps the session snapshot up to date (debounced) from now on. */
export function startSessionAutosave(): void {
  const save = () => {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      try {
        localStorage.setItem(SESSION_KEY, JSON.stringify(collectProject()));
      } catch {
        // Storage full or unavailable: the session just isn't remembered.
      }
    }, 1_000);
  };
  for (const store of [useScanStore, useNetworkScanStore, useComparisonStore, useSearchStore, useDuplicateStore]) {
    store.subscribe(save);
  }
  useTransferStore.subscribe(save);
  useSyncStore.subscribe(save);
  window.addEventListener("hashchange", save);
}
