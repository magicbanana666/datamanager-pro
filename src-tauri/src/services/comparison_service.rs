//! Folder comparison.
//!
//! Lists both locations with the scan engines, pairs files by relative
//! path (case-insensitive) and classifies each pair. Only `ContentHash`
//! reads file contents, and only when the sizes are equal.

use crate::models::comparison::{
    ComparisonMode, ComparisonOptions, ComparisonRow, ComparisonSide, ComparisonStatus,
    ComparisonTotals, MAX_ROWS_PER_STATUS, SMALL_FILE_BYTES,
};
use crate::models::hash_job::{HashJobPhase, HashJobState};
use crate::models::scan::{FsNode, NodeKind, ScanOptions};
use crate::services::scan_analysis_service::ExtensionTotal;
use crate::services::{hashing, scan_service};
use chrono::DateTime;
use rayon::prelude::*;
use std::collections::HashMap;

/// FAT/exFAT store modified times at 2-second resolution, so a file
/// copied to a USB stick and back can differ by up to that much without
/// being changed.
const TIMESTAMP_TOLERANCE_SECS: i64 = 2;

struct Entry {
    relative_path: String,
    full_path: String,
    size: u64,
    modified: Option<String>,
}

pub struct ComparisonOutcome {
    pub a: ComparisonSide,
    pub b: ComparisonSide,
    pub totals: ComparisonTotals,
    pub rows: Vec<ComparisonRow>,
}

pub fn compare(
    location_a: &str,
    location_b: &str,
    options: &ComparisonOptions,
    state: &HashJobState,
) -> ComparisonOutcome {
    let (side_a, files_a) = collect_side(location_a, options, state);
    let (side_b, files_b) = if state.is_cancelled() {
        (empty_side(location_b), HashMap::new())
    } else {
        collect_side(location_b, options, state)
    };

    let mut rows = Vec::new();
    let mut both: Vec<(Entry, Entry)> = Vec::new();
    let mut files_b = files_b;
    for (key, a) in files_a {
        match files_b.remove(&key) {
            Some(b) => both.push((a, b)),
            None => rows.push(one_sided(ComparisonStatus::LeftOnly, a)),
        }
    }
    rows.extend(
        files_b
            .into_values()
            .map(|b| one_sided(ComparisonStatus::RightOnly, b)),
    );
    rows.extend(classify_pairs(both, options, state));

    let totals = totals_of(&rows);
    ComparisonOutcome {
        a: side_a,
        b: side_b,
        totals,
        rows: cap_rows(rows),
    }
}

fn empty_side(location: &str) -> ComparisonSide {
    ComparisonSide {
        location: location.to_string(),
        total_bytes: 0,
        files: 0,
        folders: 0,
        last_modified: None,
        extensions: Vec::new(),
    }
}

/// Lists one side, keyed by lowercased relative path.
fn collect_side(
    location: &str,
    options: &ComparisonOptions,
    state: &HashJobState,
) -> (ComparisonSide, HashMap<String, Entry>) {
    let (tree, _engine) = scan_service::run_scan(location, ScanOptions::default(), &state.scan);
    let min_size = if options.ignore_small_files {
        SMALL_FILE_BYTES
    } else {
        0
    };

    let mut files: HashMap<String, Entry> = HashMap::new();
    let mut add = |node: &FsNode| {
        if node.size < min_size {
            return;
        }
        let relative_path = node
            .path
            .get(tree.path.len()..)
            .unwrap_or(&node.path)
            .trim_start_matches('\\')
            .to_string();
        files.insert(
            relative_path.to_lowercase(),
            Entry {
                relative_path,
                full_path: node.path.clone(),
                size: node.size,
                modified: node.last_modified.clone(),
            },
        );
    };
    let children = tree.children.as_deref().unwrap_or(&[]);
    let folders = if options.include_subfolders {
        let mut stack: Vec<&FsNode> = children.iter().collect();
        while let Some(n) = stack.pop() {
            match n.kind {
                NodeKind::File => add(n),
                NodeKind::Folder => stack.extend(n.children.as_deref().unwrap_or(&[])),
            }
        }
        tree.folder_count
    } else {
        children
            .iter()
            .filter(|c| c.kind == NodeKind::File)
            .for_each(&mut add);
        children
            .iter()
            .filter(|c| c.kind == NodeKind::Folder)
            .count() as u64
    };

    let mut extensions: HashMap<String, (u64, u64)> = HashMap::new();
    for entry in files.values() {
        let name = entry.relative_path.rsplit('\\').next().unwrap_or("");
        let total = extensions.entry(extension_of(name)).or_default();
        total.0 += 1;
        total.1 += entry.size;
    }
    let side = ComparisonSide {
        location: tree.path.clone(),
        total_bytes: files.values().map(|e| e.size).sum(),
        files: files.len() as u64,
        folders,
        last_modified: tree.last_modified.clone(),
        extensions: extensions
            .into_iter()
            .map(|(extension, (files, size))| ExtensionTotal {
                extension,
                files,
                size,
            })
            .collect(),
    };
    (side, files)
}

