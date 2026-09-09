export interface NetworkConnectionStatus {
  connected: boolean;
  server: string;
  share: string;
  user: string;
  protocol: string;
  latencyMs: number;
}

export interface NetworkShare {
  name: string;
  path: string;
  totalBytes: number;
  freeBytes: number;
  fileSystem: string;
  status: "online" | "offline" | "degraded";
}

export interface NetworkScanSummary {
  folders: number;
  files: number;
  totalBytes: number;
  scanTimeSeconds: number;
  transferRateMbps: number;
}

export interface AccessRightEntry {
  type: "User" | "Group";
  name: string;
  permissions: string;
  inherited: boolean;
}

export interface ThroughputSample {
  t: number;
  mbps: number;
}

export interface NetworkSession {
  user: string;
  host: string;
  connectedSince: string;
  openFiles: number;
}
