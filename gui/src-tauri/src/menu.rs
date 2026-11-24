// Native menus and accelerators (GUI-DESIGN 2 "Native menus"; P0b minimal
// set, full in P2a PR s): File, Run, View and Help, with CmdOrCtrl shortcuts
// (Cmd on macOS, Ctrl on Windows and Linux). An item does nothing here: it
// emits its action on MENU_EVENT and the renderer runs it, exactly as its own
// keyboard handler does for the same keys inside the webview (the renderer
// drops the second of two identical actions within a few hundred ms, so a
// key that reaches both still acts once). Quit and Close are the backend's:
// both go through the close guard (lib.rs).
//
//   File: Open spectra… Cmd+O; Open results… Cmd+Shift+O; Open example
//         data (examples.rs); Export shown rows… Cmd+E; Reveal outputs;
//         Close Cmd+W (and Quit off macOS)
//   Run:  Run Cmd+Enter; Cancel Cmd+. (Esc in the webview)
//   View: Setup, Results, Batch, History Cmd+1..4; Search parameters Cmd+K;
//         Theme: System, Light, Dark
//   Edit: Undo, Redo (macOS only), Cut, Copy, Paste, Select All, which act
//         on the focused text field (every field of the app, the Feedback
//         form's included): the platform's own items on macOS and Windows; on
//         Linux items of ours that run WebKitGTK's editing command (below)
//   Help: Help Cmd+? (F1 in the webview), FAQ, Send Feedback… Cmd+Shift+F,
//         About

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
    Item { id: "open-example", label: "Open Example Data", accel: None },
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
    // In-app feedback (feedback.rs): the same capture path as the top
    // bar's Feedback button and the webview's own Cmd+Shift+F.
    Item { id: "feedback", label: "Send Feedback…", accel: Some("CmdOrCtrl+Shift+F") },
    Item { id: "about", label: "About FASTag", accel: None },
];

/// An item of the Edit menu. On macOS and Windows the platform's predefined
/// one (muda), whose click the system sends to the focused text field of the
/// webview. On Linux Cut, Copy, Paste and Select All are items of ours
/// (LINUX_EDIT_IS_OURS): muda's GTK ones only send the keys through libxdo,
/// a feature tauri leaves off, so a click did nothing (and xdo does not reach
/// a Wayland window); ours run the webview's editing command (Dispatch::Editing).
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum Edit {
    Undo,
    Redo,
    Separator,
    Cut,
    Copy,
    Paste,
    SelectAll,
}

impl Edit {
    /// The shortcut the platform gives the item (none of ours may take it).
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn accel(self) -> Option<&'static str> {
        match self {
            Edit::Undo => Some("CmdOrCtrl+Z"),
            Edit::Redo => Some("CmdOrCtrl+Shift+Z"),
            Edit::Separator => None,
            Edit::Cut => Some("CmdOrCtrl+X"),
            Edit::Copy => Some("CmdOrCtrl+C"),
            Edit::Paste => Some("CmdOrCtrl+V"),
            Edit::SelectAll => Some("CmdOrCtrl+A"),
        }
    }

    /// The id of the item of ours for this edit command (Linux), if any.
    pub fn id(self) -> Option<&'static str> {
        match self {
            Edit::Cut => Some(EDIT_CUT_ID),
            Edit::Copy => Some(EDIT_COPY_ID),
            Edit::Paste => Some(EDIT_PASTE_ID),
            Edit::SelectAll => Some(EDIT_SELECT_ALL_ID),
            Edit::Undo | Edit::Redo | Edit::Separator => None,
        }
    }

    /// The label of the item of ours (Linux): GTK's own wording.
    pub fn label(self) -> &'static str {
        match self {
            Edit::Undo => "Undo",
            Edit::Redo => "Redo",
            Edit::Separator => "",
            Edit::Cut => "Cut",
            Edit::Copy => "Copy",
            Edit::Paste => "Paste",
            Edit::SelectAll => "Select All",
        }
    }
}

/// The ids of the Linux Edit items of ours (Edit::id).
pub const EDIT_CUT_ID: &str = "edit.cut";
pub const EDIT_COPY_ID: &str = "edit.copy";
pub const EDIT_PASTE_ID: &str = "edit.paste";
pub const EDIT_SELECT_ALL_ID: &str = "edit.select_all";

