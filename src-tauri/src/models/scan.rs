//! Scan types. A scan produces an `FsNode` tree, either from a parallel
//! directory walk (`services::scan_service`) or by reading the MFT
//! (`platform::current::try_mft_scan`).

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;

/// Options for `start_scan`.
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

/// The engine that produced a scan. The MFT reader needs admin rights;
/// without them every scan uses `Walk`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ScanEngine {
    Mft,
    Walk,
}

/// Final scan result. The engine is only known at the end, so it isn't
/// part of progress events.
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

/// A subtree the scan couldn't read; the scan continues without it.
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

/// Mirrors `FsNode` in `src/models/common.ts`. `category` and `children`
/// are omitted when empty (optional keys there, not `null`). The backend
/// never sets `category`; the frontend categorizes by extension.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsNode {
    /// The normalized path, which is unique.
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

/// Max direct children per folder sent to the frontend; the smallest
/// rest is folded into one "Other (N items)" node that keeps their
/// totals. Some folders are huge (WinSxS has ~22,700 entries). Only
/// applied to the copy sent over IPC; the cached tree stays complete.
pub const MAX_CHILDREN_PER_NODE: usize = 500;

/// Levels of `children` included in a payload (the root is level 0).
/// Deeper folders keep their totals but no children;
/// `commands::scan::get_subtree` loads them on demand.
pub const TRANSPORT_DEPTH: u32 = 2;

/// Copies `node`'s subtree for IPC, limited in depth and breadth. A full
/// C:\ tree is ~1.2M nodes (~380 MB of JSON), which the webview can't
/// handle; both limits are needed.
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
            // Largest first, so the smallest entries get folded.
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

/// The "Other (N items)" node for `folded`. Its id ends in `::other`
/// so the frontend knows it can't be expanded.
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

/// Finds the node with path `target_path` in `root`'s subtree.
pub fn find_node<'a>(root: &'a FsNode, target_path: &str) -> Option<&'a FsNode> {
    if root.path == target_path {
        return Some(root);
    }
    if root.kind != NodeKind::Folder {
        return None;
    }
    // Only descend into the child whose path is a prefix of the target:
    // O(depth) instead of O(tree size).
    for child in root.children.as_deref().unwrap_or(&[]) {
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

/// Live state of a running scan, shared by both engines and the
/// progress ticker. Updated from many threads at once.
pub struct ScanProgressState {
    pub cancel: AtomicBool,
    pub files: AtomicU64,
    pub folders: AtomicU64,
    pub bytes: AtomicU64,
    pub current_path: Mutex<String>,
    pub skipped: Mutex<Vec<ScanSkip>>,
}

/// Max skipped subtrees recorded per scan.
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

    /// Best effort: skipped if the lock is busy.
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
