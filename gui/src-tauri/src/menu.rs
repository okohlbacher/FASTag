// Native menus and accelerators (GUI-DESIGN 2 "Native menus"; P0b minimal
// set, full in P2a PR s): File, Run, View and Help, with CmdOrCtrl shortcuts
// (Cmd on macOS, Ctrl on Windows and Linux). An item does nothing here: it
// emits its action on MENU_EVENT and the renderer runs it, exactly as its own
// keyboard handler does for the same keys inside the webview (the renderer
// drops the second of two identical actions within a few hundred ms, so a
// key that reaches both still acts once). Quit and Close are the backend's:
// both go through the close guard (lib.rs).
//
//   File: Open spectra… Cmd+O; Open results… Cmd+Shift+O; Export shown
//         rows… Cmd+E; Reveal outputs; Close Cmd+W (and Quit off macOS)
//   Run:  Run Cmd+Enter; Cancel Cmd+. (Esc in the webview)
//   View: Setup, Results, Batch, History Cmd+1..4; Search parameters Cmd+K;
//         Theme: System, Light, Dark
//   Help: Help Cmd+? (F1 in the webview), FAQ, About

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Runtime};

/// The event the renderer listens to; the payload is the action name.
pub const MENU_EVENT: &str = "fastag:menu";

/// The id of the app's own Quit item: its handler calls AppHandle::exit,
/// which the close guard can prevent (lib.rs).
pub const QUIT_ID: &str = "fastag-quit";

/// The id of the app's own Close item: it asks the window to close, which
/// raises CloseRequested and so reaches the close guard (the predefined
/// Close Window item does not exist on Linux).
pub const CLOSE_ID: &str = "fastag-close";

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

/// The four views (Cmd+1..4).
pub const VIEWS: &[Item] = &[
    Item { id: "view-setup", label: "Setup", accel: Some("CmdOrCtrl+1") },
    Item { id: "view-results", label: "Results", accel: Some("CmdOrCtrl+2") },
    Item { id: "view-batch", label: "Batch", accel: Some("CmdOrCtrl+3") },
    Item { id: "view-history", label: "History", accel: Some("CmdOrCtrl+4") },
];

pub const SEARCH: &[Item] = &[Item { id: "search-params", label: "Search Parameters…", accel: Some("CmdOrCtrl+K") }];

pub const THEMES: &[Item] = &[
    Item { id: "theme-system", label: "System", accel: None },
    Item { id: "theme-light", label: "Light", accel: None },
    Item { id: "theme-dark", label: "Dark", accel: None },
];

pub const HELP: &[Item] = &[
    // Cmd+? is Cmd+Shift+/ on a US layout.
    Item { id: "help", label: "FASTag Help", accel: Some("CmdOrCtrl+Shift+Slash") },
    Item { id: "faq", label: "FAQ and Troubleshooting", accel: None },
    Item { id: "about", label: "About FASTag", accel: None },
];

/// Every item of ours, in menu order.
pub fn all() -> impl Iterator<Item = &'static Item> {
    FILE.iter().chain(RUN).chain(VIEWS).chain(SEARCH).chain(THEMES).chain(HELP)
}

/// The renderer action of menu item @p id, if it is one of ours.
pub fn action_of(id: &str) -> Option<&'static str> {
    all().find(|i| i.id == id).map(|i| i.id)
}

