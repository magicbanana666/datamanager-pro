import type { SearchResultRow } from "@/models/search";

function kb(n: number): number {
  return Math.round(n * 1024);
}
function mb(n: number): number {
  return Math.round(n * 1024 * 1024);
}

export const searchResults: SearchResultRow[] = [
  { id: "f1", name: "Report_2026.pdf", path: "D:\\Data\\Projects\\Clients\\AMGroup\\", size: mb(2.4), type: "PDF Document", modified: "2026-09-06T14:22:00", matchedTerm: "report", occurrences: 12 },
  { id: "f2", name: "Monthly_Report.xlsx", path: "D:\\Data\\Projects\\Finance\\", size: mb(1.1), type: "Excel Workbook", modified: "2026-09-05T10:11:00", matchedTerm: "report" },
  { id: "f3", name: "Project_Report.docx", path: "D:\\Data\\Projects\\Clients\\Desmet\\", size: kb(856), type: "Word Document", modified: "2026-09-04T16:37:00", matchedTerm: "report" },
  { id: "f4", name: "report-template.docx", path: "D:\\Data\\Projects\\Templates\\", size: kb(320), type: "Word Document", modified: "2026-09-04T09:12:00", matchedTerm: "report" },
  { id: "f5", name: "Report_Q3_2026.pptx", path: "D:\\Data\\Projects\\Management\\", size: mb(12.4), type: "PowerPoint", modified: "2026-09-03T18:21:00", matchedTerm: "report" },
  { id: "f6", name: "installation_report.txt", path: "D:\\Data\\Projects\\Logs\\", size: kb(48), type: "Text Document", modified: "2026-09-03T11:02:00", matchedTerm: "report" },
  { id: "f7", name: "network_report.html", path: "D:\\Data\\Projects\\Network\\", size: kb(215), type: "Chrome HTML", modified: "2026-09-02T14:55:00", matchedTerm: "report" },
  { id: "f8", name: "Report_2025.pdf", path: "D:\\Data\\Projects\\Archive\\", size: mb(3.1), type: "PDF Document", modified: "2026-09-01T09:43:00", matchedTerm: "report" },
  { id: "f9", name: "backup-report.zip", path: "D:\\Data\\Backups\\", size: mb(5.8), type: "Compressed (zip)", modified: "2026-08-30T22:11:00", matchedTerm: "report" },
  { id: "f10", name: "SecurityReport.docx", path: "D:\\Data\\Projects\\Security\\", size: mb(1.6), type: "Word Document", modified: "2026-08-29T13:07:00", matchedTerm: "report" },
  { id: "f11", name: "Report-final-v2.xlsx", path: "D:\\Data\\Projects\\Clients\\Cobofisk\\", size: kb(980), type: "Excel Workbook", modified: "2026-08-28T16:20:00", matchedTerm: "report" },
  { id: "f12", name: "report.log", path: "D:\\Data\\Projects\\Logs\\", size: mb(2.3), type: "Text Document", modified: "2026-08-27T10:14:00", matchedTerm: "report" },
  { id: "f13", name: "System_Report.pdf", path: "D:\\Data\\Projects\\Infrastructure\\", size: mb(4.2), type: "PDF Document", modified: "2026-08-26T21:33:00", matchedTerm: "report" },
  { id: "f14", name: "Inventory_report.xlsx", path: "D:\\Data\\Projects\\Romania\\", size: kb(640), type: "Excel Workbook", modified: "2026-08-26T09:18:00", matchedTerm: "report" },
  { id: "f15", name: "report_old.doc", path: "D:\\Data\\Projects\\Archive\\", size: mb(1.2), type: "Word 97-2003", modified: "2026-08-24T17:55:00", matchedTerm: "report" },
];

export const savedSearches = ["Reports", "Large videos > 1 GB", "Client invoices 2026", "Temp cleanup candidates"];
