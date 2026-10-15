//! Transfer engine: copy, move and the four sync modes.
//!
//! [`analyze`] lists both sides and decides, per file, what happens to
//! it ([`PlanAction`]); [`execute`] carries the plan out:
//!
//! 1. missing (empty) folders are created;
//! 2. files are copied in parallel. Large files and replacements go to
//!    `<name>.dmp-part` and are renamed when complete (and verified);
//!    an interrupted large copy resumes from its last checkpoint (see
//!    `transfer_journal`);
//! 3. deletions run last (Recycle Bin by default), so a failed copy
//!    never costs the only other copy of a file;
//! 4. a move removes the source folders it emptied.
//!
//! Timestamps, attributes and (optionally) the NTFS DACL are carried
//! over. Junctions and symbolic links are never followed.

use crate::models::transfer::{
    CollisionPolicy, ItemStatus, PlanAction, PlanItem, PlanSummary, TransferError, TransferMode,
    TransferOptions, TransferPhase, TransferRequest, TransferState, MAX_REPORTED_ERRORS,
    TIMESTAMP_TOLERANCE_SECS,
};
use crate::platform;
use crate::services::sync_state::{SyncState, SyncedPair};
use crate::services::transfer_journal::{Journal, JournalProgress};
use crate::utils::time::system_time_to_iso8601;
use rayon::prelude::*;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::Mutex;
use std::time::SystemTime;
use xxhash_rust::xxh3::Xxh3;

const COPY_BUFFER: usize = 1024 * 1024;
/// A copy this far along is synced to disk and journaled, so a resume
/// continues from here instead of starting over.
const CHECKPOINT_BYTES: u64 = 64 * 1024 * 1024;
pub const PART_SUFFIX: &str = ".dmp-part";
/// Small files copied at once: for them the cost is opening and closing,
/// not bandwidth, so parallelism hides the latency.
const SMALL_FILE_THREADS: usize = 8;
/// Files at least this big use native direct I/O and are scheduled per
/// medium (`copy_tuning`).
pub(crate) const DIRECT_MIN_BYTES: u64 = 16 * 1024 * 1024;
const MIB: usize = 1024 * 1024;
/// Benchmark switch (services::copy_bench): the old buffered path for
/// every file, to compare against direct I/O.
#[cfg(test)]
pub(crate) static FORCE_BUFFERED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
/// Files at least this big report their own progress.
const ACTIVE_MIN_BYTES: u64 = 4 * 1024 * 1024;
/// Per-file log lines are only written for jobs this small.
const MAX_PER_FILE_LOG: usize = 2_000;

// ---------------------------------------------------------------- filters

struct Pattern {
    glob: Vec<char>,
    /// Contains a `\`: matched against the relative path, not the name.
    on_path: bool,
}

/// Include/exclude wildcard lists (`*.tmp;*.log`), case-insensitive.
pub struct Filters {
    include: Vec<Pattern>,
    exclude: Vec<Pattern>,
}

fn parse_patterns(list: &str, drop_match_all: bool) -> Vec<Pattern> {
    let patterns: Vec<&str> = list
        .split([';', ','])
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .collect();
    if drop_match_all && patterns.iter().any(|p| *p == "*" || *p == "*.*") {
        return Vec::new();
    }
    patterns
        .into_iter()
        .map(|p| Pattern {
            glob: p.to_lowercase().replace('/', "\\").chars().collect(),
            on_path: p.contains(['\\', '/']),
        })
        .collect()
}

/// `*` matches any run of characters (`\` included), `?` exactly one.
fn glob_match(pattern: &[char], text: &[char]) -> bool {
    let (mut p, mut t) = (0, 0);
    let mut star: Option<(usize, usize)> = None;
    while t < text.len() {
        if p < pattern.len() && (pattern[p] == '?' || pattern[p] == text[t]) {
            p += 1;
            t += 1;
        } else if p < pattern.len() && pattern[p] == '*' {
            star = Some((p, t));
            p += 1;
        } else if let Some((sp, st)) = star {
            p = sp + 1;
            t = st + 1;
            star = Some((sp, st + 1));
        } else {
            return false;
        }
    }
    pattern[p..].iter().all(|&c| c == '*')
}

impl Filters {
    pub fn new(options: &TransferOptions) -> Self {
        Self {
            include: parse_patterns(&options.include_filters, true),
            exclude: parse_patterns(&options.exclude_filters, false),
        }
    }

    fn matches(patterns: &[Pattern], relative_path: &str, name: &str) -> bool {
        let name: Vec<char> = name.to_lowercase().chars().collect();
        let path: Vec<char> = relative_path.to_lowercase().chars().collect();
        patterns
            .iter()
            .any(|p| glob_match(&p.glob, if p.on_path { &path } else { &name }))
    }

    fn includes_file(&self, relative_path: &str, name: &str) -> bool {
        (self.include.is_empty() || Self::matches(&self.include, relative_path, name))
            && !Self::matches(&self.exclude, relative_path, name)
    }

    fn excludes_folder(&self, relative_path: &str, name: &str) -> bool {
        Self::matches(&self.exclude, relative_path, name)
    }
}

// ---------------------------------------------------------------- listing

#[derive(Debug, Clone)]
struct Entry {
    relative_path: String,
    path: PathBuf,
    is_dir: bool,
    size: u64,
    modified: Option<SystemTime>,
}

#[derive(Default)]
struct Listing {
    /// Keyed by lowercased relative path, so parents sort before their
    /// children and both sides pair up case-insensitively.
    entries: BTreeMap<String, Entry>,
    excluded: Vec<Entry>,
}

fn list_side(root: &Path, options: &TransferOptions, filters: &Filters, state: &TransferState) -> Listing {
    let mut listing = Listing::default();
    if root.is_dir() {
        walk(root, "", options, filters, state, &mut listing);
    }
    listing
}

fn walk(
    dir: &Path,
    prefix: &str,
    options: &TransferOptions,
    filters: &Filters,
    state: &TransferState,
    listing: &mut Listing,
) {
    if state.is_cancelled() {
        return;
    }
    state.set_current_file(&dir.to_string_lossy());
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) => {
            state.scan.record_skip(&dir.to_string_lossy(), e.to_string());
            return;
        }
    };
    for entry in entries.filter_map(Result::ok) {
        let name = entry.file_name().to_string_lossy().into_owned();
        let path = entry.path();
        let Ok(file_type) = entry.file_type() else { continue };
        // On Windows this is also true for junctions.
        if file_type.is_symlink() {
            state.scan.record_skip(
                &path.to_string_lossy(),
                "junction or symbolic link - not followed",
            );
            continue;
        }
        if name.ends_with(PART_SUFFIX) {
            continue;
        }
        let relative_path = if prefix.is_empty() {
            name.clone()
        } else {
            format!("{prefix}\\{name}")
        };
        let metadata = entry.metadata().ok();
        let make = |is_dir: bool| Entry {
            relative_path: relative_path.clone(),
            path: path.clone(),
            is_dir,
            size: if is_dir { 0 } else { metadata.as_ref().map_or(0, |m| m.len()) },
            modified: metadata.as_ref().and_then(|m| m.modified().ok()),
        };
        if file_type.is_dir() {
            if !options.include_subfolders {
                continue;
            }
            if filters.excludes_folder(&relative_path, &name) {
                listing.excluded.push(make(true));
                continue;
            }
            listing
                .entries
                .insert(relative_path.to_lowercase(), make(true));
            walk(&path, &relative_path, options, filters, state, listing);
        } else {
            state.files_found.fetch_add(1, Ordering::Relaxed);
            if filters.includes_file(&relative_path, &name) {
                listing
                    .entries
                    .insert(relative_path.to_lowercase(), make(false));
            } else {
                listing.excluded.push(make(false));
            }
        }
    }
}

// --------------------------------------------------------------- planning

fn unix_secs(time: Option<SystemTime>) -> Option<i64> {
    let time = time?;
    Some(match time.duration_since(SystemTime::UNIX_EPOCH) {
        Ok(d) => d.as_secs() as i64,
        Err(e) => -(e.duration().as_secs() as i64),
    })
}

