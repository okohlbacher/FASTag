// Read the ranked-taxa TSV that -species writes, and read k from the index
// header so the UI can warn before a run that tag_length can't reach the index.

use serde::Serialize;
use std::io::Read;
use std::path::PathBuf;

use tauri::AppHandle;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Taxon {
    rank: String,
    taxid: i64,
    name: String,
    observed: f64,
    adjusted: f64,
    q: f64,
    // FASTag 1.12 -species_call decoy (D1) appends call and call_reason;
    // absent from a report written without it, and then not serialised.
    #[serde(skip_serializing_if = "Option::is_none")]
    call: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    call_reason: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeciesReport {
    path: String,
    taxa: Vec<Taxon>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaxdbInfo {
    path: String,
    k: u32,
}

// Numeric fields may carry a trailing unit; keep the number.
fn num(s: &str) -> f64 {
    let t = s.trim().trim_end_matches(['x', 'X']);
    t.parse::<f64>().ok().filter(|v| v.is_finite()).unwrap_or(0.0)
}

// Only regular files: opening a FIFO or a device would block, or never end.
fn is_regular(path: &str) -> bool {
    std::fs::metadata(path).map(|m| m.is_file()).unwrap_or(false)
}

fn read_species(path: &str) -> Option<SpeciesReport> {
    // Lossy and size-capped like the other reports: a taxon name in Latin-1
    // must not hide the report.
    let content = crate::report::read_report(path).ok().flatten()?;
    let lines: Vec<&str> = content.lines().filter(|l| !l.trim().is_empty()).collect();
    if lines.is_empty() {
        return None;
    }
    // A header re-saved with a UTF-8 BOM must still bind its first column.
    let head: Vec<&str> = lines[0].trim_start_matches('\u{FEFF}').split('\t').collect();
    let col = |n: &str| head.iter().position(|h| *h == n);
    let get = |f: &[&str], i: Option<usize>| -> String {
        i.and_then(|i| f.get(i)).map(|s| s.to_string()).unwrap_or_default()
    };
    let (i_rank, i_taxid, i_name) = (col("rank"), col("taxid"), col("name"));
    let (i_obs, i_adj, i_q) = (col("observed"), col("adjusted"), col("qvalue"));
    let (i_call, i_reason) = (col("call"), col("call_reason"));
    let opt = |f: &[&str], i: Option<usize>| -> Option<String> { i.map(|_| get(f, i)) };

    let mut taxa: Vec<Taxon> = Vec::new();
    for line in &lines[1..] {
        let f: Vec<&str> = line.split('\t').collect();
        taxa.push(Taxon {
            rank: get(&f, i_rank),
            taxid: get(&f, i_taxid).parse().unwrap_or(0),
            name: get(&f, i_name),
            observed: num(&get(&f, i_obs)),
            adjusted: num(&get(&f, i_adj)),
            q: get(&f, i_q).parse().ok().filter(|v: &f64| v.is_finite()).unwrap_or(1.0),
            call: opt(&f, i_call),
            call_reason: opt(&f, i_reason),
        });
    }

    // Show only taxa with actual hits: the CLI writes a row for every reference
    // taxon, but a taxon with zero observed k-mers is noise in the report.
    taxa.retain(|t| t.observed > 0.0);

    // Keep the CLI's order. It ranks rows by the adjusted count, which is the
    // raw count once sequence shared between taxa has been subtracted. Do not
    // re-sort here: re-sorting by significance would undo that, because a near
    // neighbour's borrowed count is exactly what makes it significant.
    Some(SpeciesReport { path: path.to_string(), taxa })
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

// async: Tauri runs sync commands on the main thread, which would block the UI
// while the file is read.
#[tauri::command]
pub async fn species(path: String) -> Option<SpeciesReport> {
    tauri::async_runtime::spawn_blocking(move || read_species(&path)).await.ok().flatten()
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

    #[test]
    fn num_strips_trailing_unit() {
        assert_eq!(num("1.4x"), 1.4);
        assert_eq!(num("8.3X"), 8.3);
        assert_eq!(num("garbage"), 0.0);
        assert_eq!(num("inf"), 0.0); // non-finite rejected
    }

    #[test]
    fn species_report_filters_zero_hits_and_keeps_file_order() {
        // The rows deliberately do not follow the CLI's ranking (Neighbour has
        // the lower adjusted count), so any re-ranking by the GUI, by adjusted
        // count or by significance, fails this test.
        let f = tempfile_path("sp.tsv");
        std::fs::write(&f, "rank\ttaxid\tname\tobserved\tadjusted\texpected\tlog_pvalue\tqvalue\n\
            genus\t1\tZero\t0\t0\t0.5\t-1\t1\n\
            genus\t2\tNeighbour\t200\t1\t2.0\t-99\t0\n\
            genus\t3\tTrue\t100\t90\t2.0\t-50\t0\n").unwrap();
        let r = read_species(f.to_str().unwrap()).unwrap();
        assert_eq!(r.taxa.len(), 2, "zero-observed row must be dropped");
        let msg = "rows keep the order the CLI wrote them in; the GUI does not re-rank";
        assert_eq!(r.taxa[0].name, "Neighbour", "{msg}");
        assert_eq!(r.taxa[1].name, "True", "{msg}");
        std::fs::remove_file(&f).ok();
    }

    #[test]
    fn non_utf8_name_does_not_hide_the_report() {
        let f = tempfile_path("latin1.tsv");
        std::fs::write(&f, b"rank\ttaxid\tname\tobserved\tadjusted\texpected\tlog_pvalue\tqvalue\n\
            genus\t1\tCaf\xE9ella\t5\t5\t0.5\t-3\t0.01\n").unwrap();
        let r = read_species(f.to_str().unwrap()).expect("report despite a non-UTF-8 byte");
        assert_eq!(r.taxa.len(), 1);
        assert_eq!(r.taxa[0].name, "Caf\u{FFFD}ella");
        assert_eq!(r.taxa[0].observed, 5.0);
        std::fs::remove_file(&f).ok();
    }

    #[test]
    fn a_directory_is_not_read() {
        // Only regular files are read.
        let d = std::env::temp_dir();
        assert!(read_species(d.to_str().unwrap()).is_none());
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

    #[test]
    fn bom_header_still_binds_the_rank_column() {
        let f = tempfile_path("bom.tsv");
        std::fs::write(&f, "\u{FEFF}rank\ttaxid\tname\tobserved\tadjusted\tqvalue\ngenus\t1\tA\t5\t5\t0.01\n").unwrap();
        let r = read_species(f.to_str().unwrap()).unwrap();
        assert_eq!(r.taxa[0].rank, "genus");
        std::fs::remove_file(&f).ok();
    }

    // Both readers let the open fail instead of pre-checking the path, and
    // `species` is a #[tauri::command] the frontend can call with "". A
    // directory is here because the picker can hand one over.
    #[test]
    fn empty_missing_or_directory_path_is_none() {
        let dir = std::env::temp_dir();
        let dir = dir.to_str().unwrap();
        for p in ["", "/nonexistent/fastag/x", dir] {
            assert!(read_species(p).is_none(), "read_species({p:?})");
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

    // Real CLI output on PXD003531 (gui/src/fixtures/cli/README.md): the
    // -species_call decoy columns of FASTag 1.12 (D1) reach the renderer as
    // call and callReason, in the CLI's order; a 1.11 report has neither.
    // src/testing/speciesTsv.ts reads the same files for vitest and e2e.
    fn cli_fixture(case: &str) -> String {
        format!("{}/../src/fixtures/cli/{case}/run.tags.species.tsv", env!("CARGO_MANIFEST_DIR"))
    }

    #[test]
    fn species_call_columns_of_the_real_fixture() {
        let r = read_species(&cli_fixture("v112-pxd003531-call")).expect("fixture");
        assert_eq!(r.taxa.len(), 50);
        let present: Vec<&str> =
            r.taxa.iter().filter(|t| t.call.as_deref() == Some("present")).map(|t| t.name.as_str()).collect();
        assert_eq!(present, ["Homo", "Macaca", "Sus", "Equus"]);
        assert_eq!(r.taxa[0].call_reason.as_deref(), Some("pass"));
        let json = serde_json::to_value(&r.taxa[0]).unwrap();
        assert_eq!(json["call"], "present");
        assert_eq!(json["callReason"], "pass");
    }

    #[test]
    fn a_report_without_the_call_columns_serialises_no_call_fields() {
        let r = read_species(&cli_fixture("v111-pxd003531")).expect("fixture");
        assert_eq!(r.taxa[0].name, "Homo");
        assert!(r.taxa.iter().all(|t| t.call.is_none() && t.call_reason.is_none()));
        let json = serde_json::to_value(&r.taxa[0]).unwrap();
        assert!(json.get("call").is_none() && json.get("callReason").is_none(), "{json}");
    }

    fn tempfile_path(name: &str) -> std::path::PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!("fastag-test-{}-{}", std::process::id(), name));
        p
    }
}
