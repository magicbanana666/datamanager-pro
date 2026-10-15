//! Tauri command handlers, grouped by feature area.
//!
//! `system`, `filesystem` and `storage` back the real, read-only Phase 1
//! and Phase 2 surface. `network`, `scheduler` and `transfer` remain
//! documented, empty placeholders reserved for later phases so the
//! module layout doesn't need to change when real network scanning,
//! scheduling and transfer engines are added.

pub mod comparison;
pub mod duplicates;
pub mod filesystem;
pub mod scan;
pub mod search;
pub mod storage;
pub mod system;

pub mod network;
pub mod scheduler;
pub mod transfer;

use crate::models::errors::{AppError, AppErrorCode};

/// Runs `f` on Tokio's blocking thread pool so a slow filesystem call
/// (a large directory, a stalled network share) can't freeze the UI
/// thread, and maps a task panic to a safe [`AppError`] instead of
/// propagating it.
pub(crate) async fn blocking<T, F>(f: F) -> Result<T, AppError>
where
    F: FnOnce() -> Result<T, AppError> + Send + 'static,
    T: Send + 'static,
{
    match tokio::task::spawn_blocking(f).await {
        Ok(result) => result,
        Err(join_err) => {
            tracing::error!(error = %join_err, "blocking task panicked");
            Err(AppError::new(
                AppErrorCode::Unknown,
                "An unexpected internal error occurred.",
            ))
        }
    }
}

/// Every running Phase 5 hash job (duplicate finder, folder comparison),
/// keyed by its frontend-generated id - so each feature's cancel command
/// can find its run. A run is removed once it reports its outcome.
#[derive(Default)]
pub struct JobRegistry {
    jobs: std::sync::Mutex<
        std::collections::HashMap<String, std::sync::Arc<crate::models::hash_job::HashJobState>>,
    >,
}

impl JobRegistry {
    pub(crate) fn insert(
        &self,
        id: &str,
        state: std::sync::Arc<crate::models::hash_job::HashJobState>,
    ) {
        self.jobs.lock().unwrap().insert(id.to_string(), state);
    }

    pub(crate) fn remove(&self, id: &str) {
        self.jobs.lock().unwrap().remove(id);
    }

    /// A no-op if the job already finished.
    pub(crate) fn cancel(&self, id: &str) {
        if let Some(state) = self.jobs.lock().unwrap().get(id) {
            tracing::info!(job_id = %id, "job cancellation requested");
            state.scan.cancel();
        }
    }
}

/// Runs `work` on the blocking pool while emitting `progress_event`
/// (a `HashJobProgress`) every 150ms, then deregisters the job. The
/// caller turns the returned outcome into its own complete/cancelled/
/// error events. A task panic comes back as `Err`.
pub(crate) async fn run_hash_job<T: Send + 'static>(
    app: &tauri::AppHandle,
    progress_event: &str,
    job_id: &str,
    state: std::sync::Arc<crate::models::hash_job::HashJobState>,
    work: impl FnOnce() -> T + Send + 'static,
) -> Result<T, tokio::task::JoinError> {
    use std::sync::atomic::Ordering;
    use tauri::{Emitter, Manager};

    let started = std::time::Instant::now();
    let mut handle = tokio::task::spawn_blocking(work);
    let mut ticker = tokio::time::interval(std::time::Duration::from_millis(150));
    ticker.tick().await; // the first tick fires immediately - nothing to report yet

    let outcome = loop {
        tokio::select! {
            result = &mut handle => break result,
            _ = ticker.tick() => {
                let progress = crate::models::hash_job::HashJobProgress {
                    scan_id: job_id.to_string(),
                    phase: state.phase(),
                    files_found: state.scan.files.load(Ordering::Relaxed),
                    bytes_to_hash: state.bytes_to_hash.load(Ordering::Relaxed),
                    bytes_hashed: state.bytes_hashed.load(Ordering::Relaxed),
                    current_path: state.scan.current_path.try_lock().map(|p| p.clone()).unwrap_or_default(),
                    elapsed_ms: started.elapsed().as_millis() as u64,
                };
                let _ = app.emit(progress_event, &progress);
            }
        }
    };
    app.state::<JobRegistry>().remove(job_id);
    outcome
}
