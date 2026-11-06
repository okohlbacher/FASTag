// Native menus and accelerators (GUI-DESIGN 2 "Native menus", P0b minimal
// set): File, Run and Help, with CmdOrCtrl shortcuts (Cmd on macOS, Ctrl on
// Windows and Linux). An item does nothing here: it emits its action on
// MENU_EVENT and the renderer runs it, exactly as its own keyboard handler
// does for the same keys inside the webview (the renderer drops the second
// of two identical actions within a few hundred ms, so a key that reaches
// both still acts once).

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Runtime};

/// The event the renderer listens to; the payload is the action name.
pub const MENU_EVENT: &str = "fastag:menu";

/// The id of the app's own Quit item: its handler calls AppHandle::exit,
/// which the close guard can prevent (lib.rs).
pub const QUIT_ID: &str = "fastag-quit";

/// One menu item: (id = the action the renderer runs, label, accelerator).
pub struct Item {
    pub id: &'static str,
    pub label: &'static str,
    pub accel: Option<&'static str>,
}

pub const FILE: &[Item] = &[
    Item { id: "open-spectra", label: "Open Spectra…", accel: Some("CmdOrCtrl+O") },
    Item { id: "open-results", label: "Open Results…", accel: Some("CmdOrCtrl+Shift+O") },
    Item { id: "export", label: "Export Shown Rows…", accel: Some("CmdOrCtrl+E") },
    Item { id: "reveal", label: "Reveal Outputs", accel: None },
];

pub const RUN: &[Item] = &[
    Item { id: "run", label: "Run", accel: Some("CmdOrCtrl+Enter") },
    Item { id: "cancel", label: "Cancel Run", accel: Some("CmdOrCtrl+Period") },
];

pub const HELP: &[Item] = &[
    // Cmd+? is Cmd+Shift+/ on a US layout.
    Item { id: "help", label: "FASTag Help", accel: Some("CmdOrCtrl+Shift+Slash") },
    Item { id: "search-params", label: "Search Parameters…", accel: Some("CmdOrCtrl+K") },
];

/// The renderer action of menu item @p id, if it is one of ours.
pub fn action_of(id: &str) -> Option<&'static str> {
    FILE.iter().chain(RUN).chain(HELP).find(|i| i.id == id).map(|i| i.id)
}

fn items<R: Runtime>(app: &AppHandle<R>, list: &[Item]) -> tauri::Result<Vec<MenuItem<R>>> {
    list.iter().map(|i| MenuItem::with_id(app, i.id, i.label, true, i.accel)).collect()
}

fn submenu<R: Runtime>(
    app: &AppHandle<R>,
    title: &str,
    list: &[Item],
    extra: Vec<Box<dyn tauri::menu::IsMenuItem<R>>>,
) -> tauri::Result<Submenu<R>> {
    let own = items(app, list)?;
    let mut refs: Vec<&dyn tauri::menu::IsMenuItem<R>> = own.iter().map(|m| m as &dyn tauri::menu::IsMenuItem<R>).collect();
    refs.extend(extra.iter().map(|b| b.as_ref()));
    Submenu::with_items(app, title, true, &refs)
}

/// The menu bar. On macOS: Tauri's default menu (tauri menu.rs
/// Menu::default) with the app's own Quit (Cmd+Q must reach the close guard;
/// the predefined Quit sends terminate:, which cannot be prevented) and the
/// File, Run and Help menus of the app. On Windows and Linux: File (with
/// Quit), Run and Help.
pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let pkg = app.package_info();
    #[cfg(target_os = "macos")]
    {
        use tauri::menu::AboutMetadata;
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
                &submenu(
                    app,
                    "File",
                    FILE,
                    vec![
                        Box::new(PredefinedMenuItem::separator(app)?),
                        Box::new(PredefinedMenuItem::close_window(app, None)?),
                    ],
                )?,
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
                &submenu(app, "Run", RUN, vec![])?,
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
                &submenu(app, "Help", HELP, vec![])?,
            ],
        )
    }
    #[cfg(not(target_os = "macos"))]
    {
        let quit = MenuItem::with_id(app, QUIT_ID, "Quit", true, Some("CmdOrCtrl+Q"))?;
        let _ = &pkg;
        Menu::with_items(
            app,
            &[
                &submenu(app, "File", FILE, vec![Box::new(PredefinedMenuItem::separator(app)?), Box::new(quit)])?,
                &submenu(app, "Run", RUN, vec![])?,
                &submenu(app, "Help", HELP, vec![])?,
            ],
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_item_is_an_action_with_the_p0b_shortcuts() {
        let accel = |id: &str| FILE.iter().chain(RUN).chain(HELP).find(|i| i.id == id).and_then(|i| i.accel);
        assert_eq!(accel("open-spectra"), Some("CmdOrCtrl+O"));
        assert_eq!(accel("run"), Some("CmdOrCtrl+Enter"));
        assert_eq!(accel("cancel"), Some("CmdOrCtrl+Period"));
        assert_eq!(accel("export"), Some("CmdOrCtrl+E"));
        assert_eq!(accel("help"), Some("CmdOrCtrl+Shift+Slash"));
        assert_eq!(accel("search-params"), Some("CmdOrCtrl+K"));
        for i in FILE.iter().chain(RUN).chain(HELP) {
            assert_eq!(action_of(i.id), Some(i.id));
        }
        assert_eq!(action_of(QUIT_ID), None);
        assert_eq!(action_of("nope"), None);
        // No two items share a shortcut.
        let mut keys: Vec<&str> = FILE.iter().chain(RUN).chain(HELP).filter_map(|i| i.accel).collect();
        keys.sort();
        let n = keys.len();
        keys.dedup();
        assert_eq!(keys.len(), n);
    }

    #[test]
    fn accelerators_parse() {
        // The strings muda parses when the menu is built.
        for i in FILE.iter().chain(RUN).chain(HELP) {
            if let Some(a) = i.accel {
                a.parse::<muda::accelerator::Accelerator>()
                    .unwrap_or_else(|e| panic!("{}: {a}: {e}", i.id));
            }
        }
    }
}
