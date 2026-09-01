// Windowed browser over a FASTag tags TSV. A full run is 100k-10M+ rows; the
// frontend virtualizes scrolling and asks for <=1000-row windows of a sorted/
// filtered view, so the whole file never crosses IPC or lives in renderer
// memory. On open, one sequential scan records every line-start offset; a view
// (filter + sort) is one more scan producing a row permutation; a window is a
// handful of exact-length reads at known offsets.
//
// Columns are DRIVEN BY THE HEADER, not a fixed schema: -proforma already adds
// a column and more are coming. Filters bind by column NAME and are active
// only when their column exists in this file.

use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{BufReader, Read, Seek, SeekFrom};
use std::sync::{Arc, Mutex};
use std::time::SystemTime;

/// IPC bound: a window never exceeds this many rows.
const MAX_WINDOW: usize = 1000;
/// A single displayed row is capped here; a longer (garbage) line is truncated
/// rather than ballooning memory — the equivalent of the old preview byte cap.
const ROW_CAP: usize = 1 << 20;
/// A "header" longer than this is not a tags TSV.
const HEADER_CAP: u64 = 4 << 20;

#[derive(Deserialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SortSpec {
    pub column: String,
    #[serde(default)]
    pub desc: bool,
}

#[derive(Deserialize, Clone, PartialEq, Default, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct ViewSpec {
    pub sort: Option<SortSpec>,
    /// Case-insensitive substring on the `spectrum` column.
    pub spectrum: Option<String>,
    /// Minimum value of the `length` column.
    pub min_length: Option<u32>,
    /// Maximum value of the `evalue` column (unparsable values never match).
    pub max_evalue: Option<f64>,
    /// `fasta_hit` tri-state: "only" (!= "-"), "none" (== "-"), else inactive.
    pub fasta_hit: Option<String>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ResultsPage {
    pub columns: Vec<String>,
    pub total_rows: usize,
    pub matched_rows: usize,
    pub offset: usize,
    pub rows: Vec<Vec<String>>,
}

struct Index {
    columns: Vec<String>,
    /// Byte offset of each data-row start; row i spans offsets[i]..offsets[i+1]
    /// (data_end for the last), trailing newline included.
    offsets: Vec<u64>,
    data_end: u64,
}

struct CacheEntry {
    path: String,
    len: u64,
    mtime: Option<SystemTime>,
    index: Index,
    /// The one materialized view: (spec, matching rows in sort order).
    view: Option<(ViewSpec, Vec<u32>)>,
}

#[derive(Default)]
pub struct BrowserCache(Arc<Mutex<Option<CacheEntry>>>);

fn fields_of(raw: &[u8]) -> Vec<String> {
    let mut s = raw;
    while let [rest @ .., b'\n' | b'\r'] = s {
        s = rest;
    }
    s.split(|b| *b == b'\t')
        .map(|f| String::from_utf8_lossy(f).into_owned())
        .collect()
}

