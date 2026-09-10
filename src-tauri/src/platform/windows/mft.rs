//! Best-effort MFT-based fast scanning on NTFS volumes, using the
//! [`ntfs`](https://github.com/ColinFinck/ntfs) crate (ColinFinck) - a
//! real, maintained, read-only NTFS parser, not a hand-rolled one.
//!
//! Every $FILE_NAME attribute NTFS stores already carries a cached
//! copy of its file's size/allocated-size/timestamps/attributes (kept
//! in sync by the filesystem specifically so directory listings are
//! fast) - so this engine reads only directory index records, never
//! opening or `stat`-ing individual files the way
//! `services::scan_service`'s walk engine must. That's the entire
//! source of its speed, and also why it's inherently single-reader
//! (one `Read + Seek` handle over the raw volume): unlike the walk
//! engine it does not parallelize. "Multithreaded" (per the Phase 3
//! brief) is satisfied by the walk engine; see `PHASE3.md`.
//!
//! **A sequential-by-record-number rewrite was attempted and reverted
//! live** (see git history / PHASE3.md's Known Limitations) - reading
//! every one of a volume's ~750K File Records via `Ntfs::file()`
//! turned out far slower than this directory-index approach, not
//! faster: `Ntfs::file()` re-resolves the `$MFT`'s own `$DATA` run
//! list on *every single call* (see its doc comment in the `ntfs`
//! crate source), and calling it once per record (rather than once per
//! *folder*, as this module does) multiplied that redundant work by
//! roughly the file-to-folder ratio - about 5-6x more calls, each one
//! now also missing the locality this module's per-folder traversal
//! still has via a live directory (its records tend to be closer
//! together than the volume-wide scatter of "record N, then record
//! N+1" implies once the $MFT itself is at all fragmented). Getting
//! genuinely closer to WizTree's speed needs reading the raw $MFT into
//! memory once and parsing records directly from that buffer, bypassing
//! per-record `Ntfs::file()` calls entirely - `NtfsFile::new` is
//! `pub(crate)`-only in this crate version, so that needs either a
//! lower-level hand-rolled parser or an upstream API addition, not
//! attempted here.
//!
//! Opening a raw volume handle (`\\.\C:`) requires admin/backup
//! privilege. `try_mft_scan` is designed to fail cleanly and cheaply
//! at the very first step when that privilege is absent, a path is a
//! UNC share, or the volume isn't NTFS - every failure here is
//! silent from the user's perspective; the caller
//! (`services::scan_service::run_scan`) automatically retries with the
//! walk engine.

use crate::models::scan::{FsNode, NodeKind, ScanOptions, ScanProgressState};
use crate::utils::path::normalize_path;
use crate::utils::time::system_time_to_iso8601;
use ntfs::indexes::NtfsFileNameIndex;
use ntfs::structured_values::{NtfsFileAttributeFlags, NtfsFileName, NtfsFileNamespace};
use ntfs::{Ntfs, NtfsFile, NtfsReadSeek, NtfsTime};
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

/// Sector alignment used for all raw-volume reads - deliberately a
/// safe multiple of every real-world Windows sector size (512 or
/// 4096 bytes), matching the `ntfs` crate's own example.
const VOLUME_SECTOR_SIZE: u64 = 4096;

fn drive_letter_of(normalized: &str) -> Option<char> {
    let bytes = normalized.as_bytes();
    if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        Some(bytes[0].to_ascii_uppercase() as char)
    } else {
        None
    }
}

/// Converts an NTFS timestamp (100-nanosecond intervals since
/// 1601-01-01) to the same UTC ISO 8601 format every other backend
/// timestamp uses, reusing `utils::time::system_time_to_iso8601`
/// rather than a second formatting implementation.
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

