//! DataManager Pro - Tauri backend entry point.
//!
//! **Phase 3 status: read-only, now with a real recursive scanner.**
//! This crate can enumerate storage volumes, browse folders, read
//! file/folder metadata, and run a real, cancellable, multithreaded
//! (or best-effort MFT) recursive scan - see `commands::filesystem`,
//! `commands::storage` and `commands::scan`. It still cannot create,
//! delete, rename, move, copy, or write to anything; the transfer
//! engine, sync engine, network/port scanning and scheduler execution
//! are later phases (see `commands::network`, `commands::scheduler`,
//! `commands::transfer` for their still-empty placeholder modules, and
//! PHASE2.md / PHASE3.md / ROADMAP.md for details).

mod commands;
mod models;
mod platform;
mod services;
mod utils;

use commands::filesystem::{
    get_directory_summary, get_file_metadata, get_folder_metadata, list_directory, validate_path,
};
use commands::scan::{
    analyze_subtree, cancel_scan, get_subtree, start_scan, ScanRegistry, ScanTreeCache,
};
use commands::storage::list_storage_volumes;
use commands::system::{get_app_version, get_system_info, ping_backend};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();
    tracing::info!(
        version = env!("CARGO_PKG_VERSION"),
        "DataManager Pro starting"
    );

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(ScanRegistry::default())
        .manage(ScanTreeCache::default())
        .invoke_handler(tauri::generate_handler![
            get_app_version,
            get_system_info,
            ping_backend,
            list_storage_volumes,
            validate_path,
            list_directory,
            get_directory_summary,
            get_file_metadata,
            get_folder_metadata,
            start_scan,
            cancel_scan,
            get_subtree,
            analyze_subtree,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
