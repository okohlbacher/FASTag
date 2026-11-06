mod browser;
mod close_guard;
mod fastag;
mod history;
mod outputs;
mod report;
mod settings;
mod species;

use std::time::Duration;

use fastag::RunManager;
use tauri::{Manager, RunEvent, WindowEvent};

/// The argv a run request becomes (fastag.rs build_args), for the GUI's
/// end-to-end CLI tests. Not used by the app.
#[doc(hidden)]
pub use fastag::build_args_json;

/// The menu id of the app's own Quit item (macOS).
#[cfg(target_os = "macos")]
const QUIT_ID: &str = "fastag-quit";

/// Tauri's default macOS menu (tauri menu.rs Menu::default) with one change:
/// Quit is an item of the app's own, whose handler calls AppHandle::exit. The
/// predefined Quit sends terminate:, which reaches the app only as
/// RunEvent::Exit and cannot be prevented, so Cmd+Q bypassed the close guard.
#[cfg(target_os = "macos")]
fn macos_menu<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<tauri::menu::Menu<R>> {
    use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};
    let pkg = app.package_info();
    let about = AboutMetadata {
        name: Some(pkg.name.clone()),
        version: Some(pkg.version.to_string()),
        copyright: app.config().bundle.copyright.clone(),
        authors: app.config().bundle.publisher.clone().map(|p| vec![p]),
        ..Default::default()
    };
    let quit = MenuItem::with_id(app, QUIT_ID, format!("Quit {}", pkg.name), true, Some("CmdOrCtrl+Q"))?;
    Menu::with_items(
        app,
        &[
            &Submenu::with_items(
                app,
                pkg.name.clone(),
                true,
                &[
                    &PredefinedMenuItem::about(app, None, Some(about))?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::services(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::hide(app, None)?,
                    &PredefinedMenuItem::hide_others(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &quit,
                ],
            )?,
            &Submenu::with_items(app, "File", true, &[&PredefinedMenuItem::close_window(app, None)?])?,
            &Submenu::with_items(
                app,
                "Edit",
                true,
                &[
                    &PredefinedMenuItem::undo(app, None)?,
                    &PredefinedMenuItem::redo(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::cut(app, None)?,
                    &PredefinedMenuItem::copy(app, None)?,
                    &PredefinedMenuItem::paste(app, None)?,
                    &PredefinedMenuItem::select_all(app, None)?,
                ],
            )?,
            &Submenu::with_items(app, "View", true, &[&PredefinedMenuItem::fullscreen(app, None)?])?,
            &Submenu::with_items(
                app,
                "Window",
                true,
                &[
                    &PredefinedMenuItem::minimize(app, None)?,
                    &PredefinedMenuItem::maximize(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::close_window(app, None)?,
                ],
            )?,
        ],
    )
}

pub fn run() {
    let builder = tauri::Builder::default()
        // single-instance must be registered first: a second launch focuses the
        // existing window instead of racing over the settings file and run state.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init());
    #[cfg(target_os = "macos")]
    let builder = builder.menu(macos_menu).on_menu_event(|app, event| {
        // AppHandle::exit raises RunEvent::ExitRequested, which the close
        // guard can prevent while a run is active.
        if event.id().as_ref() == QUIT_ID {
            app.exit(0);
        }
    });
    builder
        .manage(RunManager::default())
        .manage(browser::BrowserCache::default())
        .invoke_handler(tauri::generate_handler![
            fastag::probe,
            fastag::run,
            fastag::cancel,
            fastag::outputs_check,
            history::history_list,
            history::history_of,
            close_guard::set_ui_busy,
            close_guard::close_answer,
            browser::results_query,
            browser::results_export,
            species::species,
            report::report_text,
            species::taxdb_info,
            settings::load_settings,
            settings::save_last,
            settings::save_preset,
            settings::delete_preset,
        ])
        .on_window_event(|window, event| match event {
            // Closing the window while a run or batch is active asks first
            // (close_guard); when idle it closes as usual.
            WindowEvent::CloseRequested { api, .. } => {
                let app = window.app_handle();
                close_guard::on_close_requested(
                    &app.state::<RunManager>(),
                    || api.prevent_close(),
                    || close_guard::ask(app, "close"),
                );
            }
            // Closing the window must not orphan a running CLI process.
            WindowEvent::Destroyed => fastag::kill_current(window.app_handle()),
            _ => {}
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| match event {
            // The app's Quit item (Cmd+Q), the last window closing, exit().
            RunEvent::ExitRequested { api, .. } => {
                close_guard::on_exit_requested(
                    &app.state::<RunManager>(),
                    || api.prevent_exit(),
                    || close_guard::ask(app, "quit"),
                );
            }
            // The last resort, for quits nothing can prevent (the Dock's
            // Quit, logout): without the kill the CLI outlived the app and
            // died of SIGPIPE later, leaving truncated outputs. Waiting for
            // the coordinator lets it remove them first.
            RunEvent::Exit => {
                fastag::kill_current(app);
                let _ = app.state::<RunManager>().wait_idle(Duration::from_secs(3));
            }
            _ => {}
        });
}
