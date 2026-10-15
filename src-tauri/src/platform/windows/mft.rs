//! Fast scanning of local NTFS volumes by reading the MFT directly.
//!
//! Two strategies:
//! - Folder scans walk directory indexes with the
//!   [`ntfs`](https://github.com/ColinFinck/ntfs) crate. Index entries
//!   carry each file's size, times and attributes, so files are never
//!   opened.
//! - Whole-drive scans read the entire `$MFT` in one go and parse the
//!   records in parallel (`bulk_scan_via_mft`).
//!
//! Note: calling `Ntfs::file()` per record is much slower than walking
//! the indexes, because it re-resolves the `$MFT` data runs on every call.
//!
//! Opening `\\.\C:` needs admin rights. Without them, for UNC paths or
//! non-NTFS volumes `try_mft_scan` fails early and the caller falls back
//! to the directory walk.

use crate::models::scan::{FsNode, NodeKind, ScanOptions, ScanProgressState};
use crate::utils::path::normalize_path;
use crate::utils::time::system_time_to_iso8601;
use ntfs::indexes::NtfsFileNameIndex;
use ntfs::structured_values::{NtfsFileAttributeFlags, NtfsFileName, NtfsFileNamespace};
use ntfs::{Ntfs, NtfsFile, NtfsReadSeek, NtfsTime};
use rayon::prelude::*;
use std::collections::HashMap;
use std::fs::File;
use std::io::{self, BufReader, Read, Seek, SeekFrom};
use std::path::Path;
use std::sync::atomic::Ordering;
use std::time::{Duration, SystemTime};

/// Raw volume reads on Windows must land on a sector boundary. This
/// wraps any `Read + Seek` source and transparently rounds every read/
/// seek to `sector_size`, the same technique the `ntfs` crate's own
/// `ntfs-shell` example uses for the identical `\\.\C:` use case. Not
/// buffered itself - always wrap in a `BufReader` on top, since
/// unbuffered small reads here would each cost a full sector-sized
/// syscall.
struct SectorReader<R> {
    inner: R,
    sector_size: u64,
    position: u64,
}

impl<R: Read + Seek> SectorReader<R> {
    fn new(inner: R, sector_size: u64) -> Self {
        Self {
            inner,
            sector_size,
            position: 0,
        }
    }

    fn align_down(&self, n: u64) -> u64 {
        n / self.sector_size * self.sector_size
    }
}

impl<R: Read + Seek> Read for SectorReader<R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if buf.is_empty() {
            return Ok(0);
        }
        let aligned_start = self.align_down(self.position);
        let offset_into_sector = (self.position - aligned_start) as usize;
        let needed_end = offset_into_sector + buf.len();
        let aligned_len =
            needed_end.div_ceil(self.sector_size as usize) * self.sector_size as usize;

        self.inner.seek(SeekFrom::Start(aligned_start))?;
        let mut temp = vec![0u8; aligned_len];
        self.inner.read_exact(&mut temp)?;
        buf.copy_from_slice(&temp[offset_into_sector..needed_end]);

        self.position += buf.len() as u64;
        Ok(buf.len())
    }
}

impl<R: Read + Seek> Seek for SectorReader<R> {
    fn seek(&mut self, pos: SeekFrom) -> io::Result<u64> {
        let new_pos = match pos {
            SeekFrom::Start(n) => n,
            SeekFrom::Current(delta) => {
                if delta >= 0 {
                    self.position.saturating_add(delta as u64)
                } else {
                    self.position.saturating_sub(delta.unsigned_abs())
                }
            }
            SeekFrom::End(_) => {
                return Err(io::Error::new(
                    io::ErrorKind::Unsupported,
                    "seeking from the end of a raw volume is not supported",
                ));
            }
        };
        self.position = new_pos;
        Ok(self.position)
    }
}

/// Alignment for raw volume reads; a multiple of both 512 and 4096 byte
/// sectors.
const VOLUME_SECTOR_SIZE: u64 = 4096;

/// Read buffer for the sequential `$MFT` read in `bulk_scan_via_mft`.
/// Must be a multiple of `VOLUME_SECTOR_SIZE`.
const BULK_READ_BUFFER_SIZE: usize = 4 * 1024 * 1024;

fn drive_letter_of(normalized: &str) -> Option<char> {
    let bytes = normalized.as_bytes();
    if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        Some(bytes[0].to_ascii_uppercase() as char)
    } else {
        None
    }
}

/// NTFS timestamp (100 ns ticks since 1601) to ISO 8601 UTC.
fn ntfs_time_to_iso8601(t: NtfsTime) -> Option<String> {
    const EPOCH_DIFFERENCE_IN_INTERVALS: u64 = 116_444_736_000_000_000;
    let unix_intervals = t
        .nt_timestamp()
        .checked_sub(EPOCH_DIFFERENCE_IN_INTERVALS)?;
    let secs = unix_intervals / 10_000_000;
    let subsec_100ns = unix_intervals % 10_000_000;
    let duration = Duration::new(secs, (subsec_100ns * 100) as u32);
    let system_time = SystemTime::UNIX_EPOCH.checked_add(duration)?;
    system_time_to_iso8601(system_time)
}

fn empty_folder(path: String, name: String) -> FsNode {
    FsNode {
        id: path.clone(),
        name,
        path,
        kind: NodeKind::Folder,
        size: 0,
        allocated: 0,
        file_count: 0,
        folder_count: 0,
        percent_of_parent: 0.0,
        last_modified: None,
        category: None,
        children: None,
    }
}

/// Scans `root_path` from the MFT. `Err` (logged, not shown) means the
/// caller should use the directory walk: UNC path, no admin rights,
/// not NTFS, or a parse error.
///
/// Drive roots use [`bulk_scan_via_mft`] (C:\ with ~1M files: ~19 s
/// instead of ~174 s). Its cost depends on the size of the whole MFT,
/// so folders use the per-folder index walk in [`build_node`] instead
/// (a 560-file folder: 0.17 s vs 16 s in bulk).
pub fn try_mft_scan(
    root_path: &str,
    options: ScanOptions,
    state: &ScanProgressState,
) -> Result<FsNode, String> {
    let normalized = normalize_path(root_path);
    if normalized.len() == 3 && normalized.ends_with('\\') {
        return bulk_scan_via_mft(root_path, options, state);
    }
    walk_index_scan(&normalized, options, state)
}

