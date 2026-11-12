// Startup sweep (GUI-DESIGN 6.4 and 6.6, P1 PR b): files an unfinished run
// left behind are offered for removal when the app starts.
//
// A run that is cancelled or fails is cleaned up when it ends (outputs.rs),
// but a run whose GUI was killed is not: the CLI ends with the GUI
// (lifetime.rs), and its partial outputs stay at their final paths with no
// run record. So `run` writes a marker, <app data>/running-<n>.json (the
// app's local data folder, history::dir; with the host and process id of
// the GUI), before the CLI starts and removes it when the run has ended; at
// the next start recover() turns a marker that is still there into a Failed
// run record ("interrupted"), unless its run may still be live (another
// machine, a process that still runs, a fresh heartbeat: abandoned()). One
// marker per run: a run refused because another is live removes its own
// marker, never the live run's. While the run is live its marker's mtime is
// refreshed every HEARTBEAT, so the marker of a killed run
// says when that run was last alive: that is the record's end.
// leftovers() then lists, for the recorded runs:
// - <output>.part (a CLI that writes to .part and renames on success, Q3,
//   killed before the rename) and <output>.incomplete (an output the
//   cleanup could not delete and renamed);
// - the outputs at their final paths of an interrupted run, unless a later
//   run wrote the same path, and only those last written while that run was
//   alive (from its start to its last heartbeat, plus one heartbeat for the
//   writes between that and the kill). An older output the run had not yet
//   rewritten, or one remade after the kill (the CLI in a terminal, another
//   tool), is a complete file and never offered.
// The renderer shows them and the user removes or keeps them. Only paths
// that leftovers() lists are ever removed (the renderer is untrusted), and
// a run's input never is.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::AppHandle;

use crate::history::{self, RunRecord, Status};
use crate::outputs::{self, Cleanup};

/// The markers of the runs in progress, in app data: <prefix><n>.json.
const MARKER_PREFIX: &str = "running-";
/// The leftovers the user chose to keep: not offered again.
pub const KEPT_FILE: &str = "leftovers-kept.json";
/// The message of the record of a run the app did not see end.
pub const INTERRUPTED: &str = "interrupted: the app ended while this run was in progress";

/// How often a live run refreshes the mtime of its marker.
pub const HEARTBEAT: Duration = Duration::from_secs(2);
/// How long after the last heartbeat of an interrupted run a write still
/// counts as the run's: it was killed at most one HEARTBEAT later; the
/// rest is slack for a late heartbeat and coarse file times.
const AFTER_HEARTBEAT_MS: u64 = 2 * HEARTBEAT.as_millis() as u64;

/// A marker refreshed less than this long ago belongs to a run that may be
/// live: its heartbeat (every HEARTBEAT) has not been missed three times.
pub const FRESH: Duration = Duration::from_secs(3 * HEARTBEAT.as_secs());

/// How many recorded runs are searched for leftovers.
const RUNS_SEARCHED: usize = 500;

/// Write a marker of @p rec, the run about to start (temp file and rename,
/// so a killed app never leaves half of it), and refresh its mtime every
/// HEARTBEAT until it is removed. Returns its path.
pub fn mark_running(dir: &Path, rec: &RunRecord) -> std::io::Result<PathBuf> {
    static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    std::fs::create_dir_all(dir)?;
    let n = SEQ.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    let path = dir.join(format!("{MARKER_PREFIX}{}-{}-{n}.json", rec.start, std::process::id()));
    let mut tmp = path.clone().into_os_string();
    tmp.push(".tmp");
    let marker = Marker { rec: rec.clone(), host: host_name(), pid: Some(std::process::id()) };
    std::fs::write(&tmp, serde_json::to_vec(&marker).map_err(std::io::Error::other)?)?;
    std::fs::rename(&tmp, &path)?;
    let beat = path.clone();
    let _ = std::thread::Builder::new().name("fastag-heartbeat".into()).spawn(move || loop {
        std::thread::sleep(HEARTBEAT);
        // Opened for writing, never created: once clear_running() has
        // removed the marker this fails and the heartbeat stops.
        let Ok(f) = std::fs::OpenOptions::new().write(true).open(&beat) else { return };
        if f.set_modified(SystemTime::now()).is_err() {
            return;
        }
    });
    Ok(path)
}

