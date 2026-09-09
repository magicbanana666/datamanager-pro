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

export const FILE_TYPE_CATEGORIES: FileTypeCategory[] = [
  { id: "virtual-disk", label: "Virtual Disk (.vhd, .vmdk)", extensions: [".vhd", ".vmdk", ".vdi"], colorIndex: 0 },
  { id: "archive", label: "Archive (.zip, .rar, .7z)", extensions: [".zip", ".rar", ".7z"], colorIndex: 1 },
  { id: "video", label: "Video (.mp4, .mkv)", extensions: [".mp4", ".mkv", ".avi", ".mov"], colorIndex: 2 },
  { id: "iso", label: "ISO / Image", extensions: [".iso", ".img"], colorIndex: 5 },
  { id: "document", label: "Document (.docx, .pdf)", extensions: [".docx", ".pdf", ".xlsx", ".pptx", ".txt"], colorIndex: 4 },
  { id: "picture", label: "Picture (.jpg, .png)", extensions: [".jpg", ".jpeg", ".png", ".gif"], colorIndex: 3 },
  { id: "executable", label: "Executable (.exe, .msi)", extensions: [".exe", ".msi", ".bat"], colorIndex: 7 },
  { id: "audio", label: "Audio (.mp3, .wav)", extensions: [".mp3", ".wav", ".flac"], colorIndex: 8 },
  { id: "code", label: "Code / Scripts", extensions: [".ps1", ".js", ".ts", ".py", ".rs"], colorIndex: 9 },
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
  lastModified: string;
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
