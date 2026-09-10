//! Windows-specific storage APIs that have no equivalent in
//! `std::fs`: volume enumeration (`GetLogicalDrives`), volume metadata
//! (`GetVolumeInformationW`, `GetDriveTypeW`), free/total space
//! (`GetDiskFreeSpaceExW`), and on-disk allocation size
//! (`GetCompressedFileSizeW` + cluster rounding via `GetDiskFreeSpaceW`).
//! `mft` (Phase 3) adds best-effort raw-MFT scanning via the `ntfs`
//! crate - kept in its own submodule since it's a different kind of
//! Windows-specific code (a raw volume parser, not a handful of Win32
//! calls) but re-exported from here so `platform::current` stays one
//! flat surface.
//!
//! Everything here is read-only: every Win32 call used is a query, never
//! a mutation. Kept isolated in this module (per the Phase 2 brief) so
//! the rest of the crate never touches `windows::Win32` directly.

mod mft;
pub use mft::try_mft_scan;

use crate::models::errors::AppError;
use crate::models::filesystem::FileAttribute;
use crate::models::storage::{StorageVolume, VolumeType};
use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::os::windows::fs::MetadataExt;
use std::path::Path;
use windows::core::PCWSTR;
use windows::Win32::Storage::FileSystem::{
    GetCompressedFileSizeW, GetDiskFreeSpaceExW, GetDiskFreeSpaceW, GetDriveTypeW,
    GetLogicalDrives, GetVolumeInformationW,
};

// `windows` doesn't always export these as named constants (it depends
// on which Win32 metadata subset is enabled), so they're defined here
// directly from the documented, stable Win32 values instead of relying
// on crate re-exports that may or may not exist in a given version.
const DRIVE_REMOVABLE: u32 = 2;
const DRIVE_FIXED: u32 = 3;
const DRIVE_REMOTE: u32 = 4;
const DRIVE_CDROM: u32 = 5;
const DRIVE_RAMDISK: u32 = 6;
const FILE_READ_ONLY_VOLUME: u32 = 0x0008_0000;