fn same_time(a: Option<SystemTime>, b: Option<SystemTime>) -> bool {
    match (unix_secs(a), unix_secs(b)) {
        (Some(a), Some(b)) => (a - b).abs() <= TIMESTAMP_TOLERANCE_SECS,
        _ => false,
    }
}

/// `a` is newer than `b` by more than the timestamp tolerance.
fn newer(a: Option<SystemTime>, b: Option<SystemTime>) -> bool {
    match (unix_secs(a), unix_secs(b)) {
        (Some(a), Some(b)) => a - b > TIMESTAMP_TOLERANCE_SECS,
        (Some(_), None) => true,
        _ => false,
    }
}

fn hash_path(path: &Path, state: &TransferState) -> std::io::Result<u128> {
    let mut file = File::open(path)?;
    let mut hasher = Xxh3::new();
    let mut buf = vec![0u8; COPY_BUFFER];
    loop {
        if state.is_cancelled() {
            return Err(std::io::Error::other("cancelled"));
        }
        let n = file.read(&mut buf)?;
        if n == 0 {
            return Ok(hasher.digest128());
        }
        hasher.update(&buf[..n]);
    }
}

fn same_content(a: &Entry, b: &Entry, state: &TransferState) -> bool {
    if a.size != b.size {
        return false;
    }
    state.set_current_file(&a.path.to_string_lossy());
    matches!(
        (hash_path(&a.path, state), hash_path(&b.path, state)),
        (Ok(x), Ok(y)) if x == y
    )
}

/// Sync modes: whether a pair counts as unchanged.
fn sync_same(src: &Entry, dst: &Entry, options: &TransferOptions, state: &TransferState) -> bool {
    if options.compare_hash {
        same_content(src, dst, state)
    } else if options.skip_same_size_date {
        src.size == dst.size && same_time(src.modified, dst.modified)
    } else {
        false
    }
}

/// `name (1).ext`, `name (2).ext`, ... - the first that's free on disk
/// and not already claimed by another item of this plan.
fn free_name(path: &Path, claimed: &mut HashSet<String>) -> PathBuf {
    let parent = path.parent().unwrap_or(Path::new(""));
    let stem = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let ext = path.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    for n in 1u32.. {
        let candidate = parent.join(format!("{stem} ({n}){ext}"));
        let key = candidate.to_string_lossy().to_lowercase();
        if !candidate.exists() && !claimed.contains(&key) {
            claimed.insert(key);
            return candidate;
        }
    }
    unreachable!()
}

struct Draft {
    relative_path: String,
    is_folder: bool,
    action: PlanAction,
    size: u64,
    /// Size of the destination copy an `Update` replaces.
    replaced: u64,
    source_modified: Option<SystemTime>,
    dest_modified: Option<SystemTime>,
    source_path: PathBuf,
    dest_path: PathBuf,
}

impl Draft {
    fn new(action: PlanAction, src: Option<&Entry>, dst: Option<&Entry>, source_root: &Path, dest_root: &Path) -> Self {
        let any = src.or(dst).expect("an item has at least one side");
        Self {
            relative_path: any.relative_path.clone(),
            is_folder: any.is_dir,
            action,
            size: match action {
                PlanAction::CopyBack | PlanAction::UpdateBack | PlanAction::DeleteDest => {
                    dst.map_or(0, |d| d.size)
                }
                _ => src.map_or(0, |s| s.size),
            },
            replaced: match action {
                PlanAction::Update => dst.map_or(0, |d| d.size),
                _ => 0,
            },
            source_modified: src.and_then(|s| s.modified),
            dest_modified: dst.and_then(|d| d.modified),
            source_path: src.map_or_else(|| source_root.join(&any.relative_path), |s| s.path.clone()),
            dest_path: dst.map_or_else(|| dest_root.join(&any.relative_path), |d| d.path.clone()),
        }
    }
}

pub struct PlanOutcome {
    pub items: Vec<PlanItem>,
    pub summary: PlanSummary,
}

/// Lists both sides and decides every file's action. Read-only.
pub fn analyze(request: &TransferRequest, sync_state: Option<&SyncState>, state: &TransferState) -> PlanOutcome {
    state.set_phase(TransferPhase::Analyzing);
    let source_root = PathBuf::from(&request.source);
    let dest_root = PathBuf::from(&request.destination);
    let filters = Filters::new(&request.options);

    let drafts = match &request.files {
        Some(files) => plan_files(files, request, &dest_root, state),
        None => {
            let src = list_side(&source_root, &request.options, &filters, state);
            let dst = if state.is_cancelled() {
                Listing::default()
            } else {
                list_side(&dest_root, &request.options, &filters, state)
            };
            let mut drafts = if request.mode == TransferMode::TwoWay {
                plan_two_way(&src, &dst, sync_state, &request.options, &source_root, &dest_root, state)
            } else {
                plan_one_way(&src, &dst, request, &source_root, &dest_root, state)
            };
            drafts.extend(src.excluded.iter().map(|e| {
                Draft::new(PlanAction::Excluded, Some(e), None, &source_root, &dest_root)
            }));
            drafts
        }
    };
    finish_plan(drafts, &dest_root)
}

fn plan_files(files: &[String], request: &TransferRequest, dest_root: &Path, state: &TransferState) -> Vec<Draft> {
    let mut claimed = HashSet::new();
    let mut drafts = Vec::new();
    for file in files {
        let path = PathBuf::from(file);
        let Ok(metadata) = fs::metadata(&path) else {
            state.scan.record_skip(file, "not found");
            continue;
        };
        if !metadata.is_file() {
            state.scan.record_skip(file, "not a file");
            continue;
        }
        state.files_found.fetch_add(1, Ordering::Relaxed);
        let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let src = Entry {
            relative_path: name.clone(),
            path: path.clone(),
            is_dir: false,
            size: metadata.len(),
            modified: metadata.modified().ok(),
        };
        let dest_path = dest_root.join(&name);
        let dst = fs::metadata(&dest_path).ok().filter(|m| m.is_file()).map(|m| Entry {
            relative_path: name.clone(),
            path: dest_path.clone(),
            is_dir: false,
            size: m.len(),
            modified: m.modified().ok(),
        });
        let action = collision_action(&src, dst.as_ref(), request.collision, state);
        let mut draft = Draft::new(action, Some(&src), dst.as_ref(), Path::new(""), dest_root);
        if action == PlanAction::RenameCopy {
            draft.dest_path = free_name(&dest_path, &mut claimed);
        }
        drafts.push(draft);
    }
    drafts
}

/// Copy/Move with an existing destination file.
fn collision_action(src: &Entry, dst: Option<&Entry>, policy: CollisionPolicy, state: &TransferState) -> PlanAction {
    let Some(dst) = dst else { return PlanAction::CopyNew };
    match policy {
        CollisionPolicy::SkipSame => {
            if src.size == dst.size && same_time(src.modified, dst.modified) {
                PlanAction::SkipSame
            } else {
                PlanAction::Update
            }
        }
        CollisionPolicy::CompareHash => {
            if same_content(src, dst, state) {
                PlanAction::SkipSame
            } else {
                PlanAction::Update
            }
        }
        CollisionPolicy::RenameNew => PlanAction::RenameCopy,
        CollisionPolicy::OverwriteOlder => {
            if newer(src.modified, dst.modified) {
                PlanAction::Update
            } else {
                PlanAction::SkipOlder
            }
        }
    }
}

