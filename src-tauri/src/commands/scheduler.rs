//! The Phase 9 scheduler: an in-app runner, not Windows Task Scheduler.
//! Tasks only run **while DataManager Pro is open** (the Scheduler page
//! says so). Every 20 s the runner starts enabled tasks whose next run
//! has come; at startup, runs missed while the app was closed are either
//! run once or recorded as missed (a setting).
//!
//! Sync/Copy/Move/Mirror tasks run through the transfer engine
//! (`transfer::run_headless`: journaled, resumable, cancellable with
//! `cancel_transfer`, progress under the task's job id); Analyze tasks
//! run the scan engine. Every change is persisted and announced with a
//! `scheduler-changed` event; a finished run also emits
//! `scheduler-run-finished`.

use crate::models::errors::{AppError, AppErrorCode};
use crate::models::scan::{ScanOptions, ScanProgressState};
use crate::models::scheduler::{
    ScheduledTask, ScheduledTaskType, SchedulerData, SchedulerSettings, TaskRunHistoryEntry,
    TaskRunStatus,
};
use crate::services::{scan_service, scheduler_service};
use chrono::Local;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

const TICK: Duration = Duration::from_secs(20);

pub struct SchedulerStore {
    data: Mutex<SchedulerData>,
    path: PathBuf,
    logs: PathBuf,
}

impl SchedulerStore {
    pub fn load(app: &AppHandle) -> Self {
        let base = app.path().app_data_dir().unwrap_or_else(|_| std::env::temp_dir().join("DataManagerPro"));
        let path = base.join("scheduler").join("tasks.json");
        Self {
            data: Mutex::new(scheduler_service::load(&path)),
            path,
            logs: base.join("logs"),
        }
    }

    fn update<T>(&self, app: &AppHandle, f: impl FnOnce(&mut SchedulerData) -> T) -> T {
        let mut data = self.data.lock().unwrap();
        let out = f(&mut data);
        if let Err(e) = scheduler_service::save(&self.path, &data) {
            tracing::error!(error = %e, "saving the scheduler failed");
        }
        drop(data);
        let _ = app.emit("scheduler-changed", ());
        out
    }
}

fn new_id(prefix: &str) -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_nanos());
    format!("{prefix}-{:012x}", xxhash_rust::xxh3::xxh3_64(&nanos.to_le_bytes()) & 0xffff_ffff_ffff)
}

fn refresh_next_run(task: &mut ScheduledTask) {
    task.next_run = if task.enabled {
        scheduler_service::next_run(&task.schedule, Local::now()).map(scheduler_service::to_iso)
    } else {
        None
    };
}

#[tauri::command]
pub fn get_scheduler(app: AppHandle) -> SchedulerData {
    app.state::<SchedulerStore>().data.lock().unwrap().clone()
}

#[tauri::command]
pub fn save_scheduled_task(app: AppHandle, mut task: ScheduledTask) -> Result<ScheduledTask, AppError> {
    task.name = task.name.trim().to_string();
    if task.name.is_empty() {
        return Err(AppError::new(AppErrorCode::InvalidInput, "Give the task a name."));
    }
    if task.source.trim().is_empty() {
        return Err(AppError::new(AppErrorCode::InvalidInput, "Choose a source folder."));
    }
    if task.kind != ScheduledTaskType::Analyze && task.destination.trim().is_empty() {
        return Err(AppError::new(AppErrorCode::InvalidInput, "Choose a destination folder."));
    }
    if scheduler_service::next_run(&task.schedule, Local::now() - chrono::Duration::days(3650)).is_none() {
        return Err(AppError::new(AppErrorCode::InvalidInput, "The schedule's time or date is invalid."));
    }
    if task.id.is_empty() {
        task.id = new_id("task");
    }
    refresh_next_run(&mut task);
    let store = app.state::<SchedulerStore>();
    let saved = task.clone();
    store.update(&app, move |data| {
        match data.tasks.iter_mut().find(|t| t.id == task.id) {
            Some(existing) => {
                // Run state belongs to the backend.
                task.last_run = existing.last_run.take();
                task.last_run_status = existing.last_run_status;
                task.running_job = existing.running_job.take();
                *existing = task;
            }
            None => data.tasks.push(task),
        }
    });
    Ok(saved)
}

