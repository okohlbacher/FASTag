// Resolved outputs, "Reveal in Finder / Explorer" and "Open with default
// app" (GUI-DESIGN 6.3; the full table of every output option from P1).
//
// The renderer never names a path to the opener plugin itself: it asks
// `reveal_output` or `open_output`, and the backend checks the path.
// capabilities/default.json grants the renderer no opener permission for
// paths, so these checks are the whole scope.
//
// Reveal shows a file in the file manager (or opens its folder) when it is
// an output of a run of this app: one started in this session
// (RunManager.revealable) or one in the run record (history.jsonl), or a
// -recon_id_out dropped on the window (drop.rs openable).
//
// Open hands a file to the app the system gives its type, which for some
// types (.command, .app, .terminal on macOS) runs it, so its scope is
// narrower (may_open): only the identification files and hand-off files the
// UI offers Open for (ProductFiles: -recon_id_out as idXML, mzid or mzTab,
// -fasta_out, -search_config_out; OPENABLE), only a file a run committed
// (ended with exit 0: in this session, RunManager.openable, or in an earlier
// one, the identities its run record keeps, RunRecord.open_identities) or
// the OS handed over in a drop (RunManager.openable), never a planned
// output, and only while it is still that file: a regular file, not a
// symlink, at the same path with the same device, inode, size and
// modification time. The file is opened once for that check, and what the
// system opener gets is a private copy made from that very handle
// (private_copy), never the path again: a file swapped in at that path
// after the check is not the one opened.

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

/// @p p canonical, in the spelling every path of this module has: on Windows
/// `C:\...`, not the verbatim `\\?\C:\...` of std::fs::canonicalize (dunce
/// keeps the verbatim form only where a plain one cannot name the file).
fn canonical(p: &Path) -> Option<PathBuf> {
    dunce::canonicalize(p).ok()
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

/// The file types Open may hand to the system, lower case: what ProductFiles
/// offers Open for (-recon_id_out idXML, mzid or mzTab; -fasta_out; the
/// -search_config_out of Sage (JSON), Comet or MSFragger (.params)).
pub const OPENABLE: &[&str] = &["idxml", "mzid", "mztab", "fasta", "fa", "json", "params"];

/// @p p with its folder resolved (canonical, as `canonical` spells it) and
/// its last component as it is (not followed when it is a symlink). The
/// identities Open records and checks carry this path, so one spelling for
/// both: a recorded `C:\...` and a checked `\\?\C:\...` would never match.
fn parent_resolved(p: &Path) -> Option<PathBuf> {
    let name = p.file_name()?;
    let parent = match p.parent() {
        Some(d) if !d.as_os_str().is_empty() => d,
        _ => Path::new("."),
    };
    Some(canonical(parent)?.join(name))
}

/// @p p as Open records and checks it: of an OPENABLE type, a regular file
/// and no symlink, at its folder-resolved path (parent_resolved), with the
/// identity of the handle opened there. None: anything else.
pub fn openable_identity(p: &Path) -> Option<crate::fasta::FileIdentity> {
    let ext = p.extension()?.to_str()?.to_ascii_lowercase();
    if !OPENABLE.contains(&ext.as_str()) {
        return None;
    }
    let m = std::fs::symlink_metadata(p).ok()?;
    if m.file_type().is_symlink() || !m.is_file() {
        return None;
    }
    crate::fasta::identity_at(&parent_resolved(p)?)
}

/// @p path opened once, checked as openable_identity checks it, and its
/// identity (taken from that handle) one of @p allowed: the handle and the
/// identity. None: refused.
pub fn open_verified(path: &Path, allowed: &[crate::fasta::FileIdentity]) -> Option<(std::fs::File, crate::fasta::FileIdentity)> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    if !OPENABLE.contains(&ext.as_str()) {
        return None;
    }
    let m = std::fs::symlink_metadata(path).ok()?;
    if m.file_type().is_symlink() || !m.is_file() {
        return None;
    }
    let (f, now) = crate::fasta::open_identified_at(&parent_resolved(path)?)?;
    allowed.contains(&now).then_some((f, now))
}

/// @p path may be opened: openable_identity of it now is one of @p allowed
/// (the identities recorded when a run committed the file or it was
/// dropped). The path, folder-resolved; None: refused.
#[cfg(test)]
pub fn may_open(path: &Path, allowed: &[crate::fasta::FileIdentity]) -> Option<PathBuf> {
    open_verified(path, allowed).map(|(_, id)| PathBuf::from(id.path))
}

