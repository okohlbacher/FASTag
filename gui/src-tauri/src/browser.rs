// Windowed browser over a FASTag tags TSV. A full run is 100k-10M+ rows; the
// frontend virtualizes scrolling and asks for <=1000-row windows of a sorted/
// filtered view, so the whole file never crosses IPC or lives in renderer
// memory. On open, one sequential scan records every line-start offset; a view
// (filter + sort) is one more scan producing a row permutation; a window is a
// handful of exact-length reads at known offsets.
//
// Columns are DRIVEN BY THE HEADER, not a fixed schema: -proforma, for one,
// adds a column. Filters bind by column NAME and are active only when their
// column exists in this file.
//
// D5 (GUI-DESIGN 6.1, P0b first cut): `results_open` answers with the header
// and the first rows from a 1 MB head read, before the row index exists. The
// index and then the E-value order are built on a background thread and
// announced on the open's Channel (Indexed, RankProgress, Ranked). Until the
// order is ready, a query sorted by E-value is served in file order and says
// so (`ranked: false, pending: true`); the renderer swaps the ranked order in
// when Ranked arrives.
//
// Concurrency: every file is one immutable `Snapshot` (index plus lazily
// built orders) behind an `Arc`, in an `RwLock` map. A query clones the Arc
// and releases the map at once, so a page read never waits for a build. Each
// build kind has its own cancel token: opening another file cancels the index
// and rank builds of the old one; a new view spec (filters, another sort)
// cancels the previous view build. Page reads of the same spec cancel
// nothing, so the ranked swap still happens during a scroll fling.

use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{BufReader, BufWriter, Read, Seek, SeekFrom, Write};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock, RwLock};
use std::time::{Instant, SystemTime};

/// IPC bound: a window never exceeds this many rows.
const MAX_WINDOW: usize = 1000;
/// A single displayed row is capped here; a longer (garbage) line is truncated
/// rather than ballooning memory.
const ROW_CAP: usize = 1 << 20;
/// A "header" longer than this is not a tags TSV.
const HEADER_CAP: u64 = 4 << 20;
/// The head read of `results_open`: the first rows come from here, before
/// the index exists.
const HEAD_BYTES: usize = 1 << 20;
/// Snapshots kept (GUI-DESIGN 5: two files).
const MAX_SNAPSHOTS: usize = 2;
/// The column the background order is built for (D5).
pub const RANK_COLUMN: &str = "evalue";

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
    /// `fasta_hit` filter: "only" (a target hit: neither "-" nor an
    /// entrapment-only `efwd`/`erev`), "none" (no target hit, entrapment-only
    /// included), "entrapment" (`efwd`/`erev` only), else inactive.
    pub fasta_hit: Option<String>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ResultsPage {
    pub columns: Vec<String>,
    pub total_rows: usize,
    pub matched_rows: usize,
    pub rows: Vec<Vec<String>>,
    /// The file row (0-based data row) of each of `rows`: the renderer keeps
    /// its active row by this id across the D5 swap.
    pub row_ids: Vec<u32>,
    /// The rows are in the order the view asked for. False only while the
    /// E-value order is still being built: the rows are then in file order.
    pub ranked: bool,
    /// The E-value order is being built; a Ranked event follows.
    pub pending: bool,
}

/// The answer of `results_open`: what a 1 MB head read gives, before the
/// row index exists.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ResultsHead {
    /// Events of this open carry it; the renderer drops any other.
    pub generation: u64,
    pub columns: Vec<String>,
    /// The first rows in file order (at most MAX_WINDOW).
    pub rows: Vec<Vec<String>>,
    /// The head read reached the end of the file: `rows` is every row.
    pub complete: bool,
}

/// Background progress of an open, sent on its Channel.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum BrowserEvent {
    /// The row index exists: every page can be read.
    Indexed { generation: u64, total_rows: usize },
    /// The E-value order: rows scanned so far.
    RankProgress { generation: u64, done: usize, total: usize },
    /// The E-value order is ready; queries sorted by @p column now come back
    /// ranked.
    Ranked { generation: u64, column: String },
    /// The background build failed (not on cancel).
    Failed { generation: u64, message: String },
}

pub type Emit = Arc<dyn Fn(BrowserEvent) + Send + Sync>;

pub(crate) struct Index {
    pub(crate) columns: Vec<String>,
    /// Byte offset of each data-row start; row i spans offsets[i]..offsets[i+1]
    /// (data_end for the last), trailing newline included.
    pub(crate) offsets: Vec<u64>,
    pub(crate) data_end: u64,
}

/// A cancel token. Each build kind (index, rank, view) gets its own.
#[derive(Default, Clone)]
pub struct Cancel(Arc<AtomicBool>);

impl Cancel {
    pub fn cancel(&self) {
        self.0.store(true, Ordering::SeqCst);
    }
    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::Relaxed)
    }
}

const CANCELLED: &str = "cancelled";

/// The E-value order of every row of a file.
pub(crate) struct Rank {
    /// Ascending: the numeric block (by value, ties in file order), then the
    /// unparsable block (by bytes, ties in file order).
    pub(crate) asc: Vec<u32>,
    /// Rows in the numeric block (asc[..num_len]).
    pub(crate) num_len: usize,
    /// Bit i set: asc[i] starts a new run of equal keys (within its block).
    pub(crate) run_start: Vec<u64>,
    /// Descending, derived from asc on first use.
    desc: OnceLock<Vec<u32>>,
}

impl Rank {
    fn starts(&self, i: usize) -> bool {
        self.run_start[i / 64] >> (i % 64) & 1 == 1
    }

    /// Descending order in O(n): each block reversed on its own (numbers
    /// stay above the unparsable cells), and the rows of a run of equal keys
    /// kept in file order, as today's comparator `ord.reverse().then(row)`.
    pub(crate) fn desc(&self) -> &[u32] {
        self.desc.get_or_init(|| {
            let mut out = Vec::with_capacity(self.asc.len());
            for (lo, hi) in [(0, self.num_len), (self.num_len, self.asc.len())] {
                let mut end = hi;
                let mut i = hi;
                while i > lo {
                    i -= 1;
                    if self.starts(i) {
                        out.extend_from_slice(&self.asc[i..end]);
                        end = i;
                    }
                }
            }
            out
        })
    }

    fn order(&self, desc: bool) -> &[u32] {
        if desc {
            self.desc()
        } else {
            &self.asc
        }
    }
}

enum RankSlot {
    None,
    Building(Cancel),
    Ready(Arc<Rank>),
}

/// One file as indexed, with the orders built over it. Immutable but for
/// its lazily filled slots; shared by Arc, never locked across a build.
pub(crate) struct Snapshot {
    path: String,
    len: u64,
    mtime: Option<SystemTime>,
    pub(crate) index: Index,
    rank: Mutex<RankSlot>,
    /// The last built view: (spec, matching rows in order).
    view: Mutex<Option<(ViewSpec, Arc<Vec<u32>>)>>,
}

impl Snapshot {
    fn rank_ready(&self) -> Option<Arc<Rank>> {
        match &*self.rank.lock().unwrap() {
            RankSlot::Ready(r) => Some(r.clone()),
            _ => None,
        }
    }
}

/// The file the renderer has open, and where its events go.
struct OpenState {
    path: String,
    generation: u64,
    emit: Emit,
    /// Cancels this open's index build.
    index: Cancel,
}

