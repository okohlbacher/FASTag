// The run record (GUI-DESIGN 6.4 and 6.5, the minimal P0a part): one JSON
// line per run in app data, with the outputs it resolved, how it ended and
// its exit code, plus last-failure.log with the log of the latest run that
// did not finish. A later session reads it back, so a run that was cancelled
// or failed is never taken for a complete one: the last-run line says so
// after a restart, and a tags file one of those runs left behind (its
// cleanup could not remove it) opens as incomplete. The History view and its
// commands (rerun, delete) are P2a.

use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::outputs::Cleanup;

pub const HISTORY_FILE: &str = "history.jsonl";
pub const FAILURE_LOG: &str = "last-failure.log";

/// How a run ended.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Ok,
    Cancelled,
    Failed,
}

/// One run, as history.jsonl stores it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RunRecord {
    /// <start in ms>-<pid of the CLI>: unique across sessions.
    pub id: String,
    pub input: String,
    /// Every file the run writes (outputs::resolved_outputs), as given to the
    /// CLI (relative ones are relative to `cwd`).
    pub outputs: Vec<String>,
    pub cwd: Option<String>,
    /// The command line, binary first.
    pub argv: Vec<String>,
    pub status: Status,
    pub exit_code: Option<i32>,
    pub message: Option<String>,
    /// Unix time in ms.
    pub start: u64,
    pub end: u64,
    /// What happened to the outputs of a run that did not finish.
    pub cleanup: Cleanup,
}

impl RunRecord {
    /// The outputs as absolute paths (joined to the child's cwd).
    pub fn output_paths(&self) -> Vec<PathBuf> {
        crate::outputs::resolve(&self.outputs, self.cwd.as_deref().map(Path::new))
    }
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Append @p rec to <dir>/history.jsonl (the folder is created).
pub fn append(dir: &Path, rec: &RunRecord) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let mut line = serde_json::to_string(rec).map_err(std::io::Error::other)?;
    line.push('\n');
    // One write of one line: an appending writer never interleaves it.
    let mut f = std::fs::OpenOptions::new().create(true).append(true).open(dir.join(HISTORY_FILE))?;
    f.write_all(line.as_bytes())
}

/// Replace <dir>/last-failure.log with the record of @p rec and its log
/// @p lines (temp file and rename, so a reader never sees half of it).
pub fn write_failure_log(dir: &Path, rec: &RunRecord, lines: &[String]) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let mut text = String::new();
    text.push_str(&format!("run: {}\nstatus: {:?}\n", rec.id, rec.status));
    text.push_str(&format!(
        "exit code: {}\n",
        rec.exit_code.map(|c| c.to_string()).unwrap_or_else(|| "none".into())
    ));
    if let Some(m) = &rec.message {
        text.push_str(&format!("message: {m}\n"));
    }
    text.push_str(&format!("input: {}\ncommand: {}\n", rec.input, rec.argv.join(" ")));
    for p in &rec.cleanup.removed {
        text.push_str(&format!("removed: {p}\n"));
    }
    for p in &rec.cleanup.renamed {
        text.push_str(&format!("renamed: {p}\n"));
    }
    for p in &rec.cleanup.failed {
        text.push_str(&format!("not removed: {p}\n"));
    }
    text.push_str("--- log ---\n");
    for l in lines {
        text.push_str(l);
        text.push('\n');
    }
    let tmp = dir.join(format!("{FAILURE_LOG}.tmp"));
    std::fs::write(&tmp, text)?;
    std::fs::rename(&tmp, dir.join(FAILURE_LOG))
}

/// The runs in <dir>/history.jsonl, newest first, at most @p limit. A line
/// that does not parse (a newer schema, a torn write) is skipped.
pub fn list(dir: &Path, limit: usize) -> Vec<RunRecord> {
    let Ok(text) = std::fs::read_to_string(dir.join(HISTORY_FILE)) else { return Vec::new() };
    text.lines().rev().filter_map(|l| serde_json::from_str(l).ok()).take(limit).collect()
}