fn build_index(path: &str) -> Result<Index, String> {
    let file = File::open(path).map_err(|e| format!("cannot open {path}: {e}"))?;
    let mut reader = BufReader::with_capacity(1 << 20, file);
    // One pass counting newlines chunk-wise: line content is not needed here,
    // so a multi-GB file costs one buffer, not one allocation per row.
    let mut offsets: Vec<u64> = Vec::new();
    let mut pos: u64 = 0;
    let mut line_start: u64 = 0;
    let mut header_end: Option<u64> = None;
    let mut line_has_content = false; // any byte other than \r and \n
    let mut buf = [0u8; 1 << 16];
    loop {
        let n = reader.read(&mut buf).map_err(|e| format!("cannot read {path}: {e}"))?;
        if n == 0 {
            break;
        }
        for (i, b) in buf[..n].iter().enumerate() {
            if *b == b'\n' {
                let next = pos + i as u64 + 1;
                if header_end.is_none() {
                    header_end = Some(next);
                } else if line_has_content {
                    // Only lines with real content become rows: a trailing
                    // blank line -- LF or CRLF, hence the flag rather than an
                    // offset comparison (a CRLF blank's body is one \r) --
                    // must not inflate total_rows with a phantom record.
                    offsets.push(line_start);
                }
                line_start = next;
                line_has_content = false;
            } else if *b != b'\r' {
                line_has_content = true;
            }
        }
        pos += n as u64;
        if header_end.is_none() && pos > HEADER_CAP {
            return Err(format!("{path}: no header line within {HEADER_CAP} bytes — not a tags TSV"));
        }
    }
    let data_end = pos;
    match header_end {
        None => {
            // A headerless file: either empty, or one unterminated line that is
            // the header.
            if pos > 0 {
                header_end = Some(pos);
            }
        }
        Some(_) => {
            if line_start < data_end && line_has_content {
                offsets.push(line_start); // last row has no trailing newline
            }
        }
    }
    // The cap must hold wherever the header's newline lands -- checking only
    // mid-scan left a one-chunk window where an oversized header was accepted
    // and then silently truncated, mangling the last column name.
    if let Some(end) = header_end {
        if end > HEADER_CAP {
            return Err(format!("{path}: header exceeds {HEADER_CAP} bytes — not a tags TSV"));
        }
    }
    if offsets.len() > u32::MAX as usize {
        return Err(format!("{path}: more than 2^32 rows — beyond this browser's index"));
    }
    let columns = match header_end {
        None => Vec::new(),
        Some(end) => {
            let mut f = File::open(path).map_err(|e| format!("cannot open {path}: {e}"))?;
            let mut raw = vec![0u8; end as usize];
            f.read_exact(&mut raw).map_err(|e| format!("cannot read {path}: {e}"))?;
            fields_of(&raw)
        }
    };
    Ok(Index { columns, offsets, data_end })
}

fn row_span(index: &Index, i: usize) -> (u64, usize) {
    let start = index.offsets[i];
    let end = index.offsets.get(i + 1).copied().unwrap_or(index.data_end);
    (start, ((end - start) as usize).min(ROW_CAP))
}

/// Filter/sort bindings resolved against this file's header. A referenced
/// column that does not exist deactivates that predicate.
struct Resolved {
    sort: Option<(usize, bool)>,
    spectrum: Option<(usize, String)>,
    min_length: Option<(usize, u32)>,
    max_evalue: Option<(usize, f64)>,
    fasta_hit: Option<(usize, bool)>, // (col, must_have_hit)
}

impl Resolved {
    fn bind(spec: &ViewSpec, columns: &[String]) -> Resolved {
        let col = |name: &str| columns.iter().position(|c| c == name);
        Resolved {
            sort: spec
                .sort
                .as_ref()
                .and_then(|s| col(&s.column).map(|i| (i, s.desc))),
            spectrum: spec
                .spectrum
                .as_ref()
                .filter(|s| !s.is_empty())
                .and_then(|s| col("spectrum").map(|i| (i, s.to_lowercase()))),
            min_length: spec.min_length.and_then(|v| col("length").map(|i| (i, v))),
            max_evalue: spec.max_evalue.and_then(|v| col("evalue").map(|i| (i, v))),
            fasta_hit: match spec.fasta_hit.as_deref() {
                Some("only") => col("fasta_hit").map(|i| (i, true)),
                Some("none") => col("fasta_hit").map(|i| (i, false)),
                _ => None,
            },
        }
    }

    fn is_trivial(&self) -> bool {
        self.sort.is_none()
            && self.spectrum.is_none()
            && self.min_length.is_none()
            && self.max_evalue.is_none()
            && self.fasta_hit.is_none()
    }

