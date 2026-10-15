/** Domain types shared by several pages. */

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
 * File type categories by extension, used by `categorizeByExtension`
 * and the treemap colors. Covers the extensions common on a Windows
 * system drive.
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
    // .dll/.sys make up most of Program Files and Windows.
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
  /** `null` for a subtree the scan couldn't read. */
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
