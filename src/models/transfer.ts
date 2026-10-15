import type { ScanSkip } from "@/models/backend";

/** Data Transfer's mode picker. "sync" runs the incremental sync mode. */
export type TransferMode = "copy" | "move" | "sync" | "mirror";

/** Mirrors `TransferMode` in `src-tauri/src/models/transfer.rs`. */
export type BackendTransferMode = "copy" | "move" | "mirror" | "incremental" | "update-newer" | "two-way";

export type CollisionPolicy =
  | "skip-same"
  | "compare-hash"
  | "rename-new"
  | "overwrite-older";

export type TransferFileStatus = "done" | "in-progress" | "queued" | "error" | "skipped";

export interface TransferFileRow {
  id: string;
  status: TransferFileStatus;
  fileName: string;
  sourcePath: string;
  destPath: string;
  size: number;
  progress: number;
  speedBps: number;
  etaSeconds: number | null;
}

/** Mirrors `TransferOptions` (Rust) - every field the engine reads. */
export interface TransferOptions {
  includeSubfolders: boolean;
  createMissingFolders: boolean;
  verifyAfterTransfer: boolean;
  preservePermissions: boolean;
  preserveTimestamps: boolean;
  deleteExtras: boolean;
  skipSameSizeDate: boolean;
  compareHash: boolean;
  includeFilters: string;
  excludeFilters: string;
  useRecycleBin: boolean;
}

export const DEFAULT_TRANSFER_OPTIONS: TransferOptions = {
  includeSubfolders: true,
  createMissingFolders: true,
  verifyAfterTransfer: false,
  preservePermissions: false,
  preserveTimestamps: true,
  deleteExtras: false,
  skipSameSizeDate: true,
  compareHash: false,
  includeFilters: "",
  excludeFilters: "",
  useRecycleBin: true,
};

export interface TransferRequest {
  source: string;
  destination: string;
  mode: BackendTransferMode;
  collision: CollisionPolicy;
  options: TransferOptions;
  /** Copy/move just these files into `destination`. */
  files?: string[];
}

/** Mirrors `PlanAction`. */
export type PlanAction =
  | "copy-new"
  | "update"
  | "rename-copy"
  | "copy-back"
  | "update-back"
  | "delete-dest"
  | "delete-source"
  | "create-folder"
  | "skip-same"
  | "skip-older"
  | "excluded"
  | "conflict";

export interface PlanItem {
  id: number;
  relativePath: string;
  isFolder: boolean;
  action: PlanAction;
  size: number;
  sourceModified: string | null;
  destModified: string | null;
  sourcePath: string;
  destPath: string;
}

export interface PlanSummary {
  newFiles: number;
  newBytes: number;
  updatedFiles: number;
  updatedBytes: number;
  unchangedFiles: number;
  unchangedBytes: number;
  excludedFiles: number;
  excludedBytes: number;
  deletions: number;
  deletionBytes: number;
  conflicts: number;
  foldersToCreate: number;
  totalToCopyFiles: number;
  totalToCopyBytes: number;
  netBytesNeeded: number;
  destFreeBytes: number | null;
}

export interface TransferPlan {
  jobId: string;
  summary: PlanSummary;
  /** Capped backend-side; `totalItems` counts every item. */
  rows: PlanItem[];
  totalItems: number;
  elapsedMs: number;
  skipped: ScanSkip[];
}

export type ItemStatus = "in-progress" | "done" | "skipped" | "error";

export interface ItemUpdate {
  id: number;
  status: ItemStatus;
  message?: string;
}

export type TransferPhase = "analyzing" | "planned" | "copying" | "deleting" | "finishing";

export interface TransferProgress {
  jobId: string;
  phase: TransferPhase;
  paused: boolean;
  filesFound: number;
  filesTotal: number;
  filesDone: number;
  bytesTotal: number;
  bytesDone: number;
  speedBps: number;
  errors: number;
  currentFile: string;
  elapsedMs: number;
  active: { id: number; bytesDone: number; size: number }[];
  updates: ItemUpdate[];
  log: string[];
}

export interface TransferReport {
  jobId: string;
  mode: BackendTransferMode;
  source: string;
  destination: string;
  filesCopied: number;
  bytesCopied: number;
  filesDeleted: number;
  foldersCreated: number;
  filesSkipped: number;
  filesVerified: number;
  errors: { path: string; message: string }[];
  errorCount: number;
  elapsedMs: number;
  resumed: boolean;
}

export interface InterruptedTransfer {
  jobId: string;
  source: string;
  destination: string;
  mode: BackendTransferMode;
  startedAt: string;
  filesTotal: number;
  filesDone: number;
  bytesTotal: number;
  bytesDone: number;
}

/** A decision on one plan item before executing it. */
export interface ItemOverride {
  id: number;
  included: boolean;
  action?: PlanAction;
}

export interface TransferSpeedSample {
  t: number;
  mbps: number;
}

export type AfterCompletionAction = "nothing" | "open-destination" | "shutdown" | "show-report";
