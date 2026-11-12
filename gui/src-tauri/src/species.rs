// Read k from the taxonomy index header, so the UI can warn before a run
// that tag_length can't reach the index. The ranked-taxa TSV that -species
// writes is parsed in the renderer (src/results/species.ts, P4), which reads
// it as text through report_text like every other report.

use serde::Serialize;
use std::io::Read;
use std::path::{Path, PathBuf};

use tauri::AppHandle;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaxdbInfo {
    path: String,
    k: u32,
}

// Only regular files: opening a FIFO or a device would block, or never end.
fn is_regular(path: &str) -> bool {
    std::fs::metadata(path).map(|m| m.is_file()).unwrap_or(false)
}

// Layout: magic "FTXI"/"FTX2" | u32 version | u32 k | ...; only k is needed.
fn read_taxdb_info(path: &str) -> Option<TaxdbInfo> {
    if !is_regular(path) {
        return None;
    }
    let mut f = std::fs::File::open(path).ok()?;
    let mut buf = [0u8; 12];
    f.read_exact(&mut buf).ok()?;
    if &buf[0..4] != b"FTX2" && &buf[0..4] != b"FTXI" {
        return None;
    }
    let k = u32::from_le_bytes(buf[8..12].try_into().ok()?);
    Some(TaxdbInfo { path: path.to_string(), k })
}

/// The taxonomy folders the CLI searches, in its order (taxonomyDir_ in
/// FASTag.cpp): the one run() hands the child (the user's, else the bundled
/// one), then the install and tarball layouts next to the binary. The index
/// and the nodes.dmp and names.dmp dumps (sdrf.rs) are looked up here.
pub(crate) fn taxonomy_dirs(app: &AppHandle) -> Vec<PathBuf> {
    let r = crate::fastag::resolve_binary(app);
    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Some(t) = crate::fastag::taxonomy_dir(&r) {
        dirs.push(t);
    }
    if let Some(bin_dir) = r.bin.parent() {
        dirs.push(bin_dir.join("..").join("share").join("FASTag").join("taxonomy"));
        dirs.push(bin_dir.join("share-FASTag-taxonomy"));
        dirs.push(bin_dir.join("taxonomy"));
    }
    dirs
}

// The same search order the CLI uses (taxonomyDir_ in FASTag.cpp), so the GUI
// reports on the index the run will actually load.
fn bundled_taxdb(app: &AppHandle) -> Option<String> {
    for d in taxonomy_dirs(app) {
        let p = d.join("tax_k7.taxdb");
        if p.exists() {
            return Some(p.display().to_string());
        }
    }
    None
}

#[tauri::command]
pub fn taxdb_info(app: AppHandle, explicit: Option<String>) -> Option<TaxdbInfo> {
    let path = match explicit {
        Some(e) if !e.trim().is_empty() => e,
        _ => bundled_taxdb(&app)?,
    };
    read_taxdb_info(&path)
}

/// Where the CLI finds its taxonomy, for the check before a run with
/// -species (inspector checks.ts, "no-taxdb"): a fresh install has the dumps
/// but not the k-mer index, a separate release asset, and the run would
/// fail with exit 6 ("-species: no taxdb").
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaxonomyStatus {
    /// The index the run would load, None when there is none.
    index: Option<String>,
    /// The folder the CLI looks in (where the index belongs), None when it
    /// finds no taxonomy folder at all. For an explicit -taxdb: that file's.
    dir: Option<String>,
    /// The index the CLI would look for: <dir>/tax_k7.taxdb or the explicit
    /// -taxdb.
    expected: Option<String>,
    /// The folder comes from FASTAG_TAXONOMY_DIR.
    from_env: bool,
}

