//! The transaction journal that makes a transfer resumable after it was
//! cancelled, the app was closed, or it crashed.
//!
//! Per job, in the app's data directory (`journals\`):
//!
//! - `<job>.json` - written once when execution starts: the request and
//!   every item that does work (overrides already applied).
//! - `<job>.log` - append-only, one line per event, flushed per line:
//!   `D <id>` when an item is done, `P <id> <bytes>` when a large copy
//!   checkpoints (its `.dmp-part` file is synced to disk up to `bytes`).
//!
//! Appending a line is cheap at any job size, where rewriting one JSON
//! document per finished file would not be. A line lost to a crash only
//! means that item is redone, which every action tolerates (see
//! `transfer_service::already_done`). Both files are deleted when the
//! job completes.

use crate::models::transfer::{InterruptedTransfer, PlanItem, TransferRequest};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JournalHeader {
    pub job_id: String,
    pub request: TransferRequest,
    pub started_at: String,
    pub items: Vec<PlanItem>,
}

/// What a journal says about a job's progress so far.
#[derive(Default)]
pub struct JournalProgress {
    pub done: HashSet<u32>,
    /// Bytes of a partial copy that are safely on disk.
    pub partial: HashMap<u32, u64>,
}

pub struct Journal {
    dir: PathBuf,
    job_id: String,
    log: Mutex<File>,
}

fn header_path(dir: &Path, job_id: &str) -> PathBuf {
    dir.join(format!("{job_id}.json"))
}

fn log_path(dir: &Path, job_id: &str) -> PathBuf {
    dir.join(format!("{job_id}.log"))
}

