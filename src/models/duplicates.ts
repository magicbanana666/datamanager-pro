import type { ScanSkip } from "@/models/backend";

/** Mirrors `DuplicateCriteria` in `src-tauri/src/models/duplicates.rs`. */
export type DuplicateCriteriaId = "exact" | "same-name" | "same-size";

/** UI row for one file in a duplicate group. */
export interface DuplicateFileEntry {
  /** The full path - unique, so it doubles as the row id. */
  id: string;
  name: string;
  /** The containing folder. */
  path: string;
  size: number;
  type: string;
  modified: string | null;
  selected: boolean;
  /** The copy the active keep rule keeps - never selectable. */
  isOriginal?: boolean;
}

/** UI model for one group of duplicates. */
export interface DuplicateGroup {
  id: string;
  label: string;
  size: number;
  type: string;
  files: DuplicateFileEntry[];
  wastedBytes: number;
  expanded: boolean;
}

/** Sent to `start_duplicate_scan`. */
export interface DuplicateOptions {
  criteria: DuplicateCriteriaId;
  ignoreCase: boolean;
  ignoreHidden: boolean;
  ignoreSystem: boolean;
  /** Bytes. */
  minSize: number;
  maxSize: number | null;
}

export interface BackendDuplicateFile {
  path: string;
  name: string;
  size: number;
  lastModified: string | null;
}

export interface BackendDuplicateGroup {
  key: string;
  files: BackendDuplicateFile[];
  wastedBytes: number;
}

export interface DuplicateResult {
  scanId: string;
  /** Largest-waste groups first, capped backend-side - the totals cover
   * every group found. */
  groups: BackendDuplicateGroup[];
  totalGroups: number;
  totalDuplicateFiles: number;
  totalWastedBytes: number;
  filesCompared: number;
  elapsedMs: number;
  skipped: ScanSkip[];
}

export type DuplicatePhase = "collecting" | "comparing" | "hashing";

export interface DuplicateProgress {
  scanId: string;
  phase: DuplicatePhase;
  filesFound: number;
  bytesToHash: number;
  bytesHashed: number;
  currentPath: string;
  elapsedMs: number;
}
