// Resolved outputs and "Reveal in Finder / Explorer" (GUI-DESIGN 6.3; the
// full table of every output option from P1).
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

/// The outputs of a run as the CLI writes them (GUI-DESIGN 6.3): every
/// output option, absolute, resolved against the child's cwd exactly as
/// `outputs::resolve` does for the cleanup, from the very argv the CLI was
/// given (build_args and its file_arg). The renderer never resolves a path
/// itself: its own guess treated `\data\a.mzML` as absolute on Windows,
/// where Rust and the CLI do not. A species or glyco report the CLI derives
/// from -out (-species or -glyco without a path) is under species_out or
/// glyco_out. None: the run does not write it.
///
/// On the wire its keys are the option names (species_out, recon_id_out,
/// out_spectra ...), as types.ts reads them: no rename_all. The JSON is
/// pinned by fastag.rs the_run_reply_names_every_output_by_its_option_name
/// against gui/src/testing/fixtures/run-started.json, which the vitest
/// contract tests replay.
#[derive(Serialize, Clone, Debug, PartialEq, Default)]
pub struct ResolvedOutputs {
    pub out: Option<String>,
    pub species_out: Option<String>,
    pub digest_out: Option<String>,
    pub label_out: Option<String>,
    pub massgap_out: Option<String>,
    pub recon_out: Option<String>,
    pub delta_out: Option<String>,
    pub recon_id_out: Option<String>,
    pub glyco_out: Option<String>,
    pub out_spectra: Option<String>,
    // The reports of the workflows (doc/GUI-WORKFLOWS.md 1), on the wire
    // only when the run writes them, so the reply of a tags-only run reads
    // as before.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub qc_out: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shortlist_out: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fasta_out: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search_config_out: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub census_out: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub census_summary_out: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub census_sorted_out: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alkylation_out: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alkylation_tags_out: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delta_spectra_out: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delta_counts_out: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub check_header_out: Option<String>,
}

impl ResolvedOutputs {
    fn slot(&mut self, option: &str) -> Option<&mut Option<String>> {
        Some(match option {
            "out" => &mut self.out,
            "species_out" => &mut self.species_out,
            "digest_out" => &mut self.digest_out,
            "label_out" => &mut self.label_out,
            "massgap_out" => &mut self.massgap_out,
            "recon_out" => &mut self.recon_out,
            "delta_out" => &mut self.delta_out,
            "recon_id_out" => &mut self.recon_id_out,
            "glyco_out" => &mut self.glyco_out,
            "out_spectra" => &mut self.out_spectra,
            "qc_out" => &mut self.qc_out,
            "shortlist_out" => &mut self.shortlist_out,
            "fasta_out" => &mut self.fasta_out,
            "search_config_out" => &mut self.search_config_out,
            "census_out" => &mut self.census_out,
            "census_summary_out" => &mut self.census_summary_out,
            "census_sorted_out" => &mut self.census_sorted_out,
            "alkylation_out" => &mut self.alkylation_out,
            "alkylation_tags_out" => &mut self.alkylation_tags_out,
            "delta_spectra_out" => &mut self.delta_spectra_out,
            "delta_counts_out" => &mut self.delta_counts_out,
            "check_header_out" => &mut self.check_header_out,
            _ => return None,
        })
    }

    /// Every path, in the order of the fields.
    pub fn paths(&self) -> Vec<&str> {
        [
            &self.out,
            &self.species_out,
            &self.digest_out,
            &self.label_out,
            &self.massgap_out,
            &self.recon_out,
            &self.delta_out,
            &self.recon_id_out,
            &self.glyco_out,
            &self.out_spectra,
            &self.qc_out,
            &self.shortlist_out,
            &self.fasta_out,
            &self.search_config_out,
            &self.census_out,
            &self.census_summary_out,
            &self.census_sorted_out,
            &self.alkylation_out,
            &self.alkylation_tags_out,
            &self.delta_spectra_out,
            &self.delta_counts_out,
            &self.check_header_out,
        ]
        .into_iter()
        .filter_map(|p| p.as_deref())
        .collect()
    }
}

/// ResolvedOutputs of @p args (the argv without the binary) for a child that
/// runs in @p cwd.
pub fn resolved(args: &[String], cwd: Option<&Path>) -> ResolvedOutputs {
    let mut r = ResolvedOutputs::default();
    for (option, path) in crate::outputs::outputs_by_option(args) {
        let abs = crate::outputs::resolve(&[path], cwd).remove(0).display().to_string();
        if let Some(slot) = r.slot(option) {
            slot.get_or_insert(abs);
        }
    }
    r
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

    // Every output-file option of the manifest the CLI still has has its
    // field: an output without one could not be revealed from Results.
    #[test]
    fn every_output_option_has_a_field() {
        let mut r = ResolvedOutputs::default();
        for o in crate::outputs::output_options() {
            // Removed in 1.14 (hidden in the GUI, read by the CLI as nothing).
            if o == "label_discovery_out" || o == "search_shifts_out" {
                continue;
            }
            assert!(r.slot(o).is_some(), "{o} has no field in ResolvedOutputs");
        }
    }

    // The reports of each workflow are revealable: they are among the
    // resolved paths a run adds to the revealable set.
    #[test]
    fn workflow_reports_are_resolved_for_reveal() {
        let a = s(&[
            "-in", "/d/a.mzML", "-out", "/d/a.tags.tsv", "-qc_out", "/d/a.qc.tsv", "-shortlist_out", "/d/a.shortlist.tsv",
            "-fasta_out", "/d/a.reduced.fasta", "-search_config_out", "/d/a.search.json", "-census", "-census_sorted_out",
            "/d/a.census_sorted.tsv", "-alkylation_out", "/d/a.alkylation.tsv", "-delta_spectra_out", "/d/a.ds.tsv",
            "-delta_counts_out", "/d/a.dc.tsv", "-check_header_out", "/d/a.ch.tsv",
        ]);
        let r = resolved(&a, Some(Path::new("/d")));
        assert_eq!(r.qc_out.as_deref(), Some("/d/a.qc.tsv"));
        assert_eq!(r.census_out.as_deref(), Some("/d/a.tags.census.tsv"));
        assert_eq!(r.census_summary_out.as_deref(), Some("/d/a.tags.census_summary.tsv"));
        let paths = r.paths();
        for f in ["a.shortlist.tsv", "a.reduced.fasta", "a.search.json", "a.census_sorted.tsv", "a.alkylation.tsv", "a.ds.tsv", "a.dc.tsv", "a.ch.tsv"] {
            assert!(paths.contains(&format!("/d/{f}").as_str()), "{f} not revealable");
        }
        // The reveal check itself on a real file of a workflow report.
        let d = std::env::temp_dir().join(format!("fastag-reveal-wf-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        let qc = d.join("a.qc.tsv");
        std::fs::write(&qc, "x").unwrap();
        let a = s(&["-in", "a.mzML", "-out", "a.tags.tsv", "-qc_out", "a.qc.tsv"]);
        let allowed: Vec<PathBuf> = resolved(&a, Some(&d)).paths().into_iter().map(PathBuf::from).collect();
        assert!(is_revealable(&qc, &allowed));
        std::fs::remove_dir_all(&d).ok();
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