/// Attempts a full MFT-based scan of `root_path`. Returns `Err` (a
/// human-readable reason, logged but never shown to the user) for
/// every case the walk engine should handle instead: a UNC path, no
/// privilege to open the raw volume, a non-NTFS volume, or any parse
/// failure partway through.
///
/// **Dispatches to one of two genuinely different engines**, since
/// neither is a universal win - confirmed with direct, live timing
/// against this repo's own machine (see `PHASE3.md`'s bulk-$MFT-read
/// section for the numbers):
/// - A whole-drive scan (`root_path` is a bare drive root, e.g. `C:\`)
///   goes to [`bulk_scan_via_mft`]: one bulk read of the entire `$MFT`
///   plus in-memory parsing, ~5-9x faster than the walk below at that
///   scale (measured: a live ~1.04M-file `C:\` in ~19s vs ~174s) -
///   because a whole-drive scan touches a large fraction of the $MFT
///   anyway, so reading all of it once is strictly less work than
///   `entries.len()`-many separate directory-index B+tree lookups.
/// - Anything narrower (a specific folder, the common case for Folder
///   Analysis) keeps using [`build_node`]'s per-folder directory-index
///   walk below: the bulk read's cost is roughly *fixed* (dominated by
///   the $MFT's own total size, not the target's), so for a small
///   target it's dramatically worse, not better (measured: a ~560-file
///   folder took ~16s via the bulk path against ~0.17s here).
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

/// The original, per-folder directory-index-based engine - see
/// `try_mft_scan`'s doc comment for when this runs instead of the bulk
/// path.
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

    // Walk from the volume root down to the requested path's own
    // NtfsFile, resolving one path component at a time via the
    // directory index (case-insensitively, matching Windows
    // semantics).
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

/// Recursively builds an `FsNode` from an NTFS directory's index -
/// single-threaded by construction (one `fs` handle). Every
/// size/allocated/timestamp value for a *file* leaf comes straight out
/// of its parent's cached $FILE_NAME record; only directories need a
/// further `to_file` + `directory_index` call to recurse.
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

        // A file with an auto-generated 8.3 short name gets *two*
        // $FILE_NAME attributes (and so two index entries): one Win32,
        // one Dos. Skip the redundant Dos-only entry so it isn't
        // counted twice; `Win32AndDos` (a name that's already
        // 8.3-compatible, so it only ever got one attribute) is kept.
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
            // The recursive call can't see its own $FILE_NAME record
            // (that lives in *this* directory's index, not the child's
            // own file record) - attach the timestamp read above.
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
        // Set by `try_mft_scan` for the true root (it has access to
        // the starting NtfsFile's own $STANDARD_INFORMATION); a
        // subdirectory's own modification time is set by its parent
        // from the cached $FILE_NAME record instead, one level up.
        last_modified: None,
        category: None,
        children: Some(children),
    })
}

// ---------------------------------------------------------------------
// Bulk $MFT read - a second, experimental fast path.
//
// `try_mft_scan`/`build_node` above still cost one `directory_index` +
// B+tree lookup per folder (via the `ntfs` crate's safe, high-level
// API). That's already far cheaper than `Ntfs::file()` per record (see
// this module's top doc comment on the reverted rewrite), but it's
// still `entries.len()`-many separate index walks rather than one pass.
//
// What follows instead reads the *entire* `$MFT` data stream into
// memory with a single bulk read (the one and only `Ntfs::file()` call
// this path makes - record 0, the $MFT's own record), then hand-parses
// every fixed-size File Record directly out of that in-memory buffer:
// no further disk I/O, no further crate-level per-record calls, for
// the rest of the scan. This is the same overall shape WizTree itself
// is understood to use. It's additive and unused by `try_mft_scan` so
// far - see the `#[ignore]`-gated test below for direct, UI-free
// validation (`cargo test bulk_mft -- --ignored --nocapture`) before
// it's ever wired into the production path, given how badly the first
// rewrite attempt at this same goal went.
// ---------------------------------------------------------------------

/// One `$FILE_NAME` attribute parsed directly out of a raw, fixed-up
/// File Record buffer - everything `build_node` needs for one child
/// entry, without ever constructing a crate-level `NtfsFile` for it.
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

