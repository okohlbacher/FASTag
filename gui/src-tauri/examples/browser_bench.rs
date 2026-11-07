//! Browser bench (GUI-DESIGN 7 and 10): the P0b first cut (head read, index,
//! background E-value order), the bench-only typed-column prototype of P0b
//! (the baselines of the provisional P3 targets), and the P3 browser itself
//! through the app's own open, query and export paths: filter changes,
//! export throughput, backend peak memory, sorts by other columns, and
//! first rows from a cold page cache.
//!
//!   cargo run --release --example browser_bench -- <tags.tsv> [more.tsv ...] > bench.json
//!   cargo run --release --example browser_bench -- --gen <ecoli.tags.tsv> <out.tsv> <rows> <seed>
//!
//! Each measurement runs in a child process of its own, so its peak RSS is
//! its own. `--mode <firstcut|typed|p3|sort|cold> <file>` runs one of them.
//!
//! The Stitch/ALPS export job (denovo.rs) on a -res_conf file of its own:
//!
//!   cargo run --release --example browser_bench -- --gen-reads <res_conf.tags.tsv> <out.tsv> <rows>
//!   cargo run --release --example browser_bench -- --mode reads <out.tsv>
//!
//! (`reads_stitch` / `reads_alps` run one of its two cases, so the peak RSS
//! is that case's own.)
//! (v1.11's build_view, which the `today` and `verify` modes of 1.12 timed,
//! is now the test oracle only: bench-1.12.0.json keeps those numbers.)

use std::collections::HashMap;
use std::fs::File;
use std::io::{BufWriter, Read, Seek, SeekFrom, Write};
use std::process::Command;
use std::time::Instant;

use fastag_lib::browser::bench;

fn peak_rss_bytes() -> u64 {
    #[cfg(unix)]
    unsafe {
        let mut u: libc::rusage = std::mem::zeroed();
        libc::getrusage(libc::RUSAGE_SELF, &mut u);
        // ru_maxrss: bytes on macOS, kilobytes on Linux.
        if cfg!(target_os = "macos") {
            u.ru_maxrss as u64
        } else {
            u.ru_maxrss as u64 * 1024
        }
    }
    #[cfg(not(unix))]
    0
}

/// Resident now (ps), for the trace only.
fn rss_now_mb() -> u64 {
    let o = Command::new("ps").args(["-o", "rss=", "-p", &std::process::id().to_string()]).output().unwrap();
    String::from_utf8_lossy(&o.stdout).trim().parse::<u64>().unwrap_or(0) / 1024
}

fn ms(t: Instant) -> f64 {
    (t.elapsed().as_secs_f64() * 1e4).round() / 10.0
}

fn median(mut v: Vec<f64>) -> f64 {
    v.sort_by(f64::total_cmp);
    v[v.len() / 2]
}

/// P0b: first rows from the head read; the ranked swap after index + order.
fn firstcut(path: &str) -> String {
    let t0 = Instant::now();
    let head = bench::head(path).unwrap();
    let head_ms = ms(t0);
    let t = Instant::now();
    let ix = bench::index(path).unwrap();
    let index_ms = ms(t);
    let t = Instant::now();
    let (asc, _desc) = bench::rank(path, &ix).unwrap();
    let rank_ms = ms(t);
    let swap_ms = ms(t0);
    // A page of the E-value view while nothing is built (file order, pending).
    let t = Instant::now();
    let (n, ranked) = bench::open_and_query(path).unwrap();
    let interactive_ms = ms(t);
    format!(
        r#"{{"rows":{},"head_rows":{head},"first_rows_ms":{head_ms},"index_ms":{index_ms},"rank_asc_desc_ms":{rank_ms},"ranked_swap_ms":{swap_ms},"interactive_first_page_ms":{interactive_ms},"interactive_first_page_rows":{n},"interactive_first_page_ranked":{ranked},"peak_rss_mb":{}}}"#,
        asc.len(),
        peak_rss_bytes() / (1 << 20)
    )
}

/// The typed-column prototype of GUI-DESIGN 6.1 item 7: one sequential pass
/// of 8 MB chunks into evalue f64 + unparsable bitset, length u16, hit u8,
/// spectrum dictionary + u32 ids. Bench only.
struct Typed {
    offsets: Vec<u64>,
    data_end: u64,
    evalue: Vec<f64>,
    unparsable: Vec<u64>,
    length: Vec<u16>,
    hit: Vec<u8>,
    spec_id: Vec<u32>,
    dict: Vec<Box<[u8]>>,
}

