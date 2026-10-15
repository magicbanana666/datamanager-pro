/** Mirrors `src-tauri/src/models/network.rs`. */
export interface ShareConnection {
  server: string;
  share: string;
  user: string;
  reachable: boolean;
  latencyMs: number | null;
  protocol: string | null;
}

export interface NetworkShare {
  name: string;
  path: string;
  kind: "disk" | "printer" | "device" | "ipc" | "other";
  special: boolean;
  remark: string;
  totalBytes: number | null;
  freeBytes: number | null;
  fileSystem: string | null;
  status: "online" | "no-access" | "n/a";
}

export interface AccessRightEntry {
  type: "User" | "Group" | "Computer" | "SID";
  name: string;
  permissions: string;
  allow: boolean;
  inherited: boolean;
}

export interface NetworkSession {
  user: string;
  host: string;
  connectedSeconds: number;
  idleSeconds: number;
}

export interface ThroughputSample {
  tMs: number;
  mbps: number;
}

export interface ReadSpeedResult {
  path: string;
  bytesRead: number;
  elapsedMs: number;
  averageMbps: number;
  samples: ThroughputSample[];
}
