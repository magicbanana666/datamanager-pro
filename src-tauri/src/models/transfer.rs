//! Data model for the Phase 6/7 transfer engine (copy, move, and the
//! mirror/incremental/update-newer/two-way sync modes), mirroring
//! `src/models/transfer.ts` and `src/models/sync.ts` on the frontend.
//!
//! A transfer runs in two steps: **analyze** lists both sides and builds
//! a [`TransferPlan`] (one [`PlanItem`] per file/folder with the action
//! it will get), then **execute** carries out the included items. Data
//! Transfer runs both back to back; Sync / Incremental shows the plan
//! first so items can be excluded and conflicts resolved.

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering};
use std::sync::Mutex;

/// How many plan rows a `transfer-planned` event carries - the plan
/// itself (and its totals) always covers every item.
pub const MAX_PLAN_ROWS: usize = 10_000;
/// How many per-file errors a report carries.
pub const MAX_REPORTED_ERRORS: usize = 500;
/// FAT/exFAT store modified times at 2-second resolution.
pub const TIMESTAMP_TOLERANCE_SECS: i64 = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TransferMode {
    Copy,
    Move,
    /// Destination becomes an exact copy: new and changed files are
    /// copied, files only at the destination are deleted.
    Mirror,
    /// New and changed files are copied; extras at the destination are
    /// only deleted with `delete_extras`.
    Incremental,
    /// Like incremental, but a destination file is only replaced when
    /// the source copy is newer.
    UpdateNewer,
    /// Changes on either side are carried to the other, using the state
    /// saved by the previous run to tell edits from deletions.
    TwoWay,
}

/// What Copy/Move do when the destination file already exists.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CollisionPolicy {
    /// Skip when size and modified time match, otherwise overwrite.
    SkipSame,
    /// Skip when contents match (hashed), otherwise overwrite.
    CompareHash,
    /// Keep both: the new file gets " (1)", " (2)", ... appended.
    RenameNew,
    /// Overwrite only when the existing file is older.
    OverwriteOlder,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferOptions {
    #[serde(default = "yes")]
    pub include_subfolders: bool,
    #[serde(default = "yes")]
    pub create_missing_folders: bool,
    #[serde(default)]
    pub verify_after_transfer: bool,
    #[serde(default)]
    pub preserve_permissions: bool,
    #[serde(default = "yes")]
    pub preserve_timestamps: bool,
    /// Incremental/update-newer: delete destination files that no longer
    /// exist at the source. Mirror always does.
    #[serde(default)]
    pub delete_extras: bool,
    /// Sync modes: treat equal size + modified time as unchanged.
    /// Without it (and without `compare_hash`) every file is copied.
    #[serde(default = "yes")]
    pub skip_same_size_date: bool,
    /// Sync modes: decide "unchanged" by content hash instead.
    #[serde(default)]
    pub compare_hash: bool,
    /// `;`-separated wildcard patterns on file names (or relative paths,
    /// when a pattern contains `\`). Empty or `*.*` includes everything.
    #[serde(default)]
    pub include_filters: String,
    /// `;`-separated wildcard patterns; also matched against folder
    /// names, so `node_modules` excludes a whole subtree.
    #[serde(default)]
    pub exclude_filters: String,
    /// Deleted files go to the Recycle Bin (where there is one) instead
    /// of being removed for good.
    #[serde(default = "yes")]
    pub use_recycle_bin: bool,
}

