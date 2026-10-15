//! Content hashing shared by the Phase 5 jobs (duplicate finder and
//! folder comparison): xxh3-128 over a streamed read, reporting bytes to
//! the job's progress and stopping promptly on cancel. Not
//! cryptographic - it only has to tell apart two *different* files of
//! the same size, where an accidental 128-bit collision is not a
//! realistic risk.

use crate::models::hash_job::HashJobState;
use crate::platform;
use std::fs::File;
use std::io::Read;
use std::sync::atomic::Ordering;
use xxhash_rust::xxh3::Xxh3;

const READ_BUFFER: usize = 1024 * 1024;

/// Hashes `path` (only the first `limit` bytes, if given) and returns
/// the hash plus the file's physical identity (see
/// `platform::current::file_identity`), read from the same open handle.
pub fn hash_file(
    path: &str,
    limit: Option<u64>,
    state: &HashJobState,
) -> std::io::Result<(u128, Option<(u32, u64)>)> {
    let file = File::open(path)?;
    let identity = platform::current::file_identity(&file);
    let mut reader = file.take(limit.unwrap_or(u64::MAX));
    let mut hasher = Xxh3::new();
    let mut buf = vec![0u8; READ_BUFFER];
    loop {
        if state.is_cancelled() {
            return Err(std::io::Error::other("cancelled"));
        }
        let n = reader.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
        state.bytes_hashed.fetch_add(n as u64, Ordering::Relaxed);
    }
    Ok((hasher.digest128(), identity))
}
