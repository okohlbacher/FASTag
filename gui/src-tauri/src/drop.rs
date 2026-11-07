// The window-wide drop zone (GUI-DESIGN 2 "Persistent chrome", P2a PR s).
// Tauri delivers an OS file drop as WindowEvent::DragDrop with the dropped
// paths (the webview sees no HTML5 drop for files); lib.rs hands it to
// on_drag_drop, which sorts the paths by type and emits one DROP_EVENT with
// the route, so the renderer only applies it:
//
//   spectra (mzML, mzPeak, MGF)  -> the input; two or more, or a folder, a batch
//   .fasta / .fa / .faa          -> Database (-fasta)
//   .taxdb                       -> Taxonomy (-taxdb)
//   *.tags.tsv, any other .tsv   -> Results (the tags table)
//   *.digest / label / massgap / recon / delta / recon_id / glyco /
//   species TSVs                 -> their result tab
//   *.sdrf.tsv                   -> Batch
//
// A folder adds the spectra directly inside it (not its subfolders), as a
// batch. Anything else is listed as ignored, so the renderer can say so.
// Routing is by name only: nothing is opened or read here.

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::DragDropEvent;

/// The event the renderer applies; the payload is a DropRoute.
pub const DROP_EVENT: &str = "fastag:drop";
/// A drag with files is over the window (true) or has left it (false).
pub const HOVER_EVENT: &str = "fastag:drag";

/// What one dropped path is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Spectra,
    Fasta,
    Taxdb,
    Tags,
    Sdrf,
    /// A report TSV of the tab named by the string (digest, label, ...).
    Report(&'static str),
    Other,
}

/// The report kinds and the name endings that mark them (before ".tsv").
const REPORTS: &[&str] = &["digest", "label", "massgap", "recon_id", "recon", "delta", "glyco", "species"];

fn lower_name(p: &Path) -> String {
    p.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default()
}

/// The kind of @p p by its file name (case-insensitive).
pub fn classify(p: &Path) -> Kind {
    let name = lower_name(p);
    let ext = name.rsplit_once('.').map(|(_, e)| e).unwrap_or("");
    match ext {
        "mzml" | "mzpeak" | "mgf" => return Kind::Spectra,
        "fasta" | "fa" | "faa" => return Kind::Fasta,
        "taxdb" => return Kind::Taxdb,
        "tsv" => {}
        _ => return Kind::Other,
    }
    let stem = &name[..name.len() - ".tsv".len()];
    if stem.ends_with(".sdrf") || stem.ends_with("_sdrf") || stem == "sdrf" {
        return Kind::Sdrf;
    }
    if stem.ends_with(".tags") || stem.ends_with("_tags") {
        return Kind::Tags;
    }
    for r in REPORTS {
        // run01.digest.tsv, run01_digest.tsv
        if stem.len() > r.len() {
            let (head, tail) = stem.split_at(stem.len() - r.len());
            if tail == *r && (head.ends_with('.') || head.ends_with('_')) {
                return Kind::Report(r);
            }
        }
    }
    // A tags table may carry any name (-out is free).
    Kind::Tags
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ReportDrop {
    pub kind: &'static str,
    pub path: String,
}

/// Where the paths of one drop go.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct DropRoute {
    /// Spectra files, in drop order (a folder's sorted by name).
    pub spectra: Vec<String>,
    /// The spectra go to the batch queue: two or more files, or a folder.
    pub batch: bool,
    pub fasta: Option<String>,
    pub taxdb: Option<String>,
    /// A tags table for Results.
    pub results: Option<String>,
    pub reports: Vec<ReportDrop>,
    pub sdrf: Option<String>,
    /// Paths of no kind the app opens (and folders without spectra).
    pub ignored: Vec<String>,
}

fn text(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

/// The spectra directly inside folder @p dir, sorted by name.
fn folder_spectra(dir: &Path) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = std::fs::read_dir(dir)
        .map(|rd| {
            rd.filter_map(|e| e.ok().map(|e| e.path()))
                .filter(|p| p.is_file() && classify(p) == Kind::Spectra)
                .collect()
        })
        .unwrap_or_default();
    v.sort();
    v
}