fn yes() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferRequest {
    pub source: String,
    pub destination: String,
    pub mode: TransferMode,
    pub collision: CollisionPolicy,
    pub options: TransferOptions,
    /// Instead of the whole `source` folder: just these files, copied or
    /// moved directly into `destination` (Duplicate Finder / Compare
    /// Locations file actions). `source` is then only a label.
    #[serde(default)]
    pub files: Option<Vec<String>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PlanAction {
    /// Source → destination, nothing there yet.
    CopyNew,
    /// Source → destination, replacing the destination copy.
    Update,
    /// Source → destination under a new " (n)" name.
    RenameCopy,
    /// Two-way: destination → source, nothing there yet.
    CopyBack,
    /// Two-way: destination → source, replacing the source copy.
    UpdateBack,
    /// Delete the destination copy (mirror/extras, two-way deletions).
    DeleteDest,
    /// Two-way: delete the source copy (it was deleted at the destination).
    DeleteSource,
    /// Create an (empty) folder at the destination.
    CreateFolder,
    SkipSame,
    SkipOlder,
    Excluded,
    /// Two-way: changed on both sides - needs a decision.
    Conflict,
}

impl PlanAction {
    /// Whether executing the item does anything.
    pub fn is_work(self) -> bool {
        !matches!(
            self,
            PlanAction::SkipSame | PlanAction::SkipOlder | PlanAction::Excluded | PlanAction::Conflict
        )
    }

    /// Bytes the action copies.
    pub fn copies(self) -> bool {
        matches!(
            self,
            PlanAction::CopyNew
                | PlanAction::Update
                | PlanAction::RenameCopy
                | PlanAction::CopyBack
                | PlanAction::UpdateBack
        )
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanItem {
    pub id: u32,
    /// Relative to the source/destination roots (`\`-separated). For a
    /// `files` request, the file name.
    pub relative_path: String,
    pub is_folder: bool,
    pub action: PlanAction,
    /// The size of the copy being transferred (or deleted).
    pub size: u64,
    pub source_modified: Option<String>,
    pub dest_modified: Option<String>,
    /// Full source path - differs from `source\relative_path` only for a
    /// `files` request.
    pub source_path: String,
    /// Full destination path (for `RenameCopy`, the new name).
    pub dest_path: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanSummary {
    pub new_files: u64,
    pub new_bytes: u64,
    pub updated_files: u64,
    pub updated_bytes: u64,
    pub unchanged_files: u64,
    pub unchanged_bytes: u64,
    pub excluded_files: u64,
    pub excluded_bytes: u64,
    pub deletions: u64,
    pub deletion_bytes: u64,
    pub conflicts: u64,
    pub folders_to_create: u64,
    pub total_to_copy_files: u64,
    pub total_to_copy_bytes: u64,
    /// What the destination volume needs: bytes copied there minus the
    /// size of the copies they replace.
    pub net_bytes_needed: u64,
    /// Free space at the destination, if known - checked against
    /// `total_to_copy_bytes` before executing.
    pub dest_free_bytes: Option<u64>,
}

/// `transfer-planned`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferPlan {
    pub job_id: String,
    pub summary: PlanSummary,
    /// The first [`MAX_PLAN_ROWS`] items (work first, then skips).
    pub rows: Vec<PlanItem>,
    pub total_items: u64,
    pub elapsed_ms: u64,
    pub skipped: Vec<crate::models::scan::ScanSkip>,
}

/// A frontend decision on one plan item before executing: exclude it,
/// or (for a conflict) pick the direction.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemOverride {
    pub id: u32,
    pub included: bool,
    #[serde(default)]
    pub action: Option<PlanAction>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ItemStatus {
    InProgress,
    Done,
    Skipped,
    Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemUpdate {
    pub id: u32,
    pub status: ItemStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TransferPhase {
    Analyzing,
    Planned,
    Copying,
    Deleting,
    Finishing,
}

/// `transfer-progress`, roughly every 150ms while analyzing/executing.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferProgress {
    pub job_id: String,
    pub phase: TransferPhase,
    pub paused: bool,
    /// Analyzing: files listed so far.
    pub files_found: u64,
    pub files_total: u64,
    pub files_done: u64,
    pub bytes_total: u64,
    pub bytes_done: u64,
    /// Over the last ~2 seconds.
    pub speed_bps: u64,
    pub errors: u64,
    pub current_file: String,
    pub elapsed_ms: u64,
    /// Files being copied right now, with their own progress.
    pub active: Vec<ActiveItem>,
    /// Item status changes since the previous tick.
    pub updates: Vec<ItemUpdate>,
    /// Log lines since the previous tick.
    pub log: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveItem {
    pub id: u32,
    pub bytes_done: u64,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferError {
    pub path: String,
    pub message: String,
}

/// `transfer-complete`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferReport {
    pub job_id: String,
    pub mode: TransferMode,
    pub source: String,
    pub destination: String,
    pub files_copied: u64,
    pub bytes_copied: u64,
    pub files_deleted: u64,
    pub folders_created: u64,
    pub files_skipped: u64,
    pub files_verified: u64,
    pub errors: Vec<TransferError>,
    pub error_count: u64,
    pub elapsed_ms: u64,
    pub resumed: bool,
}

/// An unfinished transfer found in the journal directory - cancelled, or
/// the app was closed or crashed mid-transfer.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InterruptedTransfer {
    pub job_id: String,
    pub source: String,
    pub destination: String,
    pub mode: TransferMode,
    pub started_at: String,
    pub files_total: u64,
    pub files_done: u64,
    pub bytes_total: u64,
    pub bytes_done: u64,
}

/// Shared runtime state for one transfer job.
pub struct TransferState {
    cancel: AtomicBool,
    paused: AtomicBool,
    phase: AtomicU8,
    pub files_found: AtomicU64,
    pub files_total: AtomicU64,
    pub files_done: AtomicU64,
    pub bytes_total: AtomicU64,
    pub bytes_done: AtomicU64,
    pub errors: AtomicU64,
    pub current_file: Mutex<String>,
    active: Mutex<std::collections::HashMap<u32, (u64, u64)>>,
    updates: Mutex<Vec<ItemUpdate>>,
    log: Mutex<Vec<String>>,
    /// The listing phase reuses the scan engines' skip bookkeeping.
    pub scan: crate::models::scan::ScanProgressState,
}

impl TransferState {
    pub fn new() -> Self {
        Self {
            cancel: AtomicBool::new(false),
            paused: AtomicBool::new(false),
            phase: AtomicU8::new(0),
            files_found: AtomicU64::new(0),
            files_total: AtomicU64::new(0),
            files_done: AtomicU64::new(0),
            bytes_total: AtomicU64::new(0),
            bytes_done: AtomicU64::new(0),
            errors: AtomicU64::new(0),
            current_file: Mutex::new(String::new()),
            active: Mutex::new(std::collections::HashMap::new()),
            updates: Mutex::new(Vec::new()),
            log: Mutex::new(Vec::new()),
            scan: crate::models::scan::ScanProgressState::new(),
        }
    }

    pub fn cancel(&self) {
        self.cancel.store(true, Ordering::Relaxed);
        self.scan.cancel();
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancel.load(Ordering::Relaxed)
    }

    pub fn set_paused(&self, paused: bool) {
        self.paused.store(paused, Ordering::Relaxed);
    }

    pub fn is_paused(&self) -> bool {
        self.paused.load(Ordering::Relaxed)
    }

    /// Blocks while paused; returns `false` if cancelled meanwhile.
    pub fn wait_while_paused(&self) -> bool {
        while self.is_paused() && !self.is_cancelled() {
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        !self.is_cancelled()
    }

    pub fn phase(&self) -> TransferPhase {
        match self.phase.load(Ordering::Relaxed) {
            0 => TransferPhase::Analyzing,
            1 => TransferPhase::Planned,
            2 => TransferPhase::Copying,
            3 => TransferPhase::Deleting,
            _ => TransferPhase::Finishing,
        }
    }

    pub fn set_phase(&self, phase: TransferPhase) {
        self.phase.store(phase as u8, Ordering::Relaxed);
    }

    pub fn set_current_file(&self, path: &str) {
        if let Ok(mut guard) = self.current_file.try_lock() {
            path.clone_into(&mut guard);
        }
    }

    pub fn push_update(&self, id: u32, status: ItemStatus, message: Option<String>) {
        self.updates
            .lock()
            .unwrap()
            .push(ItemUpdate { id, status, message });
    }

    pub fn log(&self, line: impl Into<String>) {
        self.log.lock().unwrap().push(line.into());
    }

    pub fn set_active(&self, id: u32, bytes_done: u64, size: u64) {
        self.active.lock().unwrap().insert(id, (bytes_done, size));
    }

    pub fn clear_active(&self, id: u32) {
        self.active.lock().unwrap().remove(&id);
    }

    pub fn active_items(&self) -> Vec<ActiveItem> {
        self.active
            .lock()
            .unwrap()
            .iter()
            .map(|(&id, &(bytes_done, size))| ActiveItem { id, bytes_done, size })
            .collect()
    }

    pub fn take_updates(&self) -> Vec<ItemUpdate> {
        std::mem::take(&mut self.updates.lock().unwrap())
    }

    pub fn take_log(&self) -> Vec<String> {
        std::mem::take(&mut self.log.lock().unwrap())
    }
}

impl Default for TransferState {
    fn default() -> Self {
        Self::new()
    }
}
