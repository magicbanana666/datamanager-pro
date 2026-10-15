//! Diagnostic and system-info commands. `get_system_info` is real as of
//! Phase 2 (via `sysinfo`); it deliberately knows nothing about disks or
//! volumes - see `commands::storage` for that.

use super::blocking;
use crate::models::errors::AppError;
use crate::models::system::{AppVersionInfo, SystemInfo};

#[tauri::command]
pub fn get_app_version() -> AppVersionInfo {
    AppVersionInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        name: "DataManager Pro".to_string(),
        tauri_version: tauri::VERSION.to_string(),
    }
}

/// Real OS/CPU/RAM information gathered via `sysinfo`. Kept separate
/// from the filesystem/storage API on purpose.
#[tauri::command]
pub async fn get_system_info() -> Result<SystemInfo, AppError> {
    tracing::info!("get_system_info");
    blocking(|| {
        use sysinfo::System;
        let mut sys = System::new();
        sys.refresh_memory();

        Ok(SystemInfo {
            os: System::name().unwrap_or_else(|| "Unknown".to_string()),
            os_version: System::os_version().unwrap_or_else(|| "Unknown".to_string()),
            hostname: System::host_name(),
            architecture: std::env::consts::ARCH.to_string(),
            cpu_logical_cores: std::thread::available_parallelism()
                .map(|n| n.get())
                .unwrap_or(1),
            total_memory_bytes: sys.total_memory(),
            available_memory_bytes: sys.available_memory(),
        })
    })
    .await
}

/// Simple liveness check the frontend can call to confirm the Rust side
/// is responding.
#[tauri::command]
pub fn ping_backend() -> String {
    "pong".to_string()
}

/// This process's memory use (working set) in bytes, for the status bar.
#[tauri::command]
pub async fn get_process_memory() -> Result<u64, AppError> {
    blocking(|| {
        use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};
        let pid = Pid::from_u32(std::process::id());
        let mut sys = System::new();
        sys.refresh_processes_specifics(ProcessesToUpdate::Some(&[pid]), true, ProcessRefreshKind::nothing().with_memory());
        Ok(sys.process(pid).map_or(0, |p| p.memory()))
    })
    .await
}