fn plan_one_way(
    src: &Listing,
    dst: &Listing,
    request: &TransferRequest,
    source_root: &Path,
    dest_root: &Path,
    state: &TransferState,
) -> Vec<Draft> {
    let options = &request.options;
    let mut drafts = Vec::new();
    let mut claimed = HashSet::new();
    // Folders that will exist anyway because a file is copied into them.
    let mut filled: HashSet<String> = HashSet::new();

    for (key, s) in &src.entries {
        if state.is_cancelled() {
            break;
        }
        let d = dst.entries.get(key);
        if s.is_dir {
            continue; // decided below, once the files are known
        }
        if let Some(d) = d.filter(|d| d.is_dir) {
            state.scan.record_skip(
                &d.path.to_string_lossy(),
                "a folder with this name exists at the destination",
            );
            continue;
        }
        let action = match request.mode {
            TransferMode::Copy | TransferMode::Move => collision_action(s, d, request.collision, state),
            TransferMode::Mirror | TransferMode::Incremental => match d {
                None => PlanAction::CopyNew,
                Some(d) if sync_same(s, d, options, state) => PlanAction::SkipSame,
                Some(_) => PlanAction::Update,
            },
            TransferMode::UpdateNewer => match d {
                None => PlanAction::CopyNew,
                Some(d) if sync_same(s, d, options, state) => PlanAction::SkipSame,
                Some(d) if newer(s.modified, d.modified) => PlanAction::Update,
                Some(_) => PlanAction::SkipOlder,
            },
            TransferMode::TwoWay => unreachable!("planned by plan_two_way"),
        };
        if action.copies() {
            let mut parent = key.as_str();
            while let Some((p, _)) = parent.rsplit_once('\\') {
                if !filled.insert(p.to_string()) {
                    break;
                }
                parent = p;
            }
        }
        let mut draft = Draft::new(action, Some(s), d, source_root, dest_root);
        if action == PlanAction::RenameCopy {
            draft.dest_path = free_name(&draft.dest_path, &mut claimed);
        }
        drafts.push(draft);
    }

    for (key, s) in src.entries.iter().filter(|(_, s)| s.is_dir) {
        if !dst.entries.contains_key(key) && !filled.contains(key) {
            drafts.push(Draft::new(PlanAction::CreateFolder, Some(s), None, source_root, dest_root));
        }
    }

    let delete_extras = match request.mode {
        TransferMode::Mirror => true,
        TransferMode::Incremental | TransferMode::UpdateNewer => options.delete_extras,
        _ => false,
    };
    if delete_extras {
        // A folder missing at the source goes as a whole; `entries` is
        // sorted, so its contents directly follow it.
        let mut deleted_folder: Option<(String, usize)> = None;
        for (key, d) in &dst.entries {
            if let Some((prefix, index)) = &deleted_folder {
                if key.starts_with(prefix.as_str()) {
                    let index = *index;
                    drafts[index].size += d.size;
                    continue;
                }
            }
            if src.entries.contains_key(key) {
                continue;
            }
            if d.is_dir {
                deleted_folder = Some((format!("{key}\\"), drafts.len()));
            }
            drafts.push(Draft::new(PlanAction::DeleteDest, None, Some(d), source_root, dest_root));
        }
    }
    drafts
}

fn changed_since(size: u64, modified: Option<SystemTime>, recorded_size: u64, recorded_mtime: i64) -> bool {
    size != recorded_size
        || unix_secs(modified).is_none_or(|m| (m - recorded_mtime).abs() > TIMESTAMP_TOLERANCE_SECS)
}

fn plan_two_way(
    src: &Listing,
    dst: &Listing,
    sync_state: Option<&SyncState>,
    options: &TransferOptions,
    source_root: &Path,
    dest_root: &Path,
    state: &TransferState,
) -> Vec<Draft> {
    let known = |key: &str| sync_state.and_then(|s| s.files.get(key));
    let mut drafts = Vec::new();
    let keys: std::collections::BTreeSet<&String> = src
        .entries
        .iter()
        .chain(dst.entries.iter())
        .filter(|(_, e)| !e.is_dir)
        .map(|(k, _)| k)
        .collect();

    for key in keys {
        if state.is_cancelled() {
            break;
        }
        let s = src.entries.get(key).filter(|e| !e.is_dir);
        let d = dst.entries.get(key).filter(|e| !e.is_dir);
        let action = match (s, d) {
            (Some(s), Some(d)) => {
                if sync_same(s, d, options, state) {
                    PlanAction::SkipSame
                } else if let Some(k) = known(key) {
                    let src_changed = changed_since(s.size, s.modified, k.src_size, k.src_mtime);
                    let dst_changed = changed_since(d.size, d.modified, k.dst_size, k.dst_mtime);
                    match (src_changed, dst_changed) {
                        (true, false) => PlanAction::Update,
                        (false, true) => PlanAction::UpdateBack,
                        // Both edited - or neither, yet they differ (the
                        // saved state is stale): a person has to decide.
                        _ => PlanAction::Conflict,
                    }
                } else if newer(s.modified, d.modified) {
                    PlanAction::Update
                } else if newer(d.modified, s.modified) {
                    PlanAction::UpdateBack
                } else {
                    PlanAction::Conflict
                }
            }
            (Some(s), None) => match known(key) {
                // Synced before and untouched since: deleted at the
                // destination, so delete it here too.
                Some(k) if !changed_since(s.size, s.modified, k.src_size, k.src_mtime) => {
                    PlanAction::DeleteSource
                }
                // Deleted there but edited here - the edit wins.
                _ => PlanAction::CopyNew,
            },
            (None, Some(d)) => match known(key) {
                Some(k) if !changed_since(d.size, d.modified, k.dst_size, k.dst_mtime) => {
                    PlanAction::DeleteDest
                }
                _ => PlanAction::CopyBack,
            },
            (None, None) => continue,
        };
        let mut draft = Draft::new(action, s, d, source_root, dest_root);
        if action == PlanAction::DeleteSource {
            draft.size = s.map_or(0, |s| s.size);
        }
        drafts.push(draft);
    }
    drafts
}

fn action_rank(action: PlanAction) -> u8 {
    match action {
        PlanAction::Conflict => 0,
        PlanAction::CreateFolder => 1,
        PlanAction::CopyNew | PlanAction::CopyBack | PlanAction::RenameCopy => 2,
        PlanAction::Update | PlanAction::UpdateBack => 3,
        PlanAction::DeleteDest | PlanAction::DeleteSource => 4,
        PlanAction::SkipSame | PlanAction::SkipOlder => 5,
        PlanAction::Excluded => 6,
    }
}

fn finish_plan(mut drafts: Vec<Draft>, dest_root: &Path) -> PlanOutcome {
    drafts.sort_by(|a, b| {
        action_rank(a.action)
            .cmp(&action_rank(b.action))
            .then_with(|| a.relative_path.to_lowercase().cmp(&b.relative_path.to_lowercase()))
    });

    let mut summary = PlanSummary::default();
    let mut items = Vec::with_capacity(drafts.len());
    for (id, d) in drafts.into_iter().enumerate() {
        match d.action {
            PlanAction::CopyNew | PlanAction::CopyBack | PlanAction::RenameCopy => {
                summary.new_files += 1;
                summary.new_bytes += d.size;
            }
            PlanAction::Update | PlanAction::UpdateBack => {
                summary.updated_files += 1;
                summary.updated_bytes += d.size;
            }
            PlanAction::SkipSame | PlanAction::SkipOlder => {
                summary.unchanged_files += 1;
                summary.unchanged_bytes += d.size;
            }
            PlanAction::Excluded => {
                summary.excluded_files += 1;
                summary.excluded_bytes += d.size;
            }
            PlanAction::DeleteDest | PlanAction::DeleteSource => {
                summary.deletions += 1;
                summary.deletion_bytes += d.size;
            }
            PlanAction::Conflict => summary.conflicts += 1,
            PlanAction::CreateFolder => summary.folders_to_create += 1,
        }
        if d.action.copies() {
            summary.total_to_copy_files += 1;
            summary.total_to_copy_bytes += d.size;
            if !matches!(d.action, PlanAction::CopyBack | PlanAction::UpdateBack) {
                summary.net_bytes_needed += d.size.saturating_sub(d.replaced);
            }
        }
        items.push(PlanItem {
            id: id as u32,
            relative_path: d.relative_path,
            is_folder: d.is_folder,
            action: d.action,
            size: d.size,
            source_modified: d.source_modified.and_then(system_time_to_iso8601),
            dest_modified: d.dest_modified.and_then(system_time_to_iso8601),
            source_path: d.source_path.to_string_lossy().into_owned(),
            dest_path: d.dest_path.to_string_lossy().into_owned(),
        });
    }
    summary.dest_free_bytes = dest_root
        .ancestors()
        .find(|p| p.exists())
        .and_then(platform::current::free_space_bytes);
    PlanOutcome { items, summary }
}

// -------------------------------------------------------------- executing

