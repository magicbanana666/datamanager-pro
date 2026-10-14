import type { ScanSkip } from "@/models/backend";

export type ComparisonMode = "size-timestamp" | "content-hash" | "name-only";

export type ComparisonStatus = "identical" | "different" | "left-only" | "right-only";

export interface ComparisonRow {
  id: string;
  status: ComparisonStatus;
  name: string;
  pathA: string | null;
  pathB: string | null;
  sizeA: number | null;
  sizeB: number | null;
  modifiedA: string | null;
  modifiedB: string | null;
  category: string;
}

export interface ComparisonOptions {
  includeSubfolders: boolean;
  ignoreTimestamps: boolean;
  ignoreSmallFiles: boolean;
}

export interface ComparisonSummary {
  location: string;
  totalBytes: number;
  files: number;
  folders: number;
  lastModified: string;
}

export interface ComparisonResultTotals {
  identicalFiles: number;
  differentFiles: number;
  leftOnly: number;
  rightOnly: number;
  differentDataBytes: number;
  leftOnlyBytes: number;
  rightOnlyBytes: number;
}

/** Sent to `start_comparison` - mirrors `ComparisonOptions` in
 * `src-tauri/src/models/comparison.rs`. */
export interface ComparisonRequestOptions extends ComparisonOptions {
  mode: ComparisonMode;
}

export interface BackendComparisonRow {
  status: ComparisonStatus;
  /** Relative to each side's location. */
  relativePath: string;
  sizeA: number | null;
  sizeB: number | null;
  modifiedA: string | null;
  modifiedB: string | null;
}

export interface ComparisonSide {
  location: string;
  totalBytes: number;
  files: number;
  folders: number;
  lastModified: string | null;
  extensions: { extension: string; files: number; size: number }[];
}

export interface ComparisonTotals extends ComparisonResultTotals {
  identicalBytes: number;
}

export interface ComparisonResult {
  scanId: string;
  a: ComparisonSide;
  b: ComparisonSide;
  totals: ComparisonTotals;
  /** The largest rows of each status, capped backend-side - `totals`
   * counts every file. */
  rows: BackendComparisonRow[];
  elapsedMs: number;
  skipped: ScanSkip[];
}
