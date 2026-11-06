// Resolved outputs and "Reveal in Finder / Explorer" (GUI-DESIGN 6.3, P0b:
// -out only; the full table follows in P1).
//
// The renderer never names a path to the opener plugin itself: it asks
// `reveal_output`, and the backend reveals the file (or opens its folder)
// only when that file is an output of a run of this app -- one started in
// this session (RunManager.revealable) or one in the run record
// (history.jsonl). capabilities/default.json grants the renderer no opener
// permission for paths, so this check is the whole scope.

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

use crate::fastag::RunManager;
use crate::history;

/// The outputs of a run as the CLI writes them: absolute, resolved against
/// the child's cwd exactly as `outputs::resolve` does for the cleanup.
#[derive(Serialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedOutputs {
    /// -out.
    pub out: Option<String>,
}

/// The value of option @p name in @p args (build_args order: `-name value`).
fn arg_value<'a>(args: &'a [String], name: &str) -> Option<&'a str> {
    let flag = format!("-{name}");
    args.iter().position(|a| *a == flag).and_then(|i| args.get(i + 1)).map(String::as_str)
}

/// ResolvedOutputs of @p args (the argv without the binary) for a child that
/// runs in @p cwd.
pub fn resolved(args: &[String], cwd: Option<&Path>) -> ResolvedOutputs {
    let out = arg_value(args, "out")
        .filter(|v| !v.is_empty())
        .map(|v| crate::outputs::resolve(&[v.to_string()], cwd).remove(0).display().to_string());
    ResolvedOutputs { out }
}

fn canonical(p: &Path) -> Option<PathBuf> {
    std::fs::canonicalize(p).ok()
}

/// @p path may be revealed: it is an existing regular file and the same file
/// as one of @p allowed (compared canonically, so `a/../b` and symlinks do
/// not widen the set).
pub fn is_revealable(path: &Path, allowed: &[PathBuf]) -> bool {
    let Some(want) = canonical(path) else { return false };
    if !want.is_file() {
        return false;
    }
    allowed.iter().filter_map(|a| canonical(a)).any(|a| a == want)
}

/// Every output this app may reveal: this session's runs, then the record.
fn allowed(app: &AppHandle, mgr: &RunManager) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = mgr.revealable.lock().map(|r| r.clone()).unwrap_or_default();
    if let Some(dir) = history::dir(app) {
        for rec in history::list(&dir, 1000) {
            v.extend(rec.output_paths());
        }
    }
    v
}

/// Reveal @p path in the file manager (@p folder false), or open the folder
/// that holds it (@p folder true), if it is an output of a run of this app.
#[tauri::command]
pub fn reveal_output(app: AppHandle, state: State<'_, RunManager>, path: String, folder: bool) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !is_revealable(&p, &allowed(&app, &state)) {
        return Err(format!("{path} is not an output of a run of this app"));
    }
    if folder {
        let dir = p.parent().ok_or_else(|| format!("{path} has no folder"))?;
        app.opener().open_path(dir.display().to_string(), None::<&str>).map_err(|e| e.to_string())
    } else {
        app.opener().reveal_item_in_dir(&p).map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }

    #[test]
    fn out_is_resolved_against_the_cwd() {
        let a = s(&["-in", "/d/a.mzML", "-out", "/d/a.tags.tsv", "-progress"]);
        assert_eq!(resolved(&a, Some(Path::new("/d"))).out.as_deref(), Some("/d/a.tags.tsv"));
        let rel = s(&["-in", "a.mzML", "-out", "a.tags.tsv"]);
        assert_eq!(
            resolved(&rel, Some(Path::new("/w"))).out,
            Some(Path::new("/w").join("a.tags.tsv").display().to_string())
        );
        assert_eq!(resolved(&rel, None).out.as_deref(), Some("a.tags.tsv"));
        assert_eq!(resolved(&s(&["-in", "a"]), None).out, None);
    }

    #[test]
    fn only_the_runs_own_outputs_are_revealable() {
        let d = std::env::temp_dir().join(format!("fastag-reveal-{}", std::process::id()));
        std::fs::create_dir_all(d.join("sub")).unwrap();
        let out = d.join("a.tags.tsv");
        let other = d.join("b.tags.tsv");
        std::fs::write(&out, "x").unwrap();
        std::fs::write(&other, "x").unwrap();
        let allowed = vec![out.clone()];
        assert!(is_revealable(&out, &allowed));
        // The same file by another spelling.
        assert!(is_revealable(&d.join("sub").join("..").join("a.tags.tsv"), &allowed));
        // Anything else, its folder, or a missing output: no.
        assert!(!is_revealable(&other, &allowed));
        assert!(!is_revealable(&d, std::slice::from_ref(&d)));
        assert!(!is_revealable(&d.join("gone.tsv"), &[d.join("gone.tsv")]));
        #[cfg(unix)]
        {
            // A symlink to another file is that file, not the output.
            let link = d.join("link.tsv");
            std::os::unix::fs::symlink(&other, &link).unwrap();
            assert!(!is_revealable(&link, &allowed));
            assert!(is_revealable(&link, std::slice::from_ref(&other)));
        }
        std::fs::remove_dir_all(&d).ok();
    }
}
