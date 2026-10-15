//! Tauri command handlers, grouped by feature area. Only `transfer` and
//! `fileops` modify files.

pub mod comparison;
pub mod duplicates;
pub mod fileops;
pub mod filesystem;
pub mod scan;
pub mod search;
pub mod storage;
pub mod system;
pub mod tools;

pub mod network;
pub mod reports;
pub mod scheduler;
pub mod transfer;

use crate::models::errors::{AppError, AppErrorCode};

/// Runs `f` on the blocking pool so slow I/O (large folders, stalled
/// shares) doesn't hold up the async runtime. A panic becomes an [`AppError`].
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

/// Running hash jobs (duplicate finder, comparison) by frontend job id,
/// so cancel commands can find them. Removed once the job finishes.
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

/// Runs `work` on the blocking pool, emitting `progress_event` every
/// 150 ms, then deregisters the job. A panic comes back as `Err`.
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
