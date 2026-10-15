//! Data shapes for the Phase 3 recursive scanner: a real, streamed
//! `FsNode` tree replacing Phase 1's mock trees, backed by either a
//! multithreaded directory walk or a best-effort raw MFT read on NTFS
//! volumes - see `services::scan_service` and
//! `platform::current::try_mft_scan`.

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;

/// Options accepted by `start_scan` - same shape/defaults as
/// `ListDirectoryOptions` for consistency.
#[derive(Debug, Clone, Copy, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanOptions {
    #[serde(default)]
    pub show_hidden: bool,
    #[serde(default)]
    pub show_system: bool,
    /// Walk-engine threads (Settings > Scanning); `None` uses every core.
    #[serde(default)]
    pub threads: Option<usize>,
}

/// Which engine actually produced a scan - surfaced to the frontend so
/// it can honestly report whether the MFT fast path engaged. That path
/// needs admin/backup privilege to open a raw volume handle; without
/// it, every scan silently and automatically falls back to `Walk`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ScanEngine {
    Mft,
    Walk,
}

/// Which engine actually ran isn't known until a scan finishes (the
/// MFT-vs-walk decision happens inside the scan itself), so it's only
/// ever reported on `ScanResult`, never on a progress tick.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub scan_id: String,
    pub scanned_files: u64,
    pub scanned_folders: u64,
    pub scanned_bytes: u64,
    pub current_path: String,
    pub elapsed_ms: u64,
}

/// A subtree that was skipped rather than aborting the whole scan -
/// same "record and continue" philosophy as
/// `filesystem_service::list_directory`'s per-entry skip-and-warn.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanSkip {
    pub path: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub scan_id: String,
    pub root: FsNode,
    pub engine: ScanEngine,
    pub elapsed_ms: u64,
    pub skipped: Vec<ScanSkip>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum NodeKind {
    Folder,
    File,
}

/// Mirrors `src/models/common.ts`'s `FsNode` field-for-field so the
/// frontend can use a real scan result exactly like it already uses
/// Phase 1's mock trees, with no adaptation layer - including that
/// `category` and `children` are genuinely *absent* keys when empty
/// (`skip_serializing_if`), matching `common.ts`'s `category?:`/
/// `children?:` optional-key convention exactly, rather than the
/// `| null` convention every other `Option<T>` in this crate's
/// frontend mirror uses. `category` is always absent from the
/// backend - categorizing by extension stays a frontend concern (see
/// Phase 2's "backend sends raw data" convention), to be wired up when
/// Phase 4 connects the Treemap.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsNode {
    /// The node's own normalized path - already unique, so it doubles
    /// as the id rather than replicating the mock data's synthetic
    /// `"n/..."` id scheme.
    pub id: String,
    pub name: String,
    pub path: String,
    pub kind: NodeKind,
    pub size: u64,
    pub allocated: u64,
    pub file_count: u64,
    pub folder_count: u64,
    pub percent_of_parent: f64,
    pub last_modified: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<FsNode>>,
}

/// Caps how many direct children a single folder carries in a
/// *transport* payload (`scan-complete`/`get_subtree`), folding the
/// smallest excess into one synthetic "Other (N items)" placeholder -
/// the same "Other" philosophy `src/components/treemap/Treemap.tsx`'s
/// own `bucketSmallest` uses for display.
///
/// Confirmed live this is a real problem, not a theoretical one: a
/// full `C:\` scan has folders with tens of thousands of *direct*
/// children (WinSxS alone has ~22,700), far past what anyone could
/// usefully browse as a flat list, and shipping all of them helped
/// freeze the webview for minutes.
///
/// Applied only when copying for transport (see
/// [`truncate_for_transport`]), never to the cached full tree itself -
/// so `analyze_subtree` still sees every file, including the ones
/// folded away here. The placeholder keeps the folded children's real
/// aggregate size/allocated/file_count/folder_count, so every total
/// stays accurate; what it gives up is drill-down into the folded tail.
pub const MAX_CHILDREN_PER_NODE: usize = 500;

/// How many levels of folder `children` a transport payload keeps
/// fully populated, counting the node passed to [`truncate_for_transport`]
/// itself as level 0 - beyond that, a folder's `children` becomes
/// `None` (its own `size`/`file_count`/`folder_count` stay the real,
/// accurate aggregate either way - only the detailed per-child
/// breakdown is dropped). `commands::scan::get_subtree` re-populates a
/// specific folder's children on demand once the user actually drills
/// into one that was truncated away.
pub const TRANSPORT_DEPTH: u32 = 2;

