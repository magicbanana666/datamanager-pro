//! Diagnostic Tauri commands used to prove the frontend/backend bridge
//! works. All values are mocked - Phase 1 does no real system inspection.

use crate::models::system::{AppVersionInfo, SystemInfoMock};

#[tauri::command]
pub fn get_app_version() -> AppVersionInfo {
    AppVersionInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        name: "DataManager Pro".to_string(),
        tauri_version: tauri::VERSION.to_string(),
    }
}

/// Returns a fixed, hand-authored payload rather than real hardware
/// telemetry. The `System & Disk Tools > System Info` card in the UI is
/// wired to this command purely to demonstrate the invoke round-trip.
#[tauri::command]
pub fn get_system_info_mock() -> SystemInfoMock {
    SystemInfoMock {
        os: "Windows".to_string(),
        os_version: "11 Pro (Phase 1 mock value)".to_string(),
        cpu: "Mock CPU - 8 cores / 16 threads".to_string(),
        total_memory_mb: 32768,
        hostname: "DEMO-PC".to_string(),
    }
}

/// Simple liveness check the frontend can call to confirm the Rust side
/// is responding.
#[tauri::command]
pub fn ping_backend() -> String {
    "pong".to_string()
}
