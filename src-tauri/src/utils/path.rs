//! Path normalization and classification helpers shared by
//! `path_service` and the filesystem commands.
//!
//! These are pure string/`Path` functions with no I/O, which is what
//! makes them cheap to unit test thoroughly (see the `tests` module
//! below) - none of them touch the filesystem or panic on malformed
//! input; malformed input just normalizes as best-effort.

/// True if `path` is a UNC path (`\\server\share...` or the `//`
/// slash-forward equivalent a user might type).
pub fn is_unc(path: &str) -> bool {
    path.starts_with(r"\\") || path.starts_with("//")
}

/// True if `path` is a bare drive reference with no trailing separator,
/// e.g. `C:` or `d:`. Windows treats this as "current directory on that
/// drive", which is almost never what a folder picker / path field means
/// - `normalize_path` turns this into the drive *root* (`C:\`).
fn is_bare_drive(path: &str) -> bool {
    let bytes = path.as_bytes();
    bytes.len() == 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':'
}

/// Normalizes a user- or frontend-supplied path into a canonical
/// Windows-style string, without touching the filesystem:
///
/// - accepts `/` or `\` as separators and converts to `\`
/// - preserves the UNC `\\server\share` prefix (never collapses it to a
///   single backslash)
/// - collapses duplicate interior separators
/// - strips a trailing separator, *except* it preserves the trailing
///   backslash on a bare drive root (`C:` -> `C:\`, `C:\` stays `C:\`)
///   since dropping it there would change the path's meaning
/// - is a pure string transform: it never fails, panics, or touches disk
pub fn normalize_path(input: &str) -> String {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    let unc = is_unc(trimmed);
    // Convert separators, but keep track of the UNC double-prefix so we
    // don't accidentally collapse it while deduplicating below.
    let slashes_converted: String = trimmed
        .chars()
        .map(|c| if c == '/' { '\\' } else { c })
        .collect();

    let rest = if unc {
        slashes_converted.trim_start_matches('\\')
    } else {
        slashes_converted.as_str()
    };

    // Collapse any run of interior backslashes into one.
    let mut collapsed = String::with_capacity(rest.len());
    let mut prev_was_sep = false;
    for c in rest.chars() {
        if c == '\\' {
            if !prev_was_sep {
                collapsed.push('\\');
            }
            prev_was_sep = true;
        } else {
            collapsed.push(c);
            prev_was_sep = false;
        }
    }

    // Strip a single trailing separator (the loop above already
    // collapsed runs of them to one).
    if collapsed.ends_with('\\') {
        collapsed.pop();
    }

    let mut result = if unc {
        format!(r"\\{collapsed}")
    } else {
        collapsed
    };

    if result.is_empty() {
        return result;
    }

    // A bare drive letter (`C:`) means "current directory on that
    // drive" to Win32 - normalize it to the drive root instead, which
    // is what every caller in this app actually means.
    if is_bare_drive(&result) {
        result.push('\\');
    }

    result
}

/// True if the *normalized* form of `path` is absolute: a drive-rooted
/// Windows path (`C:\...`) or a UNC path. A bare drive letter (`C:`) is
/// treated as absolute too since `normalize_path` resolves it to the
/// drive root before this is ever checked in practice.
pub fn is_absolute(normalized: &str) -> bool {
    if is_unc(normalized) {
        return true;
    }
    let bytes = normalized.as_bytes();
    bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'\\' || bytes[2] == b'/')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn forward_slashes_convert_to_backslashes() {
        assert_eq!(
            normalize_path("C:/Users/Jonas/Documents"),
            r"C:\Users\Jonas\Documents"
        );
    }

    #[test]
    fn already_normalized_path_is_unchanged() {
        assert_eq!(normalize_path(r"D:\Data\Projects"), r"D:\Data\Projects");
    }

    #[test]
    fn bare_drive_letter_becomes_root() {
        assert_eq!(normalize_path("C:"), r"C:\");
        assert_eq!(normalize_path("c:"), r"c:\");
    }

    #[test]
    fn drive_root_trailing_backslash_is_preserved() {
        assert_eq!(normalize_path(r"C:\"), r"C:\");
    }

    #[test]
    fn trailing_slash_is_stripped_on_deeper_paths() {
        assert_eq!(normalize_path(r"D:\Data\Projects\"), r"D:\Data\Projects");
        assert_eq!(normalize_path("D:/Data/Projects/"), r"D:\Data\Projects");
    }

    #[test]
    fn unc_path_prefix_is_preserved_exactly() {
        assert_eq!(normalize_path(r"\\NAS\CompanyData"), r"\\NAS\CompanyData");
    }

    #[test]
    fn unc_path_with_forward_slashes_normalizes_without_corrupting_prefix() {
        assert_eq!(normalize_path("//NAS/CompanyData"), r"\\NAS\CompanyData");
    }

    #[test]
    fn unc_path_trailing_slash_is_stripped() {
        assert_eq!(normalize_path(r"\\NAS\CompanyData\"), r"\\NAS\CompanyData");
    }

    #[test]
    fn duplicate_interior_separators_collapse() {
        assert_eq!(normalize_path(r"D:\Data\\Projects"), r"D:\Data\Projects");
    }

    #[test]
    fn empty_and_whitespace_only_input_normalizes_to_empty() {
        assert_eq!(normalize_path(""), "");
        assert_eq!(normalize_path("   "), "");
    }

    #[test]
    fn is_unc_detects_both_slash_styles() {
        assert!(is_unc(r"\\NAS\Share"));
        assert!(is_unc("//NAS/Share"));
        assert!(!is_unc(r"C:\Users"));
    }

    #[test]
    fn is_absolute_true_for_drive_and_unc_paths() {
        assert!(is_absolute(r"C:\Users"));
        assert!(is_absolute(r"\\NAS\CompanyData"));
    }

    #[test]
    fn is_absolute_false_for_relative_paths() {
        assert!(!is_absolute("Users\\Jonas"));
        assert!(!is_absolute("relative/path"));
    }

    #[test]
    fn very_long_path_normalizes_without_truncation() {
        let long_segment = "a".repeat(300);
        let input = format!(r"D:\{long_segment}\{long_segment}");
        let normalized = normalize_path(&input);
        assert_eq!(normalized, input);
        assert!(
            normalized.len() > 260,
            "normalization must not silently truncate long paths"
        );
    }
}