#[derive(Default)]
pub struct Shared {
    snaps: RwLock<Vec<Arc<Snapshot>>>,
    /// Index builds one at a time: a query for a file being indexed waits for
    /// that build instead of starting a second scan.
    build: Mutex<()>,
    generation: AtomicU64,
    open: Mutex<Option<OpenState>>,
    /// The view build in flight: (path, spec, token). A query with another
    /// spec cancels it; a page read of the same spec does not.
    view_build: Mutex<Option<(String, ViewSpec, Cancel)>>,
}

#[derive(Default, Clone)]
pub struct BrowserCache(Arc<Shared>);

fn fields_of(raw: &[u8]) -> Vec<String> {
    let mut s = raw;
    while let [rest @ .., b'\n' | b'\r'] = s {
        s = rest;
    }
    s.split(|b| *b == b'\t')
        .map(|f| String::from_utf8_lossy(f).into_owned())
        .collect()
}

/// Field @p col of a raw row as `fields_of(raw)[col]` would give it (missing:
/// empty), without splitting the rest of the row.
fn field_at(raw: &[u8], col: usize) -> &[u8] {
    let mut s = raw;
    while let [rest @ .., b'\n' | b'\r'] = s {
        s = rest;
    }
    s.split(|b| *b == b'\t').nth(col).unwrap_or(b"")
}

