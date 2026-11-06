// Startup sweep (GUI-DESIGN 6.4 and 6.6, P1 PR b): files an unfinished run
// left behind are offered for removal when the app starts.
//
// A run that is cancelled or fails is cleaned up when it ends (outputs.rs),
// but a run whose GUI was killed is not: the CLI ends with the GUI
// (lifetime.rs), and its partial outputs stay at their final paths with no
// run record. So `run` writes a marker, <app data>/running-<n>.json, before
// the CLI starts and removes it when the run has ended; at the next start
// recover() turns a marker that is still there into a Failed run record
// ("interrupted"). One marker per run: a run refused because another is live
// removes its own marker, never the live run's.
// leftovers() then lists, for the recorded runs:
// - <output>.part (a CLI that writes to .part and renames on success, Q3,
//   killed before the rename) and <output>.incomplete (an output the
//   cleanup could not delete and renamed);
// - the outputs at their final paths of an interrupted run, unless a later
//   run wrote the same path.
// The renderer shows them and the user removes or keeps them. Only paths
// that leftovers() lists are ever removed (the renderer is untrusted), and
// a run's input never is.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use tauri::AppHandle;

use crate::history::{self, RunRecord, Status};
use crate::outputs::{self, Cleanup};

/// The markers of the runs in progress, in app data: <prefix><n>.json.
const MARKER_PREFIX: &str = "running-";
/// The leftovers the user chose to keep: not offered again.
pub const KEPT_FILE: &str = "leftovers-kept.json";
/// The message of the record of a run the app did not see end.
pub const INTERRUPTED: &str = "interrupted: the app ended while this run was in progress";

/// How many recorded runs are searched for leftovers.
const RUNS_SEARCHED: usize = 500;

/// Write a marker of @p rec, the run about to start (temp file and rename,
/// so a killed app never leaves half of it). Returns its path.
pub fn mark_running(dir: &Path, rec: &RunRecord) -> std::io::Result<PathBuf> {
    static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    std::fs::create_dir_all(dir)?;
    let n = SEQ.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    let path = dir.join(format!("{MARKER_PREFIX}{}-{}-{n}.json", rec.start, std::process::id()));
    let mut tmp = path.clone().into_os_string();
    tmp.push(".tmp");
    std::fs::write(&tmp, serde_json::to_vec(rec).map_err(std::io::Error::other)?)?;
    std::fs::rename(&tmp, &path)?;
    Ok(path)
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

/// At startup: a marker left by an earlier session is a run the app did not
/// see end. Each is recorded as Failed (INTERRUPTED), with the last change
/// of any of its outputs as its end, and the marker goes. Returns those
/// records.
pub fn recover(dir: &Path) -> Vec<RunRecord> {
    markers(dir).iter().filter_map(|m| recover_one(dir, m)).collect()
}

fn recover_one(dir: &Path, marker: &Path) -> Option<RunRecord> {
    let text = std::fs::read(marker).ok()?;
    let _ = std::fs::remove_file(marker);
    let mut rec: RunRecord = serde_json::from_slice(&text).ok()?;
    rec.status = Status::Failed;
    rec.exit_code = None;
    rec.message = Some(INTERRUPTED.to_string());
    let last_write = rec
        .output_paths()
        .iter()
        .filter_map(|p| std::fs::metadata(p).and_then(|m| m.modified()).ok())
        .filter_map(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .max();
    rec.end = last_write.unwrap_or(rec.start).max(rec.start);
    history::append(dir, &rec).ok()?;
    let _ = history::write_failure_log(dir, &rec, &[]);
    Some(rec)
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
            if interrupted && !newer.contains(&p) {
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
        }
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
        assert_eq!(markers(&app), vec![m]);
        std::fs::write(d.join("a.tags.tsv"), "spectrum\ttag\n").unwrap();
        let got = recover(&app).pop().expect("the marker was not recovered");
        assert_eq!(got.status, Status::Failed);
        assert_eq!(got.message.as_deref(), Some(INTERRUPTED));
        assert_eq!(got.exit_code, None);
        assert!(got.end >= got.start);
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
        let mut i = rec("2-2", &d, Status::Failed);
        i.message = Some(INTERRUPTED.into());
        history::append(&app, &i).unwrap();
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

    #[test]
    fn the_input_is_never_a_leftover() {
        let d = tmp("input");
        let app = d.join("appdata");
        let mut i = rec("1-1", &d, Status::Failed);
        i.message = Some(INTERRUPTED.into());
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
