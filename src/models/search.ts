import type { ScanSkip } from "@/models/backend";

export interface SearchResultRow {
  id: string;
  name: string;
  path: string;
  size: number;
  type: string;
  modified: string;
  matchedTerm?: string;
  occurrences?: number;
  /** Set for real results - the backend hit this row came from. */
  hit?: SearchHit;
}

export interface SearchFilters {
  fileTypes: string;
  minSize: number | null;
  minSizeUnit: "KB" | "MB" | "GB";
  maxSize: number | null;
  maxSizeUnit: "KB" | "MB" | "GB";
  modifiedRange: "any" | "today" | "week" | "month" | "year" | "custom";
  dateFrom: string | null;
  dateTo: string | null;
  attributes: {
    readOnly: boolean;
    hidden: boolean;
    system: boolean;
    archive: boolean;
  };
}

export interface SearchOptions {
  fileName: boolean;
  fileContent: boolean;
  caseSensitive: boolean;
  regex: boolean;
  includeSubfolders: boolean;
  compressedArchives: boolean;
  networkShares: boolean;
  matchWholeWords: boolean;
  includeBinary: boolean;
}

/** Sent to `start_file_search` - mirrors `SearchOptions` in
 * `src-tauri/src/models/search.rs`. */
export interface SearchRequest {
  query: string;
  matchName: boolean;
  matchContent: boolean;
  caseSensitive: boolean;
  regex: boolean;
  wholeWords: boolean;
  includeSubfolders: boolean;
  searchArchives: boolean;
  includeBinary: boolean;
  includeHidden: boolean;
  includeSystem: boolean;
  /** Lowercase with dot; empty = any type. */
  extensions: string[];
  minSize: number | null;
  maxSize: number | null;
  /** RFC 3339. */
  modifiedAfter: string | null;
}

export type MatchedIn = "name" | "content" | "archive";

export interface SearchHit {
  path: string;
  name: string;
  size: number;
  lastModified: string | null;
  matchedIn: MatchedIn;
  occurrences: number;
  snippets: { line: number; text: string }[];
  archiveEntries: string[];
}

export interface SearchResult {
  scanId: string;
  /** Capped backend-side; `totalHits` counts every match. */
  hits: SearchHit[];
  totalHits: number;
  filesSearched: number;
  elapsedMs: number;
  skipped: ScanSkip[];
}
