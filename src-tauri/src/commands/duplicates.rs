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

use crate::models::duplicates::{
    DuplicateOptions, DuplicateProgress, DuplicateProgressState, DuplicateResult,
};
use crate::models::errors::{AppError, AppErrorCode};
use crate::services::{duplicate_service, path_service};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Default)]
pub struct DuplicateRegistry {
    runs: Mutex<HashMap<String, Arc<DuplicateProgressState>>>,
}

const PROGRESS_INTERVAL: Duration = Duration::from_millis(150);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CancelledPayload<'a> {
    scan_id: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ErrorPayload<'a> {
    scan_id: &'a str,
    error: AppError,
}

/// Rejects synchronously if there's no location or any location isn't
/// an existing folder - better to say so up front than to report "no
/// duplicates" for a typo'd path.
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

    let state = Arc::new(DuplicateProgressState::new());
    app.state::<DuplicateRegistry>()
        .runs
        .lock()
        .unwrap()
        .insert(scan_id.clone(), state.clone());

    tracing::info!(scan_id = %scan_id, roots = ?normalized, criteria = ?options.criteria, "duplicate scan starting");
    tauri::async_runtime::spawn(run_and_report(app, scan_id, normalized, options, state));
    Ok(())
}

/// A no-op if the run already finished.
#[tauri::command]
pub fn cancel_duplicate_scan(app: AppHandle, scan_id: String) -> Result<(), AppError> {
    if let Some(state) = app
        .state::<DuplicateRegistry>()
        .runs
        .lock()
        .unwrap()
        .get(&scan_id)
    {
        tracing::info!(scan_id = %scan_id, "duplicate scan cancellation requested");
        state.scan.cancel();
    }
    Ok(())
}

fn emit_progress(app: &AppHandle, scan_id: &str, state: &DuplicateProgressState, started: Instant) {
    let progress = DuplicateProgress {
        scan_id: scan_id.to_string(),
        phase: state.phase(),
        files_found: state.scan.files.load(Ordering::Relaxed),
        bytes_to_hash: state.bytes_to_hash.load(Ordering::Relaxed),
        bytes_hashed: state.bytes_hashed.load(Ordering::Relaxed),
        current_path: state
            .scan
            .current_path
            .try_lock()
            .map(|p| p.clone())
            .unwrap_or_default(),
        elapsed_ms: started.elapsed().as_millis() as u64,
    };
    let _ = app.emit("duplicate-progress", &progress);
}

async fn run_and_report(
    app: AppHandle,
    scan_id: String,
    roots: Vec<String>,
    options: DuplicateOptions,
    state: Arc<DuplicateProgressState>,
) {
    let started = Instant::now();
    let blocking_state = state.clone();
    let mut handle = tokio::task::spawn_blocking(move || {
        duplicate_service::find_duplicates(&roots, &options, &blocking_state)
    });

    let mut ticker = tokio::time::interval(PROGRESS_INTERVAL);
    ticker.tick().await;
    let outcome = loop {
        tokio::select! {
            result = &mut handle => break result,
            _ = ticker.tick() => emit_progress(&app, &scan_id, &state, started),
        }
    };

    app.state::<DuplicateRegistry>()
        .runs
        .lock()
        .unwrap()
        .remove(&scan_id);
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
