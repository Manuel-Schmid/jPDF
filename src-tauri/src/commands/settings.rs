use std::path::Path;

use serde_json::Value;
use tauri::Manager;

use crate::error::AppError;

const FILE_NAME: &str = "settings.json";

fn io_err(path: &Path, e: std::io::Error) -> AppError {
    AppError::Io(format!("{}: {e}", path.display()))
}

/// Missing or unparseable file yields `None`; the frontend falls back to defaults.
pub fn load_from(path: &Path) -> Result<Option<Value>, AppError> {
    let text = match std::fs::read_to_string(path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(io_err(path, e)),
    };
    match serde_json::from_str(&text) {
        Ok(v) => Ok(Some(v)),
        Err(e) => {
            eprintln!("settings: ignoring unparseable {}: {e}", path.display());
            Ok(None)
        }
    }
}

/// Writes a temp file in the same directory, then renames it over the target.
pub fn save_to(path: &Path, value: &Value) -> Result<(), AppError> {
    let dir = path.parent().unwrap_or_else(|| Path::new("."));
    std::fs::create_dir_all(dir).map_err(|e| io_err(dir, e))?;
    let tmp = path.with_extension("json.tmp");
    let text = serde_json::to_string_pretty(value).map_err(|e| AppError::Io(e.to_string()))?;
    std::fs::write(&tmp, text).map_err(|e| io_err(&tmp, e))?;
    std::fs::rename(&tmp, path).map_err(|e| io_err(path, e))
}

pub(crate) fn settings_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, AppError> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| AppError::Io(e.to_string()))?;
    Ok(dir.join(FILE_NAME))
}

#[tauri::command]
pub fn load_settings(app: tauri::AppHandle) -> Result<Option<Value>, AppError> {
    load_from(&settings_path(&app)?)
}

#[tauri::command]
pub fn save_settings(app: tauri::AppHandle, value: Value) -> Result<(), AppError> {
    save_to(&settings_path(&app)?, &value)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("juliepdf-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        d
    }

    #[test]
    fn save_then_load_roundtrips() {
        let dir = temp_dir("roundtrip");
        let path = dir.join("nested").join(FILE_NAME);
        let v = serde_json::json!({ "version": 1, "author": "Ü", "toolbar": [] });
        save_to(&path, &v).unwrap();
        assert_eq!(load_from(&path).unwrap(), Some(v));
        assert!(!path.with_extension("json.tmp").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn missing_or_corrupt_is_none() {
        let dir = temp_dir("corrupt");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(FILE_NAME);
        assert_eq!(load_from(&path).unwrap(), None);
        std::fs::write(&path, "{nope").unwrap();
        assert_eq!(load_from(&path).unwrap(), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The file's shape and versioning belong to the frontend: whatever it
    /// writes (preferences included) comes back unchanged, and a save replaces
    /// the previous file completely.
    #[test]
    fn save_overwrites_and_keeps_preferences() {
        let dir = temp_dir("overwrite");
        let path = dir.join(FILE_NAME);
        save_to(&path, &serde_json::json!({ "version": 1, "toolbar": [], "old": true })).unwrap();
        let v2 = serde_json::json!({ "version": 2, "toolbar": [], "preferences": { "theme": "light" } });
        save_to(&path, &v2).unwrap();
        assert_eq!(load_from(&path).unwrap(), Some(v2));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// An unreadable file is an error (the frontend logs it and uses defaults).
    #[test]
    fn unreadable_is_an_error() {
        let dir = temp_dir("unreadable");
        let path = dir.join(FILE_NAME);
        std::fs::create_dir_all(&path).unwrap();
        assert!(load_from(&path).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
