//! Tauri commands for the Phase 6/7 transfer engine (Data Transfer and
//! Sync / Incremental). A job is identified by a frontend-generated id
//! and streams:
//!
//! - `transfer-progress` - roughly every 150ms while analyzing/executing.
//! - `transfer-planned` - once analysis is done, carrying the plan.
//! - `transfer-complete` - once execution is done, carrying the report.
//! - `transfer-cancelled` - instead, after `cancel_transfer`
//!   (`resumable: true` when a journal was kept).
//! - `transfer-error` - a failed pre-flight check or a task panic.
//!
//! `start_transfer` analyzes and, with `execute: true`, carries the plan
//! out straight away; otherwise the plan waits in the registry for
//! `execute_transfer` (with the user's per-item overrides) or
//! `discard_transfer`.

use crate::models::errors::{AppError, AppErrorCode};
use crate::models::transfer::{
    InterruptedTransfer, ItemOverride, PlanAction, PlanItem, PlanSummary, TransferMode,
    TransferPhase, TransferPlan, TransferProgress, TransferReport, TransferRequest,
    TransferState, MAX_PLAN_ROWS,
};
use crate::services::transfer_journal::{self, Journal, JournalHeader, JournalProgress};
use crate::services::{path_service, sync_state, transfer_service};
use crate::utils::time::system_time_to_iso8601;
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

struct Job {
    state: Arc<TransferState>,
    /// Set once analysis is done, until execution takes it.
    plan: Mutex<Option<(TransferRequest, Vec<PlanItem>, PlanSummary)>>,
}

/// Every transfer that is analyzing, planned (waiting for
/// `execute_transfer`) or executing.
#[derive(Default)]
pub struct TransferRegistry {
    jobs: Mutex<HashMap<String, Arc<Job>>>,
}

impl TransferRegistry {
    fn get(&self, id: &str) -> Option<Arc<Job>> {
        self.jobs.lock().unwrap().get(id).cloned()
    }

    fn insert(&self, id: &str) -> Arc<Job> {
        let job = Arc::new(Job {
            state: Arc::new(TransferState::new()),
            plan: Mutex::new(None),
        });
        self.jobs.lock().unwrap().insert(id.to_string(), job.clone());
        job
    }

    fn remove(&self, id: &str) {
        self.jobs.lock().unwrap().remove(id);
    }

