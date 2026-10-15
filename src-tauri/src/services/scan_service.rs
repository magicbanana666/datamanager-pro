//! The multithreaded, cancellable directory-walk scanner - Phase 3's
//! primary, fully-verified scan engine. Works identically against
//! local drives and UNC paths, unlike the MFT fast path (which only
//! ever applies to local NTFS drives) - see
//! `platform::current::try_mft_scan` and `run_scan` below for how the
//! two are combined.
//!
//! Parallelism comes from rayon: each directory's subdirectories are
//! scanned via a parallel iterator, so wide trees fan out across CPU
//! cores while `fs::read_dir` I/O for sibling directories overlaps.
//! Everything per entry comes from the directory listing itself
//! (`FindNextFileW` already returns size, attributes and timestamps);
//! the only extra per-file syscall is `GetCompressedFileSizeW`, and only
//! for files whose attributes say it can matter - see
//! `platform::current::allocated_size_for_scan`. Directory enumeration
//! itself is still the cost the MFT engine exists to avoid.

use crate::models::errors::AppError;
use crate::models::filesystem::FileAttribute;
use crate::models::scan::{FsNode, NodeKind, ScanEngine, ScanOptions, ScanProgressState};
use crate::platform;
use crate::utils::path::normalize_path;
use crate::utils::time::system_time_to_iso8601;
use rayon::prelude::*;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::time::SystemTime;

/// Tries the MFT fast path first (local NTFS drives, admin/backup
/// privilege permitting); falls back to the walk engine on any
/// failure - no privilege, a UNC path, a non-NTFS volume, or a parsing
/// error partway through. The fallback is silent and automatic: the
/// caller only ever sees which engine *actually* ran, never an error
/// from the attempt that didn't.
pub fn run_scan(
    root_path: &str,
    options: ScanOptions,
    state: &ScanProgressState,
) -> (FsNode, ScanEngine) {
    match platform::current::try_mft_scan(root_path, options, state) {
        Ok(root) => (root, ScanEngine::Mft),
        Err(reason) => {
            tracing::info!(
                path = %root_path,
                reason = %reason,
                "MFT scan unavailable, falling back to directory walk"
            );
            let walk = || scan_dir(Path::new(root_path), options, state);
            // A thread count from Settings gets its own pool; the walk's
            // nested par_iters then stay within it.
            let root = match options
                .threads
                .filter(|n| *n > 0)
                .and_then(|n| rayon::ThreadPoolBuilder::new().num_threads(n).stack_size(64 * 1024 * 1024).build().ok())
            {
                Some(pool) => pool.install(walk),
                None => walk(),
            };
            (root, ScanEngine::Walk)
        }
    }
}

fn empty_folder_node(path: String, name: String) -> FsNode {
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

/// A symlink/junction is intentionally not traversed - it's reported
/// as a zero-size, non-recursed file leaf, avoiding both symlink
/// cycles and double-counting a target that's also reachable directly.
/// Its own (misleading) link-text length is deliberately not reported
/// as `size` - see PHASE3.md's Known Limitations.
fn leaf_node(
    path: &Path,
    metadata: &fs::Metadata,
    is_symlink: bool,
    cluster_size: Option<u64>,
) -> FsNode {
    let path_str = normalize_path(&path.to_string_lossy());
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path_str.clone());
    let size = if is_symlink { 0 } else { metadata.len() };
    let allocated = if is_symlink {
        0
    } else {
        platform::current::allocated_size_for_scan(path, metadata, cluster_size).unwrap_or(size)
    };

    FsNode {
        id: path_str.clone(),
        name,
        path: path_str,
        kind: NodeKind::File,
        size,
        allocated,
        file_count: 0,
        folder_count: 0,
        // Filled in by the parent once every sibling's size is known.
        percent_of_parent: 0.0,
        last_modified: metadata.modified().ok().and_then(system_time_to_iso8601),
        category: None,
        children: None,
    }
}

/// Recursively scans `path`, returning the real `FsNode` tree rooted
/// there - `size`/`allocated`/`fileCount`/`folderCount` are true
/// recursive aggregates, not the shallow direct-children-only counts
/// Phase 2's `get_directory_summary` reports.
///
/// Never panics on an unreadable file or subdirectory - it's recorded
/// via `state.record_skip` and the walk continues past it. Once
/// `state.is_cancelled()` becomes true, every not-yet-visited branch
/// short-circuits to an empty stub instead of doing any more I/O; the
/// caller (`commands::scan`) is responsible for treating a cancelled
/// scan's result as discarded rather than complete.
pub fn scan_dir(path: &Path, options: ScanOptions, state: &ScanProgressState) -> FsNode {
    // Both looked up once per scan, not per entry: the cluster size is
    // the same for every file on the volume, and every other folder's
    // modified time comes from its parent's listing.
    let cluster_size = platform::current::cluster_size_bytes(path);
    let modified = fs::metadata(path).ok().and_then(|m| m.modified().ok());
    scan_dir_inner(path, modified, options, state, cluster_size)
}

