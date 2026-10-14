//! Tauri command handlers, grouped by feature area.
//!
//! `system`, `filesystem` and `storage` back the real, read-only Phase 1
//! and Phase 2 surface. `network`, `scheduler` and `transfer` remain
//! documented, empty placeholders reserved for later phases so the
//! module layout doesn't need to change when real network scanning,
//! scheduling and transfer engines are added.

pub mod duplicates;
pub mod filesystem;
pub mod scan;
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
