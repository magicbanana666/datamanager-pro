//! Duplicate detection.
//!
//! 1. List all files with the scan engines.
//! 2. Group by name or size. For exact content, size goes first: most
//!    sizes are unique, so most files are never read.
//! 3. Exact content only: hash the first 64 KiB of each candidate, then
//!    the full content of what still matches (xxh3-128).

use crate::models::duplicates::{
    DuplicateCriteria, DuplicateFile, DuplicateGroup, DuplicateOptions, MAX_GROUPS_IN_RESULT,
};
use crate::models::hash_job::{HashJobPhase, HashJobState};
use crate::models::scan::{FsNode, NodeKind, ScanOptions};
use crate::services::{hashing, scan_service};
use rayon::prelude::*;
use std::collections::{HashMap, HashSet};

/// How much of each file the cheap first hashing pass reads.
const HEAD_BYTES: u64 = 64 * 1024;

/// Every group found (unsorted, uncapped) plus how many candidate files
/// were compared - the command layer sorts, caps and wraps it.
pub struct DuplicateOutcome {
    pub groups: Vec<DuplicateGroup>,
    pub files_compared: u64,
}

pub fn find_duplicates(
    roots: &[String],
    options: &DuplicateOptions,
    state: &HashJobState,
) -> DuplicateOutcome {
    let files = collect_files(roots, options, state);
    let files_compared = files.len() as u64;
    if state.is_cancelled() {
        return DuplicateOutcome {
            groups: Vec::new(),
            files_compared,
        };
    }

    let groups = match options.criteria {
        DuplicateCriteria::SameName => group_by(files, |f| {
            if options.ignore_case {
                f.name.to_lowercase()
            } else {
                f.name.clone()
            }
        }),
        DuplicateCriteria::SameSize => group_by(files, |f| f.size.to_string()),
        DuplicateCriteria::Exact => exact_groups(files, state),
    };

    DuplicateOutcome {
        groups: groups
            .into_iter()
            .map(|(key, files)| make_group(key, files))
            .collect(),
        files_compared,
    }
}

/// Sorts largest-waste first and keeps the top [`MAX_GROUPS_IN_RESULT`].
pub fn rank_and_cap(mut groups: Vec<DuplicateGroup>) -> Vec<DuplicateGroup> {
    groups.sort_unstable_by_key(|g| std::cmp::Reverse(g.wasted_bytes));
    groups.truncate(MAX_GROUPS_IN_RESULT);
    groups
}

fn make_group(key: String, mut files: Vec<DuplicateFile>) -> DuplicateGroup {
    files.sort_by(|a, b| a.path.cmp(&b.path));
    let total: u64 = files.iter().map(|f| f.size).sum();
    let largest = files.iter().map(|f| f.size).max().unwrap_or(0);
    DuplicateGroup {
        key,
        wasted_bytes: total - largest,
        files,
    }
}

fn collect_files(
    roots: &[String],
    options: &DuplicateOptions,
    state: &HashJobState,
) -> Vec<DuplicateFile> {
    let scan_options = ScanOptions {
        show_hidden: !options.ignore_hidden,
        show_system: !options.ignore_system,
        threads: None,
    };
    let min_size = options.min_size.max(1);
    let max_size = options.max_size.unwrap_or(u64::MAX);

    let mut seen: HashSet<String> = HashSet::new();
    let mut files = Vec::new();
    for root in roots {
        if state.is_cancelled() {
            break;
        }
        let (tree, _engine) = scan_service::run_scan(root, scan_options, &state.scan);
        // Overlapping locations (a folder and one of its subfolders)
        // must not report a file as a duplicate of itself.
        flatten_files(&tree, &mut |node| {
            if (min_size..=max_size).contains(&node.size) && seen.insert(node.path.clone()) {
                files.push(DuplicateFile {
                    path: node.path.clone(),
                    name: node.name.clone(),
                    size: node.size,
                    last_modified: node.last_modified.clone(),
                });
            }
        });
    }
    files
}

fn flatten_files(node: &FsNode, visit: &mut impl FnMut(&FsNode)) {
    let mut stack = vec![node];
    while let Some(n) = stack.pop() {
        match n.kind {
            NodeKind::File => visit(n),
            NodeKind::Folder => stack.extend(n.children.as_deref().unwrap_or(&[])),
        }
    }
}