/// Per-folder directory index scan (see `try_mft_scan`).
fn walk_index_scan(
    normalized: &str,
    options: ScanOptions,
    state: &ScanProgressState,
) -> Result<FsNode, String> {
    let normalized = normalized.to_string();
    let drive_letter = drive_letter_of(&normalized).ok_or_else(|| {
        "MFT scanning only applies to local drive-rooted paths, not UNC shares".to_string()
    })?;

    let volume_path = format!(r"\\.\{drive_letter}:");
    let file = File::open(&volume_path)
        .map_err(|e| format!("cannot open raw volume {volume_path}: {e}"))?;
    let sector_reader = SectorReader::new(file, VOLUME_SECTOR_SIZE);
    let mut fs = BufReader::new(sector_reader);

    let mut ntfs = Ntfs::new(&mut fs).map_err(|e| e.to_string())?;
    ntfs.read_upcase_table(&mut fs).map_err(|e| e.to_string())?;

    // Resolve the path one component at a time from the volume root
    // (case-insensitive).
    let mut current = ntfs.root_directory(&mut fs).map_err(|e| e.to_string())?;
    let relative = &normalized[2..]; // strip the leading "X:"
    for component in relative.split('\\').filter(|c| !c.is_empty()) {
        if state.is_cancelled() {
            return Ok(empty_folder(normalized.clone(), component.to_string()));
        }
        let index = current
            .directory_index(&mut fs)
            .map_err(|e| e.to_string())?;
        let mut finder = index.finder();
        let entry = NtfsFileNameIndex::find(&mut finder, &ntfs, &mut fs, component)
            .ok_or_else(|| format!("\"{component}\" not found via the MFT index"))?
            .map_err(|e| e.to_string())?;
        current = entry.to_file(&ntfs, &mut fs).map_err(|e| e.to_string())?;
    }

    if !current.is_directory() {
        return Err("target path is not a directory".to_string());
    }

    let name = Path::new(&normalized)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| normalized.clone());
    let root_modified = current
        .info()
        .ok()
        .and_then(|info| ntfs_time_to_iso8601(info.modification_time()));

    let mut root = build_node(&ntfs, &mut fs, &current, normalized, name, options, state)?;
    root.last_modified = root_modified;
    Ok(root)
}

/// Builds an `FsNode` from a directory's index (single-threaded, one
/// volume handle). File sizes and times come from the index entries;
/// only subdirectories are opened.
fn build_node<T: Read + Seek>(
    ntfs: &Ntfs,
    fs: &mut T,
    dir: &NtfsFile,
    path: String,
    name: String,
    options: ScanOptions,
    state: &ScanProgressState,
) -> Result<FsNode, String> {
    if state.is_cancelled() {
        return Ok(empty_folder(path, name));
    }
    state.set_current_path(&path);

    let index = dir.directory_index(fs).map_err(|e| e.to_string())?;
    let mut iter = index.entries();

    let mut children: Vec<FsNode> = Vec::new();
    while let Some(entry) = iter.next(fs) {
        let entry = entry.map_err(|e| e.to_string())?;
        let Some(key) = entry.key() else { continue };
        let file_name: NtfsFileName = key.map_err(|e| e.to_string())?;

        // Files with a generated 8.3 name have a second, Dos-only entry.
        // Skip it so the file isn't counted twice.
        if file_name.namespace() == NtfsFileNamespace::Dos {
            continue;
        }

        let child_name = file_name.name().to_string_lossy();
        let flags = file_name.file_attributes();
        let is_hidden = flags.contains(NtfsFileAttributeFlags::HIDDEN);
        let is_system = flags.contains(NtfsFileAttributeFlags::SYSTEM);
        if (is_hidden && !options.show_hidden) || (is_system && !options.show_system) {
            continue;
        }

        let child_path = format!("{path}\\{child_name}");
        let last_modified = ntfs_time_to_iso8601(file_name.modification_time());

        if file_name.is_directory() {
            let child_file = entry.to_file(ntfs, fs).map_err(|e| e.to_string())?;
            let mut node = build_node(
                ntfs,
                fs,
                &child_file,
                child_path,
                child_name.to_string(),
                options,
                state,
            )?;
            // The child's timestamp is in this directory's index entry.
            node.last_modified = last_modified;
            state.folders.fetch_add(1, Ordering::Relaxed);
            children.push(node);
        } else {
            let size = file_name.data_size();
            let allocated = file_name.allocated_size();
            state.files.fetch_add(1, Ordering::Relaxed);
            state.bytes.fetch_add(size, Ordering::Relaxed);
            children.push(FsNode {
                id: child_path.clone(),
                name: child_name.to_string(),
                path: child_path,
                kind: NodeKind::File,
                size,
                allocated,
                file_count: 0,
                folder_count: 0,
                percent_of_parent: 0.0,
                last_modified,
                category: None,
                children: None,
            });
        }
    }

    let total_size: u64 = children.iter().map(|c| c.size).sum();
    let total_allocated: u64 = children.iter().map(|c| c.allocated).sum();
    let file_count: u64 = children
        .iter()
        .map(|c| {
            if c.kind == NodeKind::File {
                1
            } else {
                c.file_count
            }
        })
        .sum();
    let folder_count: u64 = children
        .iter()
        .map(|c| {
            if c.kind == NodeKind::Folder {
                1 + c.folder_count
            } else {
                0
            }
        })
        .sum();
    for child in &mut children {
        child.percent_of_parent = if total_size > 0 {
            (child.size as f64 / total_size as f64) * 100.0
        } else {
            0.0
        };
    }

    Ok(FsNode {
        id: path.clone(),
        name,
        path,
        kind: NodeKind::Folder,
        size: total_size,
        allocated: total_allocated,
        file_count,
        folder_count,
        percent_of_parent: 100.0,
        // Filled in by the caller (the parent's index entry, or
        // $STANDARD_INFORMATION for the root).
        last_modified: None,
        category: None,
        children: Some(children),
    })
}

// ---------------------------------------------------------------------
// Bulk $MFT read, used for whole-drive scans.
//
// Reads the whole `$MFT` into memory in one sequential read and parses
// the fixed-size File Records from that buffer, instead of one index
// walk per folder.
// ---------------------------------------------------------------------

/// A `$FILE_NAME` attribute parsed from a raw File Record.
struct RawFileName {
    parent_record_number: u64,
    name: String,
    is_directory: bool,
    size: u64,
    allocated: u64,
    last_modified: Option<String>,
    is_hidden: bool,
    is_system: bool,
}

