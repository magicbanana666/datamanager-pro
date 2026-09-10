//! Data shapes for the diagnostic/system-info commands
//! (`get_app_version`, `get_system_info`, `ping_backend`).

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppVersionInfo {
    pub version: String,
    pub name: String,
    pub tauri_version: String,
}

/// Real system information gathered via `sysinfo` (Phase 2). Kept
/// separate from the filesystem API per the Phase 2 brief - this has
/// nothing to do with disks/volumes.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    pub os: String,
    pub os_version: String,
    pub hostname: Option<String>,
    pub architecture: String,
    pub cpu_logical_cores: usize,
    pub total_memory_bytes: u64,
    pub available_memory_bytes: u64,
}