/// Buckets `items` by `key` and keeps only buckets with 2+ members.
fn group_by<T, K: std::hash::Hash + Eq>(items: Vec<T>, key: impl Fn(&T) -> K) -> Vec<(K, Vec<T>)> {
    let mut buckets: HashMap<K, Vec<T>> = HashMap::new();
    for item in items {
        buckets.entry(key(&item)).or_default().push(item);
    }
    buckets.into_iter().filter(|(_, v)| v.len() > 1).collect()
}

/// A candidate after a hashing pass: its hash so far, plus its physical
/// identity (see `platform::current::file_identity`) when known.
struct Hashed {
    file: DuplicateFile,
    hash: u128,
    identity: Option<(u32, u64)>,
}

fn exact_groups(
    files: Vec<DuplicateFile>,
    state: &HashJobState,
) -> Vec<(String, Vec<DuplicateFile>)> {
    let same_size: Vec<DuplicateFile> = group_by(files, |f| f.size)
        .into_iter()
        .flat_map(|(_, v)| v)
        .collect();

    // Pass 1: head hash. For files no larger than HEAD_BYTES this *is*
    // the full content, so they're settled after this pass.
    let head_total = same_size.iter().map(|f| f.size.min(HEAD_BYTES)).sum();
    state.begin_phase(HashJobPhase::Comparing, head_total);
    let headed = hash_all(same_size, Some(HEAD_BYTES), state);

    let mut settled: Vec<(String, Vec<DuplicateFile>)> = Vec::new();
    let mut need_full: Vec<DuplicateFile> = Vec::new();
    for ((size, hash), members) in group_by(headed, |h| (h.file.size, h.hash)) {
        // Hard links are collapsed here, before the expensive full pass,
        // so a file linked into several folders is never read twice.
        let members = distinct_physical_files(members);
        if members.len() < 2 {
            continue;
        }
        if size <= HEAD_BYTES {
            settled.push((format!("{hash:032x}"), members));
        } else {
            need_full.extend(members);
        }
    }

    // Pass 2: full-content hash for the large candidates still matching.
    let full_total = need_full.iter().map(|f| f.size).sum();
    state.begin_phase(HashJobPhase::Hashing, full_total);
    let hashed = hash_all(need_full, None, state);
    for ((_, hash), members) in group_by(hashed, |h| (h.file.size, h.hash)) {
        settled.push((
            format!("{hash:032x}"),
            members.into_iter().map(|h| h.file).collect(),
        ));
    }
    settled
}

/// Keeps one path per physical file. Hard links aren't duplicates
/// (deleting one frees nothing), and most of System32 is hard-linked
/// into WinSxS. Files with unknown identity are all kept.
fn distinct_physical_files(mut members: Vec<Hashed>) -> Vec<DuplicateFile> {
    members.sort_by(|a, b| a.file.path.cmp(&b.file.path));
    let mut seen = HashSet::new();
    members
        .into_iter()
        .filter(|h| h.identity.is_none_or(|id| seen.insert(id)))
        .map(|h| h.file)
        .collect()
}

