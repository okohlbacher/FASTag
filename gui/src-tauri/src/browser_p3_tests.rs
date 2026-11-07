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
    // Exact: the Spectrum tab's one-spectrum lookup ("scan=1" is then not
    // "scan=10 frame=3" nor "SCAN=1").
    (sort, needle, any::<bool>(), min_length, max_evalue, hit, per).prop_map(|(sort, s, spectrum_exact, min_length, max_evalue, hit, per)| ViewSpec {
        sort,
        spectrum: s.map(str::to_string),
        spectrum_exact,
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

    /// The order builds in rounds: with no budget each round takes 3 key
    /// bytes (the fewest), so long cells, shared prefixes, NUL bytes and
    /// numbers (8 key bytes) take several rounds, through both kinds of
    /// round (every row a slot, or the open rows only). Every view and the
    /// order itself are still the reference's, and the same as with room
    /// for one round.
    #[test]
    fn orders_built_in_rounds_equal_the_reference(t in tsv(), specs in prop::collection::vec(spec(), 1..6)) {
        let p = temp("rounds.tsv", &t.body);
        let lean = Arc::new(Shared::default());
        lean.order_budget.store(0, Ordering::SeqCst);
        for s in &specs {
            prop_assert_eq!(&view_rows(&lean, &p, s).unwrap(), &oracle(&p, s), "{:?} on {:?}", s, t);
        }
        let index = build_index(&p, &Cancel::default()).unwrap();
        for c in 0..index.columns.len() {
            let a = build_order(&p, &index, c, 0, &Cancel::default(), &|_, _| {}).unwrap();
            let b = build_order(&p, &index, c, usize::MAX, &Cancel::default(), &|_, _| {}).unwrap();
            prop_assert_eq!(&a.asc[..], &b.asc[..]);
            prop_assert_eq!(a.num_len, b.num_len);
            prop_assert_eq!(&a.run_start, &b.run_start);
            for desc in [false, true] {
                let spec = ViewSpec { sort: by(&index.columns[c], desc), ..Default::default() };
                prop_assert_eq!(view_rows(&lean, &p, &spec).unwrap(), oracle(&p, &spec), "{:?}", spec);
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
            spectrum_exact: false,
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
    // Exact (export) never gets file order: it waits for the build in
    // flight (finished here by its stand-in) and builds no order itself.
    let scans = snap.scans.load(Ordering::Relaxed);
    let worker = finish_rank_after(&shared, &snap, 50);
    assert_eq!(view_rows(&shared, &p, &s).unwrap(), oracle(&p, &s));
    worker.join().unwrap();
    assert!(!token.is_cancelled());
    assert_eq!(snap.scans.load(Ordering::Relaxed), scans, "the export built an order or typed columns again");
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
    let id = start_export(&shared, &p, &s, &["tag".into(), "evalue".into()], &dest, ExportFormat::Tsv, emit).unwrap();
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
    let ja = start_export(&shared, &p, &s, &all, &a, ExportFormat::Csv, emit.clone()).unwrap();
    let jb = start_export(&shared, &p, &ViewSpec::default(), &all, &b, ExportFormat::Tsv, emit).unwrap();
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
    let id = start_export(&shared, &p, &s, &["spectrum".into(), "length".into()], &dest, ExportFormat::Tsv, emit).unwrap();
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
    let id = start_export(&shared, &p, &ViewSpec::default(), &["tag".into()], &p, ExportFormat::Tsv, emit.clone()).unwrap();
    match wait_end(&got, id) {
        ExportEvent::Failed { message, .. } => assert!(message.contains("choose another name"), "{message}"),
        e => panic!("{e:?}"),
    }
    assert_eq!(std::fs::read_to_string(&p).unwrap().lines().count(), 11);
    let id = start_export(&shared, &p, &ViewSpec::default(), &["nope".into()], &format!("{p}.x"), ExportFormat::Tsv, emit).unwrap();
    assert!(matches!(wait_end(&got, id), ExportEvent::Failed { .. }));
    std::fs::remove_file(&p).ok();
}

/// A text sort in rounds on a file large enough for several reading
/// threads: most rows share a long prefix (rounds where every row has a
/// slot), a few differ only at the end (rounds over the open rows only),
/// numbers among them (their own block, 8 key bytes over three rounds).
#[test]
fn a_text_sort_in_rounds_on_many_rows_equals_the_reference() {
    let mut body = String::from("spectrum\ttag\tevalue\n");
    for i in 0..200_000u32 {
        let tag = match i % 10 {
            0..=6 => format!("PEPTIDEPEPTIDEPEPTIDE{}", (i * 7919) % 13),
            7 => format!("PEPTIDEPEPTIDEPEPTIDE{}X{}", i % 3, (i * 31) % 1000),
            8 => format!("{}", (i as u64 * 104_729) % 977),
            _ => "-".to_string(),
        };
        body.push_str(&format!("scan={i}\t{tag}\t{}\n", (i * 7919) % 1000));
    }
    let p = temp("rounds-big.tsv", body.as_bytes());
    let shared = Arc::new(Shared::default());
    shared.order_budget.store(0, Ordering::SeqCst);
    for desc in [false, true] {
        let s = ViewSpec { sort: by("tag", desc), ..Default::default() };
        assert_eq!(view_rows(&shared, &p, &s).unwrap(), oracle(&p, &s), "desc {desc}");
    }
    let index = build_index(&p, &Cancel::default()).unwrap();
    let r = build_order(&p, &index, 1, 0, &Cancel::default(), &|_, _| {}).unwrap();
    assert_eq!(r.num_len, 20_000);
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

// ------------------------------------------- the E-value order in flight

/// A view that needs the E-value order while it is being built shares
/// that build: an Interactive max-E-value cutoff is one scan in file order
/// (D5), the per-spectrum rule waits for the order in flight and a newer
/// view stops that wait; nothing builds a second order or cancels the
/// background one.
#[test]
fn views_during_ranking_never_build_a_second_order() {
    let p = big(400);
    let shared = Arc::new(Shared::default());
    let snap = shared.snapshot(&p).unwrap();
    let background = Cancel::default();
    *snap.rank.lock().unwrap() = RankSlot::Building(background.clone());
    let (emit, _got) = {
        let got: Arc<Mutex<Vec<BrowserEvent>>> = Arc::default();
        let g = got.clone();
        (Arc::new(move |e| g.lock().unwrap().push(e)) as Emit, got)
    };
    *shared.open.lock().unwrap() = Some(OpenState { path: p.clone(), generation: 1, emit, index: Cancel::default() });
    // The order by length first (one scan of its own), then the cutoff on it.
    query_mode(&shared, &p, &ViewSpec { sort: by("length", false), ..Default::default() }, 0, 10, Mode::Interactive).unwrap();
    for sort in [None, by("length", false), by("evalue", false)] {
        let s = ViewSpec { sort: sort.clone(), max_evalue: Some(100.0), ..Default::default() };
        let scans = snap.scans.load(Ordering::Relaxed);
        let r = query_mode(&shared, &p, &s, 0, 1000, Mode::Interactive).unwrap();
        assert!(snap.scans.load(Ordering::Relaxed) <= scans + 1, "{s:?}: more than one scan");
        assert!(!background.is_cancelled(), "{s:?} cancelled the background order");
        assert!(snap.rank_ready().is_none(), "{s:?} built the E-value order itself");
        if sort.as_ref().is_some_and(|x| x.column == "evalue") {
            // In file order until the order is ready.
            assert!(!r.ranked && r.pending);
            assert_eq!(r.row_ids, oracle(&p, &ViewSpec { max_evalue: Some(100.0), ..Default::default() }));
        } else {
            assert!(r.ranked);
            assert_eq!(r.row_ids, oracle(&p, &s));
        }
    }
    // The per-spectrum rule waits for the order in flight; a newer view
    // ends that wait at once.
    let best = ViewSpec { per_spectrum: Some(1), ..Default::default() };
    let scans = snap.scans.load(Ordering::Relaxed);
    let waiting = {
        let (s, p, b) = (shared.clone(), p.clone(), best.clone());
        std::thread::spawn(move || query_mode(&s, &p, &b, 0, 1000, Mode::Interactive))
    };
    std::thread::sleep(Duration::from_millis(100));
    assert!(!waiting.is_finished(), "the per-spectrum view did not wait for the order");
    let t0 = Instant::now();
    shared.view_token(&p, &ViewSpec { min_length: Some(5), ..Default::default() });
    assert_eq!(waiting.join().unwrap().err().as_deref(), Some(CANCELLED));
    assert!(t0.elapsed() < Duration::from_secs(1), "the wait outlived its view by {:?}", t0.elapsed());
    assert!(!background.is_cancelled());
    // Asked again, it is served from the background order once that is done.
    let worker = finish_rank_after(&shared, &snap, 50);
    let r = query_mode(&shared, &p, &best, 0, 1000, Mode::Interactive).unwrap();
    worker.join().unwrap();
    assert!(r.ranked && !r.pending);
    assert_eq!(r.row_ids, oracle(&p, &best));
    // One scan: the typed columns (no view before needed them); no order.
    assert_eq!(snap.scans.load(Ordering::Relaxed), scans + 1, "the per-spectrum view built an order of its own");
    assert!(snap.typed.lock().unwrap().is_some());
    std::fs::remove_file(&p).ok();
}

/// An export that needs the E-value order while it is being built waits
/// for it on its own token: Cancel export ends it at once.
#[test]
fn an_export_waiting_for_the_order_is_cancelled_promptly() {
    let p = big(400);
    let shared = Arc::new(Shared::default());
    let snap = shared.snapshot(&p).unwrap();
    let background = Cancel::default();
    *snap.rank.lock().unwrap() = RankSlot::Building(background.clone());
    let (emit, got) = export_collector();
    let dest = format!("{p}.out");
    for s in [
        ViewSpec { sort: by("evalue", false), ..Default::default() },
        ViewSpec { max_evalue: Some(10.0), ..Default::default() },
        ViewSpec { per_spectrum: Some(1), ..Default::default() },
    ] {
        let id = start_export(&shared, &p, &s, &["tag".into()], &dest, ExportFormat::Tsv, emit.clone()).unwrap();
        std::thread::sleep(Duration::from_millis(80));
        assert!(got.lock().unwrap().iter().all(|e| !(e.job_id() == id && e.is_terminal())), "{s:?} did not wait");
        let t0 = Instant::now();
        assert!(cancel_export(&shared, id));
        assert_eq!(wait_end(&got, id), ExportEvent::Cancelled { job_id: id });
        assert!(t0.elapsed() < Duration::from_secs(1), "{s:?}: cancel took {:?}", t0.elapsed());
        assert!(!background.is_cancelled());
        assert!(!std::path::Path::new(&dest).exists());
    }
    assert!(leftover_parts(&dest).is_empty());
    std::fs::remove_file(&p).ok();
}

/// The temporary files an export to @p dest left beside it.
fn leftover_parts(dest: &str) -> Vec<String> {
    let d = std::path::Path::new(dest);
    let name = d.file_name().unwrap().to_string_lossy().into_owned();
    std::fs::read_dir(d.parent().unwrap())
        .unwrap()
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|f| f.starts_with(&format!("{name}.")) && f.ends_with(".part"))
        .collect()
}

/// A second export to the name of one still running is refused (the two
/// would write one file); once the first is done the name is free again.
#[test]
fn a_second_export_to_a_running_exports_name_is_refused() {
    let p = big(400);
    let shared = Arc::new(Shared::default());
    let snap = shared.snapshot(&p).unwrap();
    // Held: the job waits for an order that is not ready.
    *snap.rank.lock().unwrap() = RankSlot::Building(Cancel::default());
    let (emit, got) = export_collector();
    let dest = format!("{p}.out");
    let s = ViewSpec { sort: by("evalue", false), ..Default::default() };
    let first = start_export(&shared, &p, &s, &["tag".into()], &dest, ExportFormat::Tsv, emit.clone()).unwrap();
    // The same name, also spelled through its folder's other path.
    let again = format!("{}/./{}", std::path::Path::new(&dest).parent().unwrap().display(), std::path::Path::new(&dest).file_name().unwrap().to_string_lossy());
    for d in [&dest, &again] {
        let e = start_export(&shared, &p, &ViewSpec::default(), &["tag".into()], d, ExportFormat::Tsv, emit.clone()).unwrap_err();
        assert!(e.contains("still running"), "{e}");
    }
    // Another name is not held up.
    let other = format!("{p}.other");
    let o = start_export(&shared, &p, &ViewSpec::default(), &["tag".into()], &other, ExportFormat::Tsv, emit.clone()).unwrap();
    assert!(matches!(wait_end(&got, o), ExportEvent::Done { rows: 400, .. }));
    let worker = finish_rank_after(&shared, &snap, 10);
    assert!(matches!(wait_end(&got, first), ExportEvent::Done { rows: 400, .. }));
    worker.join().unwrap();
    let next = start_export(&shared, &p, &ViewSpec::default(), &["tag".into()], &dest, ExportFormat::Tsv, emit).unwrap();
    assert!(matches!(wait_end(&got, next), ExportEvent::Done { rows: 400, .. }));
    assert!(leftover_parts(&dest).is_empty());
    for f in [&p, &dest, &other] {
        std::fs::remove_file(f).ok();
    }
}

// ------------------------------------------------------ memory per file

/// Sorting by every column in both directions, and unrestricted filters
/// on each, keeps the cached views and orders within the budget: no
/// descending order is stored, older entries go first, and every view is
/// still the reference's.
#[test]
fn every_sort_and_unrestricted_filter_stay_within_the_cache_budget() {
    let n = 20_000u32;
    let p = big(n);
    let shared = Arc::new(Shared::default());
    let snap = shared.snapshot(&p).unwrap();
    let order = n as usize * 4 + (n as usize).div_ceil(64) * 8;
    // Room for two orders, or one order and one full view.
    snap.cache_budget.store(2 * order + 1024, Ordering::SeqCst);
    for column in ["tag", "spectrum", "length", "fasta_hit", "evalue", "charge"] {
        for desc in [false, true] {
            for filters in [
                ViewSpec::default(),
                ViewSpec { min_length: Some(3), max_evalue: Some(1000.0), spectrum: Some("scan".into()), ..Default::default() },
                ViewSpec { min_length: Some(6), ..Default::default() },
            ] {
                let s = ViewSpec { sort: by(column, desc), ..filters };
                assert_eq!(view_rows(&shared, &p, &s).unwrap(), oracle(&p, &s), "{s:?}");
                assert!(snap.cache_bytes() <= 2 * order + 1024, "{s:?}: {} cached bytes", snap.cache_bytes());
            }
        }
    }
    // The newest order stays: a page read of it does not rebuild it.
    let built = snap.orders_built.load(Ordering::SeqCst);
    view_rows(&shared, &p, &ViewSpec { sort: by("charge", true), ..Default::default() }).unwrap();
    assert_eq!(snap.orders_built.load(Ordering::SeqCst), built);
    std::fs::remove_file(&p).ok();
}

// ------------------------------------------- metamorphic, on the backend

proptest! {
    #![proptest_config(ProptestConfig { cases: 120, ..ProptestConfig::default() })]

    /// Through the real query path: a tighter E-value cutoff or a smaller
    /// N per spectrum keeps a subset of the rows, in the same order; and
    /// two filters together are the first one's view less the rows the
    /// second one drops, whichever way round (filters commute).
    #[test]
    fn tighter_filters_keep_subsets_and_filters_commute(t in tsv(), a in spec(), b in spec(), cut in prop::sample::select(vec![0.0, 1e-5, 0.003, 7.0, 1e308, f64::INFINITY]), n in 1u32..4) {
        let p = temp("meta.tsv", &t.body);
        let shared = Arc::new(Shared::default());
        let rows = |s: &ViewSpec| view_rows(&shared, &p, s).unwrap();
        let subseq = |small: &[u32], big: &[u32]| -> bool {
            let mut it = big.iter();
            small.iter().all(|x| it.any(|y| y == x))
        };
        // Cutoffs: `cut` and every tighter one of a's. One exception, found
        // by this test and shared by v1.11's rule and e2eBridge's viewIds: a
        // cell reading -inf (`-1e999`, `-inf`) passes every cutoff, but the
        // E-value order puts it with the text cells, after every number; so
        // with the per-spectrum rule a looser cutoff can let numbers in
        // ahead of it and push it out. FASTag never writes such a cell.
        let neg_inf = !oracle(&p, &ViewSpec { max_evalue: Some(f64::NEG_INFINITY), ..Default::default() }).is_empty();
        let ranked_rule = a.per_spectrum.is_some_and(|k| k > 0);
        let loose = ViewSpec { max_evalue: Some(cut), ..a.clone() };
        for tight in [0.0, 1e-5, 0.003, 7.0, 1e308].into_iter().filter(|&x| x <= cut && !(neg_inf && ranked_rule)) {
            let s = ViewSpec { max_evalue: Some(tight), ..a.clone() };
            prop_assert!(subseq(&rows(&s), &rows(&loose)), "max E {} added rows to {}", tight, cut);
        }
        // Per spectrum: best N within best N+1 within every tag.
        let few = ViewSpec { per_spectrum: Some(n), ..a.clone() };
        let more = ViewSpec { per_spectrum: Some(n + 1), ..a.clone() };
        let all = ViewSpec { per_spectrum: None, ..a.clone() };
        prop_assert!(subseq(&rows(&few), &rows(&more)));
        prop_assert!(subseq(&rows(&more), &rows(&all)));
        // Commute: a's filters with b's (but b's per-spectrum rule, which
        // ranks among what the other filters keep, so it is no plain filter).
        let both = ViewSpec {
            sort: a.sort.clone(),
            spectrum: b.spectrum.clone().or(a.spectrum.clone()),
            min_length: b.min_length.or(a.min_length),
            max_evalue: b.max_evalue.or(a.max_evalue),
            fasta_hit: b.fasta_hit.clone().or(a.fasta_hit.clone()),
            per_spectrum: None,
            spectrum_exact: if b.spectrum.is_some() { b.spectrum_exact } else { a.spectrum_exact },
        };
        let only_a = ViewSpec { per_spectrum: None, ..a.clone() };
        let b_alone = ViewSpec { sort: a.sort.clone(), per_spectrum: None, ..b.clone() };
        // Only where b's filters replace none of a's is "both" their conjunction.
        let disjoint = (a.spectrum.is_none() || b.spectrum.is_none())
            && (a.min_length.is_none() || b.min_length.is_none())
            && (a.max_evalue.is_none() || b.max_evalue.is_none())
            && (a.fasta_hit.is_none() || b.fasta_hit.is_none());
        if disjoint {
            let (va, vb, vboth) = (rows(&only_a), rows(&b_alone), rows(&both));
            let in_b: std::collections::HashSet<u32> = vb.iter().copied().collect();
            let in_a: std::collections::HashSet<u32> = va.iter().copied().collect();
            prop_assert_eq!(&vboth, &va.iter().copied().filter(|r| in_b.contains(r)).collect::<Vec<_>>());
            prop_assert_eq!(&vboth, &vb.iter().copied().filter(|r| in_a.contains(r)).collect::<Vec<_>>());
        }
        std::fs::remove_file(&p).ok();
    }
}

// ------------------------------------------ the E. coli fixture, golden

const ECOLI: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../e2e-web/fixtures/ecoli.tags.tsv");
const ECOLI_VIEWS: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../e2e-web/fixtures/ecoli.views.json");

/// The best-tag export of the fixture has exactly one row per tagged
/// spectrum, and that row has its spectrum's smallest E-value.
#[test]
fn the_best_tag_export_of_the_fixture_has_one_row_per_spectrum() {
    let shared = Arc::new(Shared::default());
    let src = std::fs::read_to_string(ECOLI).unwrap();
    let mut lines = src.lines();
    let head: Vec<&str> = lines.next().unwrap().split('\t').collect();
    let (sp, ev) = (head.iter().position(|c| *c == "spectrum").unwrap(), head.iter().position(|c| *c == "evalue").unwrap());
    let mut best: HashMap<String, f64> = HashMap::new();
    for l in lines.filter(|l| !l.is_empty()) {
        let c: Vec<&str> = l.split('\t').collect();
        let e: f64 = c[ev].parse().unwrap();
        let b = best.entry(c[sp].to_string()).or_insert(f64::INFINITY);
        *b = b.min(e);
    }
    let dest = temp("best.tsv", b"");
    let columns: Vec<String> = head.iter().map(|c| c.to_string()).collect();
    for sort in [None, by("evalue", false), by("tag", true)] {
        let s = ViewSpec { per_spectrum: Some(1), sort, ..Default::default() };
        let n = export_to(&shared, ECOLI, &s, &columns, &dest, ExportFormat::Tsv, &Cancel::default(), &|_, _| {}).unwrap();
        let out = std::fs::read_to_string(&dest).unwrap();
        let rows: Vec<Vec<&str>> = out.lines().skip(1).map(|l| l.split('\t').collect()).collect();
        assert_eq!(n, best.len());
        assert_eq!(rows.len(), best.len(), "one row per tagged spectrum");
        let spectra: std::collections::HashSet<&str> = rows.iter().map(|r| r[sp]).collect();
        assert_eq!(spectra.len(), best.len(), "a spectrum appears twice");
        for r in &rows {
            assert_eq!(r[ev].parse::<f64>().unwrap(), best[r[sp]], "not the best tag of {}", r[sp]);
        }
    }
    std::fs::remove_file(&dest).ok();
}

/// The views the e2e `view` fixture serves from e2eBridge.ts's viewIds
/// are the backend's: this test holds the backend's views of the E. coli
/// fixture for a fixed set of specs to ecoli.views.json (FASTAG_GOLDEN=write
/// rewrites it), and e2eBridge.test.ts holds viewIds to the same file.
#[test]
fn the_backend_views_of_the_fixture_match_the_golden() {
    use serde_json::{json, Value};
    let sort = |c: &str, d: bool| json!({ "column": c, "desc": d });
    let specs: Vec<Value> = vec![
        json!({ "sort": sort("tag", false) }),
        json!({ "sort": sort("tag", true) }),
        json!({ "sort": sort("spectrum", false) }),
        json!({ "sort": sort("spectrum", true) }),
        json!({ "sort": sort("evalue", false) }),
        json!({ "sort": sort("evalue", true) }),
        json!({ "sort": sort("mean_conf", true) }),
        json!({ "sort": sort("nterm_mass", false) }),
        json!({ "maxEvalue": 1.0 }),
        json!({ "maxEvalue": 0.01, "sort": sort("evalue", false) }),
        json!({ "maxEvalue": 1e-5 }),
        json!({ "spectrum": "scan=11" }),
        json!({ "spectrum": "SCAN=1", "sort": sort("tag", false) }),
        json!({ "minLength": 3 }),
        json!({ "minLength": 4 }),
        json!({ "fastaHit": "only" }),
        json!({ "fastaHit": "none" }),
        json!({ "fastaHit": "entrapment" }),
        json!({ "perSpectrum": 1 }),
        json!({ "perSpectrum": 2, "sort": sort("evalue", true) }),
        json!({ "perSpectrum": 1, "maxEvalue": 1.0, "sort": sort("tag", false) }),
        json!({ "spectrum": "scan=115", "perSpectrum": 3, "sort": sort("tag", true) }),
        json!({ "minLength": 3, "fastaHit": "none", "spectrum": "SCAN=11", "perSpectrum": 2, "maxEvalue": 50.0 }),
        // The Spectrum tab's lookups: one spectrum exactly (case-sensitive).
        json!({ "spectrum": "controllerType=0 controllerNumber=1 scan=11461", "spectrumExact": true, "sort": sort("evalue", false) }),
        json!({ "spectrum": "controllerType=0 controllerNumber=1 scan=11461", "spectrumExact": true, "perSpectrum": 1 }),
        json!({ "spectrum": "CONTROLLERTYPE=0 CONTROLLERNUMBER=1 SCAN=11461", "spectrumExact": true }),
        json!({ "spectrum": "scan=11461", "spectrumExact": true }),
    ];
    let shared = Arc::new(Shared::default());
    let mut got = Vec::new();
    for v in &specs {
        let spec: ViewSpec = serde_json::from_value(v.clone()).unwrap();
        got.push(json!({ "view": v, "ids": view_rows(&shared, ECOLI, &spec).unwrap() }));
    }
    // One spec per line: a change reads as a diff of the views it moved.
    let text = format!("[\n{}\n]\n", got.iter().map(|g| serde_json::to_string(g).unwrap()).collect::<Vec<_>>().join(",\n"));
    if std::env::var("FASTAG_GOLDEN").as_deref() == Ok("write") {
        std::fs::write(ECOLI_VIEWS, &text).unwrap();
    }
    let want = std::fs::read_to_string(ECOLI_VIEWS).expect("ecoli.views.json: run with FASTAG_GOLDEN=write once");
    assert!(want == text, "the backend's views of the fixture changed; check them, then rewrite ecoli.views.json with FASTAG_GOLDEN=write");
}

// ------------------------------------------------- views kept as bits

/// A view that keeps most rows is held as one bit per position of its
/// order (n/8 bytes, not 4 B per row); its pages, its export and the
/// position of every row are the reference's, in every direction, and a
/// narrow view stays a row list.
#[test]
fn broad_views_are_bits_over_their_order_and_read_back_exactly() {
    let n = 30_000u32;
    let p = big(n);
    let shared = Arc::new(Shared::default());
    let snap = shared.snapshot(&p).unwrap();
    let all: Vec<String> = HEADER.split('\t').map(str::to_string).collect();
    let dest = format!("{p}.out");
    for sort in [None, by("tag", false), by("tag", true), by("evalue", false), by("evalue", true), by("spectrum", true)] {
        for (broad, f) in [
            (true, ViewSpec { min_length: Some(4), ..Default::default() }),
            (true, ViewSpec { max_evalue: Some(900.0), fasta_hit: Some("none".into()), ..Default::default() }),
            (false, ViewSpec { spectrum: Some("scan=777".into()), ..Default::default() }),
        ] {
            let s = ViewSpec { sort: sort.clone(), ..f };
            let want = oracle(&p, &s);
            assert_eq!(view_rows(&shared, &p, &s).unwrap(), want, "{s:?}");
            let v = snap.cached_view(&s).expect("cached");
            assert_eq!(matches!(v, ViewRows::Masked(_)), broad, "{s:?}");
            if broad {
                assert!(v.bytes() <= n as usize / 8 + 64, "{s:?}: {} bytes", v.bytes());
            }
            // Windows that start and end anywhere.
            for (a, l) in [(0, 1), (1, 63), (63, 2), (64, 64), (4095, 4099), (want.len() - 1, 5), (want.len(), 3)] {
                let a = a.min(want.len());
                assert_eq!(v.window(a, l), want[a..(a + l).min(want.len())], "{s:?} {a}+{l}");
            }
            for row in (0..n).step_by(37) {
                assert_eq!(position(&shared, &p, &s, row).unwrap(), want.iter().position(|&r| r == row), "{s:?} row {row}");
            }
            export_to(&shared, &p, &s, &all, &dest, ExportFormat::Tsv, &Cancel::default(), &|_, _| {}).unwrap();
            let src = std::fs::read_to_string(&p).unwrap();
            let lines: Vec<&str> = src.lines().skip(1).collect();
            let out = std::fs::read_to_string(&dest).unwrap();
            let got: Vec<&str> = out.lines().skip(1).collect();
            assert_eq!(got, want.iter().map(|&r| lines[r as usize]).collect::<Vec<_>>(), "{s:?}");
        }
    }
    for f in [&p, &dest] {
        std::fs::remove_file(f).ok();
    }
}
