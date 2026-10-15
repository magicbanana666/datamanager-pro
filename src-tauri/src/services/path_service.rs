//! Validation of paths coming from the frontend. Problems are returned
//! as data, never as errors.

use crate::models::errors::AppError;
use crate::models::filesystem::PathValidation;
use crate::utils::path::{is_absolute, is_unc, normalize_path};
use std::path::Path;

/// Validates `input` using metadata calls only. "Not found", "access
/// denied" etc. are part of the returned `PathValidation`.
pub fn validate(input: &str) -> PathValidation {
    let normalized = normalize_path(input);
    if normalized.is_empty() {
        return PathValidation {
            input_path: input.to_string(),
            normalized_path: None,
            exists: false,
            is_file: false,
            is_directory: false,
            is_symlink: false,
            is_absolute: false,
            is_unc: false,
            accessible: false,
            error: Some(AppError::invalid_path(input, "The path is empty.")),
        };
    }

    let unc = is_unc(&normalized);
    let absolute = is_absolute(&normalized);
    let path = Path::new(&normalized);

    match std::fs::symlink_metadata(path) {
        Ok(metadata) => {
            let is_symlink = metadata.file_type().is_symlink();
            // Classify a symlink by its target where possible.
            let (is_file, is_directory) = if is_symlink {
                std::fs::metadata(path)
                    .map(|m| (m.is_file(), m.is_dir()))
                    .unwrap_or((false, false))
            } else {
                (metadata.is_file(), metadata.is_dir())
            };
            PathValidation {
                input_path: input.to_string(),
                normalized_path: Some(normalized),
                exists: true,
                is_file,
                is_directory,
                is_symlink,
                is_absolute: absolute,
                is_unc: unc,
                accessible: true,
                error: None,
            }
        }
        Err(err) => {
            let app_err = AppError::from_io(&err, &normalized);
            PathValidation {
                input_path: input.to_string(),
                normalized_path: Some(normalized),
                exists: false,
                is_file: false,
                is_directory: false,
                is_symlink: false,
                is_absolute: absolute,
                is_unc: unc,
                accessible: false,
                error: Some(app_err),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::errors::AppErrorCode;

    #[test]
    fn validate_reports_missing_path_without_erroring() {
        let result = validate(r"Z:\this-definitely-does-not-exist-12345\nested");
        assert!(!result.exists);
        assert!(!result.accessible);
        assert!(result.error.is_some());
    }

    #[test]
    fn validate_reports_empty_input_as_invalid_not_a_panic() {
        let result = validate("");
        assert!(!result.exists);
        assert_eq!(result.error.unwrap().code, AppErrorCode::InvalidPath);
    }

    #[test]
    fn validate_existing_directory_via_tempdir() {
        let dir = tempfile::tempdir().unwrap();
        let result = validate(&dir.path().to_string_lossy());
        assert!(result.exists);
        assert!(result.is_directory);
        assert!(!result.is_file);
        assert!(result.accessible);
        assert!(result.error.is_none());
    }

    #[test]
    fn validate_existing_file_via_tempdir() {
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("test.txt");
        std::fs::write(&file_path, b"hello").unwrap();
        let result = validate(&file_path.to_string_lossy());
        assert!(result.exists);
        assert!(result.is_file);
        assert!(!result.is_directory);
    }

    #[test]
    fn validate_classifies_unc_paths_as_unc_and_absolute_even_when_unreachable() {
        let result = validate(r"\\NAS\CompanyData");
        assert!(result.is_unc);
        assert!(result.is_absolute);
    }

    #[test]
    fn validate_normalizes_forward_slashes_in_output() {
        let dir = tempfile::tempdir().unwrap();
        let with_forward_slashes = dir.path().to_string_lossy().replace('\\', "/");
        let result = validate(&with_forward_slashes);
        assert_eq!(
            result.normalized_path.as_deref(),
            Some(dir.path().to_string_lossy().as_ref())
        );
    }
}