/// The CLI's own choice of the taxonomy folder (FASTag.cpp taxonomyDir_):
/// FASTAG_TAXONOMY_DIR if it names a folder, else, beside the executable,
/// ../share/FASTag/taxonomy, share-FASTag-taxonomy or taxonomy: the first
/// with the dumps and the index, else the first with the dumps, else the
/// first that exists.
fn cli_taxonomy_dir(env: Option<&str>, bin: &Path) -> (Option<PathBuf>, bool) {
    if let Some(e) = env.filter(|e| !e.is_empty() && Path::new(e).is_dir()) {
        return (Some(PathBuf::from(e)), true);
    }
    let Some(b) = bin.parent() else { return (None, false) };
    let cands = [b.join("..").join("share").join("FASTag").join("taxonomy"), b.join("share-FASTag-taxonomy"), b.join("taxonomy")];
    let dumps = |c: &Path| c.join("nodes.dmp").is_file() && c.join("names.dmp").is_file();
    let pick = cands
        .iter()
        .find(|c| c.is_dir() && dumps(c) && c.join("tax_k7.taxdb").is_file())
        .or_else(|| cands.iter().find(|c| c.is_dir() && dumps(c)))
        .or_else(|| cands.iter().find(|c| c.is_dir()));
    // ".." spelled out reads badly in the message: the folder as it is.
    (pick.map(|p| dunce::canonicalize(p).unwrap_or_else(|_| p.clone())), false)
}

fn taxonomy_status_of(explicit: Option<&str>, env: Option<&str>, bin: &Path) -> TaxonomyStatus {
    let shown = |p: &Path| p.display().to_string();
    if let Some(e) = explicit.map(str::trim).filter(|e| !e.is_empty()) {
        let p = Path::new(e);
        return TaxonomyStatus {
            index: is_regular(e).then(|| e.to_string()),
            dir: p.parent().map(shown),
            expected: Some(e.to_string()),
            from_env: false,
        };
    }
    let (dir, from_env) = cli_taxonomy_dir(env, bin);
    let expected = dir.as_ref().map(|d| d.join("tax_k7.taxdb"));
    TaxonomyStatus {
        index: expected.as_ref().filter(|p| p.is_file()).map(|p| shown(p)),
        dir: dir.as_deref().map(shown),
        expected: expected.as_deref().map(shown),
        from_env,
    }
}