fn scan_dir_inner(
    path: &Path,
    modified: Option<SystemTime>,
    options: ScanOptions,
    state: &ScanProgressState,
    cluster_size: Option<u64>,
) -> FsNode {
    let path_str = normalize_path(&path.to_string_lossy());
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path_str.clone());

    if state.is_cancelled() {
        return empty_folder_node(path_str, name);
    }
    state.set_current_path(&path_str);

    let read_dir = match fs::read_dir(path) {
        Ok(rd) => rd,
        Err(err) => {
            state.record_skip(&path_str, AppError::from_io(&err, &path_str).message);
            return empty_folder_node(path_str, name);
        }
    };

    // Pass 1 (sequential, cheap): classify entries and build file leaves
    // directly; collect subdirectory paths for the parallel pass below.
    let mut files: Vec<FsNode> = Vec::new();
    let mut subdirs: Vec<(PathBuf, Option<SystemTime>)> = Vec::new();
    for item in read_dir {
        let item = match item {
            Ok(i) => i,
            Err(err) => {
                state.record_skip(&path_str, err.to_string());
                continue;
            }
        };
        let entry_path = item.path();
        let file_type = match item.file_type() {
            Ok(ft) => ft,
            Err(err) => {
                state.record_skip(&entry_path.to_string_lossy(), err.to_string());
                continue;
            }
        };
        let metadata = match item.metadata() {
            Ok(m) => m,
            Err(err) => {
                state.record_skip(&entry_path.to_string_lossy(), err.to_string());
                continue;
            }
        };

        let attributes = platform::current::decode_attributes(&metadata);
        let is_hidden = attributes.contains(&FileAttribute::Hidden);
        let is_system = attributes.contains(&FileAttribute::System);
        if (is_hidden && !options.show_hidden) || (is_system && !options.show_system) {
            continue;
        }

        if file_type.is_symlink() {
            files.push(leaf_node(&entry_path, &metadata, true, cluster_size));
        } else if file_type.is_dir() {
            subdirs.push((entry_path, metadata.modified().ok()));
        } else {
            files.push(leaf_node(&entry_path, &metadata, false, cluster_size));
        }
    }

    for file in &files {
        state.files.fetch_add(1, Ordering::Relaxed);
        state.bytes.fetch_add(file.size, Ordering::Relaxed);
    }

    // Pass 2 (parallel): fan the subdirectories out across rayon's
    // thread pool. Each recursive call is itself allowed to fan out
    // further, so a wide/deep tree keeps every core busy rather than
    // parallelizing only the top level.
    let child_folders: Vec<FsNode> = subdirs
        .into_par_iter()
        .map(|(subdir, modified)| {
            let node = scan_dir_inner(&subdir, modified, options, state, cluster_size);
            state.folders.fetch_add(1, Ordering::Relaxed);
            node
        })
        .collect();

    let mut children = files;
    children.extend(child_folders);

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

    let last_modified = modified.and_then(system_time_to_iso8601);

    FsNode {
        id: path_str.clone(),
        name,
        path: path_str,
        kind: NodeKind::Folder,
        size: total_size,
        allocated: total_allocated,
        file_count,
        folder_count,
        // Overwritten by this node's own parent, once known; stays 100
        // for the true scan root, matching the mock data's convention.
        percent_of_parent: 100.0,
        last_modified,
        category: None,
        children: Some(children),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state() -> ScanProgressState {
        ScanProgressState::new()
    }

    #[test]
    fn aggregates_recursive_size_and_counts_across_nested_dirs() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.txt"), b"12345").unwrap(); // 5 bytes
        std::fs::create_dir(dir.path().join("sub")).unwrap();
        std::fs::write(dir.path().join("sub").join("b.txt"), b"1234567890").unwrap(); // 10 bytes
        std::fs::create_dir(dir.path().join("sub").join("deeper")).unwrap();
        std::fs::write(dir.path().join("sub").join("deeper").join("c.txt"), b"123").unwrap(); // 3 bytes

        let st = state();
        let root = scan_dir(dir.path(), ScanOptions::default(), &st);

        // Unlike Phase 2's shallow summary, these are recursive totals.
        assert_eq!(root.size, 18);
        assert_eq!(root.file_count, 3);
        assert_eq!(root.folder_count, 2);
        assert_eq!(st.files.load(Ordering::Relaxed), 3);
        assert_eq!(st.folders.load(Ordering::Relaxed), 2);
    }

    #[test]
    fn percent_of_parent_is_relative_to_the_immediate_parent() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("big.bin"), vec![0u8; 75]).unwrap();
        std::fs::write(dir.path().join("small.bin"), vec![0u8; 25]).unwrap();

        let st = state();
        let root = scan_dir(dir.path(), ScanOptions::default(), &st);
        assert_eq!(root.percent_of_parent, 100.0);

        let children = root.children.unwrap();
        let big = children.iter().find(|c| c.name == "big.bin").unwrap();
        let small = children.iter().find(|c| c.name == "small.bin").unwrap();
        assert!((big.percent_of_parent - 75.0).abs() < 0.01);
        assert!((small.percent_of_parent - 25.0).abs() < 0.01);
    }

    #[test]
    fn unreadable_subfolder_is_skipped_not_fatal() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.txt"), b"hello").unwrap();
        std::fs::create_dir(dir.path().join("sub")).unwrap();
        std::fs::write(dir.path().join("sub").join("b.txt"), b"world").unwrap();

        let st = state();
        // Simulate an unreadable subtree by scanning a path with one
        // missing component appended - `scan_dir` itself never panics,
        // it records the failure and returns an empty stub for that
        // branch while the rest of the tree still completes normally.
        let missing = dir.path().join("does-not-exist");
        let stub = scan_dir(&missing, ScanOptions::default(), &st);
        assert_eq!(stub.size, 0);
        assert_eq!(stub.children, None);
        assert_eq!(st.take_skipped().len(), 1);

        // A real scan of the real tree is unaffected by the above.
        let root = scan_dir(dir.path(), ScanOptions::default(), &state());
        assert_eq!(root.size, 10);
        assert_eq!(root.file_count, 2);
    }

    #[test]
    fn cancellation_stops_before_finishing_a_larger_tree() {
        let dir = tempfile::tempdir().unwrap();
        for i in 0..5 {
            let sub = dir.path().join(format!("sub{i}"));
            std::fs::create_dir(&sub).unwrap();
            std::fs::write(sub.join("f.txt"), b"12345").unwrap();
        }

        let st = state();
        st.cancel(); // pre-cancelled: nothing should be visited
        let root = scan_dir(dir.path(), ScanOptions::default(), &st);
        assert_eq!(root.size, 0);
        assert_eq!(root.children, None);
        assert_eq!(st.files.load(Ordering::Relaxed), 0);
    }

    #[test]
    fn a_symlink_is_reported_as_a_zero_size_leaf_not_traversed() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("real")).unwrap();
        std::fs::write(dir.path().join("real").join("f.txt"), b"12345").unwrap();

        #[cfg(windows)]
        let symlink_result =
            std::os::windows::fs::symlink_dir(dir.path().join("real"), dir.path().join("link"));
        #[cfg(not(windows))]
        let symlink_result =
            std::os::unix::fs::symlink(dir.path().join("real"), dir.path().join("link"));

        if symlink_result.is_err() {
            // Creating a directory symlink can require an elevated/
            // developer-mode privilege this environment may not have -
            // skip rather than fail the suite over an environment gap
            // unrelated to the scanner's own correctness.
            return;
        }

        let st = state();
        let root = scan_dir(dir.path(), ScanOptions::default(), &st);
        let children = root.children.unwrap();

        let link = children.iter().find(|c| c.name == "link").unwrap();
        assert_eq!(link.kind, NodeKind::File);
        assert_eq!(link.size, 0);
        assert_eq!(link.children, None);

        // The real subfolder is still walked normally.
        let real = children.iter().find(|c| c.name == "real").unwrap();
        assert_eq!(real.size, 5);
    }

    /// Live timing for the walk engine against a real folder
    /// (`WALK_BENCH_PATH`, default `C:\Windows`), plus a spot check that
    /// the fast per-scan allocated-size path agrees with the full
    /// per-file `allocated_size_bytes` lookup on the first 5,000 files.
    #[test]
    #[ignore]
    fn walk_bench() {
        let target = std::env::var("WALK_BENCH_PATH").unwrap_or_else(|_| r"C:\Windows".to_string());
        let st = ScanProgressState::new();
        let started = std::time::Instant::now();
        let root = scan_dir(Path::new(&target), ScanOptions::default(), &st);
        println!(
            "walk {target}: {:.1}s files={} folders={}",
            started.elapsed().as_secs_f64(),
            root.file_count,
            root.folder_count
        );

        let mut checked = 0;
        let mut mismatches = 0;
        let mut stack = vec![&root];
        while let Some(n) = stack.pop() {
            if checked >= 5_000 {
                break;
            }
            if n.kind == NodeKind::File && n.size > 0 {
                let full = platform::current::allocated_size_bytes(Path::new(&n.path), n.size)
                    .unwrap_or(n.size);
                if full != n.allocated {
                    mismatches += 1;
                }
                checked += 1;
            }
            stack.extend(n.children.as_deref().unwrap_or(&[]));
        }
        println!("allocated spot check: {mismatches} mismatches in {checked} files");
        assert_eq!(mismatches, 0);
    }
}
