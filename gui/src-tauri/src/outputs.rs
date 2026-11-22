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

/// The output-file options of FASTag, from the manifest the GUI is built
/// against (gui/src/params.generated.json, generated from the CLI's own
/// -write_ini): every `output-file` parameter, so a report a new workflow
/// writes (qc_out, shortlist_out, census_*, ...) is confirmed before it is
/// overwritten, cleaned up after a failed or cancelled run, recorded and
/// revealable like the tags table.
static MANIFEST: &str = include_str!("../../src/params.generated.json");

pub fn output_options() -> &'static [String] {
    static OPTIONS: std::sync::OnceLock<Vec<String>> = std::sync::OnceLock::new();
    OPTIONS.get_or_init(|| {
        let m: serde_json::Value = serde_json::from_str(MANIFEST).expect("params.generated.json is JSON");
        let mut o: Vec<String> = m["params"]
            .as_array()
            .map(|ps| {
                ps.iter()
                    .filter(|p| p["type"] == "output-file")
                    .filter_map(|p| p["name"].as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default();
        // The tag graph outputs the backend adds itself (fastag.rs with_tag_graph),
        // whether or not the manifest's CLI has them.
        for t in TAG_GRAPH_OUTPUTS {
            if !o.iter().any(|x| x == t.0) {
                o.push(t.0.to_string());
            }
        }
        o
    })
}

/// The tag graph tables of a run (-resolved_out, -tag_graph_out), written
/// beside the tags as <stem><suffix> when the CLI has both options.
pub const TAG_GRAPH_OUTPUTS: [(&str, &str); 2] = [("resolved_out", ".resolved.tsv"), ("tag_graph_out", ".taggraph.tsv")];

/// The input-file options of FASTag (the manifest's `input-file` parameters,
/// -in among them): the spectra, the databases (fasta, recon_fasta,
/// shortlist_background, ...), the identification file and the taxonomy. A
/// run never writes one of them and its cleanup never removes one.
pub fn input_options() -> &'static [String] {
    static OPTIONS: std::sync::OnceLock<Vec<String>> = std::sync::OnceLock::new();
    OPTIONS.get_or_init(|| {
        let m: serde_json::Value = serde_json::from_str(MANIFEST).expect("params.generated.json is JSON");
        m["params"]
            .as_array()
            .map(|ps| {
                ps.iter()
                    .filter(|p| p["type"] == "input-file")
                    .filter_map(|p| p["name"].as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default()
    })
}

/// The names -alkylation_proteome takes for a shipped proteome; any other
/// value is the path of a FASTA the user supplies (a string option in the
/// manifest, yet a file the run reads).
pub const PROTEOME_NAMES: [&str; 5] = ["auto", "human", "mouse", "yeast", "ecoli"];

/// @p value of -alkylation_proteome names a file, not a shipped proteome.
pub fn is_proteome_file(value: &str) -> bool {
    let v = value.trim();
    !v.is_empty() && !PROTEOME_NAMES.contains(&v.to_ascii_lowercase().as_str())
}

/// Every file @p args (as build_args produced them) reads: the value of each
/// input-file option, -in included, and a FASTA given as
/// -alkylation_proteome, without empty ones.
pub fn inputs_of(args: &[String]) -> Vec<String> {
    let options = input_options();
    let mut found = Vec::new();
    let mut i = 0;
    while i < args.len() {
        if let Some(name) = args[i].strip_prefix('-') {
            let file_valued = options.iter().any(|o| o == name)
                || (name == "alkylation_proteome" && args.get(i + 1).is_some_and(|v| is_proteome_file(v)));
            if file_valued {
                if let Some(v) = args.get(i + 1).filter(|v| !v.is_empty()) {
                    found.push(v.clone());
                }
                i += 2;
                continue;
            }
        }
        i += 1;
    }
    found
}

/// The reports the CLI derives from -out when a switch is on without a path
/// of their own (FASTag.cpp defaultReportPath): (switch, option, suffix).
const DERIVED: [(&str, &str, &str); 4] = [
    ("glyco", "glyco_out", ".glyco.tsv"),
    ("species", "species_out", ".species.tsv"),
    ("census", "census_out", ".census.tsv"),
    ("census", "census_summary_out", ".census_summary.tsv"),
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
/// option with a value, plus the reports the CLI derives from -out when
/// their switch is on without a path of their own (DERIVED: species, glyco,
/// and the census table and summary), under their own option. Paths are as
/// the child sees them; relative ones are relative to its cwd. In argv
/// order, derived reports last, without empty values.
pub fn outputs_by_option(args: &[String]) -> Vec<(&'static str, String)> {
    let options = output_options();
    let mut found: Vec<(&'static str, String)> = Vec::new();
    let mut flags: Vec<&str> = Vec::new();
    let mut i = 0;
    while i < args.len() {
        let a = args[i].as_str();
        if let Some(name) = a.strip_prefix('-') {
            if let Some(opt) = options.iter().find(|o| o.as_str() == name) {
                if let Some(v) = args.get(i + 1) {
                    found.push((opt.as_str(), v.clone()));
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
    let mut derived: Vec<(&'static str, String)> = Vec::new();
    if !out.is_empty() {
        for (flag, opt, suffix) in DERIVED {
            if flags.contains(&flag) && get(opt).is_empty() {
                derived.push((opt, default_report_path(&out, suffix)));
            }
        }
    }
    found.extend(derived);
    found.retain(|(_, v)| !v.is_empty());
    found
}

/// Every file a run reads, resolved as the child sees it: -in, each input of
/// @p args (inputs_of) and @p protect, the inputs of the other jobs of its
/// batch, which no job may write either (one job's output must not be the
/// input a later job reads). The one set the clash check, the overwrite
/// check, the cleanup of a failed run and Export INI compare against.
pub fn run_inputs(input: &str, args: &[String], protect: &[String], cwd: Option<&Path>) -> Vec<PathBuf> {
    let mut all = vec![input.to_string()];
    all.extend(inputs_of(args));
    all.extend(protect.iter().filter(|p| !p.trim().is_empty()).cloned());
    resolve(&all, cwd)
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

fn is_input(p: &Path, inputs: &[PathBuf]) -> bool {
    inputs.iter().any(|i| same_file(p, i))
}

/// The outputs that name the same file as one of @p inputs (compared as
/// canonical paths): a run that wrote one would destroy what it reads, so it
/// is refused before it starts (the CLI's OutputGuard refuses it too, and
/// the cleanup of that failed run must not then remove the input).
pub fn clashes(paths: &[PathBuf], inputs: &[PathBuf]) -> Vec<PathBuf> {
    paths.iter().filter(|p| is_input(p, inputs)).cloned().collect()
}

/// The refusal of a run with an output that is one of its inputs.
pub fn clash_reason(clash: &[PathBuf]) -> String {
    let list: Vec<String> = clash.iter().map(|p| p.display().to_string()).collect();
    format!(
        "{} {} also an input of this run; writing {} would destroy it. Choose another output name.",
        list.join(", "),
        if list.len() == 1 { "is" } else { "are" },
        if list.len() == 1 { "it" } else { "them" }
    )
}

/// The outputs that already hold a regular file before the run: the GUI asks
/// before it overwrites them (GUI-DESIGN 6.4, "a file that already exists is
/// confirmed before the run, never after"). An input is never an output.
pub fn existing(paths: &[PathBuf], inputs: &[PathBuf]) -> Vec<PathBuf> {
    paths.iter().filter(|p| is_regular_file(p) && !is_input(p, inputs)).cloned().collect()
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
/// an earlier run sits next to this run's missing table. Every file of
/// @p inputs (the spectra, the databases, the identification file, ...) and
/// anything that is not a regular file (/dev/null, a folder) are never
/// touched.
pub fn cleanup(paths: &[PathBuf], inputs: &[PathBuf]) -> Cleanup {
    cleanup_with(paths, inputs, |p| std::fs::remove_file(p), |a, b| std::fs::rename(a, b))
}

pub fn cleanup_with(
    paths: &[PathBuf],
    inputs: &[PathBuf],
    remove: impl Fn(&Path) -> std::io::Result<()>,
    rename: impl Fn(&Path, &Path) -> std::io::Result<()>,
) -> Cleanup {
    let mut c = Cleanup::default();
    for path in paths {
        if !is_regular_file(path) || is_input(path, inputs) {
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
        // -census writes its table and summary beside -out.
        assert_eq!(
            resolved_outputs(&v(&["-in", "i", "-out", "/d/a.tags.tsv", "-census", "-census_sorted_out", "/d/a.census_sorted.tsv"])),
            v(&["/d/a.tags.tsv", "/d/a.census_sorted.tsv", "/d/a.tags.census.tsv", "/d/a.tags.census_summary.tsv"])
        );
    }

    #[test]
    fn every_output_file_option_of_the_manifest_is_an_output() {
        let options = output_options();
        for o in [
            "out", "qc_out", "shortlist_out", "fasta_out", "search_config_out", "census_out", "census_summary_out",
            "census_sorted_out", "alkylation_out", "alkylation_tags_out", "delta_spectra_out", "delta_counts_out",
            "check_header_out", "species_out", "glyco_out", "recon_out", "delta_out",
        ] {
            assert!(options.iter().any(|x| x == o), "{o} is not an output-file option of the manifest");
        }
        assert!(!options.iter().any(|x| x == "in" || x == "recon_fasta"));
    }

    /// The argv each Setup workflow sends (gui/src/setup/tasks.ts), and the
    /// files it writes: every one must be confirmed before an overwrite and
    /// removed after a cancel or failure.
    fn workflow_argv() -> Vec<(&'static str, Vec<String>, Vec<&'static str>)> {
        let base = |extra: &[&str]| {
            let mut a = v(&["-in", "a.mzML", "-out", "a.tags.tsv", "-threads", "0"]);
            a.extend(extra.iter().map(|s| s.to_string()));
            a
        };
        vec![
            ("export-tags", base(&["-res_conf", "-out_spectra", "a.spectra.mzML"]), vec!["a.tags.tsv", "a.spectra.mzML"]),
            ("run-qc", base(&["-qc_out", "a.qc.tsv"]), vec!["a.tags.tsv", "a.qc.tsv"]),
            (
                "mass-shift",
                base(&[
                    "-recon_fasta", "h.fasta", "-recon_out", "a.recon.tsv", "-delta_out", "a.delta.tsv", "-delta_spectra_out",
                    "a.delta_spectra.tsv", "-delta_counts_out", "a.delta_counts.tsv",
                ]),
                vec!["a.tags.tsv", "a.recon.tsv", "a.delta.tsv", "a.delta_spectra.tsv", "a.delta_counts.tsv"],
            ),
            ("species", base(&["-species", "-extension", "2"]), vec!["a.tags.tsv", "a.tags.species.tsv"]),
            (
                "db-reduction",
                base(&["-recon_fasta", "h.fasta", "-shortlist_out", "a.shortlist.tsv", "-fasta_out", "a.reduced.fasta", "-search_config_out", "a.search.json"]),
                vec!["a.tags.tsv", "a.shortlist.tsv", "a.reduced.fasta", "a.search.json"],
            ),
            (
                "triage",
                base(&["-census", "-census_score", "-census_sorted_out", "a.census_sorted.tsv"]),
                vec!["a.tags.tsv", "a.census_sorted.tsv", "a.tags.census.tsv", "a.tags.census_summary.tsv"],
            ),
            (
                "characterize",
                base(&["-digest_out", "a.digest.tsv", "-label_out", "a.label.tsv", "-alkylation_out", "a.alkylation.tsv", "-glyco", "-species", "-check_header_out", "a.check_header.tsv"]),
                vec!["a.tags.tsv", "a.digest.tsv", "a.label.tsv", "a.alkylation.tsv", "a.check_header.tsv", "a.tags.glyco.tsv", "a.tags.species.tsv"],
            ),
        ]
    }

    #[test]
    fn every_workflow_output_is_confirmed_and_cleaned_up() {
        for (wf, argv, files) in workflow_argv() {
            assert_eq!(resolved_outputs(&argv), v(&files), "{wf}");
            let d = tmp(&format!("wf-{wf}"));
            let input = d.join("a.mzML");
            std::fs::write(&input, "spectra").unwrap();
            for f in &files {
                std::fs::write(d.join(f), "an earlier result").unwrap();
            }
            let paths = resolve(&resolved_outputs(&argv), Some(&d));
            // Overwrite confirmation: every earlier file is asked about.
            assert_eq!(existing(&paths, std::slice::from_ref(&input)).len(), files.len(), "{wf}: existing");
            // Cancel or failure: none is left behind.
            let c = cleanup(&paths, std::slice::from_ref(&input));
            assert_eq!(c.removed.len(), files.len(), "{wf}: cleanup");
            assert!(files.iter().all(|f| !d.join(f).exists()), "{wf}: a file was left");
            assert!(input.exists());
            let _ = std::fs::remove_dir_all(&d);
        }
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
        assert_eq!(existing(&paths, std::slice::from_ref(&input)), vec![earlier.clone()]);
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
        let c = cleanup(&paths, std::slice::from_ref(&input));
        assert_eq!(
            c.removed,
            vec![new.display().to_string(), rewritten.display().to_string(), untouched.display().to_string()]
        );
        assert!(c.renamed.is_empty() && c.failed.is_empty());
        assert!(!new.exists() && !rewritten.exists() && !untouched.exists() && !never.exists());
        assert!(input.exists(), "the input is never touched");
        let _ = std::fs::remove_dir_all(&d);
    }

    // A database reduction run with the reduced FASTA of an earlier run as its
    // database: fasta_out names the database. The run is refused before it
    // starts, and a cleanup never removes any input, not only the spectra.
    #[test]
    fn an_output_that_is_an_input_is_refused_and_never_cleaned_up() {
        let d = tmp("clash");
        let spectra = d.join("a.mzML");
        let db = d.join("run01.reduced.fasta");
        std::fs::write(&spectra, "spectra").unwrap();
        std::fs::write(&db, ">P1\nPEPTIDE\n").unwrap();
        let argv = v(&[
            "-in", "a.mzML", "-out", "a.tags.tsv", "-recon_fasta", "run01.reduced.fasta", "-fasta_out", "./run01.reduced.fasta",
            "-shortlist_background", "",
        ]);
        assert_eq!(inputs_of(&argv), v(&["a.mzML", "run01.reduced.fasta"]));
        let inputs = resolve(&inputs_of(&argv), Some(&d));
        let paths = resolve(&resolved_outputs(&argv), Some(&d));
        assert_eq!(clashes(&paths, &inputs), vec![d.join("./run01.reduced.fasta")]);
        assert!(clash_reason(&clashes(&paths, &inputs)).contains("also an input"));
        assert!(existing(&paths, &inputs).is_empty(), "an input is not offered for overwriting");
        let c = cleanup(&paths, &inputs);
        assert!(c.removed.is_empty() && db.exists() && spectra.exists());
        let _ = std::fs::remove_dir_all(&d);
    }

    // -alkylation_proteome is a string option (a shipped proteome's name or
    // a FASTA path): a FASTA named there is an input like -recon_fasta. An
    // output named like it is refused, never offered for overwriting, and a
    // failed run's cleanup leaves its bytes as they were.
    #[test]
    fn a_proteome_fasta_is_an_input_and_keeps_its_bytes() {
        let d = tmp("proteome");
        let spectra = d.join("a.mzML");
        let db = d.join("my.reduced.fasta");
        let bytes = b">P1\nPEPTIDECK\n";
        std::fs::write(&spectra, "spectra").unwrap();
        std::fs::write(&db, bytes).unwrap();
        let argv = v(&["-in", "a.mzML", "-out", "a.tags.tsv", "-alkylation_out", "a.alk.tsv", "-alkylation_proteome", "my.reduced.fasta", "-fasta_out", "./my.reduced.fasta"]);
        assert_eq!(inputs_of(&argv), v(&["a.mzML", "my.reduced.fasta"]));
        let inputs = run_inputs("a.mzML", &argv, &[], Some(&d));
        let paths = resolve(&resolved_outputs(&argv), Some(&d));
        assert_eq!(clashes(&paths, &inputs), vec![d.join("./my.reduced.fasta")]);
        assert!(existing(&paths, &inputs).is_empty());
        let c = cleanup(&paths, &inputs);
        assert!(c.removed.is_empty());
        assert_eq!(std::fs::read(&db).unwrap(), bytes, "the proteome keeps its bytes");
        // A shipped proteome's name is not a file.
        for name in PROTEOME_NAMES {
            assert!(!is_proteome_file(name));
            assert_eq!(inputs_of(&v(&["-alkylation_proteome", name])), Vec::<String>::new());
        }
        let _ = std::fs::remove_dir_all(&d);
    }

    // A batch: job 1 (s.mzML) writes s.spectra.mzML, which job 2 reads. The
    // other jobs' inputs are protected like the job's own.
    #[test]
    fn another_batch_jobs_input_is_protected() {
        let d = tmp("batch");
        let job2 = d.join("s.spectra.mzML");
        std::fs::write(d.join("s.mzML"), "spectra").unwrap();
        std::fs::write(&job2, "job 2 input").unwrap();
        let argv = v(&["-in", "s.mzML", "-out", "s.tags.tsv", "-out_spectra", "s.spectra.mzML"]);
        let protect = vec![job2.display().to_string()];
        let alone = run_inputs("s.mzML", &argv, &[], Some(&d));
        let paths = resolve(&resolved_outputs(&argv), Some(&d));
        assert!(clashes(&paths, &alone).is_empty(), "alone, the run sees an existing output");
        let inputs = run_inputs("s.mzML", &argv, &protect, Some(&d));
        assert_eq!(clashes(&paths, &inputs).len(), 1);
        assert!(cleanup(&paths, &inputs).removed.is_empty() && job2.exists());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn cleanup_renames_what_it_cannot_delete() {
        let d = tmp("rename");
        let out = d.join("a.tags.tsv");
        let paths = vec![out.clone()];
        std::fs::write(&out, "partial").unwrap();
        let denied = |_: &Path| Err(std::io::Error::from(std::io::ErrorKind::PermissionDenied));
        let c = cleanup_with(&paths, &[PathBuf::from("/nonexistent/in.mzML")], denied, |a, b| std::fs::rename(a, b));
        assert_eq!(c.renamed, vec![format!("{}.incomplete", out.display())]);
        assert!(!out.exists() && d.join("a.tags.tsv.incomplete").exists());
        // Neither works: reported, not hidden.
        std::fs::write(&out, "partial").unwrap();
        let c = cleanup_with(&paths, &[PathBuf::from("/x")], denied, |_, _| Err(std::io::Error::from(std::io::ErrorKind::PermissionDenied)));
        assert_eq!(c.failed, vec![out.display().to_string()]);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[cfg(unix)]
    #[test]
    fn cleanup_never_touches_a_device() {
        let paths = resolve(&["/dev/null".to_string()], None);
        assert!(existing(&paths, &[PathBuf::from("/x")]).is_empty());
        assert!(cleanup(&paths, &[PathBuf::from("/x")]).is_empty());
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
