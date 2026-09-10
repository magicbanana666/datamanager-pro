//! Data shapes for the Phase 3 recursive scanner: a real, streamed
//! `FsNode` tree replacing Phase 1's mock trees, backed by either a
//! multithreaded directory walk or a best-effort raw MFT read on NTFS
//! volumes - see `services::scan_service` and
//! `platform::current::try_mft_scan`.

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;

/// Options accepted by `start_scan` - same shape/defaults as
/// `ListDirectoryOptions` for consistency.
#[derive(Debug, Clone, Copy, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanOptions {
    #[serde(default)]
    pub show_hidden: bool,
    #[serde(default)]
    pub show_system: bool,
}

/// Which engine actually produced a scan - surfaced to the frontend so
/// it can honestly report whether the MFT fast path engaged. That path
/// needs admin/backup privilege to open a raw volume handle; without
/// it, every scan silently and automatically falls back to `Walk`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ScanEngine {
    Mft,
    Walk,
}

/// Which engine actually ran isn't known until a scan finishes (the
/// MFT-vs-walk decision happens inside the scan itself), so it's only
/// ever reported on `ScanResult`, never on a progress tick.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub scan_id: String,
    pub scanned_files: u64,
    pub scanned_folders: u64,
    pub scanned_bytes: u64,
    pub current_path: String,
    pub elapsed_ms: u64,
}

/// A subtree that was skipped rather than aborting the whole scan -
/// same "record and continue" philosophy as
/// `filesystem_service::list_directory`'s per-entry skip-and-warn.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanSkip {
    pub path: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub scan_id: String,
    pub root: FsNode,
    pub engine: ScanEngine,
    pub elapsed_ms: u64,
    pub skipped: Vec<ScanSkip>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum NodeKind {
    Folder,
    File,
}

/// Mirrors `src/models/common.ts`'s `FsNode` field-for-field so the
/// frontend can use a real scan result exactly like it already uses
/// Phase 1's mock trees, with no adaptation layer - including that
/// `category` and `children` are genuinely *absent* keys when empty
/// (`skip_serializing_if`), matching `common.ts`'s `category?:`/
/// `children?:` optional-key convention exactly, rather than the
/// `| null` convention every other `Option<T>` in this crate's
/// frontend mirror uses. `category` is always absent from the
/// backend - categorizing by extension stays a frontend concern (see
/// Phase 2's "backend sends raw data" convention), to be wired up when
/// Phase 4 connects the Treemap.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsNode {
    /// The node's own normalized path - already unique, so it doubles
    /// as the id rather than replicating the mock data's synthetic
    /// `"n/..."` id scheme.
    pub id: String,
    pub name: String,
    pub path: String,
    pub kind: NodeKind,
    pub size: u64,
    pub allocated: u64,
    pub file_count: u64,
    pub folder_count: u64,
    pub percent_of_parent: f64,
    pub last_modified: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<FsNode>>,
}

/// Shared, non-serialized runtime state for one in-progress scan -
/// deliberately kept in `models` (rather than `services` or
/// `platform`) so both the walk engine (`services::scan_service`) and
/// the MFT engine (`platform::current::try_mft_scan`) can depend on it
/// without either layer depending on the other.
///
/// Counters are atomics since the walk engine updates them from many
/// rayon worker threads at once; `current_path` and `skipped` are
/// behind a `Mutex` for the same reason. The MFT engine is inherently
/// single-threaded but takes the exact same type so the command
/// layer's progress ticker doesn't need to care which engine is
/// running.
pub struct ScanProgressState {
    pub cancel: AtomicBool,
    pub files: AtomicU64,
    pub folders: AtomicU64,
    pub bytes: AtomicU64,
    pub current_path: Mutex<String>,
    pub skipped: Mutex<Vec<ScanSkip>>,
}

/// Caps how many skipped subtrees a single scan records, so a location
/// with pathologically many access-denied folders can't blow up memory
/// or the eventual event payload.
const MAX_SKIPPED: usize = 200;

impl ScanProgressState {
    pub fn new() -> Self {
        Self {
            cancel: AtomicBool::new(false),
            files: AtomicU64::new(0),
            folders: AtomicU64::new(0),
            bytes: AtomicU64::new(0),
            current_path: Mutex::new(String::new()),
            skipped: Mutex::new(Vec::new()),
        }
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancel.load(Ordering::Relaxed)
    }

    pub fn cancel(&self) {
        self.cancel.store(true, Ordering::Relaxed);
    }

    /// Best-effort - uses `try_lock` so a busy walker never blocks on
    /// updating the "currently scanning" display path.
    pub fn set_current_path(&self, path: &str) {
        if let Ok(mut guard) = self.current_path.try_lock() {
            *guard = path.to_string();
        }
    }

    pub fn record_skip(&self, path: &str, reason: impl Into<String>) {
        let mut skipped = self.skipped.lock().unwrap();
        if skipped.len() < MAX_SKIPPED {
            skipped.push(ScanSkip {
                path: path.to_string(),
                reason: reason.into(),
            });
        }
    }

    pub fn take_skipped(&self) -> Vec<ScanSkip> {
        std::mem::take(&mut self.skipped.lock().unwrap())
    }
}

impl Default for ScanProgressState {
    fn default() -> Self {
        Self::new()
    }
}
