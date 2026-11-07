// P3 (GUI-DESIGN 6.1 items 7-12): typed columns, cached orders for every
// column, filters on the cached permutation, per-spectrum best/top N,
// coalesced pages, export as a job (progress, cancel, CSV). Every view is
// checked against the v1.11 build_view, kept as `reference` (extended by the
// per-spectrum rule), on generated TSVs with ties, NaN, inf, '-', a BOM,
// CRLF, blank lines, short and long rows and mixed unparsable cells.

use super::*;
use proptest::prelude::*;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

static SEQ: AtomicUsize = AtomicUsize::new(0);

fn temp(name: &str, body: &[u8]) -> String {
    let n = SEQ.fetch_add(1, Ordering::SeqCst);
    let p = std::env::temp_dir().join(format!("fastag-p3-{}-{n}-{name}", std::process::id()));
    std::fs::write(&p, body).unwrap();
    p.to_string_lossy().into_owned()
}

/// Every row of @p spec's view through the query path (Exact).
fn view_rows(shared: &Arc<Shared>, p: &str, spec: &ViewSpec) -> Result<Vec<u32>, String> {
    let mut out = Vec::new();
    loop {
        let page = query(shared, p, spec, out.len(), MAX_WINDOW)?;
        assert!(page.ranked && !page.pending);
        if page.rows.is_empty() {
            break;
        }
        out.extend_from_slice(&page.row_ids);
        if out.len() >= page.matched_rows {
            break;
        }
    }
    Ok(out)
}

/// The rows of @p spec's view as the query pages give them (cells).
fn view_cells(shared: &Arc<Shared>, p: &str, spec: &ViewSpec) -> (Vec<String>, Vec<Vec<String>>) {
    let mut rows = Vec::new();
    let mut columns;
    loop {
        let page = query(shared, p, spec, rows.len(), MAX_WINDOW).unwrap();
        columns = page.columns.clone();
        if page.rows.is_empty() {
            break;
        }
        rows.extend(page.rows);
        if rows.len() >= page.matched_rows {
            break;
        }
    }
    (columns, rows)
}

fn oracle(p: &str, spec: &ViewSpec) -> Vec<u32> {
    let index = build_index(p, &Cancel::default()).unwrap();
    reference::build_view(p, &index, &Resolved::bind(spec, &index.columns), &Cancel::default()).unwrap()
}

// ------------------------------------------------------------ generators

const SPECTRA: &[&[u8]] = &[
    b"scan=1", b"scan=2", b"Scan=10", b"scan=10 frame=3", b"SCAN=1", b"1", b"1.0", b"-0", b"0", b"-", b"", b"\xff", b"\xfe",
    b"\xc3\xa9", b"\xc3\x89t", b"k", b"\xe2\x84\xaa",
];
const TAGS: &[&[u8]] = &[
    b"AAA", b"AAAAAAAA", b"AAAAAAAAB", b"AAAAAAAAC", b"AAAAAAAAAAAAAAAAAAAAZ", b"AAAAAAAAAAAAAAAAAAAAY", b"AB", b"A", b"",
    b"NAN", b"INF", b"ab,c", b"q\"uote", b"a\rb", b"AAAAAAAA\x00", b"AAAAAAA", b"7", b"\xff\xfe",
];
const LENGTHS: &[&[u8]] = &[b"7", b"6", b"3", b"0", b"70000", b"+3", b" 3", b"-1", b"x", b"", b"65535", b"65534", b"4294967295", b"4294967296"];
const EVALUES: &[&[u8]] = &[
    b"0.003", b"0.003", b"0.0001", b"1e-5", b"1E-5", b"0.00001", b"105.503", b"7", b"-1", b"0", b"-0", b"0.0", b"1e308",
    b"-1e-300", b"2.5e-08", b"+3", b".5", b"5.", b"-", b"-", b"NAN", b"NaN", b"nan", b"INF", b"inf", b"-INF", b"Infinity",
    b"-inf", b"", b" 3", b"abc", b"1e999", b"-1e999", b"0x10", b"\xff\xfe", b"\xc3\xa9",
];
const HITS: &[&[u8]] = &[b"-", b"fwd", b"rev", b"efwd", b"erev", b"", b"EFWD", b"-,"];
const NAMES: &[&str] = &["spectrum", "tag", "length", "evalue", "fasta_hit", "proforma"];