/// Applies the Update Sequence Array fixup to a raw File Record in
/// place (the `ntfs` crate's version is private). `None` for an invalid
/// or torn record, which the caller skips.
fn apply_fixup(record: &mut [u8]) -> Option<()> {
    const SECTOR_SIZE: usize = 512;
    const U16_SIZE: usize = 2;

    if record.len() < 8 || &record[0..4] != b"FILE" {
        return None;
    }
    let usn_offset = u16::from_le_bytes([record[4], record[5]]) as usize;
    let usn_count = u16::from_le_bytes([record[6], record[7]]) as usize;
    let array_count = usn_count.checked_sub(1)?;
    let usn_end = usn_offset.checked_add(U16_SIZE)?;
    if usn_end > record.len() {
        return None;
    }
    let usn = [record[usn_offset], record[usn_offset + 1]];

    let array_start = usn_end;
    let array_end = array_start.checked_add(array_count.checked_mul(U16_SIZE)?)?;
    if array_end > record.len() || array_count.checked_mul(SECTOR_SIZE)? > record.len() {
        return None;
    }

    for i in 0..array_count {
        let array_pos = array_start + i * U16_SIZE;
        let sector_pos = i * SECTOR_SIZE + SECTOR_SIZE - U16_SIZE;
        let new_bytes = [record[array_pos], record[array_pos + 1]];
        // Each sector must end with the Update Sequence Number, otherwise
        // the record was caught mid-write.
        if record[sector_pos] != usn[0] || record[sector_pos + 1] != usn[1] {
            return None;
        }
        record[sector_pos] = new_bytes[0];
        record[sector_pos + 1] = new_bytes[1];
    }
    Some(())
}

/// Parses a resident `$FILE_NAME` value: the 66-byte header and the
/// UTF-16LE name.
fn parse_file_name_value(v: &[u8]) -> Option<RawFileName> {
    const HEADER_SIZE: usize = 66;
    if v.len() < HEADER_SIZE {
        return None;
    }

    let parent_reference = u64::from_le_bytes(v[0..8].try_into().ok()?);
    let parent_record_number = parent_reference & 0xffff_ffff_ffff;
    let modification_time = u64::from_le_bytes(v[16..24].try_into().ok()?);
    let allocated_size = u64::from_le_bytes(v[40..48].try_into().ok()?);
    let data_size = u64::from_le_bytes(v[48..56].try_into().ok()?);
    let file_attributes = u32::from_le_bytes(v[56..60].try_into().ok()?);
    let name_length = v[64] as usize;
    let namespace = v[65];

    // Skip Dos-only 8.3 names, as in `build_node`.
    if namespace == NtfsFileNamespace::Dos as u8 {
        return None;
    }

    let name_bytes_len = name_length * 2;
    let name_end = HEADER_SIZE.checked_add(name_bytes_len)?;
    if name_end > v.len() {
        return None;
    }
    let name_bytes = &v[HEADER_SIZE..name_end];
    let utf16: Vec<u16> = (0..name_length)
        .map(|i| u16::from_le_bytes([name_bytes[i * 2], name_bytes[i * 2 + 1]]))
        .collect();
    let name = String::from_utf16_lossy(&utf16);

    let attrs = NtfsFileAttributeFlags::from_bits_truncate(file_attributes);
    Some(RawFileName {
        parent_record_number,
        name,
        is_directory: attrs.contains(NtfsFileAttributeFlags::IS_DIRECTORY),
        size: data_size,
        allocated: allocated_size,
        last_modified: ntfs_time_to_iso8601(NtfsTime::from(modification_time)),
        is_hidden: attrs.contains(NtfsFileAttributeFlags::HIDDEN),
        is_system: attrs.contains(NtfsFileAttributeFlags::SYSTEM),
    })
}

/// Pass 1 output for one record, keyed by its base record number.
struct RecordResult {
    owner_record_number: u64,
    direct_data: Option<(u64, u64)>,
    external_data_refs: Vec<u64>,
    file_names: Vec<RawFileName>,
}

/// What can be read from one record on its own.
struct ParsedRecord {
    file_names: Vec<RawFileName>,
    /// (size, allocated) of the unnamed `$DATA`, if in this record.
    direct_data: Option<(u64, u64)>,
    /// Extension records that hold the `$DATA` instead, per the
    /// `$ATTRIBUTE_LIST`. Resolved in pass 2.
    external_data_refs: Vec<u64>,
}

/// (size, allocated) of the record's unnamed `$DATA` attribute, if the
/// record holds it.
fn read_direct_data_size(record: &[u8], offset: usize, is_non_resident: u8) -> Option<(u64, u64)> {
    if is_non_resident == 0 && offset + 20 <= record.len() {
        // Resident: the value length is the size (and the allocation).
        let value_length = u32::from_le_bytes([
            record[offset + 16],
            record[offset + 17],
            record[offset + 18],
            record[offset + 19],
        ]) as u64;
        Some((value_length, value_length))
    } else if is_non_resident == 1 && offset + 56 <= record.len() {
        // Non-resident header: allocated_size at +40, data_size at +48.
        let allocated_size =
            u64::from_le_bytes(record[offset + 40..offset + 48].try_into().unwrap());
        let data_size = u64::from_le_bytes(record[offset + 48..offset + 56].try_into().unwrap());
        Some((data_size, allocated_size))
    } else {
        None
    }
}

