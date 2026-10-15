//! Folder browsing commands. Blocking I/O runs on the blocking pool.

use super::blocking;
use crate::models::errors::AppError;
use crate::models::filesystem::{
    DirectoryListing, DirectorySummary, FileMetadata, FolderMetadata, ListDirectoryOptions,
    PathValidation,
};
use crate::services::{filesystem_service, path_service};

#[tauri::command]
pub async fn validate_path(path: String) -> Result<PathValidation, AppError> {
    tracing::info!(%path, "validate_path");
    blocking(move || Ok(path_service::validate(&path))).await
}

#[tauri::command]
pub async fn list_directory(
    path: String,
    options: Option<ListDirectoryOptions>,
) -> Result<DirectoryListing, AppError> {
    tracing::info!(%path, "list_directory");
    let options = options.unwrap_or_default();
    blocking(move || filesystem_service::list_directory(&path, options)).await
}

#[tauri::command]
pub async fn get_directory_summary(path: String) -> Result<DirectorySummary, AppError> {
    tracing::info!(%path, "get_directory_summary");
    let summary = blocking(move || filesystem_service::get_directory_summary(&path)).await?;
    tracing::debug!(
        direct_files = summary.direct_file_count,
        direct_folders = summary.direct_folder_count,
        direct_size = %crate::utils::size::format_bytes(summary.direct_file_bytes),
        "directory summary computed"
    );
    Ok(summary)
}

#[tauri::command]
pub async fn get_file_metadata(path: String) -> Result<FileMetadata, AppError> {
    tracing::info!(%path, "get_file_metadata");
    blocking(move || filesystem_service::get_file_metadata(&path)).await
}

#[tauri::command]
pub async fn get_folder_metadata(path: String) -> Result<FolderMetadata, AppError> {
    tracing::info!(%path, "get_folder_metadata");
    blocking(move || filesystem_service::get_folder_metadata(&path)).await
}
