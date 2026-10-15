//! Copy benchmark: DataManager Pro's engine against Explorer's copy
//! engine and robocopy, on cold data. Not part of the normal test run:
//!
//! ```text
//! cargo test --profile quick --lib -- --ignored copy_bench --nocapture
//! ```
//! (`scripts/bench-copy.ps1` wraps it). Set `DMP_BENCH_DIR` to benchmark
//! another disk (default: %TEMP%\dmp-bench).
//!
//! Fairness: before every run the source is rewritten with unbuffered
//! writes, so no tool reads it from the Windows cache. Two times are
//! reported: when the tool returns, and when the copy is on disk - the
//! buffered tools return while data still sits in RAM, so each run ends
//! with every destination file flushed (`FlushFileBuffers`).

#![cfg(all(test, windows))]

use crate::models::transfer::{CollisionPolicy, TransferMode, TransferRequest, TransferState};
use crate::services::transfer_journal::{Journal, JournalHeader, JournalProgress};
use crate::services::transfer_service::{analyze, execute};
use std::fs::{self, File};
use std::io::Write;
use std::os::windows::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Instant;

const LARGE_FILES: usize = 4;
const LARGE_SIZE: usize = 1024 * 1024 * 1024;
const SMALL_FILES: usize = 2000;
const ALIGN: usize = 4096;
const BLOCK: usize = 8 * 1024 * 1024;

/// Copies (source, destination, files, bytes).
type Tool<'a> = &'a dyn Fn(&Path, &Path, usize, u64);

/// A sector-aligned buffer of pseudo-random bytes.
struct Aligned(Vec<u8>, usize);
impl Aligned {
    fn new(len: usize, seed: u64) -> Self {
        let mut v = vec![0u8; len + ALIGN];
        let off = (ALIGN - (v.as_ptr() as usize % ALIGN)) % ALIGN;
        let mut x = seed | 1;
        for chunk in v[off..off + len].chunks_mut(8) {
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            chunk.copy_from_slice(&x.to_le_bytes()[..chunk.len()]);
        }
        Self(v, off)
    }
    fn slice(&self, len: usize) -> &[u8] {
        &self.0[self.1..self.1 + len]
    }
}

/// Writes `len` bytes without going through the file cache.
fn write_uncached(path: &Path, len: usize, block: &Aligned) {
    const NO_BUFFERING: u32 = 0x2000_0000;
    let mut f = fs::OpenOptions::new().write(true).create(true).truncate(true).custom_flags(NO_BUFFERING).open(path).unwrap();
    let mut left = len;
    while left > 0 {
        let n = left.min(BLOCK);
        f.write_all(block.slice(n.div_ceil(ALIGN) * ALIGN)).unwrap();
        left -= n;
    }
    drop(f);
    // The padding past the end goes.
    File::options().write(true).open(path).unwrap().set_len(len as u64).unwrap();
}

fn small_size(i: usize) -> usize {
    16 * 1024 + (i * 7919 % 497) * 1024 // 16-512 KB
}

fn make_source(dir: &Path, block: &Aligned) -> u64 {
    let _ = fs::remove_dir_all(dir);
    fs::create_dir_all(dir.join("small")).unwrap();
    let only = std::env::var("DMP_BENCH_ONLY").unwrap_or_default();
    let mut total = 0u64;
    for i in 0..if only == "small" { 0 } else { LARGE_FILES } {
        write_uncached(&dir.join(format!("large-{i}.bin")), LARGE_SIZE, block);
        total += LARGE_SIZE as u64;
    }
    for i in 0..if only == "large" { 0 } else { SMALL_FILES } {
        let size = small_size(i);
        write_uncached(&dir.join("small").join(format!("file-{i:04}.dat")), size, block);
        total += size as u64;
    }
    total
}

fn files_under(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        for e in fs::read_dir(&d).into_iter().flatten().flatten() {
            let p = e.path();
            if p.is_dir() {
                stack.push(p);
            } else {
                out.push(p);
            }
        }
    }
    out
}

/// Flushes every file under `dir` to disk; returns the bytes there.
fn flush_all(dir: &Path) -> u64 {
    files_under(dir)
        .iter()
        .map(|p| {
            let f = File::options().write(true).open(p).unwrap();
            f.sync_all().unwrap();
            f.metadata().unwrap().len()
        })
        .sum()
}

fn ours(src: &Path, dst: &Path, direct: bool) {
    let request = TransferRequest {
        source: src.to_string_lossy().into_owned(),
        destination: dst.to_string_lossy().into_owned(),
        mode: TransferMode::Copy,
        collision: CollisionPolicy::SkipSame,
        options: serde_json::from_str("{}").unwrap(),
        files: None,
    };
    let state = TransferState::new();
    let t = Instant::now();
    let work: Vec<_> = analyze(&request, None, &state).items.into_iter().filter(|i| i.action.is_work()).collect();
    let analyzed = t.elapsed().as_secs_f64();
    let dir = tempfile::tempdir().unwrap();
    let journal = Journal::create(
        dir.path(),
        &JournalHeader { job_id: "bench".into(), request: request.clone(), started_at: String::new(), items: work.clone() },
    )
    .unwrap();
    super::transfer_service::FORCE_BUFFERED.store(!direct, std::sync::atomic::Ordering::Relaxed);
    let t = Instant::now();
    let outcome = execute(&request, &work, &journal, &JournalProgress::default(), &state);
    if std::env::var_os("DMP_BENCH_VERBOSE").is_some() {
        println!("    (analyze {analyzed:.2} s, execute {:.2} s)", t.elapsed().as_secs_f64());
    }
    super::transfer_service::FORCE_BUFFERED.store(false, std::sync::atomic::Ordering::Relaxed);
    assert_eq!(outcome.error_count, 0, "{:?}", outcome.errors);
}

