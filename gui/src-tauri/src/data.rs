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

/// The cache tools/fetch_taxonomy_index.py fetches the taxonomy index into
/// (CMakeLists.txt FASTAG_TAXONOMY_CACHE_DIR): %LOCALAPPDATA%\fastag on
/// Windows, else $XDG_CACHE_HOME/fastag, else ~/.cache/fastag. Debug builds
/// only, as source_data.
fn dev_cache() -> Option<PathBuf> {
    if !cfg!(debug_assertions) {
        return None;
    }
    let set = |v: &str| std::env::var_os(v).filter(|s| !s.is_empty()).map(PathBuf::from);
    if cfg!(windows) {
        if let Some(l) = set("LOCALAPPDATA") {
            return Some(l.join("fastag"));
        }
    }
    set("XDG_CACHE_HOME").map(|x| x.join("fastag")).or_else(|| set("HOME").map(|h| h.join(".cache").join("fastag")))
}

/// A taxonomy folder -species can use: the dumps and the k-mer index.
fn has_index(d: &Path) -> bool {
    ["nodes.dmp", "names.dmp", "tax_k7.taxdb"].iter().all(|f| d.join(f).is_file())
}

/// The sha256 of the file @p p, lower-case hex.
fn sha256_file(p: &Path) -> Option<String> {
    use sha2::Digest;
    use std::io::Read;
    let mut f = std::fs::File::open(p).ok()?;
    let mut h = sha2::Sha256::new();
    let mut buf = vec![0u8; 1 << 16];
    loop {
        let n = f.read(&mut buf).ok()?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Some(h.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

/// @p d holds a complete fetch of the manifest @p manifest, as
/// tools/fetch_taxonomy_index.py fetched_complete (and stage-data.cmake)
/// decide it: its completion marker .fastag-fetched names that manifest by
/// data release and sha256 and lists each of its files with the pinned
/// sha256 and size, and each is a regular file of that size in @p d; a
/// linked file (fetched --from without --copy) is also hashed again, since
/// its target can change after the fetch at the same size (codex6 review
/// n3). An interrupted or failed fetch has no such marker.
fn fetched_complete(d: &Path, manifest: &Path) -> bool {
    let marker = d.join(".fastag-fetched");
    if std::fs::symlink_metadata(&marker).map(|m| !m.is_file()).unwrap_or(true) {
        return false;
    }
    let (Ok(text), Ok(json)) = (std::fs::read_to_string(&marker), std::fs::read_to_string(manifest)) else {
        return false;
    };
    let Ok(man) = serde_json::from_str::<serde_json::Value>(&json) else { return false };
    let (Some(release), Some(files), Some(msha)) = (man["data_release"].as_str(), man["files"].as_object(), sha256_file(manifest)) else {
        return false;
    };
    let lines: Vec<Vec<&str>> = text.lines().map(|l| l.split_whitespace().collect()).collect();
    if !lines.iter().any(|f| f.as_slice() == ["manifest", release, msha.as_str()]) || files.is_empty() {
        return false;
    }
    files.iter().all(|(name, want)| {
        let Some(sha) = want["sha256"].as_str() else { return false };
        let p = d.join(name);
        let Ok(m) = std::fs::metadata(&p) else { return false };
        let size = m.len().to_string();
        let linked = std::fs::symlink_metadata(&p).map(|l| l.file_type().is_symlink()).unwrap_or(true);
        m.is_file()
            && want["bytes"].as_u64().is_none_or(|b| b == m.len())
            && lines.iter().any(|f| f.as_slice() == ["file", name.as_str(), size.as_str(), sha])
            && (!linked || sha256_file(&p).as_deref() == Some(sha))
    })
}

/// For a CLI that finds no k-mer index (none beside it, @p r.taxonomy unset:
/// a build tree without one staged, a dev bundle of its dumps only), the
/// index tools/fetch_taxonomy_index.py put in @p cache: the first
/// <cache>/<data release>/share-FASTag-taxonomy that holds a complete fetch
/// of it (fetched_complete), one data release per manifest of
/// @p src/taxonomy/manifests, newest first. The same
/// folders a build tree stages (FASTAG_TAXONOMY_INDEX_AUTO), so the debug app
/// runs -species on this machine with no variable set. None without sources
/// or cache (a release build), or for a CLI that has its own.
fn dev_index(r: &Resolved, src: Option<&Path>, cache: Option<&Path>) -> Option<PathBuf> {
    let (src, cache) = (src?, cache?);
    if r.source == "missing" || r.taxonomy.is_some() {
        return None;
    }
    let b = r.bin.parent().filter(|b| !b.as_os_str().is_empty())?;
    let beside = [b.join("..").join("share").join("FASTag").join("taxonomy"), b.join("share-FASTag-taxonomy"), b.join("taxonomy")];
    if beside.iter().any(|c| has_index(c)) {
        return None;
    }
    let mut releases: Vec<String> = std::fs::read_dir(src.join("taxonomy").join("manifests"))
        .ok()?
        .filter_map(|e| {
            let p = e.ok()?.path();
            (p.extension()? == "json").then(|| p.file_stem()?.to_str().map(str::to_string)).flatten()
        })
        .collect();
    releases.sort_unstable_by(|a, b| b.cmp(a));
    let manifests = src.join("taxonomy").join("manifests");
    releases
        .iter()
        .map(|rel| (cache.join(rel).join("share-FASTag-taxonomy"), manifests.join(format!("{rel}.json"))))
        .find(|(d, m)| has_index(d) && fetched_complete(d, m))
        .map(|(d, _)| d)
}

/// The taxonomy folder a CLI child gets as FASTAG_TAXONOMY_DIR: as
/// fastag::taxonomy_dir, else (debug builds) the fetched index (dev_index),
/// else (a CLI from FASTAG_BIN without its own) the sources' data/taxonomy,
/// which has the dumps and species_call.tsv but no index. species.rs reports
/// on this same folder.
pub(crate) fn taxonomy_dir_for_child(r: &Resolved) -> Option<PathBuf> {
    taxonomy_dir(r)
        .or_else(|| dev_index(r, source_data().as_deref(), dev_cache().as_deref()))
        .or_else(|| dev_data(r, "taxonomy", "nodes.dmp", source_data().as_deref()))
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
    /// -alkylation_proteome auto reads no database without -recon_fasta or
    /// -fasta: Some(true) when the engine says so (-data_paths
    /// alkylation_auto none), Some(false) when it reports another reading.
    /// None (unknown) for an engine without -data_paths: one from before
    /// 1.16 reads auto as the shipped human proteome, but the CLI of
    /// 0dfac519 already reads it database-free without the flag, so the
    /// absence of the probe tells neither.
    auto_db_free: Option<bool>,
}

/// What `-data_paths` prints (FASTag.cpp dataPathsJson_).
#[derive(serde::Deserialize)]
struct EnginePaths {
    digest_dir: Option<String>,
    #[serde(default)]
    digest_from_env: bool,
    #[serde(default)]
    digest_searched: Vec<String>,
    alkylation_dir: Option<String>,
    #[serde(default)]
    proteomes: Vec<String>,
    #[serde(default)]
    alkylation_auto: Option<String>,
}

/// The DataStatus of the JSON line @p line of `-data_paths`: the folders the
/// engine itself reads; the digest tables are those in its digest folder.
fn data_status_of_engine(line: &str) -> Option<DataStatus> {
    let e: EnginePaths = serde_json::from_str(line).ok()?;
    let dir = e.digest_dir.filter(|d| !d.is_empty()).map(PathBuf::from);
    let files = dir.as_ref().map(|d| digest_files(d)).unwrap_or_default();
    Some(DataStatus {
        digest_dir: dir.as_deref().map(shown),
        files,
        alkylation_dir: e.alkylation_dir.filter(|d| !d.is_empty()).map(|d| shown(Path::new(&d))),
        proteomes: e.proteomes.into_iter().filter(|p| PROTEOMES.contains(&p.as_str())).collect(),
        searched: e.digest_searched,
        from_env: e.digest_from_env,
        auto_db_free: Some(e.alkylation_auto.as_deref() == Some("none")),
    })
}

/// Which digest tables @p d holds.
fn digest_files(d: &Path) -> DigestFiles {
    DigestFiles {
        digest_models: d.join("digest_models.tsv").is_file(),
        digest_models_v2: d.join("digest_models_v2.tsv").is_file(),
        massgap_mods: d.join("massgap_mods.tsv").is_file(),
        calibration: d.join("digest_calibration.tsv").is_file(),
    }
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
    let files = dir.as_deref().map(digest_files).unwrap_or_default();
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
        auto_db_free: None,
    }
}

/// The value of @p var a child gets: the folder the app sets, else the
/// user's own (inherited).
fn child_env(var: &str, set: Option<PathBuf>) -> Option<String> {
    set.map(|p| p.display().to_string()).or_else(|| std::env::var(var).ok())
}

/// Where a run of @p r finds FASTag's shipped data: what the engine itself
/// reports (-data_paths, with the environment its runs get), else, for an
/// engine without the flag, resolved as the CLI does (data_status_of) from
/// the resolved absolute binary and that environment, with how it reads
/// auto unknown (auto_db_free None).
pub(crate) fn data_status_for(r: &Resolved) -> DataStatus {
    if let Some(s) = crate::inspect::data_paths_of(r).and_then(|l| data_status_of_engine(&l)) {
        return s;
    }
    let digest = child_env("FASTAG_DIGEST_DIR", digest_dir(r));
    let alkylation = child_env("FASTAG_ALKYLATION_DIR", alkylation_dir(r));
    let mut s = data_status_of(digest.as_deref(), alkylation.as_deref(), &r.bin);
    // It has the flag, but its answer was lost: still the 1.16 meaning.
    // Without the flag it is not known (None).
    s.auto_db_free = crate::inspect::cli_has(r, "data_paths").then_some(true);
    s
}

/// Where a run finds FASTag's shipped data (data_status_for).
#[tauri::command]
pub async fn data_status(app: AppHandle) -> DataStatus {
    let r = crate::fastag::resolve_binary(&app);
    tauri::async_runtime::spawn_blocking(move || data_status_for(&r))
        .await
        .unwrap_or_else(|_| data_status_of(None, None, Path::new("")))
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
        // A CLI found on PATH is absolute (fastag::find_on_path) and finds its own data.
        assert_eq!(dev_data(&Resolved { bin: bin.clone(), data: None, taxonomy: None, source: "path" }, "taxonomy", "nodes.dmp", Some(&src)), None);
        assert_eq!(dev_data(&r, "taxonomy", "nodes.dmp", None), None);
        assert_eq!(dev_data(&r, "taxonomy", "species_call.tsv", Some(&src)), None);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A manifest pinning the three files digest_at writes ("x", 1 byte).
    fn manifest_json(rel: &str) -> String {
        let x = "2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881";
        format!(
            r#"{{"data_release":"{rel}","note":"x","files":{{"tax_k7.taxdb":{{"sha256":"{x}","bytes":1}},"nodes.dmp":{{"sha256":"{x}","bytes":1}},"names.dmp":{{"sha256":"{x}","bytes":1}}}}}}"#
        )
    }

    /// The completion marker tools/fetch_taxonomy_index.py writes into @p d
    /// for the manifest @p m.
    fn fetched(d: &Path, m: &Path, rel: &str) {
        let x = "2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881";
        let mut t = format!("# marker\nmanifest {rel} {}\n", sha256_file(m).unwrap());
        for n in ["names.dmp", "nodes.dmp", "tax_k7.taxdb"] {
            t.push_str(&format!("file {n} 1 {x}\n"));
        }
        std::fs::write(d.join(".fastag-fetched"), t).unwrap();
    }

    /// A build tree or dev bundle with no index of its own: a debug app gives
    /// the CLI the index tools/fetch_taxonomy_index.py fetched, newest data
    /// release first; never over an index the CLI has, nor without one.
    #[test]
    fn a_dev_cli_without_an_index_gets_the_fetched_one() {
        let (root, bin) = tree("devindex");
        let src = root.join("src-data");
        let mans = src.join("taxonomy").join("manifests");
        digest_at(&mans, &["notes.txt"]);
        let cache = root.join("cache");
        let old = cache.join("taxonomy-k7-20260901").join("share-FASTag-taxonomy");
        let new = cache.join("taxonomy-k7-20270101").join("share-FASTag-taxonomy");
        for rel in ["taxonomy-k7-20260901", "taxonomy-k7-20270101"] {
            std::fs::write(mans.join(format!("{rel}.json")), manifest_json(rel)).unwrap();
        }
        let mk = |source: &'static str, taxonomy: Option<PathBuf>| Resolved { bin: bin.clone(), data: None, taxonomy, source };
        let r = mk("env", None);
        // No cache folder holds an index: nothing.
        assert_eq!(dev_index(&r, Some(&src), Some(&cache)), None);
        // Dumps without the index are no index.
        digest_at(&new, &["nodes.dmp", "names.dmp"]);
        assert_eq!(dev_index(&r, Some(&src), Some(&cache)), None);
        digest_at(&old, &["nodes.dmp", "names.dmp", "tax_k7.taxdb"]);
        // Codex finding 1: the files without the fetch's completion marker
        // (an interrupted or failed fetch) are no index.
        assert_eq!(dev_index(&r, Some(&src), Some(&cache)), None);
        fetched(&old, &mans.join("taxonomy-k7-20260901.json"), "taxonomy-k7-20260901");
        assert_eq!(dev_index(&r, Some(&src), Some(&cache)), Some(old.clone()));
        // The newest data release first, once its fetch is complete.
        digest_at(&new, &["tax_k7.taxdb"]);
        assert_eq!(dev_index(&r, Some(&src), Some(&cache)), Some(old.clone()));
        fetched(&new, &mans.join("taxonomy-k7-20270101.json"), "taxonomy-k7-20270101");
        assert_eq!(dev_index(&r, Some(&src), Some(&cache)), Some(new.clone()));
        // A marker of another manifest (the manifest changed since), or a
        // file cut short since the fetch: not that release's index.
        let changed = mans.join("taxonomy-k7-20270101.json");
        std::fs::write(&changed, manifest_json("taxonomy-k7-20270101").replace("\"x\"", "\"x \"")).unwrap();
        assert_eq!(dev_index(&r, Some(&src), Some(&cache)), Some(old.clone()));
        std::fs::write(&changed, manifest_json("taxonomy-k7-20270101")).unwrap();
        assert_eq!(dev_index(&r, Some(&src), Some(&cache)), Some(new.clone()));
        std::fs::write(new.join("tax_k7.taxdb"), "").unwrap();
        assert_eq!(dev_index(&r, Some(&src), Some(&cache)), Some(old.clone()));
        std::fs::write(new.join("tax_k7.taxdb"), "x").unwrap();
        assert_eq!(dev_index(&r, Some(&src), Some(&cache)), Some(new.clone()));
        // Codex6 review n3: a linked index (fetch --from without --copy)
        // whose target changes at the same size after the fetch: the marker
        // and the size still match, the live sha256 does not.
        #[cfg(unix)]
        {
            let target = root.join("linked-index");
            std::fs::write(&target, "x").unwrap();
            std::fs::remove_file(new.join("tax_k7.taxdb")).unwrap();
            std::os::unix::fs::symlink(&target, new.join("tax_k7.taxdb")).unwrap();
            assert_eq!(dev_index(&r, Some(&src), Some(&cache)), Some(new.clone()));
            std::fs::write(&target, "y").unwrap();
            assert_eq!(dev_index(&r, Some(&src), Some(&cache)), Some(old.clone()));
            std::fs::write(&target, "x").unwrap();
            assert_eq!(dev_index(&r, Some(&src), Some(&cache)), Some(new.clone()));
        }
        // Every kind of dev CLI: from FASTAG_BIN, on PATH, a dev bundle of dumps only.
        for source in ["path", "bundled"] {
            assert_eq!(dev_index(&mk(source, None), Some(&src), Some(&cache)), Some(new.clone()), "{source}");
        }
        // Not for a missing CLI, a bundle with its index, or without sources or cache (release builds).
        assert_eq!(dev_index(&mk("missing", None), Some(&src), Some(&cache)), None);
        assert_eq!(dev_index(&mk("bundled", Some(root.join("t"))), Some(&src), Some(&cache)), None);
        assert_eq!(dev_index(&r, None, Some(&cache)), None);
        assert_eq!(dev_index(&r, Some(&src), None), None);
        // A dumps-only folder beside the CLI does not stop it; one with the index does.
        let beside = root.join("bin").join("share-FASTag-taxonomy");
        digest_at(&beside, &["nodes.dmp", "names.dmp"]);
        assert_eq!(dev_index(&r, Some(&src), Some(&cache)), Some(new.clone()));
        digest_at(&beside, &["tax_k7.taxdb"]);
        assert_eq!(dev_index(&r, Some(&src), Some(&cache)), None);
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
        // The fetched index when this machine has one (dev_index), else the
        // sources' dumps.
        let tax = dev_index(&r, source_data().as_deref(), dev_cache().as_deref()).unwrap_or_else(|| data.join("taxonomy"));
        assert_eq!(envs.get("FASTAG_TAXONOMY_DIR"), Some(&tax));
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

    /// An executable stub at @p p printing @p helphelp for --helphelp and
    /// @p json for -data_paths.
    #[cfg(unix)]
    fn stub_at(p: &Path, helphelp: &str, json: &str) {
        use std::os::unix::fs::PermissionsExt;
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        let script = format!(
            "#!/bin/sh\nif [ \"$1\" = --helphelp ]; then\ncat <<'EOF'\nFASTag -- stub\nVersion: 0.0.0-stub\n\nOptions:\n  -in <file>                       Input\n{helphelp}EOF\nexit 0\nfi\nif [ \"$1\" = -data_paths ]; then\ncat <<'EOF'\n{json}\nEOF\nexit 0\nfi\nexit 1\n"
        );
        std::fs::write(p, script).unwrap();
        std::fs::set_permissions(p, std::fs::Permissions::from_mode(0o755)).unwrap();
    }

    // Codex n5 (2): a FASTag found on PATH is its absolute, canonical path, so
    // the check looks beside its real folder, as the CLI does; the bare name
    // the app stored before looked relative to the app's own working folder.
    #[cfg(unix)]
    #[test]
    fn a_path_launch_looks_beside_the_real_binary() {
        let (root, bin) = tree("pathlaunch");
        stub_at(&bin, "", "");
        let d = root.join("share").join("FASTag").join("digest");
        digest_at(&d, &["digest_models.tsv"]);
        // Not a file, not executable, or not there: the next folder.
        let empty = root.join("empty");
        std::fs::create_dir_all(empty.join("FASTag")).unwrap();
        let noexec = root.join("noexec");
        digest_at(&noexec, &["FASTag"]);
        let path = std::env::join_paths([empty.clone(), noexec, root.join("gone"), bin.parent().unwrap().to_path_buf()]).unwrap();
        let found = crate::fastag::find_on_path(&path, "FASTag").expect("the stub on PATH");
        assert_eq!(found, bin);
        assert!(found.is_absolute());
        let s = data_status_of(None, None, &found);
        assert_eq!(s.digest_dir.as_deref(), Some(d.display().to_string().as_str()));
        assert!(s.files.digest_models);
        // The bare name finds nothing there (its folders are the app's cwd's).
        let bare = data_status_of(None, None, Path::new("FASTag"));
        assert_ne!(bare.digest_dir, s.digest_dir);
        assert!(bare.searched.iter().all(|p| !Path::new(p).starts_with(&root)), "{:?}", bare.searched);
        assert_eq!(crate::fastag::find_on_path(&std::env::join_paths([empty]).unwrap(), "FASTag"), None);
        let _ = std::fs::remove_dir_all(&root);
    }

    // Codex n5 (1): FASTAG_BIN through a symlink (a Homebrew bin/FASTag into
    // the Cellar) is the canonical target, whose data the CLI reads.
    #[cfg(unix)]
    #[test]
    fn an_override_through_a_symlink_is_the_target() {
        let (root, bin) = tree("override");
        stub_at(&bin, "", "");
        digest_at(&root.join("share").join("FASTag").join("digest"), &["digest_models.tsv"]);
        let link_dir = root.join("brew").join("bin");
        std::fs::create_dir_all(&link_dir).unwrap();
        let link = link_dir.join("FASTag");
        std::os::unix::fs::symlink(&bin, &link).unwrap();
        let r = crate::fastag::env_override(&link.display().to_string()).unwrap();
        assert_eq!((r.bin.clone(), r.source), (bin.clone(), "env"));
        assert!(data_status_of(None, None, &r.bin).files.digest_models);
        // Beside the link there is nothing.
        assert!(!data_status_of(None, None, &link).files.digest_models);
        assert!(crate::fastag::env_override(&root.join("gone").display().to_string()).is_none());
        assert!(crate::fastag::env_override("").is_none());
        let _ = std::fs::remove_dir_all(&root);
    }

    // Codex n5 (2, 3): an engine that lists -data_paths reports its own
    // folders and that auto reads no database; for one without it how auto
    // reads is not known (auto_db_free None): the CLI of 0dfac519 has no
    // -data_paths yet reads auto database-free, an older one reads human.
    #[cfg(unix)]
    #[test]
    fn the_engine_reports_its_data_and_an_older_one_reads_auto_as_human() {
        if ["FASTAG_DIGEST_DIR", "FASTAG_ALKYLATION_DIR"].iter().any(|v| std::env::var_os(v).is_some()) {
            eprintln!("skipped: a FASTAG_*_DIR is set in this environment");
            return;
        }
        let (root, bin) = tree("engine");
        let d = root.join("elsewhere").join("digest");
        digest_at(&d, &["digest_models.tsv", "massgap_mods.tsv"]);
        let a = root.join("elsewhere").join("alkylation");
        std::fs::create_dir_all(&a).unwrap();
        let json = format!(
            r#"{{"digest_dir":"{}","digest_from_env":false,"digest_searched":["{}"],"alkylation_dir":"{}","proteomes":["yeast","nonsense"],"alkylation_auto":"none"}}"#,
            d.display(),
            d.display(),
            a.display()
        );
        stub_at(&bin, "  -data_paths                      Print the data folders\n", &json);
        let r = crate::fastag::env_override(&bin.display().to_string()).unwrap();
        let s = data_status_for(&r);
        assert_eq!(s.auto_db_free, Some(true));
        assert_eq!(s.digest_dir.as_deref(), Some(d.display().to_string().as_str()));
        assert!(s.files.digest_models && s.files.massgap_mods && !s.files.calibration);
        assert_eq!(s.alkylation_dir.as_deref(), Some(a.display().to_string().as_str()));
        assert_eq!(s.proteomes, vec!["yeast".to_string()]);
        assert_eq!(s.searched, vec![d.display().to_string()]);
        // The same data beside an older engine (0dfac519: no -data_paths):
        // its own lookup, and how it reads auto is unknown, not "human".
        let (old_root, old_bin) = tree("engine-old");
        stub_at(&old_bin, "", &json);
        let r = crate::fastag::env_override(&old_bin.display().to_string()).unwrap();
        let s = data_status_for(&r);
        assert_eq!(s.auto_db_free, None);
        assert!(serde_json::to_string(&s).unwrap().contains(r#""autoDbFree":null"#));
        // An engine that reports another reading of auto: Some(false).
        let other = json.replace(r#""alkylation_auto":"none""#, r#""alkylation_auto":"human""#);
        assert_eq!(data_status_of_engine(&other).unwrap().auto_db_free, Some(false));
        assert_ne!(s.digest_dir.as_deref(), Some(d.display().to_string().as_str()));
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&old_root);
    }
}