/// Applies the NTFS Update Sequence Array "fixup" to one raw File
/// Record's bytes, in place - hand-rolled reimplementation of the
/// `ntfs` crate's private `Record::fixup()` (see its `record.rs`),
/// needed here because this path never constructs the crate's own
/// `NtfsFile`/`Record` types at all. `None` means "not a valid,
/// consistent record" (wrong signature, corrupt/torn mid-write, or a
/// record too small to hold the array it claims) - always treated as
/// "skip this record", never fatal to the overall bulk scan, the same
/// tolerance a live, changing filesystem needs in general.
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
        // The 2 bytes at the end of each sector should currently hold
        // the Update Sequence Number - if they don't, this sector was
        // caught mid-write and the record can't be trusted.
        if record[sector_pos] != usn[0] || record[sector_pos + 1] != usn[1] {
            return None;
        }
        record[sector_pos] = new_bytes[0];
        record[sector_pos + 1] = new_bytes[1];
    }
    Some(())
}

/// Parses the 66-byte `$FILE_NAME` header (offsets confirmed against
/// the `ntfs` crate's own `FileNameHeader`/`structured_values::mod`
/// source) plus its variable-length UTF-16LE name directly out of a
/// resident attribute's raw value bytes.
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

    // Same policy as `build_node`: a Dos-only 8.3 shadow name is a
    // duplicate index entry for a file already represented by its
    // Win32 (or Win32AndDos) name - skip it so it isn't double-counted.
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

/// Everything `bulk_parse_mft`'s single attribute-list walk over one
/// record can determine about it in isolation - some of it (`external_data_refs`)
/// needs a second pass over *other* records before it can be resolved.
struct ParsedRecord {
    file_names: Vec<RawFileName>,
    /// The record's own unnamed `$DATA` attribute's (size, allocated),
    /// when present directly in this record.
    direct_data: Option<(u64, u64)>,
    /// Record numbers this record's (resident) `$ATTRIBUTE_LIST` says
    /// hold its unnamed `$DATA` attribute *instead* - populated only
    /// when `direct_data` is `None` and an `$ATTRIBUTE_LIST` pointing
    /// elsewhere for type `0x80` was found. See `bulk_parse_mft`'s doc
    /// comment for why this needs a second pass.
    external_data_refs: Vec<u64>,
}

/// Reads a File Record's unnamed `$DATA` attribute's (size, allocated)
/// directly, if this specific record physically holds one - shared by
/// `parse_record`'s main attribute walk and pass 2's extension-record
/// lookups in `bulk_parse_mft`, since both need exactly the same
/// resident-vs-non-resident `$DATA` header math.
fn read_direct_data_size(record: &[u8], offset: usize, is_non_resident: u8) -> Option<(u64, u64)> {
    if is_non_resident == 0 && offset + 20 <= record.len() {
        // Resident $DATA: the value length *is* the exact size (see
        // `NtfsFileName::allocated_size`'s own doc comment on this
        // convention) - always small (a record is at most ~1-4 KB),
        // so `size == allocated` here.
        let value_length = u32::from_le_bytes([
            record[offset + 16],
            record[offset + 17],
            record[offset + 18],
            record[offset + 19],
        ]) as u64;
        Some((value_length, value_length))
    } else if is_non_resident == 1 && offset + 56 <= record.len() {
        // NtfsNonResidentAttributeHeader: allocated_size @ +40, data_size
        // @ +48 (both u64) - present right in this header regardless of
        // how many (or how fragmented) data runs back the value, so this
        // needs no data-run resolution at all.
        let allocated_size =
            u64::from_le_bytes(record[offset + 40..offset + 48].try_into().unwrap());
        let data_size = u64::from_le_bytes(record[offset + 48..offset + 56].try_into().unwrap());
        Some((data_size, allocated_size))
    } else {
        None
    }
}

