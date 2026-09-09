export interface SearchResultRow {
  id: string;
  name: string;
  path: string;
  size: number;
  type: string;
  modified: string;
  matchedTerm?: string;
  occurrences?: number;
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
