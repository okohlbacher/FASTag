// SDRF import for the Batch view (GUI-DESIGN 3 S6, 10 P4): the backend
// only reads files; the frontend parses them (sdrf/sdrfTable.ts keeps every
// byte, sdrf/taxonomy.ts reads the dumps), so the comparison is a pure
// function of the files that vitest pins.
//
// - sdrf_read: the SDRF's bytes, unchanged (no UTF-8 decoding here: the
//   round trip is byte for byte, BOM and line endings included). The SDRF
//   is never written.
// - taxonomy_dump: the nodes.dmp and names.dmp FASTag's species call reads,
//   the session's own (-taxonomy_nodes, -taxonomy_names) or else those of
//   the first taxonomy folder the CLI searches that has both.

use serde::Serialize;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use tauri::AppHandle;

/// An SDRF is a table of a few thousand rows at most.
const MAX_SDRF: u64 = 32 << 20;
/// The bundled dumps are pruned to some 20 KB; a full NCBI taxdump's
/// names.dmp (some 250 MB) is refused rather than sent to the webview.
const MAX_DUMP: u64 = 64 << 20;

fn read_capped(path: &Path, max: u64, what: &str) -> Result<Vec<u8>, String> {
    let shown = path.display();
    let meta = std::fs::metadata(path).map_err(|e| match e.kind() {
        ErrorKind::NotFound => format!("{shown} does not exist"),
        _ => format!("{shown}: {e}"),
    })?;
    if !meta.is_file() {
        return Err(format!("{shown} is not a file"));
    }
    if meta.len() > max {
        return Err(format!("{shown} is {} MB, too large for {what}", meta.len() >> 20));
    }
    std::fs::read(path).map_err(|e| format!("{shown}: {e}"))
}

pub(crate) fn read_sdrf(path: &str) -> Result<Vec<u8>, String> {
    if path.trim().is_empty() {
        return Err("no SDRF file given".into());
    }
    read_capped(Path::new(path), MAX_SDRF, "an SDRF")
}