/// Hashes every file in parallel, dropping (and recording as skipped)
/// any that can't be read - a locked or vanished file can't be proven
/// a duplicate.
fn hash_all(files: Vec<DuplicateFile>, limit: Option<u64>, state: &HashJobState) -> Vec<Hashed> {
    files
        .into_par_iter()
        .filter_map(|f| {
            if state.is_cancelled() {
                return None;
            }
            state.scan.set_current_path(&f.path);
            match hashing::hash_file(&f.path, limit, state) {
                Ok((hash, identity)) => Some(Hashed {
                    file: f,
                    hash,
                    identity,
                }),
                Err(err) => {
                    if !state.is_cancelled() {
                        state.scan.record_skip(&f.path, err.to_string());
                    }
                    None
                }
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn options(criteria: DuplicateCriteria) -> DuplicateOptions {
        DuplicateOptions {
            criteria,
            ignore_case: true,
            ignore_hidden: true,
            ignore_system: true,
            min_size: 0,
            max_size: None,
        }
    }

    fn run(dir: &std::path::Path, criteria: DuplicateCriteria) -> Vec<DuplicateGroup> {
        let state = HashJobState::new();
        let roots = vec![dir.to_string_lossy().to_string()];
        let mut groups = find_duplicates(&roots, &options(criteria), &state).groups;
        groups.sort_by(|a, b| a.files[0].path.cmp(&b.files[0].path));
        groups
    }

    #[test]
    fn exact_matches_content_not_names_or_sizes() {
        let dir = tempfile::tempdir().unwrap();
        let big_a = vec![7u8; 200_000];
        let mut big_b = big_a.clone();
        *big_b.last_mut().unwrap() = 8; // same size and same 64 KiB head, different tail
        fs::create_dir(dir.path().join("sub")).unwrap();
        fs::write(dir.path().join("a.txt"), b"hello").unwrap();
        fs::write(dir.path().join("sub").join("copy.bin"), b"hello").unwrap();
        fs::write(dir.path().join("other.txt"), b"world").unwrap(); // same size, different content
        fs::write(dir.path().join("big1.dat"), &big_a).unwrap();
        fs::write(dir.path().join("big2.dat"), &big_a).unwrap();
        fs::write(dir.path().join("big3.dat"), &big_b).unwrap();
        fs::write(dir.path().join("empty1"), b"").unwrap();
        fs::write(dir.path().join("empty2"), b"").unwrap();

        let groups = run(dir.path(), DuplicateCriteria::Exact);
        let names: Vec<Vec<&str>> = groups
            .iter()
            .map(|g| g.files.iter().map(|f| f.name.as_str()).collect())
            .collect();
        assert_eq!(
            names,
            vec![vec!["a.txt", "copy.bin"], vec!["big1.dat", "big2.dat"]]
        );
        assert_eq!(groups[1].wasted_bytes, 200_000);
    }

    #[test]
    fn same_name_respects_ignore_case() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("x")).unwrap();
        fs::write(dir.path().join("Report.docx"), b"1").unwrap();
        fs::write(dir.path().join("x").join("report.DOCX"), b"22").unwrap();

        let groups = run(dir.path(), DuplicateCriteria::SameName);
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].wasted_bytes, 1);
    }

    #[test]
    fn hard_links_are_not_duplicates() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("original.bin"), b"same bytes").unwrap();
        fs::hard_link(dir.path().join("original.bin"), dir.path().join("link.bin")).unwrap();
        assert!(run(dir.path(), DuplicateCriteria::Exact).is_empty());

        // A separate third copy still makes a group of two files.
        fs::write(dir.path().join("copy.bin"), b"same bytes").unwrap();
        let groups = run(dir.path(), DuplicateCriteria::Exact);
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].files.len(), 2);
    }

    #[test]
    fn overlapping_locations_do_not_self_match() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("sub")).unwrap();
        fs::write(dir.path().join("sub").join("only.txt"), b"unique").unwrap();
        let state = HashJobState::new();
        let roots = vec![
            dir.path().to_string_lossy().to_string(),
            dir.path().join("sub").to_string_lossy().to_string(),
        ];
        let outcome = find_duplicates(&roots, &options(DuplicateCriteria::Exact), &state);
        assert!(outcome.groups.is_empty());
        assert_eq!(outcome.files_compared, 1);
    }

    /// Timing against a folder (`DUP_BENCH_PATH`, default
    /// `C:\Windows`), exact content, files of 1 MB and up.
    #[test]
    #[ignore]
    fn duplicate_bench() {
        let target = std::env::var("DUP_BENCH_PATH").unwrap_or_else(|_| r"C:\Windows".to_string());
        let state = HashJobState::new();
        let mut opts = options(DuplicateCriteria::Exact);
        opts.min_size = 1024 * 1024;
        let started = std::time::Instant::now();
        let outcome = find_duplicates(std::slice::from_ref(&target), &opts, &state);
        let wasted: u64 = outcome.groups.iter().map(|g| g.wasted_bytes).sum();
        println!(
            "duplicates {target}: {:.1}s compared={} groups={} wasted={:.1} MB",
            started.elapsed().as_secs_f64(),
            outcome.files_compared,
            outcome.groups.len(),
            wasted as f64 / 1_048_576.0
        );
    }
}