fn pool(name: &str) -> &'static [&'static [u8]] {
    match name {
        "spectrum" => SPECTRA,
        "length" => LENGTHS,
        "evalue" => EVALUES,
        "fasta_hit" => HITS,
        _ => TAGS,
    }
}

#[derive(Debug, Clone)]
struct Tsv {
    body: Vec<u8>,
    names: Vec<String>,
}

/// A TSV: a header of some of NAMES in some order, rows of cells from
/// their pools; a BOM, CRLF, blank lines, short and over-long rows, with or
/// without the last newline.
fn tsv() -> impl Strategy<Value = Tsv> {
    (
        Just(NAMES.to_vec()).prop_shuffle(),
        2usize..=6,
        any::<bool>(),
        any::<bool>(),
        any::<bool>(),
        prop::collection::vec((prop::collection::vec(any::<prop::sample::Index>(), 7), 0u8..20), 0..90),
    )
        .prop_map(|(names, k, bom, crlf, last_nl, rows)| {
            let names: Vec<&str> = names.iter().take(k).copied().collect();
            let nl: &[u8] = if crlf { b"\r\n" } else { b"\n" };
            let mut body = Vec::new();
            if bom {
                body.extend_from_slice(b"\xEF\xBB\xBF");
            }
            body.extend_from_slice(names.join("\t").as_bytes());
            body.extend_from_slice(nl);
            let n = rows.len();
            for (r, (cells, shape)) in rows.into_iter().enumerate() {
                if shape == 0 {
                    body.extend_from_slice(nl); // a blank line is not a row
                }
                // shape 1: a short row; 2: one cell too many.
                let have = match shape {
                    1 => 1 + cells[6].index(names.len()),
                    2 => names.len() + 1,
                    _ => names.len(),
                };
                for c in 0..have {
                    if c > 0 {
                        body.push(b'\t');
                    }
                    let p = pool(names.get(c).copied().unwrap_or("proforma"));
                    body.extend_from_slice(p[cells[c.min(5)].index(p.len())]);
                }
                if r + 1 < n || last_nl {
                    body.extend_from_slice(nl);
                }
            }
            Tsv { body, names: names.iter().map(|s| s.to_string()).collect() }
        })
}

fn spec() -> impl Strategy<Value = ViewSpec> {
    let sort = prop_oneof![
        Just(None),
        (prop::sample::select(vec!["spectrum", "tag", "length", "evalue", "fasta_hit", "proforma", "nope"]), any::<bool>())
            .prop_map(|(c, desc)| Some(SortSpec { column: c.into(), desc })),
    ];
    let needle = prop::option::of(prop::sample::select(vec!["scan=1", "SCAN", "1", "\u{e9}", "", "zz", "K", "=1"]));
    let min_length = prop::option::of(prop_oneof![0u32..8, Just(65535u32), Just(66000u32)]);
    let max_evalue = prop::option::of(prop::sample::select(vec![0.0, 0.003, 1e-5, -1.0, 1e308, f64::INFINITY, 7.0]));
    let hit = prop::option::of(prop::sample::select(vec!["only", "none", "entrapment", "any"]));
    let per = prop::option::of(0u32..4);
    (sort, needle, min_length, max_evalue, hit, per).prop_map(|(sort, s, min_length, max_evalue, hit, per)| ViewSpec {
        sort,
        spectrum: s.map(str::to_string),
        min_length,
        max_evalue,
        fasta_hit: hit.map(str::to_string),
        per_spectrum: per,
    })
}

