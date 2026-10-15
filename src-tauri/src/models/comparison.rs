//! Folder comparison types. Mirrors `src/models/comparison.ts`.

use crate::models::scan::ScanSkip;
use crate::services::scan_analysis_service::ExtensionTotal;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ComparisonMode {
    /// Same size and (unless ignored) same modified time.
    SizeTimestamp,
    /// Same size and byte-for-byte identical content.
    ContentHash,
    /// Present on both sides is enough.
    NameOnly,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComparisonOptions {
    pub mode: ComparisonMode,
    #[serde(default = "default_true")]
    pub include_subfolders: bool,
    /// Only used by `SizeTimestamp`.
    #[serde(default)]
    pub ignore_timestamps: bool,
    /// Skips files under [`SMALL_FILE_BYTES`] on both sides.
    #[serde(default)]
    pub ignore_small_files: bool,
}

fn default_true() -> bool {
    true
}

/// Threshold for `ignore_small_files` (one NTFS cluster).
pub const SMALL_FILE_BYTES: u64 = 4 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ComparisonStatus {
    Identical,
    Different,
    LeftOnly,
    RightOnly,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComparisonRow {
    pub status: ComparisonStatus,
    /// Relative to each side's location, as found on side A when the
    /// file exists there (so its casing is A's), else side B.
    pub relative_path: String,
    pub size_a: Option<u64>,
    pub size_b: Option<u64>,
    pub modified_a: Option<String>,
    pub modified_b: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComparisonSide {
    pub location: String,
    /// Totals over the files actually compared (after the subfolder and
    /// small-file options).
    pub total_bytes: u64,
    pub files: u64,
    pub folders: u64,
    pub last_modified: Option<String>,
    /// Per-extension totals of the compared files, for the File Types
    /// charts - categorized frontend-side, like `analyze_subtree`.
    pub extensions: Vec<ExtensionTotal>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComparisonTotals {
    pub identical_files: u64,
    pub different_files: u64,
    pub left_only: u64,
    pub right_only: u64,
    pub identical_bytes: u64,
    /// The larger side's size of every differing file.
    pub different_data_bytes: u64,
    pub left_only_bytes: u64,
    pub right_only_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComparisonResult {
    pub scan_id: String,
    pub a: ComparisonSide,
    pub b: ComparisonSide,
    pub totals: ComparisonTotals,
    /// The largest [`MAX_ROWS_PER_STATUS`] rows of each status; `totals`
    /// always counts every file.
    pub rows: Vec<ComparisonRow>,
    pub elapsed_ms: u64,
    pub skipped: Vec<ScanSkip>,
}

/// Row cap per status in one event; larger payloads stall the webview.
pub const MAX_ROWS_PER_STATUS: usize = 5_000;