    fn contains(&self, id: &str) -> bool {
        self.jobs.lock().unwrap().contains_key(id)
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CancelledTransferPayload<'a> {
    job_id: &'a str,
    resumable: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TransferErrorPayload<'a> {
    job_id: &'a str,
    error: AppError,
}

fn data_dir(app: &AppHandle, sub: &str) -> Result<PathBuf, AppError> {
    app.path()
        .app_data_dir()
        .map(|d| d.join(sub))
        .map_err(|e| AppError::new(AppErrorCode::IoError, "The app data folder is unavailable.").with_details(e.to_string()))
}

fn emit_error(app: &AppHandle, job_id: &str, error: AppError) {
    let _ = app.emit("transfer-error", &TransferErrorPayload { job_id, error });
}

fn check_job_id(job_id: &str) -> Result<(), AppError> {
    if transfer_journal::is_valid_job_id(job_id) {
        Ok(())
    } else {
        Err(AppError::new(AppErrorCode::InvalidInput, "Invalid transfer id."))
    }
}

fn is_inside(child: &str, parent: &str) -> bool {
    let (c, p) = (child.to_lowercase(), parent.trim_end_matches('\\').to_lowercase());
    c == p || c.starts_with(&format!("{p}\\"))
}

/// Normalizes and checks the request's locations.
fn validate(mut request: TransferRequest) -> Result<TransferRequest, AppError> {
    let destination = path_service::validate(&request.destination);
    let dest_path = destination
        .normalized_path
        .clone()
        .filter(|p| !p.is_empty())
        .ok_or_else(|| AppError::invalid_path(request.destination.clone(), "Choose a destination folder."))?;
    if destination.exists && !destination.is_directory {
        return Err(AppError::invalid_path(dest_path, "The destination is a file, not a folder."));
    }
    if !destination.exists && !request.options.create_missing_folders {
        return Err(AppError::invalid_path(
            dest_path,
            "The destination folder doesn't exist - tick \"Create missing folders\" to create it.",
        ));
    }
    request.destination = dest_path;

    if let Some(files) = &request.files {
        if files.is_empty() {
            return Err(AppError::new(AppErrorCode::InvalidInput, "No files selected."));
        }
        if !matches!(request.mode, TransferMode::Copy | TransferMode::Move) {
            return Err(AppError::new(AppErrorCode::InvalidInput, "Selected files can only be copied or moved."));
        }
        return Ok(request);
    }

    let source = super::duplicates::validate_folders(vec![request.source.clone()])?.remove(0);
    if is_inside(&request.destination, &source) || is_inside(&source, &request.destination) {
        return Err(AppError::new(
            AppErrorCode::InvalidPath,
            "The source and destination can't be the same folder or inside each other.",
        ));
    }
    request.source = source;
    Ok(request)
}

#[tauri::command]
pub async fn start_transfer(
    app: AppHandle,
    job_id: String,
    request: TransferRequest,
    execute: bool,
) -> Result<(), AppError> {
    check_job_id(&job_id)?;
    let request = validate(request)?;
    let sync_dir = data_dir(&app, "sync-state")?;
    let job = app.state::<TransferRegistry>().insert(&job_id);
    tracing::info!(job_id = %job_id, source = %request.source, destination = %request.destination, mode = ?request.mode, "transfer starting");
    tauri::async_runtime::spawn(async move {
        let started = Instant::now();
        let state = job.state.clone();
        let req = request.clone();
        let outcome = with_progress(&app, &job_id, state.clone(), move || {
            let previous = (req.mode == TransferMode::TwoWay)
                .then(|| sync_state::load(&sync_dir, &req.source, &req.destination))
                .flatten();
            transfer_service::analyze(&req, previous.as_ref(), &state)
        })
        .await;
        let plan = match outcome {
            Err(_) => {
                app.state::<TransferRegistry>().remove(&job_id);
                emit_error(&app, &job_id, AppError::new(AppErrorCode::Unknown, "An unexpected internal error occurred while analyzing."));
                return;
            }
            Ok(_) if job.state.is_cancelled() => {
                app.state::<TransferRegistry>().remove(&job_id);
                let _ = app.emit("transfer-cancelled", &CancelledTransferPayload { job_id: &job_id, resumable: false });
                return;
            }
            Ok(plan) => plan,
        };
        job.state.set_phase(TransferPhase::Planned);
        let _ = app.emit(
            "transfer-planned",
            &TransferPlan {
                job_id: job_id.clone(),
                summary: plan.summary.clone(),
                rows: plan.items.iter().take(MAX_PLAN_ROWS).cloned().collect(),
                total_items: plan.items.len() as u64,
                elapsed_ms: started.elapsed().as_millis() as u64,
                skipped: job.state.scan.take_skipped(),
            },
        );
        if execute {
            let work = plan.items.into_iter().filter(|i| i.action.is_work()).collect();
            run_execution(app, job_id, job, request, work, plan.summary, None).await;
        } else {
            *job.plan.lock().unwrap() = Some((request, plan.items, plan.summary));
        }
    });
    Ok(())
}

/// Executes a planned job, applying the user's per-item decisions.
#[tauri::command]
pub async fn execute_transfer(app: AppHandle, job_id: String, overrides: Vec<ItemOverride>) -> Result<(), AppError> {
    let job = app
        .state::<TransferRegistry>()
        .get(&job_id)
        .ok_or_else(|| AppError::new(AppErrorCode::InvalidInput, "This transfer is no longer available - analyze again."))?;
    let (request, items, summary) = job
        .plan
        .lock()
        .unwrap()
        .take()
        .ok_or_else(|| AppError::new(AppErrorCode::InvalidInput, "This transfer is already running."))?;
    let overrides: HashMap<u32, &ItemOverride> = overrides.iter().map(|o| (o.id, o)).collect();
    let work: Vec<PlanItem> = items
        .into_iter()
        .filter_map(|mut item| {
            if let Some(o) = overrides.get(&item.id) {
                if !o.included {
                    return None;
                }
                if let Some(action) = o.action {
                    item = resolve(item, action);
                }
            }
            item.action.is_work().then_some(item)
        })
        .collect();
    tauri::async_runtime::spawn(run_execution(app, job_id, job, request, work, summary, None));
    Ok(())
}

/// A conflict (or any item) redirected by the user: the size follows the
/// copy that's being transferred.
fn resolve(mut item: PlanItem, action: PlanAction) -> PlanItem {
    item.action = action;
    if matches!(action, PlanAction::CopyBack | PlanAction::UpdateBack) {
        if let Ok(m) = std::fs::metadata(&item.dest_path) {
            item.size = m.len();
        }
    } else if action.copies() {
        if let Ok(m) = std::fs::metadata(&item.source_path) {
            item.size = m.len();
        }
    }
    item
}

#[tauri::command]
pub fn set_transfer_paused(app: AppHandle, job_id: String, paused: bool) -> Result<(), AppError> {
    if let Some(job) = app.state::<TransferRegistry>().get(&job_id) {
        job.state.set_paused(paused);
        job.state.log(if paused { "Paused." } else { "Resumed." });
    }
    Ok(())
}

#[tauri::command]
pub fn cancel_transfer(app: AppHandle, job_id: String) -> Result<(), AppError> {
    let registry = app.state::<TransferRegistry>();
    if let Some(job) = registry.get(&job_id) {
        tracing::info!(job_id = %job_id, "transfer cancellation requested");
        job.state.cancel();
        // A planned job has no task running to report it.
        if job.plan.lock().unwrap().take().is_some() {
            registry.remove(&job_id);
            let _ = app.emit("transfer-cancelled", &CancelledTransferPayload { job_id: &job_id, resumable: false });
        }
    }
    Ok(())
}

#[tauri::command]
pub fn list_interrupted_transfers(app: AppHandle) -> Result<Vec<InterruptedTransfer>, AppError> {
    let dir = data_dir(&app, "journals")?;
    let registry = app.state::<TransferRegistry>();
    Ok(transfer_journal::list(&dir)
        .into_iter()
        .filter(|t| !registry.contains(&t.job_id))
        .collect())
}

#[tauri::command]
pub async fn resume_interrupted_transfer(app: AppHandle, job_id: String) -> Result<(), AppError> {
    check_job_id(&job_id)?;
    if app.state::<TransferRegistry>().contains(&job_id) {
        return Err(AppError::new(AppErrorCode::InvalidInput, "This transfer is already running."));
    }
    let dir = data_dir(&app, "journals")?;
    let (journal, header, progress) = Journal::open(&dir, &job_id).map_err(|e| {
        AppError::new(AppErrorCode::IoError, "The transfer journal could not be read.").with_details(e.to_string())
    })?;
    let job = app.state::<TransferRegistry>().insert(&job_id);
    job.state.log(format!(
        "Resuming {:?} from {} to {} - {} of {} items already done.",
        header.request.mode,
        header.request.source,
        header.request.destination,
        progress.done.len(),
        header.items.len()
    ));
    tracing::info!(job_id = %job_id, done = progress.done.len(), "transfer resuming");
    // The page has no plan for a resumed job yet: send the journaled one,
    // with what's already done marked as such.
    let _ = app.emit(
        "transfer-planned",
        &TransferPlan {
            job_id: job_id.clone(),
            summary: PlanSummary::default(),
            rows: header.items.iter().take(MAX_PLAN_ROWS).cloned().collect(),
            total_items: header.items.len() as u64,
            elapsed_ms: 0,
            skipped: Vec::new(),
        },
    );
    for item in header.items.iter().take(MAX_PLAN_ROWS).filter(|i| progress.done.contains(&i.id)) {
        job.state.push_update(item.id, crate::models::transfer::ItemStatus::Done, None);
    }
    tauri::async_runtime::spawn(run_execution(
        app,
        job_id,
        job,
        header.request,
        header.items,
        PlanSummary::default(),
        Some((journal, progress)),
    ));
    Ok(())
}

#[tauri::command]
pub fn discard_interrupted_transfer(app: AppHandle, job_id: String) -> Result<(), AppError> {
    check_job_id(&job_id)?;
    let dir = data_dir(&app, "journals")?;
    // Partial copies the job left behind.
    if let Ok((journal, header, progress)) = Journal::open(&dir, &job_id) {
        drop(journal);
        for item in header.items.iter().filter(|i| progress.partial.contains_key(&i.id)) {
            let target = match item.action {
                PlanAction::CopyBack | PlanAction::UpdateBack => &item.source_path,
                _ => &item.dest_path,
            };
            let _ = std::fs::remove_file(format!("{target}{}", transfer_service::PART_SUFFIX));
        }
    }
    transfer_journal::discard(&dir, &job_id);
    Ok(())
}

async fn run_execution(
    app: AppHandle,
    job_id: String,
    job: Arc<Job>,
    request: TransferRequest,
    items: Vec<PlanItem>,
    summary: PlanSummary,
    resumed: Option<(Journal, JournalProgress)>,
) {
    let is_resume = resumed.is_some();
    // Pre-flight: refuse rather than fail halfway on a full disk.
    if !is_resume {
        if let Some(free) = summary.dest_free_bytes {
            if summary.net_bytes_needed > free {
                app.state::<TransferRegistry>().remove(&job_id);
                emit_error(
                    &app,
                    &job_id,
                    AppError::new(
                        AppErrorCode::IoError,
                        format!(
                            "Not enough free space at the destination: {} needed, {} available.",
                            crate::utils::size::format_bytes(summary.net_bytes_needed),
                            crate::utils::size::format_bytes(free)
                        ),
                    ),
                );
                return;
            }
        }
    }

    let journal_dir = match data_dir(&app, "journals") {
        Ok(d) => d,
        Err(e) => {
            app.state::<TransferRegistry>().remove(&job_id);
            emit_error(&app, &job_id, e);
            return;
        }
    };
    let (journal, progress) = match resumed {
        Some(r) => r,
        None => {
            let header = JournalHeader {
                job_id: job_id.clone(),
                request: request.clone(),
                started_at: system_time_to_iso8601(std::time::SystemTime::now()).unwrap_or_default(),
                items: items.clone(),
            };
            match Journal::create(&journal_dir, &header) {
                Ok(j) => (j, JournalProgress::default()),
                Err(e) => {
                    app.state::<TransferRegistry>().remove(&job_id);
                    emit_error(
                        &app,
                        &job_id,
                        AppError::new(AppErrorCode::IoError, "The transfer journal could not be written.").with_details(e.to_string()),
                    );
                    return;
                }
            }
        }
    };

    let started = Instant::now();
    let state = job.state.clone();
    state.log(format!(
        "{} {} items from {} to {}.",
        if is_resume { "Resuming" } else { "Starting:" },
        items.len(),
        request.source,
        request.destination
    ));
    let req = request.clone();
    let sync_dir = data_dir(&app, "sync-state").ok();
    let work_state = state.clone();
    let result = with_progress(&app, &job_id, state.clone(), move || {
        let outcome = transfer_service::execute(&req, &items, &journal, &progress, &work_state);
        if !work_state.is_cancelled() {
            if req.mode == TransferMode::TwoWay {
                let snapshot = transfer_service::capture_sync_state(&req, &work_state);
                if let Some(dir) = sync_dir {
                    if let Err(e) = sync_state::save(&dir, &snapshot) {
                        work_state.log(format!("WARNING: saving the sync state failed: {e}"));
                    }
                }
            }
            journal.finish();
        }
        outcome
    })
    .await;
    app.state::<TransferRegistry>().remove(&job_id);

    match result {
        Err(join_err) => {
            tracing::error!(error = %join_err, job_id = %job_id, "transfer task panicked");
            emit_error(&app, &job_id, AppError::new(AppErrorCode::Unknown, "An unexpected internal error occurred during the transfer."));
        }
        Ok(_) if state.is_cancelled() => {
            tracing::info!(job_id = %job_id, "transfer cancelled");
            let _ = app.emit("transfer-cancelled", &CancelledTransferPayload { job_id: &job_id, resumable: true });
        }
        Ok(outcome) => {
            let elapsed_ms = started.elapsed().as_millis() as u64;
            tracing::info!(job_id = %job_id, elapsed_ms, copied = outcome.files_copied, errors = outcome.error_count, "transfer complete");
            let _ = app.emit(
                "transfer-complete",
                &TransferReport {
                    job_id: job_id.clone(),
                    mode: request.mode,
                    source: request.source,
                    destination: request.destination,
                    files_copied: outcome.files_copied,
                    bytes_copied: outcome.bytes_copied,
                    files_deleted: outcome.files_deleted,
                    folders_created: outcome.folders_created,
                    files_skipped: outcome.files_skipped,
                    files_verified: outcome.files_verified,
                    errors: outcome.errors,
                    error_count: outcome.error_count,
                    elapsed_ms,
                    resumed: is_resume,
                },
            );
        }
    }
}

/// Runs `work` on the blocking pool, emitting `transfer-progress` every
/// 150ms (with the speed over the last ~2 seconds) and once more at the
/// end, so the final item updates and log lines aren't lost.
async fn with_progress<T: Send + 'static>(
    app: &AppHandle,
    job_id: &str,
    state: Arc<TransferState>,
    work: impl FnOnce() -> T + Send + 'static,
) -> Result<T, tokio::task::JoinError> {
    use std::sync::atomic::Ordering;
    let started = Instant::now();
    let mut samples: VecDeque<(Instant, u64)> = VecDeque::new();
    let mut emit = |state: &TransferState| {
        let now = Instant::now();
        let bytes = state.bytes_done.load(Ordering::Relaxed);
        samples.push_back((now, bytes));
        while samples.len() > 2 && now.duration_since(samples[0].0) > Duration::from_secs(2) {
            samples.pop_front();
        }
        let speed_bps = match (samples.front(), state.is_paused()) {
            (Some(&(t0, b0)), false) if now > t0 => {
                (bytes.saturating_sub(b0) as f64 / now.duration_since(t0).as_secs_f64()) as u64
            }
            _ => 0,
        };
        let progress = TransferProgress {
            job_id: job_id.to_string(),
            phase: state.phase(),
            paused: state.is_paused(),
            files_found: state.files_found.load(Ordering::Relaxed),
            files_total: state.files_total.load(Ordering::Relaxed),
            files_done: state.files_done.load(Ordering::Relaxed),
            bytes_total: state.bytes_total.load(Ordering::Relaxed),
            bytes_done: bytes,
            speed_bps,
            errors: state.errors.load(Ordering::Relaxed),
            current_file: state.current_file.try_lock().map(|p| p.clone()).unwrap_or_default(),
            elapsed_ms: started.elapsed().as_millis() as u64,
            active: state.active_items(),
            updates: state.take_updates(),
            log: state.take_log(),
        };
        let _ = app.emit("transfer-progress", &progress);
    };

    let mut handle = tokio::task::spawn_blocking(work);
    let mut ticker = tokio::time::interval(Duration::from_millis(150));
    ticker.tick().await;
    let outcome = loop {
        tokio::select! {
            result = &mut handle => break result,
            _ = ticker.tick() => emit(&state),
        }
    };
    emit(&state);
    outcome
}

