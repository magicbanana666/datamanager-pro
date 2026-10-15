//! Network share types. Mirrors `src/models/network.ts`.

use serde::Serialize;

/// Connection details for a UNC location.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareConnection {
    pub server: String,
    pub share: String,
    /// The Windows account the app runs as - the one SMB uses unless a
    /// mapped drive was connected with other credentials.
    pub user: String,
    pub reachable: bool,
    /// TCP connect time to port 445.
    pub latency_ms: Option<u32>,
    /// SMB dialect (e.g. "3.1.1") if Windows reports one.
    pub protocol: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkShare {
    pub name: String,
    pub path: String,
    /// "disk", "printer", "device", "ipc".
    pub kind: String,
    /// Administrative/hidden share (`C$`, `ADMIN$`, ...).
    pub special: bool,
    pub remark: String,
    pub total_bytes: Option<u64>,
    pub free_bytes: Option<u64>,
    pub file_system: Option<String>,
    /// "online" (readable), "no-access", or "n/a" for non-disk shares.
    pub status: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccessRightEntry {
    /// "User", "Group", "Computer" or "SID" (unresolved).
    #[serde(rename = "type")]
    pub kind: String,
    pub name: String,
    pub permissions: String,
    pub allow: bool,
    pub inherited: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkSession {
    pub user: String,
    pub host: String,
    pub connected_seconds: u32,
    pub idle_seconds: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThroughputSample {
    pub t_ms: u64,
    pub mbps: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadSpeedResult {
    pub path: String,
    pub bytes_read: u64,
    pub elapsed_ms: u64,
    pub average_mbps: f64,
    pub samples: Vec<ThroughputSample>,
}