/// Sort the dropped @p paths by kind. The first file of a kind that takes
/// one file (FASTA, taxonomy, tags, SDRF) wins; the others are ignored.
pub fn route(paths: &[PathBuf]) -> DropRoute {
    let mut r = DropRoute::default();
    let mut folder = false;
    let one = |slot: &mut Option<String>, ignored: &mut Vec<String>, p: &Path| {
        if slot.is_none() {
            *slot = Some(text(p));
        } else {
            ignored.push(text(p));
        }
    };
    for p in paths {
        if p.is_dir() {
            let found = folder_spectra(p);
            if found.is_empty() {
                r.ignored.push(text(p));
            } else {
                folder = true;
                r.spectra.extend(found.iter().map(|f| text(f)));
            }
            continue;
        }
        match classify(p) {
            Kind::Spectra => r.spectra.push(text(p)),
            Kind::Fasta => one(&mut r.fasta, &mut r.ignored, p),
            Kind::Taxdb => one(&mut r.taxdb, &mut r.ignored, p),
            Kind::Tags => one(&mut r.results, &mut r.ignored, p),
            Kind::Sdrf => one(&mut r.sdrf, &mut r.ignored, p),
            Kind::Report(kind) => {
                if r.reports.iter().any(|x| x.kind == kind) {
                    r.ignored.push(text(p));
                } else {
                    r.reports.push(ReportDrop { kind, path: text(p) });
                }
            }
            Kind::Other => r.ignored.push(text(p)),
        }
    }
    let mut seen = std::collections::HashSet::new();
    r.spectra.retain(|s| seen.insert(s.clone()));
    r.batch = folder || r.spectra.len() >= 2;
    r
}

