//! Browser bench (GUI-DESIGN 7 and 10): the P0b first cut (head read, index,
//! background E-value order), the bench-only typed-column prototype of P0b
//! (the baselines of the provisional P3 targets), and the P3 browser itself
//! through the app's own open, query and export paths: filter changes,
//! export throughput, backend peak memory, sorts by other columns, and
//! first rows from a cold page cache.
//!
//!   cargo run --release --example browser_bench -- <tags.tsv> [more.tsv ...] > bench.json
//!
//! Each measurement runs in a child process of its own, so its peak RSS is
//! its own. `--mode <firstcut|typed|p3|sort|cold> <file>` runs one of them.
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

/// P3 through the app's own paths: open (head rows), Indexed, Ranked, the
/// typed columns; five filter changes (each a new view spec, as the table
/// sends them, sorted by E-value: max E-value 100, min length 3, spectrum
/// contains "scan=1<k>"), a cached page, the best tag per spectrum; then
/// export unsorted (every column, TSV), sorted by E-value (every column,
/// TSV) and a filtered CSV. Peak RSS of the whole sequence.
fn p3(path: &str) -> String {
    let t0 = Instant::now();
    let (s, head) = Session::open(path).unwrap();
    let first_rows_ms = ms(t0);
    s.wait_indexed();
    let indexed_ms = ms(t0);
    s.wait_ranked();
    let ranked_swap_ms = ms(t0);
    s.wait_typed();
    let typed_ready_ms = ms(t0);
    let mut times = Vec::new();
    let mut matched = Vec::new();
    for k in 0..5 {
        let spec = ViewSpec {
            sort: by("evalue", false),
            max_evalue: Some(100.0),
            min_length: Some(3),
            spectrum: Some(format!("scan=1{k}")),
            ..Default::default()
        };
        let t = Instant::now();
        let (m, _) = s.query(&spec, 0, 200).unwrap();
        times.push(ms(t));
        matched.push(m);
    }
    let filter_ms_median5 = median(times.clone());
    let cached = ViewSpec { sort: by("evalue", false), max_evalue: Some(100.0), min_length: Some(3), spectrum: Some("scan=14".into()), ..Default::default() };
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
    let t = Instant::now();
    let n_unsorted = s.export(&ViewSpec::default(), &all, &dest, ExportFormat::Tsv).unwrap();
    let unsorted = t.elapsed().as_secs_f64() / gb;
    let t = Instant::now();
    let n_sorted = s.export(&ViewSpec { sort: by("evalue", false), ..Default::default() }, &all, &dest, ExportFormat::Tsv).unwrap();
    let sorted = t.elapsed().as_secs_f64() / gb;
    let t = Instant::now();
    let n_desc = s.export(&ViewSpec { sort: by("evalue", true), ..Default::default() }, &all, &dest, ExportFormat::Tsv).unwrap();
    let sorted_desc = t.elapsed().as_secs_f64() / gb;
    let t = Instant::now();
    let n_csv = s.export(&cached, &all, &dest, ExportFormat::Csv).unwrap();
    let csv_s = t.elapsed().as_secs_f64();
    std::fs::remove_file(&dest).ok();
    format!(
        r#"{{"head_rows":{head},"first_rows_ms":{first_rows_ms},"indexed_ms":{indexed_ms},"ranked_swap_ms":{ranked_swap_ms},"typed_ready_ms":{typed_ready_ms},"filter_ms":{times:?},"filter_ms_median5":{filter_ms_median5},"filter_matched":{matched:?},"cached_page_ms":{cached_page_ms},"best_per_spectrum_ms":{best_ms},"best_per_spectrum_rows":{best_rows},"export_bytes":{bytes},"export_unsorted_rows":{n_unsorted},"export_unsorted_s_per_gb":{unsorted:.3},"export_sorted_rows":{n_sorted},"export_sorted_s_per_gb":{sorted:.3},"export_sorted_desc_rows":{n_desc},"export_sorted_desc_s_per_gb":{sorted_desc:.3},"export_filtered_csv_rows":{n_csv},"export_filtered_csv_s":{csv_s:.3},"peak_rss_mb":{}}}"#,
        peak_rss_bytes() / (1 << 20)
    )
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

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() == 4 && args[1] == "--mode" {
        let out = match args[2].as_str() {
            "firstcut" => firstcut(&args[3]),
            "typed" => typed(&args[3]),
            "p3" => p3(&args[3]),
            "sort" => sort(&args[3]),
            "cold" => cold(&args[3]),
            "coldopen" => coldopen(&args[3]),
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