/// Parses a fixed-up File Record: its resident `$FILE_NAME` attributes
/// and, if present, the unnamed `$DATA` size. Records not marked
/// `IN_USE` (deleted files) return nothing.
///
/// The size in a record's own `$FILE_NAME` can be stale; NTFS only
/// updates it on rename. Some WinSxS files (e.g. msedge.dll) show 0
/// there, so `$DATA` is used when available.
fn parse_record(record: &[u8]) -> ParsedRecord {
    const FILE_NAME_TYPE: u32 = 0x30;
    const DATA_TYPE: u32 = 0x80;
    const ATTRIBUTE_LIST_TYPE: u32 = 0x20;
    const END_MARKER: u32 = 0xFFFF_FFFF;
    const FLAGS_OFFSET: usize = 22;
    const FIRST_ATTR_OFFSET_OFFSET: usize = 20;
    const IN_USE: u16 = 0x0001;
    /// Size of an attribute list entry header: type (4), length (2),
    /// name length (1), name offset (1), lowest VCN (8), file
    /// reference (8), instance (2).
    const ATTR_LIST_ENTRY_SIZE: usize = 26;

    let mut file_names = Vec::new();
    let mut direct_data = None;
    let mut external_data_refs = Vec::new();
    if record.len() < 42 {
        return ParsedRecord {
            file_names,
            direct_data,
            external_data_refs,
        };
    }
    let flags = u16::from_le_bytes([record[FLAGS_OFFSET], record[FLAGS_OFFSET + 1]]);
    if flags & IN_USE == 0 {
        return ParsedRecord {
            file_names,
            direct_data,
            external_data_refs,
        };
    }

    let first_attribute_offset = u16::from_le_bytes([
        record[FIRST_ATTR_OFFSET_OFFSET],
        record[FIRST_ATTR_OFFSET_OFFSET + 1],
    ]) as usize;

    let mut offset = first_attribute_offset;
    while offset + 16 <= record.len() {
        let ty = u32::from_le_bytes([
            record[offset],
            record[offset + 1],
            record[offset + 2],
            record[offset + 3],
        ]);
        if ty == END_MARKER {
            break;
        }
        let length = u32::from_le_bytes([
            record[offset + 4],
            record[offset + 5],
            record[offset + 6],
            record[offset + 7],
        ]) as usize;
        // Corrupt length: stop reading this record.
        if length < 16 || offset + length > record.len() {
            break;
        }

        let is_non_resident = record[offset + 8];
        let name_length = record[offset + 9];

        if ty == FILE_NAME_TYPE && is_non_resident == 0 && offset + 22 <= record.len() {
            let value_length = u32::from_le_bytes([
                record[offset + 16],
                record[offset + 17],
                record[offset + 18],
                record[offset + 19],
            ]) as usize;
            let value_offset =
                u16::from_le_bytes([record[offset + 20], record[offset + 21]]) as usize;
            if let Some(value_start) = offset.checked_add(value_offset) {
                if let Some(value_end) = value_start.checked_add(value_length) {
                    if value_end <= record.len() {
                        if let Some(parsed) = parse_file_name_value(&record[value_start..value_end])
                        {
                            file_names.push(parsed);
                        }
                    }
                }
            }
        } else if ty == DATA_TYPE && name_length == 0 && direct_data.is_none() {
            direct_data = read_direct_data_size(record, offset, is_non_resident);
        } else if ty == ATTRIBUTE_LIST_TYPE && is_non_resident == 0 && offset + 22 <= record.len() {
            // Resident $ATTRIBUTE_LIST: $DATA may be in an extension
            // record (fragmented files such as registry hives).
            // Non-resident lists are rare and not followed; those files
            // keep the $FILE_NAME size.
            let value_length = u32::from_le_bytes([
                record[offset + 16],
                record[offset + 17],
                record[offset + 18],
                record[offset + 19],
            ]) as usize;
            let value_offset =
                u16::from_le_bytes([record[offset + 20], record[offset + 21]]) as usize;
            if let Some(value_start) = offset.checked_add(value_offset) {
                if let Some(value_end) = value_start.checked_add(value_length) {
                    if value_end <= record.len() {
                        let list = &record[value_start..value_end];
                        let mut list_offset = 0usize;
                        while list_offset + ATTR_LIST_ENTRY_SIZE <= list.len() {
                            let entry_ty = u32::from_le_bytes([
                                list[list_offset],
                                list[list_offset + 1],
                                list[list_offset + 2],
                                list[list_offset + 3],
                            ]);
                            let entry_len =
                                u16::from_le_bytes([list[list_offset + 4], list[list_offset + 5]])
                                    as usize;
                            if entry_len == 0 {
                                break;
                            }
                            let entry_name_length = list[list_offset + 6];
                            if entry_ty == DATA_TYPE && entry_name_length == 0 {
                                let base_ref = u64::from_le_bytes(
                                    list[list_offset + 16..list_offset + 24].try_into().unwrap(),
                                ) & 0xffff_ffff_ffff;
                                external_data_refs.push(base_ref);
                            }
                            list_offset += entry_len;
                        }
                    }
                }
            }
        }

        offset += length;
    }

    ParsedRecord {
        file_names,
        direct_data,
        external_data_refs,
    }
}

/// Reads the whole `$MFT` data stream into memory.
fn bulk_read_mft_data<T: Read + Seek>(ntfs: &Ntfs, fs: &mut T) -> Result<Vec<u8>, String> {
    let mft_file = ntfs.file(fs, 0).map_err(|e| e.to_string())?;
    let data_item = mft_file
        .data(fs, "")
        .ok_or_else(|| "$MFT has no unnamed $DATA attribute".to_string())?
        .map_err(|e| e.to_string())?;
    let attribute = data_item.to_attribute().map_err(|e| e.to_string())?;
    let mut value = attribute.value(fs).map_err(|e| e.to_string())?;
    let len = value.len();
    let mut buf = vec![0u8; len as usize];
    value.read_exact(fs, &mut buf).map_err(|e| e.to_string())?;
    Ok(buf)
}

/// Offset of `base_file_record` in the File Record header; zero for a
/// base record.
const BASE_FILE_RECORD_OFFSET: usize = 32;

