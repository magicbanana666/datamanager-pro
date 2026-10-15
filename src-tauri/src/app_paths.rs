//! Where the app keeps its own files.
//!
//! Installed: `%APPDATA%\xyz.vanhulle.datamanagerpro` for data (journals,
//! sync state, scheduler, report index, logs, crash reports) and
//! `Documents\DataManager Pro Reports` for reports.
//!
//! **Portable**: when a file named [`PORTABLE_MARKER`] sits next to the
//! exe, everything goes next to the exe instead (`Data\`, `Reports\`),
//! so the app can run from a USB stick without leaving files behind
//! (except WebView2's own cache in `%LOCALAPPDATA%`).

use crate::models::errors::{AppError, AppErrorCode};
use std::path::PathBuf;
use std::sync::OnceLock;
use tauri::{AppHandle, Manager};

pub const PORTABLE_MARKER: &str = "DataManagerPro.portable";

/// The exe's folder, if the portable marker is next to it.
pub fn portable_root() -> Option<&'static PathBuf> {
    static ROOT: OnceLock<Option<PathBuf>> = OnceLock::new();
    ROOT.get_or_init(|| {
        let exe = std::env::current_exe().ok()?;
        let dir = exe.parent()?.to_path_buf();
        dir.join(PORTABLE_MARKER).is_file().then_some(dir)
    })
    .as_ref()
}

fn unavailable(what: &str, e: impl std::fmt::Display) -> AppError {
    AppError::new(AppErrorCode::IoError, format!("The {what} folder is unavailable.")).with_details(e.to_string())
}

/// The app's data folder.
pub fn data_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    match portable_root() {
        Some(root) => Ok(root.join("Data")),
        None => app.path().app_data_dir().map_err(|e| unavailable("app data", e)),
    }
}

/// Where generated reports go.
pub fn reports_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    match portable_root() {
        Some(root) => Ok(root.join("Reports")),
        None => app
            .path()
            .document_dir()
            .or_else(|_| app.path().home_dir())
            .map(|d| d.join("DataManager Pro Reports"))
            .map_err(|e| unavailable("Documents", e)),
    }
}
