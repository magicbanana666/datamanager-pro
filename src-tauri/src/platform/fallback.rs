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

pub fn file_identity(_file: &std::fs::File) -> Option<(u32, u64)> {
    None
}

pub fn copy_dacl(_source: &Path, _dest: &Path) -> Result<(), String> {
    Err("NTFS permissions are only implemented for Windows".to_string())
}

pub fn copy_attributes(_source: &Path, _dest: &Path) -> Result<(), String> {
    Ok(())
}

pub fn clear_readonly(path: &Path) {
    if let Ok(meta) = std::fs::metadata(path) {
        let mut perms = meta.permissions();
        #[allow(clippy::permissions_set_readonly_false)]
        perms.set_readonly(false);
        let _ = std::fs::set_permissions(path, perms);
    }
}

pub fn recycle(_path: &Path) -> Result<(), String> {
    Err("the Recycle Bin is only implemented for Windows".to_string())
}

pub fn free_space_bytes(_path: &Path) -> Option<u64> {
    None
}

pub mod network {
    pub fn owner_sid(_path: &std::path::Path) -> Option<Vec<u8>> {
        None
    }

    pub fn sid_account_name(_sid: &[u8]) -> String {
        String::new()
    }
}
