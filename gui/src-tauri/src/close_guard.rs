// Close guard (GUI-DESIGN 6.6, P0a): closing the window or quitting while a
// run or a batch is active does not kill it silently. lib.rs routes
// WindowEvent::CloseRequested and RunEvent::ExitRequested here; while
// RunManager is busy the request is prevented and the renderer is asked to
// show "Cancel run and quit" / "Keep running", which answers through
// close_answer. When idle nothing is intercepted, so the window closes and
// the app quits as usual (and no core:window:allow-destroy is needed).
//
// macOS Cmd+Q: the predefined Quit menu item sends terminate:, which tao
// turns into applicationWillTerminate with no ExitRequested, so it could not
// be prevented. lib.rs therefore replaces it with a Quit item of its own that
// calls AppHandle::exit, which does raise ExitRequested.

use std::sync::atomic::Ordering;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, State};

use crate::fastag::{kill_current, RunManager};

/// The event the renderer listens to; its payload says what was requested.
pub const ASK_EVENT: &str = "fastag:close-requested";

/// What a close or quit request does.
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum Decision {
    /// Idle, or the user already chose to quit: let it through.
    Allow,
    /// Busy: prevent it and ask the user.
    Ask,
}

pub fn decide(mgr: &RunManager) -> Decision {
    if mgr.quitting.load(Ordering::SeqCst) || !mgr.is_busy() {
        Decision::Allow
    } else {
        Decision::Ask
    }
}

/// WindowEvent::CloseRequested: @p prevent is api.prevent_close, @p ask
/// tells the renderer.
pub fn on_close_requested(mgr: &RunManager, prevent: impl FnOnce(), ask: impl FnOnce()) -> Decision {
    let d = decide(mgr);
    if d == Decision::Ask {
        prevent();
        ask();
    }
    d
}

/// RunEvent::ExitRequested (the custom Quit item, the last window closing,
/// AppHandle::exit): @p prevent is api.prevent_exit.
pub fn on_exit_requested(mgr: &RunManager, prevent: impl FnOnce(), ask: impl FnOnce()) -> Decision {
    on_close_requested(mgr, prevent, ask)
}

/// The emitter lib.rs passes as `ask`.
pub fn ask(app: &AppHandle, what: &'static str) {
    let _ = app.emit(ASK_EVENT, what);
}

/// The renderer is in a batch (no child exists between two jobs).
#[tauri::command]
pub fn set_ui_busy(state: State<'_, RunManager>, busy: bool) {
    state.ui_busy.store(busy, Ordering::SeqCst);
}

/// The answer to ASK_EVENT. quit=false ("Keep running") changes nothing.
/// quit=true ("Cancel run and quit") kills the run, waits for its cleanup of
/// partial outputs, then exits the app.
#[tauri::command]
pub fn close_answer(app: AppHandle, quit: bool) {
    if !quit {
        return;
    }
    {
        let st = app.state::<RunManager>();
        st.quitting.store(true, Ordering::SeqCst);
        st.ui_busy.store(false, Ordering::SeqCst);
    }
    kill_current(&app);
    std::thread::spawn(move || {
        // The coordinator releases the slot only after the cleanup; a child
        // that ignores the kill must not keep the app open for ever.
        let _ = app.state::<RunManager>().wait_idle(Duration::from_secs(10));
        app.exit(0);
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fastag::CurrentRun;
    use std::cell::Cell;
    use std::process::{Command, Stdio};
    use std::sync::atomic::AtomicBool;
    use std::sync::{Arc, Mutex};

    fn busy_manager() -> RunManager {
        let mgr = RunManager::default();
        let child = Command::new(if cfg!(windows) { "cmd" } else { "sh" })
            .args(if cfg!(windows) { ["/C", "exit 0"] } else { ["-c", "exit 0"] })
            .stdin(Stdio::null())
            .spawn()
            .unwrap();
        *mgr.current.lock().unwrap() = Some(CurrentRun {
            child: Arc::new(Mutex::new(child)),
            cancelled: Arc::new(AtomicBool::new(false)),
            reaped: Arc::new(AtomicBool::new(false)),
        });
        mgr
    }

    // Dispatch a request to a handler; report whether it was prevented and
    // whether the renderer was asked.
    fn dispatch(mgr: &RunManager, exit: bool) -> (Decision, bool, bool) {
        let prevented = Cell::new(false);
        let asked = Cell::new(false);
        let d = if exit {
            on_exit_requested(mgr, || prevented.set(true), || asked.set(true))
        } else {
            on_close_requested(mgr, || prevented.set(true), || asked.set(true))
        };
        (d, prevented.get(), asked.get())
    }

    #[test]
    fn idle_closes_and_quits_normally() {
        let mgr = RunManager::default();
        assert_eq!(dispatch(&mgr, false), (Decision::Allow, false, false));
        assert_eq!(dispatch(&mgr, true), (Decision::Allow, false, false));
    }

    #[test]
    fn busy_prevents_close_and_quit_and_asks() {
        let mgr = busy_manager();
        assert_eq!(dispatch(&mgr, false), (Decision::Ask, true, true));
        assert_eq!(dispatch(&mgr, true), (Decision::Ask, true, true));
        let _ = mgr.current.lock().unwrap().take().unwrap().child.lock().unwrap().wait();
    }

    #[test]
    fn a_batch_between_jobs_is_busy_too() {
        let mgr = RunManager::default();
        mgr.ui_busy.store(true, Ordering::SeqCst);
        assert_eq!(dispatch(&mgr, true), (Decision::Ask, true, true));
        mgr.ui_busy.store(false, Ordering::SeqCst);
        assert_eq!(dispatch(&mgr, true).0, Decision::Allow);
    }

    #[test]
    fn after_cancel_run_and_quit_the_exit_goes_through() {
        let mgr = busy_manager();
        mgr.quitting.store(true, Ordering::SeqCst);
        assert_eq!(dispatch(&mgr, true), (Decision::Allow, false, false));
        assert_eq!(dispatch(&mgr, false), (Decision::Allow, false, false));
        let _ = mgr.current.lock().unwrap().take().unwrap().child.lock().unwrap().wait();
    }
}
