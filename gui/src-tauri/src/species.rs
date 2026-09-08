// Read the ranked-taxa TSV that -species writes, and read k from the index
// header so the UI can warn before a run that tag_length can't reach the index.
// Ported from gui/src/main/species.ts (and fixes a latent 20-vs-24 byte read
// that made the Electron build return null for every FTX2 index).

use serde::Serialize;
use std::io::Read;
use std::path::{Path, PathBuf};

use tauri::AppHandle;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Taxon {
    rank: String,
    taxid: i64,
    name: String,
    observed: f64,
    expected: f64,
    adjusted: f64,
    log_p: f64,
    q: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeciesReport {
    path: String,
    taxa: Vec<Taxon>,
    empty: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaxdbInfo {
    path: String,
    k: u32,
    kmers: u64,
}

// Numeric fields may carry a trailing unit; keep the number.
fn num(s: &str) -> f64 {
    let t = s.trim().trim_end_matches(['x', 'X']);
    t.parse::<f64>().ok().filter(|v| v.is_finite()).unwrap_or(0.0)
}

fn read_species(path: &str) -> Option<SpeciesReport> {
    if path.is_empty() || !Path::new(path).exists() {
        return None;
    }
    let content = std::fs::read_to_string(path).ok()?;
    let lines: Vec<&str> = content.lines().filter(|l| !l.trim().is_empty()).collect();
    if lines.is_empty() {
        return None;
    }
    let head: Vec<&str> = lines[0].split('\t').collect();
    let col = |n: &str| head.iter().position(|h| *h == n);
    let get = |f: &[&str], i: Option<usize>| -> String {
        i.and_then(|i| f.get(i)).map(|s| s.to_string()).unwrap_or_default()
    };
    let (i_rank, i_taxid, i_name) = (col("rank"), col("taxid"), col("name"));
    let (i_obs, i_exp, i_adj) = (col("observed"), col("expected"), col("adjusted"));
    let (i_logp, i_q) = (col("log_pvalue"), col("qvalue"));

    let mut taxa: Vec<Taxon> = Vec::new();
    for line in &lines[1..] {
        let f: Vec<&str> = line.split('\t').collect();
        taxa.push(Taxon {
            rank: get(&f, i_rank),
            taxid: get(&f, i_taxid).parse().unwrap_or(0),
            name: get(&f, i_name),
            observed: num(&get(&f, i_obs)),
            expected: num(&get(&f, i_exp)),
            adjusted: num(&get(&f, i_adj)),
            log_p: num(&get(&f, i_logp)),
            q: get(&f, i_q).parse().ok().filter(|v: &f64| v.is_finite()).unwrap_or(1.0),
        });
    }

    // Show only taxa with actual hits: the CLI writes a row for every reference
    // taxon, but a taxon with zero observed k-mers is noise in the report.
    taxa.retain(|t| t.observed > 0.0);

    // Keep the CLI's order: it ranks by the adjusted count, which is the raw
    // count once shared sequence between taxa has been subtracted. Re-sorting by
    // significance here would undo that -- a near neighbour's borrowed count is
    // exactly what makes it significant.
    taxa.sort_by(|a, b| {
        b.adjusted
            .partial_cmp(&a.adjusted)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(b.observed.partial_cmp(&a.observed).unwrap_or(std::cmp::Ordering::Equal))
    });

    let empty = taxa.is_empty();
    Some(SpeciesReport { path: path.to_string(), taxa, empty })
}

// Layout: "FTXI"/"FTX2" | u32 version | u32 k | ... k-mer count. v1 (FTXI) put
// n at offset 12; v2 (FTX2) put n_taxa at 12 and n_kmers at 16. A real index is
// many MB, so reading 24 bytes always succeeds unless the file is truncated.
fn read_taxdb_info(path: &str) -> Option<TaxdbInfo> {
    if path.is_empty() || !Path::new(path).exists() {
        return None;
    }
    let mut f = std::fs::File::open(path).ok()?;
    let mut buf = [0u8; 24];
    f.read_exact(&mut buf).ok()?;
    let magic = &buf[0..4];
    let k = u32::from_le_bytes(buf[8..12].try_into().ok()?);
    let kmers = if magic == b"FTX2" {
        u64::from_le_bytes(buf[16..24].try_into().ok()?)
    } else if magic == b"FTXI" {
        u64::from_le_bytes(buf[12..20].try_into().ok()?)
    } else {
        return None;
    };
    Some(TaxdbInfo { path: path.to_string(), k, kmers })
}

// The same search order the CLI uses (taxonomyDir_ in FASTag.cpp), so the GUI
// reports on the index the run will actually load.
fn bundled_taxdb(app: &AppHandle) -> Option<String> {
    let bin = crate::fastag::resolve_binary(app).bin;
    let bin_dir = bin.parent()?;
    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Ok(env) = std::env::var("FASTAG_TAXONOMY_DIR") {
        if !env.is_empty() {
            dirs.push(PathBuf::from(env));
        }
    }
    dirs.push(bin_dir.join("..").join("share").join("FASTag").join("taxonomy"));
    dirs.push(bin_dir.join("share-FASTag-taxonomy"));
    dirs.push(bin_dir.join("taxonomy"));
    for d in dirs {
        let p = d.join("tax_k7.taxdb");
        if p.exists() {
            return Some(p.display().to_string());
        }
    }
    None
}

#[tauri::command]
pub fn species(path: String) -> Option<SpeciesReport> {
    read_species(&path)
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
    fn species_report_filters_zero_hits_and_sorts_by_adjusted_count() {
        // Neighbour is the near-neighbour case: a big borrowed count makes it the
        // MOST significant row, while deconvolution leaves it with almost
        // nothing. True is the real answer. The two orderings disagree here on
        // purpose -- the previous fixture ranked the same either way, so it
        // passed whichever rule was in force and tested nothing.
        let mut f = tempfile_path("sp.tsv");
        std::fs::write(&f, "rank\ttaxid\tname\tobserved\tadjusted\texpected\tlog_pvalue\tqvalue\n\
            genus\t1\tZero\t0\t0\t0.5\t-1\t1\n\
            genus\t2\tNeighbour\t200\t1\t2.0\t-99\t0\n\
            genus\t3\tTrue\t100\t90\t2.0\t-50\t0\n").unwrap();
        let r = read_species(f.to_str().unwrap()).unwrap();
        assert_eq!(r.taxa.len(), 2, "zero-observed row must be dropped");
        assert_eq!(r.taxa[0].name, "True", "highest adjusted count first, not lowest log_p");
        assert_eq!(r.taxa[1].name, "Neighbour", "the borrowed count ranks second despite its p");
        std::fs::remove_file(&f).ok();
        let _ = f; // silence unused on some toolchains
    }

    #[test]
    fn ftx2_header_reads_k_and_kmers() {
        let f = tempfile_path("t.taxdb");
        let mut buf = Vec::new();
        buf.extend_from_slice(b"FTX2");
        buf.extend_from_slice(&2u32.to_le_bytes()); // version
        buf.extend_from_slice(&7u32.to_le_bytes()); // k
        buf.extend_from_slice(&50u32.to_le_bytes()); // n_taxa
        buf.extend_from_slice(&123456u64.to_le_bytes()); // n_kmers @16
        let mut fh = std::fs::File::create(&f).unwrap();
        fh.write_all(&buf).unwrap();
        drop(fh);
        let info = read_taxdb_info(f.to_str().unwrap()).unwrap();
        assert_eq!(info.k, 7);
        assert_eq!(info.kmers, 123456);
        std::fs::remove_file(&f).ok();
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