fn robocopy(src: &Path, dst: &Path, unbuffered: bool) {
    let mut cmd = Command::new("robocopy");
    cmd.arg(src).arg(dst).args(["/E", "/MT:8", "/R:0", "/W:0", "/NFL", "/NDL", "/NJH", "/NJS", "/NP"]);
    if unbuffered {
        cmd.arg("/J");
    }
    let status = cmd.status().unwrap();
    assert!(status.code().unwrap_or(16) < 8, "robocopy failed: {status}");
}

/// Explorer's copy engine (the shell's CopyHere), waiting until every
/// file has arrived at full size.
fn explorer(src: &Path, dst: &Path, files: usize, bytes: u64) {
    fs::create_dir_all(dst).unwrap();
    let script = format!(
        "$s = New-Object -ComObject Shell.Application; $d = $s.NameSpace('{dst}'); \
         $d.CopyHere($s.NameSpace('{src}').Items(), 4 + 16 + 512 + 1024); \
         do {{ Start-Sleep -Milliseconds 200; $items = Get-ChildItem -LiteralPath '{dst}' -Recurse -File -ErrorAction SilentlyContinue; \
         $sum = ($items | Measure-Object Length -Sum).Sum }} until ($items.Count -ge {files} -and $sum -ge {bytes})",
        src = src.display(),
        dst = dst.display(),
    );
    let status = Command::new("powershell.exe").args(["-NoProfile", "-STA", "-Command", &script]).status().unwrap();
    assert!(status.success());
}

/// Baseline: Windows' own CopyFileExW (std::fs::copy) on 8 threads.
fn copyfile_baseline(src: &Path, dst: &Path) {
    use rayon::prelude::*;
    let files = files_under(src);
    let pool = rayon::ThreadPoolBuilder::new().num_threads(8).build().unwrap();
    pool.install(|| {
        files.par_iter().for_each(|f| {
            let target = dst.join(f.strip_prefix(src).unwrap());
            fs::create_dir_all(target.parent().unwrap()).unwrap();
            fs::copy(f, &target).unwrap();
        })
    });
}

#[test]
#[ignore = "benchmark: writes ~45 GB, run explicitly"]
fn copy_bench() {
    let root = std::env::var_os("DMP_BENCH_DIR").map(PathBuf::from).unwrap_or_else(|| std::env::temp_dir().join("dmp-bench"));
    let src = root.join("source");
    let block = Aligned::new(BLOCK, 0x9E37_79B9);
    let filter = std::env::var("DMP_BENCH_TOOLS").unwrap_or_default();
    let tools: [(&str, Tool); 6] = [
        ("CopyFileExW x8 (baseline)", &|s, d, _, _| copyfile_baseline(s, d)),
        ("Explorer (shell copy engine)", &|s, d, f, b| explorer(s, d, f, b)),
        ("robocopy /MT:8", &|s, d, _, _| robocopy(s, d, false)),
        ("robocopy /J /MT:8 (unbuffered)", &|s, d, _, _| robocopy(s, d, true)),
        ("DataManager Pro - buffered (old)", &|s, d, _, _| ours(s, d, false)),
        ("DataManager Pro - direct I/O (new)", &|s, d, _, _| ours(s, d, true)),
    ];
    println!("\nData: {LARGE_FILES} x {} MB + {SMALL_FILES} small files (16-512 KB), cold (uncached) source, on {}", LARGE_SIZE >> 20, root.display());
    println!("{:<36} {:>10} {:>10} {:>10} {:>10}", "", "returned", "on disk", "MB/s", "MB/s");
    println!("{:<36} {:>10} {:>10} {:>10} {:>10}", "", "(s)", "(s)", "(ret.)", "(disk)");
    for (name, tool) in tools.into_iter().filter(|(n, _)| filter.is_empty() || filter.split(',').any(|f| n.contains(f))) {
        let total = make_source(&src, &block);
        let files = files_under(&src).len();
        let dst = root.join("dest");
        let _ = fs::remove_dir_all(&dst);
        let started = Instant::now();
        tool(&src, &dst, files, total);
        let returned = started.elapsed().as_secs_f64();
        let bytes = flush_all(&dst);
        let on_disk = started.elapsed().as_secs_f64();
        assert_eq!(bytes, total, "{name} copied {bytes} of {total} bytes");
        let mb = total as f64 / (1024.0 * 1024.0);
        println!("{name:<36} {returned:>10.1} {on_disk:>10.1} {:>10.0} {:>10.0}", mb / returned, mb / on_disk);
        let _ = fs::remove_dir_all(&dst);
    }
    let _ = fs::remove_dir_all(&root);
}