/// The taxonomy a run with -species would use (@p explicit: the -taxdb
/// field), resolved as the CLI does from the binary the app runs.
#[tauri::command]
pub fn taxonomy_status(app: AppHandle, explicit: Option<String>) -> TaxonomyStatus {
    let r = crate::fastag::resolve_binary(&app);
    // The GUI passes its taxonomy folder (fastag::taxonomy_dir) to the CLI as
    // FASTAG_TAXONOMY_DIR, so that is the folder the CLI sees first.
    let env = crate::fastag::taxonomy_dir(&r).map(|p| p.display().to_string());
    taxonomy_status_of(explicit.as_deref(), env.as_deref(), &r.bin)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    // The species half of this test and of the next moved with the parser:
    // a species TSV is read through report.rs read_report (its tests
    // directory_is_an_error, missing_or_empty_path_is_none) and parsed by
    // src/results/species.ts (species.test.ts).
    fn tax_tree(name: &str) -> (PathBuf, PathBuf) {
        let root = std::env::temp_dir().join(format!("fastag-taxstatus-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let bin = root.join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        (root, bin.join("FASTag"))
    }

    // A fresh install: the dumps ship, the index does not. The status names
    // the folder the CLI looks in, as its "no taxdb" message does.
    #[test]
    fn a_fresh_install_has_no_index_and_names_where_it_belongs() {
        let (root, bin) = tax_tree("fresh");
        let tax = root.join("share").join("FASTag").join("taxonomy");
        std::fs::create_dir_all(&tax).unwrap();
        std::fs::write(tax.join("nodes.dmp"), "").unwrap();
        std::fs::write(tax.join("names.dmp"), "").unwrap();
        let s = taxonomy_status_of(None, None, &bin);
        let want = dunce::canonicalize(&tax).unwrap();
        assert_eq!(s.index, None);
        assert_eq!(s.dir.as_deref(), Some(want.display().to_string().as_str()));
        assert_eq!(s.expected, Some(want.join("tax_k7.taxdb").display().to_string()));
        assert!(!s.from_env);
        // Unpacked there: found.
        std::fs::write(tax.join("tax_k7.taxdb"), "FTX2").unwrap();
        let s = taxonomy_status_of(None, None, &bin);
        assert_eq!(s.index, s.expected);
        assert!(s.index.is_some());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn the_env_folder_and_an_explicit_index_win_as_in_the_cli() {
        let (root, bin) = tax_tree("env");
        let mine = root.join("mine");
        std::fs::create_dir_all(&mine).unwrap();
        let env = mine.display().to_string();
        let s = taxonomy_status_of(None, Some(&env), &bin);
        assert!(s.from_env && s.index.is_none());
        assert_eq!(s.dir.as_deref(), Some(env.as_str()));
        // A FASTAG_TAXONOMY_DIR that is no folder is ignored, as the CLI does.
        let s = taxonomy_status_of(None, Some("/nonexistent/fastag"), &bin);
        assert!(!s.from_env && s.dir.is_none() && s.expected.is_none());
        // -taxdb given: that file, found or not.
        let f = mine.join("x.taxdb");
        let fp = f.display().to_string();
        assert_eq!(taxonomy_status_of(Some(&fp), Some(&env), &bin).index, None);
        std::fs::write(&f, "FTX2").unwrap();
        let s = taxonomy_status_of(Some(&fp), None, &bin);
        assert_eq!((s.index.as_deref(), s.expected.as_deref()), (Some(fp.as_str()), Some(fp.as_str())));
        // A blank field is no explicit index.
        assert_eq!(taxonomy_status_of(Some("  "), Some(&env), &bin).dir.as_deref(), Some(env.as_str()));
        let _ = std::fs::remove_dir_all(&root);
    }

    // The release tarball's flat layout (share-FASTag-taxonomy beside the
    // executable) and a complete folder beating one with dumps only.
    #[test]
    fn a_complete_folder_beats_one_with_dumps_only() {
        let (root, bin) = tax_tree("order");
        let share = root.join("share").join("FASTag").join("taxonomy");
        let flat = root.join("bin").join("share-FASTag-taxonomy");
        for d in [&share, &flat] {
            std::fs::create_dir_all(d).unwrap();
            std::fs::write(d.join("nodes.dmp"), "").unwrap();
            std::fs::write(d.join("names.dmp"), "").unwrap();
        }
        std::fs::write(flat.join("tax_k7.taxdb"), "FTX2").unwrap();
        let s = taxonomy_status_of(None, None, &bin);
        assert_eq!(s.index, Some(dunce::canonicalize(&flat).unwrap().join("tax_k7.taxdb").display().to_string()));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_directory_is_not_read() {
        // Only regular files are read.
        let d = std::env::temp_dir();
        assert!(read_taxdb_info(d.to_str().unwrap()).is_none());
    }

    #[test]
    fn ftx2_and_ftxi_headers_read_k() {
        let f = tempfile_path("t.taxdb");
        for (magic, k) in [(b"FTX2", 7u32), (b"FTXI", 6u32)] {
            let mut buf = Vec::new();
            buf.extend_from_slice(magic);
            buf.extend_from_slice(&2u32.to_le_bytes()); // version
            buf.extend_from_slice(&k.to_le_bytes());
            let mut fh = std::fs::File::create(&f).unwrap();
            fh.write_all(&buf).unwrap();
            drop(fh);
            assert_eq!(read_taxdb_info(f.to_str().unwrap()).unwrap().k, k);
        }
        std::fs::remove_file(&f).ok();
    }

    // The reader lets the open fail instead of pre-checking the path, and
    // `taxdb_info` is a #[tauri::command] the frontend can call with "". A
    // directory is here because the picker can hand one over.
    #[test]
    fn empty_missing_or_directory_path_is_none() {
        let dir = std::env::temp_dir();
        let dir = dir.to_str().unwrap();
        for p in ["", "/nonexistent/fastag/x", dir] {
            assert!(read_taxdb_info(p).is_none(), "read_taxdb_info({p:?})");
        }
    }

    #[test]
    fn truncated_or_alien_header_is_none() {
        let f = tempfile_path("bad.taxdb");
        std::fs::write(&f, b"FTX2\x02\x00").unwrap(); // 6 bytes only
        assert!(read_taxdb_info(f.to_str().unwrap()).is_none());
        std::fs::write(&f, b"NOPEnopeNOPEnopeNOPEnope").unwrap();
        assert!(read_taxdb_info(f.to_str().unwrap()).is_none());
        std::fs::remove_file(&f).ok();
    }

    fn tempfile_path(name: &str) -> std::path::PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!("fastag-test-{}-{}", std::process::id(), name));
        p
    }
}
