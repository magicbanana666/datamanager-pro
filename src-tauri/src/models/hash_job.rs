//! State and progress for jobs that list files and then hash some of
//! them: the duplicate finder and the folder comparison.

use crate::models::scan::ScanProgressState;
use serde::Serialize;
use std::sync::atomic::{AtomicU64, AtomicU8, Ordering};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum HashJobPhase {
    /// Listing files (the regular scan engines).
    Collecting,
    /// A cheap first hashing pass (the duplicate finder hashes the
    /// first 64 KiB of every same-size candidate).
    Comparing,
    /// Hashing full file contents.
    Hashing,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HashJobProgress {
    pub scan_id: String,
    pub phase: HashJobPhase,
    pub files_found: u64,
    pub bytes_to_hash: u64,
    pub bytes_hashed: u64,
    pub current_path: String,
    pub elapsed_ms: u64,
}

/// State of one job. `scan` holds the listing phase's counters, cancel
/// flag and skips, so the scan engines can be reused as is.
pub struct HashJobState {
    pub scan: ScanProgressState,
    phase: AtomicU8,
    pub bytes_to_hash: AtomicU64,
    pub bytes_hashed: AtomicU64,
}

impl HashJobState {
    pub fn new() -> Self {
        Self {
            scan: ScanProgressState::new(),
            phase: AtomicU8::new(0),
            bytes_to_hash: AtomicU64::new(0),
            bytes_hashed: AtomicU64::new(0),
        }
    }

    pub fn is_cancelled(&self) -> bool {
        self.scan.is_cancelled()
    }

    pub fn phase(&self) -> HashJobPhase {
        match self.phase.load(Ordering::Relaxed) {
            0 => HashJobPhase::Collecting,
            1 => HashJobPhase::Comparing,
            _ => HashJobPhase::Hashing,
        }
    }

    /// Starts a phase and resets the byte counters for its progress bar.
    pub fn begin_phase(&self, phase: HashJobPhase, bytes_to_hash: u64) {
        self.bytes_hashed.store(0, Ordering::Relaxed);
        self.bytes_to_hash.store(bytes_to_hash, Ordering::Relaxed);
        self.phase.store(phase as u8, Ordering::Relaxed);
    }
}

impl Default for HashJobState {
    fn default() -> Self {
        Self::new()
    }
}
