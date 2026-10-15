//! Phase 8 network-share queries behind Network Analysis: connection
//! details for a UNC path, a server's shares, a path's access rights,
//! a server's sessions, and a real read-speed measurement. Read-only.
//! (Scanning a share's contents is the regular scan engine - UNC paths
//! always use the walk engine.)

use crate::models::errors::{AppError, AppErrorCode};
use crate::models::network::{
    AccessRightEntry, NetworkSession, NetworkShare, ReadSpeedResult, ShareConnection,
    ThroughputSample,
};
use std::io::Read;
use std::path::Path;
use std::time::{Duration, Instant};

/// `\\server\share\rest` → (server, share).
pub fn parse_unc(path: &str) -> Option<(String, String)> {
    let rest = path.strip_prefix("\\\\").or_else(|| path.strip_prefix("//"))?;
    let mut parts = rest.split(['\\', '/']).filter(|p| !p.is_empty());
    let server = parts.next()?.to_string();
    let share = parts.next().unwrap_or("").to_string();
    Some((server, share))
}

/// A server name as typed: `\\nas`, `nas`, `\\nas\share` → `nas`.
pub fn server_name(input: &str) -> Option<String> {
    let trimmed = input.trim();
    let server = parse_unc(trimmed)
        .map(|(s, _)| s)
        .unwrap_or_else(|| trimmed.trim_matches(['\\', '/']).to_string());
    let valid = !server.is_empty()
        && server.len() <= 255
        && server.chars().all(|c| c.is_ascii_alphanumeric() || "-._:".contains(c));
    valid.then_some(server)
}

pub fn current_user() -> String {
    let user = std::env::var("USERNAME").unwrap_or_default();
    match std::env::var("USERDOMAIN") {
        Ok(domain) if !domain.is_empty() => format!("{domain}\\{user}"),
        _ => user,
    }
}

pub async fn connection(path: &str) -> Result<ShareConnection, AppError> {
    let (server, share) = parse_unc(path)
        .ok_or_else(|| AppError::invalid_path(path.to_string(), "Enter a network path like \\\\server\\share."))?;
    let started = Instant::now();
    let latency_ms = match tokio::time::timeout(
        Duration::from_secs(2),
        tokio::net::TcpStream::connect((server.as_str(), 445)),
    )
    .await
    {
        Ok(Ok(_)) => Some(started.elapsed().as_millis() as u32),
        _ => None,
    };
    let reachable_path = path.to_string();
    let reachable = tokio::task::spawn_blocking(move || Path::new(&reachable_path).is_dir())
        .await
        .unwrap_or(false);
    let protocol = smb_dialect(&server).await;
    Ok(ShareConnection {
        server,
        share,
        user: current_user(),
        reachable,
        latency_ms,
        protocol,
    })
}

/// The SMB dialect of the connection to `server`, via PowerShell's
/// `Get-SmbConnection` (best effort - `None` if it's unavailable).
async fn smb_dialect(server: &str) -> Option<String> {
    let script = format!(
        "(Get-SmbConnection -ServerName '{}' -ErrorAction SilentlyContinue | Select-Object -First 1).Dialect",
        server.replace('\'', "")
    );
    let mut command = tokio::process::Command::new("powershell.exe");
    command.args(["-NoProfile", "-NonInteractive", "-Command", &script]);
    #[cfg(windows)]
    command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    let output = tokio::time::timeout(Duration::from_secs(6), command.output()).await.ok()?.ok()?;
    let dialect = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!dialect.is_empty()).then(|| format!("SMB {dialect}"))
}

fn net_error(code: u32, server: &str) -> AppError {
    match code {
        5 => AppError::new(AppErrorCode::AccessDenied, format!("Access denied by {server}.")),
        53 | 1231 | 1219 => AppError::new(
            AppErrorCode::NetworkUnavailable,
            format!("{server} could not be reached."),
        ),
        _ => AppError::new(AppErrorCode::NetworkUnavailable, format!("{server}: network error {code}.")),
    }
}

