//! Tauri commands for the Phase 5 folder comparison - same streaming
//! shape as `commands::duplicates`:
//!
//! - `comparison-progress` - roughly every 150ms while running.
//! - `comparison-complete` - once, carrying the `ComparisonResult`.
//! - `comparison-cancelled` - once, instead, after `cancel_comparison`.
//! - `comparison-error` - only if the task itself panics.

use super::duplicates::{validate_folders, CancelledPayload, ErrorPayload};
use super::{run_hash_job, JobRegistry};
use crate::models::comparison::{ComparisonOptions, ComparisonResult};
use crate::models::errors::{AppError, AppErrorCode};
use crate::models::hash_job::HashJobState;
use crate::services::comparison_service;
use std::sync::Arc;
use std::time::Instant;
use tauri::{AppHandle, Emitter, Manager};

#[tauri::command]
pub async fn start_comparison(
    app: AppHandle,
    scan_id: String,
    location_a: String,
    location_b: String,
    options: ComparisonOptions,
) -> Result<(), AppError> {
    let mut locations = validate_folders(vec![location_a, location_b])?.into_iter();
    let (a, b) = (locations.next().unwrap(), locations.next().unwrap());
    if a.eq_ignore_ascii_case(&b) {
        return Err(AppError::new(
            AppErrorCode::InvalidPath,
            "Location A and B are the same folder.",
        ));
    }

    let state = Arc::new(HashJobState::new());
    app.state::<JobRegistry>().insert(&scan_id, state.clone());
    tracing::info!(scan_id = %scan_id, a = %a, b = %b, mode = ?options.mode, "comparison starting");
    tauri::async_runtime::spawn(run_and_report(app, scan_id, a, b, options, state));
    Ok(())
}

#[tauri::command]
pub fn cancel_comparison(app: AppHandle, scan_id: String) -> Result<(), AppError> {
    app.state::<JobRegistry>().cancel(&scan_id);
    Ok(())
}

async fn run_and_report(
    app: AppHandle,
    scan_id: String,
    location_a: String,
    location_b: String,
    options: ComparisonOptions,
    state: Arc<HashJobState>,
) {
    let started = Instant::now();
    let work_state = state.clone();
    let outcome = run_hash_job(
        &app,
        "comparison-progress",
        &scan_id,
        state.clone(),
        move || comparison_service::compare(&location_a, &location_b, &options, &work_state),
    )
    .await;
    let elapsed_ms = started.elapsed().as_millis() as u64;

    match outcome {
        Err(join_err) => {
            tracing::error!(error = %join_err, scan_id = %scan_id, "comparison task panicked");
            let _ = app.emit(
                "comparison-error",
                &ErrorPayload {
                    scan_id: &scan_id,
                    error: AppError::new(
                        AppErrorCode::Unknown,
                        "An unexpected internal error occurred while comparing.",
                    ),
                },
            );
        }
        Ok(_) if state.is_cancelled() => {
            tracing::info!(scan_id = %scan_id, "comparison cancelled");
            let _ = app.emit(
                "comparison-cancelled",
                &CancelledPayload { scan_id: &scan_id },
            );
        }
        Ok(outcome) => {
            tracing::info!(scan_id = %scan_id, elapsed_ms, totals = ?outcome.totals, "comparison complete");
            let result = ComparisonResult {
                scan_id: scan_id.clone(),
                a: outcome.a,
                b: outcome.b,
                totals: outcome.totals,
                rows: outcome.rows,
                elapsed_ms,
                skipped: state.scan.take_skipped(),
            };
            let _ = app.emit("comparison-complete", &result);
        }
    }
}