#[derive(Debug, Default)]
pub struct ExecuteOutcome {
    pub files_copied: u64,
    pub bytes_copied: u64,
    pub files_deleted: u64,
    pub folders_created: u64,
    pub files_skipped: u64,
    pub files_verified: u64,
    pub errors: Vec<TransferError>,
    pub error_count: u64,
}

struct Executor<'a> {
    request: &'a TransferRequest,
    state: &'a TransferState,
    journal: &'a Journal,
    resume: &'a JournalProgress,
    resuming: bool,
    verbose: bool,
    outcome: Mutex<ExecuteOutcome>,
    /// Direct I/O request size and requests in flight.
    #[cfg_attr(not(windows), allow(dead_code))]
    direct_tuning: (usize, usize),
}

enum Finished {
    Copied { bytes: u64, verified: bool },
    Deleted,
    FolderCreated,
    /// Found already carried out (a resume whose journal line was lost).
    AlreadyDone,
}

/// Carries out `items` (every one is executed - excluded/skipped items
/// should already be filtered out by the caller). Items the journal
/// already marks done are skipped, so this also resumes a job.
pub fn execute(
    request: &TransferRequest,
    items: &[PlanItem],
    journal: &Journal,
    resume: &JournalProgress,
    state: &TransferState,
) -> ExecuteOutcome {
    state.files_total.store(items.iter().filter(|i| counts_as_file(i)).count() as u64, Ordering::Relaxed);
    state.bytes_total.store(
        items.iter().filter(|i| i.action.copies()).map(|i| i.size).sum(),
        Ordering::Relaxed,
    );
    for item in items.iter().filter(|i| resume.done.contains(&i.id)) {
        if counts_as_file(item) {
            state.files_done.fetch_add(1, Ordering::Relaxed);
        }
        if item.action.copies() {
            state.bytes_done.fetch_add(item.size, Ordering::Relaxed);
        }
    }

    let (direct_tuning, large_parallel, described) = copy_tuning(request);
    state.log(described);
    let exec = Executor {
        request,
        state,
        journal,
        resume,
        resuming: !resume.done.is_empty() || !resume.partial.is_empty(),
        verbose: items.len() <= MAX_PER_FILE_LOG,
        outcome: Mutex::new(ExecuteOutcome::default()),
        direct_tuning,
    };
    let pending = |item: &&PlanItem| !resume.done.contains(&item.id);

    state.set_phase(TransferPhase::Copying);
    for item in items.iter().filter(|i| i.action == PlanAction::CreateFolder).filter(pending) {
        if !state.wait_while_paused() {
            break;
        }
        exec.run(item);
    }

    // Small files many at once; large ones a few at a time (one on a
    // spinning disk, where parallel streams just make it seek).
    let (small, large): (Vec<&PlanItem>, Vec<&PlanItem>) = items
        .iter()
        .filter(|i| i.action.copies())
        .filter(pending)
        .partition(|i| i.size < DIRECT_MIN_BYTES);
    #[cfg(test)]
    let small_threads = std::env::var("DMP_BENCH_SMALL_THREADS").ok().and_then(|v| v.parse().ok()).unwrap_or(SMALL_FILE_THREADS);
    #[cfg(not(test))]
    let small_threads = SMALL_FILE_THREADS;
    run_parallel(&small, small_threads, &exec);
    run_parallel(&large, large_parallel, &exec);

    state.set_phase(TransferPhase::Deleting);
    for item in items
        .iter()
        .filter(|i| matches!(i.action, PlanAction::DeleteDest | PlanAction::DeleteSource))
        .filter(pending)
    {
        if !state.wait_while_paused() {
            break;
        }
        exec.run(item);
    }

    state.set_phase(TransferPhase::Finishing);
    if request.mode == TransferMode::Move && request.files.is_none() && !state.is_cancelled() {
        remove_emptied_folders(request, items);
    }
    exec.outcome.into_inner().unwrap()
}

/// Benchmark experiments: DMP_BENCH_CHUNK_MB, _DEPTH, _PARALLEL.
#[cfg(test)]
fn bench_overrides(tuning: (usize, usize), parallel: usize) -> ((usize, usize), usize) {
    let get = |k: &str| std::env::var(k).ok().and_then(|v| v.parse::<usize>().ok());
    (
        (get("DMP_BENCH_CHUNK_MB").map_or(tuning.0, |m| m * MIB), get("DMP_BENCH_DEPTH").unwrap_or(tuning.1)),
        get("DMP_BENCH_PARALLEL").unwrap_or(parallel),
    )
}

#[cfg(test)]
fn force_buffered() -> bool {
    FORCE_BUFFERED.load(Ordering::Relaxed)
}

#[cfg(not(test))]
fn force_buffered() -> bool {
    false
}

/// Sets a file's times through a handle opened for attributes only.
fn set_file_times(path: &Path, times: fs::FileTimes) -> std::io::Result<()> {
    let mut options = fs::OpenOptions::new();
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.access_mode(0x0100); // FILE_WRITE_ATTRIBUTES
    }
    #[cfg(not(windows))]
    options.write(true);
    options.open(path)?.set_times(times)
}

/// Runs `items` on `threads` threads (in order when 1).
fn run_parallel(items: &[&PlanItem], threads: usize, exec: &Executor) {
    let run = |item: &&PlanItem| {
        if exec.state.wait_while_paused() {
            exec.run(item);
        }
    };
    if threads <= 1 || items.len() <= 1 {
        items.iter().for_each(run);
        return;
    }
    match rayon::ThreadPoolBuilder::new().num_threads(threads).stack_size(16 * MIB).build() {
        Ok(pool) => pool.install(|| items.par_iter().for_each(run)),
        Err(_) => items.iter().for_each(run),
    }
}

/// Direct I/O tuning and how many large files to copy at once, from the
/// storage on both sides: ((request size, requests in flight), large
/// files at once, a log line saying so).
fn copy_tuning(request: &TransferRequest) -> ((usize, usize), usize, String) {
    #[cfg(windows)]
    {
        use crate::platform::windows::directio::{medium_of, Medium};
        let src = medium_of(Path::new(&request.source));
        let dst = medium_of(Path::new(&request.destination));
        let name = |m: Medium| match m {
            Medium::Solid => "SSD",
            Medium::Rotational => "hard disk",
            Medium::Network => "network",
            Medium::Unknown => "unknown storage",
        };
        let either = |m: Medium| src == m || dst == m;
        let (tuning, parallel) = if either(Medium::Rotational) {
            ((16 * MIB, 2), 1)
        } else if either(Medium::Network) {
            ((4 * MIB, 8), 2)
        } else if src == Medium::Solid && dst == Medium::Solid {
            ((8 * MIB, 4), 2)
        } else {
            ((8 * MIB, 4), 1)
        };
        let described = format!(
            "Copy engine: {} to {} - files of {} MB+ by direct I/O ({} MB x {} in flight, {} at a time), smaller ones {} at a time.",
            name(src),
            name(dst),
            DIRECT_MIN_BYTES / MIB as u64,
            tuning.0 / MIB,
            tuning.1,
            parallel,
            SMALL_FILE_THREADS
        );
        #[cfg(test)]
        let (tuning, parallel) = bench_overrides(tuning, parallel);
        (tuning, parallel, described)
    }
    #[cfg(not(windows))]
    {
        let _ = request;
        ((8 * MIB, 4), 2, "Copy engine: buffered copies.".to_string())
    }
}

/// After a move: removes the source folders it emptied, deepest first,
/// never the source root itself.
fn remove_emptied_folders(request: &TransferRequest, items: &[PlanItem]) {
    let root = Path::new(&request.source);
    let mut folders: Vec<PathBuf> = items
        .iter()
        .filter_map(|i| {
            let path = Path::new(&i.source_path);
            if i.is_folder { Some(path.to_path_buf()) } else { path.parent().map(Path::to_path_buf) }
        })
        .flat_map(|p| p.ancestors().map(Path::to_path_buf).collect::<Vec<_>>())
        .filter(|p| p.starts_with(root) && p != root)
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    folders.sort_by_key(|p| std::cmp::Reverse(p.components().count()));
    for folder in folders {
        // Fails (harmlessly) unless the folder is empty.
        let _ = fs::remove_dir(&folder);
    }
}