pub(crate) fn build_index(path: &str, cancel: &Cancel) -> Result<Index, String> {
    let file = File::open(path).map_err(|e| format!("cannot open {path}: {e}"))?;
    let mut reader = BufReader::with_capacity(1 << 20, file);
    // One pass counting newlines chunk-wise: line content is not needed here,
    // so a multi-GB file costs one buffer, not one allocation per row.
    let mut offsets: Vec<u64> = Vec::new();
    let mut pos: u64 = 0;
    let mut line_start: u64 = 0;
    let mut header_end: Option<u64> = None;
    let mut line_has_content = false; // any byte other than \r and \n
    let mut buf = vec![0u8; 1 << 16];
    loop {
        if cancel.is_cancelled() {
            return Err(CANCELLED.into());
        }
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
    // The cap must hold wherever the header's newline lands: the mid-scan check
    // alone misses a newline inside the chunk that crosses the cap.
    if let Some(end) = header_end {
        if end > HEADER_CAP {
            return Err(format!("{path}: header exceeds {HEADER_CAP} bytes — not a tags TSV"));
        }
    }
    if offsets.len() > u32::MAX as usize {
        return Err(format!("{path} has more than 4,294,967,295 rows, too many for the table viewer"));
    }
    let columns = match header_end {
        None => Vec::new(),
        Some(end) => {
            let mut f = File::open(path).map_err(|e| format!("cannot open {path}: {e}"))?;
            let mut raw = vec![0u8; end as usize];
            f.read_exact(&mut raw).map_err(|e| format!("cannot read {path}: {e}"))?;
            header_columns(&raw)
        }
    };
    Ok(Index { columns, offsets, data_end })
}

/// The header line's columns. A UTF-8 BOM would otherwise rename the first
/// column ("\u{feff}spectrum") and unbind every filter on it.
fn header_columns(raw: &[u8]) -> Vec<String> {
    let raw = raw.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(raw);
    fields_of(raw)
}

/// The header and the first rows of @p path from its first HEAD_BYTES, with
/// the index's rules: a BOM is dropped, blank lines are not rows, a row is
/// only taken whole (its newline inside the head, or the end of the file).
/// (columns, rows, complete) of a head read.
type Head = (Vec<String>, Vec<Vec<String>>, bool);

pub(crate) fn read_head(path: &str, max_rows: usize) -> Result<Head, String> {
    let mut f = File::open(path).map_err(|e| format!("cannot open {path}: {e}"))?;
    let mut buf = Vec::with_capacity(HEAD_BYTES);
    (&mut f)
        .take(HEAD_BYTES as u64 + 1)
        .read_to_end(&mut buf)
        .map_err(|e| format!("cannot read {path}: {e}"))?;
    let eof = buf.len() <= HEAD_BYTES;
    buf.truncate(HEAD_BYTES);
    let mut lines = buf.split_inclusive(|b| *b == b'\n');
    let columns = match lines.next() {
        None => return Ok((Vec::new(), Vec::new(), eof)),
        Some(h) if h.ends_with(b"\n") || eof => header_columns(h),
        // A header longer than the head: let the index report it.
        Some(_) => return Ok((Vec::new(), Vec::new(), false)),
    };
    let mut rows = Vec::new();
    let mut complete = eof;
    for line in lines {
        if !line.ends_with(b"\n") && !eof {
            complete = false;
            break; // cut by the head read
        }
        if !line.iter().any(|b| *b != b'\r' && *b != b'\n') {
            continue;
        }
        if rows.len() == max_rows {
            complete = false;
            break;
        }
        rows.push(fields_of(&line[..line.len().min(ROW_CAP)]));
    }
    Ok((columns, rows, complete))
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
    fasta_hit: Option<(usize, HitFilter)>,
}

#[derive(Clone, Copy, PartialEq)]
enum HitFilter {
    Target,
    NoTarget,
    Entrapment,
}

/// Entrapment-only matches (`efwd`/`erev`) are calibration material, not
/// target hits (README, q_db section).
fn is_entrapment(v: &str) -> bool {
    v == "efwd" || v == "erev"
}

/// A numeric sort key only for finite values: `NAN` (a real tag) and `INF`
/// parse as f64 but are strings here.
fn numeric(cell: &str) -> Option<f64> {
    cell.parse::<f64>().ok().filter(|v| v.is_finite())
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
            min_length: col("length").zip(spec.min_length),
            max_evalue: col("evalue").zip(spec.max_evalue),
            fasta_hit: match spec.fasta_hit.as_deref() {
                Some("only") => col("fasta_hit").map(|i| (i, HitFilter::Target)),
                Some("none") => col("fasta_hit").map(|i| (i, HitFilter::NoTarget)),
                Some("entrapment") => col("fasta_hit").map(|i| (i, HitFilter::Entrapment)),
                _ => None,
            },
        }
    }

    fn has_filters(&self) -> bool {
        self.spectrum.is_some() || self.min_length.is_some() || self.max_evalue.is_some() || self.fasta_hit.is_some()
    }

    fn is_trivial(&self) -> bool {
        self.sort.is_none() && !self.has_filters()
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
        if let Some((i, want)) = self.fasta_hit {
            let v = get(i);
            let ok = match want {
                HitFilter::Target => v != "-" && !is_entrapment(v),
                HitFilter::NoTarget => v == "-" || is_entrapment(v),
                HitFilter::Entrapment => is_entrapment(v),
            };
            if !ok {
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

/// Today's view (v1.11): one scan that filters, keys and sorts. It still
/// serves every view the E-value order does not cover, and is the oracle the
/// rank tests compare against.
fn build_view(path: &str, index: &Index, res: &Resolved, cancel: &Cancel) -> Result<Vec<u32>, String> {
    let file = File::open(path).map_err(|e| format!("cannot open {path}: {e}"))?;
    let mut reader = BufReader::with_capacity(1 << 20, file);
    reader
        .seek(SeekFrom::Start(index.offsets.first().copied().unwrap_or(index.data_end)))
        .map_err(|e| e.to_string())?;
    let mut matched: Vec<u32> = Vec::new();
    let mut keys: Vec<Key> = Vec::new();
    let mut raw: Vec<u8> = Vec::new();
    for i in 0..index.offsets.len() {
        if i % 65536 == 0 && cancel.is_cancelled() {
            return Err(CANCELLED.into());
        }
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
            keys.push(match numeric(cell) {
                Some(v) => Key::Num(v),
                None => Key::Str(cell.as_bytes().to_vec()),
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

/// The rows matching @p res's filters, in file order (no sort).
fn filter_rows(path: &str, index: &Index, res: &Resolved, cancel: &Cancel) -> Result<Vec<bool>, String> {
    let file = File::open(path).map_err(|e| format!("cannot open {path}: {e}"))?;
    let mut reader = BufReader::with_capacity(1 << 20, file);
    reader
        .seek(SeekFrom::Start(index.offsets.first().copied().unwrap_or(index.data_end)))
        .map_err(|e| e.to_string())?;
    let mut keep = vec![false; index.offsets.len()];
    let mut raw: Vec<u8> = Vec::new();
    for (i, k) in keep.iter_mut().enumerate() {
        if i % 65536 == 0 && cancel.is_cancelled() {
            return Err(CANCELLED.into());
        }
        let (start, len) = row_span(index, i);
        let full = (index.offsets.get(i + 1).copied().unwrap_or(index.data_end) - start) as usize;
        raw.resize(len, 0);
        reader.read_exact(&mut raw).map_err(|e| format!("cannot read {path}: {e}"))?;
        if full > len {
            reader.seek_relative((full - len) as i64).map_err(|e| e.to_string())?;
        }
        *k = res.matches(&fields_of(&raw));
    }
    Ok(keep)
}

/// f64 -> u64 with the order of `f64::total_cmp` (core's own transform).
fn total_key(v: f64) -> u64 {
    let mut b = v.to_bits() as i64;
    b ^= (((b >> 63) as u64) >> 1) as i64;
    (b as u64) ^ (1 << 63)
}

/// Build the order of @p index's rows by column @p column, exactly as
/// build_view sorts it ascending: finite numbers by value (total_cmp), then
/// every other cell ('-', NAN, INF, anything the parser rejects) by its bytes;
/// ties in file order. Reads only that column. @p progress gets (rows read,
/// rows) now and then.
pub(crate) fn build_rank(
    path: &str,
    index: &Index,
    column: usize,
    cancel: &Cancel,
    progress: &dyn Fn(usize, usize),
) -> Result<Rank, String> {
    let n = index.offsets.len();
    let file = File::open(path).map_err(|e| format!("cannot open {path}: {e}"))?;
    let mut reader = BufReader::with_capacity(8 << 20, file);
    reader
        .seek(SeekFrom::Start(index.offsets.first().copied().unwrap_or(index.data_end)))
        .map_err(|e| e.to_string())?;
    let mut nums: Vec<(u64, u32)> = Vec::with_capacity(n);
    // Unparsable cells: their bytes in one arena, (start, len, row).
    let mut arena: Vec<u8> = Vec::new();
    let mut strs: Vec<(u32, u32, u32)> = Vec::new();
    let mut raw: Vec<u8> = Vec::new();
    let step = (n / 100).max(65536);
    let mut last = Instant::now();
    for i in 0..n {
        if i % step == 0 && i > 0 {
            if cancel.is_cancelled() {
                return Err(CANCELLED.into());
            }
            if last.elapsed().as_millis() >= 100 {
                progress(i, n);
                last = Instant::now();
            }
        }
        let (start, len) = row_span(index, i);
        let full = (index.offsets.get(i + 1).copied().unwrap_or(index.data_end) - start) as usize;
        raw.resize(len, 0);
        reader.read_exact(&mut raw).map_err(|e| format!("cannot read {path}: {e}"))?;
        if full > len {
            reader.seek_relative((full - len) as i64).map_err(|e| e.to_string())?;
        }
        let cell = field_at(&raw, column);
        // As fields_of: invalid UTF-8 is read lossily, and the sort sees
        // those bytes.
        let text = String::from_utf8_lossy(cell);
        match numeric(&text) {
            Some(v) => nums.push((total_key(v), i as u32)),
            None => {
                let s = arena.len();
                arena.extend_from_slice(text.as_bytes());
                strs.push((s as u32, text.len() as u32, i as u32));
            }
        }
        if arena.len() > u32::MAX as usize - ROW_CAP {
            return Err(format!("{path}: too many unparsable {} cells to sort", RANK_COLUMN));
        }
    }
    if cancel.is_cancelled() {
        return Err(CANCELLED.into());
    }
    progress(n, n);
    // (key, row) pairs: equal keys fall back to the row, i.e. file order.
    nums.sort_unstable();
    let bytes = |&(s, l, _): &(u32, u32, u32)| &arena[s as usize..(s + l) as usize];
    strs.sort_unstable_by(|a, b| bytes(a).cmp(bytes(b)).then(a.2.cmp(&b.2)));
    if cancel.is_cancelled() {
        return Err(CANCELLED.into());
    }
    let mut asc = Vec::with_capacity(n);
    let mut run_start = vec![0u64; n.div_ceil(64)];
    let mut mark = |i: usize| run_start[i / 64] |= 1 << (i % 64);
    for (j, (k, row)) in nums.iter().enumerate() {
        if j == 0 || nums[j - 1].0 != *k {
            mark(asc.len());
        }
        asc.push(*row);
    }
    let num_len = asc.len();
    drop(nums);
    for (j, t) in strs.iter().enumerate() {
        if j == 0 || bytes(&strs[j - 1]) != bytes(t) {
            mark(asc.len());
        }
        asc.push(t.2);
    }
    Ok(Rank { asc, num_len, run_start, desc: OnceLock::new() })
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

fn file_meta(path: &str) -> Result<(u64, Option<SystemTime>), String> {
    let meta = std::fs::metadata(path).map_err(|e| format!("cannot open {path}: {e}"))?;
    // A FIFO or device would block the reader or never end; a directory has no rows.
    if !meta.is_file() {
        return Err(format!("{path} is not a file"));
    }
    Ok((meta.len(), meta.modified().ok()))
}

impl Shared {
    fn fresh(&self, path: &str, len: u64, mtime: Option<SystemTime>) -> Option<Arc<Snapshot>> {
        self.snaps
            .read()
            .unwrap()
            .iter()
            .find(|s| s.path == path && s.len == len && s.mtime == mtime)
            .cloned()
    }

    /// The token that cancels an index build of @p path: the open's, when
    /// @p path is the open file (opening another file then cancels it).
    fn index_token(&self, path: &str) -> Cancel {
        match &*self.open.lock().unwrap() {
            Some(o) if o.path == path => o.index.clone(),
            _ => Cancel::default(),
        }
    }

    /// The snapshot of @p path, indexing it first when it is new or changed
    /// (len, mtime). The map lock is never held during the scan.
    fn snapshot(&self, path: &str) -> Result<Arc<Snapshot>, String> {
        let (len, mtime) = file_meta(path)?;
        if let Some(s) = self.fresh(path, len, mtime) {
            return Ok(s);
        }
        let _one = self.build.lock().unwrap_or_else(|e| e.into_inner());
        // Another build may have finished while this one waited.
        if let Some(s) = self.fresh(path, len, mtime) {
            return Ok(s);
        }
        let index = build_index(path, &self.index_token(path))?;
        let snap = Arc::new(Snapshot {
            path: path.to_string(),
            len,
            mtime,
            index,
            rank: Mutex::new(RankSlot::None),
            view: Mutex::new(None),
        });
        let mut snaps = self.snaps.write().unwrap();
        snaps.retain(|s| s.path != path);
        snaps.insert(0, snap.clone());
        snaps.truncate(MAX_SNAPSHOTS);
        Ok(snap)
    }

    /// Send @p ev to the renderer if @p path is the open file.
    fn emit_for(&self, path: &str, ev: impl FnOnce(u64) -> BrowserEvent) {
        let target = match &*self.open.lock().unwrap() {
            Some(o) if o.path == path => Some((o.generation, o.emit.clone())),
            _ => None,
        };
        if let Some((generation, emit)) = target {
            emit(ev(generation));
        }
    }

    /// Start the E-value order of @p snap on a thread of its own, unless it
    /// exists or is being built. True when it is (now) being built.
    fn start_rank(self: &Arc<Self>, snap: &Arc<Snapshot>) -> bool {
        let Some(column) = snap.index.columns.iter().position(|c| c == RANK_COLUMN) else {
            return false;
        };
        let token = {
            let mut slot = snap.rank.lock().unwrap();
            match &*slot {
                RankSlot::Ready(_) => return false,
                RankSlot::Building(_) => return true,
                RankSlot::None => {}
            }
            let t = Cancel::default();
            *slot = RankSlot::Building(t.clone());
            t
        };
        let (me, snap) = (self.clone(), snap.clone());
        std::thread::spawn(move || {
            let path = snap.path.clone();
            let progress = |done: usize, total: usize| {
                me.emit_for(&path, |generation| BrowserEvent::RankProgress { generation, done, total })
            };
            let built = build_rank(&path, &snap.index, column, &token, &progress);
            let mut slot = snap.rank.lock().unwrap();
            match built {
                Ok(rank) => {
                    *slot = RankSlot::Ready(Arc::new(rank));
                    drop(slot);
                    me.emit_for(&path, |generation| BrowserEvent::Ranked {
                        generation,
                        column: RANK_COLUMN.into(),
                    });
                }
                Err(e) => {
                    // A later query may start it again.
                    if matches!(&*slot, RankSlot::Building(t) if Arc::ptr_eq(&t.0, &token.0)) {
                        *slot = RankSlot::None;
                    }
                    drop(slot);
                    if e != CANCELLED {
                        me.emit_for(&path, |generation| BrowserEvent::Failed { generation, message: e });
                    }
                }
            }
        });
        true
    }

    /// The rank of @p snap, built here and now if it is not ready (export,
    /// and a query that must not be served in file order).
    fn rank_now(&self, snap: &Snapshot, column: usize) -> Result<Arc<Rank>, String> {
        if let Some(r) = snap.rank_ready() {
            return Ok(r);
        }
        let r = Arc::new(build_rank(&snap.path, &snap.index, column, &Cancel::default(), &|_, _| {})?);
        let mut slot = snap.rank.lock().unwrap();
        if let RankSlot::Building(t) = &*slot {
            t.cancel(); // the background build is redundant now
        }
        *slot = RankSlot::Ready(r.clone());
        Ok(r)
    }

    /// The token of a new view build for (@p path, @p spec): a different
    /// view in flight is cancelled, the same one is shared.
    fn view_token(&self, path: &str, spec: &ViewSpec) -> Cancel {
        let mut vb = self.view_build.lock().unwrap();
        match &*vb {
            Some((p, s, t)) if p == path && s == spec => t.clone(),
            other => {
                if let Some((_, _, t)) = other {
                    t.cancel();
                }
                let t = Cancel::default();
                *vb = Some((path.to_string(), spec.clone(), t.clone()));
                t
            }
        }
    }
}

/// How a query treats an E-value order that is not ready yet.
#[derive(Clone, Copy, PartialEq, Debug)]
pub(crate) enum Mode {
    /// The table: serve file order now, build the order in the background.
    Interactive,
    /// Export and tests: build the order first; never file order.
    Exact,
}

pub(crate) fn query_mode(
    shared: &Arc<Shared>,
    path: &str,
    spec: &ViewSpec,
    offset: usize,
    limit: usize,
    mode: Mode,
) -> Result<ResultsPage, String> {
    let snap = shared.snapshot(path)?;
    let index = &snap.index;
    let res = Resolved::bind(spec, &index.columns);
    let total_rows = index.offsets.len();
    let limit = limit.min(MAX_WINDOW);
    let window = |rows: &[u32]| -> Vec<u32> {
        let end = (offset + limit).min(rows.len());
        rows[offset.min(rows.len())..end].to_vec()
    };
    let file_order = || -> Vec<u32> {
        let end = (offset + limit).min(total_rows);
        (offset.min(total_rows)..end).map(|i| i as u32).collect()
    };
    let rank_col = index.columns.iter().position(|c| c == RANK_COLUMN);
    let by_rank = matches!((res.sort, rank_col), (Some((c, _)), Some(r)) if c == r);

    let mut ranked = true;
    let mut pending = false;
    let (matched_rows, ids): (usize, Vec<u32>) = if res.is_trivial() {
        (total_rows, file_order())
    } else if by_rank && !res.has_filters() {
        let desc = res.sort.map(|(_, d)| d).unwrap_or(false);
        let rank = match (snap.rank_ready(), mode) {
            (Some(r), _) => Some(r),
            (None, Mode::Exact) => Some(shared.rank_now(&snap, rank_col.unwrap())?),
            (None, Mode::Interactive) => None,
        };
        match rank {
            Some(r) => (total_rows, window(r.order(desc))),
            None => {
                // D5: file order now, the ranked order when it is ready.
                pending = shared.start_rank(&snap);
                ranked = false;
                (total_rows, file_order())
            }
        }
    } else {
        let cached = snap.view.lock().unwrap().as_ref().filter(|(s, _)| s == spec).map(|(_, v)| v.clone());
        let rows = match cached {
            Some(v) => v,
            None => {
                let token = shared.view_token(path, spec);
                // With the E-value order ready, a filtered E-value view is
                // that order restricted to the matching rows: the same
                // sequence build_view's sort gives, without the sort.
                let built = match (by_rank, snap.rank_ready()) {
                    (true, Some(r)) => {
                        let keep = filter_rows(path, index, &res, &token)?;
                        let desc = res.sort.map(|(_, d)| d).unwrap_or(false);
                        r.order(desc).iter().copied().filter(|&i| keep[i as usize]).collect()
                    }
                    _ => build_view(path, index, &res, &token)?,
                };
                let v = Arc::new(built);
                *snap.view.lock().unwrap() = Some((spec.clone(), v.clone()));
                v
            }
        };
        (rows.len(), window(&rows))
    };

    let rows = read_rows(path, index, &ids)?;
    Ok(ResultsPage { columns: index.columns.clone(), total_rows, matched_rows, rows, row_ids: ids, ranked, pending })
}

/// A query as export and the tests see it: always in the asked order.
fn query(shared: &Arc<Shared>, path: &str, spec: &ViewSpec, offset: usize, limit: usize) -> Result<ResultsPage, String> {
    query_mode(shared, path, spec, offset, limit, Mode::Exact)
}

/// Open @p path for the renderer: the head rows now; the index, then the
/// E-value order, on a thread, announced through @p emit. Opening another
/// file cancels the builds of the previous one; re-opening the same
/// unchanged file reuses what was built.
pub(crate) fn open(shared: &Arc<Shared>, path: &str, emit: Emit) -> Result<ResultsHead, String> {
    file_meta(path)?;
    let generation = shared.generation.fetch_add(1, Ordering::SeqCst) + 1;
    {
        let mut open = shared.open.lock().unwrap();
        let index = match open.take() {
            Some(prev) if prev.path == path => prev.index,
            Some(prev) => {
                prev.index.cancel();
                // The old file's rank build is of no use any more.
                for s in shared.snaps.read().unwrap().iter().filter(|s| s.path == prev.path) {
                    if let RankSlot::Building(t) = &*s.rank.lock().unwrap() {
                        t.cancel();
                    }
                }
                Cancel::default()
            }
            None => Cancel::default(),
        };
        *open = Some(OpenState { path: path.to_string(), generation, emit, index });
    }
    let (columns, rows, complete) = read_head(path, MAX_WINDOW)?;
    let (me, p) = (shared.clone(), path.to_string());
    std::thread::spawn(move || match me.snapshot(&p) {
        Ok(snap) => {
            let total_rows = snap.index.offsets.len();
            me.emit_for(&p, |generation| BrowserEvent::Indexed { generation, total_rows });
            if !me.start_rank(&snap) && snap.rank_ready().is_some() {
                me.emit_for(&p, |generation| BrowserEvent::Ranked { generation, column: RANK_COLUMN.into() });
            }
        }
        Err(e) if e == CANCELLED => {}
        Err(message) => me.emit_for(&p, |generation| BrowserEvent::Failed { generation, message }),
    });
    Ok(ResultsHead { generation, columns, rows, complete })
}

/// Where file row @p row sits in @p spec's view, if that view is built (the
/// renderer's anchor across the D5 swap). Never starts a build.
pub(crate) fn position(shared: &Arc<Shared>, path: &str, spec: &ViewSpec, row: u32) -> Result<Option<usize>, String> {
    let (len, mtime) = file_meta(path)?;
    let Some(snap) = shared.fresh(path, len, mtime) else {
        return Ok(None);
    };
    let res = Resolved::bind(spec, &snap.index.columns);
    if res.is_trivial() {
        return Ok(((row as usize) < snap.index.offsets.len()).then_some(row as usize));
    }
    let rank_col = snap.index.columns.iter().position(|c| c == RANK_COLUMN);
    if let (Some((c, desc)), Some(r), false) = (res.sort, rank_col, res.has_filters()) {
        if c == r {
            return Ok(snap.rank_ready().and_then(|k| k.order(desc).iter().position(|&i| i == row)));
        }
    }
    let view = snap.view.lock().unwrap().as_ref().filter(|(s, _)| s == spec).map(|(_, v)| v.clone());
    Ok(view.and_then(|v| v.iter().position(|&i| i == row)))
}

#[tauri::command]
pub async fn results_open(
    state: tauri::State<'_, BrowserCache>,
    path: String,
    on_event: tauri::ipc::Channel<BrowserEvent>,
) -> Result<ResultsHead, String> {
    let shared = state.0.clone();
    let emit: Emit = Arc::new(move |ev| {
        let _ = on_event.send(ev);
    });
    tauri::async_runtime::spawn_blocking(move || open(&shared, &path, emit))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn results_query(
    state: tauri::State<'_, BrowserCache>,
    path: String,
    view: ViewSpec,
    offset: usize,
    limit: usize,
) -> Result<ResultsPage, String> {
    let shared = state.0.clone();
    // The index build on a cold gigabyte file takes seconds: keep it off the
    // IPC thread. A query for a file being indexed waits for that build.
    tauri::async_runtime::spawn_blocking(move || query_mode(&shared, &path, &view, offset, limit, Mode::Interactive))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn results_position(
    state: tauri::State<'_, BrowserCache>,
    path: String,
    view: ViewSpec,
    row: u32,
) -> Result<Option<usize>, String> {
    let shared = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || position(&shared, &path, &view, row))
        .await
        .map_err(|e| e.to_string())?
}

/// Write the rows of @p spec, in its order, with only @p columns (header
/// names; unknown ones are skipped), to @p dest as a TSV. The rows go to
/// `<dest>.part` first and replace @p dest only once complete, so a failed
/// export never leaves a truncated file under the chosen name. Returns the
/// number of rows written.
fn export(shared: &Arc<Shared>, path: &str, spec: &ViewSpec, columns: &[String], dest: &str) -> Result<usize, String> {
    // Writing the view over its own source would truncate what it reads.
    let same = match (std::fs::canonicalize(path), std::fs::canonicalize(dest)) {
        (Ok(a), Ok(b)) => a == b,
        _ => path == dest,
    };
    if same {
        return Err(format!("{dest} is the file being exported; choose another name"));
    }
    let first = query(shared, path, spec, 0, MAX_WINDOW)?;
    let pick: Vec<usize> = columns
        .iter()
        .filter_map(|c| first.columns.iter().position(|h| h == c))
        .collect();
    if pick.is_empty() {
        return Err("no column to export".into());
    }
    let part = format!("{dest}.part");
    let write = || -> Result<usize, String> {
        let file = File::create(&part).map_err(|e| format!("cannot write {dest}: {e}"))?;
        let mut w = BufWriter::new(file);
        let line = |w: &mut BufWriter<File>, cells: &[String]| -> Result<(), String> {
            let row: Vec<&str> = pick.iter().map(|&i| cells.get(i).map(String::as_str).unwrap_or("")).collect();
            writeln!(w, "{}", row.join("\t")).map_err(|e| format!("cannot write {dest}: {e}"))
        };
        line(&mut w, &first.columns)?;
        let mut page = first;
        let mut done = 0;
        loop {
            for r in &page.rows {
                line(&mut w, r)?;
            }
            done += page.rows.len();
            if page.rows.is_empty() || done >= page.matched_rows {
                break;
            }
            page = query(shared, path, spec, done, MAX_WINDOW)?;
        }
        w.flush().map_err(|e| format!("cannot write {dest}: {e}"))?;
        Ok(done)
    };
    match write() {
        Ok(n) => {
            std::fs::rename(&part, dest).map_err(|e| format!("cannot write {dest}: {e}"))?;
            Ok(n)
        }
        Err(e) => {
            std::fs::remove_file(&part).ok();
            Err(e)
        }
    }
}

#[tauri::command]
pub async fn results_export(
    state: tauri::State<'_, BrowserCache>,
    path: String,
    view: ViewSpec,
    columns: Vec<String>,
    dest: String,
) -> Result<usize, String> {
    let shared = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || export(&shared, &path, &view, &columns, &dest))
        .await
        .map_err(|e| e.to_string())?
}

/// The pieces the browser bench (examples/browser_bench.rs) times: today's
/// sorted view, the head read, the index and the E-value order. Not used by
/// the app.
#[doc(hidden)]
#[allow(dead_code)] // used by examples/browser_bench.rs only
pub mod bench {
    use super::*;

    pub struct Indexed(pub(crate) Index);

    impl Indexed {
        pub fn rows(&self) -> usize {
            self.0.offsets.len()
        }
        pub fn columns(&self) -> &[String] {
            &self.0.columns
        }
        pub fn offsets(&self) -> &[u64] {
            &self.0.offsets
        }
        pub fn data_end(&self) -> u64 {
            self.0.data_end
        }
    }

    pub fn head(path: &str) -> Result<usize, String> {
        read_head(path, MAX_WINDOW).map(|(_, rows, _)| rows.len())
    }

    pub fn index(path: &str) -> Result<Indexed, String> {
        build_index(path, &Cancel::default()).map(Indexed)
    }

    /// The ascending and descending E-value orders.
    pub fn rank(path: &str, ix: &Indexed) -> Result<(Vec<u32>, Vec<u32>), String> {
        let col = ix.0.columns.iter().position(|c| c == RANK_COLUMN).ok_or("no evalue column")?;
        let r = build_rank(path, &ix.0, col, &Cancel::default(), &|_, _| {})?;
        let d = r.desc().to_vec();
        Ok((r.asc, d))
    }

    /// v1.11's E-value view: build_view over the whole file.
    pub fn today_sorted(path: &str, ix: &Indexed, desc: bool) -> Result<Vec<u32>, String> {
        let spec = ViewSpec { sort: Some(SortSpec { column: RANK_COLUMN.into(), desc }), ..Default::default() };
        build_view(path, &ix.0, &Resolved::bind(&spec, &ix.0.columns), &Cancel::default())
    }

    /// The first page of the E-value view through the app's own query path
    /// (Interactive: file order while the order is built).
    pub fn open_and_query(path: &str) -> Result<(usize, bool), String> {
        let shared = Arc::new(Shared::default());
        let spec = ViewSpec { sort: Some(SortSpec { column: RANK_COLUMN.into(), desc: false }), ..Default::default() };
        let p = query_mode(&shared, path, &spec, 0, 500, Mode::Interactive)?;
        Ok((p.rows.len(), p.ranked))
    }
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
        let cache = Arc::new(Shared::default());
        query(&cache, path, spec, offset, limit)
    }

    fn col(page: &ResultsPage, row: usize, name: &str) -> String {
        let i = page.columns.iter().position(|c| c == name).unwrap();
        page.rows[row][i].clone()
    }

    #[test]
    fn export_writes_the_view_with_the_chosen_columns() {
        let p = fixture("export.tsv");
        let dest = format!("{p}.out.tsv");
        let cache = Arc::new(Shared::default());
        let spec = ViewSpec { max_evalue: Some(0.005), ..Default::default() };
        let cols = vec!["tag".to_string(), "evalue".to_string(), "no_such".to_string()];
        let n = export(&cache, &p, &spec, &cols, &dest).unwrap();
        assert_eq!(n, 2);
        let text = std::fs::read_to_string(&dest).unwrap();
        assert_eq!(text, "tag\tevalue\nAQRQAAN\t0.003\nLNDLAAK\t0.0001\n");
        assert!(!std::path::Path::new(&format!("{dest}.part")).exists());
        // Never over its own source.
        assert!(export(&cache, &p, &spec, &cols, &p).is_err());
        assert_eq!(std::fs::read_to_string(&p).unwrap().lines().count(), 5);
        std::fs::remove_file(&p).ok();
        std::fs::remove_file(&dest).ok();
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
    fn hits_only_excludes_entrapment_only_rows() {
        // M11: efwd/erev are calibration material, not target hits.
        let p = write_fixture(
            "entrap.tsv",
            &format!(
                "{HEADER}\n\
                 a\tAAA\t3\t1\t0\t0\t0\t0\t0.1\t0.1\t0.1\tfwd\n\
                 b\tCCC\t3\t1\t0\t0\t0\t0\t0.1\t0.1\t0.1\tefwd\n\
                 c\tDDD\t3\t1\t0\t0\t0\t0\t0.1\t0.1\t0.1\terev\n\
                 d\tEEE\t3\t1\t0\t0\t0\t0\t0.1\t0.1\t0.1\trev\n\
                 e\tFFF\t3\t1\t0\t0\t0\t0\t0.1\t0.1\t0.1\t-\n"
            ),
        );
        let tags = |hit: &str| -> Vec<String> {
            let r = q(&p, &ViewSpec { fasta_hit: Some(hit.into()), ..Default::default() }, 0, 100).unwrap();
            (0..r.rows.len()).map(|i| col(&r, i, "tag")).collect()
        };
        assert_eq!(tags("only"), ["AAA", "EEE"]);
        assert_eq!(tags("none"), ["CCC", "DDD", "FFF"]);
        assert_eq!(tags("entrapment"), ["CCC", "DDD"]);
        std::fs::remove_file(&p).ok();
    }

    #[test]
    fn nan_and_inf_tags_sort_as_strings() {
        // The tags NAN and INF parse as f64 but are not numbers here.
        let p = write_fixture("nan.tsv", "tag\nYYK\nNAN\nAAC\nINF\n");
        let sorted = |desc: bool| -> Vec<String> {
            let spec = ViewSpec { sort: Some(SortSpec { column: "tag".into(), desc }), ..Default::default() };
            let r = q(&p, &spec, 0, 100).unwrap();
            (0..r.rows.len()).map(|i| col(&r, i, "tag")).collect()
        };
        assert_eq!(sorted(false), ["AAC", "INF", "NAN", "YYK"]);
        assert_eq!(sorted(true), ["YYK", "NAN", "INF", "AAC"]);
        std::fs::remove_file(&p).ok();
    }

    #[test]
    fn utf8_bom_does_not_rename_first_column() {
        // With a BOM the spectrum filter must still bind.
        let p = write_fixture("bom.tsv", "\u{feff}spectrum\ttag\nscan=1\tAAA\nscan=2\tCCC\n");
        let r = q(&p, &ViewSpec { spectrum: Some("scan=2".into()), ..Default::default() }, 0, 100).unwrap();
        assert_eq!(r.columns, vec!["spectrum", "tag"]);
        assert_eq!(r.matched_rows, 1);
        assert_eq!(col(&r, 0, "tag"), "CCC");
        std::fs::remove_file(&p).ok();
    }

    #[test]
    fn a_directory_is_refused_not_read() {
        // Only regular files; a FIFO or device would block the reader.
        let d = std::env::temp_dir();
        let e = q(d.to_str().unwrap(), &ViewSpec::default(), 0, 10).unwrap_err();
        assert!(e.contains("is not a file"), "{e}");
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
        let cache = Arc::new(Shared::default());
        let snap = |c: &Arc<Shared>| c.snaps.read().unwrap()[0].clone();
        // The E-value view is served from the snapshot's rank (D5); any
        // other sorted or filtered view from its view slot.
        let spec = ViewSpec { sort: Some(SortSpec { column: "evalue".into(), desc: false }), ..Default::default() };
        let r1 = query(&cache, &p, &spec, 0, 100).unwrap();
        let rank_ptr = snap(&cache).rank_ready().unwrap().asc.as_ptr();
        let r2 = query(&cache, &p, &spec, 0, 100).unwrap();
        // Same (path, len, mtime) + same spec: the order was not rebuilt.
        assert_eq!(rank_ptr, snap(&cache).rank_ready().unwrap().asc.as_ptr());
        assert_eq!(r1.rows, r2.rows);
        let tag = ViewSpec { sort: Some(SortSpec { column: "tag".into(), desc: false }), ..Default::default() };
        query(&cache, &p, &tag, 0, 100).unwrap();
        let view_ptr = snap(&cache).view.lock().unwrap().as_ref().unwrap().1.as_ptr();
        query(&cache, &p, &tag, 0, 100).unwrap();
        assert_eq!(view_ptr, snap(&cache).view.lock().unwrap().as_ref().unwrap().1.as_ptr());

        // Overwrite with different content: (len, mtime) invalidates.
        std::fs::write(&p, format!("{HEADER}\nz\tZZ\t9\t1\t0\t0\t0\t0\t1.0\t0.9\t0.9\tfwd\n")).unwrap();
        let r3 = query(&cache, &p, &spec, 0, 100).unwrap();
        assert_eq!(r3.total_rows, 1);
        assert_eq!(col(&r3, 0, "tag"), "ZZ");
        std::fs::remove_file(&p).ok();
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

    // ---------------------------------------------------------------- D5
    // The E-value order of the first cut (GUI-DESIGN 6.1 items 1-6) against
    // today's build_view, which stays as the oracle.

    /// xorshift64*: a deterministic generator, so a failing case can be
    /// replayed from its seed.
    struct Rng(u64);
    impl Rng {
        fn next(&mut self) -> u64 {
            self.0 ^= self.0 >> 12;
            self.0 ^= self.0 << 25;
            self.0 ^= self.0 >> 27;
            self.0.wrapping_mul(0x2545_F491_4F6C_DD1D)
        }
        fn below(&mut self, n: usize) -> usize {
            (self.next() % n as u64) as usize
        }
    }

    /// E-value cells: numbers with ties, signed zeros and exponents, and every
    /// kind of cell today's parser rejects or keeps as a string ('-', NAN,
    /// INF in all spellings, blanks, words, invalid UTF-8).
    const CELLS: &[&[u8]] = &[
        b"0.003", b"0.003", b"0.0001", b"1e-5", b"1E-5", b"0.00001", b"105.503", b"7", b"-1", b"0", b"-0", b"0.0",
        b"1e308", b"-1e-300", b"2.5e-08", b"+3", b".5", b"5.", b"-", b"-", b"NAN", b"NaN", b"nan", b"INF", b"inf",
        b"-INF", b"Infinity", b"-inf", b"", b" 3", b"abc", b"1e999", b"0x10", b"\xff\xfe", b"\xc3\xa9",
    ];

    fn random_tsv(rng: &mut Rng) -> (Vec<u8>, usize) {
        let ncols = 2 + rng.below(4);
        let ecol = rng.below(ncols);
        let crlf = rng.below(4) == 0;
        let nl: &[u8] = if crlf { b"\r\n" } else { b"\n" };
        let mut out: Vec<u8> = Vec::new();
        if rng.below(5) == 0 {
            out.extend_from_slice(b"\xEF\xBB\xBF");
        }
        let names: Vec<String> = (0..ncols)
            .map(|c| if c == ecol { "evalue".to_string() } else if c == 0 { "spectrum".into() } else { format!("c{c}") })
            .collect();
        out.extend_from_slice(names.join("\t").as_bytes());
        out.extend_from_slice(nl);
        let rows = rng.below(120);
        for r in 0..rows {
            if rng.below(15) == 0 {
                out.extend_from_slice(nl); // blank lines are not rows
            }
            // Short rows: the evalue field may be missing (read as "").
            let have = if rng.below(10) == 0 { rng.below(ncols) + 1 } else { ncols };
            for c in 0..have {
                if c > 0 {
                    out.push(b'\t');
                }
                if c == ecol {
                    out.extend_from_slice(CELLS[rng.below(CELLS.len())]);
                } else {
                    out.extend_from_slice(format!("s{}", rng.below(5)).as_bytes());
                }
            }
            if r + 1 < rows || rng.below(3) != 0 {
                out.extend_from_slice(nl);
            }
        }
        (out, ecol)
    }

    fn all_rows(shared: &Arc<Shared>, p: &str, spec: &ViewSpec) -> Vec<u32> {
        let mut out = Vec::new();
        loop {
            let page = query(shared, p, spec, out.len(), MAX_WINDOW).unwrap();
            assert!(page.ranked && !page.pending);
            if page.rows.is_empty() {
                break;
            }
            out.extend_from_slice(&page.row_ids);
            if out.len() >= page.matched_rows {
                break;
            }
        }
        out
    }

    fn oracle(p: &str, spec: &ViewSpec) -> Vec<u32> {
        let index = build_index(p, &Cancel::default()).unwrap();
        build_view(p, &index, &Resolved::bind(spec, &index.columns), &Cancel::default()).unwrap()
    }

    #[test]
    fn rank_order_equals_build_view_on_random_files() {
        let mut rng = Rng(0x9E37_79B9_7F4A_7C15);
        for case in 0..400 {
            let (body, _) = random_tsv(&mut rng);
            let p = std::env::temp_dir().join(format!("fastag-browser-{}-rand-{case}.tsv", std::process::id()));
            std::fs::write(&p, &body).unwrap();
            let p = p.to_string_lossy().into_owned();
            for desc in [false, true] {
                let sort = Some(SortSpec { column: "evalue".into(), desc });
                let plain = ViewSpec { sort: sort.clone(), ..Default::default() };
                let shared = Arc::new(Shared::default());
                assert_eq!(all_rows(&shared, &p, &plain), oracle(&p, &plain), "case {case} desc {desc}");
                // Filtered E-value views use the rank too once it is built.
                let filtered = ViewSpec { sort, max_evalue: Some(0.01), spectrum: Some("s1".into()), ..Default::default() };
                assert_eq!(all_rows(&shared, &p, &filtered), oracle(&p, &filtered), "case {case} desc {desc} filtered");
            }
            std::fs::remove_file(&p).ok();
        }
    }

    #[test]
    fn rank_mixed_unparsable_cells_sink_in_both_directions() {
        // NAN, INF and '-' are one bytewise block below every number; ties
        // keep file order in both directions.
        let p = write_fixture(
            "mixed.tsv",
            "tag\tevalue\nr0\t0.5\nr1\t-\nr2\tNAN\nr3\t1e-3\nr4\tINF\nr5\t0.5\nr6\t-\nr7\tabc\n",
        );
        let tags = |desc: bool| -> Vec<String> {
            let spec = ViewSpec { sort: Some(SortSpec { column: "evalue".into(), desc }), ..Default::default() };
            let r = q(&p, &spec, 0, 100).unwrap();
            (0..r.rows.len()).map(|i| col(&r, i, "tag")).collect()
        };
        assert_eq!(tags(false), ["r3", "r0", "r5", "r1", "r6", "r4", "r2", "r7"]);
        assert_eq!(tags(true), ["r0", "r5", "r3", "r7", "r2", "r4", "r1", "r6"]);
        std::fs::remove_file(&p).ok();
    }

    type Events = Arc<Mutex<Vec<BrowserEvent>>>;

    fn collector() -> (Emit, Events) {
        let got: Events = Arc::default();
        let g = got.clone();
        (Arc::new(move |e| g.lock().unwrap().push(e)), got)
    }

    fn wait_for(got: &Events, pred: impl Fn(&BrowserEvent) -> bool) -> BrowserEvent {
        let until = Instant::now() + std::time::Duration::from_secs(10);
        loop {
            if let Some(e) = got.lock().unwrap().iter().find(|e| pred(e)) {
                return e.clone();
            }
            assert!(Instant::now() < until, "no such event: {:?}", got.lock().unwrap());
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
    }

    #[test]
    fn open_answers_from_the_head_then_indexes_and_ranks() {
        let p = fixture("open.tsv");
        let shared = Arc::new(Shared::default());
        let (emit, got) = collector();
        let head = open(&shared, &p, emit).unwrap();
        assert_eq!(head.columns.len(), 12);
        assert_eq!(head.rows.len(), 4);
        assert!(head.complete);
        assert_eq!(head.rows[0][1], "AQRQAAN"); // file order
        let g = head.generation;
        assert_eq!(wait_for(&got, |e| matches!(e, BrowserEvent::Indexed { .. })), BrowserEvent::Indexed { generation: g, total_rows: 4 });
        assert_eq!(
            wait_for(&got, |e| matches!(e, BrowserEvent::Ranked { .. })),
            BrowserEvent::Ranked { generation: g, column: "evalue".into() }
        );
        let spec = ViewSpec { sort: Some(SortSpec { column: "evalue".into(), desc: false }), ..Default::default() };
        let r = query_mode(&shared, &p, &spec, 0, 10, Mode::Interactive).unwrap();
        assert!(r.ranked && !r.pending);
        assert_eq!(r.row_ids, [2, 0, 1, 3]);
        // The renderer's anchor: where file row 0 went.
        assert_eq!(position(&shared, &p, &spec, 0).unwrap(), Some(1));
        assert_eq!(position(&shared, &p, &ViewSpec::default(), 3).unwrap(), Some(3));
        std::fs::remove_file(&p).ok();
    }

    #[test]
    fn interactive_query_serves_file_order_while_ranking() {
        let p = fixture("pending.tsv");
        let shared = Arc::new(Shared::default());
        let snap = shared.snapshot(&p).unwrap();
        // A build in flight (never finishing here).
        let token = Cancel::default();
        *snap.rank.lock().unwrap() = RankSlot::Building(token.clone());
        let spec = ViewSpec { sort: Some(SortSpec { column: "evalue".into(), desc: true }), ..Default::default() };
        let r = query_mode(&shared, &p, &spec, 0, 10, Mode::Interactive).unwrap();
        assert!(!r.ranked && r.pending);
        assert_eq!(r.row_ids, [0, 1, 2, 3]);
        assert_eq!(col(&r, 0, "tag"), "AQRQAAN");
        assert_eq!(position(&shared, &p, &spec, 0).unwrap(), None); // not built: no anchor yet
        // Export and the tests never get file order for a sorted view.
        let e = query_mode(&shared, &p, &spec, 0, 10, Mode::Exact).unwrap();
        assert!(e.ranked);
        assert_eq!(e.row_ids, [1, 0, 2, 3]);
        std::fs::remove_file(&p).ok();
    }

    #[test]
    fn page_reads_never_cancel_a_build() {
        let p = fixture("fling.tsv");
        let shared = Arc::new(Shared::default());
        let (emit, _got) = collector();
        let snap = shared.snapshot(&p).unwrap();
        let rank = Cancel::default();
        *snap.rank.lock().unwrap() = RankSlot::Building(rank.clone());
        open(&shared, &p, emit).unwrap();
        let ranked = ViewSpec { sort: Some(SortSpec { column: "evalue".into(), desc: false }), ..Default::default() };
        let filtered = ViewSpec { min_length: Some(7), ..Default::default() };
        let view = shared.view_token(&p, &filtered);
        // A fling: page reads of the E-value view and of the filtered view
        // at many offsets, and the same file opened again.
        for off in [0, 1, 2, 3, 0, 2, 1] {
            query_mode(&shared, &p, &ranked, off, 2, Mode::Interactive).unwrap();
        }
        let (emit2, _) = collector();
        open(&shared, &p, emit2).unwrap();
        assert!(!rank.is_cancelled(), "a page read or a re-open of the same file cancelled the rank build");
        assert!(Arc::ptr_eq(&shared.view_token(&p, &filtered).0, &view.0));
        assert!(!view.is_cancelled());
        // Another view spec cancels the view build of the previous one.
        let other = ViewSpec { min_length: Some(6), ..Default::default() };
        shared.view_token(&p, &other);
        assert!(view.is_cancelled());
        assert!(!rank.is_cancelled());
        std::fs::remove_file(&p).ok();
    }

    #[test]
    fn opening_another_file_cancels_its_builds_and_bumps_the_generation() {
        let a = fixture("gen-a.tsv");
        let b = fixture("gen-b.tsv");
        let shared = Arc::new(Shared::default());
        let snap = shared.snapshot(&a).unwrap();
        let rank = Cancel::default();
        *snap.rank.lock().unwrap() = RankSlot::Building(rank.clone());
        let (ea, got_a) = collector();
        let ha = open(&shared, &a, ea).unwrap();
        wait_for(&got_a, |e| matches!(e, BrowserEvent::Indexed { .. }));
        let index_a = shared.index_token(&a);
        let (eb, got_b) = collector();
        let hb = open(&shared, &b, eb).unwrap();
        assert!(hb.generation > ha.generation);
        assert!(rank.is_cancelled(), "the rank build of the old file must stop");
        assert!(index_a.is_cancelled());
        // Events of the old file reach nobody; the new file's carry its own
        // generation.
        let before = got_a.lock().unwrap().len();
        shared.emit_for(&a, |generation| BrowserEvent::Ranked { generation, column: "evalue".into() });
        assert_eq!(got_a.lock().unwrap().len(), before);
        match wait_for(&got_b, |e| matches!(e, BrowserEvent::Ranked { .. })) {
            BrowserEvent::Ranked { generation, .. } => assert_eq!(generation, hb.generation),
            e => panic!("{e:?}"),
        }
        assert!(got_b.lock().unwrap().iter().all(|e| match e {
            BrowserEvent::Indexed { generation, .. }
            | BrowserEvent::RankProgress { generation, .. }
            | BrowserEvent::Ranked { generation, .. }
            | BrowserEvent::Failed { generation, .. } => *generation == hb.generation,
        }));
        std::fs::remove_file(&a).ok();
        std::fs::remove_file(&b).ok();
    }

    #[test]
    fn a_cancelled_rank_build_stops_and_frees_its_slot() {
        let p = fixture("cancel.tsv");
        let index = build_index(&p, &Cancel::default()).unwrap();
        let t = Cancel::default();
        t.cancel();
        assert_eq!(build_rank(&p, &index, 8, &t, &|_, _| {}).err().as_deref(), Some(CANCELLED));
        assert_eq!(build_index(&p, &t).err().as_deref(), Some(CANCELLED));
        assert_eq!(build_view(&p, &index, &Resolved::bind(&ViewSpec { min_length: Some(1), ..Default::default() }, &index.columns), &t).err().as_deref(), Some(CANCELLED));
        std::fs::remove_file(&p).ok();
    }

    #[test]
    fn rank_progress_reaches_the_total() {
        let mut body = format!("{HEADER}\n");
        for i in 0..300_000u32 {
            body.push_str(&format!("s{i}\tAAA\t3\t1\t0\t0\t0\t0\t{}\t0\t0\t-\n", (i * 7919) % 1000));
        }
        let p = write_fixture("progress.tsv", &body);
        let index = build_index(&p, &Cancel::default()).unwrap();
        let seen: Mutex<Vec<(usize, usize)>> = Mutex::default();
        let r = build_rank(&p, &index, 8, &Cancel::default(), &|d, t| seen.lock().unwrap().push((d, t))).unwrap();
        assert_eq!(seen.lock().unwrap().last(), Some(&(300_000, 300_000)));
        assert_eq!(r.asc.len(), 300_000);
        assert_eq!(r.desc().len(), 300_000);
        // Ties (1,000 distinct values) keep file order in both directions.
        assert_eq!(&r.asc[..3], &[0, 1000, 2000]);
        assert_eq!(&r.desc()[..2], &[321, 1321]);
        std::fs::remove_file(&p).ok();
    }

    #[test]
    fn head_read_follows_the_index_rules() {
        let p = write_fixture("head.tsv", "\u{feff}spectrum\ttag\r\n\r\nscan=1\tAAA\r\n\nscan=2\tCCC");
        let (cols, rows, complete) = read_head(&p, 1000).unwrap();
        assert_eq!(cols, ["spectrum", "tag"]);
        assert_eq!(rows, [vec!["scan=1", "AAA"], vec!["scan=2", "CCC"]]);
        assert!(complete);
        // Larger than the head read: whole rows only, at most max_rows.
        let mut body = String::from("a\tb\n");
        while body.len() < 2 * HEAD_BYTES {
            body.push_str("0123456789\tabcdefghij\n");
        }
        let p2 = write_fixture("head-big.tsv", &body);
        let (_, rows, complete) = read_head(&p2, 1000).unwrap();
        assert_eq!(rows.len(), 1000);
        assert!(!complete);
        let (_, rows, complete) = read_head(&p2, usize::MAX).unwrap();
        assert!(!complete);
        assert!(rows.iter().all(|r| r == &vec!["0123456789", "abcdefghij"]));
        std::fs::remove_file(&p).ok();
        std::fs::remove_file(&p2).ok();
    }
}