/// Builds a shallow copy of `node`'s subtree for sending over IPC,
/// bounded by depth (`depth_remaining`) and by breadth
/// ([`MAX_CHILDREN_PER_NODE`]). Confirmed live both bounds are needed
/// for a full `C:\` scan: breadth capping alone still left a
/// ~1.2M-node, ~380 MB `scan-complete` payload (most of that tree's
/// size comes from *depth* - real files nested many folders deep - not
/// from a handful of pathologically wide folders) that froze the
/// webview for minutes trying to receive and parse it.
///
/// Only clones what actually goes into the result - the full subtree
/// stays behind, untouched, in whatever `FsNode` this was called on,
/// typically the cached full tree `get_subtree` looks up from.
pub fn truncate_for_transport(node: &FsNode, depth_remaining: u32) -> FsNode {
    let children = if node.kind != NodeKind::Folder || depth_remaining == 0 {
        None
    } else {
        node.children.as_ref().map(|kids| {
            if kids.len() <= MAX_CHILDREN_PER_NODE {
                return kids
                    .iter()
                    .map(|c| truncate_for_transport(c, depth_remaining - 1))
                    .collect();
            }
            // Largest-first, so what gets folded away is always the
            // smallest, least individually-interesting tail.
            let mut sorted: Vec<&FsNode> = kids.iter().collect();
            sorted.sort_unstable_by_key(|c| std::cmp::Reverse(c.size));
            let (kept, folded) = sorted.split_at(MAX_CHILDREN_PER_NODE - 1);
            let mut out: Vec<FsNode> = kept
                .iter()
                .map(|c| truncate_for_transport(c, depth_remaining - 1))
                .collect();
            out.push(other_placeholder(folded, node.size));
            out
        })
    };
    FsNode {
        id: node.id.clone(),
        name: node.name.clone(),
        path: node.path.clone(),
        kind: node.kind,
        size: node.size,
        allocated: node.allocated,
        file_count: node.file_count,
        folder_count: node.folder_count,
        percent_of_parent: node.percent_of_parent,
        last_modified: node.last_modified.clone(),
        category: node.category.clone(),
        children,
    }
}

/// The synthetic "Other (N items)" node standing in for `folded` (never
/// empty - only called once a folder is past the cap). Its id ends in
/// `::other`, which the frontend's `needsChildren` uses to know there's
/// nothing to fetch for it.
fn other_placeholder(folded: &[&FsNode], parent_size: u64) -> FsNode {
    let mut size = 0u64;
    let mut allocated = 0u64;
    let mut file_count = 0u64;
    let mut folder_count = 0u64;
    for c in folded {
        size += c.size;
        allocated += c.allocated;
        if c.kind == NodeKind::File {
            file_count += 1;
        } else {
            file_count += c.file_count;
            folder_count += 1 + c.folder_count;
        }
    }
    let sample_path = folded[0].path.clone();
    FsNode {
        id: format!("{sample_path}::other"),
        name: format!("Other ({} items)", folded.len()),
        path: sample_path,
        kind: NodeKind::Folder,
        size,
        allocated,
        file_count,
        folder_count,
        percent_of_parent: if parent_size > 0 {
            (size as f64 / parent_size as f64) * 100.0
        } else {
            0.0
        },
        last_modified: None,
        category: None,
        children: None,
    }
}

/// Finds the node at `target_path` within `root`'s subtree (`root`
/// itself included) by exact `path` match, recursing only into
/// folders - used by `commands::scan::get_subtree` to look a
/// previously-truncated folder back up in the cached full tree. `None`
/// covers both "no such path in this scan" and "that path was itself
/// folded into a transport-only `Other (N items)` placeholder"
/// (which has no `children` to search) - both are reported to the
/// frontend the same way, as "can't be expanded any further".
pub fn find_node<'a>(root: &'a FsNode, target_path: &str) -> Option<&'a FsNode> {
    if root.path == target_path {
        return Some(root);
    }
    if root.kind != NodeKind::Folder {
        return None;
    }
    // Prune by path prefix rather than searching every sibling
    // subtree: `target_path` can only live under the one child whose
    // own path is a proper prefix of it, followed by a path
    // separator - keeps this O(depth), not O(tree size), even against
    // the cached full tree of a whole-drive scan.
    for child in root.children.as_deref().unwrap_or(&[]) {
        // The child can be the target itself, not only an ancestor
        // of it.
        if child.path == target_path
            || (target_path.len() > child.path.len()
                && target_path.as_bytes()[child.path.len()] == b'\\'
                && target_path.starts_with(&child.path))
        {
            return find_node(child, target_path);
        }
    }
    None
}

/// Shared, non-serialized runtime state for one in-progress scan -
/// deliberately kept in `models` (rather than `services` or
/// `platform`) so both the walk engine (`services::scan_service`) and
/// the MFT engine (`platform::current::try_mft_scan`) can depend on it
/// without either layer depending on the other.
///
/// Counters are atomics since the walk engine updates them from many
/// rayon worker threads at once; `current_path` and `skipped` are
/// behind a `Mutex` for the same reason. The MFT engine is inherently
/// single-threaded but takes the exact same type so the command
/// layer's progress ticker doesn't need to care which engine is
/// running.
pub struct ScanProgressState {
    pub cancel: AtomicBool,
    pub files: AtomicU64,
    pub folders: AtomicU64,
    pub bytes: AtomicU64,
    pub current_path: Mutex<String>,
    pub skipped: Mutex<Vec<ScanSkip>>,
}