/// Fixes up (in place) and parses every record in a bulk-read `$MFT`,
/// returning the `$FILE_NAME`s grouped by parent record number. The
/// tree is then built from this map without further I/O.
///
/// Records with many attributes (hard links, fragmented files) spill
/// into extension records, referenced from the base record's
/// `$ATTRIBUTE_LIST`. Two cases to handle:
/// 1. Children always reference the base record, so a `$FILE_NAME`
///    found in an extension record is keyed by its `base_file_record`.
/// 2. `$DATA` can live in an extension record (e.g. registry hives).
///    Pass 1 collects those references, pass 2 resolves them once all
///    records are fixed up.
fn bulk_parse_mft(data: &mut [u8], file_record_size: u32) -> HashMap<u64, Vec<(u64, RawFileName)>> {
    let mut children_by_parent: HashMap<u64, Vec<(u64, RawFileName)>> = HashMap::new();
    let record_size = file_record_size as usize;
    if record_size == 0 || record_size < BASE_FILE_RECORD_OFFSET + 8 {
        return children_by_parent;
    }

    let mut authoritative_sizes: HashMap<u64, (u64, u64)> = HashMap::new();
    let mut pending_data_lookup: HashMap<u64, Vec<u64>> = HashMap::new();

    // Pass 1: fix up and parse every record (in parallel, records are
    // independent), then merge into the maps sequentially. Most of the
    // time goes here, not in I/O.
    let per_record_results: Vec<RecordResult> = data
        .par_chunks_exact_mut(record_size)
        .enumerate()
        .filter_map(|(i, record)| {
            apply_fixup(record)?;

            let base_file_reference = u64::from_le_bytes(
                record[BASE_FILE_RECORD_OFFSET..BASE_FILE_RECORD_OFFSET + 8]
                    .try_into()
                    .unwrap(),
            );
            let base_record_number = base_file_reference & 0xffff_ffff_ffff;
            let owner_record_number = if base_record_number == 0 {
                i as u64
            } else {
                base_record_number
            };

            let parsed = parse_record(record);
            if parsed.direct_data.is_none()
                && parsed.external_data_refs.is_empty()
                && parsed.file_names.is_empty()
            {
                return None;
            }
            Some(RecordResult {
                owner_record_number,
                direct_data: parsed.direct_data,
                external_data_refs: parsed.external_data_refs,
                file_names: parsed.file_names,
            })
        })
        .collect();

    for r in per_record_results {
        if let Some(sz) = r.direct_data {
            authoritative_sizes
                .entry(r.owner_record_number)
                .or_insert(sz);
        }
        if !r.external_data_refs.is_empty() {
            pending_data_lookup
                .entry(r.owner_record_number)
                .or_default()
                .extend(r.external_data_refs);
        }
        for fname in r.file_names {
            children_by_parent
                .entry(fname.parent_record_number)
                .or_default()
                .push((r.owner_record_number, fname));
        }
    }

    // Pass 2: look up $DATA in the extension records found in pass 1.
    for (owner, candidates) in &pending_data_lookup {
        if authoritative_sizes.contains_key(owner) {
            continue;
        }
        for &candidate in candidates {
            let start = candidate as usize * record_size;
            let Some(end) = start.checked_add(record_size) else {
                continue;
            };
            let Some(candidate_record) = data.get(start..end) else {
                continue;
            };
            if candidate_record.len() < 42 {
                continue;
            }
            // Already fixed up in pass 1.
            let parsed = parse_record(candidate_record);
            if let Some(sz) = parsed.direct_data {
                authoritative_sizes.insert(*owner, sz);
                break;
            }
        }
    }

    // Pass 3: use the larger of the $FILE_NAME and $DATA sizes. Either
    // can be 0 when the other is right: $FILE_NAME for some WinSxS files,
    // $DATA for OneDrive online-only files (which should show their full
    // size, like Explorer does).
    for entries in children_by_parent.values_mut() {
        for (owner, fname) in entries.iter_mut() {
            if !fname.is_directory {
                if let Some(&(size, allocated)) = authoritative_sizes.get(owner) {
                    fname.size = fname.size.max(size);
                    fname.allocated = fname.allocated.max(allocated);
                }
            }
        }
    }

    children_by_parent
}

/// Guards against cycles from a corrupt MFT.
const BULK_MAX_DEPTH: u32 = 4096;

/// Builds the `FsNode` for `record_number` from the `bulk_parse_mft`
/// map. Same filtering and cancel handling as `build_node`.
fn build_node_from_map(
    record_number: u64,
    path: String,
    name: String,
    map: &HashMap<u64, Vec<(u64, RawFileName)>>,
    options: &ScanOptions,
    state: &ScanProgressState,
    depth: u32,
) -> FsNode {
    if state.is_cancelled() || depth > BULK_MAX_DEPTH {
        return empty_folder(path, name);
    }
    state.set_current_path(&path);

    // Siblings are independent, so build them in parallel.
    let mut children: Vec<FsNode> = match map.get(&record_number) {
        Some(entries) => entries
            .par_iter()
            .filter(|(_, fname)| {
                !((fname.is_hidden && !options.show_hidden)
                    || (fname.is_system && !options.show_system))
            })
            .map(|(child_record_number, fname)| {
                let child_path = format!("{path}\\{}", fname.name);
                if fname.is_directory {
                    let mut node = build_node_from_map(
                        *child_record_number,
                        child_path,
                        fname.name.clone(),
                        map,
                        options,
                        state,
                        depth + 1,
                    );
                    node.last_modified = fname.last_modified.clone();
                    state.folders.fetch_add(1, Ordering::Relaxed);
                    node
                } else {
                    state.files.fetch_add(1, Ordering::Relaxed);
                    state.bytes.fetch_add(fname.size, Ordering::Relaxed);
                    FsNode {
                        id: child_path.clone(),
                        name: fname.name.clone(),
                        path: child_path,
                        kind: NodeKind::File,
                        size: fname.size,
                        allocated: fname.allocated,
                        file_count: 0,
                        folder_count: 0,
                        percent_of_parent: 0.0,
                        last_modified: fname.last_modified.clone(),
                        category: None,
                        children: None,
                    }
                }
            })
            .collect(),
        None => Vec::new(),
    };

    let total_size: u64 = children.iter().map(|c| c.size).sum();
    let total_allocated: u64 = children.iter().map(|c| c.allocated).sum();
    let file_count: u64 = children
        .iter()
        .map(|c| {
            if c.kind == NodeKind::File {
                1
            } else {
                c.file_count
            }
        })
        .sum();
    let folder_count: u64 = children
        .iter()
        .map(|c| {
            if c.kind == NodeKind::Folder {
                1 + c.folder_count
            } else {
                0
            }
        })
        .sum();
    for child in &mut children {
        child.percent_of_parent = if total_size > 0 {
            (child.size as f64 / total_size as f64) * 100.0
        } else {
            0.0
        };
    }

    FsNode {
        id: path.clone(),
        name,
        path,
        kind: NodeKind::Folder,
        size: total_size,
        allocated: total_allocated,
        file_count,
        folder_count,
        percent_of_parent: 100.0,
        last_modified: None,
        category: None,
        children: Some(children),
    }
}

