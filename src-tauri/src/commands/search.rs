//! File search commands.
//!
//! Events: `search-progress` (every 150 ms), then one of
//! `search-complete`, `search-cancelled` or `search-error`.

use super::duplicates::{validate_folders, CancelledPayload, ErrorPayload};
use super::{blocking, run_hash_job, JobRegistry};
use crate::models::errors::{AppError, AppErrorCode};
use crate::models::hash_job::HashJobState;
use crate::models::search::{SearchOptions, SearchResult};
use crate::services::search_service;
use std::io::Read;
use std::sync::Arc;
use std::time::Instant;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_opener::OpenerExt;

/// Fails immediately on a bad location or query (empty, invalid regex).
#[tauri::command]
pub async fn start_file_search(
    app: AppHandle,
    scan_id: String,
    location: String,
    options: SearchOptions,
) -> Result<(), AppError> {
    let location = validate_folders(vec![location])?.remove(0);
    if !options.match_name && !options.match_content {
        return Err(AppError::new(
            AppErrorCode::InvalidInput,
            "Choose to search file names, file content, or both.",
        ));
    }
    let matcher = search_service::build_matcher(&options)
        .map_err(|msg| AppError::new(AppErrorCode::InvalidInput, msg))?;

    let state = Arc::new(HashJobState::new());
    app.state::<JobRegistry>().insert(&scan_id, state.clone());
    tracing::info!(scan_id = %scan_id, location = %location, query = %options.query, "file search starting");
    tauri::async_runtime::spawn(run_and_report(
        app, scan_id, location, options, matcher, state,
    ));
    Ok(())
}

#[tauri::command]
pub fn cancel_file_search(app: AppHandle, scan_id: String) -> Result<(), AppError> {
    app.state::<JobRegistry>().cancel(&scan_id);
    Ok(())
}

async fn run_and_report(
    app: AppHandle,
    scan_id: String,
    location: String,
    options: SearchOptions,
    matcher: search_service::Matcher,
    state: Arc<HashJobState>,
) {
    let started = Instant::now();
    let work_state = state.clone();
    let outcome = run_hash_job(
        &app,
        "search-progress",
        &scan_id,
        state.clone(),
        move || search_service::search(&location, &options, &matcher, &work_state),
    )
    .await;
    let elapsed_ms = started.elapsed().as_millis() as u64;

    match outcome {
        Err(join_err) => {
            tracing::error!(error = %join_err, scan_id = %scan_id, "search task panicked");
            let _ = app.emit(
                "search-error",
                &ErrorPayload {
                    scan_id: &scan_id,
                    error: AppError::new(
                        AppErrorCode::Unknown,
                        "An unexpected internal error occurred while searching.",
                    ),
                },
            );
        }
        Ok(_) if state.is_cancelled() => {
            tracing::info!(scan_id = %scan_id, "file search cancelled");
            let _ = app.emit("search-cancelled", &CancelledPayload { scan_id: &scan_id });
        }
        Ok(outcome) => {
            tracing::info!(
                scan_id = %scan_id,
                elapsed_ms,
                files_searched = outcome.files_searched,
                total_hits = outcome.total_hits,
                "file search complete"
            );
            let result = SearchResult {
                scan_id: scan_id.clone(),
                hits: outcome.hits,
                total_hits: outcome.total_hits,
                files_searched: outcome.files_searched,
                elapsed_ms,
                skipped: state.scan.take_skipped(),
            };
            let _ = app.emit("search-complete", &result);
        }
    }
}

/// The first 16 KiB of a file for the Preview tab; `None` if it looks
/// binary.
#[tauri::command]
pub async fn get_text_preview(path: String) -> Result<Option<String>, AppError> {
    blocking(move || {
        let mut buf = Vec::new();
        std::fs::File::open(&path)
            .and_then(|f| f.take(16 * 1024).read_to_end(&mut buf))
            .map_err(|e| AppError::from_io(&e, &path))?;
        Ok((!buf.contains(&0)).then(|| String::from_utf8_lossy(&buf).into_owned()))
    })
    .await
}

/// Opens an existing file with its default application. Done here so
/// the webview doesn't need a broad opener permission.
#[tauri::command]
pub fn open_path(app: AppHandle, path: String) -> Result<(), AppError> {
    if !std::path::Path::new(&path).is_file() {
        return Err(AppError::new(
            AppErrorCode::PathNotFound,
            "That file no longer exists.",
        ));
    }
    app.opener().open_path(&path, None::<&str>).map_err(|e| {
        AppError::new(
            AppErrorCode::IoError,
            format!("Couldn't open the file: {e}"),
        )
    })
}