/// Starts a Windows shutdown in 60 seconds ("Shut down computer" after
/// a transfer) - `cancel_shutdown` (or `shutdown /a`) aborts it.
#[tauri::command]
pub fn schedule_shutdown() -> Result<(), AppError> {
    run_shutdown(&["/s", "/t", "60", "/c", "DataManager Pro: the transfer is complete - shutting down in 60 seconds."])
}

#[tauri::command]
pub fn cancel_shutdown() -> Result<(), AppError> {
    run_shutdown(&["/a"])
}

fn run_shutdown(args: &[&str]) -> Result<(), AppError> {
    let status = std::process::Command::new("shutdown")
        .args(args)
        .status()
        .map_err(|e| AppError::new(AppErrorCode::IoError, "Could not run shutdown.").with_details(e.to_string()))?;
    if status.success() {
        Ok(())
    } else {
        Err(AppError::new(AppErrorCode::IoError, format!("shutdown exited with {status}")))
    }
}

/// Opens a folder in Explorer ("Open destination folder" after a
/// transfer).
#[tauri::command]
pub fn open_folder(app: AppHandle, path: String) -> Result<(), AppError> {
    use tauri_plugin_opener::OpenerExt;
    if !Path::new(&path).is_dir() {
        return Err(AppError::path_not_found(path));
    }
    app.opener()
        .open_path(&path, None::<&str>)
        .map_err(|e| AppError::new(AppErrorCode::IoError, "Could not open the folder.").with_details(e.to_string()))
}