/// Whole-drive scan: resolves the start folder through the directory
/// index, then reads and parses the entire `$MFT` and builds the tree
/// from memory.
pub fn bulk_scan_via_mft(
    root_path: &str,
    options: ScanOptions,
    state: &ScanProgressState,
) -> Result<FsNode, String> {
    let normalized = normalize_path(root_path);
    let drive_letter = drive_letter_of(&normalized).ok_or_else(|| {
        "MFT scanning only applies to local drive-rooted paths, not UNC shares".to_string()
    })?;

    let volume_path = format!(r"\\.\{drive_letter}:");
    let file = File::open(&volume_path)
        .map_err(|e| format!("cannot open raw volume {volume_path}: {e}"))?;
    let sector_reader = SectorReader::new(file, VOLUME_SECTOR_SIZE);
    // Large buffer: one long sequential read, fewer syscalls.
    let mut fs = BufReader::with_capacity(BULK_READ_BUFFER_SIZE, sector_reader);

    let mut ntfs = Ntfs::new(&mut fs).map_err(|e| e.to_string())?;
    ntfs.read_upcase_table(&mut fs).map_err(|e| e.to_string())?;

    let mut current = ntfs.root_directory(&mut fs).map_err(|e| e.to_string())?;
    let relative = &normalized[2..];
    for component in relative.split('\\').filter(|c| !c.is_empty()) {
        let index = current
            .directory_index(&mut fs)
            .map_err(|e| e.to_string())?;
        let mut finder = index.finder();
        let entry = NtfsFileNameIndex::find(&mut finder, &ntfs, &mut fs, component)
            .ok_or_else(|| format!("\"{component}\" not found via the MFT index"))?
            .map_err(|e| e.to_string())?;
        current = entry.to_file(&ntfs, &mut fs).map_err(|e| e.to_string())?;
    }
    if !current.is_directory() {
        return Err("target path is not a directory".to_string());
    }

    let record_number = current.file_record_number();
    let name = Path::new(&normalized)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| normalized.clone());
    let root_modified = current
        .info()
        .ok()
        .and_then(|info| ntfs_time_to_iso8601(info.modification_time()));

    let mut data = bulk_read_mft_data(&ntfs, &mut fs)?;
    let file_record_size = ntfs.file_record_size();
    let map = bulk_parse_mft(&mut data, file_record_size);
    let mut root = build_node_from_map(record_number, normalized, name, &map, &options, state, 0);
    root.last_modified = root_modified;
    Ok(root)
}

#[cfg(test)]
mod bulk_mft_tests {
    use super::*;
    use crate::models::scan::MAX_CHILDREN_PER_NODE;
    use std::time::Instant;

    /// Compares child counts of some second-level folders under
    /// `MFT_BENCH_PATH` between the bulk map and a directory index walk.
    /// Needs an elevated shell:
    /// `cargo test bulk_mft -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn bulk_mft_diagnose_level2_divergence() {
        let target = std::env::var("MFT_BENCH_PATH").unwrap_or_else(|_| r"C:\Windows".to_string());
        let normalized = normalize_path(&target);
        let drive_letter = drive_letter_of(&normalized).expect("drive-rooted path");
        let volume_path = format!(r"\\.\{drive_letter}:");
        let file = File::open(&volume_path).expect("open raw volume");
        let sector_reader = SectorReader::new(file, VOLUME_SECTOR_SIZE);
        let mut fs = BufReader::new(sector_reader);
        let mut ntfs = Ntfs::new(&mut fs).expect("Ntfs::new");
        ntfs.read_upcase_table(&mut fs).expect("read_upcase_table");

        let mut current = ntfs.root_directory(&mut fs).expect("root_directory");
        let relative = &normalized[2..];
        for component in relative.split('\\').filter(|c| !c.is_empty()) {
            let index = current.directory_index(&mut fs).expect("directory_index");
            let mut finder = index.finder();
            let entry = NtfsFileNameIndex::find(&mut finder, &ntfs, &mut fs, component)
                .unwrap_or_else(|| panic!("{component} not found"))
                .expect("index entry");
            current = entry.to_file(&ntfs, &mut fs).expect("to_file");
        }
        let root_record_number = current.file_record_number();

        let mut data = bulk_read_mft_data(&ntfs, &mut fs).expect("bulk_read_mft_data");
        let file_record_size = ntfs.file_record_size();
        println!(
            "file_record_size={file_record_size} mft_bytes={}",
            data.len()
        );
        let map = bulk_parse_mft(&mut data, file_record_size);

        let empty: Vec<(u64, RawFileName)> = Vec::new();
        let root_entries = map.get(&root_record_number).unwrap_or(&empty);
        println!("root direct children (map): {}", root_entries.len());

        // List the root directly for comparison.
        let live_index = current.directory_index(&mut fs).expect("directory_index");
        let mut live_iter = live_index.entries();
        let mut live_root_count = 0u64;
        while let Some(entry) = live_iter.next(&mut fs) {
            let entry = entry.expect("entry");
            let Some(key) = entry.key() else { continue };
            let file_name: NtfsFileName = key.expect("key");
            if file_name.namespace() == NtfsFileNamespace::Dos {
                continue;
            }
            live_root_count += 1;
        }
        println!("root direct children (live): {live_root_count}");

