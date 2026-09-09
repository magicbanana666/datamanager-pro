//! Data shapes returned by the Phase 1 diagnostic commands
//! (`get_app_version`, `get_system_info_mock`, `ping_backend`). These prove
//! the frontend/backend bridge works; the values themselves are mocked.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct AppVersionInfo {
    pub version: String,
    pub name: String,
    pub tauri_version: String,
}

/// Placeholder system info. Phase 2+ will replace this with real values
/// gathered via `sysinfo` or platform APIs.
#[derive(Debug, Clone, Serialize)]
pub struct SystemInfoMock {
    pub os: String,
    pub os_version: String,
    pub cpu: String,
    pub total_memory_mb: u64,
    pub hostname: String,
}
