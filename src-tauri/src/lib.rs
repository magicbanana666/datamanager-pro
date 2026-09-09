//! DataManager Pro - Tauri backend entry point.
//!
//! Phase 1 is UI-only: the handful of commands registered below exist
//! only to prove the frontend/backend bridge works end-to-end. No disk
//! scanning, network scanning, file copying, synchronization, deletion,
//! scheduling or filesystem modification happens anywhere in this crate
//! yet - see `commands` and `models` for the placeholder modules reserved
//! for that work in later phases.

mod commands;
mod models;
mod services;

use commands::system::{get_app_version, get_system_info_mock, ping_backend};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_app_version,
            get_system_info_mock,
            ping_backend,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
