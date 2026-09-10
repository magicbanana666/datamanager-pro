//! Read-only, non-recursive filesystem browsing. Every function here
//! touches only the directory or file it was asked about - nothing
//! recurses, nothing sums a folder's contents beyond its *direct*
//! children, and nothing ever writes, deletes, renames or creates
//! anything. The recursive high-performance scanner is Phase 3's job.

use crate::models::errors::AppError;
use crate::models::filesystem::{
    DirectoryListing, DirectorySummary, EntryType, FileAttribute, FileMetadata, FileSystemEntry,
    FolderMetadata, ListDirectoryOptions,
};
use crate::platform;
use crate::utils::path::normalize_path;
use crate::utils::time::system_time_to_iso8601;
use std::fs::{self, DirEntry};
use std::path::Path;

fn entry_type_of(file_type: std::fs::FileType) -> EntryType {
    if file_type.is_symlink() {
        EntryType::Symlink
    } else if file_type.is_dir() {
        EntryType::Directory
    } else if file_type.is_file() {
        EntryType::File
    } else {
        EntryType::Other
    }
}

fn map_entry(entry: &DirEntry) -> Result<FileSystemEntry, AppError> {
    let path = entry.path();
    let path_str = path.to_string_lossy().to_string();
    let file_type = entry
        .file_type()
        .map_err(|e| AppError::from_io(&e, &path_str))?;
    let metadata = entry
        .metadata()
        .map_err(|e| AppError::from_io(&e, &path_str))?;

    let entry_type = entry_type_of(file_type);
    let is_symlink = file_type.is_symlink();
    let attributes = platform::current::decode_attributes(&metadata);
    let is_hidden = attributes.contains(&FileAttribute::Hidden);
    let is_system = attributes.contains(&FileAttribute::System);
    let is_read_only = metadata.permissions().readonly();

    let is_dir = matches!(entry_type, EntryType::Directory);
    let size_bytes = if is_dir { None } else { Some(metadata.len()) };
    let allocated_size_bytes = if is_dir {
        None
    } else {
        platform::current::allocated_size_bytes(&path, metadata.len())
    };

    let name = entry.file_name().to_string_lossy().to_string();
    let extension = if is_dir {
        None
    } else {
        path.extension().map(|e| e.to_string_lossy().to_lowercase())
    };

    Ok(FileSystemEntry {
        name,
        path: path_str,
        entry_type,
        size_bytes,
        allocated_size_bytes,
        modified: metadata.modified().ok().and_then(system_time_to_iso8601),
        created: metadata.created().ok().and_then(system_time_to_iso8601),
        accessed: metadata.accessed().ok().and_then(system_time_to_iso8601),
        attributes,
        extension,
        is_hidden,
        is_system,
        is_read_only,
        is_symlink,
        child_count: None,
    })
}

/// Returns the *immediate* children of `path` only - never recurses
/// into subfolders. Hidden/system entries are filtered per `options`
/// (both default to hidden, matching the frontend's default toggle
/// state) rather than never being read at all, since the caller may
/// flip the toggle without a full re-browse later.
pub fn list_directory(
    path: &str,
    options: ListDirectoryOptions,
) -> Result<DirectoryListing, AppError> {
    let normalized = normalize_path(path);
    let dir_path = Path::new(&normalized);

    let read_dir = fs::read_dir(dir_path).map_err(|e| AppError::from_io(&e, &normalized))?;

    let mut entries = Vec::new();
    let mut truncated_hidden = false;
    for item in read_dir {
        let item = match item {
            Ok(i) => i,
            Err(err) => {
                tracing::warn!(error = %err, "skipping unreadable directory entry");
                continue;
            }
        };
        let mapped = match map_entry(&item) {
            Ok(m) => m,
            Err(err) => {
                tracing::warn!(path = %item.path().display(), error = %err, "skipping entry with unreadable metadata");
                continue;
            }
        };
        if (mapped.is_hidden && !options.show_hidden) || (mapped.is_system && !options.show_system)
        {
            truncated_hidden = true;
            continue;
        }
        entries.push(mapped);
    }

    Ok(DirectoryListing {
        path: normalized,
        entries,
        truncated_hidden,
    })
}

