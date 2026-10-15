//! Tauri commands for Phase 9 reports. Reports are written to
//! `Documents\DataManager Pro Reports`; an index in the app data folder
//! (`reports\index.json`) backs the Recent Reports list.

use super::blocking;
use crate::models::errors::{AppError, AppErrorCode};
use crate::models::reports::{ReportRecord, ReportRequest};
use crate::services::report_service;
use chrono::Local;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

use crate::app_paths::reports_dir;

fn index_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    crate::app_paths::data_dir(app).map(|d| d.join("reports").join("index.json"))
}

fn read_index(path: &Path) -> Vec<ReportRecord> {
    std::fs::read(path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn write_index(path: &Path, records: &[ReportRecord]) -> Result<(), AppError> {
    let io = |e: std::io::Error| AppError::new(AppErrorCode::IoError, format!("Saving the report list failed: {e}"));
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(io)?;
    }
    std::fs::write(path, serde_json::to_vec_pretty(records).unwrap_or_default()).map_err(io)
}

#[tauri::command]
pub async fn generate_report(app: AppHandle, request: ReportRequest) -> Result<ReportRecord, AppError> {
    let dir = match request.output_dir.as_deref().map(str::trim).filter(|d| !d.is_empty()) {
        Some(custom) => std::path::PathBuf::from(custom),
        None => reports_dir(&app)?,
    };
    let index = index_path(&app)?;
    blocking(move || {
        std::fs::create_dir_all(&dir)
            .map_err(|e| AppError::new(AppErrorCode::IoError, format!("Creating {} failed: {e}", dir.display())))?;
        let now = Local::now();
        let stem = format!("{}_{}", report_service::file_stem(&request.document.title), now.format("%Y-%m-%d_%H%M%S"));
        let path = dir.join(format!("{stem}.{}", request.format.extension()));
        let generated_at = now.format("%Y-%m-%d %H:%M").to_string();
        report_service::write(&request, &path, &generated_at)
            .map_err(|e| AppError::new(AppErrorCode::IoError, e).with_path(path.to_string_lossy().into_owned()))?;
        let record = ReportRecord {
            id: stem.clone(),
            name: path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or(stem),
            category: request.document.category.clone(),
            date_created: now.to_rfc3339_opts(chrono::SecondsFormat::Secs, false),
            size: std::fs::metadata(&path).map_or(0, |m| m.len()),
            description: request.description.clone(),
            path: path.to_string_lossy().into_owned(),
            format: request.format,
        };
        let mut records = read_index(&index);
        records.insert(0, record.clone());
        write_index(&index, &records)?;
        tracing::info!(path = %record.path, "report generated");
        Ok(record)
    })
    .await
}

/// The report as HTML, for the in-app preview.
#[tauri::command]
pub fn preview_report(request: ReportRequest) -> String {
    report_service::render_html(&request, &Local::now().format("%Y-%m-%d %H:%M").to_string())
}

/// Recent reports whose files still exist, newest first.
#[tauri::command]
pub fn list_reports(app: AppHandle) -> Result<Vec<ReportRecord>, AppError> {
    let index = index_path(&app)?;
    let records = read_index(&index);
    let existing: Vec<ReportRecord> = records.iter().filter(|r| Path::new(&r.path).is_file()).cloned().collect();
    if existing.len() != records.len() {
        write_index(&index, &existing)?;
    }
    Ok(existing)
}

#[tauri::command]
pub fn delete_report(app: AppHandle, id: String) -> Result<(), AppError> {
    let index = index_path(&app)?;
    let mut records = read_index(&index);
    if let Some(record) = records.iter().find(|r| r.id == id) {
        let path = Path::new(&record.path);
        if path.is_file() {
            crate::platform::current::recycle(path)
                .or_else(|_| std::fs::remove_file(path).map_err(|e| e.to_string()))
                .map_err(|e| AppError::new(AppErrorCode::IoError, format!("Deleting the report failed: {e}")))?;
        }
    }
    records.retain(|r| r.id != id);
    write_index(&index, &records)
}

/// Copies a report to a location the user picked ("Save as").
#[tauri::command]
pub async fn export_report(app: AppHandle, id: String, destination: String) -> Result<(), AppError> {
    let index = index_path(&app)?;
    blocking(move || {
        let record = read_index(&index)
            .into_iter()
            .find(|r| r.id == id)
            .ok_or_else(|| AppError::new(AppErrorCode::PathNotFound, "That report no longer exists."))?;
        std::fs::copy(&record.path, &destination)
            .map(|_| ())
            .map_err(|e| AppError::new(AppErrorCode::IoError, format!("Saving a copy failed: {e}")).with_path(destination.clone()))
    })
    .await
}

/// The reports folder (created if needed), for "Open Report Folder".
#[tauri::command]
pub fn reports_folder(app: AppHandle) -> Result<String, AppError> {
    let dir = reports_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| AppError::new(AppErrorCode::IoError, e.to_string()))?;
    Ok(dir.to_string_lossy().into_owned())
}