/// An independent writer of what an export of @p cells must contain.
fn expected_export(columns: &[String], rows: &[Vec<String>], pick: &[String], csv: bool) -> Vec<u8> {
    let idx: Vec<usize> = pick.iter().filter_map(|c| columns.iter().position(|h| h == c)).collect();
    let cell = |s: &str| -> String {
        if csv && s.contains([',', '"', '\r', '\n']) {
            format!("\"{}\"", s.replace('"', "\"\""))
        } else {
            s.to_string()
        }
    };
    let (sep, end) = if csv { (",", "\r\n") } else { ("\t", "\n") };
    let line = |cells: &[String]| -> String {
        let v: Vec<String> = idx.iter().map(|&i| cell(cells.get(i).map(String::as_str).unwrap_or(""))).collect();
        format!("{}{end}", v.join(sep))
    };
    let mut out = line(columns);
    for r in rows {
        out.push_str(&line(r));
    }
    out.into_bytes()
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 300, ..ProptestConfig::default() })]

    /// Every view (sort by any column, either direction, every filter, the
    /// per-spectrum rule) is the reference's, with the typed columns and
    /// with the chunk-scan fallback beyond the typed budget.
    #[test]
    fn every_view_equals_the_reference(t in tsv(), specs in prop::collection::vec(spec(), 1..6)) {
        let p = temp("view.tsv", &t.body);
        let typed = Arc::new(Shared::default());
        let scan = Arc::new(Shared::default());
        scan.typed_max_rows.store(0, Ordering::SeqCst);
        for s in &specs {
            let want = oracle(&p, s);
            prop_assert_eq!(&view_rows(&typed, &p, s).unwrap(), &want, "typed {:?} on {:?}", s, t);
            match view_rows(&scan, &p, s) {
                Ok(v) => prop_assert_eq!(&v, &want, "scan {:?}", s),
                // Only the per-spectrum rule needs the typed columns.
                Err(e) => prop_assert!(Resolved::bind(s, &t.names).per_spectrum.is_some(), "{} for {:?}", e, s),
            }
        }
        std::fs::remove_file(&p).ok();
    }

    /// An export holds exactly the view's rows, in its order, in the chosen
    /// columns: byte for byte what the pages show, as TSV or as CSV.
    #[test]
    fn export_bytes_equal_the_filtered_view(
        t in tsv(),
        s in spec(),
        pick in prop::sample::subsequence(vec!["spectrum", "tag", "length", "evalue", "fasta_hit", "proforma", "nope"], 1..7).prop_shuffle(),
        csv in any::<bool>(),
    ) {
        let p = temp("export.tsv", &t.body);
        let shared = Arc::new(Shared::default());
        let pick: Vec<String> = pick.iter().map(|c| c.to_string()).collect();
        let dest = format!("{p}.out");
        let fmt = if csv { ExportFormat::Csv } else { ExportFormat::Tsv };
        let got = export_to(&shared, &p, &s, &pick, &dest, fmt, &Cancel::default(), &|_, _| {});
        if !pick.iter().any(|c| t.names.contains(c)) {
            prop_assert!(got.is_err());
        } else {
            let (columns, rows) = view_cells(&shared, &p, &s);
            prop_assert_eq!(got.unwrap(), rows.len());
            let bytes = std::fs::read(&dest).unwrap();
            let want = expected_export(&columns, &rows, &pick, csv);
            prop_assert_eq!(String::from_utf8_lossy(&bytes), String::from_utf8_lossy(&want));
        }
        std::fs::remove_file(&p).ok();
        std::fs::remove_file(&dest).ok();
    }
}

// ------------------------------------------------------------- fixtures

const HEADER: &str = "spectrum\ttag\tlength\tcharge\tnterm_mass\tcterm_mass\textended\tgapped\tevalue\tmin_conf\tmean_conf\tfasta_hit";

