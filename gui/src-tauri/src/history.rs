// The run record (GUI-DESIGN 6.4 and 6.5, the minimal P0a part): one JSON
// line per run in app data, with the outputs it resolved, how it ended and
// its exit code, plus last-failure.log with the log of the latest run that
// did not finish. A later session reads it back, so a run that was cancelled
// or failed is never taken for a complete one: the last-run line says so
// after a restart, and a tags file one of those runs left behind (its
// cleanup could not remove it) opens as incomplete.
//
// The History view (P2a PR h) reads the same lines: argv is the command line
// as the run was started, so Copy command in History equals the command the
// run reply offered (RunStarted.command) by construction -- the outputs in
// it are the final paths (no staging folder, no .part, no .incomplete, no
// temporary INI). The one rewrite is argv[0] when the binary sits on a mount
// that ends with the app (an AppImage's /tmp/.mount_*, a macOS App
// Translocation copy): that path does not exist once the app quits, so the
// record names the program instead (argv_as_run). Deleting a record removes
// its line only; the files stay.

use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
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
    /// The parameters the run was sent (the renderer's `params`, before
    /// build_args), for Settings into form. Absent in records of 1.13.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub params: Option<Map<String, Value>>,
    /// The tags the run wrote, from the CLI's summary line (tags_of_log);
    /// None when it printed none (a run that did not finish, an older CLI).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tags: Option<u64>,
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

/// The program name a record shows for a binary that is gone with the app.
pub const PROGRAM: &str = "FASTag";

/// @p bin lives on a mount or copy that ends with the app: inside @p appdir
/// (the AppImage runtime's $APPDIR), on an AppImage mount (`.mount_*` in
/// the temp folder), or in a macOS App Translocation copy.
pub fn is_ephemeral_bin(bin: &Path, appdir: Option<&Path>) -> bool {
    if appdir.is_some_and(|d| !d.as_os_str().is_empty() && bin.starts_with(d)) {
        return true;
    }
    bin.components().any(|c| {
        let c = c.as_os_str().to_string_lossy();
        c == "AppTranslocation" || c.starts_with(".mount_")
    })
}

/// The command line of a run of @p bin with @p args, binary first, as the
/// run reply offers it and the record stores it: @p args unchanged, and
/// @p bin unless it is ephemeral (is_ephemeral_bin), then PROGRAM.
pub fn argv_as_run(bin: &Path, args: &[String], appdir: Option<&Path>) -> Vec<String> {
    let first = if is_ephemeral_bin(bin, appdir) { PROGRAM.to_string() } else { bin.display().to_string() };
    std::iter::once(first).chain(args.iter().cloned()).collect()
}

/// The tags a run wrote, from the last summary line in @p log:
/// "139 MS2 spectra, 2028 tags" (2028) or "... 2028 tags -> 5 after
/// filtering" (5, the rows in -out).
pub fn tags_of_log(log: &[String]) -> Option<u64> {
    log.iter().rev().find_map(|l| {
        let (n, rest) = l.trim().split_once(' ')?;
        if n.is_empty() || !n.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        let rest = rest.strip_prefix("MS2 spectra, ")?;
        let (tags, after) = rest.split_once(" tags").unwrap_or((rest, ""));
        let tags: u64 = tags.parse().ok()?;
        match after.trim().strip_prefix("->").map(str::trim) {
            Some(f) => f.strip_suffix("after filtering")?.trim().parse().ok(),
            None => Some(tags),
        }
    })
}