    fn matches(&self, fields: &[String]) -> bool {
        let get = |i: usize| fields.get(i).map(String::as_str).unwrap_or("");
        if let Some((i, needle)) = &self.spectrum {
            if !get(*i).to_lowercase().contains(needle.as_str()) {
                return false;
            }
        }
        if let Some((i, min)) = self.min_length {
            match get(i).parse::<u32>() {
                Ok(v) if v >= min => {}
                _ => return false,
            }
        }
        if let Some((i, max)) = self.max_evalue {
            match get(i).parse::<f64>() {
                Ok(v) if v <= max => {}
                _ => return false,
            }
        }
        if let Some((i, want_hit)) = self.fasta_hit {
            if (get(i) != "-") != want_hit {
                return false;
            }
        }
        true
    }
}

/// Sort key: numeric rows first ordered by value, then everything else
/// byte-wise — so `-` and other non-numbers always sink to the bottom,
/// ascending or descending.
enum Key {
    Num(f64),
    Str(Vec<u8>),
}

fn build_view(path: &str, index: &Index, res: &Resolved) -> Result<Vec<u32>, String> {
    let file = File::open(path).map_err(|e| format!("cannot open {path}: {e}"))?;
    let mut reader = BufReader::with_capacity(1 << 20, file);
    reader
        .seek(SeekFrom::Start(index.offsets.first().copied().unwrap_or(index.data_end)))
        .map_err(|e| e.to_string())?;
    let mut matched: Vec<u32> = Vec::new();
    let mut keys: Vec<Key> = Vec::new();
    let mut raw: Vec<u8> = Vec::new();
    for i in 0..index.offsets.len() {
        // Rows are contiguous: sequential exact-length reads, no per-row seek.
        let (start, len) = row_span(index, i);
        let full = (index.offsets.get(i + 1).copied().unwrap_or(index.data_end) - start) as usize;
        raw.resize(len, 0);
        reader.read_exact(&mut raw).map_err(|e| format!("cannot read {path}: {e}"))?;
        if full > len {
            // skip the capped remainder of a pathological line
            reader.seek_relative((full - len) as i64).map_err(|e| e.to_string())?;
        }
        let fields = fields_of(&raw);
        if !res.matches(&fields) {
            continue;
        }
        matched.push(i as u32);
        if let Some((col, _)) = res.sort {
            let cell = fields.get(col).map(String::as_str).unwrap_or("");
            keys.push(match cell.parse::<f64>() {
                Ok(v) => Key::Num(v),
                Err(_) => Key::Str(cell.as_bytes().to_vec()),
            });
        }
    }
    if let Some((_, desc)) = res.sort {
        let mut perm: Vec<usize> = (0..matched.len()).collect();
        perm.sort_unstable_by(|&a, &b| {
            let ord = match (&keys[a], &keys[b]) {
                (Key::Num(x), Key::Num(y)) => x.total_cmp(y),
                (Key::Str(x), Key::Str(y)) => x.cmp(y),
                (Key::Num(_), Key::Str(_)) => return std::cmp::Ordering::Less,
                (Key::Str(_), Key::Num(_)) => return std::cmp::Ordering::Greater,
            };
            let ord = if desc { ord.reverse() } else { ord };
            ord.then(a.cmp(&b)) // deterministic: file order breaks ties
        });
        return Ok(perm.into_iter().map(|p| matched[p]).collect());
    }
    Ok(matched)
}

fn read_rows(path: &str, index: &Index, rows: &[u32]) -> Result<Vec<Vec<String>>, String> {
    let file = File::open(path).map_err(|e| format!("cannot open {path}: {e}"))?;
    let mut reader = BufReader::new(file);
    let mut out = Vec::with_capacity(rows.len());
    let mut raw: Vec<u8> = Vec::new();
    for &r in rows {
        let (start, len) = row_span(index, r as usize);
        reader.seek(SeekFrom::Start(start)).map_err(|e| e.to_string())?;
        raw.resize(len, 0);
        reader.read_exact(&mut raw).map_err(|e| format!("cannot read {path}: {e}"))?;
        out.push(fields_of(&raw));
    }
    Ok(out)
}

