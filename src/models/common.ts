/** Shared domain types used across multiple pages (disk/folder/network
 * analysis, comparison, reports...). Phase 1 uses these purely for typed
 * mock data - the shapes are designed to map cleanly onto a future real
 * filesystem-scanning backend. */

export type FileTypeCategoryId =
  | "virtual-disk"
  | "archive"
  | "video"
  | "iso"
  | "document"
  | "picture"
  | "executable"
  | "audio"
  | "code"
  | "other";

export interface FileTypeCategory {
  id: FileTypeCategoryId;
  label: string;
  extensions: string[];
  colorIndex: number;
}

/**
 * Phase 1's original lists only had a handful of illustrative
 * extensions each - fine for hand-authored mock data, but a real scan
 * (`utils/scanAnalysis.ts`'s `categorizeByExtension`, and the Treemap's
 * per-file tile color) sends most real files straight to "Other" that
 * way, since ordinary Windows installs are full of extensions no entry
 * here recognized (`.dll`/`.sys` alone dominate `Program Files`/
 * `Windows`). Expanded to cover what actually shows up on a real disk,
 * confirmed live against a real `C:\` scan.
 */
export const FILE_TYPE_CATEGORIES: FileTypeCategory[] = [
  {
    id: "virtual-disk",
    label: "Virtual Disk (.vhd, .vmdk)",
    extensions: [".vhd", ".vhdx", ".vmdk", ".vdi", ".qcow2", ".ova", ".ovf"],
    colorIndex: 0,
  },
  {
    id: "archive",
    label: "Archive (.zip, .rar, .7z)",
    extensions: [".zip", ".rar", ".7z", ".tar", ".gz", ".tgz", ".bz2", ".xz", ".cab"],
    colorIndex: 1,
  },
  {
    id: "video",
    label: "Video (.mp4, .mkv)",
    extensions: [".mp4", ".mkv", ".avi", ".mov", ".wmv", ".flv", ".webm", ".m4v", ".mpg", ".mpeg"],
    colorIndex: 2,
  },
  { id: "iso", label: "ISO / Image", extensions: [".iso", ".img", ".dmg"], colorIndex: 5 },
  {
    id: "document",
    label: "Document (.docx, .pdf)",
    extensions: [
      ".docx",
      ".doc",
      ".pdf",
      ".xlsx",
      ".xls",
      ".pptx",
      ".ppt",
      ".txt",
      ".rtf",
      ".csv",
      ".md",
      ".odt",
      ".ods",
    ],
    colorIndex: 4,
  },
  {
    id: "picture",
    label: "Picture (.jpg, .png)",
    extensions: [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".svg", ".webp", ".tif", ".tiff", ".ico", ".heic"],
    colorIndex: 3,
  },
  {
    id: "executable",
    label: "Executable (.exe, .dll)",
    // .dll/.sys are what actually make Program Files/Windows huge -
    // not directly runnable like a .exe, but the same kind of binary
    // program file, and the category real disk-usage tools bucket
    // them into too.
    extensions: [".exe", ".msi", ".msu", ".msp", ".bat", ".cmd", ".com", ".dll", ".sys", ".drv"],
    colorIndex: 7,
  },
  {
    id: "audio",
    label: "Audio (.mp3, .wav)",
    extensions: [".mp3", ".wav", ".flac", ".aac", ".ogg", ".wma", ".m4a"],
    colorIndex: 8,
  },
  {
    id: "code",
    label: "Code / Scripts",
    extensions: [
      ".ps1",
      ".js",
      ".ts",
      ".py",
      ".rs",
      ".c",
      ".cpp",
      ".h",
      ".hpp",
      ".cs",
      ".java",
      ".go",
      ".rb",
      ".php",
      ".html",
      ".css",
      ".json",
      ".xml",
      ".yaml",
      ".yml",
      ".sh",
      ".sql",
    ],
    colorIndex: 9,
  },
  { id: "other", label: "Other", extensions: [], colorIndex: 6 },
];

export type NodeKind = "drive" | "folder" | "file";

/** A node in a filesystem tree - shared by Disk Analysis, Folder Analysis
 * and the reusable Treemap component. */
export interface FsNode {
  id: string;
  name: string;
  path: string;
  kind: NodeKind;
  /** Logical size in bytes. For folders this is the aggregate of children. */
  size: number;
  /** Size actually allocated on disk (accounts for cluster slack). */
  allocated: number;
  fileCount: number;
  folderCount: number;
  /** Percentage of the parent's size this node represents (0-100). */
  percentOfParent: number;
  /** `null` for a real scan's skipped/inaccessible subtree stub (see
   * PHASE3.md) - never null for mock data. */
  lastModified: string | null;
  category?: FileTypeCategoryId;
  children?: FsNode[];
}

export interface DriveInfo {
  letter: string;
  label: string;
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  fileSystem: string;
}

export interface RecentLocation {
  path: string;
  kind: "local" | "network";
}

/** Generic (name, value) pair used for donut/bar chart legends. */
export interface CategoryStat {
  label: string;
  value: number;
  percent: number;
  colorIndex: number;
}

export type ScanState = "idle" | "scanning" | "completed" | "error";