impl Executor<'_> {
    fn run(&self, item: &PlanItem) {
        if self.state.is_cancelled() {
            return;
        }
        let result = self.carry_out(item);
        self.state.clear_active(item.id);
        let mut outcome = self.outcome.lock().unwrap();
        match result {
            Ok(done) => {
                self.journal.mark_done(item.id);
                if counts_as_file(item) {
                    self.state.files_done.fetch_add(1, Ordering::Relaxed);
                }
                let status = if matches!(done, Finished::AlreadyDone) { ItemStatus::Skipped } else { ItemStatus::Done };
                match done {
                    Finished::Copied { bytes, verified } => {
                        outcome.files_copied += 1;
                        outcome.bytes_copied += bytes;
                        if verified {
                            outcome.files_verified += 1;
                        }
                        if self.verbose {
                            self.state.log(format!("Copied {}", item.relative_path));
                        }
                    }
                    Finished::Deleted => {
                        outcome.files_deleted += 1;
                        if self.verbose {
                            self.state.log(format!("Deleted {}", target_of(item).display()));
                        }
                    }
                    Finished::FolderCreated => outcome.folders_created += 1,
                    Finished::AlreadyDone => outcome.files_skipped += 1,
                }
                self.state.push_update(item.id, status, None);
            }
            Err(e) if e == "cancelled" => {}
            Err(message) => {
                if item.action.copies() {
                    self.state.bytes_done.fetch_add(item.size, Ordering::Relaxed);
                }
                if counts_as_file(item) {
                    self.state.files_done.fetch_add(1, Ordering::Relaxed);
                }
                self.state.errors.fetch_add(1, Ordering::Relaxed);
                outcome.error_count += 1;
                let path = item.source_path.clone();
                self.state.log(format!("ERROR {path}: {message}"));
                if outcome.errors.len() < MAX_REPORTED_ERRORS {
                    outcome.errors.push(TransferError { path, message: message.clone() });
                }
                self.state.push_update(item.id, ItemStatus::Error, Some(message));
            }
        }
    }

    fn carry_out(&self, item: &PlanItem) -> Result<Finished, String> {
        let options = &self.request.options;
        let (from, to) = direction(item);
        match item.action {
            PlanAction::CreateFolder => {
                fs::create_dir_all(&to).map_err(|e| e.to_string())?;
                if options.preserve_permissions {
                    if let Err(e) = platform::current::copy_dacl(&from, &to) {
                        self.state.log(format!("WARNING {}: {e}", to.display()));
                    }
                }
                if self.request.mode == TransferMode::Move {
                    let _ = fs::remove_dir(&from);
                }
                Ok(Finished::FolderCreated)
            }
            PlanAction::DeleteDest | PlanAction::DeleteSource => {
                let target = target_of(item);
                if fs::symlink_metadata(&target).is_err() {
                    return Ok(Finished::AlreadyDone);
                }
                self.state.set_current_file(&target.to_string_lossy());
                delete(&target, item.is_folder, options.use_recycle_bin).map(|_| Finished::Deleted)
            }
            _ => {
                if !from.exists() {
                    // A move that finished before the app stopped, but
                    // whose journal line didn't make it to disk.
                    if self.resuming && to.exists() {
                        return Ok(Finished::AlreadyDone);
                    }
                    return Err("the source file no longer exists".into());
                }
                self.transfer_file(item, &from, &to)
            }
        }
    }

    fn transfer_file(&self, item: &PlanItem, from: &Path, to: &Path) -> Result<Finished, String> {
        let options = &self.request.options;
        let state = self.state;
        state.set_current_file(&from.to_string_lossy());
        let parent = to.parent().ok_or("invalid destination path")?;
        if !parent.exists() {
            if !options.create_missing_folders {
                return Err(format!("destination folder {} does not exist", parent.display()));
            }
            fs::create_dir_all(parent).map_err(|e| format!("creating {}: {e}", parent.display()))?;
        }

        // A move within one volume is a rename: instant, and the file
        // keeps its timestamps, attributes and permissions as they are.
        if self.request.mode == TransferMode::Move && item.action != PlanAction::RenameCopy {
            if to.exists() {
                platform::current::clear_readonly(to);
            }
            if fs::rename(from, to).is_ok() {
                state.bytes_done.fetch_add(item.size, Ordering::Relaxed);
                return Ok(Finished::Copied { bytes: item.size, verified: false });
            }
        }

        let verified = self.copy_contents(item, from, to)?;

        if self.request.mode == TransferMode::Move {
            platform::current::clear_readonly(from);
            fs::remove_file(from).map_err(|e| format!("copied, but removing the source failed: {e}"))?;
        }
        Ok(Finished::Copied { bytes: item.size, verified })
    }

    /// Copies `from` to `to` through a `.dmp-part` file; returns whether
    /// the copy was verified. Large files go through native unbuffered,
    /// overlapped I/O (`platform::windows::directio`); small ones - and
    /// anything direct I/O can't handle - through a plain buffered copy.
    fn copy_contents(&self, item: &PlanItem, from: &Path, to: &Path) -> Result<bool, String> {
        let options = &self.request.options;
        let state = self.state;
        let metadata = fs::metadata(from).map_err(|e| format!("opening the source: {e}"))?;
        let size = metadata.len();
        // Small files on Windows are copied by the kernel (CopyFileExW).
        // A new one goes straight to its final name: the extra rename of a
        // .dmp-part file made Defender scan every file twice, doubling the
        // time for thousands of small files. An existing file is still
        // replaced through .dmp-part, so it's never left half-overwritten.
        let kernel_copy = cfg!(windows) && size < DIRECT_MIN_BYTES && !force_buffered();
        let part = if kernel_copy && !to.exists() { to.to_path_buf() } else { part_path(to) };

        // Resume a large copy from its last checkpoint - only if the
        // source still looks the way the plan saw it.
        let resume_at = self
            .resume
            .partial
            .get(&item.id)
            .copied()
            .filter(|_| size == item.size)
            .filter(|&offset| fs::metadata(&part).is_ok_and(|m| m.len() >= offset));
        if let Some(offset) = resume_at.filter(|o| *o > 0) {
            state.log(format!("Resuming {} at {} MB", item.relative_path, offset / (1024 * 1024)));
        }
        if size >= ACTIVE_MIN_BYTES {
            state.push_update(item.id, ItemStatus::InProgress, None);
        }

        let times = options.preserve_timestamps.then(|| {
            let mut times = fs::FileTimes::new();
            if let Ok(t) = metadata.modified() {
                times = times.set_modified(t);
            }
            if let Ok(t) = metadata.accessed() {
                times = times.set_accessed(t);
            }
            #[cfg(windows)]
            if let Ok(t) = metadata.created() {
                use std::os::windows::fs::FileTimesExt;
                times = times.set_created(t);
            }
            times
        });

        #[cfg(windows)]
        let direct = if size >= DIRECT_MIN_BYTES && !force_buffered() {
            self.stream_direct(item, from, &part, size, resume_at)?
        } else {
            None
        };
        #[cfg(not(windows))]
        let direct: Option<Option<u128>> = None;
        let direct = match direct {
            None if kernel_copy => Some(self.copy_by_kernel(from, &part, size)?),
            other => other,
        };
        let source_hash = match direct {
            Some(hash) => {
                // The copy has closed its handles: reopen once, for the
                // attributes only (no data access, so nothing rescans it).
                // Without "preserve timestamps" the copy gets the time now.
                let times = times.unwrap_or_else(|| fs::FileTimes::new().set_modified(std::time::SystemTime::now()));
                if let Err(e) = set_file_times(&part, times) {
                    state.log(format!("WARNING {}: keeping timestamps failed: {e}", to.display()));
                }
                hash
            }
            None => self.stream_buffered(item, from, &part, size, resume_at, times)?,
        };

        let mut verified = false;
        if options.verify_after_transfer {
            state.set_current_file(&format!("Verifying {}", to.display()));
            let expected = match source_hash {
                Some(h) => Ok(h),
                None => hash_path(from, state),
            };
            let actual = hash_path(&part, state);
            match (expected, actual) {
                (Ok(a), Ok(b)) if a == b => verified = true,
                (Ok(_), Ok(_)) => {
                    let _ = fs::remove_file(&part);
                    return Err("verification failed: the copy differs from the source".into());
                }
                (Err(e), _) | (_, Err(e)) => {
                    if state.is_cancelled() {
                        return Err("cancelled".into());
                    }
                    let _ = fs::remove_file(&part);
                    return Err(format!("verification failed: {e}"));
                }
            }
        }

        if part != to && to.exists() {
            platform::current::clear_readonly(to);
        }
        if part != to {
        fs::rename(&part, to).map_err(|e| {
            let _ = fs::remove_file(&part);
            format!("replacing the destination file: {e}")
        })?;
        }
        // A new file is already "archive"; only read-only/hidden/system/
        // not-indexed need setting - skipping the call matters with
        // thousands of small files.
        #[cfg(windows)]
        let attributes_to_copy = !kernel_copy && std::os::windows::fs::MetadataExt::file_attributes(&metadata) & 0x2007 != 0;
        #[cfg(not(windows))]
        let attributes_to_copy = true;
        if attributes_to_copy {
            if let Err(e) = platform::current::copy_attributes(from, to) {
                state.log(format!("WARNING {}: {e}", to.display()));
            }
        }
        if options.preserve_permissions {
            if let Err(e) = platform::current::copy_dacl(from, to) {
                state.log(format!("WARNING {}: {e}", to.display()));
            }
        }
        Ok(verified)
    }

    /// A small file by the kernel's own copy (CopyFileExW: data,
    /// attributes and modified time in one call). No hash on the way, so
    /// verification re-reads both.
    fn copy_by_kernel(&self, from: &Path, target: &Path, size: u64) -> Result<Option<u128>, String> {
        if target.exists() {
            platform::current::clear_readonly(target);
        }
        if let Err(e) = fs::copy(from, target) {
            let _ = fs::remove_file(target);
            return Err(format!("copying: {e}"));
        }
        self.state.bytes_done.fetch_add(size, Ordering::Relaxed);
        Ok(None)
    }

    /// Counts resumed bytes as done; returns the resume offset.
    fn count_resumed(&self, resume_at: Option<u64>) -> u64 {
        let offset = resume_at.unwrap_or(0);
        self.state.bytes_done.fetch_add(offset, Ordering::Relaxed);
        offset
    }

    /// The plain, buffered copy. Returns the source's hash when it could
    /// be computed along the way (a fresh copy with verification on).
    fn stream_buffered(
        &self,
        item: &PlanItem,
        from: &Path,
        part: &Path,
        size: u64,
        resume_at: Option<u64>,
        times: Option<fs::FileTimes>,
    ) -> Result<Option<u128>, String> {
        let state = self.state;
        let mut input = File::open(from).map_err(|e| format!("opening the source: {e}"))?;
        let mut output = match resume_at {
            Some(offset) => {
                let file = fs::OpenOptions::new()
                    .write(true)
                    .open(part)
                    .map_err(|e| format!("reopening the partial copy: {e}"))?;
                file.set_len(offset).map_err(|e| e.to_string())?;
                input.seek(SeekFrom::Start(offset)).map_err(|e| e.to_string())?;
                file
            }
            None => File::create(part).map_err(|e| format!("creating the destination file: {e}"))?,
        };
        let started_at = self.count_resumed(resume_at);
        let mut written = started_at;
        if written > 0 {
            output.seek(SeekFrom::Start(written)).map_err(|e| e.to_string())?;
        }
        // Hash while copying, so verifying only has to re-read the copy.
        let mut source_hash = (self.request.options.verify_after_transfer && written == 0).then(Xxh3::new);
        let track = size >= ACTIVE_MIN_BYTES;
        // Sized to the file: a fresh 1 MB zeroed buffer per small file
        // was measurable with thousands of them.
        let mut buf = vec![0u8; (size as usize).clamp(4096, COPY_BUFFER)];
        let mut since_checkpoint = 0u64;
        let result: Result<(), String> = (|| loop {
            if !state.wait_while_paused() {
                // Keep what's on disk for a later resume.
                let _ = output.sync_data();
                self.journal.checkpoint(item.id, written);
                return Err("cancelled".into());
            }
            let n = input.read(&mut buf).map_err(|e| format!("reading: {e}"))?;
            if n == 0 {
                return Ok(());
            }
            output.write_all(&buf[..n]).map_err(|e| format!("writing: {e}"))?;
            if let Some(h) = source_hash.as_mut() {
                h.update(&buf[..n]);
            }
            written += n as u64;
            since_checkpoint += n as u64;
            state.bytes_done.fetch_add(n as u64, Ordering::Relaxed);
            if track {
                state.set_active(item.id, written, size);
            }
            if since_checkpoint >= CHECKPOINT_BYTES {
                since_checkpoint = 0;
                if output.sync_data().is_ok() {
                    self.journal.checkpoint(item.id, written);
                }
            }
        })();
        if let Err(e) = result {
            if e != "cancelled" {
                state.bytes_done.fetch_sub(written - started_at, Ordering::Relaxed);
                drop(output);
                let _ = fs::remove_file(part);
            }
            return Err(e);
        }
        output.flush().map_err(|e| e.to_string())?;
        // On the open handle: no second open just for the times.
        if let Some(times) = times {
            if let Err(e) = output.set_times(times) {
                state.log(format!("WARNING {}: keeping timestamps failed: {e}", part.display()));
            }
        }
        Ok(source_hash.map(|h| h.digest128()))
    }

    /// The native direct-I/O copy. `Ok(None)`: direct I/O isn't possible
    /// for this file or volume - use the buffered copy instead.
    #[cfg(windows)]
    fn stream_direct(&self, item: &PlanItem, from: &Path, part: &Path, size: u64, resume_at: Option<u64>) -> Result<Option<Option<u128>>, String> {
        use crate::platform::windows::directio::{copy_direct, CopySink, DirectCopy};

        struct Sink<'a, 'b> {
            exec: &'a Executor<'b>,
            id: u32,
            size: u64,
            hash: Option<Xxh3>,
            last_checkpoint: u64,
            counted: u64,
        }
        impl CopySink for Sink<'_, '_> {
            fn data(&mut self, chunk: &[u8]) -> bool {
                if !self.exec.state.wait_while_paused() {
                    return false;
                }
                if let Some(h) = self.hash.as_mut() {
                    h.update(chunk);
                }
                true
            }
            fn written(&mut self, total: u64) {
                let state = self.exec.state;
                state.bytes_done.fetch_add(total - self.counted, Ordering::Relaxed);
                self.counted = total;
                if self.size >= ACTIVE_MIN_BYTES {
                    state.set_active(self.id, total, self.size);
                }
                // Unbuffered writes are on the disk once complete: no
                // flush needed before journaling the offset.
                if total - self.last_checkpoint >= CHECKPOINT_BYTES {
                    self.last_checkpoint = total;
                    self.exec.journal.checkpoint(self.id, total);
                }
            }
        }

        let (chunk, depth) = self.direct_tuning;
        // Direct I/O resumes on a sector boundary (journaled checkpoints
        // already are; 64 KB covers every sector size).
        let started_at = self.count_resumed(resume_at.map(|o| o / (64 * 1024) * (64 * 1024)));
        let mut sink = Sink {
            exec: self,
            id: item.id,
            size,
            hash: (self.request.options.verify_after_transfer && started_at == 0).then(Xxh3::new),
            last_checkpoint: started_at,
            counted: started_at,
        };
        let job = DirectCopy { from, to: part, size, resume_at: started_at, chunk, depth };
        match copy_direct(&job, &mut sink) {
            Ok(_) => Ok(Some(sink.hash.map(|h| h.digest128()))),
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => {
                self.journal.checkpoint(item.id, sink.counted);
                Err("cancelled".into())
            }
            Err(e) => {
                let counted = sink.counted;
                self.state.bytes_done.fetch_sub(counted, Ordering::Relaxed);
                // ERROR_INVALID_FUNCTION / NOT_SUPPORTED / INVALID_PARAMETER:
                // a file system or share that refuses unbuffered I/O.
                if counted == started_at && matches!(e.raw_os_error(), Some(1 | 50 | 87)) {
                    self.state.log(format!("{}: direct I/O unavailable ({e}), using a buffered copy", item.relative_path));
                    return Ok(None);
                }
                let _ = fs::remove_file(part);
                Err(format!("copying: {e}"))
            }
        }
    }
}