/// Encodes a Rust string as a null-terminated UTF-16 buffer suitable for
/// the `PCWSTR` Win32 calls below. The returned `Vec` must outlive the
/// `PCWSTR` built from it.
fn to_wide(s: &str) -> Vec<u16> {
    OsStr::new(s)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

fn drive_type_to_volume_type(drive_type: u32) -> VolumeType {
    match drive_type {
        DRIVE_FIXED => VolumeType::Fixed,
        DRIVE_REMOVABLE => VolumeType::Removable,
        DRIVE_REMOTE => VolumeType::Network,
        DRIVE_CDROM => VolumeType::Optical,
        DRIVE_RAMDISK => VolumeType::RamDisk,
        _ => VolumeType::Unknown,
    }
}

fn display_name(volume_type: VolumeType, label: Option<&str>, letter: char) -> String {
    if let Some(label) = label.filter(|l| !l.is_empty()) {
        return format!("{label} ({letter}:)");
    }
    let generic = match volume_type {
        VolumeType::Fixed => "Local Disk",
        VolumeType::Removable => "Removable Disk",
        VolumeType::Network => "Network Drive",
        VolumeType::Optical => "Optical Drive",
        VolumeType::RamDisk => "RAM Disk",
        VolumeType::Unknown => "Drive",
    };
    format!("{generic} ({letter}:)")
}

/// Enumerates every mounted drive letter (A-Z) and reads its volume
/// info. A drive that exists but can't currently be queried (an empty
/// optical drive, a disconnected mapped network drive, ...) is skipped
/// rather than failing the whole call - see the `tracing::warn!` below.
pub fn list_volumes() -> Result<Vec<StorageVolume>, AppError> {
    let mask = unsafe { GetLogicalDrives() };
    if mask == 0 {
        return Err(AppError::volume_unavailable(
            "Could not enumerate any storage volumes.",
        ));
    }

    let mut volumes = Vec::new();
    for i in 0..26u32 {
        if mask & (1 << i) == 0 {
            continue;
        }
        let letter = (b'A' + i as u8) as char;
        let root_path = format!("{letter}:\\");
        match read_volume(&root_path, letter) {
            Ok(Some(volume)) => volumes.push(volume),
            Ok(None) => tracing::debug!(drive = %root_path, "drive has no ready volume, skipping"),
            Err(err) => {
                tracing::warn!(drive = %root_path, error = %err, "failed to read volume, skipping")
            }
        }
    }

    Ok(volumes)
}

fn read_volume(root_path: &str, letter: char) -> Result<Option<StorageVolume>, AppError> {
    let wide_root = to_wide(root_path);
    let root_pcwstr = PCWSTR(wide_root.as_ptr());

    let drive_type = unsafe { GetDriveTypeW(root_pcwstr) };
    // DRIVE_UNKNOWN = 0, DRIVE_NO_ROOT_DIR = 1: nothing usable is mounted here.
    if drive_type <= 1 {
        return Ok(None);
    }
    let volume_type = drive_type_to_volume_type(drive_type);

    let mut volume_name_buf = [0u16; 260];
    let mut fs_name_buf = [0u16; 260];
    let mut serial: u32 = 0;
    let mut fs_flags: u32 = 0;

    // For removable/network/optical drives this legitimately fails when
    // there's no media/connection - that's not an error, it just means
    // we report the drive with unknown label/filesystem below.
    let info_ok = unsafe {
        GetVolumeInformationW(
            root_pcwstr,
            Some(&mut volume_name_buf),
            Some(&mut serial),
            None,
            Some(&mut fs_flags),
            Some(&mut fs_name_buf),
        )
        .is_ok()
    };

    let volume_label = if info_ok {
        wide_to_string(&volume_name_buf)
    } else {
        None
    };
    let file_system = if info_ok {
        wide_to_string(&fs_name_buf)
    } else {
        None
    };
    let volume_serial = if info_ok && serial != 0 {
        Some(format!("{:04X}-{:04X}", serial >> 16, serial & 0xFFFF))
    } else {
        None
    };
    let is_read_only = info_ok && (fs_flags & FILE_READ_ONLY_VOLUME) != 0;

    let mut free_available: u64 = 0;
    let mut total: u64 = 0;
    let mut total_free: u64 = 0;
    let space_ok = unsafe {
        GetDiskFreeSpaceExW(
            root_pcwstr,
            Some(&mut free_available),
            Some(&mut total),
            Some(&mut total_free),
        )
        .is_ok()
    };

    if !space_ok {
        // Drive is enumerable but not actually accessible right now
        // (e.g. empty removable bay, disconnected network mapping).
        return Ok(None);
    }

    let used = total.saturating_sub(total_free);

    Ok(Some(StorageVolume {
        id: root_path.to_string(),
        name: display_name(volume_type, volume_label.as_deref(), letter),
        mount_point: root_path.to_string(),
        drive_letter: Some(format!("{letter}:")),
        file_system,
        total_bytes: total,
        free_bytes: total_free,
        available_bytes: free_available,
        used_bytes: used,
        usage_percent: crate::utils::size::usage_percent(used, total),
        is_removable: matches!(volume_type, VolumeType::Removable | VolumeType::Optical),
        is_read_only,
        volume_label,
        volume_serial,
        volume_type,
    }))
}

fn wide_to_string(buf: &[u16]) -> Option<String> {
    let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    if len == 0 {
        return None;
    }
    Some(String::from_utf16_lossy(&buf[..len]))
}

/// Best-effort "size on disk" for a file: the true compressed/sparse
/// size when the filesystem reports one that differs from the logical
/// size, otherwise the logical size rounded up to the volume's cluster
/// size (matching what Windows Explorer shows). Returns `None` if
/// neither Win32 call succeeds rather than inventing a value.
pub fn allocated_size_bytes(path: &Path, logical_size: u64) -> Option<u64> {
    let wide_path = to_wide(&path.to_string_lossy());
    let path_pcwstr = PCWSTR(wide_path.as_ptr());

    let mut high: u32 = 0;
    let low = unsafe { GetCompressedFileSizeW(path_pcwstr, Some(&mut high)) };
    const INVALID_FILE_SIZE: u32 = 0xFFFF_FFFF;
    let succeeded =
        low != INVALID_FILE_SIZE || unsafe { windows::Win32::Foundation::GetLastError() }.0 == 0;
    if succeeded {
        let compressed = ((high as u64) << 32) | low as u64;
        if compressed != 0 && compressed != logical_size {
            return Some(compressed);
        }
    }

    // Not compressed/sparse (or the call failed outright): round the
    // logical size up to the volume's cluster size.
    let root = drive_root_of(path)?;
    let wide_root = to_wide(&root);
    let root_pcwstr = PCWSTR(wide_root.as_ptr());

    let mut sectors_per_cluster: u32 = 0;
    let mut bytes_per_sector: u32 = 0;
    let mut free_clusters: u32 = 0;
    let mut total_clusters: u32 = 0;
    let ok = unsafe {
        GetDiskFreeSpaceW(
            root_pcwstr,
            Some(&mut sectors_per_cluster),
            Some(&mut bytes_per_sector),
            Some(&mut free_clusters),
            Some(&mut total_clusters),
        )
        .is_ok()
    };
    if !ok {
        return None;
    }
    let cluster_size = (sectors_per_cluster as u64) * (bytes_per_sector as u64);
    if cluster_size == 0 {
        return None;
    }
    let allocated = logical_size.div_ceil(cluster_size) * cluster_size;
    Some(allocated)
}

fn drive_root_of(path: &Path) -> Option<String> {
    let s = path.to_string_lossy();
    let bytes = s.as_bytes();
    if bytes.len() < 2 || !bytes[0].is_ascii_alphabetic() || bytes[1] != b':' {
        return None;
    }
    Some(format!("{}:\\", bytes[0] as char))
}

const FILE_ATTRIBUTE_READONLY: u32 = 0x1;
const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
const FILE_ATTRIBUTE_SYSTEM: u32 = 0x4;
const FILE_ATTRIBUTE_ARCHIVE: u32 = 0x20;
const FILE_ATTRIBUTE_TEMPORARY: u32 = 0x100;
const FILE_ATTRIBUTE_SPARSE_FILE: u32 = 0x200;
const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
const FILE_ATTRIBUTE_COMPRESSED: u32 = 0x800;
const FILE_ATTRIBUTE_OFFLINE: u32 = 0x1000;
const FILE_ATTRIBUTE_ENCRYPTED: u32 = 0x4000;

/// Decodes the raw `FILE_ATTRIBUTE_*` bitmask (via
/// `MetadataExt::file_attributes`, a Windows-only std extension) into
/// the typed list the frontend consumes.
pub fn decode_attributes(metadata: &std::fs::Metadata) -> Vec<FileAttribute> {
    let bits = metadata.file_attributes();
    let flags: [(u32, FileAttribute); 10] = [
        (FILE_ATTRIBUTE_READONLY, FileAttribute::ReadOnly),
        (FILE_ATTRIBUTE_HIDDEN, FileAttribute::Hidden),
        (FILE_ATTRIBUTE_SYSTEM, FileAttribute::System),
        (FILE_ATTRIBUTE_ARCHIVE, FileAttribute::Archive),
        (FILE_ATTRIBUTE_COMPRESSED, FileAttribute::Compressed),
        (FILE_ATTRIBUTE_ENCRYPTED, FileAttribute::Encrypted),
        (FILE_ATTRIBUTE_OFFLINE, FileAttribute::Offline),
        (FILE_ATTRIBUTE_TEMPORARY, FileAttribute::Temporary),
        (FILE_ATTRIBUTE_SPARSE_FILE, FileAttribute::Sparse),
        (FILE_ATTRIBUTE_REPARSE_POINT, FileAttribute::ReparsePoint),
    ];
    flags
        .into_iter()
        .filter(|(flag, _)| bits & flag != 0)
        .map(|(_, attr)| attr)
        .collect()
}
