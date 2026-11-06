// The files a run writes, resolved from the argv it was given, and their
// cleanup when the run is cancelled or fails (GUI-DESIGN 6.4, P0a).
//
// The argv is not changed: the CLI writes its outputs in place, exactly as a
// cluster user's command line would. When a run does not finish, every output
// it was going to write is deleted, or renamed to <name>.incomplete if it
// cannot be deleted, so no truncated file is later read as a result. A file
// that existed before the run and that the run did not touch is left alone.

use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde::Serialize;

/// The output-file options of FASTag (FASTag.cpp registerOutputFile_), in the
/// order the CLI lists them in its own output-collision check.
const OUTPUT_OPTIONS: [&str; 10] = [
    "out",
    "out_spectra",
    "recon_out",
    "delta_out",
    "recon_id_out",
    "digest_out",
    "label_out",
    "massgap_out",
    "glyco_out",
    "species_out",
];

/// <out> with its final extension (a dot inside the basename) replaced by
/// @p suffix: FASTag.cpp defaultReportPath.
fn default_report_path(out: &str, suffix: &str) -> String {
    let slash = out.rfind(['/', '\\']);
    match out.rfind('.') {
        Some(dot) if slash.is_none_or(|s| dot > s) => format!("{}{suffix}", &out[..dot]),
        _ => format!("{out}{suffix}"),
    }
}

/// Every file the CLI writes for @p args (as build_args produced them, the
/// binary not included): each output-file option with a value, plus the
/// species and glyco reports the CLI derives from -out when -species or
/// -glyco is on without a path of their own (FASTag.cpp 1928-1937). Paths
/// are as the child sees them; relative ones are relative to its cwd.
pub fn resolved_outputs(args: &[String]) -> Vec<String> {
    let mut found: Vec<(&str, String)> = Vec::new();
    let mut flags: Vec<&str> = Vec::new();
    let mut i = 0;
    while i < args.len() {
        let a = args[i].as_str();
        if let Some(name) = a.strip_prefix('-') {
            if let Some(opt) = OUTPUT_OPTIONS.iter().find(|o| **o == name) {
                if let Some(v) = args.get(i + 1) {
                    found.push((opt, v.clone()));
                }
                i += 2;
                continue;
            }
            flags.push(name);
        }
        i += 1;
    }
    let get = |opt: &str| found.iter().find(|(o, _)| *o == opt).map(|(_, v)| v.clone()).unwrap_or_default();
    let out = get("out");
    let mut paths: Vec<String> = found.iter().map(|(_, v)| v.clone()).collect();
    // -species writes its report also without -species_out (and -taxdb plus
    // -species_out turns it on); -glyco likewise without -glyco_out.
    if flags.contains(&"glyco") && get("glyco_out").is_empty() && !out.is_empty() {
        paths.push(default_report_path(&out, ".glyco.tsv"));
    }
    if flags.contains(&"species") && get("species_out").is_empty() && !out.is_empty() {
        paths.push(default_report_path(&out, ".species.tsv"));
    }
    let mut seen = std::collections::HashSet::new();
    paths.retain(|p| !p.is_empty() && seen.insert(p.clone()));
    paths
}

/// What an output path held before the run.
#[derive(Debug, Clone, PartialEq)]
pub enum Before {
    /// Nothing at the path.
    Absent,
    /// A regular file of this size and modification time.
    File(u64, Option<SystemTime>),
    /// Something that is not a regular file (/dev/null, a folder): never touched.
    Other,
}

fn state_of(p: &Path) -> Before {
    match std::fs::metadata(p) {
        Err(_) => Before::Absent,
        Ok(m) if m.is_file() => Before::File(m.len(), m.modified().ok()),
        Ok(_) => Before::Other,
    }
}

/// The state of each output before the child is started.
pub fn snapshot(paths: &[String], cwd: Option<&Path>) -> Vec<(PathBuf, Before)> {
    paths
        .iter()
        .map(|p| {
            let path = match cwd {
                Some(d) if Path::new(p).is_relative() => d.join(p),
                _ => PathBuf::from(p),
            };
            let before = state_of(&path);
            (path, before)
        })
        .collect()
}

/// What the cleanup did, for the done event and the log.
#[derive(Debug, Default, Serialize, PartialEq)]
pub struct Cleanup {
    /// Deleted.
    pub removed: Vec<String>,
    /// Could not be deleted: renamed to <name>.incomplete (the new name).
    pub renamed: Vec<String>,
    /// Neither deleted nor renamed: still at its path, possibly truncated.
    pub failed: Vec<String>,
}

#[cfg(test)]
impl Cleanup {
    pub fn is_empty(&self) -> bool {
        self.removed.is_empty() && self.renamed.is_empty() && self.failed.is_empty()
    }
}

/// <path>.incomplete
pub fn incomplete_name(p: &Path) -> PathBuf {
    let mut s = p.as_os_str().to_owned();
    s.push(".incomplete");
    PathBuf::from(s)
}

/// Remove the outputs a run that did not finish left behind: every regular
/// file at an output path, except one that was there before the run and is
/// unchanged (same size and mtime). @p input is never touched.
pub fn cleanup(snap: &[(PathBuf, Before)], input: &Path) -> Cleanup {
    cleanup_with(snap, input, |p| std::fs::remove_file(p), |a, b| std::fs::rename(a, b))
}

