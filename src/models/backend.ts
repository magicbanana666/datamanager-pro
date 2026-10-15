/**
 * TypeScript mirrors of the Rust models in `src-tauri/src/models/`.
 * Centralized here per the Phase 2 brief rather than specta/generated
 * bindings - Phase 2's surface is small and stable enough that hand-kept
 * types are simpler than adding a codegen pipeline. If the backend
 * surface grows significantly in a later phase, revisit that decision.
 *
 * Field names are camelCase on both sides (the Rust structs are
 * annotated `#[serde(rename_all = "camelCase")]`) so no mapping layer is
 * needed between what `invoke()` resolves and what these interfaces
 * describe.
 */

import type { FsNode } from "@/models/common";

// ---------------------------------------------------------------------------
// Shared error shape (models::errors::AppError)
// ---------------------------------------------------------------------------

export type AppErrorCode =
  | "pathNotFound"
  | "accessDenied"
  | "invalidPath"
  | "ioError"
  | "unsupported"
  | "networkUnavailable"
  | "volumeUnavailable"
  | "unknown";

export interface AppError {
  code: AppErrorCode;
  message: string;
  path?: string | null;
  details?: string | null;
}

/** True for the shape Tauri rejects a command's promise with when the
 * Rust side returns `Err(AppError)` - as opposed to a totally unrelated
 * JS/transport failure (e.g. calling a command outside the Tauri
 * runtime). Narrows an `unknown` catch value into `AppError`. */
export function isAppError(value: unknown): value is AppError {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    "message" in value &&
    typeof (value as { message: unknown }).message === "string"
  );
}

// ---------------------------------------------------------------------------
// Storage volumes (models::storage)
// ---------------------------------------------------------------------------

export type VolumeType = "fixed" | "removable" | "network" | "optical" | "ramDisk" | "unknown";

export interface StorageVolume {
  id: string;
  name: string;
  mountPoint: string;
  driveLetter: string | null;
  fileSystem: string | null;
  totalBytes: number;
  freeBytes: number;
  availableBytes: number;
  usedBytes: number;
  usagePercent: number;
  isRemovable: boolean;
  isReadOnly: boolean;
  volumeLabel: string | null;
  volumeSerial: string | null;
  volumeType: VolumeType;
}

// ---------------------------------------------------------------------------
// Filesystem browsing (models::filesystem)
// ---------------------------------------------------------------------------

export type EntryType = "file" | "directory" | "symlink" | "other";

export type FileAttribute =
  | "ReadOnly"
  | "Hidden"
  | "System"
  | "Archive"
  | "Compressed"
  | "Encrypted"
  | "Offline"
  | "Temporary"
  | "Sparse"
  | "ReparsePoint";

export interface FileSystemEntry {
  name: string;
  path: string;
  entryType: EntryType;
  sizeBytes: number | null;
  allocatedSizeBytes: number | null;
  modified: string | null;
  created: string | null;
  accessed: string | null;
  attributes: FileAttribute[];
  extension: string | null;
  isHidden: boolean;
  isSystem: boolean;
  isReadOnly: boolean;
  isSymlink: boolean;
  childCount: number | null;
}

export interface ListDirectoryOptions {
  showHidden: boolean;
  showSystem: boolean;
}

export const DEFAULT_LIST_DIRECTORY_OPTIONS: ListDirectoryOptions = {
  showHidden: false,
  showSystem: false,
};

export interface DirectoryListing {
  path: string;
  entries: FileSystemEntry[];
  truncatedHidden: boolean;
}

export interface DirectorySummary {
  path: string;
  exists: boolean;
  directFileCount: number;
  directFolderCount: number;
  directFileBytes: number;
  lastModified: string | null;
  hiddenItems: number | null;
  readOnlyItems: number | null;
}

export interface FileMetadata {
  name: string;
  path: string;
  sizeBytes: number;
  allocatedSizeBytes: number | null;
  extension: string | null;
  created: string | null;
  modified: string | null;
  accessed: string | null;
  isReadOnly: boolean;
  isHidden: boolean;
  isSystem: boolean;
  isArchive: boolean;
  isSymlink: boolean;
  entryType: EntryType;
  attributes: FileAttribute[];
  owner: string | null;
}

export interface FolderMetadata {
  name: string;
  path: string;
  created: string | null;
  modified: string | null;
  accessed: string | null;
  attributes: FileAttribute[];
  directFileCount: number;
  directFolderCount: number;
  directFileBytes: number;
}

export interface PathValidation {
  inputPath: string;
  normalizedPath: string | null;
  exists: boolean;
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
  isAbsolute: boolean;
  isUnc: boolean;
  accessible: boolean;
  error: AppError | null;
}

// ---------------------------------------------------------------------------
// Recursive scanner (models::scan) - Phase 3
// ---------------------------------------------------------------------------

export interface ScanOptions {
  showHidden: boolean;
  showSystem: boolean;
}

export const DEFAULT_SCAN_OPTIONS: ScanOptions = {
  showHidden: false,
  showSystem: false,
};

/** Which engine actually produced a scan. Only ever known once a scan
 * finishes - the MFT-vs-walk decision happens inside the scan itself,
 * so it's never present on a `ScanProgress` tick, only `ScanResult`.
 * `mft` needs admin/backup privilege to open a raw volume handle;
 * without it, every scan silently and automatically falls back to
 * `walk` - see PHASE3.md. */
export type ScanEngine = "mft" | "walk";

export interface ScanProgress {
  scanId: string;
  scannedFiles: number;
  scannedFolders: number;
  scannedBytes: number;
  currentPath: string;
  elapsedMs: number;
}

/** A subtree that was skipped rather than aborting the whole scan -
 * e.g. an access-denied subfolder. */
export interface ScanSkip {
  path: string;
  reason: string;
}

export interface ScanResult {
  scanId: string;
  /** The real, recursively-aggregated tree - the exact `FsNode` shape
   * `src/models/common.ts` already defines and the Phase 1 mock trees
   * already use, so it can be dropped in wherever those are without an
   * adaptation layer. `category` always comes back `null` for now -
   * categorizing by extension stays a frontend concern, wired up when
   * Phase 4 connects the Treemap to real data. */
  root: FsNode;
  engine: ScanEngine;
  elapsedMs: number;
  skipped: ScanSkip[];
}

// ---------------------------------------------------------------------------
// System info (models::system)
// ---------------------------------------------------------------------------

export interface AppVersionInfo {
  version: string;
  name: string;
  tauriVersion: string;
}

export interface SystemInfo {
  os: string;
  osVersion: string;
  hostname: string | null;
  architecture: string;
  cpuLogicalCores: number;
  totalMemoryBytes: number;
  availableMemoryBytes: number;
}
