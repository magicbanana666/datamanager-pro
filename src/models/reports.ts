/** Mirrors `src-tauri/src/models/reports.rs` (Phase 9). */
export type ReportCategory =
  | "Disk Analysis"
  | "Folder Analysis"
  | "Network Analysis"
  | "Duplicate Finder"
  | "Comparison"
  | "File Search"
  | "Data Transfer"
  | "Sync / Incremental"
  | "Scheduler";

export type ReportFormat = "PDF" | "HTML" | "XLSX" | "CSV";

export type ReportTemplate = "professional" | "compact" | "detailed";

export type ReportCell = string | number | null;

export type ReportSection =
  | { kind: "keyValues"; title: string; items: { label: string; value: string }[] }
  | { kind: "table"; title: string; columns: string[]; rows: ReportCell[][] }
  | { kind: "bars"; title: string; items: { label: string; value: number; display: string }[] };

export interface ReportDocument {
  title: string;
  category: ReportCategory;
  source: string;
  notes: string | null;
  sections: ReportSection[];
}

export interface ReportRequest {
  document: ReportDocument;
  format: ReportFormat;
  template: ReportTemplate;
  includeCharts: boolean;
  description: string;
  /** Empty or null: the standard reports folder. */
  outputDir?: string | null;
}

export interface ReportRecord {
  id: string;
  name: string;
  type: ReportCategory;
  dateCreated: string;
  size: number;
  description: string;
  path: string;
  format: ReportFormat;
}