/// The WebKit editing command (webkit_web_view_execute_editing_command;
/// WEBKIT_EDITING_COMMAND_CUT, _COPY, _PASTE, _SELECT_ALL) of Edit item @p id.
pub fn editing_command(id: &str) -> Option<&'static str> {
    match id {
        EDIT_CUT_ID => Some("Cut"),
        EDIT_COPY_ID => Some("Copy"),
        EDIT_PASTE_ID => Some("Paste"),
        EDIT_SELECT_ALL_ID => Some("SelectAll"),
        _ => None,
    }
}

/// Whether the Edit menu's Cut, Copy, Paste and Select All are items of ours
/// (Linux) rather than the platform's predefined ones.
pub const LINUX_EDIT_IS_OURS: bool = cfg!(target_os = "linux");

/// How an Edit menu entry is built.
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum EditEntry {
    /// muda's predefined item.
    Predefined(Edit),
    /// A MenuItem of ours: (id, label). It has no accelerator: a GTK
    /// accelerator is taken by the window before the webview sees the key,
    /// so Ctrl+C would no longer reach the Results table's own Ctrl+C (copy
    /// the row); the keys stay the webview's, as with the predefined items,
    /// whose GTK accelerator is a label only.
    Ours(&'static str, &'static str),
}

/// The entry of Edit item @p e when the items are ours (@p ours) or not.
pub fn edit_entry(e: Edit, ours: bool) -> EditEntry {
    match (ours, e.id()) {
        (true, Some(id)) => EditEntry::Ours(id, e.label()),
        _ => EditEntry::Predefined(e),
    }
}

/// The Edit menu on macOS.
pub const EDIT_MACOS: &[Edit] = &[Edit::Undo, Edit::Redo, Edit::Separator, Edit::Cut, Edit::Copy, Edit::Paste, Edit::SelectAll];
/// The Edit menu on Windows and Linux (report 20261121T143325Z_856491d9:
/// copy and paste had no menu there). Undo and Redo are left out: GTK has
/// no predefined ones, and the webview's Ctrl+Z still works in a field.
/// On Linux the four items are ours and run WebKitGTK's editing command on a
/// click (edit_entry); their shortcuts are the webview's own and work either way.
#[cfg_attr(target_os = "macos", allow(dead_code))]
pub const EDIT_OTHER: &[Edit] = &[Edit::Cut, Edit::Copy, Edit::Paste, Edit::Separator, Edit::SelectAll];

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
    /// Run this WebKit editing command on the main webview (the Linux Edit
    /// items of ours; editing_command).
    Editing(&'static str),
    /// A predefined item (Copy, Hide, ...) or no item of ours.
    Ignore,
}

pub fn dispatch(id: &str) -> Dispatch {
    match id {
        QUIT_ID => Dispatch::Quit,
        CLOSE_ID => Dispatch::Close,
        _ => match editing_command(id) {
            Some(c) => Dispatch::Editing(c),
            None => action_of(id).map_or(Dispatch::Ignore, Dispatch::Emit),
        },
    }
}

