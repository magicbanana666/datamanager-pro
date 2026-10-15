//! Phase 10 diagnostics: a log file per run, crash reports, and
//! frontend errors written to the same log.
//!
//! - `logs\datamanager-<time>.log` - everything `tracing` logs (the 10
//!   newest are kept). Set before the Tauri app exists, so the folder is
//!   computed the way Tauri does (`%APPDATA%\<identifier>`), or the
//!   portable `Data\` folder.
//! - `crashes\crash-<time>.txt` - written by the panic hook (message,
//!   location, backtrace) before the process aborts. The next start
//!   offers to show it (`take_crash_reports`).

use crate::models::errors::{AppError, AppErrorCode};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tracing_subscriber::prelude::*;

/// `identifier` in tauri.conf.json - Tauri's app data folder name.
const IDENTIFIER: &str = "xyz.vanhulle.datamanagerpro";
const KEEP_LOGS: usize = 10;

/// The data folder, before (or without) an `AppHandle`. Matches
/// `app_paths::data_dir`.
pub fn early_data_dir() -> Option<PathBuf> {
    if let Some(root) = crate::app_paths::portable_root() {
        return Some(root.join("Data"));
    }
    std::env::var_os("APPDATA").map(|d| PathBuf::from(d).join(IDENTIFIER))
}

pub fn logs_dir() -> Option<PathBuf> {
    early_data_dir().map(|d| d.join("logs"))
}

fn crashes_dir() -> Option<PathBuf> {
    early_data_dir().map(|d| d.join("crashes"))
}

fn stamp() -> String {
    chrono::Local::now().format("%Y-%m-%d_%H%M%S").to_string()
}

/// Deletes all but the `keep` newest `*.log` files in `dir`.
fn prune_logs(dir: &Path, keep: usize) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    let mut logs: Vec<PathBuf> = entries
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|e| e == "log") && p.file_name().is_some_and(|n| n.to_string_lossy().starts_with("datamanager-")))
        .collect();
    logs.sort();
    let excess = logs.len().saturating_sub(keep);
    for old in &logs[..excess] {
        let _ = fs::remove_file(old);
    }
}

/// Sets up logging to stdout and a log file, and the panic hook.
type FilterHandle = tracing_subscriber::reload::Handle<tracing_subscriber::EnvFilter, tracing_subscriber::Registry>;

/// Lets Settings > Advanced > Log level change the filter at runtime.
static FILTER: std::sync::OnceLock<FilterHandle> = std::sync::OnceLock::new();

const LOG_LEVELS: [&str; 5] = ["error", "warn", "info", "debug", "trace"];

fn level_file() -> Option<PathBuf> {
    early_data_dir().map(|d| d.join("log-level.txt"))
}

/// `RUST_LOG` wins; otherwise the level saved from Settings, else info.
fn initial_filter() -> tracing_subscriber::EnvFilter {
    if let Ok(filter) = tracing_subscriber::EnvFilter::try_from_default_env() {
        return filter;
    }
    let saved = level_file()
        .and_then(|p| fs::read_to_string(p).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| LOG_LEVELS.contains(&s.as_str()));
    tracing_subscriber::EnvFilter::new(saved.as_deref().unwrap_or("info"))
}

pub fn init() {
    let file = logs_dir().and_then(|dir| {
        fs::create_dir_all(&dir).ok()?;
        prune_logs(&dir, KEEP_LOGS - 1);
        fs::File::create(dir.join(format!("datamanager-{}.log", stamp()))).ok()
    });
    let (filter, handle) = tracing_subscriber::reload::Layer::new(initial_filter());
    let _ = FILTER.set(handle);
    let file_layer = file.map(|file| {
        tracing_subscriber::fmt::layer()
            .with_ansi(false)
            .with_writer(Mutex::new(file))
    });
    tracing_subscriber::registry()
        .with(filter)
        .with(tracing_subscriber::fmt::layer())
        .with(file_layer)
        .init();

    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let backtrace = std::backtrace::Backtrace::force_capture();
        let location = info.location().map(|l| format!("{}:{}", l.file(), l.line())).unwrap_or_default();
        let message = info
            .payload()
            .downcast_ref::<&str>()
            .map(|s| s.to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "(no message)".into());
        tracing::error!(%message, %location, "panic");
        if let Some(dir) = crashes_dir() {
            let report = format!(
                "DataManager Pro {} crash report\nTime: {}\nOS: {}\nThread: {}\nMessage: {message}\nLocation: {location}\n\nBacktrace:\n{backtrace}\n",
                env!("CARGO_PKG_VERSION"),
                chrono::Local::now().to_rfc3339(),
                std::env::consts::OS,
                std::thread::current().name().unwrap_or("?"),
            );
            if fs::create_dir_all(&dir).is_ok() {
                let _ = fs::write(dir.join(format!("crash-{}.txt", stamp())), report);
            }
        }
        previous(info);
    }));
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrashReport {
    pub path: String,
    pub file_name: String,
    /// The panic message line.
    pub summary: String,
}

