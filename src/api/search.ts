/**
 * Typed wrappers around the Phase 5 file-search commands, plus the
 * results panel's file actions. Events come through
 * `subscribeJobEvents("search", ...)`.
 */
import { invoke } from "@tauri-apps/api/core";
import type { SearchRequest } from "@/models/search";

export function generateSearchId(): string {
  return `search-${crypto.randomUUID()}`;
}

export function startFileSearch(scanId: string, location: string, options: SearchRequest): Promise<void> {
  return invoke("start_file_search", { scanId, location, options });
}

export function cancelFileSearch(scanId: string): Promise<void> {
  return invoke("cancel_file_search", { scanId });
}

/** The start of a file as text, or `null` if it looks binary. */
export function getTextPreview(path: string): Promise<string | null> {
  return invoke("get_text_preview", { path });
}

/** Opens a file with its default application. */
export function openPath(path: string): Promise<void> {
  return invoke("open_path", { path });
}
