//! Crash recovery files: while a tab has unsaved changes the frontend keeps
//! a snapshot of them in `<app data>/recovery/<tab id>/`: `snapshot.json`
//! (its shape belongs to the frontend) and `images/<key>` (pasted images,
//! base64 text, written once each). The PDF itself is never touched.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;
use serde_json::Value;
use tauri::Manager;

use crate::commands::files::blocking;
use crate::commands::settings::{load_from, save_to};
use crate::error::AppError;

const SNAPSHOT: &str = "snapshot.json";
const IMAGES: &str = "images";

/// A snapshot left on disk (by a crashed or killed run, when read at start).
#[derive(Debug, Serialize, PartialEq)]
pub struct Recovered {
    pub id: String,
    pub snapshot: Value,
}

/// Size and modification time (ms since the epoch) of a file.
#[derive(Debug, Serialize, PartialEq, Clone, Copy)]
pub struct FileStamp {
    pub size: u64,
    pub modified: u64,
}

fn io_err(path: &Path, e: std::io::Error) -> AppError {
    AppError::Io(format!("{}: {e}", path.display()))
}

/// Tab ids and image keys are frontend UUIDs; anything else could escape the folder.
fn check_name(name: &str) -> Result<&str, AppError> {
    let ok = !name.is_empty()
        && name.len() <= 64
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
    if ok {
        Ok(name)
    } else {
        Err(AppError::Io(format!("invalid recovery name: {name:?}")))
    }
}

/// Writes the images not yet on disk, then the snapshot (atomically), so a
/// snapshot never refers to an image that is missing.
pub fn write_in(
    root: &Path,
    id: &str,
    snapshot: &Value,
    images: &HashMap<String, String>,
) -> Result<(), AppError> {
    let dir = root.join(check_name(id)?);
    if !images.is_empty() {
        let image_dir = dir.join(IMAGES);
        std::fs::create_dir_all(&image_dir).map_err(|e| io_err(&image_dir, e))?;
        for (key, data) in images {
            let path = image_dir.join(check_name(key)?);
            let tmp = path.with_extension("tmp");
            std::fs::write(&tmp, data).map_err(|e| io_err(&tmp, e))?;
            std::fs::rename(&tmp, &path).map_err(|e| io_err(&path, e))?;
        }
    }
    save_to(&dir.join(SNAPSHOT), snapshot)
}

/// Every readable snapshot under `root`; folders without one (or with a
/// corrupt one) are skipped.
pub fn list_in(root: &Path) -> Result<Vec<Recovered>, AppError> {
    let entries = match std::fs::read_dir(root) {
        Ok(e) => e,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
        Err(e) => return Err(io_err(root, e)),
    };
    let mut out = vec![];
    for entry in entries.flatten() {
        let Some(id) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        if check_name(&id).is_err() || !entry.path().is_dir() {
            continue;
        }
        if let Ok(Some(snapshot)) = load_from(&entry.path().join(SNAPSHOT)) {
            out.push(Recovered { id, snapshot });
        }
    }
    out.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(out)
}

/// A snapshot's image (base64 text), `None` when it is missing.
pub fn image_in(root: &Path, id: &str, key: &str) -> Result<Option<String>, AppError> {
    let path = root
        .join(check_name(id)?)
        .join(IMAGES)
        .join(check_name(key)?);
    match std::fs::read_to_string(&path) {
        Ok(t) => Ok(Some(t)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(io_err(&path, e)),
    }
}

/// Removes a tab's recovery folder; a missing one is fine.
pub fn delete_in(root: &Path, id: &str) -> Result<(), AppError> {
    let dir = root.join(check_name(id)?);
    match std::fs::remove_dir_all(&dir) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(io_err(&dir, e)),
        _ => Ok(()),
    }
}

/// `None` when the file is missing or its metadata cannot be read.
pub fn stamp_of(path: &Path) -> Option<FileStamp> {
    let meta = std::fs::metadata(path).ok()?;
    let modified = meta
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()?
        .as_millis();
    Some(FileStamp {
        size: meta.len(),
        modified: u64::try_from(modified).ok()?,
    })
}

fn recovery_root(app: &tauri::AppHandle) -> Result<PathBuf, AppError> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Io(e.to_string()))?;
    Ok(dir.join("recovery"))
}