/// Crash reports not yet shown to the user.
#[tauri::command]
pub fn take_crash_reports() -> Vec<CrashReport> {
    let Some(dir) = crashes_dir() else { return Vec::new() };
    let Ok(entries) = fs::read_dir(&dir) else { return Vec::new() };
    let mut reports: Vec<CrashReport> = entries
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|e| e == "txt"))
        .map(|p| {
            let summary = fs::read_to_string(&p)
                .ok()
                .and_then(|t| t.lines().find_map(|l| l.strip_prefix("Message: ").map(str::to_string)))
                .unwrap_or_default();
            CrashReport {
                file_name: p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
                path: p.to_string_lossy().into_owned(),
                summary,
            }
        })
        .collect();
    reports.sort_by(|a, b| b.file_name.cmp(&a.file_name));
    reports
}

/// Moves shown crash reports to `crashes\seen\`, so they're offered once.
#[tauri::command]
pub fn dismiss_crash_reports() {
    let Some(dir) = crashes_dir() else { return };
    let seen = dir.join("seen");
    let _ = fs::create_dir_all(&seen);
    if let Ok(entries) = fs::read_dir(&dir) {
        for path in entries.filter_map(Result::ok).map(|e| e.path()).filter(|p| p.is_file()) {
            if let Some(name) = path.file_name() {
                let _ = fs::rename(&path, seen.join(name));
            }
        }
    }
}

/// An uncaught error in the webview, recorded in the log.
#[tauri::command]
pub fn log_frontend_error(message: String, stack: Option<String>) {
    let message: String = message.chars().take(2_000).collect();
    let stack: String = stack.unwrap_or_default().chars().take(8_000).collect();
    tracing::error!(%message, %stack, "frontend error");
}

/// Applies a log level now and keeps it for the next start.
#[tauri::command]
pub fn set_log_level(level: String) -> Result<(), AppError> {
    if !LOG_LEVELS.contains(&level.as_str()) {
        return Err(AppError::new(AppErrorCode::InvalidInput, "Unknown log level."));
    }
    if let Some(handle) = FILTER.get() {
        handle
            .reload(tracing_subscriber::EnvFilter::new(&level))
            .map_err(|e| AppError::new(AppErrorCode::Unknown, e.to_string()))?;
    }
    if let Some(path) = level_file() {
        let _ = fs::write(path, &level);
    }
    tracing::info!(level = %level, "log level changed");
    Ok(())
}

#[tauri::command]
pub fn logs_folder() -> Result<String, AppError> {
    let dir = logs_dir().ok_or_else(|| AppError::new(AppErrorCode::IoError, "The logs folder is unavailable."))?;
    fs::create_dir_all(&dir).map_err(|e| AppError::new(AppErrorCode::IoError, e.to_string()))?;
    Ok(dir.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prunes_old_logs_only() {
        let dir = tempfile::tempdir().unwrap();
        for i in 0..5 {
            fs::write(dir.path().join(format!("datamanager-2026-01-0{i}.log")), "x").unwrap();
        }
        fs::write(dir.path().join("other.log"), "x").unwrap();
        prune_logs(dir.path(), 2);
        let mut left: Vec<String> = fs::read_dir(dir.path()).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        left.sort();
        assert_eq!(left, ["datamanager-2026-01-03.log", "datamanager-2026-01-04.log", "other.log"]);
    }
}
