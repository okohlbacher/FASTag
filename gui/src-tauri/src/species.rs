// Read k from the taxonomy index header, so the UI can warn before a run
// that tag_length can't reach the index. The ranked-taxa TSV that -species
// writes is parsed in the renderer (src/results/species.ts, P4), which reads
// it as text through report_text like every other report.

use serde::Serialize;
use std::io::Read;
use std::path::PathBuf;

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

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    // The species half of this test and of the next moved with the parser:
    // a species TSV is read through report.rs read_report (its tests
    // directory_is_an_error, missing_or_empty_path_is_none) and parsed by
    // src/results/species.ts (species.test.ts).
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
