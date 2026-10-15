/**
 * One-shot file operations (Phase 6): deleting selected files and
 * saving exports. Copy/move of selected files runs through the transfer
 * engine (`useFileActionStore`).
 */
import { invoke } from "@tauri-apps/api/core";

export interface DeleteOutcome {
  deleted: string[];
  errors: { path: string; message: string }[];
}

export function deleteFiles(paths: string[], useRecycleBin = true): Promise<DeleteOutcome> {
  return invoke("delete_files", { paths, useRecycleBin });
}

export function saveTextFile(path: string, contents: string): Promise<void> {
  return invoke("save_text_file", { path, contents });
}

export function readProjectFile(path: string): Promise<string> {
  return invoke("read_project_file", { path });
}

/** Opens Explorer with the file or folder selected. */
export function revealInExplorer(path: string): Promise<void> {
  return invoke("reveal_in_explorer", { path });
}

/** Files or folders to the Recycle Bin (never a permanent delete). */
export function recyclePaths(paths: string[]): Promise<DeleteOutcome> {
  return invoke("recycle_paths", { paths });
}