/// Every identity Open may open: @p session (this session's committed
/// outputs and drops), then those the run records in @p history_dir keep
/// (RunRecord.open_identities), so an export reopened from History after a
/// restart opens while it is unchanged.
pub fn open_allowed(session: &[crate::fasta::FileIdentity], history_dir: Option<&Path>) -> Vec<crate::fasta::FileIdentity> {
    let mut v = session.to_vec();
    if let Some(d) = history_dir {
        for rec in history::list(d, 1000) {
            v.extend(rec.open_identities);
        }
    }
    v
}

/// Copies under @p root older than this are removed by the next Open.
const PRIVATE_COPY_DAYS: u64 = 1;

/// The bytes of the verified handle @p f (@p id its identity) as a new file
/// named like @p id.path in a new folder of its own under @p root (mode
/// 0700, the file 0600 on Unix), which nothing else writes to: what the
/// system opener gets. Checked against @p id after the copy, so a file
/// rewritten in place while it was copied is refused.
pub fn private_copy(mut f: std::fs::File, id: &crate::fasta::FileIdentity, root: &Path) -> Result<PathBuf, String> {
    use std::io::{Read, Seek, Write};
    let name = Path::new(&id.path).file_name().ok_or("the file has no name")?.to_owned();
    std::fs::create_dir_all(root).map_err(|e| format!("cannot make {}: {e}", root.display()))?;
    // Earlier copies: the apps they were opened in have had a day.
    if let Ok(rd) = std::fs::read_dir(root) {
        for e in rd.flatten() {
            let old = e.metadata().and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok());
            if old.is_some_and(|a| a.as_secs() > PRIVATE_COPY_DAYS * 86_400) {
                let _ = std::fs::remove_dir_all(e.path());
            }
        }
    }
    let mut rnd = [0u8; 8];
    getrandom::fill(&mut rnd).map_err(|e| e.to_string())?;
    let dir = root.join(rnd.iter().map(|b| format!("{b:02x}")).collect::<String>());
    let mut b = std::fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        b.mode(0o700);
    }
    b.create(&dir).map_err(|e| format!("cannot make {}: {e}", dir.display()))?;
    let out = dir.join(name);
    let mut o = std::fs::OpenOptions::new();
    o.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        o.mode(0o600);
    }
    let fail = |e: std::io::Error| {
        let _ = std::fs::remove_dir_all(&dir);
        format!("cannot copy {}: {e}", id.path)
    };
    let mut w = o.open(&out).map_err(fail)?;
    f.rewind().map_err(fail)?;
    let mut buf = vec![0u8; 1 << 20];
    let mut n_total = 0u64;
    loop {
        let n = f.read(&mut buf).map_err(fail)?;
        if n == 0 {
            break;
        }
        w.write_all(&buf[..n]).map_err(fail)?;
        n_total += n as u64;
    }
    w.flush().map_err(fail)?;
    drop(w);
    // The handle still names the file checked, unchanged while copied.
    let same = f.metadata().ok().is_some_and(|m| m.len() == id.len && n_total == id.len)
        && crate::fasta::identity_of_handle(&f).is_some_and(|h| h.dev == id.dev && h.ino == id.ino && h.mtime_ns == id.mtime_ns);
    if !same {
        let _ = std::fs::remove_dir_all(&dir);
        return Err(format!("{} changed while it was opened", id.path));
    }
    Ok(out)
}

