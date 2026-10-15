//! Scan commands.
//!
//! `start_scan` returns once the scan is running. Events:
//! - `scan-progress` every 150 ms
//! - `scan-complete` with the `ScanResult`
//! - `scan-cancelled` after `cancel_scan`
//! - `scan-error` only on a panic; unreadable folders end up in
//!   `ScanResult.skipped`.

use crate::models::errors::{AppError, AppErrorCode};
use crate::models::scan::{
    find_node, truncate_for_transport, FsNode, ScanOptions, ScanProgress, ScanProgressState,
    ScanResult, TRANSPORT_DEPTH,
};
use crate::services::scan_analysis_service::{self, RawScanAnalysis};
use crate::services::{path_service, scan_service};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

/// Running scans by id.
#[derive(Default)]
pub struct ScanRegistry {
    scans: Mutex<HashMap<String, Arc<ScanProgressState>>>,
}

/// Full trees of finished scans, for `get_subtree` and
/// `analyze_subtree`. Holds at most [`MAX_CACHED_TREES`] (oldest
/// evicted first); a whole-drive tree takes hundreds of MB.
#[derive(Default)]
pub struct ScanTreeCache {
    trees: Mutex<HashMap<String, Arc<FsNode>>>,
    /// Scan ids, oldest first.
    order: Mutex<std::collections::VecDeque<String>>,
}

/// One per analysis page, plus a spare for a scan being replaced.
const MAX_CACHED_TREES: usize = 4;

impl ScanTreeCache {
    fn insert(&self, scan_id: String, root: FsNode) {
        let mut trees = self.trees.lock().unwrap();
        let mut order = self.order.lock().unwrap();
        trees.insert(scan_id.clone(), Arc::new(root));
        order.push_back(scan_id);
        while order.len() > MAX_CACHED_TREES {
            if let Some(oldest) = order.pop_front() {
                trees.remove(&oldest);
            }
        }
    }
}

const PROGRESS_INTERVAL: Duration = Duration::from_millis(150);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanCancelledPayload<'a> {
    scan_id: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanErrorPayload<'a> {
    scan_id: &'a str,
    error: AppError,
}

/// Starts a scan of `path` and returns once it's running.
///
/// The frontend picks `scan_id` so it can subscribe to the events
/// first; a small folder can finish before the command returns.
#[tauri::command]
pub async fn start_scan(
    app: AppHandle,
    scan_id: String,
    path: String,
    options: ScanOptions,
) -> Result<(), AppError> {
    let validation = path_service::validate(&path);
    if !validation.exists || !validation.is_directory {
        return Err(validation.error.unwrap_or_else(|| {
            AppError::invalid_path(path.clone(), "The scan location is not a folder.")
        }));
    }
    let normalized = validation.normalized_path.unwrap_or(path);

    let state = Arc::new(ScanProgressState::new());
    app.state::<ScanRegistry>()
        .scans
        .lock()
        .unwrap()
        .insert(scan_id.clone(), state.clone());

    tracing::info!(scan_id = %scan_id, path = %normalized, "scan starting");
    tauri::async_runtime::spawn(run_and_report(app, scan_id, normalized, options, state));

    Ok(())
}

/// Cancels a scan. A no-op if it already finished.
#[tauri::command]
pub fn cancel_scan(app: AppHandle, scan_id: String) -> Result<(), AppError> {
    if let Some(state) = app
        .state::<ScanRegistry>()
        .scans
        .lock()
        .unwrap()
        .get(&scan_id)
    {
        tracing::info!(scan_id = %scan_id, "scan cancellation requested");
        state.cancel();
    }
    Ok(())
}

/// A folder's children from the cached tree, for folders the
/// `scan-complete` payload left out (see `TRANSPORT_DEPTH`).
#[tauri::command]
pub fn get_subtree(app: AppHandle, scan_id: String, path: String) -> Result<FsNode, AppError> {
    let root = cached_tree(&app, &scan_id)?;
    let node = lookup(&root, &path)?;
    Ok(truncate_for_transport(node, TRANSPORT_DEPTH))
}

/// Data for the analysis tabs (file types, top files/folders,
/// extensions, timeline), computed from the cached full tree. The root
/// of a drive scan is ~1M nodes, so this runs on the blocking pool.
#[tauri::command]
pub async fn analyze_subtree(
    app: AppHandle,
    scan_id: String,
    path: String,
) -> Result<RawScanAnalysis, AppError> {
    // Clone the Arc so the cache isn't locked during the walk.
    let root = cached_tree(&app, &scan_id)?;
    super::blocking(move || Ok(scan_analysis_service::analyze(lookup(&root, &path)?))).await
}

fn cached_tree(app: &AppHandle, scan_id: &str) -> Result<Arc<FsNode>, AppError> {
    app.state::<ScanTreeCache>()
        .trees
        .lock()
        .unwrap()
        .get(scan_id)
        .cloned()
        .ok_or_else(|| {
            AppError::new(
                AppErrorCode::PathNotFound,
                "That scan's result is no longer available - try scanning again.",
            )
        })
}

fn lookup<'a>(root: &'a FsNode, path: &str) -> Result<&'a FsNode, AppError> {
    find_node(root, path).ok_or_else(|| {
        AppError::new(
            AppErrorCode::PathNotFound,
            "That folder wasn't found in the scan result.",
        )
    })
}