/// Shallow (non-recursive) directory statistics: counts and sums only
/// `path`'s *direct* children. This is explicitly not a disk-usage
/// scanner - subfolder contents are not visited.
pub fn get_directory_summary(path: &str) -> Result<DirectorySummary, AppError> {
    let normalized = normalize_path(path);
    let dir_path = Path::new(&normalized);

    let dir_metadata = match fs::metadata(dir_path) {
        Ok(m) => m,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return Ok(DirectorySummary {
                path: normalized,
                exists: false,
                direct_file_count: 0,
                direct_folder_count: 0,
                direct_file_bytes: 0,
                last_modified: None,
                hidden_items: None,
                read_only_items: None,
            });
        }
        Err(err) => return Err(AppError::from_io(&err, &normalized)),
    };

    let read_dir = fs::read_dir(dir_path).map_err(|e| AppError::from_io(&e, &normalized))?;

    let mut direct_file_count = 0u64;
    let mut direct_folder_count = 0u64;
    let mut direct_file_bytes = 0u64;
    let mut hidden_items = 0u64;
    let mut read_only_items = 0u64;

    for item in read_dir.flatten() {
        let Ok(file_type) = item.file_type() else {
            continue;
        };
        let Ok(metadata) = item.metadata() else {
            continue;
        };

        if file_type.is_dir() {
            direct_folder_count += 1;
        } else {
            direct_file_count += 1;
            direct_file_bytes += metadata.len();
        }

        let attributes = platform::current::decode_attributes(&metadata);
        if attributes.contains(&FileAttribute::Hidden) {
            hidden_items += 1;
        }
        if metadata.permissions().readonly() {
            read_only_items += 1;
        }
    }

    Ok(DirectorySummary {
        path: normalized,
        exists: true,
        direct_file_count,
        direct_folder_count,
        direct_file_bytes,
        last_modified: dir_metadata
            .modified()
            .ok()
            .and_then(system_time_to_iso8601),
        hidden_items: Some(hidden_items),
        read_only_items: Some(read_only_items),
    })
}

pub fn get_file_metadata(path: &str) -> Result<FileMetadata, AppError> {
    let normalized = normalize_path(path);
    let p = Path::new(&normalized);
    let link_metadata = fs::symlink_metadata(p).map_err(|e| AppError::from_io(&e, &normalized))?;
    let is_symlink = link_metadata.file_type().is_symlink();
    // Report size/timestamps from the link *target* when possible, since
    // that's almost always what a "file metadata" panel means to show.
    let resolved = if is_symlink {
        fs::metadata(p).unwrap_or_else(|_| link_metadata.clone())
    } else {
        link_metadata.clone()
    };

    let entry_type = if is_symlink {
        EntryType::Symlink
    } else if resolved.is_dir() {
        EntryType::Directory
    } else {
        EntryType::File
    };
    if entry_type == EntryType::Directory {
        return Err(AppError::invalid_path(
            normalized,
            "This path is a folder - use get_folder_metadata instead.",
        ));
    }

    let attributes = platform::current::decode_attributes(&link_metadata);
    let name = p
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| normalized.clone());
    let extension = p.extension().map(|e| e.to_string_lossy().to_lowercase());
    let size_bytes = resolved.len();
    let allocated_size_bytes = platform::current::allocated_size_bytes(p, size_bytes);

    Ok(FileMetadata {
        name,
        path: normalized,
        size_bytes,
        allocated_size_bytes,
        extension,
        created: resolved.created().ok().and_then(system_time_to_iso8601),
        modified: resolved.modified().ok().and_then(system_time_to_iso8601),
        accessed: resolved.accessed().ok().and_then(system_time_to_iso8601),
        is_read_only: resolved.permissions().readonly(),
        is_hidden: attributes.contains(&FileAttribute::Hidden),
        is_system: attributes.contains(&FileAttribute::System),
        is_archive: attributes.contains(&FileAttribute::Archive),
        is_symlink,
        entry_type,
        attributes,
        // Owner lookup is out of scope for Phase 2 - see PHASE2.md.
        owner: None,
    })
}

