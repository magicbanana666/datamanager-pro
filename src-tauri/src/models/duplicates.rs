//! Data shapes for the Phase 5 duplicate finder - see
//! `services::duplicate_service` for the engine and
//! `commands::duplicates` for how a run is started/streamed.

use crate::models::scan::ScanSkip;
use serde::{Deserialize, Serialize};

/// What makes two files "duplicates". Mirrors `DuplicateCriteriaId` in
/// `src/models/duplicates.ts`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DuplicateCriteria {
    /// Byte-for-byte identical content (size, then a 64 KiB head hash,
    /// then a full-content hash).
    Exact,
    SameName,
    SameSize,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateOptions {
    pub criteria: DuplicateCriteria,
    /// Only used by `SameName`.
    #[serde(default)]
    pub ignore_case: bool,
    #[serde(default = "default_true")]
    pub ignore_hidden: bool,
    #[serde(default = "default_true")]
    pub ignore_system: bool,
    /// Bytes. Zero-byte files are always skipped - every empty file is
    /// trivially "identical" to every other, which is noise, not a
    /// finding.
    #[serde(default)]
    pub min_size: u64,
    #[serde(default)]
    pub max_size: Option<u64>,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateFile {
    /// Full path - unique, so it doubles as the frontend's row id.
    pub path: String,
    pub name: String,
    pub size: u64,
    pub last_modified: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateGroup {
    /// The content hash (hex), file name, or size the group shares.
    pub key: String,
    pub files: Vec<DuplicateFile>,
    /// What deleting every copy but the largest would free.
    pub wasted_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateResult {
    pub scan_id: String,
    /// The largest groups by `wasted_bytes`, at most
    /// `MAX_GROUPS_IN_RESULT` - the totals below always cover *every*
    /// group found, shown or not.
    pub groups: Vec<DuplicateGroup>,
    pub total_groups: u64,
    pub total_duplicate_files: u64,
    pub total_wasted_bytes: u64,
    pub files_compared: u64,
    pub elapsed_ms: u64,
    pub skipped: Vec<ScanSkip>,
}

/// Caps the groups sent to the frontend in one event - a same-name run
/// over a whole drive finds tens of thousands (`desktop.ini`, ...),
/// far more than anyone reviews, and the payload would freeze the
/// webview the same way a whole-drive `scan-complete` once did.
pub const MAX_GROUPS_IN_RESULT: usize = 5_000;