fn emit_progress(app: &AppHandle, scan_id: &str, state: &ScanProgressState, started: Instant) {
    let progress = ScanProgress {
        scan_id: scan_id.to_string(),
        scanned_files: state.files.load(Ordering::Relaxed),
        scanned_folders: state.folders.load(Ordering::Relaxed),
        scanned_bytes: state.bytes.load(Ordering::Relaxed),
        current_path: state.current_path.lock().unwrap().clone(),
        elapsed_ms: started.elapsed().as_millis() as u64,
    };
    let _ = app.emit("scan-progress", &progress);
}

/// Runs the scan on the blocking pool, emits progress every
/// [`PROGRESS_INTERVAL`], then the final event, and deregisters it.
async fn run_and_report(
    app: AppHandle,
    scan_id: String,
    path: String,
    options: ScanOptions,
    state: Arc<ScanProgressState>,
) {
    let started = Instant::now();
    let blocking_state = state.clone();
    let mut handle = tokio::task::spawn_blocking(move || {
        scan_service::run_scan(&path, options, &blocking_state)
    });

    let mut ticker = tokio::time::interval(PROGRESS_INTERVAL);
    ticker.tick().await; // the first tick fires immediately - nothing to report yet

    let outcome = loop {
        tokio::select! {
            result = &mut handle => break result,
            _ = ticker.tick() => emit_progress(&app, &scan_id, &state, started),
        }
    };

    app.state::<ScanRegistry>()
        .scans
        .lock()
        .unwrap()
        .remove(&scan_id);
    let elapsed_ms = started.elapsed().as_millis() as u64;

    match outcome {
        Err(join_err) => {
            tracing::error!(error = %join_err, scan_id = %scan_id, "scan task panicked");
            let _ = app.emit(
                "scan-error",
                &ScanErrorPayload {
                    scan_id: &scan_id,
                    error: AppError::new(
                        AppErrorCode::Unknown,
                        "An unexpected internal error occurred during the scan.",
                    ),
                },
            );
        }
        Ok((_root, _engine)) if state.is_cancelled() => {
            tracing::info!(scan_id = %scan_id, "scan cancelled");
            let _ = app.emit(
                "scan-cancelled",
                &ScanCancelledPayload { scan_id: &scan_id },
            );
        }
        Ok((root, engine)) => {
            tracing::info!(
                scan_id = %scan_id,
                engine = ?engine,
                elapsed_ms,
                files = root.file_count,
                folders = root.folder_count,
                size = root.size,
                "scan complete"
            );
            // Keep the full tree here; send a trimmed copy.
            let transport_root = truncate_for_transport(&root, TRANSPORT_DEPTH);
            app.state::<ScanTreeCache>().insert(scan_id.clone(), root);

            let result = ScanResult {
                scan_id: scan_id.clone(),
                root: transport_root,
                engine,
                elapsed_ms,
                skipped: state.take_skipped(),
            };
            let _ = app.emit("scan-complete", &result);
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OwnerStat {
    pub owner: String,
    pub files: u64,
    pub size: u64,
    pub percent: f64,
}

/// Size and file count per owner under `path` (Owners tab). Owners are
/// read in parallel; unreadable ones count as "(unknown)".
#[tauri::command]
pub async fn analyze_owners(app: AppHandle, scan_id: String, path: String) -> Result<Vec<OwnerStat>, AppError> {
    use rayon::prelude::*;
    let root = cached_tree(&app, &scan_id)?;
    super::blocking(move || {
        let node = lookup(&root, &path)?;
        let mut files: Vec<(&str, u64)> = Vec::new();
        let mut stack = vec![node];
        while let Some(n) = stack.pop() {
            match n.kind {
                crate::models::scan::NodeKind::File => files.push((n.path.as_str(), n.size)),
                crate::models::scan::NodeKind::Folder => stack.extend(n.children.as_deref().unwrap_or(&[])),
            }
        }
        let totals = files
            .par_iter()
            .fold(HashMap::<Vec<u8>, (u64, u64)>::new, |mut acc, &(p, size)| {
                let sid = crate::platform::current::network::owner_sid(std::path::Path::new(p)).unwrap_or_default();
                let entry = acc.entry(sid).or_default();
                entry.0 += 1;
                entry.1 += size;
                acc
            })
            .reduce(HashMap::new, |mut a, b| {
                for (k, (f, s)) in b {
                    let e = a.entry(k).or_default();
                    e.0 += f;
                    e.1 += s;
                }
                a
            });
        let total: u64 = totals.values().map(|v| v.1).sum();
        let mut stats: Vec<OwnerStat> = totals
            .into_iter()
            .map(|(sid, (files, size))| OwnerStat {
                owner: if sid.is_empty() {
                    "(unknown)".into()
                } else {
                    crate::platform::current::network::sid_account_name(&sid)
                },
                files,
                size,
                percent: if total > 0 { size as f64 / total as f64 * 100.0 } else { 0.0 },
            })
            .collect();
        stats.sort_by_key(|s| std::cmp::Reverse(s.size));
        Ok(stats)
    })
    .await
}