/// The mtime of @p p in ms since the epoch.
fn mtime_ms(p: &Path) -> Option<u64> {
    let t = std::fs::metadata(p).and_then(|m| m.modified()).ok()?;
    Some(t.duration_since(UNIX_EPOCH).ok()?.as_millis() as u64)
}

/// The run of @p marker has ended and is recorded as such (or never started).
pub fn clear_running(marker: &Path) {
    let _ = std::fs::remove_file(marker);
}

/// The markers in @p dir.
pub fn markers(dir: &Path) -> Vec<PathBuf> {
    let Ok(rd) = std::fs::read_dir(dir) else { return Vec::new() };
    let mut v: Vec<PathBuf> = rd
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with(MARKER_PREFIX) && n.ends_with(".json"))
        })
        .collect();
    v.sort();
    v
}

/// What a marker holds: the run's record, plus the host and the process id
/// of the GUI that started it (absent in markers of 1.13.3 and earlier).
#[derive(serde::Serialize, serde::Deserialize)]
struct Marker {
    #[serde(flatten)]
    rec: RunRecord,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    host: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pid: Option<u32>,
}

/// This machine's name (COMPUTERNAME, gethostname), None when unknown.
pub(crate) fn host_name() -> Option<String> {
    #[cfg(windows)]
    {
        std::env::var("COMPUTERNAME").ok().filter(|h| !h.is_empty())
    }
    #[cfg(unix)]
    {
        let mut buf = [0u8; 256];
        // SAFETY: gethostname writes at most buf.len() bytes into buf.
        if unsafe { libc::gethostname(buf.as_mut_ptr().cast(), buf.len()) } != 0 {
            return None;
        }
        let n = buf.iter().position(|&b| b == 0).unwrap_or(buf.len());
        Some(String::from_utf8_lossy(&buf[..n]).into_owned()).filter(|h| !h.is_empty())
    }
    #[cfg(not(any(windows, unix)))]
    {
        None
    }
}

/// Process @p pid runs on this machine.
pub(crate) fn pid_alive(pid: u32) -> bool {
    #[cfg(unix)]
    {
        let Ok(p) = i32::try_from(pid) else { return false };
        // SAFETY: signal 0 only checks that the process exists.
        unsafe { libc::kill(p, 0) == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM) }
    }
    #[cfg(windows)]
    {
        use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, ERROR_ACCESS_DENIED};
        use windows_sys::Win32::System::Threading::{GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
        // SAFETY: plain Win32 calls; the handle is closed here.
        unsafe {
            let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if h.is_null() {
                // Another user's process: it exists.
                return GetLastError() == ERROR_ACCESS_DENIED;
            }
            let mut code = 0u32;
            let ok = GetExitCodeProcess(h, &mut code);
            CloseHandle(h);
            ok != 0 && code == 259 // STILL_ACTIVE
        }
    }
    #[cfg(not(any(windows, unix)))]
    {
        let _ = pid;
        false
    }
}

/// Who owns a marker, as far as this session can tell.
#[derive(Debug, PartialEq)]
enum Owner {
    /// This process (cannot have a run yet when recover() runs at startup).
    ThisProcess,
    /// A process on this machine that has ended.
    Ended,
    /// A process on this machine that still runs.
    Running,
    /// A GUI on another machine (an app data folder shared between machines).
    OtherHost,
    /// A marker of 1.13.3 or earlier: no host or process id.
    Unknown,
}