#[tauri::command]
pub fn delete_scheduled_task(app: AppHandle, id: String) {
    app.state::<SchedulerStore>().update(&app, |data| data.tasks.retain(|t| t.id != id));
}

#[tauri::command]
pub fn set_task_enabled(app: AppHandle, id: String, enabled: bool) {
    app.state::<SchedulerStore>().update(&app, |data| {
        if let Some(task) = data.tasks.iter_mut().find(|t| t.id == id) {
            task.enabled = enabled;
            refresh_next_run(task);
        }
    });
}

#[tauri::command]
pub fn update_scheduler_settings(app: AppHandle, settings: SchedulerSettings) {
    app.state::<SchedulerStore>().update(&app, |data| data.settings = settings);
}

#[tauri::command]
pub fn clear_task_history(app: AppHandle) {
    app.state::<SchedulerStore>().update(&app, |data| data.history.clear());
}

#[tauri::command]
pub fn run_task_now(app: AppHandle, id: String) -> Result<String, AppError> {
    begin_run(&app, &id, false)
        .ok_or_else(|| AppError::new(AppErrorCode::InvalidInput, "This task is already running or no longer exists."))
}

/// Marks the task as running, schedules its next run and starts it.
/// Returns the run's job id.
fn begin_run(app: &AppHandle, id: &str, scheduled: bool) -> Option<String> {
    let job_id = new_id("sched");
    let task = app.state::<SchedulerStore>().update(app, |data| {
        let task = data.tasks.iter_mut().find(|t| t.id == id && t.running_job.is_none())?;
        task.running_job = Some(job_id.clone());
        task.last_run = Some(scheduler_service::to_iso(Local::now()));
        if scheduled {
            if task.schedule.frequency == crate::models::scheduler::ScheduleFrequency::Once {
                task.enabled = false;
            }
            refresh_next_run(task);
        }
        Some(task.clone())
    })?;
    tracing::info!(task = %task.name, job_id = %job_id, scheduled, "scheduled task starting");
    let app = app.clone();
    let job = job_id.clone();
    tauri::async_runtime::spawn(async move { execute_task(app, task, job).await });
    Some(job_id)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RunFinished {
    task_name: String,
    status: TaskRunStatus,
    details: String,
}

/// Locked/in-use files: sharing (32) and lock (33) violations.
fn is_in_use(message: &str) -> bool {
    message.contains("os error 32") || message.contains("os error 33")
}

async fn execute_task(app: AppHandle, task: ScheduledTask, job_id: String) {
    let started = Instant::now();
    let date_time = scheduler_service::to_iso(Local::now());
    let (status, details, files, size, log) = match scheduler_service::transfer_request(&task) {
        Some(request) => {
            let (result, log) =
                super::transfer::run_headless(&app, &job_id, request, task.options.log_all_operations).await;
            match result {
                Ok(Some(report)) => {
                    let in_use_only = report.error_count > 0
                        && report.errors.len() as u64 == report.error_count
                        && report.errors.iter().all(|e| is_in_use(&e.message));
                    let ok = report.error_count == 0 || (task.options.skip_files_in_use && in_use_only);
                    let mut details = format!(
                        "{} files copied ({}), {} deleted",
                        report.files_copied,
                        crate::utils::size::format_bytes(report.bytes_copied),
                        report.files_deleted
                    );
                    if report.error_count > 0 {
                        details.push_str(&format!(
                            ", {} {}",
                            report.error_count,
                            if ok { "in use (skipped)" } else { "errors" }
                        ));
                    }
                    let status = if ok { TaskRunStatus::Success } else { TaskRunStatus::Failed };
                    (status, details, Some(report.files_copied), Some(report.bytes_copied), log)
                }
                Ok(None) => (TaskRunStatus::Cancelled, "Stopped - can be resumed from Data Transfer.".into(), None, None, log),
                Err(e) => (TaskRunStatus::Failed, e.message, None, None, log),
            }
        }
        None => {
            let source = task.source.clone();
            let scan = tokio::task::spawn_blocking(move || {
                let state = ScanProgressState::new();
                let options = ScanOptions { show_hidden: true, show_system: true };
                let (root, engine) = scan_service::run_scan(&source, options, &state);
                (root, engine, state.take_skipped().len())
            })
            .await;
            match scan {
                Ok((root, engine, skipped)) if std::path::Path::new(&task.source).is_dir() => (
                    TaskRunStatus::Success,
                    format!(
                        "{} files, {} folders, {} ({:?} engine{})",
                        root.file_count,
                        root.folder_count,
                        crate::utils::size::format_bytes(root.size),
                        engine,
                        if skipped > 0 { format!(", {skipped} unreadable") } else { String::new() }
                    ),
                    Some(root.file_count),
                    Some(root.size),
                    Vec::new(),
                ),
                Ok(_) => (TaskRunStatus::Failed, format!("{} is not an accessible folder.", task.source), None, None, Vec::new()),
                Err(_) => (TaskRunStatus::Failed, "The scan failed unexpectedly.".into(), None, None, Vec::new()),
            }
        }
    };

    let store = app.state::<SchedulerStore>();
    let log_path = (task.options.log_all_operations && !log.is_empty())
        .then(|| {
            let path = store.logs.join(format!("{job_id}.log"));
            std::fs::create_dir_all(&store.logs).ok()?;
            std::fs::write(&path, log.join("\r\n")).ok()?;
            Some(path.to_string_lossy().into_owned())
        })
        .flatten();
    let entry = TaskRunHistoryEntry {
        id: job_id.clone(),
        task_id: task.id.clone(),
        task_name: task.name.clone(),
        date_time,
        status,
        details: details.clone(),
        files,
        size,
        duration_seconds: started.elapsed().as_secs_f64(),
        log_path,
    };
    tracing::info!(task = %task.name, status = ?status, details = %details, "scheduled task finished");
    store.update(&app, |data| {
        if let Some(t) = data.tasks.iter_mut().find(|t| t.id == task.id) {
            t.running_job = None;
            t.last_run_status = Some(status);
        }
        data.history.insert(0, entry);
        let limit = data.settings.history_limit.max(10) as usize;
        data.history.truncate(limit);
    });
    let _ = app.emit("scheduler-run-finished", &RunFinished { task_name: task.name, status, details });
}

/// Startup housekeeping, then the 20 s loop.
pub fn start_runner(app: AppHandle) {
    let now = Local::now();
    app.state::<SchedulerStore>().update(&app, |data| {
        let run_missed = data.settings.run_missed_on_startup;
        let mut missed = Vec::new();
        for task in data.tasks.iter_mut() {
            // A run the previous session didn't finish: its journal (if
            // any) is under Interrupted Transfers.
            task.running_job = None;
            let due = task.enabled
                && task.next_run.as_deref().and_then(scheduler_service::parse_iso).is_some_and(|t| t <= now);
            if due && !run_missed {
                missed.push(TaskRunHistoryEntry {
                    id: new_id("missed"),
                    task_id: task.id.clone(),
                    task_name: task.name.clone(),
                    date_time: task.next_run.clone().unwrap_or_default(),
                    status: TaskRunStatus::Missed,
                    details: "DataManager Pro wasn't running at the scheduled time.".into(),
                    files: None,
                    size: None,
                    duration_seconds: 0.0,
                    log_path: None,
                });
                task.last_run_status = Some(TaskRunStatus::Missed);
                refresh_next_run(task);
            } else if !due {
                refresh_next_run(task);
            }
        }
        for entry in missed {
            data.history.insert(0, entry);
        }
    });

    tauri::async_runtime::spawn(async move {
        loop {
            let now = Local::now();
            let due: Vec<String> = app
                .state::<SchedulerStore>()
                .data
                .lock()
                .unwrap()
                .tasks
                .iter()
                .filter(|t| t.enabled && t.running_job.is_none())
                .filter(|t| t.next_run.as_deref().and_then(scheduler_service::parse_iso).is_some_and(|n| n <= now))
                .map(|t| t.id.clone())
                .collect();
            for id in due {
                begin_run(&app, &id, true);
            }
            tokio::time::sleep(TICK).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognises_in_use_errors() {
        assert!(is_in_use("opening the source: The process cannot access the file (os error 32)"));
        assert!(!is_in_use("Access is denied. (os error 5)"));
    }
}
