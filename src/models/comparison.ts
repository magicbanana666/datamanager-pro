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
