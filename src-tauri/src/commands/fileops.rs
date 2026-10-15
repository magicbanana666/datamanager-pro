//! One-shot file operations behind the result tables' actions (Phase 6):
//! deleting selected files (Duplicate Finder, Compare Locations) and
//! saving an export the user picked a location for (reports, CSV,
//! saved comparisons). Copying/moving selected files goes through the
//! transfer engine instead (`start_transfer` with `files`), for its
//! progress, verification and journal.

use super::blocking;
use crate::models::errors::{AppError, AppErrorCode};
use crate::models::transfer::TransferError;
use crate::platform;
use serde::Serialize;
use std::path::Path;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteOutcome {
    pub deleted: Vec<String>,
    pub errors: Vec<TransferError>,
}

/// Deletes files - never folders, so a stale or wrong path can't take a
/// whole tree with it. To the Recycle Bin unless `use_recycle_bin` is
/// false or the location has none (a network share), in which case the
/// file is deleted for good only if `use_recycle_bin` is false;
/// otherwise it's reported as an error and left alone.
#[tauri::command]
pub async fn delete_files(paths: Vec<String>, use_recycle_bin: bool) -> Result<DeleteOutcome, AppError> {
    blocking(move || {
        let mut outcome = DeleteOutcome { deleted: Vec::new(), errors: Vec::new() };
        for path in paths {
            let p = Path::new(&path);
            let result = match std::fs::symlink_metadata(p) {
                Err(_) => Err("the file no longer exists".to_string()),
                Ok(m) if !m.is_file() => Err("not a file".to_string()),
                Ok(_) if use_recycle_bin => platform::current::recycle(p),
                Ok(_) => {
                    platform::current::clear_readonly(p);
                    std::fs::remove_file(p).map_err(|e| e.to_string())
                }
            };
            match result {
                Ok(()) => {
                    tracing::info!(path = %path, recycle = use_recycle_bin, "file deleted");
                    outcome.deleted.push(path);
                }
                Err(message) => outcome.errors.push(TransferError { path, message }),
            }
        }
        Ok(outcome)
    })
    .await
}

/// Writes `contents` to `path` - a location the user just chose in a
/// native save dialog.
#[tauri::command]
pub async fn save_text_file(path: String, contents: String) -> Result<(), AppError> {
    blocking(move || {
        let p = Path::new(&path);
        if !p.is_absolute() || p.parent().is_none_or(|d| !d.is_dir()) {
            return Err(AppError::invalid_path(path.clone(), "Choose a file in an existing folder."));
        }
        if p.is_dir() {
            return Err(AppError::invalid_path(path.clone(), "That is a folder."));
        }
        std::fs::write(p, contents).map_err(|e| {
            AppError::new(AppErrorCode::IoError, format!("Saving failed: {e}")).with_path(path.clone())
        })
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn deletes_files_but_never_folders() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("a.txt");
        std::fs::write(&file, "x").unwrap();
        let folder = dir.path().join("sub");
        std::fs::create_dir(&folder).unwrap();
        let outcome = delete_files(
            vec![
                file.to_string_lossy().into_owned(),
                folder.to_string_lossy().into_owned(),
                dir.path().join("missing").to_string_lossy().into_owned(),
            ],
            false,
        )
        .await
        .unwrap();
        assert_eq!(outcome.deleted.len(), 1);
        assert_eq!(outcome.errors.len(), 2);
        assert!(!file.exists());
        assert!(folder.exists());
    }
}
