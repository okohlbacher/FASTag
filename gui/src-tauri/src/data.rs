// FASTag's shipped data (the protease models, the mass-gap modifications and
// the alkylation proteomes): which folders a CLI child gets, and where the
// CLI finds them, for the inspector's check before a run (checks.ts
// missingDataCheck). Without them the Mass-shift survey, Characterize a run
// and Database reduction stop with exit 6 a moment after Run.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;

use tauri::AppHandle;

use crate::fastag::{taxonomy_dir, Resolved};

/// The bundled data folder share/FASTag/<name> of the app's own CLI
/// (resources/fastag/bin/FASTag), when it holds @p marker. None for a CLI
/// from FASTAG_BIN: the CLI finds its own data, as for the taxonomy.
fn bundled(r: &Resolved, name: &str, marker: &str) -> Option<PathBuf> {
    if r.source != "bundled" {
        return None;
    }
    let root = r.bin.parent()?.parent()?;
    let d = root.join("share").join("FASTag").join(name);
    d.join(marker).is_file().then_some(d)
}

/// data/ of the FASTag sources this app was built from: debug builds only (a
/// release build must not name the build machine's folders).
fn source_data() -> Option<PathBuf> {
    cfg!(debug_assertions).then(|| PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../../data")))
}

/// For a CLI from FASTAG_BIN that has no data folder @p name beside it (the
/// CLI's own places: ../share/FASTag/<name>, share-FASTag-<name>, <name>,
/// each holding @p marker), the sources' data/<name> (@p src, debug builds):
/// a dev build of the CLI from before FASTAG_STAGE_DATA_IN_BUILD, or one built
/// with it off, then still runs the Mass-shift survey, Characterize a run and
/// Database reduction. None when the CLI finds its own, or for any other CLI.
fn dev_data(r: &Resolved, name: &str, marker: &str, src: Option<&Path>) -> Option<PathBuf> {
    if r.source != "env" {
        return None;
    }
    let b = r.bin.parent().filter(|b| !b.as_os_str().is_empty())?;
    let beside = [b.join("..").join("share").join("FASTag").join(name), b.join(format!("share-FASTag-{name}")), b.join(name)];
    if beside.iter().any(|c| c.join(marker).is_file()) {
        return None;
    }
    let d = src?.join(name);
    d.join(marker).is_file().then(|| dunce::canonicalize(&d).unwrap_or(d))
}

/// The user's own value of @p var when it names a folder, else @p fallback.
fn own_or(var: &str, fallback: Option<PathBuf>) -> Option<PathBuf> {
    match std::env::var(var) {
        Ok(e) if !e.is_empty() && Path::new(&e).is_dir() => Some(PathBuf::from(e)),
        _ => fallback,
    }
}

/// The digest folder a CLI child gets as FASTAG_DIGEST_DIR: the user's own if
/// it names a folder, else the bundled one, else (debug builds, a CLI from
/// FASTAG_BIN without its own) the sources' data/digest. Passed explicitly so
/// a copied or symlinked binary still finds it (as FASTAG_TAXONOMY_DIR is).
pub fn digest_dir(r: &Resolved) -> Option<PathBuf> {
    own_or(
        "FASTAG_DIGEST_DIR",
        bundled(r, "digest", "digest_models.tsv").or_else(|| dev_data(r, "digest", "digest_models.tsv", source_data().as_deref())),
    )
}

/// The alkylation folder a CLI child gets as FASTAG_ALKYLATION_DIR, as
/// digest_dir.
pub fn alkylation_dir(r: &Resolved) -> Option<PathBuf> {
    own_or(
        "FASTAG_ALKYLATION_DIR",
        bundled(r, "alkylation", "proteomes.tsv").or_else(|| dev_data(r, "alkylation", "proteomes.tsv", source_data().as_deref())),
    )
}

/// The taxonomy folder a CLI child gets as FASTAG_TAXONOMY_DIR: as
/// fastag::taxonomy_dir, else (debug builds, a CLI from FASTAG_BIN without
/// its own) the sources' data/taxonomy, which has the dumps and
/// species_call.tsv but no index.
fn taxonomy_dir_for_child(r: &Resolved) -> Option<PathBuf> {
    taxonomy_dir(r).or_else(|| dev_data(r, "taxonomy", "nodes.dmp", source_data().as_deref()))
}

/// The data environment of every CLI child that runs FASTag on a file (the
/// run, the probe of an input, the spectrum dump), in one place so they
/// cannot drift apart: OpenMS's share data, the taxonomy, the digest data
/// and the alkylation proteomes.
pub(crate) fn data_env(cmd: &mut Command, r: &Resolved) {
    if let Some(d) = &r.data {
        cmd.env("OPENMS_DATA_PATH", d);
    }
    if let Some(t) = taxonomy_dir_for_child(r) {
        cmd.env("FASTAG_TAXONOMY_DIR", t);
    }
    if let Some(d) = digest_dir(r) {
        cmd.env("FASTAG_DIGEST_DIR", d);
    }
    if let Some(a) = alkylation_dir(r) {
        cmd.env("FASTAG_ALKYLATION_DIR", a);
    }
}

/// Which shipped digest tables the folder holds.
#[derive(Serialize, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct DigestFiles {
    digest_models: bool,
    digest_models_v2: bool,
    massgap_mods: bool,
    calibration: bool,
}

