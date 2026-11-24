//! PDF date strings (ISO 32000-1, 7.9.4) ⇄ RFC 3339.
use chrono::{DateTime, SecondsFormat, Utc};

/// `D:YYYYMMDDHHmmSS+00'00'` in UTC; an unparseable timestamp becomes "now".
pub(crate) fn pdf_date(iso: &str) -> String {
    let t = DateTime::parse_from_rfc3339(iso)
        .map(|t| t.with_timezone(&Utc))
        .unwrap_or_else(|_| Utc::now());
    t.format("D:%Y%m%d%H%M%S+00'00'").to_string()
}

/// The current time as a PDF date (UTC).
pub(crate) fn pdf_date_now() -> String {
    Utc::now().format("D:%Y%m%d%H%M%S+00'00'").to_string()
}

/// Inverse of [`pdf_date`] for any valid PDF date (`D:` and everything after the
/// year optional, offset `Z`, `+HH'mm'` or `-HH'mm'`). Returns RFC 3339 in UTC.
pub(crate) fn iso_from_pdf_date(s: &str) -> Option<String> {
    let s = s.strip_prefix("D:").unwrap_or(s);
    let digits: String = s.chars().take_while(|c| c.is_ascii_digit()).collect();
    if digits.len() < 4 {
        return None;
    }
    let field = |from: usize, len: usize, default: u32| -> u32 {
        digits
            .get(from..from + len)
            .and_then(|v| v.parse().ok())
            .unwrap_or(default)
    };
    let year = field(0, 4, 0) as i32;
    let (month, day, hour, min, sec) = (
        field(4, 2, 1),
        field(6, 2, 1),
        field(8, 2, 0),
        field(10, 2, 0),
        field(12, 2, 0),
    );
    let rest = &s[digits.len()..];
    let offset_secs = match rest.chars().next() {
        Some(sign @ ('+' | '-')) => {
            let tz: String = rest[1..].chars().filter(|c| c.is_ascii_digit()).collect();
            let h: i32 = tz.get(0..2).and_then(|v| v.parse().ok()).unwrap_or(0);
            let m: i32 = tz.get(2..4).and_then(|v| v.parse().ok()).unwrap_or(0);
            let secs = h * 3600 + m * 60;
            if sign == '-' { -secs } else { secs }
        }
        _ => 0,
    };
    let offset = chrono::FixedOffset::east_opt(offset_secs)?;
    let local = chrono::NaiveDate::from_ymd_opt(year, month, day)?.and_hms_opt(hour, min, sec)?;
    let t = local.and_local_timezone(offset).single()?;
    Some(
        t.with_timezone(&Utc)
            .to_rfc3339_opts(SecondsFormat::Secs, true),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pdf_date_is_utc() {
        assert_eq!(
            pdf_date("2026-11-18T10:00:00+02:00"),
            "D:20261118080000+00'00'"
        );
        assert_eq!(
            pdf_date("2026-11-18T10:00:00.123Z"),
            "D:20261118100000+00'00'"
        );
        assert!(pdf_date("nonsense").starts_with("D:20"));
    }

    #[test]
    fn pdf_date_parses_back() {
        assert_eq!(
            iso_from_pdf_date("D:20261118080000+00'00'").as_deref(),
            Some("2026-11-18T08:00:00Z")
        );
        assert_eq!(
            iso_from_pdf_date("D:20260102030405+01'00'").as_deref(),
            Some("2026-01-02T02:04:05Z")
        );
        assert_eq!(
            iso_from_pdf_date("D:20260102030405-05'30").as_deref(),
            Some("2026-01-02T08:34:05Z")
        );
        assert_eq!(
            iso_from_pdf_date("D:2026").as_deref(),
            Some("2026-01-01T00:00:00Z")
        );
        assert_eq!(
            iso_from_pdf_date("20261118101112Z").as_deref(),
            Some("2026-11-18T10:11:12Z")
        );
        assert_eq!(iso_from_pdf_date("D:20261399").as_deref(), None);
        assert_eq!(iso_from_pdf_date("garbage"), None);
    }
}
