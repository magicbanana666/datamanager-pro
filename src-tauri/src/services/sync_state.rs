//! The change tracker behind two-way sync: after every successful run,
//! what each file looked like on both sides (size + modified time),
//! saved per source/destination pair in the app's data directory
//! (`sync-state\<hash>.json`).
//!
//! The next run compares each side against it: a file that differs from
//! its recorded state was *changed* on that side; a recorded file that's
//! missing was *deleted* there. Without it, a file that exists on only
//! one side could be either new there or deleted on the other - which is
//! why a first two-way run never deletes anything.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncedPair {
    pub src_size: u64,
    pub src_mtime: i64,
    pub dst_size: u64,
    pub dst_mtime: i64,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncState {
    pub source: String,
    pub destination: String,
    pub saved_at: String,
    /// Keyed by lowercased relative path.
    pub files: HashMap<String, SyncedPair>,
}

fn state_path(dir: &Path, source: &str, destination: &str) -> PathBuf {
    let key = format!("{}|{}", source.to_lowercase(), destination.to_lowercase());
    let hash = xxhash_rust::xxh3::xxh3_64(key.as_bytes());
    dir.join(format!("{hash:016x}.json"))
}

pub fn load(dir: &Path, source: &str, destination: &str) -> Option<SyncState> {
    let bytes = fs::read(state_path(dir, source, destination)).ok()?;
    serde_json::from_slice(&bytes).ok()
}

pub fn save(dir: &Path, state: &SyncState) -> std::io::Result<()> {
    fs::create_dir_all(dir)?;
    let path = state_path(dir, &state.source, &state.destination);
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_vec(state).map_err(std::io::Error::other)?)?;
    fs::rename(tmp, path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_per_location_pair_case_insensitively() {
        let dir = tempfile::tempdir().unwrap();
        let mut state = SyncState {
            source: "C:\\Data".into(),
            destination: "E:\\Backup".into(),
            ..Default::default()
        };
        state.files.insert(
            "a.txt".into(),
            SyncedPair { src_size: 1, src_mtime: 2, dst_size: 1, dst_mtime: 2 },
        );
        save(dir.path(), &state).unwrap();
        let loaded = load(dir.path(), "c:\\data", "e:\\BACKUP").unwrap();
        assert_eq!(loaded.files.get("a.txt"), state.files.get("a.txt"));
        assert!(load(dir.path(), "C:\\Data", "F:\\Other").is_none());
    }
}