/// The newest run that wrote @p path, if any.
pub fn of_output(dir: &Path, path: &Path) -> Option<RunRecord> {
    let Ok(text) = std::fs::read_to_string(dir.join(HISTORY_FILE)) else { return None };
    let canon = |p: &Path| p.canonicalize().unwrap_or_else(|_| p.to_path_buf());
    let want = canon(path);
    text.lines()
        .rev()
        .filter_map(|l| serde_json::from_str::<RunRecord>(l).ok())
        .find(|r| r.output_paths().iter().any(|p| p == path || canon(p) == want))
}

/// The app's data folder, where the record lives.
pub fn dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok()
}

#[tauri::command]
pub fn history_list(app: AppHandle, limit: Option<usize>) -> Vec<RunRecord> {
    dir(&app).map(|d| list(&d, limit.unwrap_or(50))).unwrap_or_default()
}

#[tauri::command]
pub fn history_of(app: AppHandle, path: String) -> Option<RunRecord> {
    dir(&app).and_then(|d| of_output(&d, Path::new(&path)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("fastag-history-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        d
    }

    fn rec(id: &str, out: &str, status: Status) -> RunRecord {
        RunRecord {
            id: id.into(),
            input: "/d/a.mzML".into(),
            outputs: vec![out.into(), "a.digest.tsv".into()],
            cwd: Some("/d".into()),
            argv: vec!["FASTag".into(), "-in".into(), "/d/a.mzML".into(), "-out".into(), out.into()],
            status,
            exit_code: if status == Status::Ok { Some(0) } else { None },
            message: if status == Status::Cancelled { Some("cancelled".into()) } else { None },
            start: 1,
            end: 2,
            cleanup: Cleanup::default(),
        }
    }

    #[test]
    fn records_append_and_read_back_newest_first() {
        let d = tmp("list");
        append(&d, &rec("1-1", "/d/a.tags.tsv", Status::Ok)).unwrap();
        append(&d, &rec("2-2", "/d/a.tags.tsv", Status::Cancelled)).unwrap();
        // A torn or foreign line does not hide the others.
        std::fs::OpenOptions::new().append(true).open(d.join(HISTORY_FILE)).unwrap().write_all(b"{not json\n").unwrap();
        let all = list(&d, 10);
        assert_eq!(all.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(), vec!["2-2", "1-1"]);
        assert_eq!(all[0].status, Status::Cancelled);
        assert_eq!(list(&d, 1).len(), 1);
        // The JSON a later session (and the UI) reads.
        let line = std::fs::read_to_string(d.join(HISTORY_FILE)).unwrap();
        assert!(line.lines().nth(1).unwrap().contains(r#""status":"cancelled""#));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn the_newest_run_of_an_output_is_found_also_by_its_relative_name() {
        let d = tmp("of");
        append(&d, &rec("1-1", "/d/a.tags.tsv", Status::Ok)).unwrap();
        append(&d, &rec("2-2", "/d/a.tags.tsv", Status::Failed)).unwrap();
        assert_eq!(of_output(&d, Path::new("/d/a.tags.tsv")).unwrap().id, "2-2");
        // "a.digest.tsv" is relative to the run's cwd /d.
        assert_eq!(of_output(&d, Path::new("/d/a.digest.tsv")).unwrap().status, Status::Failed);
        assert!(of_output(&d, Path::new("/elsewhere/a.tags.tsv")).is_none());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn the_failure_log_holds_the_run_and_its_log() {
        let d = tmp("faillog");
        let mut r = rec("3-3", "/d/a.tags.tsv", Status::Cancelled);
        r.cleanup.removed.push("/d/a.tags.tsv".into());
        write_failure_log(&d, &r, &["Reading spectra".into(), "progress".into()]).unwrap();
        let t = std::fs::read_to_string(d.join(FAILURE_LOG)).unwrap();
        assert!(t.contains("status: Cancelled") && t.contains("removed: /d/a.tags.tsv"), "{t}");
        assert!(t.ends_with("Reading spectra\nprogress\n"), "{t}");
        let _ = std::fs::remove_dir_all(&d);
    }
}
