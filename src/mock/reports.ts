import type { DataGrowthPoint, FolderSizeEntry, ReportRecord } from "@/models/reports";
import type { CategoryStat } from "@/models/common";

function gb(n: number): number {
  return Math.round(n * 1024 * 1024 * 1024);
}
function kb(n: number): number {
  return Math.round(n * 1024);
}
function mb(n: number): number {
  return Math.round(n * 1024 * 1024);
}

export const reportRecords: ReportRecord[] = [
  { id: "rp1", name: "Project_Analysis_2026-09-09.pdf", type: "Disk Analysis", dateCreated: "2026-09-09T21:14:00", size: mb(1.8), description: "Complete disk analysis report" },
  { id: "rp2", name: "Duplicates_Report_2026-09-09.xlsx", type: "Duplicate Finder", dateCreated: "2026-09-09T19:42:00", size: kb(512), description: "List of duplicate files" },
  { id: "rp3", name: "Transfer_Log_2026-09-08.html", type: "Data Transfer", dateCreated: "2026-09-08T22:17:00", size: kb(256), description: "Detailed transfer log" },
  { id: "rp4", name: "Sync_Summary_2026-09-08.pdf", type: "Sync / Incremental", dateCreated: "2026-09-08T20:03:00", size: kb(420), description: "Synchronization summary" },
  { id: "rp5", name: "Network_Scan_2026-09-07.xlsx", type: "Network Analysis", dateCreated: "2026-09-07T18:55:00", size: kb(640), description: "Network share analysis" },
  { id: "rp6", name: "Scheduled_Tasks_2026-09-07.pdf", type: "Scheduler", dateCreated: "2026-09-07T10:21:00", size: kb(310), description: "Scheduled tasks summary" },
  { id: "rp7", name: "Comparison_Report_2026-09-06.xlsx", type: "Comparison", dateCreated: "2026-09-06T16:33:00", size: kb(480), description: "Folder comparison results" },
  { id: "rp8", name: "File_Search_Results_2026-09-06.html", type: "File Search", dateCreated: "2026-09-06T14:12:00", size: kb(220), description: 'Search results for "*.docx"' },
  { id: "rp9", name: "Custom_Report_Clients.docx", type: "Custom", dateCreated: "2026-09-05T11:08:00", size: mb(1.2), description: "Client data overview" },
  { id: "rp10", name: "Archive_Summary_2026-09-01.pdf", type: "Folder Analysis", dateCreated: "2026-09-01T09:27:00", size: kb(690), description: "Archive folder summary" },
];

export const reportTopFolders: FolderSizeEntry[] = [
  { path: "D:\\Projects", size: gb(286.1) },
  { path: "E:\\Archive", size: gb(178.4) },
  { path: "D:\\Media", size: gb(124.3) },
  { path: "D:\\Backups", size: gb(98.7) },
  { path: "D:\\Clients", size: gb(62.5) },
  { path: "D:\\ISO", size: gb(48.2) },
  { path: "D:\\Logs", size: gb(24.1) },
  { path: "C:\\Users", size: gb(18.6) },
  { path: "D:\\Temp", size: gb(12.4) },
  { path: "D:\\Misc", size: gb(8.1) },
];

export const reportFileTypeDistribution: CategoryStat[] = [
  { label: "Documents", value: gb(400), percent: 32.4, colorIndex: 4 },
  { label: "Images", value: gb(297), percent: 24.1, colorIndex: 3 },
  { label: "Videos", value: gb(180), percent: 14.6, colorIndex: 2 },
  { label: "Archives", value: gb(139), percent: 11.3, colorIndex: 1 },
  { label: "Executables", value: gb(71), percent: 5.8, colorIndex: 7 },
  { label: "System Files", value: gb(58), percent: 4.7, colorIndex: 5 },
  { label: "Others", value: gb(88), percent: 7.1, colorIndex: 6 },
];

export const dataGrowthHistory: DataGrowthPoint[] = [
  { month: "Mar", sourceBytes: gb(1050), destBytes: gb(0) },
  { month: "Apr", sourceBytes: gb(1320), destBytes: gb(0) },
  { month: "May", sourceBytes: gb(1680), destBytes: gb(0) },
  { month: "Jun", sourceBytes: gb(2020), destBytes: gb(0) },
  { month: "Jul", sourceBytes: gb(2410), destBytes: gb(0) },
  { month: "Aug", sourceBytes: gb(2800), destBytes: gb(1050) },
];