/// Same rule as `scan_analysis_service`: a leading dot alone means no
/// extension.
fn extension_of(name: &str) -> String {
    match name.rfind('.') {
        Some(idx) if idx > 0 => name[idx..].to_lowercase(),
        _ => String::new(),
    }
}

fn one_sided(status: ComparisonStatus, e: Entry) -> ComparisonRow {
    let left = status == ComparisonStatus::LeftOnly;
    ComparisonRow {
        status,
        relative_path: e.relative_path,
        size_a: left.then_some(e.size),
        size_b: (!left).then_some(e.size),
        modified_a: if left { e.modified.clone() } else { None },
        modified_b: if left { None } else { e.modified },
    }
}

fn classify_pairs(
    pairs: Vec<(Entry, Entry)>,
    options: &ComparisonOptions,
    state: &HashJobState,
) -> Vec<ComparisonRow> {
    if options.mode == ComparisonMode::ContentHash {
        let to_hash = pairs
            .iter()
            .filter(|(a, b)| a.size == b.size)
            .map(|(a, _)| a.size * 2)
            .sum();
        state.begin_phase(HashJobPhase::Hashing, to_hash);
    }
    pairs
        .into_par_iter()
        .map(|(a, b)| {
            let identical = !state.is_cancelled()
                && match options.mode {
                    ComparisonMode::NameOnly => true,
                    ComparisonMode::SizeTimestamp => {
                        a.size == b.size
                            && (options.ignore_timestamps
                                || same_time(a.modified.as_deref(), b.modified.as_deref()))
                    }
                    ComparisonMode::ContentHash => a.size == b.size && same_content(&a, &b, state),
                };
            ComparisonRow {
                status: if identical {
                    ComparisonStatus::Identical
                } else {
                    ComparisonStatus::Different
                },
                relative_path: a.relative_path,
                size_a: Some(a.size),
                size_b: Some(b.size),
                modified_a: a.modified,
                modified_b: b.modified,
            }
        })
        .collect()
}

fn same_time(a: Option<&str>, b: Option<&str>) -> bool {
    let parse = |s: Option<&str>| s.and_then(|s| DateTime::parse_from_rfc3339(s).ok());
    match (parse(a), parse(b)) {
        (Some(a), Some(b)) => (a - b).num_seconds().abs() <= TIMESTAMP_TOLERANCE_SECS,
        // Unknown on both sides: nothing to tell them apart by.
        (None, None) => true,
        _ => false,
    }
}

/// A file that can't be read (in use, access denied) can't be proven
/// identical, so it counts as different and is recorded as skipped.
fn same_content(a: &Entry, b: &Entry, state: &HashJobState) -> bool {
    let hash = |e: &Entry| {
        state.scan.set_current_path(&e.full_path);
        hashing::hash_file(&e.full_path, None, state)
            .map_err(|err| {
                if !state.is_cancelled() {
                    state.scan.record_skip(&e.full_path, err.to_string());
                }
            })
            .ok()
            .map(|(hash, _)| hash)
    };
    matches!((hash(a), hash(b)), (Some(x), Some(y)) if x == y)
}

fn totals_of(rows: &[ComparisonRow]) -> ComparisonTotals {
    let mut t = ComparisonTotals::default();
    for r in rows {
        let a = r.size_a.unwrap_or(0);
        let b = r.size_b.unwrap_or(0);
        match r.status {
            ComparisonStatus::Identical => {
                t.identical_files += 1;
                t.identical_bytes += a;
            }
            ComparisonStatus::Different => {
                t.different_files += 1;
                t.different_data_bytes += a.max(b);
            }
            ComparisonStatus::LeftOnly => {
                t.left_only += 1;
                t.left_only_bytes += a;
            }
            ComparisonStatus::RightOnly => {
                t.right_only += 1;
                t.right_only_bytes += b;
            }
        }
    }
    t
}

