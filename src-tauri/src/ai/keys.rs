//! API keys in the Windows Credential Manager (never in the settings file),
//! one per provider preset, so switching presets keeps each key.
use keyring::Entry;

use crate::error::AppError;

const SERVICE: &str = "JuliePDF";

/// The credential's user name for a provider preset (`gemini`, `custom` …).
fn account(provider: &str) -> Result<String, AppError> {
    let ok = !provider.is_empty() && provider.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if !ok {
        return Err(AppError::AiKey(format!("invalid provider name {provider:?}")));
    }
    Ok(format!("ai-key:{provider}"))
}

fn entry(provider: &str) -> Result<Entry, AppError> {
    Entry::new(SERVICE, &account(provider)?).map_err(store_error)
}

fn store_error(e: keyring::Error) -> AppError {
    AppError::Io(format!("Windows Credential Manager: {e}"))
}

pub fn set_key(provider: &str, key: &str) -> Result<(), AppError> {
    let key = key.trim();
    if key.is_empty() {
        return delete_key(provider);
    }
    entry(provider)?.set_password(key).map_err(store_error)
}

/// The stored key, `None` when there is none.
pub fn get_key(provider: &str) -> Result<Option<String>, AppError> {
    match entry(provider)?.get_password() {
        Ok(k) => Ok(Some(k)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(store_error(e)),
    }
}

pub fn delete_key(provider: &str) -> Result<(), AppError> {
    match entry(provider)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(store_error(e)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_names_are_checked() {
        assert_eq!(account("gemini").unwrap(), "ai-key:gemini");
        for bad in ["", "a b", "x/y", "ü"] {
            assert!(account(bad).is_err(), "{bad}");
        }
    }
}
