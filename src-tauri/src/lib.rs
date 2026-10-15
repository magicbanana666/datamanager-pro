//! DataManager Pro - Tauri backend entry point.
//!
//! Read-only engines: volumes, folder browsing and metadata
//! (`commands::filesystem`, `commands::storage`), the recursive scanner
//! (`commands::scan`), and search, comparison and duplicate detection
//! (`commands::search`, `commands::comparison`, `commands::duplicates`).
//!
//! Since Phase 6 the app also **writes**, but only through explicit user
//! actions: the transfer engine (`commands::transfer` - copy, move and
//! sync, journaled and resumable) and one-shot file operations
//! (`commands::fileops` - delete selected files, save exports). See
//! ROADMAP.md and the PHASE*.md files.

mod commands;
mod models;
mod platform;
mod services;
mod utils;

use commands::comparison::{cancel_comparison, start_comparison};
use commands::duplicates::{cancel_duplicate_scan, start_duplicate_scan};
use commands::fileops::{delete_files, save_text_file};
use commands::network::{
    get_access_rights, get_share_connection, list_server_sessions, list_server_shares,
    measure_read_speed,
};
use commands::filesystem::{
    get_directory_summary, get_file_metadata, get_folder_metadata, list_directory, validate_path,
};
use commands::scan::{
    analyze_subtree, cancel_scan, get_subtree, start_scan, ScanRegistry, ScanTreeCache,
};
use commands::search::{cancel_file_search, get_text_preview, open_path, start_file_search};
use commands::storage::list_storage_volumes;
use commands::system::{get_app_version, get_system_info, ping_backend};
use commands::transfer::{
    cancel_shutdown, cancel_transfer, discard_interrupted_transfer, execute_transfer,
    list_interrupted_transfers, open_folder, resume_interrupted_transfer, schedule_shutdown,
    set_transfer_paused, start_transfer, TransferRegistry,
};
use commands::reports::{
    delete_report, export_report, generate_report, list_reports, preview_report, reports_folder,
};
use commands::scheduler::{
    clear_task_history, delete_scheduled_task, get_scheduler, run_task_now, save_scheduled_task,
    set_task_enabled, update_scheduler_settings, SchedulerStore,
};
use commands::JobRegistry;

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
        .manage(JobRegistry::default())
        .manage(TransferRegistry::default())
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
            start_duplicate_scan,
            cancel_duplicate_scan,
            start_comparison,
            cancel_comparison,
            start_file_search,
            cancel_file_search,
            get_text_preview,
            open_path,
            start_transfer,
            execute_transfer,
            set_transfer_paused,
            cancel_transfer,
            list_interrupted_transfers,
            resume_interrupted_transfer,
            discard_interrupted_transfer,
            schedule_shutdown,
            cancel_shutdown,
            open_folder,
            delete_files,
            save_text_file,
            get_share_connection,
            list_server_shares,
            list_server_sessions,
            get_access_rights,
            measure_read_speed,
            get_scheduler,
            save_scheduled_task,
            delete_scheduled_task,
            set_task_enabled,
            update_scheduler_settings,
            clear_task_history,
            run_task_now,
            generate_report,
            preview_report,
            list_reports,
            delete_report,
            export_report,
            reports_folder,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::Manager::manage(app, SchedulerStore::load(&handle));
            commands::scheduler::start_runner(handle);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