/// Keeps the largest [`MAX_ROWS_PER_STATUS`] rows of each status,
/// largest first.
fn cap_rows(mut rows: Vec<ComparisonRow>) -> Vec<ComparisonRow> {
    let size = |r: &ComparisonRow| r.size_a.unwrap_or(0).max(r.size_b.unwrap_or(0));
    rows.sort_unstable_by_key(|r| std::cmp::Reverse(size(r)));
    let mut per_status: HashMap<ComparisonStatus, usize> = HashMap::new();
    rows.retain(|r| {
        let n = per_status.entry(r.status).or_default();
        *n += 1;
        *n <= MAX_ROWS_PER_STATUS
    });
    rows
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn options(mode: ComparisonMode) -> ComparisonOptions {
        ComparisonOptions {
            mode,
            include_subfolders: true,
            ignore_timestamps: true,
            ignore_small_files: false,
        }
    }

    fn statuses(outcome: &ComparisonOutcome) -> Vec<(String, ComparisonStatus)> {
        let mut v: Vec<_> = outcome
            .rows
            .iter()
            .map(|r| (r.relative_path.clone(), r.status))
            .collect();
        v.sort();
        v
    }

    #[test]
    fn classifies_every_pair_by_content() {
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        fs::create_dir(a.path().join("Sub")).unwrap();
        fs::create_dir(b.path().join("sub")).unwrap();
        fs::write(a.path().join("Sub").join("same.txt"), b"abc").unwrap();
        fs::write(b.path().join("sub").join("SAME.txt"), b"abc").unwrap(); // case differs: still a pair
        fs::write(a.path().join("changed.txt"), b"abc").unwrap();
        fs::write(b.path().join("changed.txt"), b"abd").unwrap(); // same size, different bytes
        fs::write(a.path().join("left.txt"), b"x").unwrap();
        fs::write(b.path().join("right.txt"), b"y").unwrap();

        let state = HashJobState::new();
        let outcome = compare(
            &a.path().to_string_lossy(),
            &b.path().to_string_lossy(),
            &options(ComparisonMode::ContentHash),
            &state,
        );
        assert_eq!(
            statuses(&outcome),
            vec![
                (r"Sub\same.txt".to_string(), ComparisonStatus::Identical),
                ("changed.txt".to_string(), ComparisonStatus::Different),
                ("left.txt".to_string(), ComparisonStatus::LeftOnly),
                ("right.txt".to_string(), ComparisonStatus::RightOnly),
            ]
        );
        assert_eq!(outcome.totals.identical_files, 1);
        assert_eq!(outcome.totals.left_only_bytes, 1);
        assert_eq!(outcome.a.files, 3);

        // Size-only (timestamps ignored) can't see the changed byte.
        let state = HashJobState::new();
        let outcome = compare(
            &a.path().to_string_lossy(),
            &b.path().to_string_lossy(),
            &options(ComparisonMode::SizeTimestamp),
            &state,
        );
        assert_eq!(outcome.totals.identical_files, 2);
    }

    #[test]
    fn subfolders_and_small_files_can_be_excluded() {
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        fs::create_dir(a.path().join("deep")).unwrap();
        fs::write(a.path().join("deep").join("nested.bin"), vec![0u8; 10_000]).unwrap();
        fs::write(a.path().join("tiny.txt"), b"1").unwrap();
        fs::write(a.path().join("big.bin"), vec![0u8; 10_000]).unwrap();

        let mut opts = options(ComparisonMode::NameOnly);
        opts.include_subfolders = false;
        opts.ignore_small_files = true;
        let state = HashJobState::new();
        let outcome = compare(
            &a.path().to_string_lossy(),
            &b.path().to_string_lossy(),
            &opts,
            &state,
        );
        assert_eq!(
            statuses(&outcome),
            vec![("big.bin".to_string(), ComparisonStatus::LeftOnly)]
        );
        assert_eq!(outcome.a.folders, 1);
    }

    #[test]
    fn timestamps_tolerate_fat_resolution() {
        assert!(same_time(
            Some("2026-01-01T10:00:00Z"),
            Some("2026-01-01T10:00:02Z")
        ));
        assert!(!same_time(
            Some("2026-01-01T10:00:00Z"),
            Some("2026-01-01T10:00:05Z")
        ));
        assert!(!same_time(Some("2026-01-01T10:00:00Z"), None));
    }

    /// Timing for a content comparison of two folders
    /// (`CMP_BENCH_A`/`CMP_BENCH_B`, default System32 vs SysWOW64).
    #[test]
    #[ignore]
    fn comparison_bench() {
        let a = std::env::var("CMP_BENCH_A").unwrap_or_else(|_| r"C:\Windows\System32".to_string());
        let b = std::env::var("CMP_BENCH_B").unwrap_or_else(|_| r"C:\Windows\SysWOW64".to_string());
        let state = HashJobState::new();
        let started = std::time::Instant::now();
        let outcome = compare(&a, &b, &options(ComparisonMode::ContentHash), &state);
        let t = &outcome.totals;
        println!(
            "compare {a} vs {b}: {:.1}s identical={} different={} left_only={} right_only={} rows_sent={}",
            started.elapsed().as_secs_f64(),
            t.identical_files,
            t.different_files,
            t.left_only,
            t.right_only,
            outcome.rows.len()
        );
    }
}