/// Whether an item counts toward the "files" progress: files, and a folder
/// deleted as a whole - not folders being created.
fn counts_as_file(item: &PlanItem) -> bool {
    !item.is_folder || item.action == PlanAction::DeleteDest
}

/// (from, to) for a copying action.
fn direction(item: &PlanItem) -> (PathBuf, PathBuf) {
    match item.action {
        PlanAction::CopyBack | PlanAction::UpdateBack => {
            (PathBuf::from(&item.dest_path), PathBuf::from(&item.source_path))
        }
        _ => (PathBuf::from(&item.source_path), PathBuf::from(&item.dest_path)),
    }
}

fn target_of(item: &PlanItem) -> PathBuf {
    match item.action {
        PlanAction::DeleteSource => PathBuf::from(&item.source_path),
        _ => PathBuf::from(&item.dest_path),
    }
}

fn part_path(to: &Path) -> PathBuf {
    let mut name = to.file_name().unwrap_or_default().to_os_string();
    name.push(PART_SUFFIX);
    to.with_file_name(name)
}

fn delete(path: &Path, is_folder: bool, use_recycle_bin: bool) -> Result<(), String> {
    if use_recycle_bin {
        match platform::current::recycle(path) {
            Ok(()) => return Ok(()),
            Err(e) => tracing::info!(path = %path.display(), reason = %e, "recycle failed, deleting"),
        }
    }
    if is_folder {
        fs::remove_dir_all(path).map_err(|e| e.to_string())
    } else {
        platform::current::clear_readonly(path);
        fs::remove_file(path).map_err(|e| e.to_string())
    }
}

