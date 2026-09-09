/** Small supplementary mock datasets shared by the Disk Analysis and
 * Folder Analysis "Extensions", "Users/Owners" and "Timeline" tabs. */

function gb(n: number): number {
  return Math.round(n * 1024 * 1024 * 1024);
}

export interface ExtensionStat {
  extension: string;
  files: number;
  size: number;
  percent: number;
}

export const diskExtensions: ExtensionStat[] = [
  { extension: ".vhdx", files: 12, size: gb(412.5), percent: 33.6 },
  { extension: ".zip", files: 4821, size: gb(198.4), percent: 16.2 },
  { extension: ".mkv", files: 214, size: gb(140.1), percent: 11.4 },
  { extension: ".iso", files: 97, size: gb(112.4), percent: 9.2 },
  { extension: ".pdf", files: 28114, size: gb(58.2), percent: 4.7 },
  { extension: ".docx", files: 34221, size: gb(38.3), percent: 3.1 },
  { extension: ".jpg", files: 61240, size: gb(52.1), percent: 4.3 },
  { extension: ".exe", files: 3827, size: gb(31.4), percent: 2.6 },
  { extension: ".xlsx", files: 12442, size: gb(19.8), percent: 1.6 },
  { extension: "(other)", files: 71892, size: gb(162.9), percent: 13.3 },
];

export interface OwnerStat {
  user: string;
  files: number;
  size: number;
  percent: number;
}

export const diskOwners: OwnerStat[] = [
  { user: "ITPartner\\jonas", files: 812440, size: gb(742.1), percent: 60.5 },
  { user: "NT AUTHORITY\\SYSTEM", files: 214221, size: gb(268.4), percent: 21.9 },
  { user: "BUILTIN\\Administrators", files: 98214, size: gb(148.6), percent: 12.1 },
  { user: "ITPartner\\svc-backup", files: 27466, size: gb(67.0), percent: 5.5 },
];

export interface TimelineBucket {
  label: string;
  size: number;
}

export const diskTimeline: TimelineBucket[] = [
  { label: "Today", size: gb(18.2) },
  { label: "This week", size: gb(64.3) },
  { label: "This month", size: gb(212.8) },
  { label: "Last 6 months", size: gb(486.4) },
  { label: "This year", size: gb(298.1) },
  { label: "Older", size: gb(146.3) },
];
