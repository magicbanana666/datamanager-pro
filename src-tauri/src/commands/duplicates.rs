//! Tauri commands for the Phase 5 duplicate finder - same shape as
//! `commands::scan`: `start_duplicate_scan` validates, registers and
//! spawns a run, returning immediately; progress and the outcome are
//! streamed back as events:
//!
//! - `duplicate-progress` - roughly every 150ms while running.
//! - `duplicate-complete` - once, carrying the `DuplicateResult`.
//! - `duplicate-cancelled` - once, instead, after `cancel_duplicate_scan`.
//! - `duplicate-error` - only if the task itself panics.
//!
//! The caller generates the run id, for the same subscribe-before-start
//! reason documented on `commands::scan::start_scan`.

use super::{run_hash_job, JobRegistry};
use crate::models::duplicates::{DuplicateOptions, DuplicateResult};
use crate::models::errors::{AppError, AppErrorCode};
use crate::models::hash_job::HashJobState;
use crate::services::{duplicate_service, path_service};
use serde::Serialize;
use std::sync::Arc;
use std::time::Instant;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CancelledPayload<'a> {
    pub scan_id: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ErrorPayload<'a> {
    pub scan_id: &'a str,
    pub error: AppError,
}

/// Validates every location up front (better to say so than to report
/// "nothing found" for a typo'd path) and returns them normalized.
pub(crate) fn validate_folders(roots: Vec<String>) -> Result<Vec<String>, AppError> {
    let mut normalized = Vec::with_capacity(roots.len());
    for root in roots {
        let validation = path_service::validate(&root);
        if !validation.exists || !validation.is_directory {
            return Err(validation.error.unwrap_or_else(|| {
                AppError::invalid_path(root.clone(), "This location is not a folder.")
            }));
        }
        normalized.push(validation.normalized_path.unwrap_or(root));
    }
    Ok(normalized)
}

#[tauri::command]
pub async fn start_duplicate_scan(
    app: AppHandle,
    scan_id: String,
    roots: Vec<String>,
    options: DuplicateOptions,
) -> Result<(), AppError> {
    if roots.is_empty() {
        return Err(AppError::new(
            AppErrorCode::InvalidPath,
            "Select at least one location to search.",
        ));
    }
    let roots = validate_folders(roots)?;

    let state = Arc::new(HashJobState::new());
    app.state::<JobRegistry>().insert(&scan_id, state.clone());
    tracing::info!(scan_id = %scan_id, roots = ?roots, criteria = ?options.criteria, "duplicate scan starting");
    tauri::async_runtime::spawn(run_and_report(app, scan_id, roots, options, state));
    Ok(())
}

#[tauri::command]
pub fn cancel_duplicate_scan(app: AppHandle, scan_id: String) -> Result<(), AppError> {
    app.state::<JobRegistry>().cancel(&scan_id);
    Ok(())
}

async fn run_and_report(
    app: AppHandle,
    scan_id: String,
    roots: Vec<String>,
    options: DuplicateOptions,
    state: Arc<HashJobState>,
) {
    let started = Instant::now();
    let work_state = state.clone();
    let outcome = run_hash_job(
        &app,
        "duplicate-progress",
        &scan_id,
        state.clone(),
        move || duplicate_service::find_duplicates(&roots, &options, &work_state),
    )
    .await;
    let elapsed_ms = started.elapsed().as_millis() as u64;

    match outcome {
        Err(join_err) => {
            tracing::error!(error = %join_err, scan_id = %scan_id, "duplicate task panicked");
            let _ = app.emit(
                "duplicate-error",
                &ErrorPayload {
                    scan_id: &scan_id,
                    error: AppError::new(
                        AppErrorCode::Unknown,
                        "An unexpected internal error occurred while searching for duplicates.",
                    ),
                },
            );
        }
        Ok(_) if state.is_cancelled() => {
            tracing::info!(scan_id = %scan_id, "duplicate scan cancelled");
            let _ = app.emit(
                "duplicate-cancelled",
                &CancelledPayload { scan_id: &scan_id },
            );
        }
        Ok(outcome) => {
            let total_groups = outcome.groups.len() as u64;
            let total_duplicate_files = outcome.groups.iter().map(|g| g.files.len() as u64).sum();
            let total_wasted_bytes = outcome.groups.iter().map(|g| g.wasted_bytes).sum();
            tracing::info!(
                scan_id = %scan_id,
                elapsed_ms,
                files_compared = outcome.files_compared,
                total_groups,
                total_wasted_bytes,
                "duplicate scan complete"
            );
            let result = DuplicateResult {
                scan_id: scan_id.clone(),
                groups: duplicate_service::rank_and_cap(outcome.groups),
                total_groups,
                total_duplicate_files,
                total_wasted_bytes,
                files_compared: outcome.files_compared,
                elapsed_ms,
                skipped: state.scan.take_skipped(),
            };
            let _ = app.emit("duplicate-complete", &result);
        }
    }
}