fn typed_build(path: &str) -> Typed {
    let ix = bench::index(path).unwrap();
    let col = |n: &str| ix.columns().iter().position(|c| c == n);
    let (cs, cl, ce, ch) = (col("spectrum"), col("length"), col("evalue"), col("fasta_hit"));
    let n = ix.rows();
    let mut t = Typed {
        offsets: ix.offsets().to_vec(),
        data_end: ix.data_end(),
        evalue: Vec::with_capacity(n),
        unparsable: vec![0; n.div_ceil(64)],
        length: Vec::with_capacity(n),
        hit: Vec::with_capacity(n),
        spec_id: Vec::with_capacity(n),
        dict: Vec::new(),
    };
    let mut ids: HashMap<Box<[u8]>, u32> = HashMap::new();
    let mut f = File::open(path).unwrap();
    let start = t.offsets.first().copied().unwrap_or(t.data_end);
    f.seek(SeekFrom::Start(start)).unwrap();
    let mut buf = vec![0u8; 8 << 20];
    let mut carry: Vec<u8> = Vec::new();
    let mut row = 0usize;
    let mut handle = |line: &[u8], t: &mut Typed| {
        if !line.iter().any(|b| *b != b'\r') {
            return;
        }
        let line = line.strip_suffix(b"\r").unwrap_or(line);
        let mut ev = f64::NAN;
        let (mut len, mut hit, mut sid) = (0u16, 5u8, 0u32);
        let mut bad = true;
        for (j, cell) in line.split(|b| *b == b'\t').enumerate() {
            if Some(j) == ce {
                if let Some(v) = std::str::from_utf8(cell).ok().and_then(|s| s.parse::<f64>().ok()).filter(|v| v.is_finite()) {
                    ev = v;
                    bad = false;
                }
            } else if Some(j) == cl {
                len = std::str::from_utf8(cell).ok().and_then(|s| s.parse().ok()).unwrap_or(0);
            } else if Some(j) == ch {
                hit = match cell {
                    b"-" => 0,
                    b"fwd" => 1,
                    b"rev" => 2,
                    b"efwd" => 3,
                    b"erev" => 4,
                    _ => 5,
                };
            } else if Some(j) == cs {
                sid = match ids.get(cell) {
                    Some(i) => *i,
                    None => {
                        let i = t.dict.len() as u32;
                        t.dict.push(cell.into());
                        ids.insert(cell.into(), i);
                        i
                    }
                };
            }
        }
        if bad {
            t.unparsable[row / 64] |= 1 << (row % 64);
        }
        t.evalue.push(ev);
        t.length.push(len);
        t.hit.push(hit);
        t.spec_id.push(sid);
        row += 1;
    };
    loop {
        let k = f.read(&mut buf).unwrap();
        if k == 0 {
            break;
        }
        let mut s = 0;
        for (i, b) in buf[..k].iter().enumerate() {
            if *b == b'\n' {
                if carry.is_empty() {
                    handle(&buf[s..i], &mut t);
                } else {
                    carry.extend_from_slice(&buf[s..i]);
                    let c = std::mem::take(&mut carry);
                    handle(&c, &mut t);
                }
                s = i + 1;
            }
        }
        carry.extend_from_slice(&buf[s..k]);
    }
    if !carry.is_empty() {
        let c = std::mem::take(&mut carry);
        handle(&c, &mut t);
    }
    assert_eq!(t.evalue.len(), n, "typed pass and index disagree on rows");
    t
}