pub fn cleanup_with(
    snap: &[(PathBuf, Before)],
    input: &Path,
    remove: impl Fn(&Path) -> std::io::Result<()>,
    rename: impl Fn(&Path, &Path) -> std::io::Result<()>,
) -> Cleanup {
    let mut c = Cleanup::default();
    let same_as_input = |p: &Path| p == input || matches!((p.canonicalize(), input.canonicalize()), (Ok(a), Ok(b)) if a == b);
    for (path, before) in snap {
        if *before == Before::Other || same_as_input(path) {
            continue;
        }
        let now = state_of(path);
        let Before::File(..) = now else { continue };
        if now == *before {
            continue; // there before the run and not written by it
        }
        let shown = path.display().to_string();
        if remove(path).is_ok() {
            c.removed.push(shown);
            continue;
        }
        let to = incomplete_name(path);
        if rename(path, &to).is_ok() {
            c.renamed.push(to.display().to_string());
        } else {
            c.failed.push(shown);
        }
    }
    c
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(a: &[&str]) -> Vec<String> {
        a.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn resolves_every_output_option_and_the_derived_reports() {
        let args = v(&[
            "-in", "/d/a.mzML", "-out", "/d/a.tags.tsv", "-species", "-glyco", "-digest_out", "/d/a.digest.tsv",
            "-tag_length", "3", "-progress",
        ]);
        assert_eq!(
            resolved_outputs(&args),
            v(&["/d/a.tags.tsv", "/d/a.digest.tsv", "/d/a.tags.glyco.tsv", "/d/a.tags.species.tsv"])
        );
        // Explicit report paths win over the derived ones; no duplicates.
        let args = v(&["-in", "i", "-out", "o.tsv", "-species", "-species_out", "s.tsv", "-label_out", "o.tsv"]);
        assert_eq!(resolved_outputs(&args), v(&["o.tsv", "s.tsv"]));
        // A dotted folder keeps its name (FASTag.cpp defaultReportPath).
        assert_eq!(default_report_path("/runs.2026/x", ".species.tsv"), "/runs.2026/x.species.tsv");
        assert_eq!(default_report_path("C:\\r.1\\x.tsv", ".glyco.tsv"), "C:\\r.1\\x.glyco.tsv");
        // No -out: nothing derived.
        assert!(resolved_outputs(&v(&["-in", "i", "-species"])).is_empty());
    }

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("fastag-outputs-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn cleanup_removes_new_and_rewritten_files_but_keeps_untouched_ones() {
        let d = tmp("keep");
        let new = d.join("new.tsv");
        let rewritten = d.join("rewritten.tsv");
        let untouched = d.join("untouched.tsv");
        let never = d.join("never.tsv");
        let input = d.join("a.mzML");
        std::fs::write(&rewritten, "old complete table\n").unwrap();
        std::fs::write(&untouched, "an earlier result\n").unwrap();
        std::fs::write(&input, "spectra").unwrap();
        let paths: Vec<String> = [&new, &rewritten, &untouched, &never, &input].iter().map(|p| p.display().to_string()).collect();
        let snap = snapshot(&paths, None);
        // The run: writes new, truncates rewritten.
        std::fs::write(&new, "spectrum\ttag\n").unwrap();
        std::fs::write(&rewritten, "x").unwrap();
        let c = cleanup(&snap, &input);
        assert_eq!(c.removed, vec![new.display().to_string(), rewritten.display().to_string()]);
        assert!(c.renamed.is_empty() && c.failed.is_empty());
        assert!(!new.exists() && !rewritten.exists());
        assert!(untouched.exists(), "an earlier file the run never wrote is kept");
        assert!(input.exists(), "the input is never touched");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn cleanup_renames_what_it_cannot_delete() {
        let d = tmp("rename");
        let out = d.join("a.tags.tsv");
        let snap = snapshot(&[out.display().to_string()], None);
        std::fs::write(&out, "partial").unwrap();
        let denied = |_: &Path| Err(std::io::Error::from(std::io::ErrorKind::PermissionDenied));
        let c = cleanup_with(&snap, Path::new("/nonexistent/in.mzML"), denied, |a, b| std::fs::rename(a, b));
        assert_eq!(c.renamed, vec![format!("{}.incomplete", out.display())]);
        assert!(!out.exists() && d.join("a.tags.tsv.incomplete").exists());
        // Neither works: reported, not hidden.
        std::fs::write(&out, "partial").unwrap();
        let c = cleanup_with(&snap, Path::new("/x"), denied, |_, _| Err(std::io::Error::from(std::io::ErrorKind::PermissionDenied)));
        assert_eq!(c.failed, vec![out.display().to_string()]);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[cfg(unix)]
    #[test]
    fn cleanup_never_touches_a_device() {
        let snap = snapshot(&["/dev/null".to_string()], None);
        assert_eq!(snap[0].1, Before::Other);
        assert!(cleanup(&snap, Path::new("/x")).is_empty());
        assert!(Path::new("/dev/null").exists());
    }

    #[test]
    fn relative_outputs_resolve_against_the_child_cwd() {
        let d = tmp("rel");
        let snap = snapshot(&["r.tsv".to_string()], Some(&d));
        assert_eq!(snap[0].0, d.join("r.tsv"));
        let _ = std::fs::remove_dir_all(&d);
    }
}
