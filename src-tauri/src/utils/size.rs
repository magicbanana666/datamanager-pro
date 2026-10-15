//! Byte size formatting and usage percentages.
//!
//! Sizes use 1024-based units labeled KB/MB/GB/TB, like Explorer.

const UNITS: [&str; 6] = ["B", "KB", "MB", "GB", "TB", "PB"];

pub fn format_bytes(bytes: u64) -> String {
    if bytes == 0 {
        return "0 B".to_string();
    }
    let bytes_f = bytes as f64;
    let exponent = (bytes_f.ln() / 1024_f64.ln()).floor() as i32;
    let exponent = exponent.clamp(0, (UNITS.len() - 1) as i32) as usize;
    let value = bytes_f / 1024_f64.powi(exponent as i32);
    if exponent == 0 {
        format!("{value:.0} {}", UNITS[exponent])
    } else {
        format!("{value:.2} {}", UNITS[exponent])
    }
}

/// Percentage of `total` represented by `used`, clamped to `[0, 100]` and
/// safe against a zero total (returns `0.0` rather than dividing by zero
/// or producing `NaN`).
pub fn usage_percent(used: u64, total: u64) -> f64 {
    if total == 0 {
        return 0.0;
    }
    ((used as f64 / total as f64) * 100.0).clamp(0.0, 100.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zero_bytes() {
        assert_eq!(format_bytes(0), "0 B");
    }

    #[test]
    fn small_byte_counts_have_no_decimals() {
        assert_eq!(format_bytes(512), "512 B");
    }

    #[test]
    fn kilobytes() {
        assert_eq!(format_bytes(2048), "2.00 KB");
    }

    #[test]
    fn gigabytes() {
        // 1.5 GiB
        assert_eq!(format_bytes(1_610_612_736), "1.50 GB");
    }

    #[test]
    fn terabytes_match_frontend_style() {
        // ~1.24 TiB.
        let bytes = (1.24_f64 * 1024_f64.powi(4)) as u64;
        assert_eq!(format_bytes(bytes), "1.24 TB");
    }

    #[test]
    fn does_not_overflow_past_petabytes() {
        assert!(format_bytes(u64::MAX).ends_with("PB"));
    }

    #[test]
    fn usage_percent_normal_case() {
        assert!((usage_percent(50, 200) - 25.0).abs() < f64::EPSILON);
    }

    #[test]
    fn usage_percent_zero_total_is_zero_not_nan() {
        let pct = usage_percent(10, 0);
        assert_eq!(pct, 0.0);
        assert!(!pct.is_nan());
    }

    #[test]
    fn usage_percent_clamps_to_100() {
        // used > total should never happen, but must not panic or exceed 100.
        assert_eq!(usage_percent(300, 200), 100.0);
    }

    #[test]
    fn usage_percent_full_disk() {
        assert_eq!(usage_percent(200, 200), 100.0);
    }
}