/// Where the CLI finds its shipped data, resolved as FASTag.cpp digestDir_
/// and alkylationDir_ do, from the binary the app runs and the environment
/// its child gets.
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DataStatus {
    /// The digest folder the CLI reads, None when it finds none.
    digest_dir: Option<String>,
    files: DigestFiles,
    /// The alkylation folder the CLI reads, None when it finds none.
    alkylation_dir: Option<String>,
    /// The shipped proteomes there whose file is present (human, mouse,
    /// yeast, ecoli).
    proteomes: Vec<String>,
    /// The digest folders looked in, for the message: the one
    /// FASTAG_DIGEST_DIR names, else the three beside the executable.
    searched: Vec<String>,
    /// The digest folder comes from FASTAG_DIGEST_DIR.
    from_env: bool,
}

const PROTEOMES: [&str; 4] = ["human", "mouse", "yeast", "ecoli"];

/// The folder as it is, without "..": the message names real paths.
fn shown(p: &Path) -> String {
    dunce::canonicalize(p).unwrap_or_else(|_| p.to_path_buf()).display().to_string()
}

/// @p p without "." and ".." steps, without touching the disk (the CLI's
/// lexically_normal).
fn lexical(p: &Path) -> PathBuf {
    use std::path::Component;
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::CurDir => {}
            Component::ParentDir => {
                if !out.pop() {
                    out.push("..");
                }
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// The proteomes of @p dir whose file is there: by proteomes.tsv (columns
/// name and file) when it has one, else <name>.fasta.gz (FASTag.cpp).
fn proteomes_in(dir: &Path) -> Vec<String> {
    let present = |file: &str| !file.is_empty() && !file.contains(['/', '\\']) && dir.join(file).is_file();
    if let Ok(text) = std::fs::read_to_string(dir.join("proteomes.tsv")) {
        let mut lines = text.lines();
        let header: Vec<&str> = lines.next().unwrap_or("").trim_end_matches('\r').split('\t').collect();
        let (Some(n), Some(f)) = (header.iter().position(|c| *c == "name"), header.iter().position(|c| *c == "file")) else {
            return Vec::new();
        };
        let mut out: Vec<String> = Vec::new();
        for l in lines {
            let cols: Vec<&str> = l.trim_end_matches('\r').split('\t').collect();
            if let (Some(name), Some(file)) = (cols.get(n), cols.get(f)) {
                if PROTEOMES.contains(name) && present(file) && !out.iter().any(|o| o == name) {
                    out.push(name.to_string());
                }
            }
        }
        return out;
    }
    PROTEOMES.iter().filter(|p| present(&format!("{p}.fasta.gz"))).map(|p| p.to_string()).collect()
}

/// "share/FASTag/digest" -> "share/FASTag/alkylation" (FASTag.cpp
/// alkylationSibling_).
fn alkylation_sibling(d: &Path) -> Option<PathBuf> {
    let name = d.file_name()?.to_str()?;
    let stem = name.strip_suffix("digest")?;
    Some(d.with_file_name(format!("{stem}alkylation")))
}

/// The CLI's own lookup (FASTag.cpp digestDir_, alkylationDir_): a
/// FASTAG_DIGEST_DIR (@p digest_env) is used as given, and finds nothing when
/// it names no folder; else, beside the executable, ../share/FASTag/digest,
/// share-FASTag-digest or digest, the first with digest_models.tsv. The
/// alkylation folder: FASTAG_ALKYLATION_DIR as given, else "alkylation"
/// beside the digest folder.
fn data_status_of(digest_env: Option<&str>, alkylation_env: Option<&str>, bin: &Path) -> DataStatus {
    let digest_env = digest_env.filter(|e| !e.is_empty());
    let (dir, searched) = match digest_env {
        Some(e) => (Path::new(e).is_dir().then(|| PathBuf::from(e)), vec![e.to_string()]),
        None => {
            let cands: Vec<PathBuf> = bin
                .parent()
                .map(|b| vec![b.join("..").join("share").join("FASTag").join("digest"), b.join("share-FASTag-digest"), b.join("digest")])
                .unwrap_or_default();
            let found = cands.iter().find(|c| c.join("digest_models.tsv").is_file()).cloned();
            // Folders that do not exist cannot be canonicalized: without ".."
            // spelled out, as the CLI's message names them.
            (found, cands.iter().map(|c| lexical(c).display().to_string()).collect())
        }
    };
    let files = dir
        .as_ref()
        .map(|d| DigestFiles {
            digest_models: d.join("digest_models.tsv").is_file(),
            digest_models_v2: d.join("digest_models_v2.tsv").is_file(),
            massgap_mods: d.join("massgap_mods.tsv").is_file(),
            calibration: d.join("digest_calibration.tsv").is_file(),
        })
        .unwrap_or_default();
    let alk = match alkylation_env.filter(|e| !e.is_empty()) {
        Some(e) => Path::new(e).is_dir().then(|| PathBuf::from(e)),
        None => dir.as_deref().and_then(alkylation_sibling).filter(|a| a.is_dir()),
    };
    DataStatus {
        digest_dir: dir.as_deref().map(shown),
        files,
        proteomes: alk.as_deref().map(proteomes_in).unwrap_or_default(),
        alkylation_dir: alk.as_deref().map(shown),
        searched,
        from_env: digest_env.is_some(),
    }
}

/// The value of @p var a child gets: the folder the app sets, else the
/// user's own (inherited).
fn child_env(var: &str, set: Option<PathBuf>) -> Option<String> {
    set.map(|p| p.display().to_string()).or_else(|| std::env::var(var).ok())
}

/// Where a run finds FASTag's shipped data, resolved as the CLI does from the
/// binary the app runs and the environment it gets (data_env).
#[tauri::command]
pub fn data_status(app: AppHandle) -> DataStatus {
    let r = crate::fastag::resolve_binary(&app);
    let digest = child_env("FASTAG_DIGEST_DIR", digest_dir(&r));
    let alkylation = child_env("FASTAG_ALKYLATION_DIR", alkylation_dir(&r));
    data_status_of(digest.as_deref(), alkylation.as_deref(), &r.bin)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tree(name: &str) -> (PathBuf, PathBuf) {
        let root = std::env::temp_dir().join(format!("fastag-datastatus-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let bin = root.join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        (dunce::canonicalize(&root).unwrap(), dunce::canonicalize(&bin).unwrap().join("FASTag"))
    }

    fn digest_at(d: &Path, files: &[&str]) {
        std::fs::create_dir_all(d).unwrap();
        for f in files {
            std::fs::write(d.join(f), "x").unwrap();
        }
    }

    const ALL: [&str; 4] = ["digest_models.tsv", "digest_models_v2.tsv", "massgap_mods.tsv", "digest_calibration.tsv"];

    #[test]
    fn the_install_layout_with_its_proteomes() {
        let (root, bin) = tree("install");
        let d = root.join("share").join("FASTag").join("digest");
        digest_at(&d, &ALL);
        let a = root.join("share").join("FASTag").join("alkylation");
        std::fs::create_dir_all(&a).unwrap();
        std::fs::write(a.join("proteomes.tsv"), "name\tproteome\tfile\nhuman\tUP1\thuman.fasta.gz\nyeast\tUP2\tyeast.fasta.gz\n").unwrap();
        std::fs::write(a.join("human.fasta.gz"), "x").unwrap();
        let s = data_status_of(None, None, &bin);
        assert_eq!(s.digest_dir.as_deref(), Some(d.display().to_string().as_str()));
        assert_eq!(s.files, DigestFiles { digest_models: true, digest_models_v2: true, massgap_mods: true, calibration: true });
        assert_eq!(s.alkylation_dir.as_deref(), Some(a.display().to_string().as_str()));
        // yeast is in the manifest, but its file is not there.
        assert_eq!(s.proteomes, vec!["human".to_string()]);
        assert!(!s.from_env);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn the_flat_layout_and_a_build_tree() {
        let (root, bin) = tree("flat");
        let d = root.join("bin").join("share-FASTag-digest");
        digest_at(&d, &["digest_models.tsv", "massgap_mods.tsv"]);
        let a = root.join("bin").join("share-FASTag-alkylation");
        std::fs::create_dir_all(&a).unwrap();
        // No manifest: <name>.fasta.gz, as the CLI reads it.
        std::fs::write(a.join("ecoli.fasta.gz"), "x").unwrap();
        let s = data_status_of(None, None, &bin);
        assert_eq!(s.digest_dir.as_deref(), Some(d.display().to_string().as_str()));
        assert!(s.files.digest_models && s.files.massgap_mods && !s.files.digest_models_v2 && !s.files.calibration);
        assert_eq!(s.proteomes, vec!["ecoli".to_string()]);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_bare_binary_names_every_folder_it_looked_in() {
        let (root, bin) = tree("bare");
        // A folder without digest_models.tsv does not count.
        digest_at(&root.join("bin").join("digest"), &["massgap_mods.tsv"]);
        let s = data_status_of(None, None, &bin);
        assert_eq!(s.digest_dir, None);
        assert_eq!(s.files, DigestFiles::default());
        assert_eq!((s.alkylation_dir, s.proteomes.len()), (None, 0));
        let b = root.join("bin");
        assert_eq!(
            s.searched,
            vec![
                root.join("share").join("FASTag").join("digest").display().to_string(),
                b.join("share-FASTag-digest").display().to_string(),
                b.join("digest").display().to_string(),
            ]
        );
        assert!(s.searched.iter().all(|p| !p.contains("..")));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn the_env_folder_wins_and_one_that_is_no_folder_finds_nothing() {
        let (root, bin) = tree("env");
        digest_at(&root.join("bin").join("share-FASTag-digest"), &ALL);
        let mine = root.join("mine").join("digest");
        digest_at(&mine, &["digest_models.tsv"]);
        let env = mine.display().to_string();
        let s = data_status_of(Some(&env), None, &bin);
        assert!(s.from_env);
        assert_eq!(s.digest_dir.as_deref(), Some(env.as_str()));
        assert!(s.files.digest_models && !s.files.massgap_mods);
        assert_eq!(s.searched, vec![env.clone()]);
        // As the CLI does: not replaced by the data beside the binary.
        let s = data_status_of(Some("/nonexistent/fastag"), None, &bin);
        assert!(s.from_env && s.digest_dir.is_none() && !s.files.digest_models);
        assert_eq!(s.searched, vec!["/nonexistent/fastag".to_string()]);
        // An empty value is no value.
        assert!(data_status_of(Some(""), None, &bin).digest_dir.is_some());
        // FASTAG_ALKYLATION_DIR: as given, and nothing when it is no folder.
        let alk = root.join("alk");
        std::fs::create_dir_all(&alk).unwrap();
        std::fs::write(alk.join("mouse.fasta.gz"), "x").unwrap();
        let s = data_status_of(None, Some(&alk.display().to_string()), &bin);
        assert_eq!(s.proteomes, vec!["mouse".to_string()]);
        assert_eq!(data_status_of(None, Some("/nonexistent/alk"), &bin).alkylation_dir, None);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn the_bundled_folders_only_for_the_apps_own_cli() {
        let (root, bin) = tree("bundled");
        digest_at(&root.join("share").join("FASTag").join("digest"), &["digest_models.tsv"]);
        let r = Resolved { bin: bin.clone(), data: None, taxonomy: None, source: "bundled" };
        assert_eq!(bundled(&r, "digest", "digest_models.tsv"), Some(root.join("share").join("FASTag").join("digest")));
        // No proteomes.tsv: no bundled alkylation folder.
        assert_eq!(bundled(&r, "alkylation", "proteomes.tsv"), None);
        let env = Resolved { source: "env", ..r };
        assert_eq!(bundled(&env, "digest", "digest_models.tsv"), None);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_dev_cli_without_its_own_data_gets_the_sources_data() {
        let (root, bin) = tree("dev");
        let src = root.join("src-data");
        digest_at(&src.join("digest"), &["digest_models.tsv"]);
        digest_at(&src.join("alkylation"), &["proteomes.tsv"]);
        digest_at(&src.join("taxonomy"), &["nodes.dmp"]);
        let r = Resolved { bin: bin.clone(), data: None, taxonomy: None, source: "env" };
        // Nothing beside the binary: the sources' folders.
        for (name, marker) in [("digest", "digest_models.tsv"), ("alkylation", "proteomes.tsv"), ("taxonomy", "nodes.dmp")] {
            assert_eq!(dev_data(&r, name, marker, Some(&src)), Some(src.join(name)), "{name}");
        }
        // A build tree with the data linked beside it finds its own: no override.
        digest_at(&root.join("bin").join("share-FASTag-digest"), &["digest_models.tsv"]);
        assert_eq!(dev_data(&r, "digest", "digest_models.tsv", Some(&src)), None);
        // The install layout counts too.
        digest_at(&root.join("share").join("FASTag").join("alkylation"), &["proteomes.tsv"]);
        assert_eq!(dev_data(&r, "alkylation", "proteomes.tsv", Some(&src)), None);
        // Only for a CLI from FASTAG_BIN, and only with sources that hold the file.
        assert_eq!(dev_data(&Resolved { source: "bundled", ..Resolved { bin: bin.clone(), data: None, taxonomy: None, source: "env" } }, "taxonomy", "nodes.dmp", Some(&src)), None);
        assert_eq!(dev_data(&Resolved { bin: PathBuf::from("FASTag"), data: None, taxonomy: None, source: "path" }, "taxonomy", "nodes.dmp", Some(&src)), None);
        assert_eq!(dev_data(&r, "taxonomy", "nodes.dmp", None), None);
        assert_eq!(dev_data(&r, "taxonomy", "species_call.tsv", Some(&src)), None);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// The reported runs (exit 6, "No shipped protease models found"): the app
    /// ran a dev CLI from FASTAG_BIN with no data beside it and gave it no
    /// FASTAG_DIGEST_DIR. A debug app now passes the sources' data/.
    #[test]
    fn a_dev_cli_run_gets_the_data_env_vars() {
        if ["FASTAG_DIGEST_DIR", "FASTAG_ALKYLATION_DIR", "FASTAG_TAXONOMY_DIR"].iter().any(|v| std::env::var_os(v).is_some()) {
            eprintln!("skipped: a FASTAG_*_DIR is set in this environment");
            return;
        }
        let (root, bin) = tree("devenv");
        let r = Resolved { bin, data: None, taxonomy: None, source: "env" };
        let mut cmd = Command::new("true");
        data_env(&mut cmd, &r);
        let envs: std::collections::HashMap<String, PathBuf> = cmd
            .get_envs()
            .filter_map(|(k, v)| Some((k.to_str()?.to_string(), PathBuf::from(v?))))
            .collect();
        let data = dunce::canonicalize(source_data().unwrap()).unwrap();
        assert_eq!(envs.get("FASTAG_DIGEST_DIR"), Some(&data.join("digest")));
        assert_eq!(envs.get("FASTAG_ALKYLATION_DIR"), Some(&data.join("alkylation")));
        assert_eq!(envs.get("FASTAG_TAXONOMY_DIR"), Some(&data.join("taxonomy")));
        // Every file the CLI reads from them is there (tools/shipped_data.py lists them).
        for f in ["digest/digest_models.tsv", "digest/massgap_mods.tsv", "alkylation/proteomes.tsv", "alkylation/human.fasta.gz", "taxonomy/species_call.tsv"] {
            assert!(data.join(f).is_file(), "{f}");
        }
        // What the inspector's check reports is what the run gets.
        let s = data_status_of(envs.get("FASTAG_DIGEST_DIR").and_then(|p| p.to_str()), envs.get("FASTAG_ALKYLATION_DIR").and_then(|p| p.to_str()), &r.bin);
        assert!(s.files.digest_models && s.files.massgap_mods);
        assert_eq!(s.proteomes.len(), 4);
        let _ = std::fs::remove_dir_all(&root);
    }
}
