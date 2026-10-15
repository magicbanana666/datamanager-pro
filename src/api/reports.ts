/** Report commands. */
import { invoke } from "@tauri-apps/api/core";
import type { ReportRecord, ReportRequest } from "@/models/reports";

export function generateReport(request: ReportRequest): Promise<ReportRecord> {
  return invoke("generate_report", { request });
}

export function previewReport(request: ReportRequest): Promise<string> {
  return invoke("preview_report", { request });
}

export function listReports(): Promise<ReportRecord[]> {
  return invoke("list_reports");
}

export function deleteReport(id: string): Promise<void> {
  return invoke("delete_report", { id });
}

export function exportReport(id: string, destination: string): Promise<void> {
  return invoke("export_report", { id, destination });
}

export function reportsFolder(): Promise<string> {
  return invoke("reports_folder");
}
