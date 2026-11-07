// The system notification when a run or a batch finishes (GUI-DESIGN 2
// "Navigation rules", P2a PR s). The renderer decides when (the window is
// not focused) and what it says; this only shows it. Shown from Rust, so the
// webview needs no notification permission.

use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

/// The longest title and body passed on: the renderer builds them from file
/// names, which can be long.
const MAX_TITLE: usize = 120;
const MAX_BODY: usize = 400;

/// @p s cut to at most @p max characters (not bytes), with an ellipsis.
pub fn clip(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let mut out: String = s.chars().take(max.saturating_sub(1)).collect();
    out.push('…');
    out
}

#[tauri::command]
pub fn notify_finished(app: AppHandle, title: String, body: String) -> Result<(), String> {
    app.notification()
        .builder()
        .title(clip(&title, MAX_TITLE))
        .body(clip(&body, MAX_BODY))
        .show()
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clips_by_characters() {
        assert_eq!(clip("run01.mzML finished", 120), "run01.mzML finished");
        assert_eq!(clip("äöüäöü", 4), "äöü…");
        assert_eq!(clip(&"x".repeat(500), MAX_BODY).chars().count(), MAX_BODY);
    }
}