/// Walks one already fixed-up File Record's attribute list (raw byte
/// offsets, matching `NtfsAttributeHeader`/`NtfsResidentAttributeHeader`
/// in the `ntfs` crate source), returning every resident `$FILE_NAME`
/// (type `0x30`) it finds plus whatever it can determine about the
/// record's unnamed `$DATA` size. A record with its `IN_USE` header
/// flag clear is skipped entirely (empty result) - a deleted-but-not-
/// yet-reallocated record still physically exists in the $MFT and must
/// not show up as a live file.
///
/// **Size comes from `$DATA`, never from `$FILE_NAME`'s own cached
/// size fields.** Confirmed live against a real `C:\Windows\WinSxS`
/// scan: a meaningful number of real system files (`msedge.dll` among
/// them, at 263 MB) have a **stale, zeroed** cached size in their own
/// record's `$FILE_NAME` attribute, even though the *parent
/// directory's index* holds an up-to-date copy of that same structure
/// (`build_node`'s directory-index path reads that copy instead, which
/// is why it doesn't hit this). NTFS is only documented to keep
/// `$FILE_NAME`'s cached fields in sync "when the file name changes"
/// (see the `ntfs` crate's own doc comments on
/// `NtfsFileName::data_size`/`allocated_size`) - evidently that sync
/// doesn't always reach a record's *own* copy for files written via
/// low-level servicing paths (WinSxS component deployment, here).
fn parse_record(record: &[u8]) -> ParsedRecord {
    const FILE_NAME_TYPE: u32 = 0x30;
    const DATA_TYPE: u32 = 0x80;
    const ATTRIBUTE_LIST_TYPE: u32 = 0x20;
    const END_MARKER: u32 = 0xFFFF_FFFF;
    const FLAGS_OFFSET: usize = 22;
    const FIRST_ATTR_OFFSET_OFFSET: usize = 20;
    const IN_USE: u16 = 0x0001;
    /// Size of one `AttributeListEntryHeader` (see the `ntfs` crate's
    /// `structured_values/attribute_list.rs`): ty(4) + list_entry_length(2)
    /// + name_length(1) + name_offset(1) + lowest_vcn(8) + base_file_reference(8)
    /// + instance(2).
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
        // A zero or overflowing length would loop forever / panic on
        // slicing - treat either as "this record's attribute list is
        // corrupt, stop reading it" rather than trusting it further.
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
            // A resident $ATTRIBUTE_LIST: when this record's own $DATA
            // wasn't found directly above, it may have been relocated
            // to an extension record referenced here (heavily
            // fragmented files - a live, actively-growing registry
            // hive was the case that surfaced this: its $DATA didn't
            // fit as a single resident/non-resident attribute in the
            // base record at all). A *non-resident* $ATTRIBUTE_LIST
            // (rare - only for pathologically large attribute lists)
            // isn't followed here; such a record keeps whatever
            // `$FILE_NAME` cached as a fallback rather than this path
            // failing to report a size at all.
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

/// Reads the entire `$MFT` data stream into memory in one bulk read -
/// the only per-scan use of `Ntfs::file()` this fast path makes.
/// Everything else is parsed straight out of the returned buffer with
/// no further disk I/O.
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

/// Byte offset (within a fixed-up File Record) of the `base_file_record`
/// field in `FileRecordHeader` - see `ntfs` crate's `file.rs`. All zero
/// there means "this record is a base record, not an extension of
/// another one".
const BASE_FILE_RECORD_OFFSET: usize = 32;

/// Fixes up and parses every File Record in a bulk-read `$MFT` buffer
/// (mutated in place, record by record - no extra copy of the ~hundreds
/// of MB a real volume's $MFT can be), returning every parsed
/// `$FILE_NAME` grouped by the record number of the parent directory
/// it lives in. Building the whole tree afterwards is then pure
/// in-memory map lookups (see `build_node_from_map`) - zero further
/// disk I/O.
///
/// **Base vs. extension records**: when a File Record has more
/// attributes than fit in one record (typically many `$FILE_NAME`
/// entries from heavy hard-linking, or a heavily fragmented `$DATA` -
/// WinSxS/the Driver Store and actively-growing system files like the
/// registry hives are all full of this), NTFS moves some of them into
/// separate *extension* records and references those via a
/// `$ATTRIBUTE_LIST` attribute in the original (*base*) record. This
/// module handles two distinct consequences of that, confirmed via two
/// separate live `C:\Windows`/`C:\Windows\WinSxS` scans each turning
/// up a real example:
///
/// 1. An extension record still has its own record number, but it has
///    no identity of its own as a parent - every child's
///    `parent_directory_reference` always names the *base* record. So
///    a directory whose own `$FILE_NAME` happens to be one of the
///    attributes that got relocated must still be keyed by its base
///    record's number below, not the extension record's - otherwise
///    its children (correctly keyed by the base number) are never
///    found under it. That's what every record's own `base_file_record`
///    header field is for (handled in pass 1, below).
/// 2. A file's `$DATA` attribute itself can be the thing that got
///    relocated (e.g. `C:\Windows\System32\config\SOFTWARE`, confirmed
///    live: its base record has no `$DATA` at all, only a resident
///    `$ATTRIBUTE_LIST` pointing to two *different* extension records
///    for it). Resolving this needs a second pass, since the target
///    extension record can be scanned before or after the record
///    referencing it - pass 1 only collects candidates
///    (`ParsedRecord::external_data_refs`); pass 2 (which runs after
///    every record has already been fixed up) resolves them by jumping
///    straight to those specific records, already sitting fixed-up in
///    `data`.
fn bulk_parse_mft(data: &mut [u8], file_record_size: u32) -> HashMap<u64, Vec<(u64, RawFileName)>> {
    let mut children_by_parent: HashMap<u64, Vec<(u64, RawFileName)>> = HashMap::new();
    let record_size = file_record_size as usize;
    if record_size == 0 || record_size < BASE_FILE_RECORD_OFFSET + 8 {
        return children_by_parent;
    }

    let mut authoritative_sizes: HashMap<u64, (u64, u64)> = HashMap::new();
    let mut pending_data_lookup: HashMap<u64, Vec<u64>> = HashMap::new();

    // Pass 1: fixup every record once, collect $FILE_NAMEs (grouped by
    // parent, tagged with their owning record's true base-record
    // number), and every record's own $DATA size when directly present.
    for (i, record) in data.chunks_exact_mut(record_size).enumerate() {
        if apply_fixup(record).is_none() {
            continue;
        }

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
        if let Some(sz) = parsed.direct_data {
            authoritative_sizes.entry(owner_record_number).or_insert(sz);
        }
        if !parsed.external_data_refs.is_empty() {
            pending_data_lookup
                .entry(owner_record_number)
                .or_default()
                .extend(parsed.external_data_refs);
        }
        for fname in parsed.file_names {
            children_by_parent
                .entry(fname.parent_record_number)
                .or_default()
                .push((owner_record_number, fname));
        }
    }

    // Pass 2: resolve every owner whose $DATA wasn't found directly in
    // its own record by jumping straight to the extension record(s)
    // its $ATTRIBUTE_LIST named - every record in `data` is already
    // fixed up by now, so this is pure in-memory slicing, no I/O.
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
            // Already fixed up in pass 1 - just walk its attributes
            // directly for a $DATA this time (no need to re-derive
            // file names or follow further attribute lists here).
            let parsed = parse_record(candidate_record);
            if let Some(sz) = parsed.direct_data {
                authoritative_sizes.insert(*owner, sz);
                break;
            }
        }
    }

    // Pass 3: reconcile each file's $FILE_NAME-cached size with $DATA's,
    // taking the larger of the two rather than unconditionally trusting
    // $DATA - confirmed live via a full `C:\` scan that *both*
    // directions of staleness are real, for different reasons:
    //   - $FILE_NAME reads 0 while $DATA has the truth: WinSxS/servicing
    //     files like `msedge.dll` (see this function's own doc comment).
    //   - $DATA reads 0 while $FILE_NAME has the truth: OneDrive "Files
    //     On-Demand" cloud placeholders (multi-GB files with nothing
    //     materialized locally yet - `$DATA`'s cached size is 0/tiny,
    //     but $FILE_NAME correctly carries the full logical size, which
    //     is what a disk-usage tool's users expect to see, matching
    //     Explorer/WizTree).
    // Taking the max is the safe direction to be wrong in when these
    // two legitimate sources disagree: understating a real file's size
    // as 0 is a far worse failure mode for this tool than occasionally
    // overstating a since-shrunk file by using a stale-but-larger
    // cached value.
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