/// What lib.rs does with one WindowEvent::DragDrop: @p hover tells the
/// renderer a drag is over the window or has left it, @p dropped gets the
/// route of a drop. Over (the pointer moving) sends nothing.
pub fn on_drag_drop(ev: &DragDropEvent, hover: impl FnOnce(bool), dropped: impl FnOnce(DropRoute)) {
    match ev {
        DragDropEvent::Enter { .. } => hover(true),
        DragDropEvent::Leave => hover(false),
        DragDropEvent::Drop { paths, .. } => {
            hover(false);
            dropped(route(paths));
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::PhysicalPosition;

    fn pb(v: &[&str]) -> Vec<PathBuf> {
        v.iter().map(PathBuf::from).collect()
    }

    #[test]
    fn classifies_by_name_case_insensitive() {
        let k = |s: &str| classify(Path::new(s));
        assert_eq!(k("/d/run01.mzML"), Kind::Spectra);
        assert_eq!(k("/d/RUN01.MZML"), Kind::Spectra);
        assert_eq!(k("/d/a.mzpeak"), Kind::Spectra);
        assert_eq!(k("/d/a.mgf"), Kind::Spectra);
        assert_eq!(k("/d/human.fasta"), Kind::Fasta);
        assert_eq!(k("/d/human.fa"), Kind::Fasta);
        assert_eq!(k("/d/human.faa"), Kind::Fasta);
        assert_eq!(k("/d/ncbi.taxdb"), Kind::Taxdb);
        assert_eq!(k("/d/run01.tags.tsv"), Kind::Tags);
        assert_eq!(k("/d/my-output.tsv"), Kind::Tags, "a tags table may be named anything");
        assert_eq!(k("/d/run01.digest.tsv"), Kind::Report("digest"));
        assert_eq!(k("/d/run01_digest.tsv"), Kind::Report("digest"));
        assert_eq!(k("/d/run01.label.tsv"), Kind::Report("label"));
        assert_eq!(k("/d/run01.massgap.tsv"), Kind::Report("massgap"));
        assert_eq!(k("/d/run01.recon.tsv"), Kind::Report("recon"));
        assert_eq!(k("/d/run01.recon_id.tsv"), Kind::Report("recon_id"));
        assert_eq!(k("/d/run01.delta.tsv"), Kind::Report("delta"));
        assert_eq!(k("/d/run01.glyco.tsv"), Kind::Report("glyco"));
        assert_eq!(k("/d/run01.species.tsv"), Kind::Report("species"));
        assert_eq!(k("/d/PXD004541.sdrf.tsv"), Kind::Sdrf);
        assert_eq!(k("/d/sdrf.tsv"), Kind::Sdrf);
        // "digest" alone is a tags table named digest.tsv, not a report.
        assert_eq!(k("/d/digest.tsv"), Kind::Tags);
        assert_eq!(k("C:\\data\\Run01.mzML"), Kind::Spectra);
        assert_eq!(k("/d/notes.txt"), Kind::Other);
        assert_eq!(k("/d/noext"), Kind::Other);
    }

    #[test]
    fn one_spectra_file_is_the_input_two_are_a_batch() {
        let r = route(&pb(&["/d/a.mzML"]));
        assert_eq!(r.spectra, vec!["/d/a.mzML"]);
        assert!(!r.batch);
        let r = route(&pb(&["/d/a.mzML", "/d/b.mgf", "/d/a.mzML"]));
        assert_eq!(r.spectra, vec!["/d/a.mzML", "/d/b.mgf"], "a path dropped twice counts once");
        assert!(r.batch);
    }

    #[test]
    fn each_kind_goes_to_its_place() {
        let r = route(&pb(&[
            "/d/h.fasta",
            "/d/x.taxdb",
            "/d/r.tags.tsv",
            "/d/r.digest.tsv",
            "/d/r.label.tsv",
            "/d/r.glyco.tsv",
            "/d/p.sdrf.tsv",
            "/d/readme.txt",
            "/d/other.fasta",
            "/d/s.digest.tsv",
        ]));
        assert!(r.spectra.is_empty());
        assert_eq!(r.fasta.as_deref(), Some("/d/h.fasta"));
        assert_eq!(r.taxdb.as_deref(), Some("/d/x.taxdb"));
        assert_eq!(r.results.as_deref(), Some("/d/r.tags.tsv"));
        assert_eq!(r.sdrf.as_deref(), Some("/d/p.sdrf.tsv"));
        assert_eq!(
            r.reports,
            vec![
                ReportDrop { kind: "digest", path: "/d/r.digest.tsv".into() },
                ReportDrop { kind: "label", path: "/d/r.label.tsv".into() },
                ReportDrop { kind: "glyco", path: "/d/r.glyco.tsv".into() },
            ]
        );
        // The second FASTA and the second digest report are not taken.
        assert_eq!(r.ignored, vec!["/d/readme.txt", "/d/other.fasta", "/d/s.digest.tsv"]);
    }

    #[test]
    fn a_folder_adds_its_spectra_as_a_batch() {
        let dir = std::env::temp_dir().join(format!("fastag-drop-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        for f in ["b.mzML", "a.mzML", "notes.txt", "sub/c.mzML"] {
            std::fs::write(dir.join(f), b"x").unwrap();
        }
        let empty = dir.join("sub2");
        std::fs::create_dir_all(&empty).unwrap();
        let r = route(&[dir.clone(), empty.clone()]);
        assert_eq!(r.spectra, vec![text(&dir.join("a.mzML")), text(&dir.join("b.mzML"))]);
        assert!(r.batch, "a folder is a batch, even of one file");
        assert_eq!(r.ignored, vec![text(&empty)]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    // The handler lib.rs calls, driven with the DragDrop payloads tauri
    // delivers (the OS drop itself cannot be driven in CI).
    #[test]
    fn drag_drop_events_dispatch_hover_and_route() {
        let pos = PhysicalPosition::new(10.0, 20.0);
        let mut hover = Vec::new();
        let mut routes = Vec::new();
        let enter = DragDropEvent::Enter { paths: pb(&["/d/a.mzML"]), position: pos };
        on_drag_drop(&enter, |h| hover.push(h), |r| routes.push(r));
        on_drag_drop(&DragDropEvent::Over { position: pos }, |h| hover.push(h), |r| routes.push(r));
        on_drag_drop(&DragDropEvent::Leave, |h| hover.push(h), |r| routes.push(r));
        assert_eq!(hover, vec![true, false]);
        assert!(routes.is_empty(), "no route before a drop");
        let drop = DragDropEvent::Drop { paths: pb(&["/d/a.mzML", "/d/b.mzML", "/d/h.fasta"]), position: pos };
        on_drag_drop(&drop, |h| hover.push(h), |r| routes.push(r));
        assert_eq!(hover, vec![true, false, false], "a drop ends the hover");
        assert_eq!(routes.len(), 1);
        assert_eq!(routes[0].spectra, vec!["/d/a.mzML", "/d/b.mzML"]);
        assert!(routes[0].batch);
        assert_eq!(routes[0].fasta.as_deref(), Some("/d/h.fasta"));
    }

    #[test]
    fn route_serializes_as_the_renderer_reads_it() {
        let r = route(&pb(&["/d/a.mzML", "/d/r.digest.tsv"]));
        let v = serde_json::to_value(&r).unwrap();
        assert_eq!(v["spectra"][0], "/d/a.mzML");
        assert_eq!(v["batch"], false);
        assert_eq!(v["reports"][0]["kind"], "digest");
        assert_eq!(v["fasta"], serde_json::Value::Null);
        assert!(v["ignored"].as_array().unwrap().is_empty());
    }
}
