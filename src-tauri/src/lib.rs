pub mod ai;
pub mod commands;
pub mod error;
pub mod pdf;

use commands::files::{
    LaunchFiles, export_without_annotations, get_launch_files, merge_pdfs, open_pdf, path_exists, pdf_args, read_document, save_pdf,
};
use commands::links::open_url;
use commands::recovery::{delete_recovery, file_stamp, list_recovery, read_recovery_image, write_recovery};
use commands::settings::{load_from, load_settings, save_settings, settings_path};
use commands::window::{LastPlacement, WindowState, window_state};
use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            let files = pdf_args(args);
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
            if !files.is_empty() {
                let _ = app.emit("open-files", files);
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            #[cfg(windows)]
            if let Some(window) = app.get_webview_window("main") {
                enable_touchpad_pinch(&window);
            }
            // The window starts hidden (tauri.conf.json): place it as it was
            // last left, then show it, before the frontend has even loaded.
            if let Some(window) = app.get_webview_window("main") {
                let saved = settings_path(app.handle())
                    .and_then(|p| load_from(&p))
                    .ok()
                    .flatten()
                    .and_then(|v| WindowState::from_settings(&v));
                commands::window::restore(&window, saved);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_)) {
                commands::window::track(window, &window.state::<LastPlacement>());
            }
        })
        .manage(LastPlacement::default())
        // Empty until an AI run starts; nothing AI-related runs at startup.
        .manage(ai::CliRuns::default())
        .manage(LaunchFiles(std::sync::Mutex::new(pdf_args(std::env::args().skip(1)))))
        .invoke_handler(tauri::generate_handler![
            open_pdf,
            get_launch_files,
            load_settings,
            save_settings,
            window_state,
            save_pdf,
            read_document,
            path_exists,
            merge_pdfs,
            export_without_annotations,
            write_recovery,
            list_recovery,
            read_recovery_image,
            delete_recovery,
            file_stamp,
            open_url,
            ai::ai_cli_info,
            ai::ai_cli_generate,
            ai::ai_cli_cancel,
            ai::ai_cli_models
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // A generation still running would outlive the app: stop its CLI
            // tree (it uses the user's plan) and remove its temp folder.
            // Nothing to do, and nothing done, when no run is live.
            if matches!(event, tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit)
                && app.state::<ai::CliRuns>().cancel_all() > 0
            {
                ai::run::remove_own_temp_dirs();
            }
        });
}

/// `zoomHotkeysEnabled: false` (no Ctrl+wheel / Ctrl+± zoom of the whole UI)
/// also turns off WebView2 pinch, which swallows touchpad pinch before the page
/// sees it. Turn pinch back on: the page then receives pinch as Ctrl+wheel,
/// the viewer zooms the document, and `guardPageZoom` cancels it elsewhere.
/// This also enables touchscreen pinch, which the frontend turns off with
/// `touch-action` (base.css) and handles in the viewer.
#[cfg(windows)]
fn enable_touchpad_pinch(window: &tauri::WebviewWindow) {
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings5;
    use windows::core::Interface;

    let result = window.with_webview(|webview| {
        // SAFETY: COM calls on the WebView2 controller, on the thread Tauri runs this closure on.
        let enabled = unsafe {
            webview
                .controller()
                .CoreWebView2()
                .and_then(|core| core.Settings())
                .and_then(|settings| settings.cast::<ICoreWebView2Settings5>())
                .and_then(|settings| settings.SetIsPinchZoomEnabled(true))
        };
        if let Err(e) = enabled {
            eprintln!("Could not enable touchpad pinch zoom: {e}");
        }
    });
    if let Err(e) = result {
        eprintln!("Could not access the webview to enable pinch zoom: {e}");
    }
}
