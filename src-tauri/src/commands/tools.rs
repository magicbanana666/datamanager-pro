//! Tauri commands behind the Tools page: launching Windows' own tools,
//! file utilities (`services::tools_service`), and a few small network
//! and system helpers (ping, DNS lookup, Wake-on-LAN, disk health, the
//! latest log). Every command acts on a path or host the user entered.

use super::blocking;
use crate::models::errors::{AppError, AppErrorCode};
use crate::services::tools_service::{self, Digests};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;

#[cfg(windows)]
fn no_window(command: &mut Command) -> &mut Command {
    use std::os::windows::process::CommandExt;
    command.creation_flags(0x0800_0000) // CREATE_NO_WINDOW
}

#[cfg(not(windows))]
fn no_window(command: &mut Command) -> &mut Command {
    command
}

fn io(e: impl std::fmt::Display) -> AppError {
    AppError::new(AppErrorCode::IoError, e.to_string())
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SystemTool {
    CommandPrompt,
    PowerShell,
    TaskManager,
    Services,
    EventViewer,
    DiskCleanup,
    FileHistory,
}

/// Opens one of Windows' own tools (in its own window).
#[tauri::command]
pub fn launch_system_tool(tool: SystemTool, working_dir: Option<String>) -> Result<(), AppError> {
    // `start` gives console programs their own window and resolves
    // .msc snap-ins; the cmd running it stays hidden.
    let target: &[&str] = match tool {
        SystemTool::CommandPrompt => &["cmd.exe"],
        SystemTool::PowerShell => &["powershell.exe"],
        SystemTool::TaskManager => &["taskmgr.exe"],
        SystemTool::Services => &["services.msc"],
        SystemTool::EventViewer => &["eventvwr.msc"],
        SystemTool::DiskCleanup => &["cleanmgr.exe"],
        SystemTool::FileHistory => &["control.exe", "/name", "Microsoft.FileHistory"],
    };
    let mut command = Command::new("cmd.exe");
    command.args(["/c", "start", ""]).args(target);
    if let Some(dir) = working_dir.filter(|d| Path::new(d).is_dir()) {
        command.current_dir(dir);
    }
    no_window(&mut command).spawn().map(|_| ()).map_err(io)
}

#[tauri::command]
pub async fn file_digests(path: String) -> Result<Digests, AppError> {
    blocking(move || tools_service::digests(Path::new(&path)).map_err(io)).await
}

#[tauri::command]
pub async fn split_file(path: String, part_size: u64, dest_dir: String) -> Result<Vec<String>, AppError> {
    blocking(move || {
        tools_service::split(Path::new(&path), part_size, Path::new(&dest_dir))
            .map(|parts| parts.iter().map(|p| p.to_string_lossy().into_owned()).collect())
            .map_err(io)
    })
    .await
}

#[tauri::command]
pub async fn merge_file_parts(first_part: String, dest_dir: String) -> Result<String, AppError> {
    blocking(move || {
        tools_service::merge(Path::new(&first_part), Path::new(&dest_dir))
            .map(|p| p.to_string_lossy().into_owned())
            .map_err(io)
    })
    .await
}

#[tauri::command]
pub async fn zip_files(source: String, destination: String) -> Result<u64, AppError> {
    blocking(move || tools_service::zip_path(Path::new(&source), Path::new(&destination)).map_err(io)).await
}

#[tauri::command]
pub async fn unzip_archive(archive: String, dest_dir: String) -> Result<u64, AppError> {
    blocking(move || tools_service::unzip(Path::new(&archive), Path::new(&dest_dir)).map_err(io)).await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShredOutcome {
    pub shredded: Vec<String>,
    pub errors: Vec<crate::models::transfer::TransferError>,
}

/// Overwrites and deletes files permanently (no Recycle Bin).
#[tauri::command]
pub async fn shred_files(paths: Vec<String>) -> Result<ShredOutcome, AppError> {
    blocking(move || {
        let mut outcome = ShredOutcome { shredded: Vec::new(), errors: Vec::new() };
        for path in paths {
            match tools_service::shred(Path::new(&path)) {
                Ok(()) => {
                    tracing::info!(path = %path, "file shredded");
                    outcome.shredded.push(path);
                }
                Err(e) => outcome.errors.push(crate::models::transfer::TransferError { path, message: e.to_string() }),
            }
        }
        Ok(outcome)
    })
    .await
}

/// Host names and IPs only - the value goes on a command line.
fn valid_host(host: &str) -> bool {
    !host.is_empty() && host.len() <= 253 && host.chars().all(|c| c.is_ascii_alphanumeric() || ".-:".contains(c))
}

/// Windows' `ping` (4 echoes), its output as text.
#[tauri::command]
pub async fn ping_host(host: String) -> Result<String, AppError> {
    let host = host.trim().to_string();
    if !valid_host(&host) {
        return Err(AppError::new(AppErrorCode::InvalidInput, "Enter a host name or IP address."));
    }
    blocking(move || {
        let output = no_window(Command::new("ping.exe").args(["-n", "4", &host])).output().map_err(io)?;
        // ping writes in the console's OEM code page; non-ASCII is rare
        // in its output and lossy decoding is fine for display.
        Ok(String::from_utf8_lossy(&output.stdout).replace("\r\n", "\n").trim().to_string())
    })
    .await
}

/// The addresses a host name resolves to.
#[tauri::command]
pub async fn dns_lookup(host: String) -> Result<Vec<String>, AppError> {
    let host = host.trim().to_string();
    if !valid_host(&host) {
        return Err(AppError::new(AppErrorCode::InvalidInput, "Enter a host name."));
    }
    let addresses = tokio::net::lookup_host((host.as_str(), 0))
        .await
        .map_err(|e| AppError::new(AppErrorCode::NetworkUnavailable, format!("{host} could not be resolved: {e}")))?;
    let mut ips: Vec<String> = addresses.map(|a| a.ip().to_string()).collect();
    ips.sort();
    ips.dedup();
    Ok(ips)
}

/// Sends a Wake-on-LAN magic packet (UDP port 9) to `broadcast`
/// (default 255.255.255.255).
#[tauri::command]
pub async fn wake_on_lan(mac: String, broadcast: Option<String>) -> Result<(), AppError> {
    let mac = tools_service::parse_mac(&mac)
        .ok_or_else(|| AppError::new(AppErrorCode::InvalidInput, "Enter a MAC address like AA:BB:CC:DD:EE:FF."))?;
    let target: std::net::Ipv4Addr = broadcast
        .as_deref()
        .map(str::trim)
        .filter(|b| !b.is_empty())
        .unwrap_or("255.255.255.255")
        .parse()
        .map_err(|_| AppError::new(AppErrorCode::InvalidInput, "The broadcast address must be an IPv4 address."))?;
    let socket = tokio::net::UdpSocket::bind("0.0.0.0:0").await.map_err(io)?;
    socket.set_broadcast(true).map_err(io)?;
    socket.send_to(&tools_service::magic_packet(mac), (target, 9)).await.map_err(io)?;
    Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct PhysicalDisk {
    #[serde(default)]
    pub friendly_name: Option<String>,
    #[serde(default)]
    pub media_type: Option<String>,
    #[serde(default)]
    pub bus_type: Option<String>,
    #[serde(default)]
    pub health_status: Option<String>,
    #[serde(default)]
    pub operational_status: Option<String>,
    #[serde(default)]
    pub size: Option<u64>,
}

/// Health of the physical disks as Windows Storage reports it
/// (`Get-PhysicalDisk`, which summarizes the drives' S.M.A.R.T. state).
#[tauri::command]
pub async fn disk_health() -> Result<Vec<PhysicalDisk>, AppError> {
    blocking(|| {
        let script = "Get-PhysicalDisk | ForEach-Object { [pscustomobject]@{ FriendlyName = $_.FriendlyName; MediaType = [string]$_.MediaType; BusType = [string]$_.BusType; HealthStatus = [string]$_.HealthStatus; OperationalStatus = ($_.OperationalStatus -join ', '); Size = [uint64]$_.Size } } | ConvertTo-Json -Compress";
        let output = no_window(Command::new("powershell.exe").args(["-NoProfile", "-NonInteractive", "-Command", script]))
            .output()
            .map_err(io)?;
        let text = String::from_utf8_lossy(&output.stdout);
        let text = text.trim();
        if text.is_empty() {
            return Err(AppError::new(AppErrorCode::Unsupported, "Windows didn't report any physical disks."));
        }
        // A single disk comes back as an object, several as an array.
        serde_json::from_str::<Vec<PhysicalDisk>>(text)
            .or_else(|_| serde_json::from_str::<PhysicalDisk>(text).map(|d| vec![d]))
            .map_err(|e| AppError::new(AppErrorCode::Unknown, format!("Unexpected disk data: {e}")))
    })
    .await
}

/// Runs a .bat/.cmd/.ps1 the user picked, in its own console window
/// that stays open afterwards.
#[tauri::command]
pub fn run_script(path: String) -> Result<(), AppError> {
    let p = PathBuf::from(&path);
    if !p.is_file() {
        return Err(AppError::path_not_found(path));
    }
    let ext = p.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    let dir = p.parent().map(Path::to_path_buf).unwrap_or_default();
    let mut command = Command::new("cmd.exe");
    match ext.as_str() {
        "bat" | "cmd" => command.args(["/c", "start", "", "cmd.exe", "/k"]).arg(&p),
        "ps1" => command
            .args(["/c", "start", "", "powershell.exe", "-NoExit", "-ExecutionPolicy", "Bypass", "-File"])
            .arg(&p),
        _ => return Err(AppError::new(AppErrorCode::InvalidInput, "Choose a .bat, .cmd or .ps1 script.")),
    };
    tracing::info!(script = %path, "running user script");
    no_window(command.current_dir(dir)).spawn().map(|_| ()).map_err(io)
}

/// The end of the newest log file, for the Log Viewer.
#[tauri::command]
pub fn read_latest_log(max_lines: Option<usize>) -> Result<String, AppError> {
    let dir = crate::diagnostics::logs_dir().ok_or_else(|| io("The logs folder is unavailable."))?;
    let newest = std::fs::read_dir(&dir)
        .map_err(io)?
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|e| e == "log"))
        .max()
        .ok_or_else(|| io("No log files yet."))?;
    let text = String::from_utf8_lossy(&std::fs::read(&newest).map_err(io)?).into_owned();
    let lines: Vec<&str> = text.lines().collect();
    let keep = max_lines.unwrap_or(2_000);
    Ok(lines[lines.len().saturating_sub(keep)..].join("\n"))
}

/// The app's data folder (journals, scheduler, logs) for "Open Tools Folder".
#[tauri::command]
pub fn data_folder(app: tauri::AppHandle) -> Result<String, AppError> {
    let dir = crate::app_paths::data_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(io)?;
    Ok(dir.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hosts_are_validated_for_the_command_line() {
        assert!(valid_host("server-01.domain.local"));
        assert!(valid_host("192.168.1.10"));
        assert!(valid_host("fe80::1"));
        assert!(!valid_host("host & del *"));
        assert!(!valid_host(""));
    }
}