/// After a two-way run: what both sides look like now, for the next run
/// to compare against.
pub fn capture_sync_state(request: &TransferRequest, state: &TransferState) -> SyncState {
    let filters = Filters::new(&request.options);
    let src = list_side(Path::new(&request.source), &request.options, &filters, state);
    let dst = list_side(Path::new(&request.destination), &request.options, &filters, state);
    let files: HashMap<String, SyncedPair> = src
        .entries
        .iter()
        .filter(|(_, s)| !s.is_dir)
        .filter_map(|(key, s)| {
            let d = dst.entries.get(key).filter(|d| !d.is_dir)?;
            Some((
                key.clone(),
                SyncedPair {
                    src_size: s.size,
                    src_mtime: unix_secs(s.modified)?,
                    dst_size: d.size,
                    dst_mtime: unix_secs(d.modified)?,
                },
            ))
        })
        .collect();
    SyncState {
        source: request.source.clone(),
        destination: request.destination.clone(),
        saved_at: system_time_to_iso8601(SystemTime::now()).unwrap_or_default(),
        files,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::transfer_journal::JournalHeader;
    use std::time::Duration;

    fn options() -> TransferOptions {
        serde_json::from_str("{}").unwrap()
    }

    fn request(src: &Path, dst: &Path, mode: TransferMode, collision: CollisionPolicy) -> TransferRequest {
        TransferRequest {
            source: src.to_string_lossy().into_owned(),
            destination: dst.to_string_lossy().into_owned(),
            mode,
            collision,
            options: options(),
            files: None,
        }
    }

    fn write(path: &Path, contents: &str, age_secs: u64) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, contents).unwrap();
        let t = SystemTime::now() - Duration::from_secs(age_secs);
        File::options().write(true).open(path).unwrap().set_modified(t).unwrap();
    }

    fn actions(plan: &PlanOutcome) -> Vec<(String, PlanAction)> {
        let mut v: Vec<_> = plan.items.iter().map(|i| (i.relative_path.clone(), i.action)).collect();
        v.sort();
        v
    }

    /// Plans and executes every work item, like Data Transfer does.
    fn run(req: &TransferRequest, sync: Option<&SyncState>) -> (PlanOutcome, ExecuteOutcome) {
        let state = TransferState::new();
        let plan = analyze(req, sync, &state);
        let work: Vec<PlanItem> = plan.items.iter().filter(|i| i.action.is_work()).cloned().collect();
        let dir = tempfile::tempdir().unwrap();
        let journal = Journal::create(
            dir.path(),
            &JournalHeader { job_id: "t".into(), request: req.clone(), started_at: String::new(), items: work.clone() },
        )
        .unwrap();
        let outcome = execute(req, &work, &journal, &JournalProgress::default(), &state);
        (plan, outcome)
    }

    #[test]
    fn glob_matching() {
        let m = |p: &str, t: &str| glob_match(&p.chars().collect::<Vec<_>>(), &t.chars().collect::<Vec<_>>());
        assert!(m("*.tmp", "a.tmp"));
        assert!(!m("*.tmp", "a.tmpx"));
        assert!(m("a?c", "abc"));
        assert!(m("*", ""));
        assert!(m("*a*b", "xxaxxb"));
        assert!(!m("*a*b", "xxaxxbc"));
    }

    #[test]
    fn filters_include_exclude_and_folders() {
        let mut o = options();
        o.include_filters = "*.*".into();
        o.exclude_filters = "*.tmp; node_modules".into();
        let f = Filters::new(&o);
        assert!(f.include.is_empty(), "*.* means everything");
        assert!(f.includes_file("a\\b.txt", "b.txt"));
        assert!(!f.includes_file("a\\b.TMP", "b.TMP"));
        assert!(f.excludes_folder("x\\node_modules", "node_modules"));
    }

    #[test]
    fn copy_skips_same_and_creates_tree() {
        let src = tempfile::tempdir().unwrap();
        let dst = tempfile::tempdir().unwrap();
        write(&src.path().join("a.txt"), "hello", 100);
        write(&src.path().join("sub\\b.txt"), "world", 100);
        fs::create_dir_all(src.path().join("empty")).unwrap();
        let req = request(src.path(), dst.path(), TransferMode::Copy, CollisionPolicy::SkipSame);

        let (_, outcome) = run(&req, None);
        assert_eq!(outcome.files_copied, 2);
        assert_eq!(outcome.folders_created, 1);
        assert_eq!(fs::read_to_string(dst.path().join("sub\\b.txt")).unwrap(), "world");
        assert!(dst.path().join("empty").is_dir());
        // Timestamps carried over, so a second run skips everything.
        let (plan, outcome) = run(&req, None);
        assert_eq!(outcome.files_copied, 0);
        assert_eq!(plan.summary.unchanged_files, 2);
        assert!(!dst.path().join("a.txt.dmp-part").exists());
    }

    #[test]
    fn collision_policies() {
        let src = tempfile::tempdir().unwrap();
        let dst = tempfile::tempdir().unwrap();
        write(&src.path().join("new.txt"), "newer", 10);
        write(&dst.path().join("new.txt"), "older", 1000);
        write(&src.path().join("old.txt"), "older", 1000);
        write(&dst.path().join("old.txt"), "newer", 10);

        let mut req = request(src.path(), dst.path(), TransferMode::Copy, CollisionPolicy::OverwriteOlder);
        let state = TransferState::new();
        let plan = analyze(&req, None, &state);
        assert_eq!(
            actions(&plan),
            vec![("new.txt".into(), PlanAction::Update), ("old.txt".into(), PlanAction::SkipOlder)]
        );

        req.collision = CollisionPolicy::RenameNew;
        let (_, outcome) = run(&req, None);
        assert_eq!(outcome.files_copied, 2);
        assert_eq!(fs::read_to_string(dst.path().join("new (1).txt")).unwrap(), "newer");
        assert_eq!(fs::read_to_string(dst.path().join("new.txt")).unwrap(), "older");

        req.collision = CollisionPolicy::CompareHash;
        let plan = analyze(&req, None, &TransferState::new());
        // old.txt: dst holds "newer" vs src "older" - same length, other bytes.
        assert!(actions(&plan).contains(&("old.txt".into(), PlanAction::Update)));
    }

    #[test]
    fn move_removes_sources_and_emptied_folders() {
        let src = tempfile::tempdir().unwrap();
        let dst = tempfile::tempdir().unwrap();
        write(&src.path().join("d\\e\\f.txt"), "x", 100);
        let req = request(src.path(), dst.path(), TransferMode::Move, CollisionPolicy::SkipSame);
        let (_, outcome) = run(&req, None);
        assert_eq!(outcome.files_copied, 1);
        assert!(dst.path().join("d\\e\\f.txt").exists());
        assert!(!src.path().join("d").exists());
        assert!(src.path().exists());
    }

    #[test]
    fn mirror_deletes_extras_including_whole_folders() {
        let src = tempfile::tempdir().unwrap();
        let dst = tempfile::tempdir().unwrap();
        write(&src.path().join("keep.txt"), "k", 100);
        write(&dst.path().join("keep.txt"), "k", 100);
        write(&dst.path().join("extra.txt"), "e", 100);
        write(&dst.path().join("gone\\a.txt"), "aa", 100);
        write(&dst.path().join("gone\\b.txt"), "bbb", 100);
        let mut req = request(src.path(), dst.path(), TransferMode::Mirror, CollisionPolicy::SkipSame);
        req.options.use_recycle_bin = false;
        let (plan, outcome) = run(&req, None);
        assert_eq!(plan.summary.deletions, 2, "the folder goes as one item");
        assert_eq!(plan.summary.deletion_bytes, 6);
        assert_eq!(outcome.files_deleted, 2);
        assert!(!dst.path().join("gone").exists());
        assert!(dst.path().join("keep.txt").exists());
    }

    #[test]
    fn incremental_keeps_extras_and_honours_excludes() {
        let src = tempfile::tempdir().unwrap();
        let dst = tempfile::tempdir().unwrap();
        write(&src.path().join("a.txt"), "a", 100);
        write(&src.path().join("a.tmp"), "t", 100);
        write(&dst.path().join("extra.txt"), "e", 100);
        let mut req = request(src.path(), dst.path(), TransferMode::Incremental, CollisionPolicy::SkipSame);
        req.options.exclude_filters = "*.tmp".into();
        let (plan, _) = run(&req, None);
        assert_eq!(
            actions(&plan),
            vec![("a.tmp".into(), PlanAction::Excluded), ("a.txt".into(), PlanAction::CopyNew)]
        );
        assert!(dst.path().join("extra.txt").exists());
    }

    #[test]
    fn two_way_propagates_edits_and_deletions_using_saved_state() {
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        write(&a.path().join("shared.txt"), "v1", 1000);
        write(&a.path().join("doomed.txt"), "d", 1000);
        write(&b.path().join("from-b.txt"), "b", 1000);
        let req = request(a.path(), b.path(), TransferMode::TwoWay, CollisionPolicy::SkipSame);

        // First run: union, nothing deleted.
        let (_, outcome) = run(&req, None);
        assert_eq!(outcome.files_copied, 3);
        let saved = capture_sync_state(&req, &TransferState::new());
        assert_eq!(saved.files.len(), 3);

        // Edit on B, delete on A, edit both sides of another file.
        write(&b.path().join("shared.txt"), "v2 from b", 10);
        fs::remove_file(a.path().join("doomed.txt")).unwrap();
        write(&a.path().join("from-b.txt"), "edited on a", 10);
        write(&b.path().join("from-b.txt"), "edited on b", 5);

        let plan = analyze(&req, Some(&saved), &TransferState::new());
        assert_eq!(
            actions(&plan),
            vec![
                ("doomed.txt".into(), PlanAction::DeleteDest),
                ("from-b.txt".into(), PlanAction::Conflict),
                ("shared.txt".into(), PlanAction::UpdateBack),
            ]
        );
        let mut req = req;
        req.options.use_recycle_bin = false;
        let (_, outcome) = run(&req, Some(&saved));
        assert_eq!(outcome.files_copied, 1);
        assert_eq!(outcome.files_deleted, 1);
        assert_eq!(fs::read_to_string(a.path().join("shared.txt")).unwrap(), "v2 from b");
        assert!(!b.path().join("doomed.txt").exists());
    }

    #[test]
    fn verification_and_resume_from_a_checkpoint() {
        let src = tempfile::tempdir().unwrap();
        let dst = tempfile::tempdir().unwrap();
        let data: Vec<u8> = (0..3_000_000u32).map(|i| (i % 251) as u8).collect();
        fs::write(src.path().join("big.bin"), &data).unwrap();
        let mut req = request(src.path(), dst.path(), TransferMode::Copy, CollisionPolicy::SkipSame);
        req.options.verify_after_transfer = true;

        let state = TransferState::new();
        let plan = analyze(&req, None, &state);
        let item = plan.items[0].clone();
        // Simulate an interrupted copy: 1 MB already in the part file,
        // journaled as a checkpoint.
        fs::write(dst.path().join("big.bin.dmp-part"), &data[..1_000_000]).unwrap();
        let mut resume = JournalProgress::default();
        resume.partial.insert(item.id, 1_000_000);
        let dir = tempfile::tempdir().unwrap();
        let journal = Journal::create(
            dir.path(),
            &JournalHeader { job_id: "r".into(), request: req.clone(), started_at: String::new(), items: vec![item.clone()] },
        )
        .unwrap();
        let outcome = execute(&req, &[item], &journal, &resume, &state);
        assert_eq!(outcome.error_count, 0, "{:?}", outcome.errors);
        assert_eq!(outcome.files_verified, 1);
        assert_eq!(fs::read(dst.path().join("big.bin")).unwrap(), data);
        assert_eq!(state.bytes_done.load(Ordering::Relaxed), data.len() as u64);
    }

    /// Files of DIRECT_MIN_BYTES and up take the direct-I/O path.
    #[cfg(windows)]
    #[test]
    fn large_files_copy_verify_and_resume_through_direct_io() {
        let src = tempfile::tempdir().unwrap();
        let dst = tempfile::tempdir().unwrap();
        let data: Vec<u8> = (0..(DIRECT_MIN_BYTES as usize + 3_456_789)).map(|i| (i % 249) as u8).collect();
        fs::write(src.path().join("big.iso"), &data).unwrap();
        let mut req = request(src.path(), dst.path(), TransferMode::Copy, CollisionPolicy::SkipSame);
        req.options.verify_after_transfer = true;

        let (_, outcome) = run(&req, None);
        assert_eq!(outcome.error_count, 0, "{:?}", outcome.errors);
        assert_eq!(outcome.files_verified, 1);
        assert_eq!(fs::read(dst.path().join("big.iso")).unwrap(), data);

        // Resume: half the file already in the part file, journaled.
        fs::remove_file(dst.path().join("big.iso")).unwrap();
        let state = TransferState::new();
        let item = analyze(&req, None, &state).items[0].clone();
        let half = 8 * 1024 * 1024;
        fs::write(dst.path().join("big.iso.dmp-part"), &data[..half]).unwrap();
        let mut resume = JournalProgress::default();
        resume.partial.insert(item.id, half as u64);
        let dir = tempfile::tempdir().unwrap();
        let journal = Journal::create(
            dir.path(),
            &JournalHeader { job_id: "d".into(), request: req.clone(), started_at: String::new(), items: vec![item.clone()] },
        )
        .unwrap();
        let outcome = execute(&req, &[item], &journal, &resume, &state);
        assert_eq!(outcome.error_count, 0, "{:?}", outcome.errors);
        assert_eq!(fs::read(dst.path().join("big.iso")).unwrap(), data);
        assert_eq!(state.bytes_done.load(Ordering::Relaxed), data.len() as u64);
    }

    #[test]
    fn explicit_file_list_copies_into_destination() {
        let src = tempfile::tempdir().unwrap();
        let dst = tempfile::tempdir().unwrap();
        write(&src.path().join("deep\\x.txt"), "x", 100);
        let mut req = request(src.path(), dst.path(), TransferMode::Copy, CollisionPolicy::RenameNew);
        req.files = Some(vec![src.path().join("deep\\x.txt").to_string_lossy().into_owned()]);
        let (_, outcome) = run(&req, None);
        assert_eq!(outcome.files_copied, 1);
        assert!(dst.path().join("x.txt").exists());
    }
}
