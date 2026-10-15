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
