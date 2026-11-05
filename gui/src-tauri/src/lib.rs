mod browser;
mod fastag;
mod report;
mod settings;
mod species;

use fastag::RunManager;
use tauri::{Manager, RunEvent, WindowEvent};

/// The argv a run request becomes (fastag.rs build_args), for the GUI's
/// end-to-end CLI tests. Not used by the app.
#[doc(hidden)]
pub use fastag::build_args_json;

pub fn run() {
    tauri::Builder::default()
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
        .manage(RunManager::default())
        .manage(browser::BrowserCache::default())
        .invoke_handler(tauri::generate_handler![
            fastag::probe,
            fastag::run,
            fastag::cancel,
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
        .on_window_event(|window, event| {
            // Closing the window must not orphan a running CLI process.
            if let WindowEvent::Destroyed = event {
                fastag::kill_current(window.app_handle());
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // Cmd+Q (applicationWillTerminate) fires no window Destroyed event:
            // without this the CLI outlived the app and died of SIGPIPE later,
            // leaving truncated outputs.
            if let RunEvent::Exit = event {
                fastag::kill_current(app);
            }
        });
}
