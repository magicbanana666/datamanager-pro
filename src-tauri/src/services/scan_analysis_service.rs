//! Analysis tab data computed from the full cached tree. The frontend
//! only has a trimmed copy (see `models::scan::TRANSPORT_DEPTH`), so it
//! can't do this itself.
//!
//! Returns raw aggregates (per-extension totals, timeline buckets, top
//! files and folders); the frontend maps extensions to categories in
//! `finalizeAnalysis`.

use crate::models::scan::{FsNode, NodeKind};
use chrono::{DateTime, Utc};
use serde::Serialize;
use std::collections::HashMap;

const TOP_N: usize = 10;

/// Same thresholds/labels, in the same order, as `TIMELINE_BUCKETS` in
/// `src/utils/scanAnalysis.ts`.
const TIMELINE_BUCKETS: [(&str, f64); 6] = [
    ("Today", 1.0),
    ("This week", 7.0),
    ("This month", 30.0),
    ("Last 6 months", 182.0),
    ("This year", 365.0),
    ("Older", f64::INFINITY),
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionTotal {
    /// Lowercased, dot included (`".zip"`), or `""` for no extension.
    pub extension: String,
    pub files: u64,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TopFile {
    pub name: String,
    pub path: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TopFolder {
    pub path: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineBucket {
    pub label: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawScanAnalysis {
    /// Every extension seen, unsorted - the frontend sorts/folds it.
    pub extensions: Vec<ExtensionTotal>,
    pub top_files: Vec<TopFile>,
    pub top_folders: Vec<TopFolder>,
    pub timeline: Vec<TimelineBucket>,
}

/// Mirrors `extensionOf` in `scanAnalysis.ts`: a leading dot alone
/// (`.gitignore`) means no extension.
fn extension_of(name: &str) -> String {
    match name.rfind('.') {
        Some(idx) if idx > 0 => name[idx..].to_lowercase(),
        _ => String::new(),
    }
}

fn timeline_bucket(last_modified: Option<&str>, now: DateTime<Utc>) -> usize {
    let older = TIMELINE_BUCKETS.len() - 1;
    // Unknown/unparseable date - bucket conservatively rather than
    // guess "Today", same as the frontend.
    let Some(dt) = last_modified.and_then(|s| DateTime::parse_from_rfc3339(s).ok()) else {
        return older;
    };
    let days = (now - dt.with_timezone(&Utc)).num_seconds() as f64 / 86_400.0;
    TIMELINE_BUCKETS
        .iter()
        .position(|(_, max_days)| days <= *max_days)
        .unwrap_or(older)
}

/// Keeps the `TOP_N` largest of `items` without sorting the whole
/// (potentially ~1M-entry) list - a full sort per navigation is
/// avoidable work on a whole-drive scan.
fn top_n<T>(mut items: Vec<T>, size: impl Fn(&T) -> u64) -> Vec<T> {
    if items.len() > TOP_N {
        items.select_nth_unstable_by_key(TOP_N - 1, |t| std::cmp::Reverse(size(t)));
        items.truncate(TOP_N);
    }
    items.sort_unstable_by_key(|t| std::cmp::Reverse(size(t)));
    items
}

/// Single recursive pass over `node` (the scan root or any subfolder).
/// `node` itself is excluded from top folders, matching the frontend.
pub fn analyze(node: &FsNode) -> RawScanAnalysis {
    let now = Utc::now();
    let mut extensions: HashMap<String, (u64, u64)> = HashMap::new();
    let mut timeline = [0u64; TIMELINE_BUCKETS.len()];
    let mut files: Vec<TopFile> = Vec::new();
    let mut folders: Vec<TopFolder> = Vec::new();

    let mut stack: Vec<(&FsNode, bool)> = vec![(node, true)];
    while let Some((n, is_root)) = stack.pop() {
        match n.kind {
            NodeKind::File => {
                let entry = extensions.entry(extension_of(&n.name)).or_default();
                entry.0 += 1;
                entry.1 += n.size;
                timeline[timeline_bucket(n.last_modified.as_deref(), now)] += n.size;
                files.push(TopFile {
                    name: n.name.clone(),
                    path: n.path.clone(),
                    size: n.size,
                });
            }
            NodeKind::Folder => {
                if !is_root {
                    folders.push(TopFolder {
                        path: n.path.clone(),
                        size: n.size,
                    });
                }
                for child in n.children.as_deref().unwrap_or(&[]) {
                    stack.push((child, false));
                }
            }
        }
    }

    RawScanAnalysis {
        extensions: extensions
            .into_iter()
            .map(|(extension, (files, size))| ExtensionTotal {
                extension,
                files,
                size,
            })
            .collect(),
        top_files: top_n(files, |f| f.size),
        top_folders: top_n(folders, |f| f.size),
        timeline: TIMELINE_BUCKETS
            .iter()
            .zip(timeline)
            .map(|((label, _), size)| TimelineBucket {
                label: label.to_string(),
                size,
            })
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(path: &str, size: u64, last_modified: Option<&str>) -> FsNode {
        FsNode {
            id: path.into(),
            name: path.rsplit('\\').next().unwrap().into(),
            path: path.into(),
            kind: NodeKind::File,
            size,
            allocated: size,
            file_count: 0,
            folder_count: 0,
            percent_of_parent: 0.0,
            last_modified: last_modified.map(Into::into),
            category: None,
            children: None,
        }
    }

    fn folder(path: &str, children: Vec<FsNode>) -> FsNode {
        FsNode {
            id: path.into(),
            name: path.rsplit('\\').next().unwrap().into(),
            path: path.into(),
            kind: NodeKind::Folder,
            size: children.iter().map(|c| c.size).sum(),
            allocated: 0,
            file_count: 0,
            folder_count: 0,
            percent_of_parent: 0.0,
            last_modified: None,
            category: None,
            children: Some(children),
        }
    }

    #[test]
    fn aggregates_deep_files_and_excludes_root_folder() {
        let now = Utc::now().to_rfc3339();
        let tree = folder(
            r"C:\root",
            vec![
                file(r"C:\root\a.ZIP", 100, Some(&now)),
                folder(
                    r"C:\root\sub",
                    vec![folder(
                        r"C:\root\sub\deep",
                        vec![
                            file(r"C:\root\sub\deep\b.zip", 50, None),
                            file(r"C:\root\sub\deep\.gitignore", 5, None),
                        ],
                    )],
                ),
            ],
        );
        let a = analyze(&tree);

        let zip = a.extensions.iter().find(|e| e.extension == ".zip").unwrap();
        assert_eq!((zip.files, zip.size), (2, 150));
        assert!(a
            .extensions
            .iter()
            .any(|e| e.extension.is_empty() && e.size == 5));
        assert_eq!(a.top_files[0].size, 100);
        assert_eq!(a.top_files.len(), 3);
        assert!(a.top_folders.iter().all(|f| f.path != r"C:\root"));
        assert_eq!(a.top_folders.len(), 2);
        assert_eq!(a.timeline[0].size, 100); // Today
        assert_eq!(a.timeline[5].size, 55); // Older (unknown dates)
    }

    #[test]
    fn top_n_keeps_largest_sorted() {
        let items: Vec<u64> = (0..100).collect();
        let top = top_n(items, |v| *v);
        assert_eq!(top, (90..100).rev().collect::<Vec<_>>());
    }
}