#[cfg(windows)]
pub fn shares(server: &str) -> Result<Vec<NetworkShare>, AppError> {
    use crate::platform::current::network;
    let raw = network::list_shares(server).map_err(|code| net_error(code, server))?;
    let mut shares: Vec<NetworkShare> = raw
        .into_iter()
        .map(|s| {
            let base = s.kind & 0xFF;
            let kind = match base {
                0 => "disk",
                1 => "printer",
                2 => "device",
                3 => "ipc",
                _ => "other",
            };
            let path = format!("\\\\{server}\\{}", s.name);
            let info = (base == 0).then(|| network::volume_info(&format!("{path}\\"))).flatten();
            NetworkShare {
                special: s.kind & 0x8000_0000 != 0 || s.name.ends_with('$'),
                status: match (base, &info) {
                    (0, Some(_)) => "online",
                    (0, None) => "no-access",
                    _ => "n/a",
                }
                .to_string(),
                total_bytes: info.as_ref().map(|i| i.1),
                free_bytes: info.as_ref().map(|i| i.2),
                file_system: info.and_then(|i| i.0),
                name: s.name,
                path,
                kind: kind.to_string(),
                remark: s.remark,
            }
        })
        .collect();
    shares.sort_by(|a, b| a.special.cmp(&b.special).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(shares)
}

#[cfg(windows)]
pub fn sessions(server: &str) -> Result<Vec<NetworkSession>, AppError> {
    use crate::platform::current::network;
    let raw = network::list_sessions(server).map_err(|code| {
        if code == 5 {
            AppError::new(
                AppErrorCode::AccessDenied,
                format!("Listing sessions needs administrator rights on {server}."),
            )
        } else {
            net_error(code, server)
        }
    })?;
    Ok(raw
        .into_iter()
        .map(|s| NetworkSession {
            user: s.user,
            host: s.client,
            connected_seconds: s.connected_secs,
            idle_seconds: s.idle_secs,
        })
        .collect())
}

// Standard rights (`FILE_*` combinations Explorer shows by name).
const FULL_CONTROL: u32 = 0x001F_01FF;
const MODIFY: u32 = 0x0013_01BF;
const READ_EXECUTE: u32 = 0x0012_00A9;
const READ: u32 = 0x0012_0089;
const WRITE: u32 = 0x0010_0116;
const GENERIC_ALL: u32 = 0x1000_0000;
const GENERIC_EXECUTE: u32 = 0x2000_0000;
const GENERIC_WRITE: u32 = 0x4000_0000;
const GENERIC_READ: u32 = 0x8000_0000;

/// An access mask the way Explorer's Security tab names it.
pub fn describe_mask(mask: u32) -> String {
    let has = |bits: u32| mask & bits == bits;
    if has(FULL_CONTROL) || has(GENERIC_ALL) {
        return "Full Control".into();
    }
    if has(MODIFY) {
        return "Modify".into();
    }
    let mut parts = Vec::new();
    if has(READ_EXECUTE) || has(GENERIC_READ | GENERIC_EXECUTE) {
        parts.push("Read & Execute");
    } else if has(READ) || has(GENERIC_READ) {
        parts.push("Read");
    }
    if has(WRITE) || has(GENERIC_WRITE) {
        parts.push("Write");
    }
    if parts.is_empty() {
        format!("Special (0x{mask:08X})")
    } else {
        parts.join(", ")
    }
}

#[cfg(windows)]
pub fn access_rights(path: &str) -> Result<Vec<AccessRightEntry>, AppError> {
    let entries = crate::platform::current::network::read_dacl(Path::new(path))
        .map_err(|e| AppError::new(AppErrorCode::AccessDenied, e).with_path(path.to_string()))?;
    Ok(entries
        .into_iter()
        .map(|e| AccessRightEntry {
            kind: match e.account_kind {
                1 => "User",
                9 => "Computer",
                0 => "SID",
                _ => "Group",
            }
            .into(),
            name: e.account,
            permissions: describe_mask(e.mask),
            allow: e.allow,
            inherited: e.inherited,
        })
        .collect())
}

#[cfg(not(windows))]
pub fn shares(_server: &str) -> Result<Vec<NetworkShare>, AppError> {
    Err(AppError::unsupported("Network shares are only implemented for Windows."))
}

#[cfg(not(windows))]
pub fn sessions(_server: &str) -> Result<Vec<NetworkSession>, AppError> {
    Err(AppError::unsupported("Network sessions are only implemented for Windows."))
}

#[cfg(not(windows))]
pub fn access_rights(_path: &str) -> Result<Vec<AccessRightEntry>, AppError> {
    Err(AppError::unsupported("Access rights are only implemented for Windows."))
}

const SPEED_TEST_BYTES: u64 = 512 * 1024 * 1024;
const SPEED_TEST_TIME: Duration = Duration::from_secs(8);
const SPEED_SAMPLE: Duration = Duration::from_millis(250);

/// Reads `path` (up to 512 MB or 8 s) and reports the throughput. The
/// file is opened unbuffered on Windows, so a file read recently
/// doesn't come out of the cache at memory speed.
pub fn read_speed(path: &str) -> Result<ReadSpeedResult, AppError> {
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        // FILE_FLAG_NO_BUFFERING | FILE_FLAG_SEQUENTIAL_SCAN
        options.custom_flags(0x2000_0000 | 0x0800_0000);
    }
    let mut file = options
        .open(path)
        .map_err(|e| AppError::new(AppErrorCode::IoError, format!("Could not open the file: {e}")).with_path(path.to_string()))?;

    // Unbuffered reads need a sector-aligned buffer.
    const CHUNK: usize = 4 * 1024 * 1024;
    let layout = std::alloc::Layout::from_size_align(CHUNK, 4096).expect("valid layout");
    let raw = unsafe { std::alloc::alloc(layout) };
    if raw.is_null() {
        return Err(AppError::new(AppErrorCode::Unknown, "Out of memory."));
    }
    let buf = unsafe { std::slice::from_raw_parts_mut(raw, CHUNK) };

    let started = Instant::now();
    let mut last = started;
    let mut last_bytes = 0u64;
    let mut total = 0u64;
    let mut samples = Vec::new();
    let result = loop {
        if total >= SPEED_TEST_BYTES || started.elapsed() >= SPEED_TEST_TIME {
            break Ok(());
        }
        match file.read(buf) {
            Ok(0) => break Ok(()),
            Ok(n) => total += n as u64,
            Err(e) => break Err(e),
        }
        let now = Instant::now();
        if now.duration_since(last) >= SPEED_SAMPLE {
            let secs = now.duration_since(last).as_secs_f64();
            samples.push(ThroughputSample {
                t_ms: now.duration_since(started).as_millis() as u64,
                mbps: ((total - last_bytes) as f64 * 8.0 / 1_000_000.0) / secs,
            });
            last = now;
            last_bytes = total;
        }
    };
    unsafe { std::alloc::dealloc(raw, layout) };
    result.map_err(|e| AppError::new(AppErrorCode::IoError, format!("Reading failed: {e}")).with_path(path.to_string()))?;

    let elapsed = started.elapsed();
    Ok(ReadSpeedResult {
        path: path.to_string(),
        bytes_read: total,
        elapsed_ms: elapsed.as_millis() as u64,
        average_mbps: if elapsed.as_secs_f64() > 0.0 {
            total as f64 * 8.0 / 1_000_000.0 / elapsed.as_secs_f64()
        } else {
            0.0
        },
        samples,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_unc_paths_and_server_names() {
        assert_eq!(parse_unc("\\\\nas\\data\\x"), Some(("nas".into(), "data".into())));
        assert_eq!(parse_unc("//nas/data"), Some(("nas".into(), "data".into())));
        assert_eq!(parse_unc("C:\\x"), None);
        assert_eq!(server_name("\\\\NAS01\\share").as_deref(), Some("NAS01"));
        assert_eq!(server_name("192.168.1.5").as_deref(), Some("192.168.1.5"));
        assert_eq!(server_name("bad name"), None);
    }

    #[test]
    fn describes_access_masks_like_explorer() {
        assert_eq!(describe_mask(0x001F_01FF), "Full Control");
        assert_eq!(describe_mask(0x0013_01BF), "Modify");
        assert_eq!(describe_mask(0x0012_00A9), "Read & Execute");
        assert_eq!(describe_mask(0x0012_0089 | 0x0010_0116), "Read, Write");
        assert_eq!(describe_mask(GENERIC_ALL), "Full Control");
        assert_eq!(describe_mask(0x0000_0001), "Special (0x00000001)");
    }

    #[test]
    fn measures_read_speed_of_a_local_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("f.bin");
        std::fs::write(&path, vec![7u8; 9 * 1024 * 1024]).unwrap();
        let r = read_speed(&path.to_string_lossy()).unwrap();
        assert_eq!(r.bytes_read, 9 * 1024 * 1024);
    }

    #[cfg(windows)]
    #[test]
    fn reads_the_access_rights_of_the_temp_folder() {
        let dir = tempfile::tempdir().unwrap();
        let rights = access_rights(&dir.path().to_string_lossy()).unwrap();
        assert!(!rights.is_empty());
        assert!(rights.iter().all(|r| !r.name.is_empty()));
    }
}
