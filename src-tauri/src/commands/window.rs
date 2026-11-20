//! The main window reopens as it was last left: maximized or not, and its
//! normal (un-maximized) size and position. The frontend stores the state in
//! settings.json under `window` on close (from `window_state`); `restore`
//! applies it to the still hidden window at startup, then shows it.
//!
//! Fullscreen is never restored: while fullscreen, `window_state` reports the
//! placement the window had before it went fullscreen.

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// The window's placement, as Windows' `GetWindowPlacement` reports it: the
/// normal rectangle in physical pixels and workspace coordinates (screen
/// coordinates offset by taskbars), even while the window is maximized.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowState {
    pub maximized: bool,
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

/// Smallest saved size taken as real; anything smaller is a broken file.
/// (The window's own minimum size is enforced by Windows anyway.)
const MIN_SIDE: i32 = 100;

impl WindowState {
    /// The `window` field of a settings.json value; `None` when absent or not
    /// a plausible state.
    pub fn from_settings(settings: &Value) -> Option<Self> {
        let s: Self = serde_json::from_value(settings.get("window")?.clone()).ok()?;
        (s.width >= MIN_SIDE && s.height >= MIN_SIDE).then_some(s)
    }
}

/// The last placement seen while not fullscreen: what `window_state` reports
/// while the window is fullscreen.
#[derive(Default)]
pub struct LastPlacement(pub Mutex<Option<WindowState>>);

/// Records the placement after the window moved or resized, unless it is
/// fullscreen (then the placement from before fullscreen is kept). One cheap
/// system call per event, nothing on the rendering path.
pub fn track(window: &tauri::Window, last: &LastPlacement) {
    if window.is_fullscreen().unwrap_or(false) {
        return;
    }
    if let Some(s) = placement(window) {
        *last.0.lock().unwrap_or_else(|e| e.into_inner()) = Some(s);
    }
}

/// The state to save on close: the current placement, or while fullscreen the
/// one from before fullscreen. `None` when it cannot be read.
#[tauri::command]
pub fn window_state(window: tauri::Window, last: tauri::State<'_, LastPlacement>) -> Option<WindowState> {
    track(&window, &last);
    *last.0.lock().unwrap_or_else(|e| e.into_inner())
}

/// Applies a saved state to the hidden window and shows it. Without one, or
/// when it is off-screen now (monitor unplugged, resolution changed), the
/// window opens at its default size, centred. Always shows the window.
pub fn restore(window: &tauri::WebviewWindow, saved: Option<WindowState>) {
    if !saved.is_some_and(|s| apply(window, s)) {
        let _ = window.center();
    }
    if let Err(e) = window.show() {
        eprintln!("Could not show the window: {e}");
    }
}

#[cfg(windows)]
fn placement(window: &tauri::Window) -> Option<WindowState> {
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowPlacement, SW_SHOWMAXIMIZED, SW_SHOWMINIMIZED, WINDOWPLACEMENT, WPF_RESTORETOMAXIMIZED,
    };

    let hwnd = window.hwnd().ok()?;
    let mut wp = WINDOWPLACEMENT { length: size_of::<WINDOWPLACEMENT>() as u32, ..Default::default() };
    // SAFETY: a valid window handle and a correctly sized struct.
    unsafe { GetWindowPlacement(hwnd, &mut wp) }.ok()?;
    let r = wp.rcNormalPosition;
    // Minimized (closed from the taskbar): what it restores to.
    let maximized = wp.showCmd == SW_SHOWMAXIMIZED.0 as u32
        || (wp.showCmd == SW_SHOWMINIMIZED.0 as u32 && wp.flags.contains(WPF_RESTORETOMAXIMIZED));
    Some(WindowState { maximized, x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top })
}

#[cfg(not(windows))]
fn placement(_window: &tauri::Window) -> Option<WindowState> {
    None
}

/// Sets the normal rectangle while the window is still hidden, then maximizes
/// it if it was: tao keeps a hidden window hidden and shows it maximized on
/// `show`, so it never opens small first. False when off-screen or failed.
#[cfg(windows)]
fn apply(window: &tauri::WebviewWindow, s: WindowState) -> bool {
    use windows::Win32::Foundation::RECT;
    use windows::Win32::UI::WindowsAndMessaging::{SW_HIDE, SetWindowPlacement, WINDOWPLACEMENT};

    let rect = RECT { left: s.x, top: s.y, right: s.x + s.width, bottom: s.y + s.height };
    if !on_screen(&rect) {
        return false;
    }
    let Ok(hwnd) = window.hwnd() else { return false };
    let wp = WINDOWPLACEMENT {
        length: size_of::<WINDOWPLACEMENT>() as u32,
        showCmd: SW_HIDE.0 as u32,
        rcNormalPosition: rect,
        ..Default::default()
    };
    // SAFETY: a valid window handle and a correctly sized struct.
    if let Err(e) = unsafe { SetWindowPlacement(hwnd, &wp) } {
        eprintln!("Could not restore the window placement: {e}");
        return false;
    }
    if s.maximized {
        let _ = window.maximize();
    }
    true
}

#[cfg(not(windows))]
fn apply(_window: &tauri::WebviewWindow, _s: WindowState) -> bool {
    false
}

/// Whether the top strip of the window (where the title bar is, to grab it)
/// is on a monitor. Workspace and screen coordinates differ by at most a
/// taskbar, which this check tolerates.
#[cfg(windows)]
fn on_screen(rect: &windows::Win32::Foundation::RECT) -> bool {
    use windows::Win32::Foundation::RECT;
    use windows::Win32::Graphics::Gdi::{MONITOR_DEFAULTTONULL, MonitorFromRect};

    let strip = RECT { bottom: rect.top + 32, ..*rect };
    // SAFETY: a plain rectangle lookup.
    !unsafe { MonitorFromRect(&strip, MONITOR_DEFAULTTONULL) }.is_invalid()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn reads_the_window_field() {
        let v = json!({ "version": 2, "window": { "maximized": true, "x": -8, "y": 20, "width": 1400, "height": 900 } });
        assert_eq!(
            WindowState::from_settings(&v),
            Some(WindowState { maximized: true, x: -8, y: 20, width: 1400, height: 900 })
        );
    }

    #[test]
    fn missing_or_broken_window_field_is_none() {
        for v in [
            json!({ "version": 2 }),
            json!({ "window": null }),
            json!({ "window": "big" }),
            json!({ "window": { "maximized": true } }),
            json!({ "window": { "maximized": false, "x": 0, "y": 0, "width": 1.5, "height": 800 } }),
            json!({ "window": { "maximized": false, "x": 0, "y": 0, "width": 0, "height": 800 } }),
            json!({ "window": { "maximized": false, "x": 0, "y": 0, "width": 1280, "height": -5 } }),
        ] {
            assert_eq!(WindowState::from_settings(&v), None, "{v}");
        }
    }

    /// The command's JSON is what the frontend stores and `from_settings` reads.
    #[test]
    fn serializes_as_the_frontend_stores_it() {
        let s = WindowState { maximized: false, x: 10, y: 20, width: 1280, height: 800 };
        let v = serde_json::to_value(s).unwrap();
        assert_eq!(v, json!({ "maximized": false, "x": 10, "y": 20, "width": 1280, "height": 800 }));
        assert_eq!(WindowState::from_settings(&json!({ "window": v })), Some(s));
    }
}