/// Job ids come from the frontend and end up in file names.
pub fn is_valid_job_id(job_id: &str) -> bool {
    !job_id.is_empty()
        && job_id.len() <= 100
        && job_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

impl Journal {
    pub fn create(dir: &Path, header: &JournalHeader) -> std::io::Result<Self> {
        fs::create_dir_all(dir)?;
        let json = serde_json::to_vec(header).map_err(std::io::Error::other)?;
        // Written to a temp name and renamed, so a crash mid-write never
        // leaves a half header that `list` would choke on.
        let tmp = dir.join(format!("{}.json.tmp", header.job_id));
        fs::write(&tmp, json)?;
        fs::rename(&tmp, header_path(dir, &header.job_id))?;
        let log = File::create(log_path(dir, &header.job_id))?;
        Ok(Self {
            dir: dir.to_path_buf(),
            job_id: header.job_id.clone(),
            log: Mutex::new(log),
        })
    }

    /// Reopens an interrupted job's journal for resuming.
    pub fn open(dir: &Path, job_id: &str) -> std::io::Result<(Self, JournalHeader, JournalProgress)> {
        let header = read_header(dir, job_id)?;
        let progress = read_progress(dir, job_id);
        let log = OpenOptions::new()
            .create(true)
            .append(true)
            .open(log_path(dir, job_id))?;
        Ok((
            Self {
                dir: dir.to_path_buf(),
                job_id: job_id.to_string(),
                log: Mutex::new(log),
            },
            header,
            progress,
        ))
    }

    fn append(&self, line: &str) {
        let mut log = self.log.lock().unwrap();
        // Best effort: a failed journal write costs resumability, never
        // the transfer itself.
        if let Err(e) = writeln!(log, "{line}").and_then(|_| log.flush()) {
            tracing::warn!(error = %e, job_id = %self.job_id, "journal write failed");
        }
    }

    pub fn mark_done(&self, id: u32) {
        self.append(&format!("D {id}"));
    }

    pub fn checkpoint(&self, id: u32, bytes: u64) {
        self.append(&format!("P {id} {bytes}"));
    }

    /// The job completed: the journal is no longer needed.
    pub fn finish(self) {
        drop(self.log);
        discard(&self.dir, &self.job_id);
    }
}

fn read_header(dir: &Path, job_id: &str) -> std::io::Result<JournalHeader> {
    let bytes = fs::read(header_path(dir, job_id))?;
    serde_json::from_slice(&bytes).map_err(std::io::Error::other)
}

fn read_progress(dir: &Path, job_id: &str) -> JournalProgress {
    let mut progress = JournalProgress::default();
    let Ok(file) = File::open(log_path(dir, job_id)) else {
        return progress;
    };
    for line in BufReader::new(file).lines().map_while(Result::ok) {
        let mut parts = line.split_ascii_whitespace();
        match (parts.next(), parts.next().and_then(|id| id.parse::<u32>().ok())) {
            (Some("D"), Some(id)) => {
                progress.done.insert(id);
                progress.partial.remove(&id);
            }
            (Some("P"), Some(id)) => {
                if let Some(bytes) = parts.next().and_then(|b| b.parse::<u64>().ok()) {
                    progress.partial.insert(id, bytes);
                }
            }
            // A torn last line from a crash - ignore it.
            _ => {}
        }
    }
    progress
}

pub fn discard(dir: &Path, job_id: &str) {
    let _ = fs::remove_file(header_path(dir, job_id));
    let _ = fs::remove_file(log_path(dir, job_id));
}

/// Every unfinished job in `dir`, newest first.
pub fn list(dir: &Path) -> Vec<InterruptedTransfer> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut jobs: Vec<InterruptedTransfer> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            let job_id = name.strip_suffix(".json")?;
            let header = read_header(dir, job_id).ok()?;
            let progress = read_progress(dir, job_id);
            let files: Vec<&PlanItem> = header.items.iter().filter(|i| !i.is_folder).collect();
            let done: Vec<&&PlanItem> = files.iter().filter(|i| progress.done.contains(&i.id)).collect();
            Some(InterruptedTransfer {
                job_id: header.job_id.clone(),
                source: header.request.source.clone(),
                destination: header.request.destination.clone(),
                mode: header.request.mode,
                started_at: header.started_at.clone(),
                files_total: files.len() as u64,
                files_done: done.len() as u64,
                bytes_total: files.iter().filter(|i| i.action.copies()).map(|i| i.size).sum(),
                bytes_done: done.iter().filter(|i| i.action.copies()).map(|i| i.size).sum::<u64>()
                    + progress.partial.values().sum::<u64>(),
            })
        })
        .collect();
    jobs.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    jobs
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::transfer::{
        CollisionPolicy, PlanAction, TransferMode, TransferOptions,
    };

    fn header(job_id: &str) -> JournalHeader {
        let options: TransferOptions = serde_json::from_str("{}").unwrap();
        JournalHeader {
            job_id: job_id.to_string(),
            request: TransferRequest {
                source: "C:\\a".into(),
                destination: "D:\\b".into(),
                mode: TransferMode::Copy,
                collision: CollisionPolicy::SkipSame,
                options,
                files: None,
            },
            started_at: "2026-10-15T10:00:00Z".into(),
            items: (0..3)
                .map(|id| PlanItem {
                    id,
                    relative_path: format!("f{id}.bin"),
                    is_folder: false,
                    action: PlanAction::CopyNew,
                    size: 100,
                    source_modified: None,
                    dest_modified: None,
                    source_path: format!("C:\\a\\f{id}.bin"),
                    dest_path: format!("D:\\b\\f{id}.bin"),
                })
                .collect(),
        }
    }

    #[test]
    fn records_progress_and_survives_a_torn_line() {
        let dir = tempfile::tempdir().unwrap();
        let journal = Journal::create(dir.path(), &header("job-1")).unwrap();
        journal.mark_done(0);
        journal.checkpoint(1, 40);
        drop(journal);
        // A crash mid-line.
        let mut log = OpenOptions::new().append(true).open(log_path(dir.path(), "job-1")).unwrap();
        write!(log, "D 2").unwrap();
        write!(log, "\nP").unwrap();
        drop(log);

        let (_, header, progress) = Journal::open(dir.path(), "job-1").unwrap();
        assert_eq!(header.items.len(), 3);
        assert!(progress.done.contains(&0) && progress.done.contains(&2));
        assert_eq!(progress.partial.get(&1), Some(&40));

        let listed = list(dir.path());
        assert_eq!(listed.len(), 1);
        assert_eq!((listed[0].files_done, listed[0].files_total), (2, 3));
        assert_eq!(listed[0].bytes_done, 240);
    }

    #[test]
    fn finish_removes_the_journal() {
        let dir = tempfile::tempdir().unwrap();
        let journal = Journal::create(dir.path(), &header("job-2")).unwrap();
        journal.finish();
        assert!(list(dir.path()).is_empty());
    }

    #[test]
    fn rejects_job_ids_that_are_not_plain_names() {
        assert!(is_valid_job_id("xfer-0f3a_1"));
        assert!(!is_valid_job_id("..\\evil"));
        assert!(!is_valid_job_id(""));
    }
}
