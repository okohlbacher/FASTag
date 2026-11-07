#[doc(hidden)]
pub mod browser;
mod close_guard;
mod drop;
mod events;
mod fastag;
mod history;
mod lifetime;
mod menu;
mod notify;
mod outputs;
mod progress;
mod report;
mod reveal;
mod settings;
mod species;
mod sweep;

use std::time::Duration;

use fastag::RunManager;
use tauri::{Emitter, Manager, RunEvent, WindowEvent};

/// The argv a run request becomes (fastag.rs build_args), for the GUI's
/// end-to-end CLI tests. Not used by the app.
#[doc(hidden)]
pub use fastag::build_args_json;

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
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init());
    // File, Run, View and Help with their shortcuts on every platform (menu.rs).
    let builder = builder.menu(menu::build).on_menu_event(|app, event| {
        menu::on_menu_event(
            event.id().as_ref(),
            // AppHandle::exit raises RunEvent::ExitRequested, which the close
            // guard can prevent while a run is active.
            || app.exit(0),
            // close() raises CloseRequested: the close guard again.
            || {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.close();
                }
            },
            |action| {
                let _ = app.emit(menu::MENU_EVENT, action);
            },
        );
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
            reveal::reveal_output,
            close_guard::set_ui_busy,
            close_guard::close_answer,
            notify::notify_finished,
            browser::results_open,
            browser::results_query,
            browser::results_position,
            browser::results_export,
            species::species,
            report::report_text,
            species::taxdb_info,
            settings::load_settings,
            settings::save_last,
            settings::save_preset,
            settings::delete_preset,
            sweep::leftovers_list,
            sweep::leftovers_sweep,
            sweep::leftovers_keep,
        ])
        // A run of an earlier session that the app did not see end (it was
        // killed) is recorded as interrupted before the window asks for the
        // last run and the leftovers (sweep.rs).
        .setup(|app| {
            if let Some(d) = history::dir(app.handle()) {
                sweep::recover(&d);
            }
            Ok(())
        })
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
            // An OS file drop anywhere on the window: routed by type (drop.rs).
            WindowEvent::DragDrop(ev) => drop::on_drag_drop(
                ev,
                |over| {
                    let _ = window.emit(drop::HOVER_EVENT, over);
                },
                |route| {
                    let _ = window.emit(drop::DROP_EVENT, route);
                },
            ),
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