/// @p n rows over @p n / 4 spectra, E-values with ties.
fn big(n: u32) -> String {
    let mut body = format!("{HEADER}\n");
    for i in 0..n {
        body.push_str(&format!(
            "scan={}\tT{}\t{}\t1\t0\t0\t0\t0\t{}\t0\t0\t{}\n",
            i / 4,
            i % 97,
            3 + i % 6,
            (i * 7919) % 1000,
            ["-", "fwd", "rev", "efwd"][(i % 4) as usize]
        ));
    }
    temp("big.tsv", body.as_bytes())
}

fn by(column: &str, desc: bool) -> Option<SortSpec> {
    Some(SortSpec { column: column.into(), desc })
}

type Events = Arc<Mutex<Vec<ExportEvent>>>;

fn export_collector() -> (ExportEmit, Events) {
    let got: Events = Arc::default();
    let g = got.clone();
    (Arc::new(move |e| g.lock().unwrap().push(e)), got)
}

fn wait_end(got: &Events, id: u64) -> ExportEvent {
    let until = Instant::now() + Duration::from_secs(30);
    loop {
        if let Some(e) = got.lock().unwrap().iter().find(|e| e.job_id() == id && e.is_terminal()) {
            return e.clone();
        }
        assert!(Instant::now() < until, "export {id} never ended: {:?}", got.lock().unwrap());
        std::thread::sleep(Duration::from_millis(5));
    }
}

// ---------------------------------------------------------- per spectrum

#[test]
fn per_spectrum_keeps_the_best_n_tags_by_evalue() {
    let p = temp(
        "per.tsv",
        b"spectrum\ttag\tevalue\tlength\n\
          s1\tA\t0.5\t3\n\
          s2\tB\t0.1\t7\n\
          s1\tC\t0.01\t7\n\
          s1\tD\t-\t7\n\
          s2\tE\t0.1\t3\n\
          s1\tF\t0.01\t7\n\
          S1\tG\t0.2\t7\n",
    );
    let shared = Arc::new(Shared::default());
    let tags = |s: &ViewSpec| -> Vec<String> { view_cells(&shared, &p, s).1.iter().map(|r| r[1].clone()).collect() };
    let best = ViewSpec { per_spectrum: Some(1), ..Default::default() };
    // One row per spectrum ("S1" is a spectrum of its own), file order;
    // ties on the E-value go to the earlier row.
    assert_eq!(tags(&best), ["B", "C", "G"]);
    let top2 = ViewSpec { per_spectrum: Some(2), sort: by("evalue", false), ..Default::default() };
    assert_eq!(tags(&top2), ["C", "F", "B", "E", "G"]);
    // The other filters first, then the best among what is left.
    let long = ViewSpec { per_spectrum: Some(1), min_length: Some(7), ..Default::default() };
    assert_eq!(tags(&long), ["B", "C", "G"]);
    let short = ViewSpec { per_spectrum: Some(1), min_length: Some(0), max_evalue: Some(0.3), spectrum: Some("s1".into()), ..Default::default() };
    assert_eq!(tags(&short), ["C", "G"]);
    // 0 is no rule at all.
    assert_eq!(tags(&ViewSpec { per_spectrum: Some(0), ..Default::default() }).len(), 7);
    std::fs::remove_file(&p).ok();
}

#[test]
fn beyond_the_typed_budget_filters_scan_and_per_spectrum_is_refused() {
    let p = big(2_000);
    let shared = Arc::new(Shared::default());
    shared.typed_max_rows.store(1_000, Ordering::SeqCst);
    let f = ViewSpec { min_length: Some(5), max_evalue: Some(400.0), sort: by("evalue", true), ..Default::default() };
    assert_eq!(view_rows(&shared, &p, &f).unwrap(), oracle(&p, &f));
    let snap = shared.snapshot(&p).unwrap();
    assert!(shared.typed_now(&snap, &Cancel::default()).unwrap().is_none());
    let e = view_rows(&shared, &p, &ViewSpec { per_spectrum: Some(1), ..Default::default() }).unwrap_err();
    assert!(e.contains("per spectrum"), "{e}");
    std::fs::remove_file(&p).ok();
}