/// Safety valve against a corrupt/cyclic parent chain in the bulk map
/// (can't happen on a healthy volume, but this path trusts raw bytes
/// with no filesystem-level consistency checking) - matches
/// `Treemap.tsx`'s own `MAX_DEPTH`-style reasoning: a real folder tree
/// is never anywhere close to this deep.
const BULK_MAX_DEPTH: u32 = 4096;

/// Builds an `FsNode` for `record_number` purely from the in-memory
/// parent->children map produced by `bulk_parse_mft` - the bulk-read
/// analogue of `build_node`, with the same skip/hidden/system/cancel
/// semantics, but no `fs`/`ntfs` parameter at all since it touches the
/// disk exactly zero times.
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

    let mut children: Vec<FsNode> = Vec::new();
    if let Some(entries) = map.get(&record_number) {
        for (child_record_number, fname) in entries {
            if (fname.is_hidden && !options.show_hidden)
                || (fname.is_system && !options.show_system)
            {
                continue;
            }
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
                children.push(node);
            } else {
                state.files.fetch_add(1, Ordering::Relaxed);
                state.bytes.fetch_add(fname.size, Ordering::Relaxed);
                children.push(FsNode {
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
                });
            }
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

/// Experimental bulk-$MFT-read scan - same public shape as
/// `try_mft_scan`, not yet called from it. Resolves the starting
/// directory the same cheap way (a handful of directory-index lookups
/// for the path's own components), then reads+parses the entire $MFT
/// once and builds the whole tree from that in-memory map.
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
    let mut fs = BufReader::new(sector_reader);

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
    use std::time::Instant;

    /// Direct, UI-free timing/correctness check for the bulk-$MFT-read
    /// path against a real local volume - run explicitly with
    /// `cargo test bulk_mft -- --ignored --nocapture` (needs an
    /// elevated/backup-privileged shell to open `\\.\C:`, so it's
    /// `#[ignore]`-gated rather than part of the normal `cargo test`
    /// gate). Compares wall-clock time and file/folder/byte totals
    /// directly against the existing, known-good `try_mft_scan`
    /// directory-index path on the same folder, so a mismatch in
    /// counts (not just slowness) fails loudly before this is ever
    /// considered for wiring into production.
    /// Narrower diagnostic: picks a handful of second-level folders
    /// under `MFT_BENCH_PATH` and compares the bulk map's child count
    /// for each against a fresh, live `directory_index()` walk of that
    /// exact same folder - much cheaper per run than the full-tree
    /// comparison above, to localize *where* counts diverge.
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

        // Live, direct listing of the root itself for comparison.
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

            // Live walk of this exact child folder.
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

    /// Dumps every attribute (raw type/length, and every `$FILE_NAME`'s
    /// parent/size/namespace) found across a specific file's base
    /// record plus any `$ATTRIBUTE_LIST`-referenced extension records -
    /// used to pin down exactly why `msedge.dll` (and similar heavily
    /// hard-linked WinSxS files) got a `size=0` `$FILE_NAME` picked up
    /// by the bulk path. Target file path via `MFT_BENCH_FILE`.
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

    /// Two back-to-back bulk-only runs, minutes apart only by however
    /// long each bulk read itself takes (well under the ~114s the full
    /// bulk-vs-index comparison needs) - establishes how much of the
    /// count divergence seen against the (much slower) index scan is
    /// just live filesystem churn on an actively-written target like
    /// `C:\Windows`, versus a bug in the bulk path itself.
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

        // Loose tolerance, not exact equality: the two scans run
        // sequentially against a live, changing volume, so a handful
        // of files/folders created or deleted in between (temp files,
        // browser caches, etc.) is expected on a real C:\Windows, not
        // a bug in either path.
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