/// The SDRF's bytes as an ArrayBuffer (no JSON array of numbers).
#[tauri::command]
pub async fn sdrf_read(path: String) -> Result<tauri::ipc::Response, String> {
    tauri::async_runtime::spawn_blocking(move || read_sdrf(&path))
        .await
        .map_err(|e| e.to_string())?
        .map(tauri::ipc::Response::new)
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaxonomyDump {
    nodes_path: String,
    names_path: String,
    nodes: String,
    names: String,
}

fn dump_text(path: &Path) -> Result<String, String> {
    // Lossy: a Latin-1 byte in a name must not hide the taxonomy.
    read_capped(path, MAX_DUMP, "the taxonomy").map(|b| String::from_utf8_lossy(&b).into_owned())
}

/// The dumps at @p nodes and @p names, when both are given; else the first
/// of @p dirs that holds both. None: no taxonomy found.
pub(crate) fn find_dump(nodes: Option<&str>, names: Option<&str>, dirs: &[PathBuf]) -> Result<Option<TaxonomyDump>, String> {
    let given = |s: Option<&str>| s.map(str::trim).filter(|s| !s.is_empty()).map(PathBuf::from);
    let pair = match (given(nodes), given(names)) {
        (Some(a), Some(b)) => Some((a, b)),
        (None, None) => dirs
            .iter()
            .map(|d| (d.join("nodes.dmp"), d.join("names.dmp")))
            .find(|(a, b)| a.is_file() && b.is_file()),
        // One given, the other from the folder of the given one, as the CLI
        // defaults the missing one to the bundled folder.
        (Some(a), None) => Some((a.clone(), a.with_file_name("names.dmp"))),
        (None, Some(b)) => Some((b.with_file_name("nodes.dmp"), b.clone())),
    };
    let Some((a, b)) = pair else { return Ok(None) };
    Ok(Some(TaxonomyDump {
        nodes: dump_text(&a)?,
        names: dump_text(&b)?,
        nodes_path: a.display().to_string(),
        names_path: b.display().to_string(),
    }))
}

#[tauri::command]
pub async fn taxonomy_dump(app: AppHandle, nodes: Option<String>, names: Option<String>) -> Result<Option<TaxonomyDump>, String> {
    let dirs = crate::species::taxonomy_dirs(&app);
    tauri::async_runtime::spawn_blocking(move || find_dump(nodes.as_deref(), names.as_deref(), &dirs))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("fastag-sdrf-{}-{}", std::process::id(), name));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    // The bytes, unchanged: a BOM, CRLF, a lone CR, a quoted tab, a byte
    // that is not UTF-8 and no final line break.
    #[test]
    fn sdrf_bytes_are_read_unchanged() {
        let d = tmp("bytes");
        let f = d.join("p.sdrf.tsv");
        let b: &[u8] = b"\xef\xbb\xbfsource name\tcomment[data file]\r\n\"a\tb\"\tx\xe9.raw\rlast";
        std::fs::write(&f, b).unwrap();
        assert_eq!(read_sdrf(f.to_str().unwrap()).unwrap(), b);
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn sdrf_errors_name_the_file() {
        assert!(read_sdrf("").unwrap_err().contains("no SDRF"));
        let e = read_sdrf("/nonexistent/fastag/p.sdrf.tsv").unwrap_err();
        assert!(e.contains("does not exist"), "{e}");
        let d = tmp("dir");
        assert!(read_sdrf(d.to_str().unwrap()).unwrap_err().contains("not a file"));
        let big = d.join("big.sdrf.tsv");
        std::fs::File::create(&big).unwrap().set_len(MAX_SDRF + 1).unwrap();
        assert!(read_sdrf(big.to_str().unwrap()).unwrap_err().contains("too large"));
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn taxonomy_from_the_first_folder_with_both_dumps() {
        let a = tmp("tax-a");
        let b = tmp("tax-b");
        // a has only nodes.dmp: skipped.
        std::fs::write(a.join("nodes.dmp"), "1\t|\t1\t|\tno rank\t|\n").unwrap();
        std::fs::write(b.join("nodes.dmp"), "9606\t|\t9605\t|\tspecies\t|\n").unwrap();
        std::fs::write(b.join("names.dmp"), "9606\t|\tHomo sapiens\t|\t\t|\tscientific name\t|\n").unwrap();
        let t = find_dump(None, None, &[a.clone(), b.clone()]).unwrap().unwrap();
        assert!(t.nodes.starts_with("9606"));
        assert!(t.names.contains("Homo sapiens"));
        assert_eq!(t.nodes_path, b.join("nodes.dmp").display().to_string());
        // Nothing found: None, not an error.
        assert_eq!(find_dump(None, None, &[a.clone()]).unwrap(), None);
        assert_eq!(find_dump(Some("  "), Some(""), &[]).unwrap(), None);
        std::fs::remove_dir_all(&a).ok();
        std::fs::remove_dir_all(&b).ok();
    }

    #[test]
    fn the_sessions_own_dumps_win() {
        let a = tmp("tax-own");
        let b = tmp("tax-bundled");
        for d in [&a, &b] {
            std::fs::write(d.join("nodes.dmp"), format!("{}\n", d.display())).unwrap();
            std::fs::write(d.join("names.dmp"), "x\n").unwrap();
        }
        let n = a.join("nodes.dmp");
        let m = a.join("names.dmp");
        let t = find_dump(n.to_str(), m.to_str(), &[b.clone()]).unwrap().unwrap();
        assert!(t.nodes.contains("tax-own"));
        // One given: its sibling.
        let t = find_dump(n.to_str(), None, &[b.clone()]).unwrap().unwrap();
        assert_eq!(t.names_path, m.display().to_string());
        // A given dump that is missing is an error that names it.
        let e = find_dump(Some("/nonexistent/nodes.dmp"), Some("/nonexistent/names.dmp"), &[b.clone()]).unwrap_err();
        assert!(e.contains("/nonexistent/nodes.dmp"), "{e}");
        std::fs::remove_dir_all(&a).ok();
        std::fs::remove_dir_all(&b).ok();
    }

    #[test]
    fn a_latin1_name_does_not_hide_the_taxonomy() {
        let d = tmp("tax-latin1");
        std::fs::write(d.join("nodes.dmp"), "5\t|\t1\t|\tspecies\t|\n").unwrap();
        std::fs::write(d.join("names.dmp"), b"5\t|\tCaf\xe9 sp.\t|\t\t|\tscientific name\t|\n").unwrap();
        let t = find_dump(None, None, &[d.clone()]).unwrap().unwrap();
        assert!(t.names.contains("Caf"));
        std::fs::remove_dir_all(&d).ok();
    }
}
