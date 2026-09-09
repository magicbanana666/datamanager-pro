export type TransferMode = "copy" | "move" | "sync" | "mirror";

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

export interface TransferOptions {
  createMissingFolders: boolean;
  verifyAfterTransfer: boolean;
  preservePermissions: boolean;
  includeSubfolders: boolean;
}

export interface TransferSpeedSample {
  t: number;
  mbps: number;
}

export interface TransferStats {
  filesProcessed: number;
  totalFiles: number;
  bytesProcessed: number;
  totalBytes: number;
  speedBps: number;
  elapsedSeconds: number;
  remainingSeconds: number;
  currentFile: string;
  foldersProcessed: number;
  errors: number;
}

export type AfterCompletionAction = "nothing" | "open-destination" | "shutdown" | "show-report";
