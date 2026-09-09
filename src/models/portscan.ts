export type ScanTargetMode = "single-ip" | "ip-range" | "cidr" | "hostname-list";

export type PortSettingMode = "common" | "custom" | "all";

export type CommonPortsPreset = "top-20" | "top-100" | "top-1000";

export type HostStatus = "up" | "down" | "filtered";

export interface OpenPortResult {
  port: number;
  service: string;
  banner: string;
}

export interface HostScanResult {
  id: string;
  ip: string;
  hostname: string;
  status: HostStatus;
  mac: string;
  vendor: string;
  responseTimeMs: number;
  ports: OpenPortResult[];
  favorite?: boolean;
}

export interface PortScanOptions {
  pingBeforeScan: boolean;
  detectServiceVersion: boolean;
  resolveHostnames: boolean;
  multithreaded: boolean;
  threadCount: number;
}

export interface PortScanProgress {
  scannedHosts: number;
  totalHosts: number;
  openPortsFound: number;
  elapsedSeconds: number;
  estimatedSeconds: number;
  hostsPerSecond: number;
}
