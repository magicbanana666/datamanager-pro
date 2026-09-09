import type {
  AccessRightEntry,
  NetworkConnectionStatus,
  NetworkScanSummary,
  NetworkSession,
  NetworkShare,
} from "@/models/network";

export const networkConnectionStatus: NetworkConnectionStatus = {
  connected: true,
  server: "NAS",
  share: "CompanyData",
  user: "ITPartner\\jonas",
  protocol: "SMB 3.1.1",
  latencyMs: 3,
};

export const networkScanSummary: NetworkScanSummary = {
  folders: 12458,
  files: 1234567,
  totalBytes: Math.round(2.48 * 1024 ** 4),
  scanTimeSeconds: 102,
  transferRateMbps: 1200,
};

export const networkShares: NetworkShare[] = [
  { name: "CompanyData", path: "\\\\NAS\\CompanyData", totalBytes: Math.round(2.48 * 1024 ** 4), freeBytes: Math.round(5.21 * 1024 ** 4), fileSystem: "NTFS", status: "online" },
  { name: "Backups", path: "\\\\NAS\\Backups", totalBytes: Math.round(687.6 * 1024 ** 3), freeBytes: Math.round(3.12 * 1024 ** 4), fileSystem: "NTFS", status: "online" },
  { name: "Projects", path: "\\\\NAS\\Projects", totalBytes: Math.round(286.3 * 1024 ** 3), freeBytes: Math.round(1.45 * 1024 ** 4), fileSystem: "NTFS", status: "online" },
  { name: "Archive", path: "\\\\NAS\\Archive", totalBytes: Math.round(72.1 * 1024 ** 3), freeBytes: Math.round(4.88 * 1024 ** 3), fileSystem: "NTFS", status: "online" },
  { name: "ISO", path: "\\\\NAS\\ISO", totalBytes: Math.round(43.8 * 1024 ** 3), freeBytes: Math.round(2.21 * 1024 ** 4), fileSystem: "NTFS", status: "degraded" },
];

export const accessRights: AccessRightEntry[] = [
  { type: "User", name: "ITPartner\\jonas", permissions: "Full Control", inherited: false },
  { type: "Group", name: "Domain Users", permissions: "Read & Execute", inherited: true },
  { type: "Group", name: "IT-Staff", permissions: "Modify", inherited: false },
  { type: "Group", name: "Backup Operators", permissions: "Read", inherited: true },
];

export const networkSessions: NetworkSession[] = [
  { user: "ITPartner\\jonas", host: "PC-JONAS", connectedSince: "2026-09-09T08:12:00", openFiles: 3 },
  { user: "ITPartner\\svc-backup", host: "BKP-SRV01", connectedSince: "2026-09-09T22:00:00", openFiles: 128 },
  { user: "DOMAIN\\amartin", host: "LAPTOP-AM04", connectedSince: "2026-09-09T13:44:00", openFiles: 1 },
];

/** Generates a realistic-looking throughput history for a line chart. */
export function generateThroughputSeries(points = 60): { t: number; mbps: number }[] {
  const out: { t: number; mbps: number }[] = [];
  let base = 800;
  for (let i = 0; i < points; i++) {
    base += (Math.sin(i / 4) * 40 + (Math.random() - 0.5) * 90);
    base = Math.max(200, Math.min(1500, base));
    out.push({ t: i, mbps: Math.round(base) });
  }
  return out;
}