        // Now drill into up to 8 folder children and compare each.
        let mut checked = 0;
        for (child_record_number, fname) in root_entries {
            if !fname.is_directory || checked >= 8 {
                continue;
            }
            checked += 1;
            let map_count = map.get(child_record_number).map(|v| v.len()).unwrap_or(0) as u64;

            // Index walk of this child.
            let index = current.directory_index(&mut fs).expect("directory_index");
            let mut finder = index.finder();
            let entry = NtfsFileNameIndex::find(&mut finder, &ntfs, &mut fs, &fname.name);
            let live_count = match entry {
                Some(Ok(e)) => {
                    let child_file = e.to_file(&ntfs, &mut fs).expect("to_file");
                    if !child_file.is_directory() {
                        println!("  {} -> not a directory live??", fname.name);
                        continue;
                    }
                    let idx = child_file
                        .directory_index(&mut fs)
                        .expect("directory_index");
                    let mut it = idx.entries();
                    let mut n = 0u64;
                    while let Some(e) = it.next(&mut fs) {
                        let e = e.expect("entry");
                        let Some(k) = e.key() else { continue };
                        let fname2: NtfsFileName = k.expect("key");
                        if fname2.namespace() == NtfsFileNamespace::Dos {
                            continue;
                        }
                        n += 1;
                    }
                    n
                }
                _ => {
                    println!("  {} -> not found live??", fname.name);
                    continue;
                }
            };
            println!(
                "  {:60} record={:<10} map={:<6} live={:<6} {}",
                fname.name,
                child_record_number,
                map_count,
                live_count,
                if map_count != live_count {
                    "<-- MISMATCH"
                } else {
                    ""
                }
            );
        }
    }

    /// Dumps all attributes of one file's base and extension records
    /// (`MFT_BENCH_FILE`), for debugging size mismatches.
    #[test]
    #[ignore]
    fn bulk_mft_dump_one_file_record() {
        let target =
            std::env::var("MFT_BENCH_FILE").expect("set MFT_BENCH_FILE to a full file path");
        let normalized = normalize_path(&target);
        let drive_letter = drive_letter_of(&normalized).expect("drive-rooted path");
        let volume_path = format!(r"\\.\{drive_letter}:");
        let file = File::open(&volume_path).expect("open raw volume");
        let sector_reader = SectorReader::new(file, VOLUME_SECTOR_SIZE);
        let mut fs = BufReader::new(sector_reader);
        let mut ntfs = Ntfs::new(&mut fs).expect("Ntfs::new");
        ntfs.read_upcase_table(&mut fs).expect("read_upcase_table");

        let mut current = ntfs.root_directory(&mut fs).expect("root_directory");
        let relative = &normalized[2..];
        for component in relative.split('\\').filter(|c| !c.is_empty()) {
            let index = current.directory_index(&mut fs).expect("directory_index");
            let mut finder = index.finder();
            let entry = NtfsFileNameIndex::find(&mut finder, &ntfs, &mut fs, component)
                .unwrap_or_else(|| panic!("{component} not found"))
                .expect("index entry");
            current = entry.to_file(&ntfs, &mut fs).expect("to_file");
        }
        let target_record_number = current.file_record_number();
        println!("target record_number={target_record_number}");

        let mut data = bulk_read_mft_data(&ntfs, &mut fs).expect("bulk_read_mft_data");
        let file_record_size = ntfs.file_record_size() as usize;

        fn dump_record(data: &mut [u8], file_record_size: usize, record_number: u64, label: &str) {
            let start = record_number as usize * file_record_size;
            let end = start + file_record_size;
            let record = &mut data[start..end];
            if apply_fixup(record).is_none() {
                println!("[{label}] record {record_number}: fixup FAILED");
                return;
            }
            let base_file_reference = u64::from_le_bytes(
                record[BASE_FILE_RECORD_OFFSET..BASE_FILE_RECORD_OFFSET + 8]
                    .try_into()
                    .unwrap(),
            );
            let base_record_number = base_file_reference & 0xffff_ffff_ffff;
            let flags = u16::from_le_bytes([record[22], record[23]]);
            println!(
                "[{label}] record {record_number}: in_use={} is_directory={} base_record={}",
                flags & 1 != 0,
                flags & 2 != 0,
                base_record_number
            );

            let first_attribute_offset = u16::from_le_bytes([record[20], record[21]]) as usize;
            let mut offset = first_attribute_offset;
            let mut attr_list_entries: Vec<u64> = Vec::new();
            while offset + 16 <= record.len() {
                let ty = u32::from_le_bytes([
                    record[offset],
                    record[offset + 1],
                    record[offset + 2],
                    record[offset + 3],
                ]);
                if ty == 0xFFFF_FFFF {
                    break;
                }
                let length = u32::from_le_bytes([
                    record[offset + 4],
                    record[offset + 5],
                    record[offset + 6],
                    record[offset + 7],
                ]) as usize;
                if length < 16 || offset + length > record.len() {
                    println!(
                        "  [{label}] attr ty=0x{ty:x} at {offset}: bad length {length}, stopping"
                    );
                    break;
                }
                let is_non_resident = record[offset + 8];
                println!(
                    "  [{label}] attr ty=0x{ty:x} length={length} non_resident={is_non_resident}"
                );
                if ty == 0x30 && is_non_resident == 0 {
                    let value_length = u32::from_le_bytes([
                        record[offset + 16],
                        record[offset + 17],
                        record[offset + 18],
                        record[offset + 19],
                    ]) as usize;
                    let value_offset =
                        u16::from_le_bytes([record[offset + 20], record[offset + 21]]) as usize;
                    let vs = offset + value_offset;
                    let ve = vs + value_length;
                    if ve <= record.len() {
                        if let Some(fname) = parse_file_name_value(&record[vs..ve]) {
                            println!(
                                "      FILE_NAME parent={} name={:?} size={} allocated={} is_dir={}",
                                fname.parent_record_number,
                                fname.name,
                                fname.size,
                                fname.allocated,
                                fname.is_directory
                            );
                        } else {
                            println!("      FILE_NAME (skipped - Dos namespace or invalid)");
                        }
                    }
                }
                if ty == 0x20 && is_non_resident == 0 {
                    let value_length = u32::from_le_bytes([
                        record[offset + 16],
                        record[offset + 17],
                        record[offset + 18],
                        record[offset + 19],
                    ]) as usize;
                    let value_offset =
                        u16::from_le_bytes([record[offset + 20], record[offset + 21]]) as usize;
                    let vs = offset + value_offset;
                    let ve = vs + value_length;
                    if ve <= record.len() {
                        let v = &record[vs..ve];
                        let mut o = 0usize;
                        while o + 26 <= v.len() {
                            let entry_ty = u32::from_le_bytes([v[o], v[o + 1], v[o + 2], v[o + 3]]);
                            let entry_len = u16::from_le_bytes([v[o + 4], v[o + 5]]) as usize;
                            if entry_len == 0 {
                                break;
                            }
                            let base_ref =
                                u64::from_le_bytes(v[o + 16..o + 24].try_into().unwrap())
                                    & 0xffff_ffff_ffff;
                            println!(
                                "      ATTR_LIST entry ty=0x{entry_ty:x} base_record={base_ref}"
                            );
                            if entry_ty == 0x30 {
                                attr_list_entries.push(base_ref);
                            }
                            o += entry_len;
                        }
                    }
                } else if ty == 0x20 {
                    println!("      ATTR_LIST is non-resident - not dumped here");
                }
                offset += length;
            }
            for ext_record in attr_list_entries {
                if ext_record != record_number {
                    println!("  -> following extension/base record {ext_record}");
                }
            }
        }

        dump_record(&mut data, file_record_size, target_record_number, "target");
    }

    /// Prints the full tree size next to the trimmed `scan-complete`
    /// payload size for a large target.
    #[test]
    #[ignore]
    fn bulk_mft_capped_payload_size() {
        let target = std::env::var("MFT_BENCH_PATH").unwrap_or_else(|_| r"C:\".to_string());
        let options = ScanOptions::default();
        let state = ScanProgressState::new();
        let root = bulk_scan_via_mft(&target, options, &state).expect("bulk_scan_via_mft failed");

        fn count_nodes(n: &FsNode) -> u64 {
            1 + n
                .children
                .as_deref()
                .unwrap_or(&[])
                .iter()
                .map(count_nodes)
                .sum::<u64>()
        }
        fn max_direct_children(n: &FsNode) -> usize {
            let here = n.children.as_ref().map(|c| c.len()).unwrap_or(0);
            n.children
                .as_deref()
                .unwrap_or(&[])
                .iter()
                .map(max_direct_children)
                .fold(here, usize::max)
        }

        println!(
            "[cached full tree] nodes={} widest_folder={} true_files={} true_folders={}",
            count_nodes(&root),
            max_direct_children(&root),
            root.file_count,
            root.folder_count,
        );

        let transport = crate::models::scan::truncate_for_transport(
            &root,
            crate::models::scan::TRANSPORT_DEPTH,
        );
        let widest = max_direct_children(&transport);
        let transport_json = serde_json::to_vec(&transport).expect("serialize");
        println!(
            "[actual scan-complete payload] nodes={} widest_folder={widest} json_bytes={} ({:.1} MB)",
            count_nodes(&transport),
            transport_json.len(),
            transport_json.len() as f64 / 1_048_576.0,
        );
        assert!(
            widest <= MAX_CHILDREN_PER_NODE,
            "a folder still serialized {widest} direct children, over the {MAX_CHILDREN_PER_NODE} cap"
        );
        assert_eq!(transport.file_count, root.file_count);
    }

    /// Two bulk scans back to back, to measure how much the counts
    /// change between runs on a busy volume.
    #[test]
    #[ignore]
    fn bulk_mft_self_consistency() {
        let target = std::env::var("MFT_BENCH_PATH").unwrap_or_else(|_| r"C:\Windows".to_string());
        let options = ScanOptions::default();

        let state_a = ScanProgressState::new();
        let a = bulk_scan_via_mft(&target, options, &state_a).expect("run 1 failed");
        let state_b = ScanProgressState::new();
        let b = bulk_scan_via_mft(&target, options, &state_b).expect("run 2 failed");

        println!(
            "run1: files={:<8} folders={:<8} bytes={}",
            a.file_count, a.folder_count, a.size
        );
        println!(
            "run2: files={:<8} folders={:<8} bytes={}",
            b.file_count, b.folder_count, b.size
        );
        println!(
            "diff: files={} folders={} bytes={}",
            a.file_count.abs_diff(b.file_count),
            a.folder_count.abs_diff(b.folder_count),
            a.size.abs_diff(b.size)
        );
    }

    #[test]
    #[ignore]
    fn bulk_mft_matches_and_beats_directory_index_scan() {
        let target = std::env::var("MFT_BENCH_PATH").unwrap_or_else(|_| r"C:\Windows".to_string());
        let options = ScanOptions::default();

        let state_a = ScanProgressState::new();
        let start_a = Instant::now();
        let bulk_result = bulk_scan_via_mft(&target, options, &state_a);
        let bulk_elapsed = start_a.elapsed();

        let state_b = ScanProgressState::new();
        let start_b = Instant::now();
        let index_result = try_mft_scan(&target, options, &state_b);
        let index_elapsed = start_b.elapsed();

        let bulk = bulk_result.expect("bulk_scan_via_mft failed");
        let index = index_result.expect("try_mft_scan failed");

        println!(
            "bulk:  {:>8?}  files={:<8} folders={:<8} bytes={}",
            bulk_elapsed, bulk.file_count, bulk.folder_count, bulk.size
        );
        println!(
            "index: {:>8?}  files={:<8} folders={:<8} bytes={}",
            index_elapsed, index.file_count, index.folder_count, index.size
        );

        // The volume changes between the two scans (temp files, caches),
        // so allow a small difference.
        let file_diff = bulk.file_count.abs_diff(index.file_count);
        let folder_diff = bulk.folder_count.abs_diff(index.folder_count);
        let max_allowed = (index.file_count + index.folder_count) / 200 + 50; // ~0.5% + slack
        if file_diff + folder_diff > max_allowed
            || bulk.size.abs_diff(index.size) > index.size / 100
        {
            let mut bulk_files: HashMap<String, u64> = HashMap::new();
            let mut index_files: HashMap<String, u64> = HashMap::new();
            fn flatten(n: &FsNode, out: &mut HashMap<String, u64>) {
                if n.kind == NodeKind::File {
                    out.insert(n.path.clone(), n.size);
                } else {
                    for c in n.children.as_deref().unwrap_or(&[]) {
                        flatten(c, out);
                    }
                }
            }
            flatten(&bulk, &mut bulk_files);
            flatten(&index, &mut index_files);

            let mut diffs: Vec<(String, i64, u64, u64)> = Vec::new();
            for (path, &bsize) in &bulk_files {
                match index_files.get(path) {
                    Some(&isize_) if isize_ != bsize => {
                        diffs.push((path.clone(), bsize as i64 - isize_ as i64, bsize, isize_));
                    }
                    None => diffs.push((path.clone(), bsize as i64, bsize, 0)),
                    _ => {}
                }
            }
            for (path, &isize_) in &index_files {
                if !bulk_files.contains_key(path) {
                    diffs.push((path.clone(), -(isize_ as i64), 0, isize_));
                }
            }
            diffs.sort_by_key(|(_, d, _, _)| -d.abs());
            println!("top size-diverging file paths (bulk_size, index_size):");
            for (path, d, b, ix) in diffs.iter().take(20) {
                println!("  diff={d:<15} bulk={b:<15} index={ix:<15} {path}");
            }
            println!(
                "bulk_files.len()={} index_files.len()={}",
                bulk_files.len(),
                index_files.len()
            );
        }

        assert!(
            file_diff + folder_diff <= max_allowed,
            "counts diverged too much: bulk={}f/{}d index={}f/{}d (allowed diff {})",
            bulk.file_count,
            bulk.folder_count,
            index.file_count,
            index.folder_count,
            max_allowed
        );
    }
}
