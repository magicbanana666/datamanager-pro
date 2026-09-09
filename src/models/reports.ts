export type ReportCategory =
  | "Disk Analysis"
  | "Folder Analysis"
  | "Duplicate Finder"
  | "Data Transfer"
  | "Sync / Incremental"
  | "Network Analysis"
  | "Scheduler"
  | "Comparison"
  | "File Search"
  | "Custom";

export interface ReportRecord {
  id: string;
  name: string;
  type: ReportCategory;
  dateCreated: string;
  size: number;
  description: string;
}

export type ReportFormat = "PDF" | "HTML" | "XLSX" | "CSV";

export interface ReportGenerationOptions {
  reportType: string;
  source: string;
  format: ReportFormat;
  includeSummary: boolean;
  includeFileTypes: boolean;
  includeLargest: boolean;
  includeCharts: boolean;
  includeDuplicates: boolean;
  includeTransferHistory: boolean;
  customNotes: string;
  template: "Professional" | "Compact" | "Detailed";
}

export interface FolderSizeEntry {
  path: string;
  size: number;
}

export interface DataGrowthPoint {
  month: string;
  sourceBytes: number;
  destBytes: number;
}
