//! Data shapes for the read-only filesystem browsing API: directory
//! listings, shallow directory summaries, and file/folder metadata. None
//! of these types are ever produced by a recursive walk - see
//! `services::filesystem_service` for exactly what each command reads.

use super::errors::AppError;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum EntryType {
    File,
    Directory,
    Symlink,
    Other,
}

/// Windows file attribute flags, exposed as a typed list rather than a
/// raw bitmask so the frontend never has to decode bits.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum FileAttribute {
    ReadOnly,
    Hidden,
    System,
    Archive,
    Compressed,
    Encrypted,
    Offline,
    Temporary,
    Sparse,
    ReparsePoint,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSystemEntry {
    pub name: String,
    pub path: String,
    pub entry_type: EntryType,
    /// `None`/omitted for directories - Phase 2 never recursively sums a
    /// folder's contents (that's Phase 3's job).
    pub size_bytes: Option<u64>,
    pub allocated_size_bytes: Option<u64>,
    pub modified: Option<String>,
    pub created: Option<String>,
    pub accessed: Option<String>,
    pub attributes: Vec<FileAttribute>,
    pub extension: Option<String>,
    pub is_hidden: bool,
    pub is_system: bool,
    pub is_read_only: bool,
    pub is_symlink: bool,
    /// Only ever set to a *direct* child count, never a recursive one.
    pub child_count: Option<u64>,
}

/// Options accepted by `list_directory`. Defaults to hiding hidden/system
/// items, matching the frontend's documented default.
#[derive(Debug, Clone, Copy, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListDirectoryOptions {
    #[serde(default)]
    pub show_hidden: bool,
    #[serde(default)]
    pub show_system: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryListing {
    pub path: String,
    pub entries: Vec<FileSystemEntry>,
    /// True if any entries were filtered out by `ListDirectoryOptions`.
    pub truncated_hidden: bool,
}

/// Shallow (non-recursive) directory statistics: only the directory's
/// *direct* children are counted. This is intentionally not a disk
/// usage scanner - see `services::filesystem_service::get_directory_summary`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectorySummary {
    pub path: String,
    pub exists: bool,
    pub direct_file_count: u64,
    pub direct_folder_count: u64,
    pub direct_file_bytes: u64,
    pub last_modified: Option<String>,
    pub hidden_items: Option<u64>,
    pub read_only_items: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMetadata {
    pub name: String,
    pub path: String,
    pub size_bytes: u64,
    pub allocated_size_bytes: Option<u64>,
    pub extension: Option<String>,
    pub created: Option<String>,
    pub modified: Option<String>,
    pub accessed: Option<String>,
    pub is_read_only: bool,
    pub is_hidden: bool,
    pub is_system: bool,
    pub is_archive: bool,
    pub is_symlink: bool,
    pub entry_type: EntryType,
    pub attributes: Vec<FileAttribute>,
    /// Owner lookup is intentionally not implemented in Phase 2 (see
    /// PHASE2.md limitations) - always `None` for now.
    pub owner: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderMetadata {
    pub name: String,
    pub path: String,
    pub created: Option<String>,
    pub modified: Option<String>,
    pub accessed: Option<String>,
    pub attributes: Vec<FileAttribute>,
    pub direct_file_count: u64,
    pub direct_folder_count: u64,
    pub direct_file_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathValidation {
    pub input_path: String,
    pub normalized_path: Option<String>,
    pub exists: bool,
    pub is_file: bool,
    pub is_directory: bool,
    pub is_symlink: bool,
    pub is_absolute: bool,
    pub is_unc: bool,
    pub accessible: bool,
    pub error: Option<AppError>,
}
