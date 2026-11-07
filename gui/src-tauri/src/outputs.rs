// The files a run writes, resolved from the argv it was given, and their
// cleanup when the run is cancelled or fails (GUI-DESIGN 6.4, P0a).
//
// The argv is not changed: the CLI writes its outputs in place, exactly as a
// cluster user's command line would. A file already at an output path is
// confirmed before the run (existing, and RunParams.overwrite), never after.
// When a run does not finish, every file at its output paths is deleted, or
// renamed to <name>.incomplete if it cannot be deleted, so no truncated file,
// and no report of an earlier run, is later read as this run's result.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

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
/// binary not included), with the option that names it: each output-file
/// option with a value, plus the species and glyco reports the CLI derives
/// from -out when -species or -glyco is on without a path of their own
/// (FASTag.cpp 1928-1937), under species_out and glyco_out. Paths are as the
/// child sees them; relative ones are relative to its cwd. In the CLI's
/// order, derived reports last, without empty values.
pub fn outputs_by_option(args: &[String]) -> Vec<(&'static str, String)> {
    let mut found: Vec<(&'static str, String)> = Vec::new();
    let mut flags: Vec<&str> = Vec::new();
    let mut i = 0;
    while i < args.len() {
        let a = args[i].as_str();
        if let Some(name) = a.strip_prefix('-') {
            if let Some(opt) = OUTPUT_OPTIONS.iter().find(|o| **o == name) {
                if let Some(v) = args.get(i + 1) {
                    found.push((*opt, v.clone()));
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
    // -species writes its report also without -species_out (and -taxdb plus
    // -species_out turns it on); -glyco likewise without -glyco_out.
    let glyco = flags.contains(&"glyco") && get("glyco_out").is_empty() && !out.is_empty();
    let species = flags.contains(&"species") && get("species_out").is_empty() && !out.is_empty();
    if glyco {
        found.push(("glyco_out", default_report_path(&out, ".glyco.tsv")));
    }
    if species {
        found.push(("species_out", default_report_path(&out, ".species.tsv")));
    }
    found.retain(|(_, v)| !v.is_empty());
    found
}

/// Every file the CLI writes for @p args (outputs_by_option), each once.
pub fn resolved_outputs(args: &[String]) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    outputs_by_option(args).into_iter().map(|(_, p)| p).filter(|p| seen.insert(p.clone())).collect()
}

/// Every output path as the child sees it: a relative one joined to @p cwd.
pub fn resolve(paths: &[String], cwd: Option<&Path>) -> Vec<PathBuf> {
    paths
        .iter()
        .map(|p| match cwd {
            Some(d) if Path::new(p).is_relative() => d.join(p),
            _ => PathBuf::from(p),
        })
        .collect()
}

fn is_regular_file(p: &Path) -> bool {
    std::fs::metadata(p).is_ok_and(|m| m.is_file())
}

fn same_file(a: &Path, b: &Path) -> bool {
    a == b || matches!((a.canonicalize(), b.canonicalize()), (Ok(x), Ok(y)) if x == y)
}

/// The outputs that already hold a regular file before the run: the GUI asks
/// before it overwrites them (GUI-DESIGN 6.4, "a file that already exists is
/// confirmed before the run, never after"). @p input is never an output.
pub fn existing(paths: &[PathBuf], input: &Path) -> Vec<PathBuf> {
    paths.iter().filter(|p| is_regular_file(p) && !same_file(p, input)).cloned().collect()
}

/// What the cleanup did, for the done event, the log and the run record.
#[derive(Debug, Default, Clone, Serialize, Deserialize, PartialEq)]
pub struct Cleanup {
    /// Deleted.
    pub removed: Vec<String>,
    /// Could not be deleted: renamed to <name>.incomplete (the new name).
    pub renamed: Vec<String>,
    /// Neither deleted nor renamed: still at its path, possibly truncated.
    pub failed: Vec<String>,
}

// Only the Unix tests use it (cleanup_never_touches_a_device).
#[cfg(all(test, unix))]
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

/// Remove what a run that did not finish leaves at its output paths: every
/// regular file at one of @p paths. A file that was there before the run was
/// confirmed for overwriting before it started (start_run refuses otherwise),
/// so it is this run's output too: after a cancel or failure no file, of this
/// run or an earlier one, is left at a resolved output path, and no report of
/// an earlier run sits next to this run's missing table. @p input and
/// anything that is not a regular file (/dev/null, a folder) are never
/// touched.
pub fn cleanup(paths: &[PathBuf], input: &Path) -> Cleanup {
    cleanup_with(paths, input, |p| std::fs::remove_file(p), |a, b| std::fs::rename(a, b))
}

pub fn cleanup_with(
    paths: &[PathBuf],
    input: &Path,
    remove: impl Fn(&Path) -> std::io::Result<()>,
    rename: impl Fn(&Path, &Path) -> std::io::Result<()>,
) -> Cleanup {
    let mut c = Cleanup::default();
    for path in paths {
        if !is_regular_file(path) || same_file(path, input) {
            continue;
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
    fn existing_lists_the_files_to_confirm_but_never_the_input() {
        let d = tmp("existing");
        let earlier = d.join("a.tags.tsv");
        let input = d.join("a.mzML");
        std::fs::write(&earlier, "an earlier result\n").unwrap();
        std::fs::write(&input, "spectra").unwrap();
        let paths = resolve(&v(&["a.tags.tsv", "a.digest.tsv", "a.mzML"]), Some(&d));
        assert_eq!(existing(&paths, &input), vec![earlier.clone()]);
        let _ = std::fs::remove_dir_all(&d);
    }

    // Replaces cleanup_removes_new_and_rewritten_files_but_keeps_untouched_ones:
    // a file that was there before the run was confirmed for overwriting, so
    // it goes too, whether the run rewrote it, truncated it or never got to it
    // (no earlier report is left next to this run's missing table).
    #[test]
    fn cleanup_removes_every_file_at_an_output_path_but_never_the_input() {
        let d = tmp("all");
        let new = d.join("new.tsv");
        let rewritten = d.join("rewritten.tsv");
        let untouched = d.join("untouched.tsv");
        let never = d.join("never.tsv");
        let input = d.join("a.mzML");
        std::fs::write(&rewritten, "old complete table\n").unwrap();
        std::fs::write(&untouched, "an earlier result\n").unwrap();
        std::fs::write(&input, "spectra").unwrap();
        let paths = vec![new.clone(), rewritten.clone(), untouched.clone(), never.clone(), input.clone()];
        // The run: writes new, truncates rewritten, has not reached untouched.
        std::fs::write(&new, "spectrum\ttag\n").unwrap();
        std::fs::write(&rewritten, "x").unwrap();
        let c = cleanup(&paths, &input);
        assert_eq!(
            c.removed,
            vec![new.display().to_string(), rewritten.display().to_string(), untouched.display().to_string()]
        );
        assert!(c.renamed.is_empty() && c.failed.is_empty());
        assert!(!new.exists() && !rewritten.exists() && !untouched.exists() && !never.exists());
        assert!(input.exists(), "the input is never touched");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn cleanup_renames_what_it_cannot_delete() {
        let d = tmp("rename");
        let out = d.join("a.tags.tsv");
        let paths = vec![out.clone()];
        std::fs::write(&out, "partial").unwrap();
        let denied = |_: &Path| Err(std::io::Error::from(std::io::ErrorKind::PermissionDenied));
        let c = cleanup_with(&paths, Path::new("/nonexistent/in.mzML"), denied, |a, b| std::fs::rename(a, b));
        assert_eq!(c.renamed, vec![format!("{}.incomplete", out.display())]);
        assert!(!out.exists() && d.join("a.tags.tsv.incomplete").exists());
        // Neither works: reported, not hidden.
        std::fs::write(&out, "partial").unwrap();
        let c = cleanup_with(&paths, Path::new("/x"), denied, |_, _| Err(std::io::Error::from(std::io::ErrorKind::PermissionDenied)));
        assert_eq!(c.failed, vec![out.display().to_string()]);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[cfg(unix)]
    #[test]
    fn cleanup_never_touches_a_device() {
        let paths = resolve(&["/dev/null".to_string()], None);
        assert!(existing(&paths, Path::new("/x")).is_empty());
        assert!(cleanup(&paths, Path::new("/x")).is_empty());
        assert!(Path::new("/dev/null").exists());
    }

    #[test]
    fn relative_outputs_resolve_against_the_child_cwd() {
        let d = tmp("rel");
        let abs = if cfg!(windows) { "C:/abs/r.tsv" } else { "/abs/r.tsv" };
        let paths = resolve(&["r.tsv".to_string(), abs.to_string()], Some(&d));
        assert_eq!(paths, vec![d.join("r.tsv"), PathBuf::from(abs)]);
        let _ = std::fs::remove_dir_all(&d);
    }
}