fn query(
    cache: &Mutex<Option<CacheEntry>>,
    path: &str,
    spec: &ViewSpec,
    offset: usize,
    limit: usize,
) -> Result<ResultsPage, String> {
    let meta = std::fs::metadata(path).map_err(|e| format!("cannot open {path}: {e}"))?;
    let (len, mtime) = (meta.len(), meta.modified().ok());

    let mut guard = cache.lock().unwrap();
    let fresh = matches!(&*guard,
        Some(e) if e.path == path && e.len == len && e.mtime == mtime);
    if !fresh {
        // Index invalidated (different file, or the run overwrote it).
        let index = build_index(path)?;
        *guard = Some(CacheEntry { path: path.to_string(), len, mtime, index, view: None });
    }
    let entry = guard.as_mut().unwrap();

    let res = Resolved::bind(spec, &entry.index.columns);
    let total_rows = entry.index.offsets.len();
    let limit = limit.min(MAX_WINDOW);

    let (matched_rows, window): (usize, Vec<u32>) = if res.is_trivial() {
        let end = (offset + limit).min(total_rows);
        (total_rows, (offset.min(total_rows)..end).map(|i| i as u32).collect())
    } else {
        if entry.view.as_ref().map(|(s, _)| s) != Some(spec) {
            let rows = build_view(path, &entry.index, &res)?;
            entry.view = Some((spec.clone(), rows));
        }
        let rows = &entry.view.as_ref().unwrap().1;
        let end = (offset + limit).min(rows.len());
        (rows.len(), rows[offset.min(rows.len())..end].to_vec())
    };

    let rows = read_rows(path, &entry.index, &window)?;
    Ok(ResultsPage { columns: entry.index.columns.clone(), total_rows, matched_rows, offset, rows })
}

