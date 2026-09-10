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
use ntfs::{Ntfs, NtfsFile, NtfsTime};
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
pub fn try_mft_scan(
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
