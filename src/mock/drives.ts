import type { DriveInfo, RecentLocation } from "@/models/common";

export const drives: DriveInfo[] = [
  { letter: "C:", label: "Windows", totalBytes: 512 * 1024 ** 3, usedBytes: 298 * 1024 ** 3, freeBytes: 214 * 1024 ** 3, fileSystem: "NTFS" },
  { letter: "D:", label: "Data", totalBytes: 1810 * 1024 ** 3, usedBytes: 1226.1 * 1024 ** 3, freeBytes: 579.1 * 1024 ** 3, fileSystem: "NTFS" },
  { letter: "E:", label: "Archive", totalBytes: 2048 * 1024 ** 3, usedBytes: 1462 * 1024 ** 3, freeBytes: 586 * 1024 ** 3, fileSystem: "NTFS" },
];

export const recentLocations: RecentLocation[] = [
  { path: "D:\\Data", kind: "local" },
  { path: "D:\\Data\\Projects", kind: "local" },
  { path: "E:\\Archive\\Projects", kind: "local" },
  { path: "\\\\NAS\\CompanyData", kind: "network" },
  { path: "\\\\NAS\\Backups", kind: "network" },
  { path: "\\\\NAS\\Projects", kind: "network" },
];

export const sampleCustomers = ["AMGroup", "Cobofisk", "Desmet"] as const;

export const sampleFolderNames = [
  "Clients",
  "Projects",
  "Backups",
  "ISO",
  "Media",
  "Documents",
  "Tools",
  "Temp",
  "Archive",
] as const;
