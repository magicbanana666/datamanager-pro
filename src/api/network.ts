/** Network share commands. */
import { invoke } from "@tauri-apps/api/core";
import type { AccessRightEntry, NetworkSession, NetworkShare, ReadSpeedResult, ShareConnection } from "@/models/network";

export function getShareConnection(path: string): Promise<ShareConnection> {
  return invoke("get_share_connection", { path });
}

export function listServerShares(server: string): Promise<NetworkShare[]> {
  return invoke("list_server_shares", { server });
}

export function listServerSessions(server: string): Promise<NetworkSession[]> {
  return invoke("list_server_sessions", { server });
}

export function getAccessRights(path: string): Promise<AccessRightEntry[]> {
  return invoke("get_access_rights", { path });
}

export function measureReadSpeed(path: string): Promise<ReadSpeedResult> {
  return invoke("measure_read_speed", { path });
}
