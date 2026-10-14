//! Non-Windows fallback implementation of the `platform::current` API.
//!
//! DataManager Pro targets Windows 10/11 (see the Phase 2 brief); this
//! module exists purely so the crate stays buildable on other platforms
//! for development/CI convenience. It never invents values - unsupported
//! operations return `Unsupported`/`None` rather than fake data.

use crate::models::errors::AppError;
use crate::models::filesystem::FileAttribute;
use crate::models::scan::{FsNode, ScanOptions, ScanProgressState};
use crate::models::storage::StorageVolume;
use std::path::Path;

pub fn list_volumes() -> Result<Vec<StorageVolume>, AppError> {
    Err(AppError::unsupported(
        "Storage volume enumeration is only implemented for Windows in Phase 2.",
    ))
}

pub fn allocated_size_bytes(_path: &Path, _logical_size: u64) -> Option<u64> {
    None
}

pub fn allocated_size_for_scan(
    _path: &Path,
    _metadata: &std::fs::Metadata,
    _cluster_size: Option<u64>,
) -> Option<u64> {
    None
}

pub fn cluster_size_bytes(_path: &Path) -> Option<u64> {
    None
}

pub fn decode_attributes(_metadata: &std::fs::Metadata) -> Vec<FileAttribute> {
    Vec::new()
}

/// Raw MFT access is a Windows-only concept (see `platform::windows`'s
/// `try_mft_scan`) - unconditionally unavailable here, so
/// `services::scan_service::run_scan` always falls back to the
/// (fully cross-platform) directory-walk engine.
pub fn try_mft_scan(
    _root_path: &str,
    _options: ScanOptions,
    _state: &ScanProgressState,
) -> Result<FsNode, String> {
    Err("MFT scanning is only implemented for Windows".to_string())
}
