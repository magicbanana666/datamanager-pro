export interface OverviewStat {
  id: string;
  label: string;
  value: string;
  sublabel: string;
  tone: "accent" | "success" | "warning" | "danger" | "info";
}

export const overviewStats: OverviewStat[] = [
  { id: "storage", label: "Total Scanned Storage", value: "2.48 TB", sublabel: "across 3 locations", tone: "accent" },
  { id: "files", label: "Files", value: "1,234,567", sublabel: "18,427 folders scanned", tone: "info" },
  { id: "folders", label: "Folders", value: "18,427", sublabel: "across all sources", tone: "info" },
  { id: "duplicates", label: "Duplicates", value: "1,247 files", sublabel: "18.6 GB recoverable", tone: "warning" },
  { id: "transfers", label: "Transfers", value: "12 completed", sublabel: "3 running now", tone: "success" },
  { id: "scheduled", label: "Scheduled Tasks", value: "6 tasks", sublabel: "4 enabled", tone: "accent" },
];

export interface RecentScanEntry {
  id: string;
  location: string;
  type: "Disk Analysis" | "Folder Analysis" | "Network Analysis";
  size: string;
  date: string;
  status: "completed" | "error";
}

export const recentScans: RecentScanEntry[] = [
  { id: "s1", location: "D:\\Data", type: "Disk Analysis", size: "1.24 TB", date: "2026-09-09 21:14", status: "completed" },
  { id: "s2", location: "D:\\Data\\Projects", type: "Folder Analysis", size: "286.1 GB", date: "2026-09-09 18:02", status: "completed" },
  { id: "s3", location: "\\\\NAS\\CompanyData", type: "Network Analysis", size: "2.48 TB", date: "2026-09-07 14:22", status: "completed" },
  { id: "s4", location: "E:\\Archive", type: "Disk Analysis", size: "1.42 TB", date: "2026-09-05 09:47", status: "completed" },
];

export interface RecentTransferEntry {
  id: string;
  source: string;
  destination: string;
  mode: "Copy" | "Move" | "Sync" | "Mirror";
  size: string;
  date: string;
  status: "completed" | "running" | "error";
}

export const recentTransfers: RecentTransferEntry[] = [
  { id: "t1", source: "D:\\Data\\Projects", destination: "E:\\Archive\\Projects", mode: "Sync", size: "178.4 GB", date: "2026-09-09 22:17", status: "running" },
  { id: "t2", source: "D:\\Backups", destination: "\\\\NAS\\Backups", mode: "Copy", size: "42.1 GB", date: "2026-09-08 03:00", status: "completed" },
  { id: "t3", source: "D:\\Media", destination: "E:\\Archive\\Media", mode: "Move", size: "96.3 GB", date: "2026-09-06 22:40", status: "completed" },
];

export interface RecentReportEntry {
  id: string;
  name: string;
  type: string;
  date: string;
}

export const recentReports: RecentReportEntry[] = [
  { id: "r1", name: "Project_Analysis_2026-09-09.pdf", type: "Disk Analysis", date: "2026-09-09 21:14" },
  { id: "r2", name: "Duplicates_Report_2026-09-09.xlsx", type: "Duplicate Finder", date: "2026-09-09 19:42" },
  { id: "r3", name: "Sync_Summary_2026-09-08.pdf", type: "Sync / Incremental", date: "2026-09-08 20:03" },
];

export interface StorageUsagePoint {
  month: string;
  usedTb: number;
}

export const storageUsageHistory: StorageUsagePoint[] = [
  { month: "Apr", usedTb: 1.62 },
  { month: "May", usedTb: 1.78 },
  { month: "Jun", usedTb: 1.95 },
  { month: "Jul", usedTb: 2.14 },
  { month: "Aug", usedTb: 2.31 },
  { month: "Sep", usedTb: 2.48 },
];
