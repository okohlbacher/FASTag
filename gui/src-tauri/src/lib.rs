#[doc(hidden)]
pub mod browser;
mod close_guard;
pub mod denovo;
mod drop;
mod events;
mod examples;
mod fasta;
mod fastag;
mod feedback;
mod feedback_capture;
mod history;
mod ini;
mod inspect;
mod lifetime;
mod menu;
mod notify;
mod outputs;
mod progress;
mod report;
mod reveal;
mod sdrf;
mod settings;
mod species;
mod spectrum;
mod sweep;
#[cfg_attr(not(windows), allow(dead_code))]
mod webview_args;

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
        .plugin(tauri_plugin_notification::init())
        // The settings file (settings.rs): presets and the last-used offer.
        .plugin(tauri_plugin_store::Builder::new().build());
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
            // The Linux Edit items (menu.rs EditEntry::Ours): WebKitGTK's
            // own editing command on the focused field of the main webview.
            // No other platform has these ids.
            |cmd| {
                #[cfg(target_os = "linux")]
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.with_webview(move |pw| {
                        use webkit2gtk::WebViewExt;
                        pw.inner().execute_editing_command(cmd);
                    });
                }
                #[cfg(not(target_os = "linux"))]
                let _ = cmd;
            },
        );
    });
    builder
        // ONE setup hook: Builder::setup replaces an earlier one, so a
        // second .setup() call silently dropped this one (the v1 settings
        // migration and the installed-app self-test never ran).
        .setup(|app| {
            // Migrates a v1 settings file before the store first opens.
            settings::init(app.handle());
            // A run of an earlier session that the app did not see end (it
            // was killed) is recorded as interrupted before the window asks
            // for the last run and the leftovers (sweep.rs).
            if let Some(d) = history::dir(app.handle()) {
                // 1.13.3 and earlier kept the run data in app_data_dir
                // (Roaming on Windows): moved once (sweep::migrate).
                if let Some(old) = history::old_dir(app.handle()) {
                    sweep::migrate(&old, &d);
                }
                sweep::recover(&d);
            }
            // The main window, from its tauri.conf.json entry ("create":
            // false there): on Windows with the WebView2 arguments of
            // WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS merged in, which WebView2
            // would otherwise drop (webview_args.rs; WebDriver needs them).
            let cfg = app
                .config()
                .app
                .windows
                .iter()
                .find(|w| w.label == "main")
                .cloned()
                .ok_or("tauri.conf.json has no main window")?;
            #[allow(unused_mut)]
            let mut window = tauri::WebviewWindowBuilder::from_config(app.handle(), &cfg)?;
            #[cfg(windows)]
            if let Some(args) = webview_args::merged(std::env::var(webview_args::ENV).ok().as_deref()) {
                window = window.additional_browser_args(&args);
            }
            window.build()?;
            #[cfg(debug_assertions)]
            if let Some(out) = std::env::var_os(feedback_capture::SELFTEST) {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    let code = feedback_capture::self_test(&handle, std::path::Path::new(&out));
                    handle.exit(code);
                });
            }
            if let Some(out) = std::env::var_os(fastag::SELFTEST_OUT) {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    let code = fastag::self_test(&handle, std::path::Path::new(&out));
                    handle.exit(code);
                });
            }
            Ok(())
        })
        .manage(RunManager::default())
        .manage(browser::BrowserCache::default())
        .manage(browser::SideTables::default())
        .manage(spectrum::SpectrumCache::default())
        .manage(fasta::FastaCache::default())
        .invoke_handler(tauri::generate_handler![
            fastag::probe,
            examples::example_input,
            inspect::cli_capabilities,
            inspect::probe_input,
            fastag::run,
            fastag::cancel,
            fastag::outputs_check,
            fastag::command_line,
            ini::export_ini,
            history::history_list,
            history::history_of,
            history::history_delete,
            history::history_rerun,
            reveal::reveal_output,
            close_guard::set_ui_busy,
            close_guard::close_answer,
            notify::notify_finished,
            browser::results_open,
            browser::results_query,
            browser::results_position,
            browser::results_export,
            browser::results_cancel,
            browser::table_query,
            report::report_text,
            report::report_head,
            report::summary_write,
            sdrf::sdrf_read,
            sdrf::taxonomy_dump,
            denovo::denovo_export,
            drop::folder_spectra_list,
            drop::path_status,
            species::taxdb_info,
            species::taxonomy_status,
            spectrum::spectrum_support,
            spectrum::spectrum_peaks,
            fasta::fasta_segment,
            settings::load_settings,
            settings::save_last,
            settings::save_preset,
            settings::delete_preset,
            sweep::leftovers_list,
            sweep::leftovers_sweep,
            sweep::leftovers_keep,
            feedback_capture::feedback_capture,
            feedback_capture::feedback_platform,
            feedback_capture::feedback_run,
            feedback::feedback_save,
            feedback::feedback_list,
            feedback::feedback_delete,
            feedback::feedback_delete_all,
            feedback::feedback_reveal,
            feedback::feedback_export,
            feedback::feedback_set_status,
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

#[cfg(test)]
mod command_acl_tests {
    include!("app_commands.rs");

    fn handler_commands() -> Vec<String> {
        let src = include_str!("lib.rs");
        let start = src.find("generate_handler![").expect("generate_handler!");
        let body = &src[start..src[start..].find("])").unwrap() + start];
        body.lines().filter_map(|l| l.trim().strip_suffix(',')).filter_map(|l| l.rsplit("::").next()).map(str::to_string).collect()
    }

    fn granted(file: &str) -> Vec<serde_json::Value> {
        let v: serde_json::Value = serde_json::from_str(file).unwrap();
        v["permissions"].as_array().unwrap().clone()
    }

    /// Every command is registered, has a permission and is granted, once.
    #[test]
    fn commands_manifest_and_capabilities_agree() {
        let listed: Vec<String> = APP_COMMANDS.iter().map(|s| s.to_string()).collect();
        assert_eq!(handler_commands(), listed, "lib.rs generate_handler! vs src/app_commands.rs");
        let mut perms: Vec<String> = granted(include_str!("../capabilities/default.json"))
            .into_iter()
            .chain(granted(include_str!("../capabilities/feedback.json")))
            .filter_map(|p| p.as_str().and_then(|s| s.strip_prefix("allow-")).map(|s| s.replace('-', "_")))
            .collect();
        perms.sort();
        let mut want = listed.clone();
        want.sort();
        assert_eq!(perms, want, "capabilities grant exactly the app's commands");
    }

    /// The feedback capability opens one URL pattern: the issue form.
    #[test]
    fn the_feedback_opener_is_scoped_to_the_issue_form() {
        let fb = granted(include_str!("../capabilities/feedback.json"));
        let opener: Vec<&serde_json::Value> = fb.iter().filter(|p| p.get("identifier").is_some()).collect();
        assert_eq!(opener.len(), 1);
        assert_eq!(opener[0]["identifier"], "opener:allow-open-url");
        assert_eq!(opener[0]["allow"], serde_json::json!([{ "url": "https://github.com/okohlbacher/FASTag/issues/new*" }]));
        for p in fb.iter().filter_map(|p| p.as_str()) {
            assert!(p.starts_with("allow-feedback-"), "{p}");
        }
    }
}