#[tauri::command]
pub async fn results_query(
    state: tauri::State<'_, BrowserCache>,
    path: String,
    view: ViewSpec,
    offset: usize,
    limit: usize,
) -> Result<ResultsPage, String> {
    let cache = state.0.clone();
    // The index build on a cold gigabyte file takes seconds: keep it off the
    // IPC thread. In-flight dedupe falls out of the cache mutex.
    tauri::async_runtime::spawn_blocking(move || query(&cache, &path, &view, offset, limit))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    const HEADER: &str = "spectrum\ttag\tlength\tcharge\tnterm_mass\tcterm_mass\textended\tgapped\tevalue\tmin_conf\tmean_conf\tfasta_hit";

    fn write_fixture(name: &str, body: &str) -> String {
        let p = std::env::temp_dir().join(format!("fastag-browser-{}-{name}", std::process::id()));
        std::fs::write(&p, body).unwrap();
        p.to_string_lossy().into_owned()
    }

    fn fixture(name: &str) -> String {
        // Three spectra, mixed evalues, one no-hit row, one unparsable evalue.
        let rows = [
            "frame=5\tAQRQAAN\t7\t1\t486.2\t317.1\t0\t0\t0.003\t0.43\t0.69\tfwd",
            "frame=5\tQRQAANS\t7\t1\t557.2\t230.0\t0\t0\t0.008\t0.43\t0.67\t-",
            "frame=7\tLNDLAAK\t7\t2\t100.0\t200.0\t0\t0\t0.0001\t0.50\t0.70\trev",
            "Frame=9\tSHORTT\t6\t1\t10.0\t20.0\t0\t0\t-\t0.30\t0.40\t-",
        ];
        write_fixture(name, &format!("{HEADER}\n{}\n", rows.join("\n")))
    }

    fn q(path: &str, spec: &ViewSpec, offset: usize, limit: usize) -> Result<ResultsPage, String> {
        let cache = Mutex::new(None);
        query(&cache, path, spec, offset, limit)
    }

    fn col(page: &ResultsPage, row: usize, name: &str) -> String {
        let i = page.columns.iter().position(|c| c == name).unwrap();
        page.rows[row][i].clone()
    }

    #[test]
    fn trivial_query_serves_all_rows_and_header() {
        let p = fixture("basic.tsv");
        let r = q(&p, &ViewSpec::default(), 0, 100).unwrap();
        assert_eq!(r.columns[0], "spectrum");
        assert_eq!(r.columns.len(), 12);
        assert_eq!(r.total_rows, 4);
        assert_eq!(r.matched_rows, 4);
        assert_eq!(r.rows.len(), 4);
        assert_eq!(col(&r, 0, "tag"), "AQRQAAN");
        // windowing
        let w = q(&p, &ViewSpec::default(), 2, 1).unwrap();
        assert_eq!(w.rows.len(), 1);
        assert_eq!(col(&w, 0, "tag"), "LNDLAAK");
        let past = q(&p, &ViewSpec::default(), 99, 10).unwrap();
        assert!(past.rows.is_empty());
        std::fs::remove_file(&p).ok();
    }

    #[test]
    fn numeric_sort_puts_unparsable_last_both_directions() {
        let p = fixture("sort.tsv");
        let asc = ViewSpec { sort: Some(SortSpec { column: "evalue".into(), desc: false }), ..Default::default() };
        let r = q(&p, &asc, 0, 100).unwrap();
        let evs: Vec<String> = (0..4).map(|i| col(&r, i, "evalue")).collect();
        assert_eq!(evs, ["0.0001", "0.003", "0.008", "-"]);
        let desc = ViewSpec { sort: Some(SortSpec { column: "evalue".into(), desc: true }), ..Default::default() };
        let r = q(&p, &desc, 0, 100).unwrap();
        let evs: Vec<String> = (0..4).map(|i| col(&r, i, "evalue")).collect();
        assert_eq!(evs, ["0.008", "0.003", "0.0001", "-"]);
        std::fs::remove_file(&p).ok();
    }

    #[test]
    fn string_sort_is_bytewise() {
        let p = fixture("strsort.tsv");
        let spec = ViewSpec { sort: Some(SortSpec { column: "tag".into(), desc: false }), ..Default::default() };
        let r = q(&p, &spec, 0, 100).unwrap();
        let tags: Vec<String> = (0..4).map(|i| col(&r, i, "tag")).collect();
        assert_eq!(tags, ["AQRQAAN", "LNDLAAK", "QRQAANS", "SHORTT"]);
        std::fs::remove_file(&p).ok();
    }

    #[test]
    fn spectrum_filter_is_case_insensitive_substring() {
        let p = fixture("spec.tsv");
        let spec = ViewSpec { spectrum: Some("frame=9".into()), ..Default::default() };
        let r = q(&p, &spec, 0, 100).unwrap();
        assert_eq!(r.matched_rows, 1); // matches "Frame=9"
        assert_eq!(r.total_rows, 4);
        assert_eq!(col(&r, 0, "tag"), "SHORTT");
        std::fs::remove_file(&p).ok();
    }

    #[test]
    fn min_length_and_max_evalue_filters() {
        let p = fixture("filters.tsv");
        let r = q(&p, &ViewSpec { min_length: Some(7), ..Default::default() }, 0, 100).unwrap();
        assert_eq!(r.matched_rows, 3); // the length-6 row drops
        let r = q(&p, &ViewSpec { max_evalue: Some(0.003), ..Default::default() }, 0, 100).unwrap();
        assert_eq!(r.matched_rows, 2); // 0.0001 and 0.003; "-" never matches
        std::fs::remove_file(&p).ok();
    }

    #[test]
    fn fasta_hit_tristate() {
        let p = fixture("hit.tsv");
        let only = q(&p, &ViewSpec { fasta_hit: Some("only".into()), ..Default::default() }, 0, 100).unwrap();
        assert_eq!(only.matched_rows, 2); // fwd + rev
        let none = q(&p, &ViewSpec { fasta_hit: Some("none".into()), ..Default::default() }, 0, 100).unwrap();
        assert_eq!(none.matched_rows, 2);
        let any = q(&p, &ViewSpec { fasta_hit: Some("any".into()), ..Default::default() }, 0, 100).unwrap();
        assert_eq!(any.matched_rows, 4);
        std::fs::remove_file(&p).ok();
    }

    #[test]
    fn dynamic_columns_extra_and_missing() {
        // A -proforma file: 13 columns, filters still bind by name.
        let p = write_fixture(
            "proforma.tsv",
            &format!(
                "{HEADER}\tproforma\nx\tAA\t2\t1\t0\t0\t0\t0\t0.5\t0.1\t0.1\tfwd\tAA\ny\tCC\t2\t1\t0\t0\t0\t0\t0.4\t0.1\t0.1\t-\tCC\n"
            ),
        );
        let r = q(&p, &ViewSpec { fasta_hit: Some("only".into()), ..Default::default() }, 0, 100).unwrap();
        assert_eq!(r.columns.len(), 13);
        assert_eq!(r.columns[12], "proforma");
        assert_eq!(r.matched_rows, 1);
        assert_eq!(r.rows[0].len(), 13);
        std::fs::remove_file(&p).ok();

        // A file WITHOUT the filter's column: the filter is inactive, not a
        // silent empty result.
        let p2 = write_fixture("nocol.tsv", "a\tb\n1\t2\n3\t4\n");
        let r2 = q(
            &p2,
            &ViewSpec {
                fasta_hit: Some("only".into()),
                max_evalue: Some(0.001),
                min_length: Some(9),
                spectrum: Some("zz".into()),
                sort: Some(SortSpec { column: "evalue".into(), desc: false }),
            },
            0,
            100,
        )
        .unwrap();
        assert_eq!(r2.matched_rows, 2);
        assert_eq!(r2.rows.len(), 2);
        std::fs::remove_file(&p2).ok();
    }

    #[test]
    fn crlf_and_missing_trailing_newline() {
        let p = write_fixture(
            "crlf.tsv",
            "a\tb\r\n1\tx\r\n2\ty\r\n3\tz", // CRLF line ends, unterminated last row
        );
        let r = q(&p, &ViewSpec::default(), 0, 100).unwrap();
        assert_eq!(r.columns, vec!["a", "b"]);
        assert_eq!(r.total_rows, 3);
        assert_eq!(r.rows[0], vec!["1", "x"]);
        assert_eq!(r.rows[2], vec!["3", "z"]);
        std::fs::remove_file(&p).ok();
    }

    #[test]
    fn blank_lines_never_become_rows() {
        // LF blank, CRLF blank, interior and trailing -- none may inflate rows.
        let p = write_fixture("blank_crlf.tsv", "a\tb\r\n1\tx\r\n\r\n2\ty\r\n\r\n");
        let r = q(&p, &ViewSpec::default(), 0, 100).unwrap();
        assert_eq!(r.total_rows, 2);
        let p2 = write_fixture("blank_lf.tsv", "a\tb\n1\tx\n\n");
        let r2 = q(&p2, &ViewSpec::default(), 0, 100).unwrap();
        assert_eq!(r2.total_rows, 1);
    }

    #[test]
    fn missing_file_is_an_error() {
        let e = q("/definitely/not/a/file.tsv", &ViewSpec::default(), 0, 10);
        assert!(e.is_err());
        assert!(e.unwrap_err().contains("cannot open"));
    }

    #[test]
    fn window_clamped_to_max() {
        let mut body = String::from("a\n");
        for i in 0..1500 {
            body.push_str(&format!("{i}\n"));
        }
        let p = write_fixture("clamp.tsv", &body);
        let r = q(&p, &ViewSpec::default(), 0, 5000).unwrap();
        assert_eq!(r.rows.len(), MAX_WINDOW);
        assert_eq!(r.total_rows, 1500);
        std::fs::remove_file(&p).ok();
    }

    #[test]
    fn cache_reuses_index_and_view_and_detects_staleness() {
        let p = fixture("cache.tsv");
        let cache = Mutex::new(None);
        let spec = ViewSpec { sort: Some(SortSpec { column: "evalue".into(), desc: false }), ..Default::default() };
        let r1 = query(&cache, &p, &spec, 0, 100).unwrap();
        let view_ptr = cache.lock().unwrap().as_ref().unwrap().view.as_ref().unwrap().1.as_ptr();
        let r2 = query(&cache, &p, &spec, 0, 100).unwrap();
        // Same (path, len, mtime) + same spec: the view was not rebuilt.
        assert_eq!(view_ptr, cache.lock().unwrap().as_ref().unwrap().view.as_ref().unwrap().1.as_ptr());
        assert_eq!(r1.rows, r2.rows);

        // Overwrite with different content: (len, mtime) invalidates.
        std::fs::write(&p, format!("{HEADER}\nz\tZZ\t9\t1\t0\t0\t0\t0\t1.0\t0.9\t0.9\tfwd\n")).unwrap();
        let r3 = query(&cache, &p, &spec, 0, 100).unwrap();
        assert_eq!(r3.total_rows, 1);
        assert_eq!(col(&r3, 0, "tag"), "ZZ");
        std::fs::remove_file(&p).ok();
    }

    // Real-data cross-check (plan 3.2 validation gate). Run as
    //   FASTAG_BROWSER_TSV=/path/to/real.tags.tsv cargo test --lib real_file -- --ignored --nocapture
    // and compare the printed numbers against coreutils on the same file:
    //   total    awk 'END{print NR-1}'
    //   matched  awk -F'\t' 'NR>1 && $9+0==$9 && $9<=1e-3' | wc -l   (evalue col)
    //   first    tail -n+2 | sort -t$'\t' -k<evcol>,<evcol>g | head -1
    //   last     tail -1
    #[test]
    #[ignore]
    fn real_file_crosscheck() {
        let path = std::env::var("FASTAG_BROWSER_TSV").expect("set FASTAG_BROWSER_TSV");
        let cache = Mutex::new(None);
        let t0 = std::time::Instant::now();
        let all = query(&cache, &path, &ViewSpec::default(), 0, 1).unwrap();
        println!("cold index: {:?}", t0.elapsed());
        println!("columns: {:?}", all.columns);
        println!("total: {}", all.total_rows);

        let t0 = std::time::Instant::now();
        let filt = query(&cache, &path, &ViewSpec { max_evalue: Some(1e-3), ..Default::default() }, 0, 1).unwrap();
        println!("filter maxEvalue=1e-3: matched {} ({:?})", filt.matched_rows, t0.elapsed());

        let t0 = std::time::Instant::now();
        let spec = ViewSpec { sort: Some(SortSpec { column: "evalue".into(), desc: false }), ..Default::default() };
        let sorted = query(&cache, &path, &spec, 0, 1).unwrap();
        println!("sort evalue asc: {:?}; first row: {:?}", t0.elapsed(), sorted.rows[0]);

        let t0 = std::time::Instant::now();
        let last = query(&cache, &path, &ViewSpec::default(), all.total_rows - 1, 1).unwrap();
        println!("warm window: {:?}; last row: {:?}", t0.elapsed(), last.rows[0]);
    }

    #[test]
    fn empty_and_header_only_files() {
        let p = write_fixture("empty.tsv", "");
        let r = q(&p, &ViewSpec::default(), 0, 10).unwrap();
        assert!(r.columns.is_empty());
        assert_eq!(r.total_rows, 0);
        std::fs::remove_file(&p).ok();

        let p2 = write_fixture("headonly.tsv", &format!("{HEADER}\n"));
        let r2 = q(&p2, &ViewSpec::default(), 0, 10).unwrap();
        assert_eq!(r2.columns.len(), 12);
        assert_eq!(r2.total_rows, 0);
        std::fs::remove_file(&p2).ok();
    }
}
