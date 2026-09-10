/**
 * Thin, typed wrappers around `invoke()` for every Phase 1/2 Tauri
 * command. Nothing here does its own error handling beyond normalizing
 * a thrown value into an `AppError` shape - callers (mainly
 * `state/filesystemStore.ts`) decide what to do with a failure.
 */
import { invoke } from "@tauri-apps/api/core";
import type {
  AppError,
  AppVersionInfo,
  DirectoryListing,
  DirectorySummary,
  FileMetadata,
  FolderMetadata,
  ListDirectoryOptions,
  PathValidation,
  StorageVolume,
  SystemInfo,
} from "@/models/backend";
import { isAppError } from "@/models/backend";

/** Normalizes anything `invoke()` can reject with into an `AppError`,
 * so every store/component only ever has to handle one error shape. */
export function toAppError(err: unknown): AppError {
  if (isAppError(err)) return err;
  return {
    code: "unknown",
    message: err instanceof Error ? err.message : String(err),
  };
}

export function pingBackend(): Promise<string> {
  return invoke("ping_backend");
}

export function getAppVersion(): Promise<AppVersionInfo> {
  return invoke("get_app_version");
}

export function getSystemInfo(): Promise<SystemInfo> {
  return invoke("get_system_info");
}

export function listStorageVolumes(forceRefresh = false): Promise<StorageVolume[]> {
  return invoke("list_storage_volumes", { forceRefresh });
}

export function validatePath(path: string): Promise<PathValidation> {
  return invoke("validate_path", { path });
}

export function listDirectory(path: string, options?: ListDirectoryOptions): Promise<DirectoryListing> {
  return invoke("list_directory", { path, options });
}

export function getDirectorySummary(path: string): Promise<DirectorySummary> {
  return invoke("get_directory_summary", { path });
}

export function getFileMetadata(path: string): Promise<FileMetadata> {
  return invoke("get_file_metadata", { path });
}

export function getFolderMetadata(path: string): Promise<FolderMetadata> {
  return invoke("get_folder_metadata", { path });
}