fn owner(m: &Marker, host: Option<&str>, me: u32, alive: &dyn Fn(u32) -> bool) -> Owner {
    match (m.host.as_deref(), m.pid) {
        (Some(h), _) if host.is_some_and(|me_host| !me_host.eq_ignore_ascii_case(h)) => Owner::OtherHost,
        (Some(_), Some(p)) if p == me => Owner::ThisProcess,
        (Some(_), Some(p)) if alive(p) => Owner::Running,
        (Some(_), Some(_)) => Owner::Ended,
        _ => Owner::Unknown,
    }
}

/// The marker of @p owner, last refreshed @p age ago, is a run nobody will
/// end: a run of another machine or of a process still running is left
/// alone, and so is a marker without an owner whose heartbeat is fresh (a
/// GUI of 1.13.3 or earlier, possibly on another machine that shares the
/// folder). PID reuse can only delay a recovery: once that process ends, the
/// next start recovers the marker.
fn abandoned(owner: &Owner, age: Option<Duration>) -> bool {
    match owner {
        Owner::ThisProcess | Owner::Ended => true,
        Owner::Running | Owner::OtherHost => false,
        Owner::Unknown => age.is_none_or(|a| a >= FRESH),
    }
}

/// How long ago @p p was last written (its heartbeat), None when unknown.
fn age(p: &Path) -> Option<Duration> {
    let t = std::fs::metadata(p).and_then(|m| m.modified()).ok()?;
    Some(SystemTime::now().duration_since(t).unwrap_or(Duration::ZERO))
}

/// At startup: a marker left by an earlier session is a run the app did not
/// see end. Each is recorded as Failed (INTERRUPTED), with the marker's
/// last heartbeat (its mtime) as its end, and the marker goes. A marker of a
/// run that may still be live (abandoned() is false) stays. Returns those
/// records.
pub fn recover(dir: &Path) -> Vec<RunRecord> {
    recover_with(dir, host_name().as_deref(), std::process::id(), &pid_alive)
}

fn recover_with(dir: &Path, host: Option<&str>, me: u32, alive: &dyn Fn(u32) -> bool) -> Vec<RunRecord> {
    markers(dir).iter().filter_map(|m| recover_one(dir, m, host, me, alive)).collect()
}

fn recover_one(dir: &Path, marker: &Path, host: Option<&str>, me: u32, alive: &dyn Fn(u32) -> bool) -> Option<RunRecord> {
    let text = std::fs::read(marker).ok()?;
    let last_beat = mtime_ms(marker);
    let m: Option<Marker> = serde_json::from_slice(&text).ok();
    if let Some(m) = &m {
        if !abandoned(&owner(m, host, me, alive), age(marker)) {
            return None;
        }
    }
    let _ = std::fs::remove_file(marker);
    let mut rec = m?.rec;
    rec.status = Status::Failed;
    rec.exit_code = None;
    rec.message = Some(INTERRUPTED.to_string());
    rec.end = last_beat.unwrap_or(rec.start).max(rec.start);
    history::append(dir, &rec).ok()?;
    let _ = history::write_failure_log(dir, &rec, &[]);
    Some(rec)
}

/// Move the run data of 1.13.3 and earlier from @p old (app_data_dir,
/// Roaming on Windows) to @p new (history::dir) once: the record, the
/// failure log, the kept leftovers, and the markers of runs nobody will end
/// (those of a GUI that may still run elsewhere stay, and are that GUI's).
/// A file already in @p new is never overwritten. Nothing happens where both
/// are the same folder (macOS, Linux). Returns the files moved.
pub fn migrate(old: &Path, new: &Path) -> Vec<PathBuf> {
    if old == new || !old.is_dir() {
        return Vec::new();
    }
    let mut names: Vec<std::ffi::OsString> =
        [history::HISTORY_FILE, history::FAILURE_LOG, KEPT_FILE].iter().map(|n| (*n).into()).collect();
    for m in markers(old) {
        let gone = std::fs::read(&m)
            .ok()
            .and_then(|t| serde_json::from_slice::<Marker>(&t).ok())
            .is_some_and(|mk| abandoned(&owner(&mk, host_name().as_deref(), std::process::id(), &pid_alive), age(&m)));
        if gone {
            names.extend(m.file_name().map(|n| n.to_owned()));
        }
    }
    let mut moved = Vec::new();
    for n in names {
        let (from, to) = (old.join(&n), new.join(&n));
        if !from.is_file() || to.exists() || std::fs::create_dir_all(new).is_err() {
            continue;
        }
        // A rename, or (Roaming redirected to another volume) copy and remove.
        let ok = std::fs::rename(&from, &to).is_ok()
            || (std::fs::copy(&from, &to).is_ok() && std::fs::remove_file(&from).is_ok());
        if ok {
            moved.push(to);
        }
    }
    moved
}

