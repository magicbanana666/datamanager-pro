export type SyncMode = "mirror" | "incremental" | "update-newer" | "two-way";

export type SyncAction =
  | "copy-new"
  | "update-newer"
  | "skip-same"
  | "skip-older"
  | "exclude-filter"
  | "conflict";

export interface SyncRow {
  id: string;
  fileName: string;
  sourcePath: string;
  destPath: string;
  size: number;
  modifiedSource: string | null;
  modifiedDest: string | null;
  action: SyncAction;
  included: boolean;
}

export interface SyncOptions {
  deleteExtras: boolean;
  skipSameSizeDate: boolean;
  compareHash: boolean;
  includeFilters: string;
  excludeFilters: string;
  preservePermissions: boolean;
  preserveTimestamps: boolean;
}

export interface SyncSummary {
  newFiles: number;
  newBytes: number;
  updatedFiles: number;
  updatedBytes: number;
  unchangedFiles: number;
  unchangedBytes: number;
  excludedFiles: number;
  excludedBytes: number;
  conflicts: number;
  totalToCopyFiles: number;
  totalToCopyBytes: number;
  estimatedSeconds: number;
}