/// The on_menu_event handler of lib.rs: @p quit, @p close, @p emit and
/// @p edit are AppHandle::exit, the main window's close, AppHandle::emit and
/// the webview's execute_editing_command (Linux).
pub fn on_menu_event(
    id: &str,
    quit: impl FnOnce(),
    close: impl FnOnce(),
    emit: impl FnOnce(&'static str),
    edit: impl FnOnce(&'static str),
) -> Dispatch {
    let d = dispatch(id);
    match d {
        Dispatch::Quit => quit(),
        Dispatch::Close => close(),
        Dispatch::Emit(a) => emit(a),
        Dispatch::Editing(c) => edit(c),
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

fn edit_menu<R: Runtime>(app: &AppHandle<R>, items: &[Edit]) -> tauri::Result<Submenu<R>> {
    let e = items
        .iter()
        .map(|i| {
            Ok(match edit_entry(*i, LINUX_EDIT_IS_OURS) {
                EditEntry::Ours(id, label) => Box::new(MenuItem::with_id(app, id, label, true, None::<&str>)?) as Entry<R>,
                EditEntry::Predefined(e) => Box::new(match e {
                    Edit::Undo => PredefinedMenuItem::undo(app, None)?,
                    Edit::Redo => PredefinedMenuItem::redo(app, None)?,
                    Edit::Separator => PredefinedMenuItem::separator(app)?,
                    Edit::Cut => PredefinedMenuItem::cut(app, None)?,
                    Edit::Copy => PredefinedMenuItem::copy(app, None)?,
                    Edit::Paste => PredefinedMenuItem::paste(app, None)?,
                    Edit::SelectAll => PredefinedMenuItem::select_all(app, None)?,
                }) as Entry<R>,
            })
        })
        .collect::<tauri::Result<Vec<_>>>()?;
    submenu(app, "Edit", e)
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
/// File, Edit, Run, View and Help menus of the app. On Windows and Linux:
/// File (with Quit), Edit, Run, View and Help.
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
            // RawFileReader distribution licence, section 3.2 (verbatim; the
            // Help > About dialog and the CLI's --version carry it too).
            credits: Some(
                "Thermo .raw input, in the builds that include it: RawFileReader reading tool. \
                 Copyright \u{a9} 2016 by Thermo Fisher Scientific, Inc. All rights reserved."
                    .to_string(),
            ),
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
                &edit_menu(app, EDIT_MACOS)?,
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
                &edit_menu(app, EDIT_OTHER)?,
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
        assert_eq!(ids(FILE), ["open-spectra", "open-results", "open-example", "export", "reveal"]);
        assert_eq!(ids(RUN), ["run", "cancel"]);
        assert_eq!(ids(VIEWS), ["view-setup", "view-results", "view-batch", "view-history"]);
        assert_eq!(ids(SEARCH), ["search-params"]);
        assert_eq!(ids(THEMES), ["theme-system", "theme-light", "theme-dark"]);
        assert_eq!(ids(HELP), ["help", "faq", "feedback", "about"]);
        assert_eq!(accel("feedback"), Some("CmdOrCtrl+Shift+F"));
        assert_eq!(accel("open-results"), Some("CmdOrCtrl+Shift+O"));
        for (i, v) in VIEWS.iter().enumerate() {
            assert_eq!(v.accel, Some(["CmdOrCtrl+1", "CmdOrCtrl+2", "CmdOrCtrl+3", "CmdOrCtrl+4"][i]));
        }
        let labels: Vec<&str> = VIEWS.iter().map(|i| i.label).collect();
        assert_eq!(labels, ["Setup", "Results", "Batch", "History"]);
    }

    // Every platform has an Edit menu with cut, copy, paste and select all
    // (report 20261121T143325Z_856491d9), and none of the app's shortcuts
    // takes theirs: Cmd/Ctrl+C, V, X and A stay the text field's.
    #[test]
    fn every_platform_has_an_edit_menu_whose_keys_stay_the_fields() {
        for list in [EDIT_MACOS, EDIT_OTHER] {
            for e in [Edit::Cut, Edit::Copy, Edit::Paste, Edit::SelectAll] {
                assert!(list.contains(&e), "{e:?}");
            }
        }
        let ours: Vec<&str> = all().filter_map(|i| i.accel).chain(["CmdOrCtrl+W", "CmdOrCtrl+Q"]).collect();
        for e in EDIT_MACOS.iter().chain(EDIT_OTHER) {
            if let Some(a) = e.accel() {
                assert!(!ours.contains(&a), "{a} is taken by an item of ours");
            }
        }
        assert_eq!(EDIT_OTHER.iter().filter_map(|e| e.accel()).collect::<Vec<_>>(), ["CmdOrCtrl+X", "CmdOrCtrl+C", "CmdOrCtrl+V", "CmdOrCtrl+A"]);
        // The predefined items' ids are muda's own: a click is not an action of ours.
        for id in ["cut", "copy", "paste", "select_all"] {
            assert_eq!(dispatch(id), Dispatch::Ignore);
        }
    }

    #[test]
    fn accelerators_parse() {
        // The strings muda parses when the menu is built.
        for a in all().filter_map(|i| i.accel).chain(["CmdOrCtrl+W", "CmdOrCtrl+Q"]).chain(EDIT_MACOS.iter().filter_map(|e| e.accel())) {
            a.parse::<muda::accelerator::Accelerator>().unwrap_or_else(|e| panic!("{a}: {e}"));
        }
    }

    // The on_menu_event handler, driven with every id a click can deliver
    // (a native menu click cannot be driven in CI).
    #[test]
    fn menu_events_dispatch() {
        for i in all() {
            let (mut q, mut c, mut emitted) = (0, 0, Vec::new());
            let d = on_menu_event(i.id, || q += 1, || c += 1, |a| emitted.push(a), |_| panic!("{}: not an edit", i.id));
            assert_eq!(d, Dispatch::Emit(i.id));
            assert_eq!((q, c), (0, 0), "{}: emits only", i.id);
            assert_eq!(emitted, vec![i.id]);
        }
        let (mut q, mut c, mut emitted) = (0, 0, Vec::<&str>::new());
        assert_eq!(on_menu_event(QUIT_ID, || q += 1, || c += 1, |a| emitted.push(a), |_| panic!("not an edit")), Dispatch::Quit);
        assert_eq!(on_menu_event(CLOSE_ID, || q += 1, || c += 1, |a| emitted.push(a), |_| panic!("not an edit")), Dispatch::Close);
        // A predefined item (its id is muda's own) and a stray id do nothing.
        assert_eq!(on_menu_event("copy", || q += 1, || c += 1, |a| emitted.push(a), |_| panic!("not an edit")), Dispatch::Ignore);
        assert_eq!(on_menu_event("", || q += 1, || c += 1, |a| emitted.push(a), |_| panic!("not an edit")), Dispatch::Ignore);
        assert_eq!((q, c), (1, 1));
        assert!(emitted.is_empty());
    }

    // Finding #12: muda's GTK Cut, Copy, Paste and Select All did nothing on
    // a click without the libxdo feature. On Linux the four are items of ours
    // whose click runs the webview's editing command.
    #[test]
    fn linux_edit_items_are_ours_and_run_the_webviews_editing_command() {
        let four = [(Edit::Cut, EDIT_CUT_ID, "Cut", "Cut"), (Edit::Copy, EDIT_COPY_ID, "Copy", "Copy"), (Edit::Paste, EDIT_PASTE_ID, "Paste", "Paste"), (Edit::SelectAll, EDIT_SELECT_ALL_ID, "Select All", "SelectAll")];
        assert_eq!(LINUX_EDIT_IS_OURS, cfg!(target_os = "linux"));
        for (e, id, label, cmd) in four {
            assert_eq!(e.id(), Some(id));
            assert_eq!(edit_entry(e, true), EditEntry::Ours(id, label));
            // macOS and Windows keep the platform's own item.
            assert_eq!(edit_entry(e, false), EditEntry::Predefined(e));
            assert_eq!(editing_command(id), Some(cmd));
            assert_eq!(dispatch(id), Dispatch::Editing(cmd));
            // A click runs the command, and nothing else.
            let (mut q, mut c, mut emitted, mut edited) = (0, 0, Vec::<&str>::new(), Vec::new());
            assert_eq!(on_menu_event(id, || q += 1, || c += 1, |a| emitted.push(a), |x| edited.push(x)), Dispatch::Editing(cmd));
            assert_eq!((q, c), (0, 0), "{id}");
            assert!(emitted.is_empty(), "{id}");
            assert_eq!(edited, vec![cmd]);
            // Not an id of ours otherwise, nor muda's predefined one.
            assert!(all().all(|i| i.id != id) && id != QUIT_ID && id != CLOSE_ID, "{id}");
        }
        // The Linux list: every entry but the separator is ours.
        let entries: Vec<_> = EDIT_OTHER.iter().map(|e| edit_entry(*e, true)).collect();
        assert_eq!(
            entries,
            [
                EditEntry::Ours(EDIT_CUT_ID, "Cut"),
                EditEntry::Ours(EDIT_COPY_ID, "Copy"),
                EditEntry::Ours(EDIT_PASTE_ID, "Paste"),
                EditEntry::Predefined(Edit::Separator),
                EditEntry::Ours(EDIT_SELECT_ALL_ID, "Select All"),
            ]
        );
        // Undo and Redo (macOS only) stay predefined in any case.
        for e in [Edit::Undo, Edit::Redo, Edit::Separator] {
            assert_eq!(edit_entry(e, true), EditEntry::Predefined(e));
            assert_eq!(e.id(), None);
        }
        assert_eq!(editing_command("copy"), None);
        assert_eq!(editing_command("open-spectra"), None);
    }
}