#[tauri::command]
pub async fn write_recovery(
    app: tauri::AppHandle,
    id: String,
    snapshot: Value,
    images: HashMap<String, String>,
) -> Result<(), AppError> {
    let root = recovery_root(&app)?;
    blocking(move || write_in(&root, &id, &snapshot, &images)).await
}

#[tauri::command]
pub async fn list_recovery(app: tauri::AppHandle) -> Result<Vec<Recovered>, AppError> {
    let root = recovery_root(&app)?;
    blocking(move || list_in(&root)).await
}

#[tauri::command]
pub async fn read_recovery_image(
    app: tauri::AppHandle,
    id: String,
    key: String,
) -> Result<Option<String>, AppError> {
    let root = recovery_root(&app)?;
    blocking(move || image_in(&root, &id, &key)).await
}

#[tauri::command]
pub async fn delete_recovery(app: tauri::AppHandle, id: String) -> Result<(), AppError> {
    let root = recovery_root(&app)?;
    blocking(move || delete_in(&root, &id)).await
}

#[tauri::command]
pub async fn file_stamp(path: String) -> Result<Option<FileStamp>, AppError> {
    blocking(move || Ok(stamp_of(Path::new(&path)))).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const ID: &str = "0b7c8f1e-1d2a-4c3b-9e8f-123456789abc";

    #[test]
    fn write_list_read_delete() {
        let root = tempfile::tempdir().unwrap();
        let snap = json!({ "version": 1, "path": "C:\\a.pdf", "upserts": [] });
        let images = HashMap::from([("img-1".to_string(), "iVBORw0KGgo=".to_string())]);
        write_in(root.path(), ID, &snap, &images).unwrap();
        assert_eq!(
            list_in(root.path()).unwrap(),
            vec![Recovered {
                id: ID.into(),
                snapshot: snap.clone()
            }]
        );
        assert_eq!(
            image_in(root.path(), ID, "img-1").unwrap().as_deref(),
            Some("iVBORw0KGgo=")
        );
        assert_eq!(image_in(root.path(), ID, "img-2").unwrap(), None);

        // A later snapshot without new images keeps the images already written.
        let snap2 = json!({ "version": 1, "path": "C:\\a.pdf", "upserts": [1] });
        write_in(root.path(), ID, &snap2, &HashMap::new()).unwrap();
        assert_eq!(list_in(root.path()).unwrap()[0].snapshot, snap2);
        assert!(image_in(root.path(), ID, "img-1").unwrap().is_some());

        delete_in(root.path(), ID).unwrap();
        assert_eq!(list_in(root.path()).unwrap(), vec![]);
        delete_in(root.path(), ID).unwrap();
    }

    #[test]
    fn missing_root_lists_nothing() {
        let root = tempfile::tempdir().unwrap();
        assert_eq!(list_in(&root.path().join("nope")).unwrap(), vec![]);
    }

    /// Folders without a readable snapshot (a crash before the first write,
    /// a corrupt file, a stray folder) are skipped.
    #[test]
    fn skips_folders_without_a_snapshot() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(root.path().join("empty")).unwrap();
        std::fs::create_dir_all(root.path().join("bad")).unwrap();
        std::fs::write(root.path().join("bad").join(SNAPSHOT), "{nope").unwrap();
        std::fs::write(root.path().join("file"), "x").unwrap();
        assert_eq!(list_in(root.path()).unwrap(), vec![]);
    }

    #[test]
    fn rejects_names_that_leave_the_folder() {
        let root = tempfile::tempdir().unwrap();
        let snap = json!({});
        assert!(write_in(root.path(), "..", &snap, &HashMap::new()).is_err());
        assert!(write_in(root.path(), "a/b", &snap, &HashMap::new()).is_err());
        let bad_image = HashMap::from([("..\\x".to_string(), String::new())]);
        assert!(write_in(root.path(), ID, &snap, &bad_image).is_err());
        assert!(image_in(root.path(), ID, "../x").is_err());
        assert!(delete_in(root.path(), "").is_err());
    }

    #[test]
    fn stamps_size_and_mtime() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("a.pdf");
        assert_eq!(stamp_of(&p), None);
        std::fs::write(&p, b"12345").unwrap();
        let s = stamp_of(&p).unwrap();
        assert_eq!(s.size, 5);
        assert!(s.modified > 0);
    }
}
