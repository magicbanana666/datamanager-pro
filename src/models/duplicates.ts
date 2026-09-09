export type DuplicateCriteriaId = "exact" | "same-name" | "same-size" | "similar-content";

export interface DuplicateFileEntry {
  id: string;
  name: string;
  path: string;
  size: number;
  type: string;
  modified: string;
  selected: boolean;
  isOriginal?: boolean;
}

export interface DuplicateGroup {
  id: string;
  label: string;
  size: number;
  type: string;
  files: DuplicateFileEntry[];
  expanded: boolean;
}

export interface DuplicateOptions {
  ignoreCase: boolean;
  ignoreTimestamps: boolean;
  ignoreAttributes: boolean;
  ignoreSystemFiles: boolean;
  ignoreHiddenFiles: boolean;
  fileTypeFilter: string;
  minSize: number | null;
  maxSize: number | null;
}
