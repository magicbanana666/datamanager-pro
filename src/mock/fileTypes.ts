import type { CategoryStat } from "@/models/common";

export interface LargestFileEntry {
  name: string;
  path: string;
  size: number;
}

function gb(n: number): number {
  return Math.round(n * 1024 * 1024 * 1024);
}

/** Top file-type breakdown for D:\Data (Disk Analysis). Percentages sum to
 * ~100 and sizes sum close to the 1.24 TB total shown in the UI. */
export const diskFileTypeStats: CategoryStat[] = [
  { label: ".vhd, .vmdk", value: gb(412.5), percent: 33.2, colorIndex: 0 },
  { label: ".zip, .rar, .7z", value: gb(228.1), percent: 18.4, colorIndex: 1 },
  { label: ".mp4, .mkv", value: gb(150.2), percent: 12.1, colorIndex: 2 },
  { label: ".iso", value: gb(112.4), percent: 9.1, colorIndex: 5 },
  { label: ".docx, .pdf", value: gb(96.5), percent: 7.8, colorIndex: 4 },
  { label: ".jpg, .png", value: gb(80.6), percent: 6.5, colorIndex: 3 },
  { label: ".exe, .msi", value: gb(53.2), percent: 4.3, colorIndex: 7 },
  { label: "Others", value: gb(106.4), percent: 8.6, colorIndex: 6 },
];

export const diskLargestFiles: LargestFileEntry[] = [
  { name: "Windows11.vhdx", path: "D:\\Data\\VMs\\Windows11.vhdx", size: gb(58.2) },
  { name: "Backup_2026-09-01.zip", path: "D:\\Data\\Backups\\Backup_2026-09-01.zip", size: gb(42.7) },
  { name: "Project_X.7z", path: "D:\\Data\\Projects\\Archive\\Project_X.7z", size: gb(28.4) },
  { name: "Film.mkv", path: "D:\\Data\\Media\\Film.mkv", size: gb(24.1) },
  { name: "Database.bak", path: "D:\\Data\\Backups\\Database.bak", size: gb(18.7) },
];

export const diskTopFolders = [
  { path: "D:\\Data\\Projects\\VMs", size: gb(412.5) },
  { path: "D:\\Data\\Projects\\Clients", size: gb(286.1) },
  { path: "D:\\Data\\Backups", size: gb(198.7) },
  { path: "D:\\Data\\ISOs", size: gb(112.4) },
  { path: "D:\\Data\\Media", size: gb(96.3) },
  { path: "D:\\Data\\Projects\\Archive", size: gb(62.1) },
  { path: "D:\\Data\\Documents", size: gb(45.8) },
  { path: "D:\\Data\\Tools", size: gb(31.4) },
  { path: "D:\\Data\\Temp", size: gb(24.7) },
  { path: "D:\\Data\\Other", size: gb(18.2) },
];

export const folderFileTypeStats: CategoryStat[] = [
  { label: "Virtual Disk (.vhd, .vmdk)", value: gb(32.5), percent: 37.6, colorIndex: 0 },
  { label: "Archive (.zip, .rar, .7z)", value: gb(18.4), percent: 21.3, colorIndex: 1 },
  { label: "ISO (.iso)", value: gb(9.2), percent: 10.6, colorIndex: 5 },
  { label: "Document (.docx, .pdf)", value: gb(6.7), percent: 7.8, colorIndex: 4 },
  { label: "Video (.mp4, .mkv)", value: gb(5.1), percent: 5.9, colorIndex: 2 },
  { label: "Picture (.jpg, .png)", value: gb(4.8), percent: 5.6, colorIndex: 3 },
  { label: "Executable (.exe, .msi)", value: gb(2.9), percent: 3.4, colorIndex: 7 },
  { label: "Other", value: gb(6.8), percent: 7.8, colorIndex: 6 },
];

export const folderSizeDistribution: CategoryStat[] = [
  { label: "Others", value: gb(33), percent: 38.1, colorIndex: 6 },
  { label: "Clients", value: gb(26.1), percent: 30.2, colorIndex: 0 },
  { label: "Product", value: gb(18.8), percent: 21.7, colorIndex: 2 },
  { label: "Archive", value: gb(8.7), percent: 10.0, colorIndex: 1 },
];

export const folderLargestFiles: LargestFileEntry[] = [
  { name: "Project.vhdx", path: "...\\Clients\\VMs", size: gb(24.8) },
  { name: "Backup_2026-08-31.zip", path: "...\\Archive", size: gb(12.4) },
  { name: "install.iso", path: "...\\ISO", size: gb(8.1) },
  { name: "database.bak", path: "...\\Clients\\DB", size: gb(6.7) },
  { name: "video.mkv", path: "...\\Media", size: gb(4.9) },
  { name: "export.7z", path: "...\\Product", size: gb(4.3) },
  { name: "image.vmdk", path: "...\\VMs", size: gb(3.6) },
  { name: "setup.exe", path: "...\\Tools", size: gb(2.9) },
  { name: "report.pdf", path: "...\\Documentation", size: gb(2.1) },
  { name: "archive.zip", path: "...\\Products", size: gb(1.8) },
];

export const networkFileTypeStats: CategoryStat[] = [
  { label: "Documents", value: gb(699.5), percent: 28.4, colorIndex: 4 },
  { label: "Images", value: gb(460.9), percent: 18.7, colorIndex: 3 },
  { label: "Videos", value: gb(396.4), percent: 16.1, colorIndex: 2 },
  { label: "Archives", value: gb(303.1), percent: 12.3, colorIndex: 1 },
  { label: "Executables", value: gb(168.6), percent: 6.8, colorIndex: 7 },
  { label: "Others", value: gb(437.5), percent: 17.7, colorIndex: 6 },
];

export const networkTopFiles: (LargestFileEntry & { rank: number })[] = [
  { rank: 1, name: "VM_Backup.vhdx", path: "\\\\NAS\\Backups\\VMs\\", size: gb(52.1) },
  { rank: 2, name: "Project_2026.iso", path: "\\\\NAS\\ISO\\", size: gb(24.8) },
  { rank: 3, name: "Database.bak", path: "\\\\NAS\\Clients\\AMGroup\\", size: gb(18.6) },
  { rank: 4, name: "Video_Training.mp4", path: "\\\\NAS\\Training\\", size: gb(12.4) },
  { rank: 5, name: "Install.wim", path: "\\\\NAS\\Software\\", size: gb(8.3) },
  { rank: 6, name: "Archive.zip", path: "\\\\NAS\\Archive\\", size: gb(6.7) },
  { rank: 7, name: "CAD_Drawings.7z", path: "\\\\NAS\\Projects\\", size: gb(5.4) },
  { rank: 8, name: "Report_2026.pdf", path: "\\\\NAS\\Management\\", size: gb(4.8) },
  { rank: 9, name: "Image(1).vmdk", path: "\\\\NAS\\Backups\\", size: gb(4.2) },
  { rank: 10, name: "TeamsExport.zip", path: "\\\\NAS\\Clients\\Desmet\\", size: gb(3.9) },
];
