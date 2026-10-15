//! Network Analysis commands: connection details, shares, sessions,
//! permissions and read speed. Share contents are scanned with `start_scan`.

use super::blocking;
use crate::models::errors::{AppError, AppErrorCode};
use crate::models::network::{
    AccessRightEntry, NetworkSession, NetworkShare, ReadSpeedResult, ShareConnection,
};
use crate::services::network_service;

fn server_of(input: &str) -> Result<String, AppError> {
    network_service::server_name(input)
        .ok_or_else(|| AppError::new(AppErrorCode::InvalidInput, "Enter a server name or a path like \\\\server\\share."))
}

#[tauri::command]
pub async fn get_share_connection(path: String) -> Result<ShareConnection, AppError> {
    network_service::connection(&path).await
}

#[tauri::command]
pub async fn list_server_shares(server: String) -> Result<Vec<NetworkShare>, AppError> {
    let server = server_of(&server)?;
    blocking(move || network_service::shares(&server)).await
}

#[tauri::command]
pub async fn list_server_sessions(server: String) -> Result<Vec<NetworkSession>, AppError> {
    let server = server_of(&server)?;
    blocking(move || network_service::sessions(&server)).await
}

#[tauri::command]
pub async fn get_access_rights(path: String) -> Result<Vec<AccessRightEntry>, AppError> {
    blocking(move || network_service::access_rights(&path)).await
}

#[tauri::command]
pub async fn measure_read_speed(path: String) -> Result<ReadSpeedResult, AppError> {
    blocking(move || network_service::read_speed(&path)).await
}