// ------------------------------------------- typed columns, orders, pages

#[test]
fn filters_run_on_the_typed_columns_without_another_file_scan() {
    let p = big(20_000);
    let shared = Arc::new(Shared::default());
    let snap = shared.snapshot(&p).unwrap();
    query(&shared, &p, &ViewSpec { sort: by("evalue", false), ..Default::default() }, 0, 10).unwrap();
    assert!(shared.typed_now(&snap, &Cancel::default()).unwrap().is_some());
    let scans = snap.scans.load(Ordering::SeqCst);
    for (k, needle) in ["scan=1", "scan=2", "scan=33", "SCAN=4", "=5"].into_iter().enumerate() {
        let s = ViewSpec {
            sort: by("evalue", k % 2 == 1),
            spectrum: Some(needle.into()),
            min_length: Some(4),
            max_evalue: Some(500.0),
            fasta_hit: Some(["only", "none", "entrapment", "only", "none"][k].into()),
            per_spectrum: if k == 4 { Some(1) } else { None },
        };
        assert_eq!(view_rows(&shared, &p, &s).unwrap(), oracle(&p, &s), "{s:?}");
    }
    assert_eq!(snap.scans.load(Ordering::SeqCst), scans, "a filter change read the file again");
    std::fs::remove_file(&p).ok();
}

#[test]
fn the_order_of_every_column_is_built_once_and_cached() {
    let p = big(5_000);
    let shared = Arc::new(Shared::default());
    let snap = shared.snapshot(&p).unwrap();
    for c in ["tag", "length", "spectrum", "fasta_hit"] {
        for desc in [false, true, false] {
            let s = ViewSpec { sort: by(c, desc), ..Default::default() };
            assert_eq!(view_rows(&shared, &p, &s).unwrap(), oracle(&p, &s), "{c} {desc}");
            // A filtered view of that column reuses the order too.
            let f = ViewSpec { sort: by(c, desc), min_length: Some(5), ..Default::default() };
            assert_eq!(view_rows(&shared, &p, &f).unwrap(), oracle(&p, &f), "{c} {desc} filtered");
        }
    }
    assert_eq!(snap.orders_built.load(Ordering::SeqCst), 4);
    std::fs::remove_file(&p).ok();
}

#[test]
fn a_page_is_read_in_coalesced_spans() {
    let p = big(3_000);
    let shared = Arc::new(Shared::default());
    let snap = shared.snapshot(&p).unwrap();
    let before = snap.page_reads.load(Ordering::SeqCst);
    let page = query(&shared, &p, &ViewSpec::default(), 100, 500).unwrap();
    assert_eq!(page.rows.len(), 500);
    assert_eq!(snap.page_reads.load(Ordering::SeqCst) - before, 1, "500 contiguous rows took more than one read");
    // A sorted window: its rows sorted by offset, contiguous ones merged,
    // mapped back to view order.
    let s = ViewSpec { sort: by("tag", false), ..Default::default() };
    let before = snap.page_reads.load(Ordering::SeqCst);
    let page = query(&shared, &p, &s, 0, 400).unwrap();
    let reads = snap.page_reads.load(Ordering::SeqCst) - before;
    assert!(reads < 400, "{reads} reads for 400 rows");
    let lines: Vec<String> = std::fs::read_to_string(&p).unwrap().lines().skip(1).map(str::to_string).collect();
    for (k, id) in page.row_ids.iter().enumerate() {
        assert_eq!(page.rows[k].join("\t"), lines[*id as usize]);
    }
    std::fs::remove_file(&p).ok();
}