/// Caps how many skipped subtrees a single scan records, so a location
/// with pathologically many access-denied folders can't blow up memory
/// or the eventual event payload.
const MAX_SKIPPED: usize = 200;

impl ScanProgressState {
    pub fn new() -> Self {
        Self {
            cancel: AtomicBool::new(false),
            files: AtomicU64::new(0),
            folders: AtomicU64::new(0),
            bytes: AtomicU64::new(0),
            current_path: Mutex::new(String::new()),
            skipped: Mutex::new(Vec::new()),
        }
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancel.load(Ordering::Relaxed)
    }

    pub fn cancel(&self) {
        self.cancel.store(true, Ordering::Relaxed);
    }

    /// Best-effort - uses `try_lock` so a busy walker never blocks on
    /// updating the "currently scanning" display path.
    pub fn set_current_path(&self, path: &str) {
        if let Ok(mut guard) = self.current_path.try_lock() {
            *guard = path.to_string();
        }
    }

    pub fn record_skip(&self, path: &str, reason: impl Into<String>) {
        let mut skipped = self.skipped.lock().unwrap();
        if skipped.len() < MAX_SKIPPED {
            skipped.push(ScanSkip {
                path: path.to_string(),
                reason: reason.into(),
            });
        }
    }

    pub fn take_skipped(&self) -> Vec<ScanSkip> {
        std::mem::take(&mut self.skipped.lock().unwrap())
    }
}

impl Default for ScanProgressState {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn node(path: &str, kind: NodeKind, children: Option<Vec<FsNode>>) -> FsNode {
        FsNode {
            id: path.into(),
            name: path.into(),
            path: path.into(),
            kind,
            size: 0,
            allocated: 0,
            file_count: 0,
            folder_count: 0,
            percent_of_parent: 0.0,
            last_modified: None,
            category: None,
            children,
        }
    }

    #[test]
    fn find_node_reaches_every_depth() {
        let tree = node(
            r"C:\",
            NodeKind::Folder,
            Some(vec![node(
                r"C:\Users",
                NodeKind::Folder,
                Some(vec![
                    node(r"C:\Users\Al", NodeKind::Folder, Some(vec![])),
                    node(
                        r"C:\Users\Alice",
                        NodeKind::Folder,
                        Some(vec![node(r"C:\Users\Alice\a.txt", NodeKind::File, None)]),
                    ),
                ]),
            )]),
        );
        for path in [
            r"C:\",
            r"C:\Users",
            r"C:\Users\Al",
            r"C:\Users\Alice",
            r"C:\Users\Alice\a.txt",
        ] {
            assert_eq!(find_node(&tree, path).map(|n| n.path.as_str()), Some(path));
        }
        // A sibling sharing a name prefix ("Al" vs "Alice") must not match.
        assert!(find_node(&tree, r"C:\Users\Alicia").is_none());
    }

    #[test]
    fn transport_copy_caps_breadth_and_depth_but_keeps_totals() {
        let n = MAX_CHILDREN_PER_NODE as u64 + 10;
        let files: Vec<FsNode> = (0..n)
            .map(|i| {
                let mut f = node(&format!(r"C:\wide\f{i}"), NodeKind::File, None);
                f.size = i + 1;
                f
            })
            .collect();
        let mut wide = node(r"C:\wide", NodeKind::Folder, Some(files));
        wide.size = (1..=n).sum();
        let deep = node(
            r"C:\a",
            NodeKind::Folder,
            Some(vec![node(
                r"C:\a\b",
                NodeKind::Folder,
                Some(vec![node(r"C:\a\b\c", NodeKind::Folder, Some(vec![]))]),
            )]),
        );
        let root = node(r"C:\", NodeKind::Folder, Some(vec![wide.clone(), deep]));

        let t = truncate_for_transport(&root, TRANSPORT_DEPTH);
        let kids = t.children.as_ref().unwrap();
        let wide_kids = kids[0].children.as_ref().unwrap();
        assert_eq!(wide_kids.len(), MAX_CHILDREN_PER_NODE);
        let other = wide_kids.last().unwrap();
        assert!(other.id.ends_with("::other"));
        assert_eq!(other.file_count, 11);
        // The 11 smallest files (sizes 1..=11) are the ones folded away,
        // and the visible children still add up to the folder's size.
        assert_eq!(other.size, (1..=11).sum::<u64>());
        assert_eq!(wide_kids.iter().map(|c| c.size).sum::<u64>(), wide.size);
        // Depth: C:\ (0) -> a (1) -> b (2, children dropped).
        let b = &kids[1].children.as_ref().unwrap()[0];
        assert!(b.children.is_none());
        // The source tree itself stays complete.
        assert_eq!(
            root.children.as_ref().unwrap()[0]
                .children
                .as_ref()
                .unwrap()
                .len(),
            n as usize
        );
    }
}
