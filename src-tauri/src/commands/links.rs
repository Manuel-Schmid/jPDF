//! Opening a PDF's web links in the system browser (or mail app).
//!
//! Only `http`, `https` and `mailto` addresses are opened: a link in a PDF is
//! untrusted input, and handing anything else (a `file:` path, an `.exe`, a
//! custom protocol) to the shell could launch programs.

use crate::error::AppError;

/// Schemes `open_url` hands to the shell, lowercase with their colon.
const SCHEMES: [&str; 3] = ["http:", "https:", "mailto:"];

/// Whether `url` is a web or mail address the shell may open: one of
/// `SCHEMES` (any case) and no whitespace, control characters or quotes
/// (pdf.js passes URLs already percent-encoded).
pub fn is_openable_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    let Some(scheme) = SCHEMES.iter().find(|s| lower.starts_with(*s)) else {
        return false;
    };
    let rest = &url[scheme.len()..];
    let web = *scheme != "mailto:";
    // A web address needs a host after `//`.
    if web && (!rest.starts_with("//") || rest.len() <= 2) {
        return false;
    }
    !rest.is_empty() && !url.chars().any(|c| c.is_whitespace() || c.is_control() || c == '"')
}

/// Opens `url` with the default handler for its scheme; refuses anything
/// `is_openable_url` rejects.
#[tauri::command]
pub fn open_url(url: String) -> Result<(), AppError> {
    if !is_openable_url(&url) {
        return Err(AppError::Io(format!("not a web link: {url}")));
    }
    shell_open(&url)
}

#[cfg(windows)]
fn shell_open(url: &str) -> Result<(), AppError> {
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
    use windows::core::{HSTRING, w};

    // SAFETY: all strings are valid, NUL-terminated wide strings that outlive the call.
    let result = unsafe { ShellExecuteW(None, w!("open"), &HSTRING::from(url), None, None, SW_SHOWNORMAL) };
    // Values above 32 mean success (ShellExecuteW's documented convention).
    if result.0 as isize > 32 {
        Ok(())
    } else {
        Err(AppError::Io(format!("could not open {url} (error {})", result.0 as isize)))
    }
}

#[cfg(not(windows))]
fn shell_open(url: &str) -> Result<(), AppError> {
    Err(AppError::Io(format!("opening links is only supported on Windows: {url}")))
}

#[cfg(test)]
mod tests {
    use super::is_openable_url;

    #[test]
    fn opens_web_and_mail_addresses() {
        assert!(is_openable_url("https://example.com/a?b=c#d"));
        assert!(is_openable_url("http://example.com"));
        assert!(is_openable_url("HTTPS://EXAMPLE.COM"));
        assert!(is_openable_url("mailto:someone@example.com"));
    }

    #[test]
    fn refuses_other_schemes_and_odd_input() {
        assert!(!is_openable_url("file:///C:/Windows/System32/calc.exe"));
        assert!(!is_openable_url(r"C:WindowsSystem32lc.exe"));
        assert!(!is_openable_url("javascript:alert(1)"));
        assert!(!is_openable_url("ms-settings:"));
        assert!(!is_openable_url("https:"));
        assert!(!is_openable_url("https://"));
        assert!(!is_openable_url("https:example.com"));
        assert!(!is_openable_url("mailto:"));
        assert!(!is_openable_url("https://example.com/a b"));
        assert!(!is_openable_url("https://example.com/\"x"));
        assert!(!is_openable_url("https://example.com/\nx"));
        assert!(!is_openable_url(""));
    }
}