/// What a click on menu item @p id does.
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum Dispatch {
    /// AppHandle::exit, which the close guard can prevent.
    Quit,
    /// Ask the main window to close (CloseRequested, the close guard).
    Close,
    /// Emit the action on MENU_EVENT for the renderer.
    Emit(&'static str),
    /// A predefined item (Copy, Hide, ...) or no item of ours.
    Ignore,
}

pub fn dispatch(id: &str) -> Dispatch {
    match id {
        QUIT_ID => Dispatch::Quit,
        CLOSE_ID => Dispatch::Close,
        _ => action_of(id).map_or(Dispatch::Ignore, Dispatch::Emit),
    }
}

/// The on_menu_event handler of lib.rs: @p quit, @p close and @p emit are
/// AppHandle::exit, the main window's close and AppHandle::emit.
pub fn on_menu_event(id: &str, quit: impl FnOnce(), close: impl FnOnce(), emit: impl FnOnce(&'static str)) -> Dispatch {
    let d = dispatch(id);
    match d {
        Dispatch::Quit => quit(),
        Dispatch::Close => close(),
        Dispatch::Emit(a) => emit(a),
        Dispatch::Ignore => {}
    }
    d
}

type Entry<R> = Box<dyn tauri::menu::IsMenuItem<R>>;

/// The items of @p list, as menu entries.
fn group<R: Runtime>(app: &AppHandle<R>, list: &[Item]) -> tauri::Result<Vec<Entry<R>>> {
    list.iter()
        .map(|i| MenuItem::with_id(app, i.id, i.label, true, i.accel).map(|m| Box::new(m) as Entry<R>))
        .collect()
}

fn sep<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Entry<R>> {
    Ok(Box::new(PredefinedMenuItem::separator(app)?))
}

fn submenu<R: Runtime>(app: &AppHandle<R>, title: &str, entries: Vec<Entry<R>>) -> tauri::Result<Submenu<R>> {
    let refs: Vec<&dyn tauri::menu::IsMenuItem<R>> = entries.iter().map(|b| b.as_ref()).collect();
    Submenu::with_items(app, title, true, &refs)
}

fn file_menu<R: Runtime>(app: &AppHandle<R>, quit: Option<Entry<R>>) -> tauri::Result<Submenu<R>> {
    let mut e = group(app, FILE)?;
    e.push(sep(app)?);
    e.push(Box::new(MenuItem::with_id(app, CLOSE_ID, "Close Window", true, Some("CmdOrCtrl+W"))?));
    if let Some(q) = quit {
        e.push(q);
    }
    submenu(app, "File", e)
}

fn view_menu<R: Runtime>(app: &AppHandle<R>, extra: Vec<Entry<R>>) -> tauri::Result<Submenu<R>> {
    let mut e = group(app, VIEWS)?;
    e.push(sep(app)?);
    e.extend(group(app, SEARCH)?);
    e.push(sep(app)?);
    let themes = group(app, THEMES)?;
    let refs: Vec<&dyn tauri::menu::IsMenuItem<R>> = themes.iter().map(|b| b.as_ref()).collect();
    e.push(Box::new(Submenu::with_items(app, "Theme", true, &refs)?));
    if !extra.is_empty() {
        e.push(sep(app)?);
        e.extend(extra);
    }
    submenu(app, "View", e)
}

/// The menu bar. On macOS: Tauri's default menu (tauri menu.rs
/// Menu::default) with the app's own Quit (Cmd+Q must reach the close guard;
/// the predefined Quit sends terminate:, which cannot be prevented) and the
/// File, Run, View and Help menus of the app. On Windows and Linux: File
/// (with Quit), Run, View and Help.
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
                &file_menu(app, None)?,
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
                &submenu(app, "Run", group(app, RUN)?)?,
                &view_menu(app, vec![Box::new(PredefinedMenuItem::fullscreen(app, None)?)])?,
                &Submenu::with_items(
                    app,
                    "Window",
                    true,
                    &[&PredefinedMenuItem::minimize(app, None)?, &PredefinedMenuItem::maximize(app, None)?],
                )?,
                &submenu(app, "Help", group(app, HELP)?)?,
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
                &file_menu(app, Some(Box::new(quit)))?,
                &submenu(app, "Run", group(app, RUN)?)?,
                &view_menu(app, vec![])?,
                &submenu(app, "Help", group(app, HELP)?)?,
            ],
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn accel(id: &str) -> Option<&'static str> {
        all().find(|i| i.id == id).and_then(|i| i.accel)
    }

    #[test]
    fn every_item_is_an_action_with_the_p0b_shortcuts() {
        assert_eq!(accel("open-spectra"), Some("CmdOrCtrl+O"));
        assert_eq!(accel("run"), Some("CmdOrCtrl+Enter"));
        assert_eq!(accel("cancel"), Some("CmdOrCtrl+Period"));
        assert_eq!(accel("export"), Some("CmdOrCtrl+E"));
        assert_eq!(accel("help"), Some("CmdOrCtrl+Shift+Slash"));
        assert_eq!(accel("search-params"), Some("CmdOrCtrl+K"));
        for i in all() {
            assert_eq!(action_of(i.id), Some(i.id));
        }
        assert_eq!(action_of(QUIT_ID), None);
        assert_eq!(action_of(CLOSE_ID), None);
        assert_eq!(action_of("nope"), None);
        // No two items share a shortcut, and none takes Close's or Quit's.
        let mut keys: Vec<&str> = all().filter_map(|i| i.accel).chain(["CmdOrCtrl+W", "CmdOrCtrl+Q"]).collect();
        keys.sort();
        let n = keys.len();
        keys.dedup();
        assert_eq!(keys.len(), n);
    }

    // GUI-DESIGN 2 "Native menus": the full set of P2a.
    #[test]
    fn the_full_menus_of_the_design() {
        let ids = |l: &[Item]| l.iter().map(|i| i.id).collect::<Vec<_>>();
        assert_eq!(ids(FILE), ["open-spectra", "open-results", "export", "reveal"]);
        assert_eq!(ids(RUN), ["run", "cancel"]);
        assert_eq!(ids(VIEWS), ["view-setup", "view-results", "view-batch", "view-history"]);
        assert_eq!(ids(SEARCH), ["search-params"]);
        assert_eq!(ids(THEMES), ["theme-system", "theme-light", "theme-dark"]);
        assert_eq!(ids(HELP), ["help", "faq", "about"]);
        assert_eq!(accel("open-results"), Some("CmdOrCtrl+Shift+O"));
        for (i, v) in VIEWS.iter().enumerate() {
            assert_eq!(v.accel, Some(["CmdOrCtrl+1", "CmdOrCtrl+2", "CmdOrCtrl+3", "CmdOrCtrl+4"][i]));
        }
        let labels: Vec<&str> = VIEWS.iter().map(|i| i.label).collect();
        assert_eq!(labels, ["Setup", "Results", "Batch", "History"]);
    }

    #[test]
    fn accelerators_parse() {
        // The strings muda parses when the menu is built.
        for a in all().filter_map(|i| i.accel).chain(["CmdOrCtrl+W", "CmdOrCtrl+Q"]) {
            a.parse::<muda::accelerator::Accelerator>().unwrap_or_else(|e| panic!("{a}: {e}"));
        }
    }

    // The on_menu_event handler, driven with every id a click can deliver
    // (a native menu click cannot be driven in CI).
    #[test]
    fn menu_events_dispatch() {
        for i in all() {
            let (mut q, mut c, mut emitted) = (0, 0, Vec::new());
            let d = on_menu_event(i.id, || q += 1, || c += 1, |a| emitted.push(a));
            assert_eq!(d, Dispatch::Emit(i.id));
            assert_eq!((q, c), (0, 0), "{}: emits only", i.id);
            assert_eq!(emitted, vec![i.id]);
        }
        let (mut q, mut c, mut emitted) = (0, 0, Vec::<&str>::new());
        assert_eq!(on_menu_event(QUIT_ID, || q += 1, || c += 1, |a| emitted.push(a)), Dispatch::Quit);
        assert_eq!(on_menu_event(CLOSE_ID, || q += 1, || c += 1, |a| emitted.push(a)), Dispatch::Close);
        // A predefined item (its id is muda's own) and a stray id do nothing.
        assert_eq!(on_menu_event("copy", || q += 1, || c += 1, |a| emitted.push(a)), Dispatch::Ignore);
        assert_eq!(on_menu_event("", || q += 1, || c += 1, |a| emitted.push(a)), Dispatch::Ignore);
        assert_eq!((q, c), (1, 1));
        assert!(emitted.is_empty());
    }
}