fn typed(path: &str) -> String {
    let t0 = Instant::now();
    let t = typed_build(path);
    let build_ms = ms(t0);
    let n = t.evalue.len();
    // The E-value permutation (numeric block, then unparsable).
    let tp = Instant::now();
    let bad = |i: usize| t.unparsable[i / 64] >> (i % 64) & 1 == 1;
    let mut perm: Vec<u32> = (0..n as u32).filter(|&i| !bad(i as usize)).collect();
    perm.sort_unstable_by(|&a, &b| t.evalue[a as usize].total_cmp(&t.evalue[b as usize]).then(a.cmp(&b)));
    perm.extend((0..n as u32).filter(|&i| bad(i as usize)));
    let perm_ms = ms(tp);
    // Filters over the cached permutation (max E-value 100, min length 3, no
    // entrapment-only hit, spectrum contains "scan=1"): E-value, length, hit, spectrum
    // substring (matched once against the dictionary).
    let mut times = Vec::new();
    let mut matched = 0;
    for _ in 0..5 {
        let tf = Instant::now();
        let needle = b"scan=1";
        let spec_ok: Vec<bool> = t.dict.iter().map(|d| d.windows(needle.len()).any(|w| w.eq_ignore_ascii_case(needle))).collect();
        let out: Vec<u32> = perm
            .iter()
            .copied()
            .filter(|&i| {
                let i = i as usize;
                !bad(i) && t.evalue[i] <= 100.0 && t.length[i] >= 3 && t.hit[i] != 3 && t.hit[i] != 4 && spec_ok[t.spec_id[i] as usize]
            })
            .collect();
        matched = out.len();
        times.push(ms(tf));
    }
    let filter_ms = median(times);
    // Export: unsorted as a byte-range copy; sorted in 64k-row batches read
    // in offset order and written in view order through a 4 MB BufWriter.
    let dest = std::env::temp_dir().join(format!("fastag-bench-export-{}.tsv", std::process::id()));
    let data_start = t.offsets.first().copied().unwrap_or(t.data_end);
    let bytes = t.data_end - data_start;
    let te = Instant::now();
    {
        let mut src = File::open(path).unwrap();
        src.seek(SeekFrom::Start(data_start)).unwrap();
        let mut w = BufWriter::with_capacity(4 << 20, File::create(&dest).unwrap());
        std::io::copy(&mut src.take(bytes), &mut w).unwrap();
        w.flush().unwrap();
    }
    let unsorted_s = te.elapsed().as_secs_f64();
    let te = Instant::now();
    {
        let mut src = File::open(path).unwrap();
        let mut w = BufWriter::with_capacity(4 << 20, File::create(&dest).unwrap());
        let span = |i: usize| (t.offsets[i], t.offsets.get(i + 1).copied().unwrap_or(t.data_end));
        let mut rows: Vec<(u64, u64, usize)> = Vec::with_capacity(65536);
        let mut cells: Vec<Vec<u8>> = Vec::new();
        for batch in perm.chunks(65536) {
            rows.clear();
            rows.extend(batch.iter().enumerate().map(|(k, &i)| {
                let (a, b) = span(i as usize);
                (a, b, k)
            }));
            rows.sort_unstable();
            cells.resize(batch.len(), Vec::new());
            // Contiguous spans read in one go.
            let mut j = 0;
            while j < rows.len() {
                let mut e = j;
                while e + 1 < rows.len() && rows[e + 1].0 == rows[e].1 {
                    e += 1;
                }
                let mut chunk = vec![0u8; (rows[e].1 - rows[j].0) as usize];
                src.seek(SeekFrom::Start(rows[j].0)).unwrap();
                src.read_exact(&mut chunk).unwrap();
                for r in &rows[j..=e] {
                    let a = (r.0 - rows[j].0) as usize;
                    let b = (r.1 - rows[j].0) as usize;
                    cells[r.2].clear();
                    cells[r.2].extend_from_slice(&chunk[a..b]);
                }
                j = e + 1;
            }
            for c in &cells[..batch.len()] {
                w.write_all(c).unwrap();
            }
        }
        w.flush().unwrap();
    }
    let sorted_s = te.elapsed().as_secs_f64();
    std::fs::remove_file(&dest).ok();
    let gb = bytes as f64 / 1e9;
    format!(
        r#"{{"rows":{n},"spectra":{},"build_ms":{build_ms},"evalue_perm_ms":{perm_ms},"filter_ms_median5":{filter_ms},"filter_matched":{matched},"export_bytes":{bytes},"export_unsorted_s_per_gb":{:.3},"export_sorted_s_per_gb":{:.3},"peak_rss_mb":{},"bytes_per_row_typed":{:.1}}}"#,
        t.dict.len(),
        unsorted_s / gb,
        sorted_s / gb,
        peak_rss_bytes() / (1 << 20),
        (n * (8 + 2 + 1 + 4) + n / 8) as f64 / n.max(1) as f64
    )
}

use fastag_lib::browser::bench::{ExportFormat, Session, SortSpec, ViewSpec};

fn by(column: &str, desc: bool) -> Option<SortSpec> {
    Some(SortSpec { column: column.into(), desc })
}

