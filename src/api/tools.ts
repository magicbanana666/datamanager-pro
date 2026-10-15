/** Typed wrappers around the Tools page commands (`commands::tools`). */
import { invoke } from "@tauri-apps/api/core";
import type { SystemTool } from "@/models/tools";

export interface Digests {
  size: number;
  md5: string;
  sha1: string;
  sha256: string;
}

export interface PhysicalDisk {
  FriendlyName: string | null;
  MediaType: string | null;
  BusType: string | null;
  HealthStatus: string | null;
  OperationalStatus: string | null;
  Size: number | null;
}

export const launchSystemTool = (tool: SystemTool, workingDir?: string) =>
  invoke<void>("launch_system_tool", { tool, workingDir: workingDir ?? null });
export const fileDigests = (path: string) => invoke<Digests>("file_digests", { path });
export const splitFile = (path: string, partSize: number, destDir: string) =>
  invoke<string[]>("split_file", { path, partSize, destDir });
export const mergeFileParts = (firstPart: string, destDir: string) => invoke<string>("merge_file_parts", { firstPart, destDir });
export const zipFiles = (source: string, destination: string) => invoke<number>("zip_files", { source, destination });
export const unzipArchive = (archive: string, destDir: string) => invoke<number>("unzip_archive", { archive, destDir });
export const shredFiles = (paths: string[]) =>
  invoke<{ shredded: string[]; errors: { path: string; message: string }[] }>("shred_files", { paths });
export const pingHost = (host: string) => invoke<string>("ping_host", { host });
export const dnsLookup = (host: string) => invoke<string[]>("dns_lookup", { host });
export const wakeOnLan = (mac: string, broadcast?: string) => invoke<void>("wake_on_lan", { mac, broadcast: broadcast ?? null });
export const diskHealth = () => invoke<PhysicalDisk[]>("disk_health");
export const runScript = (path: string) => invoke<void>("run_script", { path });
export const readLatestLog = (maxLines?: number) => invoke<string>("read_latest_log", { maxLines: maxLines ?? null });
export const dataFolder = () => invoke<string>("data_folder");