#[test]
fn a_cancelled_typed_build_stops() {
    let p = big(1_000);
    let shared = Arc::new(Shared::default());
    let snap = shared.snapshot(&p).unwrap();
    let t = Cancel::default();
    t.cancel();
    assert_eq!(shared.typed_now(&snap, &t).err().as_deref(), Some(CANCELLED));
    // Nothing half-built was kept: the next call builds it.
    assert!(shared.typed_now(&snap, &Cancel::default()).unwrap().is_some());
    std::fs::remove_file(&p).ok();
}

#[test]
fn opening_a_file_builds_its_typed_columns_in_the_background() {
    let p = big(2_000);
    let shared = Arc::new(Shared::default());
    let got: Arc<Mutex<Vec<BrowserEvent>>> = Arc::default();
    let g = got.clone();
    open(&shared, &p, Arc::new(move |e| g.lock().unwrap().push(e))).unwrap();
    let until = Instant::now() + Duration::from_secs(10);
    loop {
        let typed = shared.fresh_any(&p).is_some_and(|s| s.typed.lock().unwrap().is_some());
        if typed {
            break;
        }
        assert!(Instant::now() < until, "no typed columns after the open: {:?}", got.lock().unwrap());
        std::thread::sleep(Duration::from_millis(5));
    }
    std::fs::remove_file(&p).ok();
}

#[test]
fn a_filtered_evalue_view_is_served_in_file_order_while_ranking() {
    let p = big(400);
    let shared = Arc::new(Shared::default());
    let snap = shared.snapshot(&p).unwrap();
    let token = Cancel::default();
    *snap.rank.lock().unwrap() = RankSlot::Building(token.clone());
    let (emit, _got) = {
        let got: Arc<Mutex<Vec<BrowserEvent>>> = Arc::default();
        let g = got.clone();
        (Arc::new(move |e| g.lock().unwrap().push(e)) as Emit, got)
    };
    *shared.open.lock().unwrap() = Some(OpenState { path: p.clone(), generation: 1, emit, index: Cancel::default() });
    let s = ViewSpec { sort: by("evalue", false), min_length: Some(7), ..Default::default() };
    let r = query_mode(&shared, &p, &s, 0, 1000, Mode::Interactive).unwrap();
    assert!(!r.ranked && r.pending);
    let file_order = oracle(&p, &ViewSpec { min_length: Some(7), ..Default::default() });
    assert_eq!(r.row_ids, file_order);
    assert!(!token.is_cancelled());
    // Exact (export) never gets file order.
    assert_eq!(view_rows(&shared, &p, &s).unwrap(), oracle(&p, &s));
    std::fs::remove_file(&p).ok();
}

// ----------------------------------------------------------------- export

#[test]
fn csv_quotes_by_rfc_4180() {
    let p = temp(
        "csv.tsv",
        "spectrum\ttag\tnote\nscan=1, frame=2\tAB\tsay \"hi\"\nplain\ta\rb\t\n\u{e9}\t\"\t,\n".as_bytes(),
    );
    let shared = Arc::new(Shared::default());
    let dest = format!("{p}.csv");
    let cols: Vec<String> = ["spectrum", "tag", "note"].iter().map(|s| s.to_string()).collect();
    let n = export_to(&shared, &p, &ViewSpec::default(), &cols, &dest, ExportFormat::Csv, &Cancel::default(), &|_, _| {}).unwrap();
    assert_eq!(n, 3);
    assert_eq!(
        std::fs::read_to_string(&dest).unwrap(),
        "spectrum,tag,note\r\n\"scan=1, frame=2\",AB,\"say \"\"hi\"\"\"\r\nplain,\"a\rb\",\r\n\u{e9},\"\"\"\",\",\"\r\n"
    );
    std::fs::remove_file(&p).ok();
    std::fs::remove_file(&dest).ok();
}

