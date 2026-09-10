//! Timestamp conversion. The backend always returns UTC ISO 8601
//! (`2026-09-09T14:22:00Z`); the frontend is responsible for rendering it
//! in the user's local timezone (see `src/utils/format.ts`).

use chrono::{DateTime, Utc};
use std::time::SystemTime;

/// Converts a `SystemTime` (as returned by `std::fs::Metadata`) to a UTC
/// ISO 8601 string. Returns `None` rather than panicking if the platform
/// reports a time outside what's representable (some FAT volumes predate
/// the Unix epoch for `created`).
pub fn system_time_to_iso8601(time: SystemTime) -> Option<String> {
    let dt: DateTime<Utc> = time.into();
    Some(dt.to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn epoch_formats_as_expected() {
        let t = SystemTime::UNIX_EPOCH;
        assert_eq!(
            system_time_to_iso8601(t),
            Some("1970-01-01T00:00:00Z".to_string())
        );
    }

    #[test]
    fn later_time_formats_as_expected() {
        let dt = Utc.with_ymd_and_hms(2025, 9, 9, 14, 22, 0).unwrap();
        let t: SystemTime = dt.into();
        assert_eq!(
            system_time_to_iso8601(t),
            Some("2025-09-09T14:22:00Z".to_string())
        );
    }
}