pub fn get_folder_metadata(path: &str) -> Result<FolderMetadata, AppError> {
    let normalized = normalize_path(path);
    let p = Path::new(&normalized);
    let metadata = fs::metadata(p).map_err(|e| AppError::from_io(&e, &normalized))?;
    if !metadata.is_dir() {
        return Err(AppError::invalid_path(
            normalized,
            "This path is a file - use get_file_metadata instead.",
        ));
    }

    let attributes = platform::current::decode_attributes(&metadata);
    let name = p
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| normalized.clone());

    let mut direct_file_count = 0u64;
    let mut direct_folder_count = 0u64;
    let mut direct_file_bytes = 0u64;
    if let Ok(read_dir) = fs::read_dir(p) {
        for item in read_dir.flatten() {
            let Ok(file_type) = item.file_type() else {
                continue;
            };
            if file_type.is_dir() {
                direct_folder_count += 1;
            } else {
                direct_file_count += 1;
                if let Ok(m) = item.metadata() {
                    direct_file_bytes += m.len();
                }
            }
        }
    }

    Ok(FolderMetadata {
        name,
        path: normalized,
        created: metadata.created().ok().and_then(system_time_to_iso8601),
        modified: metadata.modified().ok().and_then(system_time_to_iso8601),
        accessed: metadata.accessed().ok().and_then(system_time_to_iso8601),
        attributes,
        direct_file_count,
        direct_folder_count,
        direct_file_bytes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_directory_maps_files_and_folders_correctly() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.txt"), b"hello world").unwrap();
        std::fs::create_dir(dir.path().join("subfolder")).unwrap();

        let listing = list_directory(
            &dir.path().to_string_lossy(),
            ListDirectoryOptions::default(),
        )
        .unwrap();
        assert_eq!(listing.entries.len(), 2);

        let file_entry = listing.entries.iter().find(|e| e.name == "a.txt").unwrap();
        assert_eq!(file_entry.entry_type, EntryType::File);
        assert_eq!(file_entry.size_bytes, Some(11));
        assert_eq!(file_entry.extension.as_deref(), Some("txt"));
        assert!(!file_entry.is_hidden);

        let dir_entry = listing
            .entries
            .iter()
            .find(|e| e.name == "subfolder")
            .unwrap();
        assert_eq!(dir_entry.entry_type, EntryType::Directory);
        // Phase 2 never sums a folder's own contents in a listing.
        assert_eq!(dir_entry.size_bytes, None);
    }

    #[test]
    fn list_directory_on_missing_path_returns_an_error_not_a_panic() {
        let result = list_directory(
            r"Z:\this-definitely-does-not-exist-12345",
            ListDirectoryOptions::default(),
        );
        assert!(result.is_err());
    }

    #[test]
    fn get_directory_summary_counts_direct_children_only() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.txt"), b"12345").unwrap();
        std::fs::write(dir.path().join("b.txt"), b"1234567890").unwrap();
        std::fs::create_dir(dir.path().join("sub")).unwrap();
        // A file nested inside the subfolder must NOT be counted - this
        // command is intentionally shallow, not a recursive scan.
        std::fs::write(
            dir.path().join("sub").join("deep.txt"),
            b"ignored-because-nested",
        )
        .unwrap();

        let summary = get_directory_summary(&dir.path().to_string_lossy()).unwrap();
        assert!(summary.exists);
        assert_eq!(summary.direct_file_count, 2);
        assert_eq!(summary.direct_folder_count, 1);
        assert_eq!(summary.direct_file_bytes, 15);
    }

    #[test]
    fn get_directory_summary_on_missing_path_reports_not_exists_without_erroring() {
        let summary = get_directory_summary(r"Z:\this-definitely-does-not-exist-12345").unwrap();
        assert!(!summary.exists);
        assert_eq!(summary.direct_file_count, 0);
    }

    #[test]
    fn get_file_metadata_rejects_directories() {
        let dir = tempfile::tempdir().unwrap();
        assert!(get_file_metadata(&dir.path().to_string_lossy()).is_err());
    }

    #[test]
    fn get_file_metadata_reads_a_real_file() {
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("report.pdf");
        std::fs::write(&file_path, b"0123456789").unwrap();

        let metadata = get_file_metadata(&file_path.to_string_lossy()).unwrap();
        assert_eq!(metadata.size_bytes, 10);
        assert_eq!(metadata.extension.as_deref(), Some("pdf"));
        assert_eq!(metadata.entry_type, EntryType::File);
        assert!(!metadata.is_symlink);
    }

    #[test]
    fn get_folder_metadata_rejects_files() {
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("a.txt");
        std::fs::write(&file_path, b"x").unwrap();
        assert!(get_folder_metadata(&file_path.to_string_lossy()).is_err());
    }

    #[test]
    fn get_folder_metadata_counts_direct_children() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.txt"), b"12345").unwrap();
        std::fs::create_dir(dir.path().join("sub")).unwrap();

        let metadata = get_folder_metadata(&dir.path().to_string_lossy()).unwrap();
        assert_eq!(metadata.direct_file_count, 1);
        assert_eq!(metadata.direct_folder_count, 1);
        assert_eq!(metadata.direct_file_bytes, 5);
    }
}