/// @p p was last written while the interrupted run @p rec was alive: not
/// before its start (taken to the whole second, for file systems with
/// coarse times) and not later than AFTER_HEARTBEAT_MS after its last
/// heartbeat (rec.end).
fn written_by_interrupted(p: &Path, rec: &RunRecord) -> bool {
    mtime_ms(p).is_some_and(|t| t >= rec.start / 1000 * 1000 && t <= rec.end.saturating_add(AFTER_HEARTBEAT_MS))
}

fn is_regular_file(p: &Path) -> bool {
    std::fs::metadata(p).is_ok_and(|m| m.is_file())
}

fn with_suffix(p: &Path, suffix: &str) -> PathBuf {
    let mut s = p.as_os_str().to_owned();
    s.push(suffix);
    PathBuf::from(s)
}

fn kept(dir: &Path) -> Vec<String> {
    std::fs::read(dir.join(KEPT_FILE)).ok().and_then(|t| serde_json::from_slice(&t).ok()).unwrap_or_default()
}

/// The files unfinished runs of @p dir's history left, newest run first.
pub fn leftovers(dir: &Path) -> Vec<PathBuf> {
    let kept: HashSet<PathBuf> = kept(dir).into_iter().map(PathBuf::from).collect();
    let mut found: Vec<PathBuf> = Vec::new();
    // Final paths a newer run already wrote (or tried to).
    let mut newer: HashSet<PathBuf> = HashSet::new();
    for rec in history::list(dir, RUNS_SEARCHED) {
        let cwd = rec.cwd.as_deref().map(Path::new);
        let input = outputs::resolve(std::slice::from_ref(&rec.input), cwd).pop().unwrap_or_default();
        let interrupted = rec.status == Status::Failed && rec.message.as_deref() == Some(INTERRUPTED);
        for p in rec.output_paths() {
            let mut cands = vec![with_suffix(&p, ".part"), outputs::incomplete_name(&p)];
            if interrupted && !newer.contains(&p) && written_by_interrupted(&p, &rec) {
                cands.push(p.clone());
            }
            newer.insert(p);
            for c in cands {
                if is_regular_file(&c) && c != input && !kept.contains(&c) && !found.contains(&c) {
                    found.push(c);
                }
            }
        }
    }
    found
}

/// Remove those of @p paths that leftovers() lists; anything else is left
/// alone and reported as failed.
pub fn sweep(dir: &Path, paths: &[String]) -> Cleanup {
    let allowed: HashSet<PathBuf> = leftovers(dir).into_iter().collect();
    let mut c = Cleanup::default();
    for p in paths {
        if allowed.contains(Path::new(p)) && std::fs::remove_file(p).is_ok() {
            c.removed.push(p.clone());
        } else {
            c.failed.push(p.clone());
        }
    }
    c
}

/// Do not offer those of @p paths that leftovers() lists again.
pub fn keep(dir: &Path, paths: &[String]) -> std::io::Result<()> {
    let allowed: HashSet<PathBuf> = leftovers(dir).into_iter().collect();
    let mut all = kept(dir);
    for p in paths {
        if allowed.contains(Path::new(p)) && !all.contains(p) {
            all.push(p.clone());
        }
    }
    std::fs::create_dir_all(dir)?;
    let tmp = dir.join(format!("{KEPT_FILE}.tmp"));
    std::fs::write(&tmp, serde_json::to_vec(&all).map_err(std::io::Error::other)?)?;
    std::fs::rename(&tmp, dir.join(KEPT_FILE))
}