// One writer at a time in this process: a delete rewrites the file, and an
// append between its read and its rename would be lost.
static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Append @p rec to <dir>/history.jsonl (the folder is created).
pub fn append(dir: &Path, rec: &RunRecord) -> std::io::Result<()> {
    let _g = LOCK.lock().unwrap_or_else(|p| p.into_inner());
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

/// Remove the record @p id from <dir>/history.jsonl; every other line stays
/// byte for byte (also one this version cannot read). The run's files are
/// not touched. False when no record has that id.
pub fn delete(dir: &Path, id: &str) -> std::io::Result<bool> {
    let _g = LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let path = dir.join(HISTORY_FILE);
    let text = match std::fs::read_to_string(&path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(e) => return Err(e),
    };
    let mut found = false;
    let mut kept = String::with_capacity(text.len());
    for l in text.split_inclusive('\n') {
        let mine = serde_json::from_str::<Value>(l.trim_end())
            .ok()
            .is_some_and(|v| v.get("id").and_then(Value::as_str) == Some(id));
        if mine {
            found = true;
        } else {
            kept.push_str(l);
        }
    }
    if !found {
        return Ok(false);
    }
    let tmp = dir.join(format!("{HISTORY_FILE}.tmp"));
    std::fs::write(&tmp, kept)?;
    std::fs::rename(&tmp, &path)?;
    Ok(true)
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

/// Delete the record @p id (the record only: its files stay).
#[tauri::command]
pub fn history_delete(app: AppHandle, id: String) -> Result<bool, String> {
    let d = dir(&app).ok_or("no app data folder")?;
    delete(&d, &id).map_err(|e| e.to_string())
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
            params: None,
            tags: None,
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

    // P2a PR h: what History shows and Copy command copies survives the
    // session: every field reads back as written, and a line of the P0a
    // schema (no params, no tags) still reads.
    #[test]
    fn a_record_reads_back_whole_in_a_later_session() {
        let d = tmp("persist");
        let mut r = rec("4-4", "/d/a.tags.tsv", Status::Failed);
        r.exit_code = Some(3);
        r.message = Some("exit code 3".into());
        r.cleanup.renamed.push("/d/a.tags.tsv.incomplete".into());
        let mut p = Map::new();
        p.insert("species".into(), Value::Bool(true));
        p.insert("fixed_mods".into(), serde_json::json!(["Carbamidomethyl (C)"]));
        r.params = Some(p);
        r.tags = Some(2028);
        append(&d, &r).unwrap();
        // A line as 1.13 wrote it.
        let old = r#"{"id":"0-1","input":"/d/o.mzML","outputs":["/d/o.tags.tsv"],"cwd":"/d","argv":["FASTag","-in","/d/o.mzML"],"status":"ok","exitCode":0,"message":null,"start":1,"end":2,"cleanup":{"removed":[],"renamed":[],"failed":[]}}"#;
        std::fs::OpenOptions::new().append(true).open(d.join(HISTORY_FILE)).unwrap().write_all(format!("{old}\n").as_bytes()).unwrap();
        let all = list(&d, 10);
        assert_eq!(all.len(), 2);
        assert_eq!(all[1], r);
        assert_eq!((all[0].id.as_str(), all[0].params.as_ref(), all[0].tags), ("0-1", None, None));
        // The wire names types.ts reads.
        let line = std::fs::read_to_string(d.join(HISTORY_FILE)).unwrap();
        assert!(line.contains(r#""tags":2028"#) && line.contains(r#""params":{"#), "{line}");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn delete_removes_that_record_only_and_keeps_its_files() {
        let d = tmp("delete");
        let out = d.join("a.tags.tsv");
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(&out, "tags").unwrap();
        append(&d, &rec("1-1", &out.display().to_string(), Status::Ok)).unwrap();
        std::fs::OpenOptions::new().append(true).open(d.join(HISTORY_FILE)).unwrap().write_all(b"{\"future\":1}\n").unwrap();
        append(&d, &rec("2-2", &out.display().to_string(), Status::Cancelled)).unwrap();
        append(&d, &rec("3-3", &out.display().to_string(), Status::Ok)).unwrap();
        assert!(delete(&d, "2-2").unwrap());
        assert_eq!(list(&d, 10).iter().map(|r| r.id.as_str()).collect::<Vec<_>>(), vec!["3-3", "1-1"]);
        // A line this version cannot read is not this version's to drop.
        assert!(std::fs::read_to_string(d.join(HISTORY_FILE)).unwrap().contains("{\"future\":1}\n"));
        assert_eq!(std::fs::read_to_string(&out).unwrap(), "tags");
        assert!(!delete(&d, "2-2").unwrap());
        assert!(!delete(&tmp("delete-none"), "1-1").unwrap());
        let _ = std::fs::remove_dir_all(&d);
    }

    // The command a record keeps names no path that is gone with the app.
    #[test]
    fn the_argv_names_no_binary_on_a_temporary_mount() {
        let args = vec!["-in".to_string(), "/d/a.mzML".into(), "-out".into(), "/d/a.tags.tsv".into(), "-progress".into()];
        let run = |bin: &str, appdir: Option<&str>| argv_as_run(Path::new(bin), &args, appdir.map(Path::new));
        // As run: the bundled CLI of an installed app, a CLI the user set.
        let installed = "/Applications/FASTag.app/Contents/Resources/fastag/FASTag";
        assert_eq!(run(installed, None)[0], installed);
        assert_eq!(run("/opt/fastag/bin/FASTag", Some("")), [&["/opt/fastag/bin/FASTag".to_string()][..], &args[..]].concat());
        // An AppImage's mount, by $APPDIR and by its name.
        assert_eq!(run("/tmp/.mount_FASTagAbC/usr/lib/FASTag/resources/fastag/FASTag", Some("/tmp/.mount_FASTagAbC"))[0], PROGRAM);
        assert_eq!(run("/tmp/.mount_FASTagAbC/usr/lib/FASTag/resources/fastag/FASTag", None)[0], PROGRAM);
        assert_eq!(run("/run/user/1000/appimage/usr/bin/FASTag", Some("/run/user/1000/appimage"))[0], PROGRAM);
        // A macOS App Translocation copy (an app run from the dmg or Downloads).
        let tr = "/private/var/folders/x1/T/AppTranslocation/0A1B/d/FASTag.app/Contents/Resources/fastag/FASTag";
        assert_eq!(run(tr, None), [&[PROGRAM.to_string()][..], &args[..]].concat());
        // The arguments are never rewritten.
        assert_eq!(&run(tr, None)[1..], &args[..]);
    }

    #[test]
    fn the_tag_count_is_read_from_the_summary_line() {
        let log = |l: &[&str]| l.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(tags_of_log(&log(&["Reading spectra", "139 MS2 spectra, 2028 tags", "Digest: 3 calls -> d.tsv"])), Some(2028));
        assert_eq!(tags_of_log(&log(&["139 MS2 spectra, 2028 tags -> 5 after filtering"])), Some(5));
        assert_eq!(tags_of_log(&log(&["Reading spectra", "progress 3/4"])), None);
        assert_eq!(tags_of_log(&log(&["MS2 spectra, 3 tags", "x MS2 spectra, 3 tags"])), None);
    }
}
