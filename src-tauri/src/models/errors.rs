//! Error type returned by all commands: a stable `code` for the frontend
//! and a `message` that can be shown to the user as is.

use serde::Serialize;
use std::fmt;

/// Error classification the frontend switches on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AppErrorCode {
    PathNotFound,
    AccessDenied,
    InvalidPath,
    IoError,
    /// Only produced by the non-Windows fallback.
    #[allow(dead_code)]
    Unsupported,
    NetworkUnavailable,
    VolumeUnavailable,
    /// A request the user can fix by changing their input (an empty
    /// query, an invalid regex) - not a filesystem problem.
    InvalidInput,
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

    /// Only used by the non-Windows fallback.
    #[allow(dead_code)]
    pub fn unsupported(message: impl Into<String>) -> Self {
        Self::new(AppErrorCode::Unsupported, message)
    }

    /// Maps an I/O error on `path`. Failures on UNC paths become
    /// `NetworkUnavailable`.
    pub fn from_io(err: &std::io::Error, path: &str) -> Self {
        use std::io::ErrorKind;
        let is_unc = crate::utils::path::is_unc(path);
        match err.kind() {
            ErrorKind::NotFound if is_unc => Self::network_unavailable(path),
            ErrorKind::NotFound => Self::path_not_found(path),
            ErrorKind::PermissionDenied => Self::access_denied(path),
            _ => {
                // "Network path not found" (53) and friends arrive as raw OS
                // errors, not ErrorKind::NotFound.
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