/// The leftovers to offer at startup (absolute paths).
#[tauri::command]
pub fn leftovers_list(app: AppHandle) -> Vec<String> {
    history::dir(&app).map(|d| leftovers(&d).iter().map(|p| p.display().to_string()).collect()).unwrap_or_default()
}

/// Remove the leftovers the user confirmed.
#[tauri::command]
pub fn leftovers_sweep(app: AppHandle, paths: Vec<String>) -> Cleanup {
    match history::dir(&app) {
        Some(d) => sweep(&d, &paths),
        None => Cleanup { failed: paths, ..Cleanup::default() },
    }
}

/// Keep the leftovers the user chose to keep.
#[tauri::command]
pub fn leftovers_keep(app: AppHandle, paths: Vec<String>) {
    if let Some(d) = history::dir(&app) {
        let _ = keep(&d, &paths);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("fastag-sweep-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn rec(id: &str, data: &Path, status: Status) -> RunRecord {
        RunRecord {
            id: id.into(),
            input: data.join("a.mzML").display().to_string(),
            outputs: vec!["a.tags.tsv".into(), "a.digest.tsv".into()],
            cwd: Some(data.display().to_string()),
            argv: vec!["FASTag".into()],
            status,
            exit_code: None,
            message: None,
            start: 1000,
            end: 1000,
            cleanup: Cleanup::default(),
            params: None,
            tags: None,
        }
    }

    /// Set the mtime of @p p to @p ms since the epoch.
    fn set_mtime(p: &Path, ms: u64) {
        let f = std::fs::OpenOptions::new().write(true).open(p).unwrap();
        f.set_modified(UNIX_EPOCH + Duration::from_millis(ms)).unwrap();
    }

    /// An interrupted run of @p data that started 60 s ago and was alive
    /// until now (its last heartbeat).
    fn interrupted(id: &str, data: &Path) -> RunRecord {
        let mut r = rec(id, data, Status::Failed);
        r.message = Some(INTERRUPTED.into());
        r.start = history::now_ms() - 60_000;
        r.end = history::now_ms();
        r
    }

    fn shown(v: &[PathBuf]) -> Vec<String> {
        v.iter().map(|p| p.display().to_string()).collect()
    }

    #[test]
    fn a_marker_left_by_a_killed_app_becomes_an_interrupted_run() {
        let d = tmp("recover");
        let app = d.join("appdata");
        let mut r = rec("1-1", &d, Status::Ok);
        r.exit_code = Some(0);
        let other = mark_running(&app, &r).unwrap();
        let m = mark_running(&app, &r).unwrap();
        assert_ne!(m, other, "two runs share a marker");
        clear_running(&other); // a refused run takes only its own marker
        assert_eq!(markers(&app), vec![m.clone()]);
        std::fs::write(d.join("a.tags.tsv"), "spectrum\ttag\n").unwrap();
        // The run's end is its last heartbeat, not the outputs' mtimes (a
        // file written after the kill would move it).
        let later = history::now_ms() + 3_600_000;
        set_mtime(&m, 5000);
        set_mtime(&d.join("a.tags.tsv"), later);
        let got = recover(&app).pop().expect("the marker was not recovered");
        assert_eq!(got.status, Status::Failed);
        assert_eq!(got.message.as_deref(), Some(INTERRUPTED));
        assert_eq!(got.exit_code, None);
        // 5000, or now if a heartbeat came in between; never the output's.
        assert!(got.end >= got.start && got.end < later, "end {} is not the last heartbeat", got.end);
        assert!(markers(&app).is_empty(), "the marker stayed");
        // Recorded: the last-run line and the open-as-incomplete check see it.
        assert_eq!(history::list(&app, 1), vec![got.clone()]);
        assert_eq!(history::of_output(&app, &d.join("a.tags.tsv")).unwrap().status, Status::Failed);
        assert!(std::fs::read_to_string(app.join(history::FAILURE_LOG)).unwrap().contains(INTERRUPTED));
        // Once only; and a finished run's cleared marker is nothing.
        assert!(recover(&app).is_empty());
        let m = mark_running(&app, &r).unwrap();
        clear_running(&m);
        assert!(recover(&app).is_empty());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn leftovers_are_part_and_incomplete_files_and_an_interrupted_runs_outputs() {
        let d = tmp("list");
        let app = d.join("appdata");
        let tags = d.join("a.tags.tsv");
        let digest = d.join("a.digest.tsv");
        // An older failed run whose cleanup renamed the table, and a .part
        // a CLI left (Q3) next to the digest; then an interrupted run that
        // left its table at the final path.
        history::append(&app, &rec("1-1", &d, Status::Failed)).unwrap();
        history::append(&app, &interrupted("2-2", &d)).unwrap();
        std::fs::write(d.join("a.tags.tsv.incomplete"), "x").unwrap();
        std::fs::write(d.join("a.digest.tsv.part"), "x").unwrap();
        std::fs::write(&tags, "partial").unwrap();
        std::fs::write(&digest, "partial").unwrap();
        std::fs::write(d.join("a.mzML"), "spectra").unwrap();
        std::fs::write(d.join("unrelated.tsv.part"), "x").unwrap();
        assert_eq!(
            shown(&leftovers(&app)),
            shown(&[d.join("a.tags.tsv.incomplete"), tags.clone(), d.join("a.digest.tsv.part"), digest.clone()])
        );
        // A later finished run of the same paths: its table is a result.
        let mut ok = rec("3-3", &d, Status::Ok);
        ok.exit_code = Some(0);
        history::append(&app, &ok).unwrap();
        let after = leftovers(&app);
        assert!(!after.contains(&tags), "a later run's table offered for removal");
        assert!(after.contains(&d.join("a.tags.tsv.incomplete")));
        let _ = std::fs::remove_dir_all(&d);
    }

    // Only what the interrupted run itself wrote is offered: an output older
    // than its start (a confirmed earlier result it had not rewritten yet)
    // and one newer than its last heartbeat (remade after the kill) are
    // complete files.
    #[test]
    fn only_outputs_written_while_the_interrupted_run_was_alive_are_leftovers() {
        let d = tmp("alive");
        let app = d.join("appdata");
        let now = history::now_ms();
        let mut i = rec("1-1", &d, Status::Failed);
        i.message = Some(INTERRUPTED.into());
        i.outputs = vec!["a.tags.tsv".into(), "a.digest.tsv".into(), "a.species.tsv".into()];
        i.start = now - 600_000;
        i.end = now - 300_000;
        history::append(&app, &i).unwrap();
        let (older, newer, partial) = (d.join("a.tags.tsv"), d.join("a.digest.tsv"), d.join("a.species.tsv"));
        for f in [&older, &newer, &partial] {
            std::fs::write(f, "x").unwrap();
        }
        set_mtime(&older, now - 3_600_000);
        set_mtime(&newer, now - 300_000 + AFTER_HEARTBEAT_MS + 1000);
        set_mtime(&partial, now - 400_000);
        assert_eq!(shown(&leftovers(&app)), shown(std::slice::from_ref(&partial)));
        assert_eq!(sweep(&app, &[older.display().to_string(), newer.display().to_string()]).removed.len(), 0);
        assert!(older.exists() && newer.exists());
        let _ = std::fs::remove_dir_all(&d);
    }

    /// A marker of @p r in @p dir as the GUI @p host / @p pid writes it
    /// (None, None: a marker of 1.13.3), last refreshed @p age_ms ago.
    fn marker_at(dir: &Path, name: &str, r: &RunRecord, host: Option<&str>, pid: Option<u32>, age_ms: u64) -> PathBuf {
        std::fs::create_dir_all(dir).unwrap();
        let p = dir.join(format!("{MARKER_PREFIX}{name}.json"));
        let m = Marker { rec: r.clone(), host: host.map(String::from), pid };
        std::fs::write(&p, serde_json::to_vec(&m).unwrap()).unwrap();
        set_mtime(&p, history::now_ms() - age_ms);
        p
    }

    #[test]
    fn a_marker_names_its_host_and_process() {
        let d = tmp("owner");
        let app = d.join("appdata");
        let m = mark_running(&app, &rec("1-1", &d, Status::Ok)).unwrap();
        let mk: Marker = serde_json::from_slice(&std::fs::read(&m).unwrap()).unwrap();
        clear_running(&m);
        assert_eq!(mk.pid, Some(std::process::id()));
        assert_eq!(mk.host, host_name());
        assert!(host_name().is_some(), "no host name on this machine");
        assert!(pid_alive(std::process::id()));
        // A marker of 1.13.3 (no host, no pid) still reads.
        let old = serde_json::to_vec(&rec("1-1", &d, Status::Ok)).unwrap();
        let mk: Marker = serde_json::from_slice(&old).unwrap();
        assert_eq!((mk.host, mk.pid), (None, None));
        let _ = std::fs::remove_dir_all(&d);
    }

    // Startup recovery leaves a run alone that may still be live: one of
    // another machine (an app data folder on a share), of a process of this
    // machine that still runs, or a marker without owner whose heartbeat is
    // fresh. A run whose process has ended is recovered even with a fresh
    // heartbeat (it was killed a moment ago).
    #[test]
    fn recovery_leaves_the_markers_of_live_runs_alone() {
        let d = tmp("live");
        let app = d.join("appdata");
        let r = rec("1-1", &d, Status::Ok);
        let me = 4242;
        let running = |p: u32| p == 7;
        let other_host = marker_at(&app, "a", &r, Some("OTHER-PC"), Some(7), 60_000);
        let live_here = marker_at(&app, "b", &r, Some("THIS-PC"), Some(7), 60_000);
        let fresh_old = marker_at(&app, "c", &r, None, None, 1_000);
        let dead_fresh = marker_at(&app, "d", &r, Some("this-pc"), Some(8), 1_000);
        let stale_old = marker_at(&app, "e", &r, None, None, 60_000);
        let mine = marker_at(&app, "f", &r, Some("THIS-PC"), Some(me), 1_000);
        let got = recover_with(&app, Some("THIS-PC"), me, &running);
        assert_eq!(got.len(), 3, "recovered {got:?}");
        for m in [&other_host, &live_here, &fresh_old] {
            assert!(m.exists(), "{} was taken over", m.display());
        }
        for m in [&dead_fresh, &stale_old, &mine] {
            assert!(!m.exists(), "{} was not recovered", m.display());
        }
        assert_eq!(history::list(&app, 10).len(), 3);
        // The live run ends: its marker is recovered at the next start.
        assert_eq!(recover_with(&app, Some("THIS-PC"), me, &|_| false).len(), 1);
        assert!(!live_here.exists());
        assert!(other_host.exists(), "another machine's marker is that machine's");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn migrate_moves_the_run_data_once_and_never_overwrites() {
        let d = tmp("migrate");
        let (old, new) = (d.join("roaming"), d.join("local"));
        // Same folder (macOS, Linux): nothing to do.
        std::fs::create_dir_all(&old).unwrap();
        std::fs::write(old.join(history::HISTORY_FILE), "{}\n").unwrap();
        assert!(migrate(&old, &old).is_empty());
        assert!(old.join(history::HISTORY_FILE).exists());
        std::fs::write(old.join(history::FAILURE_LOG), "log").unwrap();
        std::fs::write(old.join(KEPT_FILE), "[]").unwrap();
        let r = rec("1-1", &d, Status::Ok);
        let stale = marker_at(&old, "1-1-0", &r, None, None, 60_000);
        let fresh = marker_at(&old, "1-2-0", &r, None, None, 0);
        let moved = migrate(&old, &new);
        assert_eq!(moved.len(), 4, "moved {moved:?}");
        for n in [history::HISTORY_FILE, history::FAILURE_LOG, KEPT_FILE] {
            assert!(new.join(n).is_file() && !old.join(n).exists(), "{n} not moved");
        }
        assert!(!stale.exists() && new.join(stale.file_name().unwrap()).exists());
        assert!(fresh.exists(), "a marker with a fresh heartbeat (a live 1.13 run) was moved");
        // The moved marker is recovered in its new folder.
        assert_eq!(recover(&new).len(), 1);
        // Once: a later file in the old folder never replaces the new one.
        let now = std::fs::read_to_string(new.join(history::FAILURE_LOG)).unwrap();
        std::fs::write(old.join(history::FAILURE_LOG), "older").unwrap();
        assert!(migrate(&old, &new).is_empty());
        assert_eq!(std::fs::read_to_string(new.join(history::FAILURE_LOG)).unwrap(), now);
        // No old folder: nothing.
        assert!(migrate(&d.join("none"), &new).is_empty());
        let _ = std::fs::remove_dir_all(&d);
    }

    // A live run's marker is refreshed (its heartbeat) until it is removed,
    // and never written again after that.
    #[test]
    fn a_live_runs_marker_beats_until_it_is_cleared() {
        let d = tmp("beat");
        let app = d.join("appdata");
        let m = mark_running(&app, &rec("1-1", &d, Status::Ok)).unwrap();
        set_mtime(&m, 5000);
        std::thread::sleep(HEARTBEAT + Duration::from_millis(700));
        assert!(mtime_ms(&m).unwrap() > history::now_ms() - 2 * HEARTBEAT.as_millis() as u64, "no heartbeat");
        clear_running(&m);
        std::thread::sleep(HEARTBEAT + Duration::from_millis(700));
        assert!(!m.exists(), "the heartbeat brought a cleared marker back");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn the_input_is_never_a_leftover() {
        let d = tmp("input");
        let app = d.join("appdata");
        let mut i = interrupted("1-1", &d);
        i.outputs = vec!["a.mzML".into()];
        history::append(&app, &i).unwrap();
        std::fs::write(d.join("a.mzML"), "spectra").unwrap();
        assert!(leftovers(&app).is_empty());
        assert!(sweep(&app, &[d.join("a.mzML").display().to_string()]).removed.is_empty());
        assert!(d.join("a.mzML").exists());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn sweep_removes_only_listed_leftovers_and_keep_hides_them() {
        let d = tmp("sweep");
        let app = d.join("appdata");
        history::append(&app, &rec("1-1", &d, Status::Failed)).unwrap();
        let inc = d.join("a.tags.tsv.incomplete");
        let part = d.join("a.digest.tsv.part");
        let other = d.join("results.tsv");
        for f in [&inc, &part, &other] {
            std::fs::write(f, "x").unwrap();
        }
        // A failed (not interrupted) run's outputs at their final paths are
        // not leftovers: its own cleanup removed them when it ended, so a
        // file there now is newer.
        let table = d.join("a.tags.tsv");
        std::fs::write(&table, "a later table").unwrap();
        assert_eq!(shown(&leftovers(&app)), shown(&[inc.clone(), part.clone()]));
        // A crafted request for a file that is no leftover is refused.
        let c = sweep(&app, &[inc.display().to_string(), other.display().to_string()]);
        assert_eq!(c.removed, vec![inc.display().to_string()]);
        assert_eq!(c.failed, vec![other.display().to_string()]);
        assert!(!inc.exists() && other.exists());
        // Kept: not offered again, and not removable by a later sweep.
        keep(&app, &[part.display().to_string(), other.display().to_string()]).unwrap();
        assert!(leftovers(&app).is_empty());
        assert_eq!(sweep(&app, &[part.display().to_string()]).failed.len(), 1);
        assert!(part.exists());
        assert_eq!(kept(&app), vec![part.display().to_string()]);
        let _ = std::fs::remove_dir_all(&d);
    }
}
