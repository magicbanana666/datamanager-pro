//! Storage volume enumeration command.

use super::blocking;
use crate::models::errors::AppError;
use crate::models::storage::StorageVolume;
use crate::services::storage_service;

#[tauri::command]
pub async fn list_storage_volumes(
    force_refresh: Option<bool>,
) -> Result<Vec<StorageVolume>, AppError> {
    let force_refresh = force_refresh.unwrap_or(false);
    tracing::info!(force_refresh, "list_storage_volumes");
    blocking(move || storage_service::list_volumes(force_refresh)).await
}