#[test]
fn an_unsorted_export_of_a_clean_file_is_a_byte_copy() {
    let p = big(50_000);
    let shared = Arc::new(Shared::default());
    let cols: Vec<String> = HEADER.split('\t').map(str::to_string).collect();
    for typed in [false, true] {
        if typed {
            let snap = shared.snapshot(&p).unwrap();
            shared.typed_now(&snap, &Cancel::default()).unwrap();
        }
        let dest = format!("{p}.{typed}.out");
        let n = export_to(&shared, &p, &ViewSpec::default(), &cols, &dest, ExportFormat::Tsv, &Cancel::default(), &|_, _| {}).unwrap();
        assert_eq!(n, 50_000);
        assert_eq!(std::fs::read(&dest).unwrap(), std::fs::read(&p).unwrap());
        // With the typed columns the file is known clean: one byte range.
        assert_eq!(shared.snapshot(&p).unwrap().byte_copies.load(Ordering::SeqCst), typed as usize);
        std::fs::remove_file(&dest).ok();
    }
    std::fs::remove_file(&p).ok();
}

#[test]
fn an_export_job_reports_progress_and_ends_done() {
    let p = big(300_000);
    let shared = Arc::new(Shared::default());
    let (emit, got) = export_collector();
    let dest = format!("{p}.out");
    let s = ViewSpec { sort: by("evalue", true), fasta_hit: Some("only".into()), ..Default::default() };
    let id = start_export(&shared, &p, &s, &["tag".into(), "evalue".into()], &dest, ExportFormat::Tsv, emit);
    let end = wait_end(&got, id);
    assert_eq!(end, ExportEvent::Done { job_id: id, rows: 150_000, dest: dest.clone() });
    let ev = got.lock().unwrap().clone();
    let progress: Vec<(usize, usize)> =
        ev.iter().filter_map(|e| if let ExportEvent::Progress { done, total, .. } = e { Some((*done, *total)) } else { None }).collect();
    assert!(!progress.is_empty());
    assert!(progress.windows(2).all(|w| w[0].0 <= w[1].0), "{progress:?}");
    assert!(progress.iter().all(|&(d, t)| t == 150_000 && d <= t));
    assert!(matches!(ev.last(), Some(ExportEvent::Done { .. })));
    let (columns, rows) = view_cells(&shared, &p, &s);
    assert_eq!(std::fs::read(&dest).unwrap(), expected_export(&columns, &rows, &["tag".into(), "evalue".into()], false));
    std::fs::remove_file(&p).ok();
    std::fs::remove_file(&dest).ok();
}

#[test]
fn cancelling_an_export_stops_that_job_only_and_leaves_no_file() {
    let p = big(400_000);
    let shared = Arc::new(Shared::default());
    let (emit, got) = export_collector();
    let all: Vec<String> = HEADER.split('\t').map(str::to_string).collect();
    let (a, b) = (format!("{p}.a"), format!("{p}.b"));
    let s = ViewSpec { sort: by("tag", false), ..Default::default() };
    let ja = start_export(&shared, &p, &s, &all, &a, ExportFormat::Csv, emit.clone());
    let jb = start_export(&shared, &p, &ViewSpec::default(), &all, &b, ExportFormat::Tsv, emit);
    // Job ids are the generation: each new job's is larger.
    assert!(jb > ja);
    assert!(cancel_export(&shared, ja));
    assert_eq!(wait_end(&got, ja), ExportEvent::Cancelled { job_id: ja });
    assert!(matches!(wait_end(&got, jb), ExportEvent::Done { rows: 400_000, .. }));
    assert!(!std::path::Path::new(&a).exists());
    assert!(!std::path::Path::new(&format!("{a}.part")).exists());
    assert_eq!(std::fs::read(&b).unwrap(), std::fs::read(&p).unwrap());
    // Every event carries its own job's id; a finished job cannot be cancelled.
    assert!(got.lock().unwrap().iter().all(|e| e.job_id() == ja || e.job_id() == jb));
    assert!(!cancel_export(&shared, jb));
    assert!(!cancel_export(&shared, 9_999));
    std::fs::remove_file(&p).ok();
    std::fs::remove_file(&b).ok();
}

