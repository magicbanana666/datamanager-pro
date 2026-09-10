//! Shared, serializable error type returned by every fallible Tauri
//! command in this crate. Nothing downstream of a command boundary ever
//! sees a raw `std::io::Error` or a Rust panic message - everything is
//! mapped to an [`AppError`] with a stable `code` the frontend can branch
//! on and a `message` that's safe to show a user directly.

use serde::Serialize;
use std::fmt;

/// Stable, machine-readable error classification. The frontend switches
/// on this rather than parsing `message` text.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AppErrorCode {
    PathNotFound,
    AccessDenied,
    InvalidPath,
    IoError,
    /// Reachable on Windows once a genuinely unimplemented operation is
    /// requested (none yet), and unconditionally on the non-Windows
    /// `platform::fallback` build - see `AppError::unsupported`.
    #[allow(dead_code)]
    Unsupported,
    NetworkUnavailable,
    VolumeUnavailable,
    Unknown,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub code: AppErrorCode,
    pub message: String,
    pub path: Option<String>,
    pub details: Option<String>,
}

impl AppError {
    pub fn new(code: AppErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            path: None,
            details: None,
        }
    }

    pub fn with_path(mut self, path: impl Into<String>) -> Self {
        self.path = Some(path.into());
        self
    }

    pub fn with_details(mut self, details: impl Into<String>) -> Self {
        self.details = Some(details.into());
        self
    }

    pub fn path_not_found(path: impl Into<String>) -> Self {
        let path = path.into();
        Self::new(
            AppErrorCode::PathNotFound,
            format!("The path could not be found: {path}"),
        )
        .with_path(path)
    }

    pub fn access_denied(path: impl Into<String>) -> Self {
        let path = path.into();
        Self::new(
            AppErrorCode::AccessDenied,
            format!("Access denied to: {path}"),
        )
        .with_path(path)
    }

    pub fn invalid_path(path: impl Into<String>, reason: impl Into<String>) -> Self {
        let path = path.into();
        let reason = reason.into();
        Self::new(AppErrorCode::InvalidPath, format!("Invalid path: {reason}")).with_path(path)
    }

    pub fn network_unavailable(path: impl Into<String>) -> Self {
        let path = path.into();
        Self::new(
            AppErrorCode::NetworkUnavailable,
            format!("The network location is unavailable: {path}"),
        )
        .with_path(path)
    }

    pub fn volume_unavailable(message: impl Into<String>) -> Self {
        Self::new(AppErrorCode::VolumeUnavailable, message)
    }

    /// Used by `platform::fallback` on non-Windows builds; on Windows
    /// this is currently unreachable since every Phase 2 operation is
    /// implemented there.
    #[allow(dead_code)]
    pub fn unsupported(message: impl Into<String>) -> Self {
        Self::new(AppErrorCode::Unsupported, message)
    }

    /// Maps a raw `io::Error` encountered while touching `path` into a
    /// user-safe [`AppError`], classifying UNC/network paths as
    /// `NetworkUnavailable` rather than the generic `PathNotFound`.
    pub fn from_io(err: &std::io::Error, path: &str) -> Self {
        use std::io::ErrorKind;
        let is_unc = crate::utils::path::is_unc(path);
        match err.kind() {
            ErrorKind::NotFound if is_unc => Self::network_unavailable(path),
            ErrorKind::NotFound => Self::path_not_found(path),
            ErrorKind::PermissionDenied => Self::access_denied(path),
            _ => {
                // Windows surfaces "the network path was not found" (error 53)
                // and similar as raw OS errors rather than ErrorKind::NotFound.
                if is_unc {
                    return Self::network_unavailable(path).with_details(err.to_string());
                }
                Self::new(
                    AppErrorCode::IoError,
                    "An unexpected filesystem error occurred.",
                )
                .with_path(path.to_string())
                .with_details(err.to_string())
            }
        }
    }
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for AppError {}