/// The median tag length of @p path (from its first 200k rows): the
/// min-length cutoff of the bench that cuts the file about in half.
fn median_length(path: &str) -> u32 {
    let mut r = std::io::BufReader::new(File::open(path).unwrap());
    let mut line = String::new();
    std::io::BufRead::read_line(&mut r, &mut line).unwrap();
    let col = line.trim_end().split('\t').position(|c| c == "length").unwrap();
    let mut v = Vec::new();
    while v.len() < 200_000 {
        line.clear();
        if std::io::BufRead::read_line(&mut r, &mut line).unwrap() == 0 {
            break;
        }
        if let Some(Ok(l)) = line.trim_end().split('\t').nth(col).map(str::parse::<u32>) {
            v.push(l);
        }
    }
    v.sort_unstable();
    v[v.len() / 2]
}

/// P3 through the app's own paths: open (head rows), Indexed, Ranked, the
/// typed columns; filter changes (each a new view spec, as the table sends
/// them): five narrow ones sorted by E-value (max E-value 100, min length
/// 3, spectrum contains "scan=1<k>"), the unrestricted ones (max E 1000,
/// min length at the file's median length, a spectrum substring every row
/// has), then a re-sort by tag and by spectrum (each order built once,
/// both directions) and cutoff changes on those non-E-value sorts,
/// unrestricted ones among them; a cached page, the best tag per spectrum;
/// then exports, each three times (median): unsorted (every column, TSV),
/// sorted by E-value both ways (every column, TSV) and a filtered CSV. Peak
/// RSS of the whole sequence.
fn p3(path: &str) -> String {
    let med = median_length(path);
    let t0 = Instant::now();
    let (s, head) = Session::open(path).unwrap();
    let first_rows_ms = ms(t0);
    s.wait_indexed();
    let indexed_ms = ms(t0);
    if std::env::var_os("FASTAG_BENCH_TRACE").is_some() {
        eprintln!("indexed: peak {} MB, now {} MB", peak_rss_bytes() >> 20, rss_now_mb());
    }
    s.wait_ranked();
    let ranked_swap_ms = ms(t0);
    if std::env::var_os("FASTAG_BENCH_TRACE").is_some() {
        eprintln!("ranked: peak {} MB, now {} MB", peak_rss_bytes() >> 20, rss_now_mb());
    }
    s.wait_typed();
    let typed_ready_ms = ms(t0);
    if std::env::var_os("FASTAG_BENCH_TRACE").is_some() {
        eprintln!("open + builds: peak {} MB, now {} MB", peak_rss_bytes() >> 20, rss_now_mb());
        #[cfg(target_os = "macos")]
        {
            extern "C" {
                fn malloc_zone_pressure_relief(zone: *mut libc::c_void, goal: usize) -> usize;
            }
            let freed = unsafe { malloc_zone_pressure_relief(std::ptr::null_mut(), 0) };
            eprintln!("relief {} MB: now {} MB", freed >> 20, rss_now_mb());
        }
    }
    let mut named: Vec<(String, f64, usize)> = Vec::new();
    let trace = std::env::var_os("FASTAG_BENCH_TRACE").is_some();
    let time = |name: String, spec: &ViewSpec, named: &mut Vec<(String, f64, usize)>| {
        let t = Instant::now();
        let (m, _) = s.query(spec, 0, 200).unwrap();
        if trace {
            eprintln!("{name}: peak {} MB, now {} MB", peak_rss_bytes() >> 20, rss_now_mb());
        }
        named.push((name, ms(t), m));
    };
    let ev = by("evalue", false);
    for k in 0..5 {
        let spec = ViewSpec { sort: ev.clone(), max_evalue: Some(100.0), min_length: Some(3), spectrum: Some(format!("scan=1{k}")), ..Default::default() };
        time(format!("evalue: maxE 100, len>=3, scan=1{k}"), &spec, &mut named);
    }
    time("evalue: maxE 1000".into(), &ViewSpec { sort: ev.clone(), max_evalue: Some(1000.0), ..Default::default() }, &mut named);
    time(format!("evalue: len>={med}"), &ViewSpec { sort: ev.clone(), min_length: Some(med), ..Default::default() }, &mut named);
    time("evalue: spectrum 'scan'".into(), &ViewSpec { sort: ev.clone(), spectrum: Some("scan".into()), ..Default::default() }, &mut named);
    time(
        "evalue: maxE 1000, len>=3, spectrum 'scan'".into(),
        &ViewSpec { sort: ev.clone(), max_evalue: Some(1000.0), min_length: Some(3), spectrum: Some("scan".into()), ..Default::default() },
        &mut named,
    );
    time("evalue: target hits only".into(), &ViewSpec { sort: ev.clone(), fasta_hit: Some("only".into()), ..Default::default() }, &mut named);
    // Re-sorts: the first build of each order is a sort, not a filter change.
    let mut resort = Vec::new();
    for c in ["tag", "spectrum"] {
        for desc in [false, true] {
            let t = Instant::now();
            s.query(&ViewSpec { sort: by(c, desc), ..Default::default() }, 0, 200).unwrap();
            resort.push(format!(r#"{{"column":"{c}","desc":{desc},"ms":{}}}"#, ms(t)));
            if trace {
                eprintln!("sort {c} {desc}: peak {} MB, now {} MB", peak_rss_bytes() >> 20, rss_now_mb());
            }
        }
        let o = by(c, true);
        for (name, spec) in [
            ("maxE 100", ViewSpec { sort: o.clone(), max_evalue: Some(100.0), ..Default::default() }),
            ("maxE 10", ViewSpec { sort: o.clone(), max_evalue: Some(10.0), ..Default::default() }),
            ("maxE 1000", ViewSpec { sort: o.clone(), max_evalue: Some(1000.0), ..Default::default() }),
            ("len>=median", ViewSpec { sort: o.clone(), min_length: Some(med), ..Default::default() }),
            ("maxE 1000, len>=3, spectrum 'scan'", ViewSpec { sort: o.clone(), max_evalue: Some(1000.0), min_length: Some(3), spectrum: Some("scan".into()), ..Default::default() }),
        ] {
            time(format!("{c} desc: {name}"), &spec, &mut named);
        }
    }
    let times: Vec<f64> = named.iter().map(|x| x.1).collect();
    let filter_ms_median = median(times.clone());
    let filter_ms_max = times.iter().copied().fold(0.0, f64::max);
    let filter_ms_median_evalue5 = median(times[..5].to_vec());
    let cached = ViewSpec { sort: by("evalue", false), max_evalue: Some(100.0), min_length: Some(3), spectrum: Some("scan=14".into()), ..Default::default() };
    // Built once here (the filters above may have pushed it out of the
    // view cache), then a page of it timed: a cached page.
    s.query(&cached, 0, 200).unwrap();
    let t = Instant::now();
    s.query(&cached, 5000, 200).unwrap();
    let cached_page_ms = ms(t);
    let best = ViewSpec { sort: by("evalue", false), per_spectrum: Some(1), ..Default::default() };
    let t = Instant::now();
    let (best_rows, _) = s.query(&best, 0, 200).unwrap();
    let best_ms = ms(t);
    // The header from the first line (no second index: it would count in
    // the peak).
    let mut first = String::new();
    std::io::BufRead::read_line(&mut std::io::BufReader::new(File::open(path).unwrap()), &mut first).unwrap();
    let all: Vec<String> = first.trim_end().split('\t').map(str::to_string).collect();
    let bytes = std::fs::metadata(path).unwrap().len() - first.len() as u64;
    let gb = bytes as f64 / 1e9;
    let dest = std::env::temp_dir().join(format!("fastag-bench-p3-{}.tsv", std::process::id()));
    let dest = dest.to_string_lossy().into_owned();
    // Each export three times: (rows, s per GB of the source, the median).
    let rep = |spec: &ViewSpec, fmt: ExportFormat, per: f64| -> (usize, Vec<f64>, f64) {
        let mut v = Vec::new();
        let mut n = 0;
        for _ in 0..3 {
            let t = Instant::now();
            n = s.export(spec, &all, &dest, fmt).unwrap();
            v.push((t.elapsed().as_secs_f64() / per * 1e3).round() / 1e3);
        }
        let m = median(v.clone());
        (n, v, m)
    };
    let (n_unsorted, unsorted_v, unsorted) = rep(&ViewSpec::default(), ExportFormat::Tsv, gb);
    let (n_sorted, sorted_v, sorted) = rep(&ViewSpec { sort: by("evalue", false), ..Default::default() }, ExportFormat::Tsv, gb);
    let (n_desc, desc_v, sorted_desc) = rep(&ViewSpec { sort: by("evalue", true), ..Default::default() }, ExportFormat::Tsv, gb);
    let (n_csv, csv_v, csv_s) = rep(&cached, ExportFormat::Csv, 1.0);
    std::fs::remove_file(&dest).ok();
    let specs: Vec<String> = named.iter().map(|(n, t, m)| format!(r#"{{"spec":"{n}","ms":{t},"matched":{m}}}"#)).collect();
    format!(
        r#"{{"head_rows":{head},"first_rows_ms":{first_rows_ms},"indexed_ms":{indexed_ms},"ranked_swap_ms":{ranked_swap_ms},"typed_ready_ms":{typed_ready_ms},"median_length":{med},"filters":[{}],"filter_ms_median":{filter_ms_median},"filter_ms_max":{filter_ms_max},"filter_ms_median_narrow5":{filter_ms_median_evalue5},"resorts":[{}],"cached_page_ms":{cached_page_ms},"best_per_spectrum_ms":{best_ms},"best_per_spectrum_rows":{best_rows},"export_bytes":{bytes},"export_unsorted_rows":{n_unsorted},"export_unsorted_s_per_gb_runs":{unsorted_v:?},"export_unsorted_s_per_gb":{unsorted:.3},"export_sorted_rows":{n_sorted},"export_sorted_s_per_gb_runs":{sorted_v:?},"export_sorted_s_per_gb":{sorted:.3},"export_sorted_desc_rows":{n_desc},"export_sorted_desc_s_per_gb_runs":{desc_v:?},"export_sorted_desc_s_per_gb":{sorted_desc:.3},"export_filtered_csv_rows":{n_csv},"export_filtered_csv_s_runs":{csv_v:?},"export_filtered_csv_s":{csv_s:.3},"peak_rss_mb":{}}}"#,
        specs.join(","),
        resort.join(","),
        peak_rss_bytes() / (1 << 20)
    )
}

/// A bench file of @p rows rows from the public E. coli fixture tags,
/// varied so that every filter cuts: each replicate shifts the scan
/// numbers; tag lengths 3..=12 (geometric-like, median 4 or 5), the tag
/// extended with random residues and the length column to match; hit
/// classes '-' (65%), a protein (30%), efwd/erev (5%); E-values
/// log-uniform 1e-6..1e3, every 997th '-', 1999th NAN, 2999th INF.
fn gen(fixture: &str, out: &str, rows: usize, seed: u64) {
    let text = std::fs::read_to_string(fixture).unwrap();
    let mut lines = text.lines();
    let head = lines.next().unwrap();
    let cols: Vec<&str> = head.split('\t').collect();
    let at = |n: &str| cols.iter().position(|c| *c == n).unwrap();
    let (sp, tag, len, ev, hit) = (at("spectrum"), at("tag"), at("length"), at("evalue"), at("fasta_hit"));
    let base: Vec<Vec<&str>> = lines.filter(|l| !l.is_empty()).map(|l| l.split('\t').collect()).collect();
    let mut x = seed | 1;
    let mut rnd = move || {
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        x
    };
    const AA: &[u8] = b"ACDEFGHIKLMNPQRSTVWY";
    const PROT: [&str; 6] = ["sp|P0A7V8|RS4_ECOLI", "sp|P0A6F5|CH60_ECOLI", "sp|P0ABK5|CYSK_ECOLI", "sp|P0A9B2|G3P1_ECOLI", "sp|P0CE47|EFTU1_ECOLI", "sp|P02358|RS6_ECOLI"];
    let mut w = BufWriter::with_capacity(8 << 20, File::create(out).unwrap());
    writeln!(w, "{head}").unwrap();
    let mut cells: Vec<String> = Vec::new();
    for i in 0..rows {
        let r = &base[i % base.len()];
        let rep = i / base.len();
        cells.clear();
        cells.extend(r.iter().map(|c| c.to_string()));
        // scan=<n> -> scan=<n + rep * 100000>
        if let Some(k) = cells[sp].rfind("scan=") {
            let n: u64 = cells[sp][k + 5..].parse().unwrap_or(0);
            cells[sp] = format!("{}scan={}", &cells[sp][..k], n + rep as u64 * 100_000);
        }
        let mut l = 3;
        while l < 12 && rnd() % 100 < 72 {
            l += 1;
        }
        let mut t = cells[tag].clone();
        while t.len() < l {
            t.push(AA[(rnd() % AA.len() as u64) as usize] as char);
        }
        cells[len] = t.len().to_string();
        cells[tag] = t;
        let h = rnd() % 100;
        cells[hit] = if h < 65 { "-".into() } else if h < 95 { PROT[(rnd() % 6) as usize].into() } else if h < 98 { "efwd".into() } else { "erev".into() };
        cells[ev] = if i % 997 == 0 {
            "-".into()
        } else if i % 1999 == 0 {
            "NAN".into()
        } else if i % 2999 == 0 {
            "INF".into()
        } else {
            let u = (rnd() >> 11) as f64 / (1u64 << 53) as f64;
            format!("{:.4e}", 10f64.powf(-6.0 + 9.0 * u))
        };
        writeln!(w, "{}", cells.join("\t")).unwrap();
    }
    w.flush().unwrap();
}

/// Sorts by the other columns, each the first time and once more (cached),
/// after the open's builds: not gated (GUI-DESIGN 7: provisional).
fn sort(path: &str) -> String {
    let (s, _) = Session::open(path).unwrap();
    s.wait_typed();
    let mut parts = Vec::new();
    for c in ["tag", "spectrum", "length"] {
        let spec = ViewSpec { sort: by(c, false), ..Default::default() };
        let t = Instant::now();
        s.query(&spec, 0, 200).unwrap();
        let first = ms(t);
        let spec = ViewSpec { sort: by(c, true), ..Default::default() };
        let t = Instant::now();
        s.query(&spec, 0, 200).unwrap();
        let again = ms(t);
        parts.push(format!(r#""{c}":{{"first_ms":{first},"desc_after_ms":{again}}}"#));
    }
    format!(r#"{{{},"peak_rss_mb":{}}}"#, parts.join(","), peak_rss_bytes() / (1 << 20))
}

/// First rows from a cold page cache (local SSD): the file is copied with
/// F_NOCACHE writes, so its pages are not cached, and opened in a fresh
/// process. `tail_read_gb_per_s` says whether the copy was really cold.
fn cold(path: &str) -> String {
    let copy = format!("{path}.cold-copy");
    {
        let mut src = File::open(path).unwrap();
        let dst = File::create(&copy).unwrap();
        #[cfg(target_os = "macos")]
        unsafe {
            use std::os::fd::AsRawFd;
            libc::fcntl(dst.as_raw_fd(), libc::F_NOCACHE, 1);
        }
        let mut w = dst;
        let mut buf = vec![0u8; 8 << 20];
        loop {
            let n = src.read(&mut buf).unwrap();
            if n == 0 {
                break;
            }
            w.write_all(&buf[..n]).unwrap();
        }
        w.sync_all().unwrap();
    }
    let me = std::env::current_exe().unwrap();
    let o = Command::new(&me).args(["--mode", "coldopen", &copy]).output().unwrap();
    std::fs::remove_file(&copy).ok();
    assert!(o.status.success(), "coldopen: {}", String::from_utf8_lossy(&o.stderr));
    String::from_utf8_lossy(&o.stdout).trim().to_string()
}

fn coldopen(path: &str) -> String {
    let bytes = std::fs::metadata(path).unwrap().len();
    // The witness: the last 256 MB read raw first (the head read takes the
    // first 1 MB); a warm page cache reads them at about 25 GB/s here.
    let tail = bytes.min(256 << 20);
    let mut f = File::open(path).unwrap();
    f.seek(SeekFrom::Start(bytes - tail)).unwrap();
    let t = Instant::now();
    std::io::copy(&mut f.take(tail), &mut std::io::sink()).unwrap();
    let tail_gb_per_s = tail as f64 / 1e9 / t.elapsed().as_secs_f64();
    let t0 = Instant::now();
    let (s, head) = Session::open(path).unwrap();
    let first_rows_ms = ms(t0);
    s.wait_indexed();
    let indexed_ms = ms(t0);
    format!(
        r#"{{"head_rows":{head},"first_rows_ms":{first_rows_ms},"indexed_ms":{indexed_ms},"tail_read_gb_per_s":{tail_gb_per_s:.2}}}"#
    )
}

/// A -res_conf tags file of @p rows rows: the rows of @p src over and over,
/// each copy's spectrum IDs made unique (`<id> copy=<k>`).
fn gen_reads(src: &str, out: &str, rows: usize) {
    let text = std::fs::read_to_string(src).unwrap();
    let mut lines = text.lines();
    let head = lines.next().unwrap();
    let body: Vec<&str> = lines.filter(|l| !l.is_empty()).collect();
    let mut w = BufWriter::with_capacity(8 << 20, File::create(out).unwrap());
    writeln!(w, "{head}").unwrap();
    for i in 0..rows {
        let l = body[i % body.len()];
        let (spec, rest) = l.split_once('\t').unwrap();
        writeln!(w, "{spec} copy={}\t{rest}", i / body.len()).unwrap();
    }
    w.flush().unwrap();
}

/// The reads export job's own path (denovo::export_reads) on @p path: the
/// GUI's defaults (Stitch, top-n 1, min 8) and the heaviest options (ALPS,
/// top-n 50, min 1), 3 times each; the median and the process's peak RSS.
/// @p only picks one of the two (`--mode reads_stitch|reads_alps`), so the
/// peak RSS is that case's own.
fn reads(path: &str, only: Option<&str>) -> String {
    use fastag_lib::denovo::{export_reads, DenovoFormat, DenovoOptions};
    let dir = std::env::temp_dir();
    let mut parts = Vec::new();
    for (name, opts) in [
        ("stitch_top1_min8", DenovoOptions { format: DenovoFormat::Stitch, top_n: 1, min_length: 8 }),
        ("alps_top50_min1", DenovoOptions { format: DenovoFormat::Alps, top_n: 50, min_length: 1 }),
    ] {
        if only.is_some_and(|o| !name.starts_with(o)) {
            continue;
        }
        let dest = dir.join(format!("fastag-bench-{}-{name}.csv", std::process::id()));
        let mut ms = Vec::new();
        let mut reads = 0;
        let mut out_bytes = 0;
        for _ in 0..3 {
            let t = Instant::now();
            let s = export_reads(path, dest.to_str().unwrap(), opts, &Default::default(), &mut |_, _| {}).unwrap();
            ms.push(t.elapsed().as_secs_f64() * 1e3);
            reads = s.reads;
            out_bytes = std::fs::metadata(&dest).unwrap().len();
            std::fs::remove_file(&dest).unwrap();
        }
        let runs = ms.iter().map(|m| format!("{m:.0}")).collect::<Vec<_>>().join(",");
        ms.sort_by(f64::total_cmp);
        parts.push(format!(r#""{name}":{{"ms":[{runs}],"median_ms":{:.0},"reads":{reads},"out_bytes":{out_bytes}}}"#, ms[1]));
    }
    format!(r#"{{{},"peak_rss_mb":{}}}"#, parts.join(","), peak_rss_bytes() >> 20)
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() == 5 && args[1] == "--gen-reads" {
        gen_reads(&args[2], &args[3], args[4].parse().unwrap());
        return;
    }
    if args.len() == 6 && args[1] == "--gen" {
        gen(&args[2], &args[3], args[4].parse().unwrap(), args[5].parse().unwrap());
        return;
    }
    if args.len() == 4 && args[1] == "--mode" {
        let out = match args[2].as_str() {
            "firstcut" => firstcut(&args[3]),
            "typed" => typed(&args[3]),
            "p3" => p3(&args[3]),
            "sort" => sort(&args[3]),
            "cold" => cold(&args[3]),
            "reads" => reads(&args[3], None),
            "reads_stitch" => reads(&args[3], Some("stitch")),
            "reads_alps" => reads(&args[3], Some("alps")),
            "coldopen" => coldopen(&args[3]),
            "tprobe" => {
                let ix = bench::index(&args[3]).unwrap();
                eprintln!("indexed now {}", rss_now_mb());
                bench::typed_probe(&args[3], &ix, &|w| eprintln!("{w}: now {} peak {}", rss_now_mb(), peak_rss_bytes() >> 20));
                String::new()
            }
            m => panic!("unknown mode {m}"),
        };
        println!("{out}");
        return;
    }
    let me = std::env::current_exe().unwrap();
    let mut files = Vec::new();
    for path in &args[1..] {
        let size = std::fs::metadata(path).unwrap().len();
        // Warm page cache (GUI-DESIGN 7): read the file once first.
        std::io::copy(&mut File::open(path).unwrap(), &mut std::io::sink()).unwrap();
        let mut parts = vec![format!(r#""file":"{}","bytes":{size}"#, path.replace('\\', "/").replace('"', "\\\""))];
        for mode in ["firstcut", "typed", "p3", "sort", "cold"] {
            // Warm page cache: the first child also warms it for the others.
            let o = Command::new(&me).args(["--mode", mode, path]).output().unwrap();
            assert!(o.status.success(), "{mode}: {}", String::from_utf8_lossy(&o.stderr));
            parts.push(format!(r#""{mode}":{}"#, String::from_utf8_lossy(&o.stdout).trim()));
            eprintln!("{path}: {mode} done");
        }
        files.push(format!("{{{}}}", parts.join(",")));
    }
    println!(
        r#"{{"bench":"browser","os":"{}","arch":"{}","files":[{}]}}"#,
        std::env::consts::OS,
        std::env::consts::ARCH,
        files.join(",")
    );
}