/// Open @p path in the app the system gives its type (an idXML in an
/// identification tool), under the Open scope (open_verified): a file of a
/// type the UI offers Open for that a run committed (this session or one in
/// the record) or that was dropped on the window, unchanged since. The
/// opener gets a private copy made from the handle that was checked.
#[tauri::command]
pub fn open_output(app: AppHandle, state: State<'_, RunManager>, path: String) -> Result<(), String> {
    use tauri::Manager;
    let session = state.openable.lock().map(|o| o.clone()).unwrap_or_default();
    let allowed = open_allowed(&session, history::dir(&app).as_deref());
    let (f, id) = open_verified(Path::new(&path), &allowed).ok_or_else(|| format!("{path} is not a file this app wrote or you opened"))?;
    let root = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("opened");
    let copy = private_copy(f, &id, &root)?;
    app.opener().open_path(copy.display().to_string(), None::<&str>).map_err(|e| e.to_string())
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

    /// A fresh folder for an Open test.
    fn odir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("fastag-open-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        dunce::canonicalize(&d).unwrap()
    }

    // Codex n10: a committed output replaced by a symlink to another file
    // opens neither the link nor its target (was: both canonicalized to the
    // target, which then passed).
    #[cfg(unix)]
    #[test]
    fn open_refuses_a_symlink_swapped_output() {
        let d = odir("swap");
        let out = d.join("a.recon_id.idXML");
        std::fs::write(&out, "<IdXML/>").unwrap();
        let x = d.join("x.idXML");
        std::fs::write(&x, "<other/>").unwrap();
        let allowed = vec![openable_identity(&out).unwrap()];
        std::fs::remove_file(&out).unwrap();
        std::os::unix::fs::symlink(&x, &out).unwrap();
        assert_eq!(may_open(&out, &allowed), None);
        assert_eq!(may_open(&x, &allowed), None);
        // Nor is a link recorded in the first place.
        assert_eq!(openable_identity(&out), None);
        std::fs::remove_dir_all(&d).ok();
    }

    // A planned output (revealable from the start of the run) is not
    // openable unless the run committed it.
    #[test]
    fn open_refuses_a_planned_output_of_a_run_that_did_not_finish() {
        let d = odir("planned");
        let out = d.join("a.recon_id.idXML");
        std::fs::write(&out, "<IdXML/>").unwrap();
        assert!(is_revealable(&out, std::slice::from_ref(&out)));
        assert_eq!(may_open(&out, &[]), None);
        std::fs::remove_dir_all(&d).ok();
    }

    // Only the types ProductFiles offers Open for reach the system's opener.
    #[test]
    fn open_refuses_other_types() {
        let d = odir("types");
        for f in ["x.command", "x.tags.tsv", "x.app", "x.terminal", "x"] {
            let p = d.join(f);
            std::fs::write(&p, "#!/bin/sh\n").unwrap();
            assert_eq!(openable_identity(&p), None, "{f}");
            let forged = crate::fasta::identity_of_file(&p).unwrap();
            assert_eq!(may_open(&p, &[forged]), None, "{f}");
        }
        // A folder named like an idXML is no file.
        std::fs::create_dir_all(d.join("dir.idXML")).unwrap();
        assert_eq!(openable_identity(&d.join("dir.idXML")), None);
        std::fs::remove_dir_all(&d).ok();
    }

    // The same path rewritten (another size, time or inode) is refused.
    #[test]
    fn open_refuses_a_replaced_file() {
        let d = odir("replaced");
        let out = d.join("a.reduced.fasta");
        std::fs::write(&out, ">p\nPEPTIDEK\n").unwrap();
        let allowed = vec![openable_identity(&out).unwrap()];
        assert_eq!(may_open(&out, &allowed), Some(out.clone()));
        std::fs::write(&out, ">p\nPEPTIDEKK\n").unwrap();
        assert_eq!(may_open(&out, &allowed), None);
        let tmp = d.join("new.fasta");
        std::fs::write(&tmp, ">p\nPEPTIDEK\n").unwrap();
        std::fs::rename(&tmp, &out).unwrap();
        assert_eq!(may_open(&out, &allowed), None);
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn open_allows_a_committed_idxml_and_a_dropped_mzid() {
        let d = odir("allowed");
        std::fs::create_dir_all(d.join("sub")).unwrap();
        let idxml = d.join("a.recon_id.idXML");
        let mzid = d.join("b.MZID");
        let json = d.join("a.search.json");
        for p in [&idxml, &mzid, &json] {
            std::fs::write(p, "x").unwrap();
        }
        // Committed at the end of a run, dropped by the OS (lib.rs).
        let route = crate::drop::route(std::slice::from_ref(&mzid));
        let mut allowed: Vec<_> = [&idxml, &json].into_iter().filter_map(|p| openable_identity(p)).collect();
        allowed.extend(crate::drop::openable(&route).iter().filter_map(|p| openable_identity(p)));
        assert_eq!(allowed.len(), 3);
        assert_eq!(may_open(&idxml, &allowed), Some(idxml.clone()));
        assert_eq!(may_open(&mzid, &allowed), Some(mzid.clone()));
        assert_eq!(may_open(&json, &allowed), Some(json.clone()));
        // Another spelling of the folder is the same file.
        assert_eq!(may_open(&d.join("sub").join("..").join("a.recon_id.idXML"), &allowed), Some(idxml.clone()));
        // Another file of an openable type is not.
        let other = d.join("c.idXML");
        std::fs::write(&other, "x").unwrap();
        assert_eq!(may_open(&other, &allowed), None);
        std::fs::remove_dir_all(&d).ok();
    }
    // Codex New 10: the opener got the pathname again after the check, so a
    // file swapped in at that path (a shared output folder) was dispatched.
    // Now the opener gets a private copy of the handle that was checked: the
    // swapped-in file is never read.
    #[cfg(unix)]
    #[test]
    fn open_hands_off_a_private_copy_of_the_checked_file() {
        use std::io::Write;
        let d = odir("handoff");
        let out = d.join("a.recon_id.idXML");
        std::fs::write(&out, "<IdXML>checked</IdXML>").unwrap();
        let allowed = vec![openable_identity(&out).unwrap()];
        let (f, id) = open_verified(&out, &allowed).expect("the committed file is openable");
        // Swapped between the check and the hand-off.
        let evil = d.join("evil.idXML");
        std::fs::write(&evil, "#!/bin/sh\necho swapped\n").unwrap();
        std::fs::rename(&evil, &out).unwrap();
        let root = d.join("private");
        let copy = private_copy(f, &id, &root).unwrap();
        assert!(copy.starts_with(&root), "{}", copy.display());
        assert_ne!(copy, out);
        assert_eq!(copy.file_name(), out.file_name());
        assert_eq!(std::fs::read_to_string(&copy).unwrap(), "<IdXML>checked</IdXML>");
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(std::fs::metadata(copy.parent().unwrap()).unwrap().permissions().mode() & 0o777, 0o700);
        assert_eq!(std::fs::metadata(&copy).unwrap().permissions().mode() & 0o777, 0o600);
        // The swapped file is not openable now either.
        assert!(open_verified(&out, &allowed).is_none());
        // A file rewritten in place after the check (same inode, other
        // bytes): the copy is refused, nothing is left.
        let other = d.join("b.reduced.fasta");
        std::fs::write(&other, ">p\nPEPTIDEK\n").unwrap();
        let allowed = vec![openable_identity(&other).unwrap()];
        let (f, id) = open_verified(&other, &allowed).unwrap();
        std::fs::OpenOptions::new().append(true).open(&other).unwrap().write_all(b">q\nKK\n").unwrap();
        let before = std::fs::read_dir(&root).unwrap().count();
        assert!(private_copy(f, &id, &root).is_err());
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), before);
        std::fs::remove_dir_all(&d).ok();
    }

    // Codex6 finding 6: the identity Open records carries the path in the
    // spelling of dunce::canonicalize, the one the History records and the
    // UI hold (`C:\...` on Windows, not the verbatim `\\?\C:\...`). Fails on
    // Windows with std::fs::canonicalize in parent_resolved; required there
    // (ci.yml gui-windows, "Backend Open and Reveal tests").
    #[test]
    fn open_identities_use_the_plain_canonical_spelling() {
        let d = odir("spelling");
        let f = d.join("a.recon_id.idXML");
        std::fs::write(&f, "<IdXML/>").unwrap();
        let id = openable_identity(&f).unwrap();
        assert_eq!(PathBuf::from(&id.path), dunce::canonicalize(&f).unwrap());
        assert!(!id.path.starts_with(r"\\?\"), "{}", id.path);
        assert_eq!(may_open(&f, &[id]), Some(f.clone()));
        std::fs::remove_dir_all(&d).ok();
    }

    // Codex New 11: an export reopened from History after a restart (no
    // identity in this session) opens while it is the file the run
    // committed: the run record keeps that identity. A file changed since,
    // or one the record never had, is refused.
    #[test]
    fn a_committed_output_opens_after_a_restart_from_its_run_record() {
        let d = odir("restart");
        let mztab = d.join("a.recon_id.mzTab");
        std::fs::write(&mztab, "MTD\tmzTab-version\t1.0.0\n").unwrap();
        let hist = d.join("history");
        std::fs::create_dir_all(&hist).unwrap();
        let mut rec: history::RunRecord = serde_json::from_value(serde_json::json!({
            "id": "1-1", "input": "/d/a.mzML", "outputs": [mztab.display().to_string()], "cwd": null,
            "argv": ["FASTag"], "status": "ok", "exitCode": 0, "message": null, "start": 1, "end": 2,
            "cleanup": serde_json::to_value(crate::outputs::Cleanup::default()).unwrap()
        }))
        .unwrap();
        rec.open_identities = vec![openable_identity(&mztab).unwrap()];
        history::append(&hist, &rec).unwrap();
        // The session after a restart: nothing of its own.
        assert_eq!(may_open(&mztab, &open_allowed(&[], None)), None);
        let allowed = open_allowed(&[], Some(&hist));
        assert_eq!(may_open(&mztab, &allowed), Some(mztab.clone()));
        // The record reads back the identity it wrote.
        assert_eq!(history::list(&hist, 10)[0].open_identities, rec.open_identities);
        // Changed since the run: refused.
        std::fs::write(&mztab, "MTD\tmzTab-version\t1.0.0\nPSH\n").unwrap();
        assert_eq!(may_open(&mztab, &open_allowed(&[], Some(&hist))), None);
        // A record without identities (older, or a run that did not finish).
        let other = d.join("b.recon_id.idXML");
        std::fs::write(&other, "<IdXML/>").unwrap();
        let mut old = rec.clone();
        old.id = "2-2".into();
        old.open_identities.clear();
        old.outputs = vec![other.display().to_string()];
        history::append(&hist, &old).unwrap();
        assert_eq!(may_open(&other, &open_allowed(&[], Some(&hist))), None);
        std::fs::remove_dir_all(&d).ok();
    }
}