#[test]
fn page_reads_view_changes_and_opens_never_cancel_an_export() {
    let p = big(300_000);
    let shared = Arc::new(Shared::default());
    let (emit, got) = export_collector();
    let (bemit, _) = {
        let got: Arc<Mutex<Vec<BrowserEvent>>> = Arc::default();
        let g = got.clone();
        (Arc::new(move |e| g.lock().unwrap().push(e)) as Emit, got)
    };
    open(&shared, &p, bemit.clone()).unwrap();
    let dest = format!("{p}.out");
    let s = ViewSpec { sort: by("length", false), min_length: Some(4), ..Default::default() };
    let id = start_export(&shared, &p, &s, &["spectrum".into(), "length".into()], &dest, ExportFormat::Tsv, emit);
    // The table goes on: pages of the open view, other view specs (each
    // cancels the previous view build), and the same file opened again.
    for k in 0..30u32 {
        let v = ViewSpec { min_length: Some(3 + k % 4), sort: by("evalue", k % 2 == 0), ..Default::default() };
        let _ = query_mode(&shared, &p, &v, (k as usize) * 7, 50, Mode::Interactive);
        if k % 10 == 0 {
            open(&shared, &p, bemit.clone()).unwrap();
        }
    }
    assert!(matches!(wait_end(&got, id), ExportEvent::Done { .. }), "{:?}", got.lock().unwrap());
    let (columns, rows) = view_cells(&shared, &p, &s);
    assert_eq!(std::fs::read(&dest).unwrap(), expected_export(&columns, &rows, &["spectrum".into(), "length".into()], false));
    std::fs::remove_file(&p).ok();
    std::fs::remove_file(&dest).ok();
}

#[test]
fn a_failed_export_job_says_why_and_keeps_the_source() {
    let p = big(10);
    let shared = Arc::new(Shared::default());
    let (emit, got) = export_collector();
    let id = start_export(&shared, &p, &ViewSpec::default(), &["tag".into()], &p, ExportFormat::Tsv, emit.clone());
    match wait_end(&got, id) {
        ExportEvent::Failed { message, .. } => assert!(message.contains("choose another name"), "{message}"),
        e => panic!("{e:?}"),
    }
    assert_eq!(std::fs::read_to_string(&p).unwrap().lines().count(), 11);
    let id = start_export(&shared, &p, &ViewSpec::default(), &["nope".into()], &format!("{p}.x"), ExportFormat::Tsv, emit);
    assert!(matches!(wait_end(&got, id), ExportEvent::Failed { .. }));
    std::fs::remove_file(&p).ok();
}

/// The successor of the third assertion of
/// `a_cancelled_rank_build_stops_and_frees_its_slot`, which cancelled
/// v1.11's build_view: that is the oracle now, so the production view
/// builds are cancelled here, on the typed columns and in the scan
/// fallback, and so is the order build of another column.
#[test]
fn a_cancelled_view_build_stops() {
    let p = big(2_000);
    let shared = Arc::new(Shared::default());
    let snap = shared.snapshot(&p).unwrap();
    let t = Cancel::default();
    t.cancel();
    let spec = ViewSpec { min_length: Some(1), sort: by("tag", false), ..Default::default() };
    assert_eq!(shared.view_of(&snap, &spec, Mode::Exact, Some(&t)).err().as_deref(), Some(CANCELLED));
    let res = Resolved::bind(&spec, &snap.index.columns);
    assert_eq!(filter_rows(&p, &snap.index, &res, &t).err().as_deref(), Some(CANCELLED));
    assert_eq!(shared.order_for(&snap, 1, Mode::Exact, &t).err().as_deref(), Some(CANCELLED));
    // Nothing cancelled was cached: the same view builds in full afterwards.
    assert_eq!(view_rows(&shared, &p, &spec).unwrap(), oracle(&p, &spec));
    std::fs::remove_file(&p).ok();
}
