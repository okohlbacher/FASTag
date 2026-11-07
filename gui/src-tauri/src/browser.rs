// Windowed browser over a FASTag tags TSV. A full run is 100k-10M+ rows; the
// frontend virtualizes scrolling and asks for <=1000-row windows of a sorted/
// filtered view, so the whole file never crosses IPC or lives in renderer
// memory. On open, one sequential scan records every line-start offset; a
// window is a handful of reads at known offsets.
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
// P3 (GUI-DESIGN 6.1 items 7-12): after the E-value order, the typed columns
// (length u16, hit class u8, spectrum as a dictionary plus u32 ids; the
// E-value cutoff works on the E-value order itself, see Typed) are read in
// one parallel pass of whole-row chunks, 8 MB across the threads.
// Every view is then a cached order (one per sort column, built once) with
// the filters applied to it as a parallel predicate over the typed columns;
// no filter change reads the file. A file beyond the typed budget falls back
// to a chunk scan per filter. Pages are read in coalesced spans, and export
// is a job with progress and cancel, as TSV or CSV.
//
// Concurrency: every file is one immutable `Snapshot` (index plus lazily
// built orders and typed columns) behind an `Arc`, in an `RwLock` map. A
// query clones the Arc and releases the map at once, so a page read never
// waits for a build. Each build kind has its own cancel token: opening
// another file cancels the index, rank and typed builds of the old one; a
// new view spec (filters, another sort) cancels the previous view build;
// an export has a token of its own that only results_cancel sets. Page reads
// of the same spec cancel nothing, so the ranked swap still happens during a
// scroll fling.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::fs::File;
use std::io::{BufReader, BufWriter, Read, Seek, SeekFrom, Write};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::borrow::Cow;
use std::sync::{Arc, Condvar, Mutex, RwLock};
use std::time::{Duration, Instant, SystemTime};

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
/// The read size of export and of a page (GUI-DESIGN 6.1 item 7).
const CHUNK: usize = 8 << 20;
/// The read size of each thread of the typed pass: eight of them read in
/// parallel, so 8 MB in all.
const TYPED_CHUNK: usize = 1 << 20;
/// Rows beyond this are not typed (about 15 B per row): their filters scan
/// the file in chunks instead (item 12).
const TYPED_MAX_ROWS: usize = 60_000_000;
/// Orders kept per file besides the E-value one.
const MAX_ORDERS: usize = 4;
/// The bytes the cached views and the orders by other columns of one
/// snapshot may hold together (the E-value order is not counted): older
/// views go first, then older orders. The newest entry stays even when it
/// alone is larger (a page read of it must not rebuild it).
const CACHE_BYTES: usize = 96 << 20;
/// Views kept per file (item 9: the last four).
const MAX_VIEWS: usize = 4;
/// A sorted export gathers this many bytes of rows per pass over the file.
const EXPORT_WINDOW: usize = 32 << 20;
/// ... and at most this many rows.
const EXPORT_WINDOW_ROWS: usize = 1 << 20;
/// What an export holds besides the view: the window and its row ids,
/// offsets and (row, slot) pairs, a read span, the writer's buffer.
const EXPORT_TRANSIENT: usize = EXPORT_WINDOW + EXPORT_WINDOW_ROWS * 16 + CHUNK + (4 << 20);
/// Rows closer than this are read in one span (the bytes in between are
/// cheaper to read than another call).
const GAP: u64 = 32 << 10;

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
    /// Best N tags per spectrum (1: the best tag): after the other filters,
    /// each `spectrum` value keeps its first N rows in E-value order (the
    /// ascending order of the table, ties in file order). 0 or absent: off;
    /// inactive without a `spectrum` and an `evalue` column.
    pub per_spectrum: Option<u32>,
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

/// The file format of an export.
#[derive(Deserialize, Clone, Copy, PartialEq, Eq, Debug, Default)]
#[serde(rename_all = "lowercase")]
pub enum ExportFormat {
    /// Tab-separated, LF line ends, cells as they are.
    #[default]
    Tsv,
    /// RFC 4180: comma-separated, CRLF line ends, a cell with a comma, a
    /// quote, CR or LF in double quotes with its quotes doubled.
    Csv,
}

/// The events of one export job, on the Channel its results_export call
/// gave. Every event carries the job's id; ids only grow, so a renderer
/// drops the events of a job it no longer shows.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum ExportEvent {
    /// Rows written so far, of the view's rows.
    Progress { job_id: u64, done: usize, total: usize },
    /// The file is complete under its name.
    Done { job_id: u64, rows: usize, dest: String },
    /// Nothing was written under the name (its .part is removed).
    Failed { job_id: u64, message: String },
    /// results_cancel stopped it; nothing was written under the name.
    Cancelled { job_id: u64 },
}

impl ExportEvent {
    pub fn job_id(&self) -> u64 {
        match self {
            ExportEvent::Progress { job_id, .. }
            | ExportEvent::Done { job_id, .. }
            | ExportEvent::Failed { job_id, .. }
            | ExportEvent::Cancelled { job_id } => *job_id,
        }
    }
    pub fn is_terminal(&self) -> bool {
        !matches!(self, ExportEvent::Progress { .. })
    }
}

pub type ExportEmit = Arc<dyn Fn(ExportEvent) + Send + Sync>;

pub(crate) struct Index {
    pub(crate) columns: Vec<String>,
    /// Byte offset of each data-row start; row i spans offsets[i]..offsets[i+1]
    /// (data_end for the last), trailing newline included.
    pub(crate) offsets: Mapped<u64>,
    pub(crate) data_end: u64,
}

impl Index {
    fn end_of(&self, i: usize) -> u64 {
        self.offsets.get(i + 1).copied().unwrap_or(self.data_end)
    }
}

/// A cancel token. Each build kind (index, rank, view, export) gets its own.
/// The second field: a parent whose cancel also stops this one.
#[derive(Default, Clone)]
pub struct Cancel(Arc<AtomicBool>, Option<Arc<AtomicBool>>);

impl Cancel {
    pub fn cancel(&self) {
        self.0.store(true, Ordering::SeqCst);
    }
    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::Relaxed) || self.1.as_ref().is_some_and(|p| p.load(Ordering::Relaxed))
    }
    /// A token of its own (cancelling it leaves @p parent alone) that
    /// @p parent's cancel also stops.
    fn child_of(parent: &Cancel) -> Cancel {
        Cancel(Arc::default(), Some(parent.0.clone()))
    }
}

const CANCELLED: &str = "cancelled";

/// The order of every row of a file by one column.
pub(crate) struct Rank {
    /// Ascending: the numeric block (by value, ties in file order), then the
    /// unparsable block (by bytes, ties in file order).
    pub(crate) asc: Mapped<u32>,
    /// Rows in the numeric block (asc[..num_len]).
    pub(crate) num_len: usize,
    /// Bit i set: asc[i] starts a new run of equal keys (within its block).
    /// The first row of each block always starts a run.
    pub(crate) run_start: Vec<u64>,
}

impl Rank {
    /// The descending order is never stored (it would be 4 B per row more
    /// per order): position d of it is read from asc. Each block is reversed
    /// on its own (numbers stay above the unparsable cells) and the rows of
    /// a run of equal keys keep file order, as the comparator
    /// `ord.reverse().then(row)` of v1.11.
    fn block_of(&self, q: usize) -> (usize, usize) {
        if q < self.num_len {
            (0, self.num_len)
        } else {
            (self.num_len, self.asc.len())
        }
    }

    /// The start of the run holding asc position @p q.
    fn prev_start(&self, q: usize) -> usize {
        let mut w = q / 64;
        let mut x = self.run_start[w] & (u64::MAX >> (63 - q % 64));
        loop {
            if x != 0 {
                return w * 64 + 63 - x.leading_zeros() as usize;
            }
            w -= 1;
            x = self.run_start[w];
        }
    }

    /// The first run start at or after @p from, or @p hi.
    fn next_start(&self, from: usize, hi: usize) -> usize {
        if from >= hi {
            return hi;
        }
        let mut w = from / 64;
        let mut x = self.run_start[w] & (u64::MAX << (from % 64));
        loop {
            if x != 0 {
                return (w * 64 + x.trailing_zeros() as usize).min(hi);
            }
            w += 1;
            if w * 64 >= hi {
                return hi;
            }
            x = self.run_start[w];
        }
    }

    /// Positions a..b of the descending order, one run at a time.
    fn desc_window(&self, a: usize, b: usize) -> Vec<u32> {
        let b = b.min(self.asc.len());
        let mut out = Vec::with_capacity(b.saturating_sub(a));
        let mut d = a;
        while d < b {
            let lo = if d < self.num_len { 0 } else { self.num_len };
            let hi = if d < self.num_len { self.num_len } else { self.asc.len() };
            // Its mirror in asc, and the run around that.
            let q = hi - 1 - (d - lo);
            let (s, e) = (self.prev_start(q), self.next_start(q + 1, hi));
            let at = s + (e - 1 - q);
            let take = (e - at).min(b - d);
            out.extend_from_slice(&self.asc[at..at + take]);
            d += take;
        }
        out
    }

    /// Where asc position @p p sits in the descending order.
    fn desc_pos(&self, p: usize) -> usize {
        let (lo, hi) = self.block_of(p);
        let (s, e) = (self.prev_start(p), self.next_start(p + 1, hi));
        lo + (hi - e) + (p - s)
    }

    /// Positions a..b of the order in direction @p desc.
    fn window(&self, desc: bool, a: usize, b: usize) -> Cow<'_, [u32]> {
        let (a, b) = (a.min(self.asc.len()), b.min(self.asc.len()));
        if desc {
            Cow::Owned(self.desc_window(a, b))
        } else {
            Cow::Borrowed(&self.asc[a..b])
        }
    }

    /// The descending order, whole (the tests and the bench).
    #[allow(dead_code)]
    pub(crate) fn desc(&self) -> Vec<u32> {
        self.desc_window(0, self.asc.len())
    }

    fn bytes(&self) -> usize {
        self.asc.len() * 4 + self.run_start.len() * 8
    }
}

enum RankSlot {
    None,
    Building(Cancel),
    Ready(Arc<Rank>),
}

// ------------------------------------------------------------ typed columns

/// `length` that a u16 cannot hold (>= 65535, or not a u32): in length_exc.
const LEN_EXC: u16 = u16::MAX;
/// `fasta_hit` classes: a target hit (anything else), "-", efwd/erev.
const HIT_TARGET: u8 = 0;
const HIT_DASH: u8 = 1;
const HIT_ENTRAP: u8 = 2;

/// The typed columns of a file (GUI-DESIGN 6.1 item 7), each read as the
/// filters of `Resolved::matches` read its cell. A column the file lacks is
/// empty here (its filter never binds).
///
/// The E-value has no column of its own here: the E-value order is built
/// first and already sorts every finite value, so a max-E-value cutoff is a
/// prefix of its numeric block (found by a binary search over the file's
/// cells). Only the cells outside that block that still pass a cutoff, the
/// ones that parse to an infinity ("-inf", "-1e999"), are kept, with their
/// value. That saves 8 B per row (80 MB at 10M rows) against the < 450 MB
/// backend peak (judge 2 of item 12: the smaller cut).
pub(crate) struct Typed {
    ev_inf: Vec<(u32, f64)>,
    length: Box<[u16]>,
    /// Rows whose length is LEN_EXC: the u32 value, or None (no u32).
    length_exc: HashMap<u32, Option<u32>>,
    hit: Box<[u8]>,
    /// Index into `dict`.
    spec_id: Box<[u32]>,
    /// The distinct `spectrum` cells (as text, invalid UTF-8 read lossily).
    dict: Vec<Box<str>>,
    /// Bit i: row i's bytes are exactly its cells joined by tabs plus "\n"
    /// (one field per header column, valid UTF-8, no CR, no blank line
    /// after it, not capped), so a TSV export of all columns can copy it.
    clean: Vec<u64>,
    all_clean: bool,
}

fn bit(bits: &[u64], i: usize) -> bool {
    bits[i / 64] >> (i % 64) & 1 == 1
}

fn threads() -> usize {
    std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1).clamp(1, 8)
}

/// A growable array of plain values in an anonymous mapping of its own, for
/// the large transients of the builds and what is evicted from the cache
/// (the row offsets while they grow, the key records of an order build, the
/// orders themselves, an export's window buffers). The allocators keep a freed block of that size
/// resident for reuse (macOS's large cache, glibc's arenas), so it would
/// still count when the next build allocates: the backend peak (GUI-DESIGN
/// 7, < 450 MB at 10M rows) would be the sum of every build's transient. A
/// mapping is returned to the system when dropped. (Windows' heap already
/// returns large blocks at once: a Vec there.)
pub(crate) struct Mapped<T: Copy> {
    #[cfg(unix)]
    ptr: *mut T,
    #[cfg(unix)]
    cap: usize,
    #[cfg(unix)]
    len: usize,
    #[cfg(not(unix))]
    v: Vec<T>,
}

// SAFETY: Mapped owns its mapping exclusively, like a Vec owns its buffer.
unsafe impl<T: Copy + Send> Send for Mapped<T> {}
unsafe impl<T: Copy + Sync> Sync for Mapped<T> {}

#[cfg(unix)]
impl<T: Copy> Mapped<T> {
    pub(crate) fn with_capacity(cap: usize) -> Mapped<T> {
        let mut m = Mapped { ptr: std::ptr::NonNull::dangling().as_ptr(), cap: 0, len: 0 };
        m.grow(cap.max(1024));
        m
    }

    fn grow(&mut self, cap: usize) {
        let bytes = cap.checked_mul(std::mem::size_of::<T>()).expect("mapping size");
        // SAFETY: a fresh private anonymous mapping; checked below.
        let p = unsafe {
            libc::mmap(std::ptr::null_mut(), bytes, libc::PROT_READ | libc::PROT_WRITE, libc::MAP_PRIVATE | libc::MAP_ANON, -1, 0)
        };
        assert!(p != libc::MAP_FAILED, "out of memory mapping {bytes} bytes");
        let p = p as *mut T;
        if self.cap > 0 {
            // SAFETY: both regions hold at least len values and do not overlap.
            unsafe {
                std::ptr::copy_nonoverlapping(self.ptr, p, self.len);
                libc::munmap(self.ptr as *mut libc::c_void, self.cap * std::mem::size_of::<T>());
            }
        }
        self.ptr = p;
        self.cap = cap;
    }

    /// @p len zero values (a fresh anonymous mapping is zero-filled; only
    /// the pages written become resident). For plain integers only.
    pub(crate) fn zeroed(len: usize) -> Mapped<T> {
        let mut m = Mapped::with_capacity(len);
        m.len = len;
        m
    }

    pub(crate) fn push(&mut self, v: T) {
        if self.len == self.cap {
            self.grow(self.cap * 2);
        }
        // SAFETY: len < cap after the growth above.
        unsafe { self.ptr.add(self.len).write(v) };
        self.len += 1;
    }
}

#[cfg(unix)]
impl<T: Copy> Drop for Mapped<T> {
    fn drop(&mut self) {
        if self.cap > 0 {
            // SAFETY: the mapping made by grow(), unmapped once.
            unsafe { libc::munmap(self.ptr as *mut libc::c_void, self.cap * std::mem::size_of::<T>()) };
        }
    }
}

#[cfg(unix)]
impl<T: Copy> std::ops::Deref for Mapped<T> {
    type Target = [T];
    fn deref(&self) -> &[T] {
        // SAFETY: the first len values are initialised.
        unsafe { std::slice::from_raw_parts(self.ptr, self.len) }
    }
}

#[cfg(unix)]
impl<T: Copy> std::ops::DerefMut for Mapped<T> {
    fn deref_mut(&mut self) -> &mut [T] {
        // SAFETY: the first len values are initialised; the mapping is ours.
        unsafe { std::slice::from_raw_parts_mut(self.ptr, self.len) }
    }
}

#[cfg(not(unix))]
impl<T: Copy> Mapped<T> {
    pub(crate) fn with_capacity(cap: usize) -> Mapped<T> {
        Mapped { v: Vec::with_capacity(cap) }
    }
    pub(crate) fn zeroed(len: usize) -> Mapped<T> {
        // SAFETY: only used with plain integers, for which zero bits are a
        // value (and vec! of a zero integer asks the heap for zeroed pages).
        Mapped { v: vec![unsafe { std::mem::zeroed::<T>() }; len] }
    }
    pub(crate) fn push(&mut self, v: T) {
        self.v.push(v)
    }
}

#[cfg(not(unix))]
impl<T: Copy> std::ops::Deref for Mapped<T> {
    type Target = [T];
    fn deref(&self) -> &[T] {
        &self.v
    }
}

#[cfg(not(unix))]
impl<T: Copy> std::ops::DerefMut for Mapped<T> {
    fn deref_mut(&mut self) -> &mut [T] {
        &mut self.v
    }
}

/// Read exactly buf.len() bytes at @p off (pread; never mmap: a Windows map
/// would block the CLI's rename, and truncation raises SIGBUS).
fn read_exact_at(f: &File, buf: &mut [u8], off: u64) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::FileExt;
        f.read_exact_at(buf, off)
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::FileExt;
        let mut done = 0;
        while done < buf.len() {
            let n = f.seek_read(&mut buf[done..], off + done as u64)?;
            if n == 0 {
                return Err(std::io::ErrorKind::UnexpectedEof.into());
            }
            done += n;
        }
        Ok(())
    }
}

/// @p raw without its trailing CR/LF bytes (as fields_of drops them).
fn trim_nl(raw: &[u8]) -> &[u8] {
    let mut s = raw;
    while let [rest @ .., b'\n' | b'\r'] = s {
        s = rest;
    }
    s
}

/// The row's bytes are exactly what a TSV export of every column writes for
/// it: @p raw (capped at ROW_CAP from @p full bytes) is its @p ncols cells,
/// valid UTF-8 without CR, joined by tabs, and one LF.
fn is_clean(raw: &[u8], full: usize, ncols: usize) -> bool {
    if full > ROW_CAP || raw.last() != Some(&b'\n') {
        return false;
    }
    let line = &raw[..raw.len() - 1];
    trim_nl(line).len() == line.len()
        && !line.contains(&b'\r')
        && line.iter().filter(|b| **b == b'\t').count() + 1 == ncols
        && std::str::from_utf8(line).is_ok()
}

struct TypedCols {
    spectrum: Option<usize>,
    length: Option<usize>,
    evalue: Option<usize>,
    hit: Option<usize>,
    ncols: usize,
}

/// One thread's share of the typed pass: rows ra..rb into the given slices.
struct TypedPart<'a> {
    ra: usize,
    rb: usize,
    length: Option<&'a mut [u16]>,
    hit: Option<&'a mut [u8]>,
    spec_id: Option<&'a mut [u32]>,
    clean: &'a mut [u64],
}

/// What a part hands back: its own dictionary (local ids) and exceptions.
struct PartOut {
    dict: HashMap<Box<str>, u32>,
    exc: Vec<(u32, Option<u32>)>,
    ev_inf: Vec<(u32, f64)>,
    all_clean: bool,
}

fn typed_part(path: &str, index: &Index, cols: &TypedCols, mut part: TypedPart, cancel: &Cancel) -> Result<PartOut, String> {
    let f = File::open(path).map_err(|e| format!("cannot open {path}: {e}"))?;
    let mut out = PartOut { dict: HashMap::new(), exc: Vec::new(), ev_inf: Vec::new(), all_clean: true };
    let mut buf: Vec<u8> = Vec::new();
    let mut r = part.ra;
    while r < part.rb {
        if cancel.is_cancelled() {
            return Err(CANCELLED.into());
        }
        // Whole rows up to CHUNK bytes in one read; a longer row alone.
        let start = index.offsets[r];
        let mut e = r + 1;
        if index.end_of(r) - start <= TYPED_CHUNK as u64 {
            while e < part.rb && index.end_of(e) - start <= TYPED_CHUNK as u64 {
                e += 1;
            }
        }
        let len = if e == r + 1 { ((index.end_of(r) - start) as usize).min(ROW_CAP) } else { (index.end_of(e - 1) - start) as usize };
        buf.resize(len, 0);
        read_exact_at(&f, &mut buf, start).map_err(|e| format!("cannot read {path}: {e}"))?;
        for i in r..e {
            let a = (index.offsets[i] - start) as usize;
            let full = (index.end_of(i) - index.offsets[i]) as usize;
            let raw = &buf[a..a + full.min(ROW_CAP)];
            let k = i - part.ra;
            let line = trim_nl(raw);
            let (mut seen_len, mut seen_spec) = (false, false);
            let mut nf = 0;
            for (j, cell) in line.split(|b| *b == b'\t').enumerate() {
                nf += 1;
                if Some(j) == cols.evalue {
                    if let Ok(v) = String::from_utf8_lossy(cell).parse::<f64>() {
                        if v.is_infinite() {
                            out.ev_inf.push((i as u32, v));
                        }
                    }
                }
                if Some(j) == cols.length {
                    if let Some(l) = part.length.as_deref_mut() {
                        seen_len = true;
                        match String::from_utf8_lossy(cell).parse::<u32>() {
                            Ok(v) if v < LEN_EXC as u32 => l[k] = v as u16,
                            v => {
                                l[k] = LEN_EXC;
                                out.exc.push((i as u32, v.ok()));
                            }
                        }
                    }
                }
                if Some(j) == cols.hit {
                    if let Some(h) = part.hit.as_deref_mut() {
                        h[k] = match cell {
                            b"-" => HIT_DASH,
                            b"efwd" | b"erev" => HIT_ENTRAP,
                            _ => HIT_TARGET,
                        };
                    }
                }
                if Some(j) == cols.spectrum {
                    if let Some(s) = part.spec_id.as_deref_mut() {
                        seen_spec = true;
                        s[k] = dict_id(&mut out.dict, &String::from_utf8_lossy(cell));
                    }
                }
            }
            // A short row: the missing cells read as "".
            if !seen_len {
                if let Some(l) = part.length.as_deref_mut() {
                    l[k] = LEN_EXC;
                    out.exc.push((i as u32, None));
                }
            }
            if !seen_spec {
                if let Some(s) = part.spec_id.as_deref_mut() {
                    s[k] = dict_id(&mut out.dict, "");
                }
            }
            if nf == cols.ncols && is_clean(raw, full, cols.ncols) {
                part.clean[k / 64] |= 1 << (k % 64);
            } else {
                out.all_clean = false;
            }
        }
        r = e;
    }
    Ok(out)
}

fn dict_id(dict: &mut HashMap<Box<str>, u32>, key: &str) -> u32 {
    if let Some(&id) = dict.get(key) {
        return id;
    }
    let id = dict.len() as u32;
    dict.insert(key.into(), id);
    id
}

/// @p v cut into @p per-element parts, or @p count Nones when it is empty
/// (the file has no such column).
fn parts_of<T>(v: &mut [T], per: usize, count: usize) -> Vec<Option<&mut [T]>> {
    if v.is_empty() {
        (0..count).map(|_| None).collect()
    } else {
        v.chunks_mut(per).map(Some).collect()
    }
}

/// The typed pass: every row of @p index once, in parallel parts of whole
/// 8 MB chunks.
pub(crate) fn build_typed(path: &str, index: &Index, cancel: &Cancel) -> Result<Typed, String> {
    let n = index.offsets.len();
    let col = |name: &str| index.columns.iter().position(|c| c == name);
    let cols = TypedCols { spectrum: col("spectrum"), length: col("length"), evalue: col(RANK_COLUMN), hit: col("fasta_hit"), ncols: index.columns.len() };
    let sized = |c: Option<usize>| if c.is_some() { n } else { 0 };
    let mut length = vec![0u16; sized(cols.length)];
    let mut hit = vec![HIT_TARGET; sized(cols.hit)];
    let mut spec_id = vec![0u32; sized(cols.spectrum)];
    let mut clean = vec![0u64; n.div_ceil(64)];
    // Parts of whole bitset words.
    let per = n.div_ceil(threads()).div_ceil(64).max(1) * 64;
    let count = n.div_ceil(per);
    let outs: Vec<Result<PartOut, String>> = {
        let le = parts_of(&mut length, per, count);
        let hi = parts_of(&mut hit, per, count);
        let sp = parts_of(&mut spec_id, per, count);
        let cl: Vec<&mut [u64]> = clean.chunks_mut(per / 64).collect();
        std::thread::scope(|sc| {
            let handles: Vec<_> = le
                .into_iter()
                .zip(hi)
                .zip(sp)
                .zip(cl)
                .enumerate()
                .map(|(p, (((length, hit), spec_id), clean))| {
                    let part = TypedPart { ra: p * per, rb: ((p + 1) * per).min(n), length, hit, spec_id, clean };
                    let cols = &cols;
                    sc.spawn(move || typed_part(path, index, cols, part, cancel))
                })
                .collect();
            handles.into_iter().map(|h| h.join().unwrap_or_else(|_| Err("typed pass panicked".into()))).collect()
        })
    };
    let mut global: HashMap<Box<str>, u32> = HashMap::new();
    let mut length_exc = HashMap::new();
    let mut ev_inf = Vec::new();
    let mut all_clean = true;
    let mut remaps: Vec<Vec<u32>> = Vec::with_capacity(count);
    for out in outs {
        let out = out?;
        all_clean &= out.all_clean;
        length_exc.extend(out.exc);
        ev_inf.extend(out.ev_inf);
        let mut entries: Vec<(Box<str>, u32)> = out.dict.into_iter().collect();
        entries.sort_unstable_by_key(|e| e.1);
        let mut remap = vec![0u32; entries.len()];
        for (key, local) in entries {
            let next = global.len() as u32;
            remap[local as usize] = *global.entry(key).or_insert(next);
        }
        remaps.push(remap);
    }
    if !spec_id.is_empty() {
        for (p, ids) in spec_id.chunks_mut(per).enumerate() {
            for id in ids {
                *id = remaps[p][*id as usize];
            }
        }
    }
    let mut dict: Vec<Box<str>> = vec![Box::<str>::default(); global.len()];
    for (k, id) in global {
        dict[id as usize] = k;
    }
    Ok(Typed {
        ev_inf,
        length: length.into_boxed_slice(),
        length_exc,
        hit: hit.into_boxed_slice(),
        spec_id: spec_id.into_boxed_slice(),
        dict,
        clean,
        all_clean,
    })
}

/// Which dictionary entries contain @p needle (lowercase), case-insensitive
/// as `str::to_lowercase().contains`; matched once per distinct spectrum.
fn spec_matches(dict: &[Box<str>], needle: &str) -> Vec<bool> {
    let one = |s: &str| -> bool {
        if s.is_ascii() {
            let (h, nd) = (s.as_bytes(), needle.as_bytes());
            nd.len() <= h.len() && h.windows(nd.len()).any(|w| w.iter().zip(nd).all(|(a, b)| a.to_ascii_lowercase() == *b))
        } else {
            s.to_lowercase().contains(needle)
        }
    };
    if dict.len() < 1 << 14 {
        return dict.iter().map(|s| one(s)).collect();
    }
    let per = dict.len().div_ceil(threads());
    std::thread::scope(|sc| {
        let hs: Vec<_> = dict.chunks(per).map(|c| sc.spawn(move || c.iter().map(|s| one(s)).collect::<Vec<bool>>())).collect();
        hs.into_iter().flat_map(|h| h.join().unwrap()).collect()
    })
}

/// The rows passing @p res's row filters (all but per-spectrum), as a bitset
/// over the typed columns; parallel over whole words.
/// @p ev: the rows passing the max-E-value cutoff (evalue_bits).
fn keep_bits(t: &Typed, res: &Resolved, n: usize, ev: Option<&[u64]>) -> Vec<u64> {
    let spec_ok = res.spectrum.as_ref().map(|(_, needle)| spec_matches(&t.dict, needle));
    let pass = |i: usize| -> bool {
        if let Some(ok) = &spec_ok {
            if !ok[t.spec_id[i] as usize] {
                return false;
            }
        }
        if let Some((_, min)) = res.min_length {
            let v = t.length[i];
            let ok = if v != LEN_EXC { v as u32 >= min } else { matches!(t.length_exc.get(&(i as u32)), Some(Some(x)) if *x >= min) };
            if !ok {
                return false;
            }
        }
        if let Some(ev) = ev {
            if !bit(ev, i) {
                return false;
            }
        }
        if let Some((_, want)) = res.fasta_hit {
            let h = t.hit[i];
            let ok = match want {
                HitFilter::Target => h == HIT_TARGET,
                HitFilter::NoTarget => h != HIT_TARGET,
                HitFilter::Entrapment => h == HIT_ENTRAP,
            };
            if !ok {
                return false;
            }
        }
        true
    };
    let mut bits = vec![0u64; n.div_ceil(64)];
    let fill = |w0: usize, words: &mut [u64]| {
        for (k, word) in words.iter_mut().enumerate() {
            let base = (w0 + k) * 64;
            let mut x = 0u64;
            for b in 0..64.min(n - base) {
                if pass(base + b) {
                    x |= 1 << b;
                }
            }
            *word = x;
        }
    };
    if n < 1 << 16 {
        fill(0, &mut bits);
        return bits;
    }
    let per = bits.len().div_ceil(threads());
    std::thread::scope(|sc| {
        for (p, words) in bits.chunks_mut(per).enumerate() {
            let fill = &fill;
            sc.spawn(move || fill(p * per, words));
        }
    });
    bits
}

/// The rows whose E-value cell passes `v <= max` as f64::from_str reads it:
/// the numeric block of @p rank up to the first value above @p max (a
/// binary search reading those cells), and the infinities of @p inf.
fn evalue_bits(snap: &Snapshot, rank: &Rank, column: usize, max: f64, inf: &[(u32, f64)]) -> Result<Vec<u64>, String> {
    let (path, index) = (&snap.path, &snap.index);
    let f = File::open(path).map_err(|e| format!("cannot open {path}: {e}"))?;
    let mut buf = Vec::new();
    let mut value = |row: u32| -> Result<f64, String> {
        let (s, l) = row_span(index, row as usize);
        buf.resize(l, 0);
        read_exact_at(&f, &mut buf, s).map_err(|e| format!("cannot read {path}: {e}"))?;
        Ok(String::from_utf8_lossy(field_at(&buf, column)).parse::<f64>().unwrap_or(f64::NAN))
    };
    let (mut lo, mut hi) = (0, rank.num_len);
    while lo < hi {
        let mid = lo + (hi - lo) / 2;
        if value(rank.asc[mid])? <= max {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    let mut bits = vec![0u64; index.offsets.len().div_ceil(64)];
    for &r in &rank.asc[..lo] {
        bits[r as usize / 64] |= 1 << (r % 64);
    }
    for &(r, v) in inf {
        if v <= max {
            bits[r as usize / 64] |= 1 << (r % 64);
        }
    }
    Ok(bits)
}

/// The per-spectrum rule on @p bits: walking the E-value order, each
/// spectrum keeps its first @p nmax set rows.
fn per_spectrum(bits: &mut [u64], asc: &[u32], spec_id: &[u32], spectra: usize, nmax: u32) {
    let mut count = vec![0u32; spectra];
    for &r in asc {
        let r = r as usize;
        if bit(bits, r) {
            let c = &mut count[spec_id[r] as usize];
            if *c < nmax {
                *c += 1;
            } else {
                bits[r / 64] &= !(1 << (r % 64));
            }
        }
    }
}

/// The rows of @p order (file order when None; an order and its
/// direction) whose bit is set; parallel over spans of the order, the
/// descending one read 64k positions at a time.
fn select(order: Option<(&Rank, bool)>, bits: &[u64]) -> Vec<u32> {
    let Some((rank, desc)) = order else {
        let mut out = Vec::new();
        for (w, &word) in bits.iter().enumerate() {
            let mut x = word;
            while x != 0 {
                out.push((w * 64) as u32 + x.trailing_zeros());
                x &= x - 1;
            }
        }
        return out;
    };
    let n = rank.asc.len();
    let span = |a: usize, b: usize| -> Vec<u32> {
        let mut out = Vec::new();
        let mut k = a;
        while k < b {
            let e = (k + (1 << 16)).min(b);
            out.extend(rank.window(desc, k, e).iter().copied().filter(|&r| bit(bits, r as usize)));
            k = e;
        }
        out
    };
    if n < 1 << 16 {
        return span(0, n);
    }
    let per = n.div_ceil(threads());
    let parts: Vec<Vec<u32>> = std::thread::scope(|sc| {
        let hs: Vec<_> = (0..n).step_by(per).map(|a| {
            let span = &span;
            sc.spawn(move || span(a, (a + per).min(n)))
        }).collect();
        hs.into_iter().map(|h| h.join().unwrap()).collect()
    });
    let mut out = Vec::with_capacity(parts.iter().map(Vec::len).sum());
    for p in parts {
        out.extend_from_slice(&p);
    }
    out
}

/// Set bits per block of the cumulative counts of a Masked view.
const MASK_BLOCK_WORDS: usize = 64;

/// A view as one bit per position of its order (file order when None):
/// n/8 bytes however many rows match, where the row list would hold 4 B
/// per matching row (40 MB for a full view at 10M rows). Positions are
/// read back through the order; `cum` counts the set bits before each
/// block of MASK_BLOCK_WORDS words, so a window or a position costs one
/// binary search and at most one block of popcounts.
pub(crate) struct Masked {
    order: Option<(Arc<Rank>, bool)>,
    bits: Vec<u64>,
    cum: Vec<u32>,
    len: usize,
}

impl Masked {
    fn new(order: Option<(Arc<Rank>, bool)>, bits: Vec<u64>) -> Masked {
        let mut cum = Vec::with_capacity(bits.len().div_ceil(MASK_BLOCK_WORDS));
        let mut total = 0usize;
        for b in bits.chunks(MASK_BLOCK_WORDS) {
            cum.push(total as u32);
            total += b.iter().map(|w| w.count_ones() as usize).sum::<usize>();
        }
        Masked { order, bits, cum, len: total }
    }

    /// The position (in the order) of the @p k-th set bit, k < len.
    fn nth(&self, k: usize) -> usize {
        let blk = self.cum.partition_point(|&c| c as usize <= k) - 1;
        let mut left = k - self.cum[blk] as usize;
        let mut w = blk * MASK_BLOCK_WORDS;
        loop {
            let c = self.bits[w].count_ones() as usize;
            if left < c {
                let mut x = self.bits[w];
                for _ in 0..left {
                    x &= x - 1;
                }
                return w * 64 + x.trailing_zeros() as usize;
            }
            left -= c;
            w += 1;
        }
    }

    /// Set bits before position @p p.
    fn rank_of(&self, p: usize) -> usize {
        let (w, blk) = (p / 64, p / 64 / MASK_BLOCK_WORDS);
        let mut r = self.cum[blk] as usize;
        for &x in &self.bits[blk * MASK_BLOCK_WORDS..w] {
            r += x.count_ones() as usize;
        }
        r + (self.bits[w] & ((1u64 << (p % 64)) - 1)).count_ones() as usize
    }

    /// The rows of view positions a..b (b <= len).
    fn window(&self, a: usize, b: usize) -> Vec<u32> {
        let mut out = Vec::with_capacity(b - a);
        if a >= b {
            return out;
        }
        // The positions, then their rows one contiguous span at a time.
        let mut pos = Vec::with_capacity(b - a);
        let first = self.nth(a);
        let mut w = first / 64;
        let mut x = self.bits[w] & (u64::MAX << (first % 64));
        while pos.len() < b - a {
            while x == 0 {
                w += 1;
                x = self.bits[w];
            }
            pos.push(w * 64 + x.trailing_zeros() as usize);
            x &= x - 1;
        }
        match &self.order {
            None => out.extend(pos.iter().map(|&p| p as u32)),
            Some((r, false)) => out.extend(pos.iter().map(|&p| r.asc[p])),
            Some((r, true)) => {
                let mut i = 0;
                while i < pos.len() {
                    let mut e = i + 1;
                    while e < pos.len() && pos[e] == pos[e - 1] + 1 {
                        e += 1;
                    }
                    out.extend_from_slice(&r.window(true, pos[i], pos[e - 1] + 1));
                    i = e;
                }
            }
        }
        out
    }

    fn position(&self, row: u32) -> Option<usize> {
        let p = match &self.order {
            None => row as usize,
            Some((r, desc)) => {
                let p = r.asc.iter().position(|&i| i == row)?;
                if *desc { r.desc_pos(p) } else { p }
            }
        };
        (p < self.bits.len() * 64 && bit(&self.bits, p)).then(|| self.rank_of(p))
    }

    fn bytes(&self) -> usize {
        self.bits.len() * 8 + self.cum.len() * 4
    }
}

/// The view of @p bits (one per file row) over @p order: a row list when
/// few rows match (at most one in 32), else a Masked view (the row list
/// would be larger than the bits). Parallel over spans of the order.
fn select_view(order: Option<(Arc<Rank>, bool)>, bits: Vec<u64>) -> ViewRows {
    let n_bits = bits.len() * 64;
    let count: usize = bits.iter().map(|w| w.count_ones() as usize).sum();
    if count.saturating_mul(32) <= n_bits {
        return ViewRows::Rows(Arc::new(select(order.as_ref().map(|(r, d)| (&**r, *d)), &bits)));
    }
    let Some((rank, desc)) = order else {
        return ViewRows::Masked(Arc::new(Masked::new(None, bits)));
    };
    let n = rank.asc.len();
    let mut pos = vec![0u64; n.div_ceil(64)];
    // Whole words per thread, 64k positions per window of the order.
    let per = n.div_ceil(threads()).div_ceil(64).max(1) * 64;
    std::thread::scope(|sc| {
        for (t, words) in pos.chunks_mut(per / 64).enumerate() {
            let (rank, bits) = (&rank, &bits);
            sc.spawn(move || {
                let (a, b) = (t * per, ((t + 1) * per).min(n));
                let mut k = a;
                while k < b {
                    let e = (k + (1 << 16)).min(b);
                    for (j, &r) in rank.window(desc, k, e).iter().enumerate() {
                        if bit(bits, r as usize) {
                            let q = k + j - a;
                            words[q / 64] |= 1 << (q % 64);
                        }
                    }
                    k = e;
                }
            });
        }
    });
    drop(bits);
    ViewRows::Masked(Arc::new(Masked::new(Some((rank, desc)), pos)))
}

/// The spectrum order from the dictionary (item 8): the distinct cells
/// sorted once with the view's comparator, then the rows placed by a
/// counting sort, so ties stay in file order.
fn dict_order(t: &Typed) -> Rank {
    let m = t.dict.len();
    let keys: Vec<Option<u64>> = t.dict.iter().map(|s| numeric(s).map(total_key)).collect();
    let mut ids: Vec<u32> = (0..m as u32).collect();
    let cmp = |a: &u32, b: &u32| match (keys[*a as usize], keys[*b as usize]) {
        (Some(x), Some(y)) => x.cmp(&y),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => t.dict[*a as usize].as_bytes().cmp(t.dict[*b as usize].as_bytes()),
    };
    ids.sort_unstable_by(cmp);
    // Equal keys ("1" and "1.0") share a rank.
    let mut rank_of = vec![0u32; m];
    let mut ranks = 0u32;
    let mut num_ranks = 0u32;
    for (k, &id) in ids.iter().enumerate() {
        if k > 0 && cmp(&ids[k - 1], &id) != std::cmp::Ordering::Equal {
            ranks += 1;
        }
        rank_of[id as usize] = ranks;
        if keys[id as usize].is_some() {
            num_ranks = ranks + 1;
        }
    }
    let nr = if m == 0 { 0 } else { ranks as usize + 1 };
    let mut start = vec![0usize; nr + 1];
    for &s in t.spec_id.iter() {
        start[rank_of[s as usize] as usize + 1] += 1;
    }
    for k in 0..nr {
        start[k + 1] += start[k];
    }
    let n = t.spec_id.len();
    let num_len = start[num_ranks as usize];
    let mut run_start = vec![0u64; n.div_ceil(64)];
    for &s in &start[..nr] {
        if s < n {
            run_start[s / 64] |= 1 << (s % 64);
        }
    }
    let mut next = start;
    let mut asc: Mapped<u32> = Mapped::zeroed(n);
    for (row, &s) in t.spec_id.iter().enumerate() {
        let r = rank_of[s as usize] as usize;
        asc[next[r]] = row as u32;
        next[r] += 1;
    }
    Rank { asc, num_len, run_start }
}

// ---------------------------------------------------------------- snapshot

/// The rows of a view.
#[derive(Clone)]
pub(crate) enum ViewRows {
    /// Every row in file order.
    All(usize),
    /// A cached order, unfiltered.
    Order(Arc<Rank>, bool),
    /// The matching rows, in order.
    Rows(Arc<Vec<u32>>),
    /// The matching positions of an order, as bits.
    Masked(Arc<Masked>),
}

impl ViewRows {
    fn len(&self) -> usize {
        match self {
            ViewRows::All(n) => *n,
            ViewRows::Order(r, _) => r.asc.len(),
            ViewRows::Rows(v) => v.len(),
            ViewRows::Masked(m) => m.len,
        }
    }
    fn window(&self, offset: usize, limit: usize) -> Vec<u32> {
        let n = self.len();
        let (a, b) = (offset.min(n), offset.saturating_add(limit).min(n));
        match self {
            ViewRows::All(_) => (a..b).map(|i| i as u32).collect(),
            ViewRows::Order(r, desc) => r.window(*desc, a, b).into_owned(),
            ViewRows::Rows(v) => v[a..b].to_vec(),
            ViewRows::Masked(m) => m.window(a, b),
        }
    }
    fn position(&self, row: u32) -> Option<usize> {
        match self {
            ViewRows::All(_) => ((row as usize) < self.len()).then_some(row as usize),
            ViewRows::Order(r, desc) => {
                let p = r.asc.iter().position(|&i| i == row)?;
                Some(if *desc { r.desc_pos(p) } else { p })
            }
            ViewRows::Rows(v) => v.iter().position(|&i| i == row),
            ViewRows::Masked(m) => m.position(row),
        }
    }
    /// The bytes this view holds of its own (an order view holds none).
    fn bytes(&self) -> usize {
        match self {
            ViewRows::Rows(v) => v.len() * 4,
            ViewRows::Masked(m) => m.bytes(),
            _ => 0,
        }
    }
    /// Whether this view reads order @p r (it must go when @p r goes).
    fn reads(&self, r: &Arc<Rank>) -> bool {
        match self {
            ViewRows::Order(o, _) => Arc::ptr_eq(o, r),
            ViewRows::Masked(m) => m.order.as_ref().is_some_and(|(o, _)| Arc::ptr_eq(o, r)),
            _ => false,
        }
    }
}

/// One file as indexed, with the orders built over it. Immutable but for
/// its lazily filled slots; shared by Arc, never locked across a build.
pub(crate) struct Snapshot {
    path: String,
    len: u64,
    mtime: Option<SystemTime>,
    pub(crate) index: Index,
    rank: Mutex<RankSlot>,
    /// Signalled whenever `rank` leaves Building: callers that need the
    /// order wait for the build in flight instead of starting another.
    rank_cv: Condvar,
    /// The last MAX_VIEWS built views, newest first.
    views: Mutex<VecDeque<(ViewSpec, ViewRows)>>,
    /// View builds of this snapshot one at a time: a second query of the
    /// spec being built waits for it and takes it from `views` instead of
    /// building again (a different spec cancels the build in flight first).
    view_one: Mutex<()>,
    /// Views built on this snapshot; the tests' witness.
    views_built: AtomicUsize,
    /// Orders by columns other than the E-value one: (column, order),
    /// newest first.
    orders: Mutex<Vec<(usize, Arc<Rank>)>>,
    order_one: Mutex<()>,
    orders_built: AtomicUsize,
    typed: Mutex<Option<Arc<Typed>>>,
    typed_one: Mutex<()>,
    /// Full passes over the file after the index (rank, orders, typed
    /// columns, filter scans); the tests' witness that a filter change on
    /// the typed columns reads nothing.
    scans: AtomicUsize,
    /// Reads made for pages.
    page_reads: AtomicUsize,
    /// Exports written as a byte-range copy.
    byte_copies: AtomicUsize,
    /// CACHE_BYTES (smaller in the tests).
    cache_budget: AtomicUsize,
}

impl Snapshot {
    fn new(path: &str, len: u64, mtime: Option<SystemTime>, index: Index) -> Snapshot {
        Snapshot {
            path: path.to_string(),
            len,
            mtime,
            index,
            rank: Mutex::new(RankSlot::None),
            rank_cv: Condvar::new(),
            views: Mutex::default(),
            view_one: Mutex::new(()),
            views_built: AtomicUsize::new(0),
            orders: Mutex::default(),
            order_one: Mutex::new(()),
            orders_built: AtomicUsize::new(0),
            typed: Mutex::new(None),
            typed_one: Mutex::new(()),
            scans: AtomicUsize::new(0),
            page_reads: AtomicUsize::new(0),
            byte_copies: AtomicUsize::new(0),
            cache_budget: AtomicUsize::new(CACHE_BYTES),
        }
    }

    fn rank_ready(&self) -> Option<Arc<Rank>> {
        match &*self.rank.lock().unwrap() {
            RankSlot::Ready(r) => Some(r.clone()),
            _ => None,
        }
    }

    fn cached_view(&self, spec: &ViewSpec) -> Option<ViewRows> {
        let mut views = self.views.lock().unwrap();
        let k = views.iter().position(|(s, _)| s == spec)?;
        let hit = views.remove(k)?;
        let rows = hit.1.clone();
        views.push_front(hit);
        Some(rows)
    }

    fn cache_view(&self, spec: &ViewSpec, rows: ViewRows, keep_order: Option<usize>) {
        self.views.lock().unwrap().retain(|(s, _)| s != spec);
        self.trim(rows.bytes(), keep_order);
        let mut views = self.views.lock().unwrap();
        views.push_front((spec.clone(), rows));
        views.truncate(MAX_VIEWS);
    }

    /// The bytes held by the cached views and the orders by other columns.
    #[cfg(test)]
    fn cache_bytes(&self) -> usize {
        self.views.lock().unwrap().iter().map(|(_, v)| v.bytes()).sum::<usize>()
            + self.orders.lock().unwrap().iter().map(|(_, r)| r.bytes()).sum::<usize>()
    }

    /// Make room for @p incoming bytes under CACHE_BYTES: the oldest views
    /// first, then the oldest orders but the one by @p keep_order. An order
    /// leaves together with the views that read it, so that it is freed.
    fn trim(&self, incoming: usize, keep_order: Option<usize>) {
        let budget = self.cache_budget.load(Ordering::Relaxed);
        let mut views = self.views.lock().unwrap();
        let mut orders = self.orders.lock().unwrap();
        let used = |v: &VecDeque<(ViewSpec, ViewRows)>, o: &Vec<(usize, Arc<Rank>)>| {
            v.iter().map(|(_, x)| x.bytes()).sum::<usize>() + o.iter().map(|(_, r)| r.bytes()).sum::<usize>()
        };
        while used(&views, &orders) + incoming > budget && views.pop_back().is_some() {}
        while used(&views, &orders) + incoming > budget {
            let Some(k) = orders.iter().rposition(|(c, _)| Some(*c) != keep_order) else {
                break;
            };
            let (_, gone) = orders.remove(k);
            views.retain(|(_, v)| !v.reads(&gone));
        }
    }

    /// Keep @p rank as the newest order, within MAX_ORDERS and CACHE_BYTES
    /// (an order leaves with the views that read it).
    fn cache_order(&self, column: usize, rank: Arc<Rank>) {
        self.trim(rank.bytes(), None);
        let mut views = self.views.lock().unwrap();
        let mut orders = self.orders.lock().unwrap();
        orders.insert(0, (column, rank));
        let keep = MAX_ORDERS.min(orders.len());
        for (_, gone) in orders.split_off(keep) {
            views.retain(|(_, v)| !v.reads(&gone));
        }
    }

    fn cached_order(&self, column: usize) -> Option<Arc<Rank>> {
        let mut orders = self.orders.lock().unwrap();
        let k = orders.iter().position(|(c, _)| *c == column)?;
        let hit = orders.remove(k);
        let r = hit.1.clone();
        orders.insert(0, hit);
        Some(r)
    }

    /// The start of the cached rows of @p spec (the tests' witness that a
    /// view was not rebuilt).
    #[cfg(test)]
    fn view_ptr(&self, spec: &ViewSpec) -> Option<*const u32> {
        self.views.lock().unwrap().iter().find(|(s, _)| s == spec).and_then(|(_, v)| match v {
            ViewRows::Rows(r) => Some(r.as_ptr()),
            ViewRows::Order(r, false) => Some(r.asc.as_ptr()),
            ViewRows::Masked(m) => Some(m.bits.as_ptr() as *const u32),
            _ => None,
        })
    }
}

/// The file the renderer has open, and where its events go.
struct OpenState {
    path: String,
    generation: u64,
    emit: Emit,
    /// Cancels this open's index, rank and typed builds.
    index: Cancel,
}

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
    /// Files with more rows are not typed (item 12).
    typed_max_rows: AtomicUsize,
    /// The transient budget of an order build by another column.
    order_budget: AtomicUsize,
    /// Running exports: id -> (token, destination).
    jobs: Mutex<HashMap<u64, (Cancel, String)>>,
    next_job: AtomicU64,
}

impl Default for Shared {
    fn default() -> Shared {
        Shared {
            snaps: RwLock::default(),
            build: Mutex::new(()),
            generation: AtomicU64::new(0),
            open: Mutex::new(None),
            view_build: Mutex::new(None),
            typed_max_rows: AtomicUsize::new(TYPED_MAX_ROWS),
            order_budget: AtomicUsize::new(ORDER_BUDGET),
            jobs: Mutex::default(),
            next_job: AtomicU64::new(0),
        }
    }
}

#[derive(Default, Clone)]
pub struct BrowserCache(Arc<Shared>);

fn fields_of(raw: &[u8]) -> Vec<String> {
    trim_nl(raw).split(|b| *b == b'\t').map(|f| String::from_utf8_lossy(f).into_owned()).collect()
}

/// Field @p col of a raw row as `fields_of(raw)[col]` would give it (missing:
/// empty), without splitting the rest of the row.
fn field_at(raw: &[u8], col: usize) -> &[u8] {
    trim_nl(raw).split(|b| *b == b'\t').nth(col).unwrap_or(b"")
}

pub(crate) fn build_index(path: &str, cancel: &Cancel) -> Result<Index, String> {
    let file = File::open(path).map_err(|e| format!("cannot open {path}: {e}"))?;
    let mut reader = BufReader::with_capacity(1 << 20, file);
    // One pass counting newlines chunk-wise: line content is not needed here,
    // so a multi-GB file costs one buffer, not one allocation per row.
    let mut offsets: Mapped<u64> = Mapped::with_capacity(1 << 16);
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
    /// (spectrum column, evalue column, N)
    per_spectrum: Option<(usize, usize, u32)>,
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
            per_spectrum: match (col("spectrum"), col(RANK_COLUMN), spec.per_spectrum) {
                (Some(s), Some(e), Some(n)) if n > 0 => Some((s, e, n)),
                _ => None,
            },
        }
    }

    fn has_filters(&self) -> bool {
        self.spectrum.is_some()
            || self.min_length.is_some()
            || self.max_evalue.is_some()
            || self.fasta_hit.is_some()
            || self.per_spectrum.is_some()
    }

    fn is_trivial(&self) -> bool {
        self.sort.is_none() && !self.has_filters()
    }

    /// The row filters (all but per-spectrum, which is not row-local).
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

/// The rows matching @p res's row filters, as a bitset in file order: the
/// chunk-scan fallback for a file beyond the typed budget (item 12).
fn filter_rows(path: &str, index: &Index, res: &Resolved, cancel: &Cancel) -> Result<Vec<u64>, String> {
    let file = File::open(path).map_err(|e| format!("cannot open {path}: {e}"))?;
    let mut reader = BufReader::with_capacity(1 << 20, file);
    reader
        .seek(SeekFrom::Start(index.offsets.first().copied().unwrap_or(index.data_end)))
        .map_err(|e| e.to_string())?;
    let n = index.offsets.len();
    let mut keep = vec![0u64; n.div_ceil(64)];
    let mut raw: Vec<u8> = Vec::new();
    for i in 0..n {
        if i % 65536 == 0 && cancel.is_cancelled() {
            return Err(CANCELLED.into());
        }
        let (start, len) = row_span(index, i);
        let full = (index.end_of(i) - start) as usize;
        raw.resize(len, 0);
        reader.read_exact(&mut raw).map_err(|e| format!("cannot read {path}: {e}"))?;
        if full > len {
            reader.seek_relative((full - len) as i64).map_err(|e| e.to_string())?;
        }
        if res.matches(&fields_of(&raw)) {
            keep[i / 64] |= 1 << (i % 64);
        }
    }
    Ok(keep)
}

/// f64 -> u64 with the order of `f64::total_cmp` (core's own transform).
fn total_key(v: f64) -> u64 {
    let mut b = v.to_bits() as i64;
    b ^= (((b >> 63) as u64) >> 1) as i64;
    (b as u64) ^ (1 << 63)
}

/// The E-value order (D5) of @p index's rows by column @p column: build_order
/// with room for all 8 key bytes of a number in one round (9 B per row of
/// transients, one read of the column). @p progress gets (rows read, rows)
/// now and then.
pub(crate) fn build_rank(
    path: &str,
    index: &Index,
    column: usize,
    cancel: &Cancel,
    progress: &dyn Fn(usize, usize),
) -> Result<Rank, String> {
    build_order(path, index, column, index.offsets.len().saturating_mul(9), cancel, progress)
}

/// The transient budget of an order build by a column other than the
/// E-value one (GUI-DESIGN 7: backend peak < 450 MB at 10M rows, the cache
/// and the new order included). A build never holds less than 4 B per row.
const ORDER_BUDGET: usize = 32 << 20;

/// Groups up to this size are sorted through a buffer of (key, slot) pairs;
/// larger ones in place (16 B per entry: the buffer stays at 4 MB).
const SORT_BUF: usize = 1 << 18;

/// The sort key of a cell for build_order: the finite numbers' total_key
/// (8 bytes, big-endian, so bytes order as values; block 0) or the cell's
/// bytes (block 1), as build_view's comparator sees them.
fn order_bytes<'a>(cell: &'a [u8], num: &'a mut [u8; 8]) -> (u8, Cow<'a, [u8]>) {
    let text = String::from_utf8_lossy(cell);
    match numeric(&text) {
        Some(v) => {
            *num = total_key(v).to_be_bytes();
            (0, Cow::Borrowed(&num[..]))
        }
        None => (
            1,
            match text {
                Cow::Borrowed(s) => Cow::Borrowed(s.as_bytes()),
                Cow::Owned(s) => Cow::Owned(s.into_bytes()),
            },
        ),
    }
}

/// One round's slots: rows -> records of `w` key bytes from byte `off` of
/// each cell (zero-padded) and one flag byte, block << 7 | min(bytes left,
/// w + 1). For two cells with the same first `off` bytes, comparing records
/// bytewise orders them as their bytes do, w + 1 meaning "more follows":
/// a zero pad sorts before every byte but NUL, and the count settles a NUL
/// against the end of the cell.
struct Round {
    off: usize,
    w: usize,
    /// slot * (w + 1): the records.
    rec: Mapped<u8>,
    /// The rows with a slot, ascending (slot k is rows[k]); None: every
    /// row, slot = row.
    rows: Option<Mapped<u32>>,
}

impl Round {
    fn stride(&self) -> usize {
        self.w + 1
    }
    fn rec(&self, slot: u32) -> &[u8] {
        let s = self.stride();
        &self.rec[slot as usize * s..slot as usize * s + s]
    }
}

/// Fill @p round's records from one read of the column, on up to threads()
/// threads (each its own share of the slots, read in spans of up to
/// ROW_CAP bytes into its part of @p bufs, threads() * ROW_CAP bytes kept
/// across the rounds: no allocation per thread). Only the rows with a slot
/// are read (with `rows` unset, those set in @p need, or every row).
/// @p report gets (rows read, rows) on this thread now and then.
#[allow(clippy::too_many_arguments)]
fn fill_round(
    path: &str,
    index: &Index,
    column: usize,
    round: &mut Round,
    need: Option<&[u64]>,
    bufs: &mut [u8],
    cancel: &Cancel,
    report: Option<&dyn Fn(usize, usize)>,
) -> Result<(), String> {
    let n = index.offsets.len();
    let slots = round.rows.as_ref().map_or(n, |r| r.len());
    if slots == 0 {
        return Ok(());
    }
    let (off, w, s) = (round.off, round.w, round.stride());
    let parts = threads().min(slots.div_ceil(1 << 16)).max(1);
    let done = AtomicUsize::new(0);
    let rows: Option<&[u32]> = round.rows.as_deref();
    let mut rest: &mut [u8] = &mut round.rec;
    let mut spans = bufs.chunks_mut(ROW_CAP);
    let mut jobs: Vec<(usize, usize, &mut [u8], &mut [u8])> = Vec::with_capacity(parts);
    for p in 0..parts {
        let (ka, kb) = (slots * p / parts, slots * (p + 1) / parts);
        let (mine, tail) = std::mem::take(&mut rest).split_at_mut((kb - ka) * s);
        rest = tail;
        jobs.push((ka, kb, mine, spans.next().expect("a span buffer per thread")));
    }
    let work = |ka: usize, kb: usize, out: &mut [u8], span: &mut [u8]| -> Result<(), String> {
        if ka == kb {
            return Ok(());
        }
        let row_of = |k: usize| rows.map_or(k, |r| r[k] as usize);
        let file = File::open(path).map_err(|e| format!("cannot open {path}: {e}"))?;
        // span[..have] holds the file's bytes from `at`.
        let (mut at, mut have) = (0u64, 0usize);
        let mut num = [0u8; 8];
        for k in ka..kb {
            if (k - ka) % 65536 == 65535 {
                if cancel.is_cancelled() {
                    return Err(CANCELLED.into());
                }
                done.fetch_add(65536, Ordering::Relaxed);
            }
            let i = row_of(k);
            if need.is_some_and(|b| !bit(b, i)) {
                continue;
            }
            let (start, len) = row_span(index, i);
            if start < at || start + len as u64 > at + have as u64 {
                // The next span from this row on (a capped row fits).
                have = ((index.data_end - start) as usize).min(span.len()).max(len);
                read_exact_at(&file, &mut span[..have], start).map_err(|e| format!("cannot read {path}: {e}"))?;
                at = start;
            }
            let a = (start - at) as usize;
            let (block, b) = order_bytes(field_at(&span[a..a + len], column), &mut num);
            let left = &b[off.min(b.len())..];
            let take = left.len().min(w);
            let r = &mut out[(k - ka) * s..(k - ka + 1) * s];
            r[..take].copy_from_slice(&left[..take]);
            r[w] = block << 7 | left.len().min(w + 1) as u8;
        }
        Ok(())
    };
    let work = &work;
    if jobs.len() == 1 {
        let (ka, kb, out, span) = jobs.pop().expect("one job");
        return work(ka, kb, out, span);
    }
    let me = std::thread::current();
    let results: Vec<Result<(), String>> = std::thread::scope(|sc| {
        let handles: Vec<_> = jobs
            .into_iter()
            .map(|(ka, kb, out, span)| {
                let me = me.clone();
                sc.spawn(move || {
                    let r = work(ka, kb, out, span);
                    me.unpark();
                    r
                })
            })
            .collect();
        if let Some(progress) = report {
            let mut last = Instant::now();
            while !handles.iter().all(|h| h.is_finished()) {
                std::thread::park_timeout(Duration::from_millis(20));
                if last.elapsed().as_millis() >= 100 {
                    progress(done.load(Ordering::Relaxed).min(n), n);
                    last = Instant::now();
                }
            }
        }
        handles.into_iter().map(|h| h.join().unwrap_or_else(|_| Err("order build failed".into()))).collect()
    });
    results.into_iter().collect()
}

/// Sort the slots @p g of one group by (record, slot) (slot order is file
/// order), then mark where @p g's subgroups of equal records start in
/// @p run_start (from position @p at) and which of them are still open
/// (more than one slot, bytes left in each) in @p open.
fn sort_group(round: &Round, g: &mut [u32], at: usize, buf: &mut Vec<(u64, u32)>, run_start: &mut [u64], open: &mut [u64]) {
    let s = round.stride();
    let key8 = |slot: u32| -> u64 {
        let r = round.rec(slot);
        let mut k = [0u8; 8];
        let m = r.len().min(8);
        k[..m].copy_from_slice(&r[..m]);
        u64::from_be_bytes(k)
    };
    if g.len() > 1 {
        if g.len() <= SORT_BUF {
            buf.clear();
            buf.extend(g.iter().map(|&k| (key8(k), k)));
            if s <= 8 {
                buf.sort_unstable();
            } else {
                buf.sort_unstable_by(|a, b| a.0.cmp(&b.0).then_with(|| round.rec(a.1)[8..].cmp(&round.rec(b.1)[8..])).then(a.1.cmp(&b.1)));
            }
            for (x, &(_, k)) in g.iter_mut().zip(buf.iter()) {
                *x = k;
            }
        } else {
            g.sort_unstable_by(|&a, &b| round.rec(a).cmp(round.rec(b)).then(a.cmp(&b)));
        }
    }
    let set = |bits: &mut [u64], i: usize| bits[i / 64] |= 1 << (i % 64);
    let clear = |bits: &mut [u64], i: usize| bits[i / 64] &= !(1 << (i % 64));
    let mut a = 0;
    while a < g.len() {
        let mut e = a + 1;
        while e < g.len() && round.rec(g[e]) == round.rec(g[a]) {
            e += 1;
        }
        set(run_start, at + a);
        let more = (round.rec(g[a])[round.w] & 0x7f) as usize == round.w + 1;
        for q in at + a..at + e {
            if more && e - a > 1 {
                set(open, q);
            } else {
                clear(open, q);
            }
        }
        a = e;
    }
}

/// What build_order holds besides the order it returns, at most: the
/// records of a round (every row a slot), the span buffers, two bitsets and
/// the group sort's buffer (open rounds hold no more than that).
fn order_transient(n: usize, budget: usize) -> usize {
    let per_row = budget.checked_div(n).map_or(0, |b| b.clamp(4, 121));
    n * per_row + threads() * ROW_CAP + 2 * n.div_ceil(64) * 8 + SORT_BUF * 16
}

/// The order of @p index's rows by column @p column, as build_view sorts it
/// ascending (finite numbers by value, then every other cell by its bytes,
/// ties in file order), within about @p budget bytes of transients besides
/// the order itself (never less than 4 B per row). An MSD radix sort over
/// the cell bytes in rounds (item 8, GUI-DESIGN 7): each round reads the
/// column once more for the rows whose group of equal keys is still open,
/// takes the next bytes of each such cell (as many as the budget allows,
/// at least 3) and sorts each open group by them. The numbers are 8 key
/// bytes each. No cell is held whole: a re-sort by text at 10M rows needs
/// 4 B per row for the keys and 4 B for the order.
pub(crate) fn build_order(
    path: &str,
    index: &Index,
    column: usize,
    budget: usize,
    cancel: &Cancel,
    progress: &dyn Fn(usize, usize),
) -> Result<Rank, String> {
    let n = index.offsets.len();
    let words = n.div_ceil(64);
    let mut asc: Mapped<u32> = Mapped::zeroed(n);
    let mut run_start = vec![0u64; words];
    if n == 0 {
        progress(0, 0);
        return Ok(Rank { asc, num_len: 0, run_start });
    }
    let mut open = vec![0u64; words];
    let mut buf: Vec<(u64, u32)> = Vec::new();
    let mut bufs: Mapped<u8> = Mapped::zeroed(threads() * ROW_CAP);
    // Round 0: every row; first by (block, first two key bytes), then each
    // such bucket by its records.
    let w = (budget / n).clamp(4, 121) - 1;
    let mut round = Round { off: 0, w, rec: Mapped::zeroed(n * (w + 1)), rows: None };
    fill_round(path, index, column, &mut round, None, &mut bufs, cancel, Some(progress))?;
    if cancel.is_cancelled() {
        return Err(CANCELLED.into());
    }
    progress(n, n);
    let bucket = |r: &[u8]| (((r[w] >> 7) as usize) << 16) | (r[0] as usize) << 8 | r[1] as usize;
    let mut next = vec![0u32; (2 << 16) + 1];
    for row in 0..n as u32 {
        next[bucket(round.rec(row)) + 1] += 1;
    }
    for b in 0..2 << 16 {
        next[b + 1] += next[b];
    }
    let num_len = next[1 << 16] as usize;
    let starts = next.clone();
    for row in 0..n as u32 {
        let b = bucket(round.rec(row));
        asc[next[b] as usize] = row;
        next[b] += 1;
    }
    drop(next);
    for b in 0..2 << 16 {
        let (a, e) = (starts[b] as usize, starts[b + 1] as usize);
        if a < e {
            sort_group(&round, &mut asc[a..e], a, &mut buf, &mut run_start, &mut open);
        }
    }
    drop(starts);
    let mut off = w;
    drop(round);
    // Later rounds: the open groups only.
    loop {
        if cancel.is_cancelled() {
            return Err(CANCELLED.into());
        }
        let u: usize = open.iter().map(|x| x.count_ones() as usize).sum();
        if u == 0 {
            break;
        }
        let compact = u <= n / 2;
        let mut need: Option<Vec<u64>> = None;
        let mut round = if compact {
            let w = (budget / u).saturating_sub(4).clamp(4, 121) - 1;
            let mut rows: Mapped<u32> = Mapped::with_capacity(u);
            for (q, &r) in asc.iter().enumerate() {
                if bit(&open, q) {
                    rows.push(r);
                }
            }
            rows.sort_unstable();
            Round { off, w, rec: Mapped::zeroed(u * (w + 1)), rows: Some(rows) }
        } else {
            // Every row has a slot; only the open ones are read (the
            // others' records stay zero, and nothing reads them).
            let mut bits = vec![0u64; words];
            for (q, &r) in asc.iter().enumerate() {
                if bit(&open, q) {
                    bits[r as usize / 64] |= 1 << (r % 64);
                }
            }
            need = Some(bits);
            let w = (budget / n).clamp(4, 121) - 1;
            Round { off, w, rec: Mapped::zeroed(n * (w + 1)), rows: None }
        };
        fill_round(path, index, column, &mut round, need.as_deref(), &mut bufs, cancel, None)?;
        drop(need);
        // Open positions: rows -> slots, each open group sorted, back.
        if let Some(rows) = &round.rows {
            for (q, x) in asc.iter_mut().enumerate() {
                if bit(&open, q) {
                    *x = rows.binary_search(x).expect("an open row has a slot") as u32;
                }
            }
        }
        let mut q = 0;
        while q < n {
            if !bit(&open, q) {
                q += 1;
                continue;
            }
            let mut e = q + 1;
            while e < n && bit(&open, e) && !bit(&run_start, e) {
                e += 1;
            }
            sort_group(&round, &mut asc[q..e], q, &mut buf, &mut run_start, &mut open);
            if let Some(rows) = &round.rows {
                for x in &mut asc[q..e] {
                    *x = rows[*x as usize];
                }
            }
            q = e;
        }
        off += round.w;
    }
    Ok(Rank { asc, num_len, run_start })
}

/// The rows @p rows of @p snap, in that order (item 10): sorted by offset,
/// contiguous rows merged into one read of up to CHUNK bytes, mapped back.
fn read_rows(snap: &Snapshot, rows: &[u32]) -> Result<Vec<Vec<String>>, String> {
    let (path, index) = (&snap.path, &snap.index);
    let f = File::open(path).map_err(|e| format!("cannot open {path}: {e}"))?;
    let mut by_offset: Vec<usize> = (0..rows.len()).collect();
    by_offset.sort_unstable_by_key(|&k| rows[k]);
    let mut out: Vec<Vec<String>> = vec![Vec::new(); rows.len()];
    let mut buf: Vec<u8> = Vec::new();
    let mut j = 0;
    while j < by_offset.len() {
        let r0 = rows[by_offset[j]] as usize;
        let start = index.offsets[r0];
        let mut end = index.end_of(r0);
        let mut e = j + 1;
        if end - start <= ROW_CAP as u64 {
            while e < by_offset.len() {
                let r = rows[by_offset[e]] as usize;
                let (s, re) = (index.offsets[r], index.end_of(r));
                if s != end || re - s > ROW_CAP as u64 || re - start > CHUNK as u64 {
                    break;
                }
                end = re;
                e += 1;
            }
        }
        let len = ((end - start) as usize).min(if e == j + 1 { ROW_CAP } else { usize::MAX });
        buf.resize(len, 0);
        read_exact_at(&f, &mut buf, start).map_err(|e| format!("cannot read {path}: {e}"))?;
        snap.page_reads.fetch_add(1, Ordering::Relaxed);
        for &k in &by_offset[j..e] {
            let (s, l) = row_span(index, rows[k] as usize);
            let a = (s - start) as usize;
            out[k] = fields_of(&buf[a..a + l]);
        }
        j = e;
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

    /// The snapshot of @p path, fresh or not (tests).
    #[cfg(test)]
    fn fresh_any(&self, path: &str) -> Option<Arc<Snapshot>> {
        self.snaps.read().unwrap().iter().find(|s| s.path == path).cloned()
    }

    /// The token that cancels an index build of @p path: the open's, when
    /// @p path is the open file (opening another file then cancels it).
    fn index_token(&self, path: &str) -> Option<Cancel> {
        match &*self.open.lock().unwrap() {
            Some(o) if o.path == path => Some(o.index.clone()),
            _ => None,
        }
    }

    /// The snapshot of @p path as the tests need it: built even when @p path
    /// is not the open file.
    #[cfg(test)]
    fn snapshot(&self, path: &str) -> Result<Arc<Snapshot>, String> {
        self.snapshot_mode(path, Mode::Exact)
    }

    /// The snapshot of @p path, indexing it first when it is new or changed
    /// (len, mtime). The map lock is never held during the scan. The build's
    /// token is resolved before waiting for `build`, so a build that waited
    /// while another file was opened stops instead of indexing a file nobody
    /// has open with a token nothing cancels. An Interactive call for a file
    /// that is not open does not index it at all.
    fn snapshot_mode(&self, path: &str, mode: Mode) -> Result<Arc<Snapshot>, String> {
        let (len, mtime) = file_meta(path)?;
        if let Some(s) = self.fresh(path, len, mtime) {
            return Ok(s);
        }
        let token = match (self.index_token(path), mode) {
            (Some(t), _) => t,
            (None, Mode::Interactive) => return Err(CANCELLED.into()),
            (None, Mode::Exact) => Cancel::default(),
        };
        let _one = self.build.lock().unwrap_or_else(|e| e.into_inner());
        // Another build may have finished while this one waited.
        if let Some(s) = self.fresh(path, len, mtime) {
            return Ok(s);
        }
        if token.is_cancelled() {
            return Err(CANCELLED.into());
        }
        let index = build_index(path, &token)?;
        let snap = Arc::new(Snapshot::new(path, len, mtime, index));
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
    /// exists or is being built. True when it is (now) being built. The
    /// typed columns follow it on the same thread.
    fn start_rank(self: &Arc<Self>, snap: &Arc<Snapshot>) -> bool {
        let Some(column) = snap.index.columns.iter().position(|c| c == RANK_COLUMN) else {
            return false;
        };
        let token = {
            let mut slot = snap.rank.lock().unwrap();
            match &*slot {
                RankSlot::Ready(_) => return false,
                // A cancelled build (the file was closed, then re-opened
                // before that build reached a cancel check) ends without an
                // event: start a new one. The old worker leaves this slot
                // alone (its token is not the one installed here).
                RankSlot::Building(t) if !t.is_cancelled() => return true,
                RankSlot::Building(_) | RankSlot::None => {}
            }
            let t = Cancel::default();
            *slot = RankSlot::Building(t.clone());
            t
        };
        // Only the open file is ranked: a late page query of a file closed
        // since must not start a build nothing would cancel. Checked after
        // installing the token, so an open() of another file either sees
        // this build and cancels it, or ran before the check.
        if self.index_token(&snap.path).is_none() {
            let mut slot = snap.rank.lock().unwrap();
            if matches!(&*slot, RankSlot::Building(t) if Arc::ptr_eq(&t.0, &token.0)) {
                *slot = RankSlot::None;
            }
            return false;
        }
        let (me, snap) = (self.clone(), snap.clone());
        std::thread::spawn(move || {
            let path = snap.path.clone();
            let progress = |done: usize, total: usize| {
                me.emit_for(&path, |generation| BrowserEvent::RankProgress { generation, done, total })
            };
            snap.scans.fetch_add(1, Ordering::Relaxed);
            let built = build_rank(&path, &snap.index, column, &token, &progress);
            let mut slot = snap.rank.lock().unwrap();
            match built {
                Ok(rank) => {
                    *slot = RankSlot::Ready(Arc::new(rank));
                    drop(slot);
                    snap.rank_cv.notify_all();
                    me.emit_for(&path, |generation| BrowserEvent::Ranked {
                        generation,
                        column: RANK_COLUMN.into(),
                    });
                    me.typed_in_background(&snap);
                }
                Err(e) => {
                    // A later query may start it again.
                    if matches!(&*slot, RankSlot::Building(t) if Arc::ptr_eq(&t.0, &token.0)) {
                        *slot = RankSlot::None;
                    }
                    drop(slot);
                    snap.rank_cv.notify_all();
                    if e != CANCELLED {
                        me.emit_for(&path, |generation| BrowserEvent::Failed { generation, message: e });
                    }
                }
            }
        });
        true
    }

    /// The E-value order of @p snap, now (an export, the per-spectrum rule,
    /// and the max-E-value cutoff outside the table). A build in flight is
    /// waited for, never doubled: two rank builds side by side would hold
    /// their 9 B per row transients twice. With none in flight it is built
    /// here, and other callers wait for this one. @p token (the caller's
    /// view or export token) stops the wait and a build made here; the
    /// slot's own token marks the build in flight only, so an open of
    /// another file does not stop an export's build.
    fn rank_now(self: &Arc<Self>, snap: &Arc<Snapshot>, column: usize, token: &Cancel) -> Result<Arc<Rank>, String> {
        let mut slot = snap.rank.lock().unwrap();
        loop {
            match &*slot {
                RankSlot::Ready(r) => return Ok(r.clone()),
                RankSlot::Building(t) if !t.is_cancelled() => {
                    if token.is_cancelled() {
                        return Err(CANCELLED.into());
                    }
                    slot = snap.rank_cv.wait_timeout(slot, Duration::from_millis(20)).unwrap().0;
                }
                RankSlot::Building(_) | RankSlot::None => break,
            }
        }
        if token.is_cancelled() {
            return Err(CANCELLED.into());
        }
        let mark = Cancel::default();
        *slot = RankSlot::Building(mark.clone());
        drop(slot);
        let mine = Cancel::child_of(token);
        snap.scans.fetch_add(1, Ordering::Relaxed);
        let built = build_rank(&snap.path, &snap.index, column, &mine, &|_, _| {});
        let mut slot = snap.rank.lock().unwrap();
        let out = match built {
            Ok(r) => {
                let r = Arc::new(r);
                *slot = RankSlot::Ready(r.clone());
                Ok(r)
            }
            Err(e) => {
                if matches!(&*slot, RankSlot::Building(t) if Arc::ptr_eq(&t.0, &mark.0)) {
                    *slot = RankSlot::None;
                }
                Err(e)
            }
        };
        drop(slot);
        snap.rank_cv.notify_all();
        if out.is_ok() {
            // No background build announces this order: a table showing
            // file order would never swap.
            self.emit_for(&snap.path, |generation| BrowserEvent::Ranked { generation, column: RANK_COLUMN.into() });
            self.typed_in_background(snap);
        }
        out
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

    /// The typed columns of @p snap, built now (one build at a time; a
    /// second caller waits for it). None beyond the typed budget.
    fn typed_now(&self, snap: &Snapshot, cancel: &Cancel) -> Result<Option<Arc<Typed>>, String> {
        if snap.index.offsets.len() > self.typed_max_rows.load(Ordering::Relaxed) {
            return Ok(None);
        }
        if let Some(t) = snap.typed.lock().unwrap().clone() {
            return Ok(Some(t));
        }
        let _one = snap.typed_one.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(t) = snap.typed.lock().unwrap().clone() {
            return Ok(Some(t));
        }
        if cancel.is_cancelled() {
            return Err(CANCELLED.into());
        }
        snap.scans.fetch_add(1, Ordering::Relaxed);
        let built = build_typed(&snap.path, &snap.index, cancel);
        let t = Arc::new(built?);
        *snap.typed.lock().unwrap() = Some(t.clone());
        Ok(Some(t))
    }

    /// The typed columns of the open file, on a thread, with the open's
    /// token (opening another file stops it).
    fn typed_in_background(self: &Arc<Self>, snap: &Arc<Snapshot>) {
        let Some(token) = self.index_token(&snap.path) else {
            return;
        };
        let (me, snap) = (self.clone(), snap.clone());
        std::thread::spawn(move || {
            let _ = me.typed_now(&snap, &token);
        });
    }

    /// The token typed builds of a query use: the open's for the open file,
    /// so that a new view spec does not throw a half-built pass away.
    fn typed_token(&self, snap: &Snapshot, mode: Mode, job: &Cancel) -> Cancel {
        match mode {
            Mode::Interactive => self.index_token(&snap.path).unwrap_or_default(),
            Mode::Exact => job.clone(),
        }
    }

    /// The order of @p snap's rows by column @p column (not the E-value
    /// one), built once and cached (item 8): spectrum through the typed
    /// dictionary, any other column through one read of that column.
    fn order_for(&self, snap: &Snapshot, column: usize, mode: Mode, token: &Cancel) -> Result<Arc<Rank>, String> {
        if let Some(r) = snap.cached_order(column) {
            return Ok(r);
        }
        let _one = snap.order_one.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(r) = snap.cached_order(column) {
            return Ok(r);
        }
        // Room for the new order and its build's transients (GUI-DESIGN 7:
        // the cache and a build together stay within the cache budget; the
        // spectrum's dictionary order holds little besides its order).
        let n = snap.index.offsets.len();
        let budget = self.order_budget.load(Ordering::Relaxed);
        let spectrum = snap.index.columns.iter().position(|c| c == "spectrum");
        let transient = if Some(column) == spectrum { 0 } else { order_transient(n, budget) };
        snap.trim(n * 4 + n.div_ceil(64) * 8 + transient, None);
        let typed = if Some(column) == spectrum { self.typed_now(snap, &self.typed_token(snap, mode, token))? } else { None };
        let r = Arc::new(match typed {
            Some(t) => dict_order(&t),
            None => {
                snap.scans.fetch_add(1, Ordering::Relaxed);
                build_order(&snap.path, &snap.index, column, budget, token, &|_, _| {})?
            }
        });
        snap.orders_built.fetch_add(1, Ordering::SeqCst);
        snap.cache_order(column, r.clone());
        Ok(r)
    }

    /// The rows of @p spec's view on @p snap, and whether they are in its
    /// order (ranked) and the E-value order is coming (pending). @p job is
    /// an export's token: its builds stop only on that token.
    fn view_of(self: &Arc<Self>, snap: &Arc<Snapshot>, spec: &ViewSpec, mode: Mode, job: Option<&Cancel>) -> Result<(ViewRows, bool, bool), String> {
        let index = &snap.index;
        let res = Resolved::bind(spec, &index.columns);
        let n = index.offsets.len();
        if res.is_trivial() {
            return Ok((ViewRows::All(n), true, false));
        }
        let rank_col = index.columns.iter().position(|c| c == RANK_COLUMN);
        let by_rank = matches!((res.sort, rank_col), (Some((c, _)), Some(r)) if c == r);
        if by_rank && !res.has_filters() {
            let desc = res.sort.map(|(_, d)| d).unwrap_or(false);
            let rank = match (snap.rank_ready(), mode) {
                (Some(r), _) => Some(r),
                (None, Mode::Exact) => Some(self.rank_now(snap, rank_col.unwrap(), &job.cloned().unwrap_or_default())?),
                (None, Mode::Interactive) => None,
            };
            return Ok(match rank {
                Some(r) => (ViewRows::Order(r, desc), true, false),
                // D5: file order now, the ranked order when it is ready.
                None => (ViewRows::All(n), false, self.start_rank(snap)),
            });
        }
        if let Some(v) = snap.cached_view(spec) {
            return Ok((v, true, false));
        }
        let token = match (job, mode) {
            (Some(t), _) => t.clone(),
            (None, Mode::Interactive) => self.view_token(&snap.path, spec),
            (None, Mode::Exact) => Cancel::default(),
        };
        let _one = snap.view_one.lock().unwrap_or_else(|e| e.into_inner());
        // The same spec, built while this query waited.
        if let Some(v) = snap.cached_view(spec) {
            return Ok((v, true, false));
        }
        if token.is_cancelled() {
            return Err(CANCELLED.into());
        }
        snap.views_built.fetch_add(1, Ordering::SeqCst);
        let (rows, ranked, pending) = self.build_rows(snap, &res, mode, &token)?;
        if ranked {
            let keep = res.sort.map(|(c, _)| c).filter(|&c| Some(c) != rank_col);
            snap.cache_view(spec, rows.clone(), keep);
        }
        Ok((rows, ranked, pending))
    }

    /// A view that is neither trivial nor the unfiltered E-value order: the
    /// cached order of its sort column, then the filters as a predicate
    /// over the typed columns (item 9), applied to that order.
    fn build_rows(self: &Arc<Self>, snap: &Arc<Snapshot>, res: &Resolved, mode: Mode, token: &Cancel) -> Result<(ViewRows, bool, bool), String> {
        let index = &snap.index;
        let n = index.offsets.len();
        let rank_col = index.columns.iter().position(|c| c == RANK_COLUMN);
        let (mut ranked, mut pending) = (true, false);
        let base: Option<(Arc<Rank>, bool)> = match res.sort {
            None => None,
            Some((c, desc)) if Some(c) == rank_col => match snap.rank_ready() {
                Some(r) => Some((r, desc)),
                // The per-spectrum rule needs the E-value order: it waits for
                // the build in flight (rank_now never starts a second one,
                // and a newer view's token stops the wait).
                None if mode == Mode::Exact || res.per_spectrum.is_some() => Some((self.rank_now(snap, c, token)?, desc)),
                None => {
                    // D5 with filters: the matching rows in file order now.
                    ranked = false;
                    pending = self.start_rank(snap);
                    None
                }
            },
            Some((c, desc)) => Some((self.order_for(snap, c, mode, token)?, desc)),
        };
        if !res.has_filters() {
            return Ok(match base {
                Some((r, desc)) => (ViewRows::Order(r, desc), true, false),
                None => (ViewRows::All(n), ranked, pending),
            });
        }
        // D5 for the max-E-value cutoff: while the E-value order is being
        // built, the table's view is one scan of the file (as v1.11), not a
        // wait for that order (nor a second build of it).
        let scan_ev = mode == Mode::Interactive && res.max_evalue.is_some() && res.per_spectrum.is_none() && snap.rank_ready().is_none();
        let typed = if scan_ev { None } else { self.typed_now(snap, &self.typed_token(snap, mode, token))? };
        let bits = match typed {
            Some(t) => {
                let ev = match res.max_evalue {
                    Some((col, max)) => {
                        let rank = self.rank_now(snap, col, token)?;
                        Some(evalue_bits(snap, &rank, col, max, &t.ev_inf)?)
                    }
                    None => None,
                };
                let mut bits = keep_bits(&t, res, n, ev.as_deref());
                if let Some((_, ev, nmax)) = res.per_spectrum {
                    let rank = self.rank_now(snap, ev, token)?;
                    per_spectrum(&mut bits, &rank.asc, &t.spec_id, t.dict.len(), nmax);
                }
                bits
            }
            None if res.per_spectrum.is_some() => {
                return Err(format!(
                    "the best tags per spectrum need the typed columns, and this file has more than {} rows",
                    self.typed_max_rows.load(Ordering::Relaxed)
                ))
            }
            None => {
                snap.scans.fetch_add(1, Ordering::Relaxed);
                filter_rows(&snap.path, index, res, token)?
            }
        };
        if token.is_cancelled() {
            return Err(CANCELLED.into());
        }
        Ok((select_view(base, bits), ranked, pending))
    }
}

/// The tests' stand-in for start_rank's worker, for a slot they set to
/// Building by hand: after @p ms it builds the order, fills the slot, wakes
/// the waiters and announces Ranked, as that worker does (its scan is not
/// counted, so a test sees whether a caller scanned besides it).
#[cfg(test)]
pub(crate) fn finish_rank_after(shared: &Arc<Shared>, snap: &Arc<Snapshot>, ms: u64) -> std::thread::JoinHandle<()> {
    let (me, snap) = (shared.clone(), snap.clone());
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(ms));
        let col = snap.index.columns.iter().position(|c| c == RANK_COLUMN).unwrap();
        let r = build_rank(&snap.path, &snap.index, col, &Cancel::default(), &|_, _| {}).unwrap();
        *snap.rank.lock().unwrap() = RankSlot::Ready(Arc::new(r));
        snap.rank_cv.notify_all();
        me.emit_for(&snap.path, |generation| BrowserEvent::Ranked { generation, column: RANK_COLUMN.into() });
    })
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
    let snap = shared.snapshot_mode(path, mode)?;
    let (rows, ranked, pending) = shared.view_of(&snap, spec, mode, None)?;
    let ids = rows.window(offset, limit.min(MAX_WINDOW));
    let page = read_rows(&snap, &ids)?;
    Ok(ResultsPage {
        columns: snap.index.columns.clone(),
        total_rows: snap.index.offsets.len(),
        matched_rows: rows.len(),
        rows: page,
        row_ids: ids,
        ranked,
        pending,
    })
}

/// A query as the tests see it: always in the asked order.
#[cfg(test)]
fn query(shared: &Arc<Shared>, path: &str, spec: &ViewSpec, offset: usize, limit: usize) -> Result<ResultsPage, String> {
    query_mode(shared, path, spec, offset, limit, Mode::Exact)
}

/// Open @p path for the renderer: the head rows now; the index, then the
/// E-value order and the typed columns, on a thread, announced through
/// @p emit. Opening another file cancels the builds of the previous one;
/// re-opening the same unchanged file reuses what was built.
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
    std::thread::spawn(move || match me.snapshot_mode(&p, Mode::Interactive) {
        Ok(snap) => {
            let total_rows = snap.index.offsets.len();
            me.emit_for(&p, |generation| BrowserEvent::Indexed { generation, total_rows });
            // The typed columns follow the E-value order; with no order to
            // build they come now.
            if !me.start_rank(&snap) {
                if snap.rank_ready().is_some() {
                    me.emit_for(&p, |generation| BrowserEvent::Ranked { generation, column: RANK_COLUMN.into() });
                }
                me.typed_in_background(&snap);
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
        return Ok(ViewRows::All(snap.index.offsets.len()).position(row));
    }
    let rank_col = snap.index.columns.iter().position(|c| c == RANK_COLUMN);
    if let (Some((c, desc)), Some(r), false) = (res.sort, rank_col, res.has_filters()) {
        if c == r {
            return Ok(snap.rank_ready().and_then(|k| ViewRows::Order(k, desc).position(row)));
        }
    }
    Ok(snap.cached_view(spec).and_then(|v| v.position(row)))
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

// ------------------------------------------------------------------ export

/// One cell as the export writes it: the text (invalid UTF-8 read lossily);
/// in CSV, a cell with a comma, a quote, CR or LF in quotes, its quotes
/// doubled.
fn push_cell(out: &mut Vec<u8>, cell: &[u8], fmt: ExportFormat) {
    let text = String::from_utf8_lossy(cell);
    let b = text.as_bytes();
    if fmt == ExportFormat::Csv && b.iter().any(|c| matches!(c, b',' | b'"' | b'\r' | b'\n')) {
        out.push(b'"');
        for &c in b {
            if c == b'"' {
                out.push(b'"');
            }
            out.push(c);
        }
        out.push(b'"');
    } else {
        out.extend_from_slice(b);
    }
}

fn line_parts(fmt: ExportFormat) -> (u8, &'static [u8]) {
    match fmt {
        ExportFormat::Tsv => (b'\t', b"\n"),
        ExportFormat::Csv => (b',', b"\r\n"),
    }
}

/// The cells @p pick of a raw row (as fields_of splits it; a missing cell
/// is empty) as one line of @p fmt.
fn format_row(raw: &[u8], pick: &[usize], fmt: ExportFormat, cells: &mut Vec<(usize, usize)>, out: &mut Vec<u8>) {
    let line = trim_nl(raw);
    cells.clear();
    let mut s = 0;
    for (i, b) in line.iter().enumerate() {
        if *b == b'\t' {
            cells.push((s, i));
            s = i + 1;
        }
    }
    cells.push((s, line.len()));
    let (sep, end) = line_parts(fmt);
    for (k, &c) in pick.iter().enumerate() {
        if k > 0 {
            out.push(sep);
        }
        if let Some(&(a, b)) = cells.get(c) {
            push_cell(out, &line[a..b], fmt);
        }
    }
    out.extend_from_slice(end);
}

fn format_header(columns: &[String], pick: &[usize], fmt: ExportFormat, out: &mut Vec<u8>) {
    let (sep, end) = line_parts(fmt);
    for (k, &c) in pick.iter().enumerate() {
        if k > 0 {
            out.push(sep);
        }
        push_cell(out, columns[c].as_bytes(), fmt);
    }
    out.extend_from_slice(end);
}

/// How a row is written: copied when it is clean and the export is a TSV of
/// every column in header order, else formatted.
struct RowWriter<'a> {
    pick: &'a [usize],
    fmt: ExportFormat,
    copy: bool,
    ncols: usize,
    typed: Option<Arc<Typed>>,
    cells: Vec<(usize, usize)>,
    line: Vec<u8>,
}

impl RowWriter<'_> {
    fn write(&mut self, w: &mut impl Write, row: usize, raw: &[u8], full: usize) -> std::io::Result<()> {
        if self.copy {
            let clean = match &self.typed {
                Some(t) => bit(&t.clean, row),
                None => is_clean(raw, full, self.ncols),
            };
            if clean {
                return w.write_all(raw);
            }
        }
        self.line.clear();
        format_row(raw, self.pick, self.fmt, &mut self.cells, &mut self.line);
        w.write_all(&self.line)
    }
}

/// Write the rows of @p spec, in its order, with only @p columns (header
/// names; unknown ones are skipped), to @p dest as @p fmt (item 11). The
/// rows go to `<dest>.part` first and replace @p dest only once complete,
/// so a failed or cancelled export never leaves a truncated file under the
/// chosen name. Returns the number of rows written.
///
/// An unfiltered, unsorted TSV of every column of a clean file is a copy of
/// its byte range. Any other export reads its rows in passes of up to
/// EXPORT_WINDOW bytes of view rows: each pass sorted by offset, close rows
/// read in one span, written in view order through a 4 MB BufWriter.
#[allow(clippy::too_many_arguments)]
pub(crate) fn export_to(
    shared: &Arc<Shared>,
    path: &str,
    spec: &ViewSpec,
    columns: &[String],
    dest: &str,
    fmt: ExportFormat,
    cancel: &Cancel,
    progress: &dyn Fn(usize, usize),
) -> Result<usize, String> {
    // Writing the view over its own source would truncate what it reads.
    let same = match (std::fs::canonicalize(path), std::fs::canonicalize(dest)) {
        (Ok(a), Ok(b)) => a == b,
        _ => path == dest,
    };
    if same {
        return Err(format!("{dest} is the file being exported; choose another name"));
    }
    if cancel.is_cancelled() {
        return Err(CANCELLED.into());
    }
    let snap = shared.snapshot_mode(path, Mode::Exact)?;
    let index = &snap.index;
    let pick: Vec<usize> = columns.iter().filter_map(|c| index.columns.iter().position(|h| h == c)).collect();
    if pick.is_empty() {
        return Err("no column to export".into());
    }
    let (rows, _, _) = shared.view_of(&snap, spec, Mode::Exact, Some(cancel))?;
    if cancel.is_cancelled() {
        return Err(CANCELLED.into());
    }
    let total = rows.len();
    let ncols = index.columns.len();
    snap.trim(EXPORT_TRANSIENT, spec.sort.as_ref().and_then(|s| index.columns.iter().position(|c| *c == s.column)));
    let typed = snap.typed.lock().unwrap().clone();
    let mut rw = RowWriter {
        pick: &pick,
        fmt,
        copy: fmt == ExportFormat::Tsv && pick.iter().copied().eq(0..ncols),
        ncols,
        typed,
        cells: Vec::new(),
        line: Vec::new(),
    };
    // A name of this export's own: two exports to one name never share a
    // temporary file (start_export refuses the second while the first
    // runs; this keeps even a direct call from writing into another's).
    static PART: AtomicU64 = AtomicU64::new(0);
    let part = format!("{dest}.{}-{}.part", std::process::id(), PART.fetch_add(1, Ordering::Relaxed));
    let err = |e: std::io::Error| format!("cannot write {dest}: {e}");
    let rerr = |e: std::io::Error| format!("cannot read {path}: {e}");
    let write = |rw: &mut RowWriter| -> Result<usize, String> {
        let mut w = BufWriter::with_capacity(4 << 20, File::create(&part).map_err(err)?);
        let mut head = Vec::new();
        format_header(&index.columns, &pick, fmt, &mut head);
        w.write_all(&head).map_err(err)?;
        progress(0, total);
        let src = File::open(path).map_err(|e| format!("cannot open {path}: {e}"))?;
        // The read span (at most CHUNK, or one capped row), in a mapping of
        // its own like the window buffers below: returned when the export
        // ends, not kept by the allocator (GUI-DESIGN 7, backend peak).
        let mut span: Mapped<u8> = Mapped::zeroed(CHUNK.max(ROW_CAP));
        match &rows {
            ViewRows::All(_) => {
                let start = index.offsets.first().copied().unwrap_or(index.data_end);
                if rw.copy && rw.typed.as_ref().is_some_and(|t| t.all_clean) {
                    // A byte-range copy.
                    snap.byte_copies.fetch_add(1, Ordering::Relaxed);
                    let mut at = start;
                    while at < index.data_end {
                        if cancel.is_cancelled() {
                            return Err(CANCELLED.into());
                        }
                        let len = ((index.data_end - at) as usize).min(CHUNK);
                        let chunk = &mut span[..len];
                        read_exact_at(&src, chunk, at).map_err(rerr)?;
                        w.write_all(chunk).map_err(err)?;
                        at += len as u64;
                        progress(index.offsets.partition_point(|&o| o < at), total);
                    }
                } else {
                    // File order: whole rows in CHUNK reads.
                    let mut r = 0;
                    while r < total {
                        if cancel.is_cancelled() {
                            return Err(CANCELLED.into());
                        }
                        let s0 = index.offsets[r];
                        let mut e = r + 1;
                        if index.end_of(r) - s0 <= CHUNK as u64 {
                            while e < total && index.end_of(e) - s0 <= CHUNK as u64 {
                                e += 1;
                            }
                        }
                        let len = if e == r + 1 { ((index.end_of(r) - s0) as usize).min(ROW_CAP) } else { (index.end_of(e - 1) - s0) as usize };
                        let chunk = &mut span[..len];
                        read_exact_at(&src, chunk, s0).map_err(rerr)?;
                        for i in r..e {
                            let (s, l) = row_span(index, i);
                            let a = (s - s0) as usize;
                            rw.write(&mut w, i, &chunk[a..a + l], (index.end_of(i) - s) as usize).map_err(err)?;
                        }
                        progress(e, total);
                        r = e;
                    }
                }
            }
            _ => {
                let mut wbuf: Mapped<u8> = Mapped::zeroed(EXPORT_WINDOW.max(ROW_CAP));
                let mut dpos: Mapped<u32> = Mapped::zeroed(EXPORT_WINDOW_ROWS + 1);
                let mut pairs: Mapped<u64> = Mapped::zeroed(EXPORT_WINDOW_ROWS);
                let mut k = 0;
                while k < total {
                    // One pass: the next view rows up to EXPORT_WINDOW bytes
                    // (ids holds view positions k.. of them).
                    let ids = rows.window(k, EXPORT_WINDOW_ROWS);
                    let ids = &ids[..];
                    dpos[0] = 0;
                    let mut bytes = 0;
                    let mut e = k;
                    while e < total && e - k < EXPORT_WINDOW_ROWS {
                        let l = row_span(index, ids[e - k] as usize).1;
                        if e > k && bytes + l > EXPORT_WINDOW {
                            break;
                        }
                        bytes += l;
                        dpos[e - k + 1] = bytes as u32;
                        e += 1;
                    }
                    let pairs = &mut pairs[..e - k];
                    for (j, p) in pairs.iter_mut().enumerate() {
                        *p = (ids[j] as u64) << 32 | j as u64;
                    }
                    pairs.sort_unstable();
                    let mut j = 0;
                    while j < pairs.len() {
                        if cancel.is_cancelled() {
                            return Err(CANCELLED.into());
                        }
                        let r0 = (pairs[j] >> 32) as usize;
                        let s0 = index.offsets[r0];
                        let mut end = s0 + row_span(index, r0).1 as u64;
                        let mut q = j + 1;
                        while q < pairs.len() {
                            let r = (pairs[q] >> 32) as usize;
                            let (s, l) = row_span(index, r);
                            if s > end + GAP || s + l as u64 - s0 > CHUNK as u64 {
                                break;
                            }
                            end = end.max(s + l as u64);
                            q += 1;
                        }
                        let chunk = &mut span[..(end - s0) as usize];
                        read_exact_at(&src, chunk, s0).map_err(rerr)?;
                        for &pq in &pairs[j..q] {
                            let (r, slot) = ((pq >> 32) as usize, (pq & 0xffff_ffff) as usize);
                            let (s, l) = row_span(index, r);
                            let a = (s - s0) as usize;
                            let d = dpos[slot] as usize;
                            wbuf[d..d + l].copy_from_slice(&chunk[a..a + l]);
                        }
                        j = q;
                    }
                    for (slot, &row) in ids[..e - k].iter().enumerate() {
                        let raw = &wbuf[dpos[slot] as usize..dpos[slot + 1] as usize];
                        let full = (index.end_of(row as usize) - index.offsets[row as usize]) as usize;
                        rw.write(&mut w, row as usize, raw, full).map_err(err)?;
                    }
                    progress(e, total);
                    k = e;
                }
            }
        }
        w.flush().map_err(err)?;
        Ok(total)
    };
    let written = write(&mut rw);
    drop(rw);
    match written {
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

/// export_to as v1.11's synchronous TSV export (the tests).
#[cfg(test)]
fn export(shared: &Arc<Shared>, path: &str, spec: &ViewSpec, columns: &[String], dest: &str) -> Result<usize, String> {
    export_to(shared, path, spec, columns, dest, ExportFormat::Tsv, &Cancel::default(), &|_, _| {})
}

/// The name @p dest stands for, for comparing two destinations: the
/// canonical folder and the file name (the file itself may not exist yet).
fn dest_key(dest: &str) -> String {
    let p = std::path::Path::new(dest);
    match (p.parent().map(|d| if d.as_os_str().is_empty() { std::path::Path::new(".") } else { d }), p.file_name()) {
        (Some(dir), Some(name)) => match std::fs::canonicalize(dir) {
            Ok(d) => d.join(name).to_string_lossy().into_owned(),
            Err(_) => dest.to_string(),
        },
        _ => dest.to_string(),
    }
}

/// Start an export job on a thread of its own; its events go to @p emit.
/// Returns the job's id (larger than every earlier one), or why it did not
/// start: an export to the same name is still running. Only cancel_export
/// stops it: page reads, other views and opens do not.
pub(crate) fn start_export(
    shared: &Arc<Shared>,
    path: &str,
    spec: &ViewSpec,
    columns: &[String],
    dest: &str,
    fmt: ExportFormat,
    emit: ExportEmit,
) -> Result<u64, String> {
    let key = dest_key(dest);
    let job_id = {
        let mut jobs = shared.jobs.lock().unwrap();
        if jobs.values().any(|(_, d)| *d == key) {
            return Err(format!("an export to {dest} is still running; wait for it or cancel it first"));
        }
        let job_id = shared.next_job.fetch_add(1, Ordering::SeqCst) + 1;
        jobs.insert(job_id, (Cancel::default(), key));
        job_id
    };
    let token = shared.jobs.lock().unwrap()[&job_id].0.clone();
    let (me, path, spec, columns, dest) = (shared.clone(), path.to_string(), spec.clone(), columns.to_vec(), dest.to_string());
    std::thread::spawn(move || {
        // Progress at most every 100 ms, and always the first and the last.
        let last: Mutex<Option<Instant>> = Mutex::new(None);
        let progress = |done: usize, total: usize| {
            let mut l = last.lock().unwrap();
            if done == 0 || done == total || l.is_none_or(|t| t.elapsed().as_millis() >= 100) {
                *l = Some(Instant::now());
                emit(ExportEvent::Progress { job_id, done, total });
            }
        };
        let r = export_to(&me, &path, &spec, &columns, &dest, fmt, &token, &progress);
        me.jobs.lock().unwrap().remove(&job_id);
        emit(match r {
            Ok(rows) => ExportEvent::Done { job_id, rows, dest },
            Err(_) if token.is_cancelled() => ExportEvent::Cancelled { job_id },
            Err(message) => ExportEvent::Failed { job_id, message },
        });
    });
    Ok(job_id)
}

/// Cancel export job @p job_id; false when no such job is running.
pub(crate) fn cancel_export(shared: &Shared, job_id: u64) -> bool {
    match shared.jobs.lock().unwrap().get(&job_id) {
        Some((t, _)) => {
            t.cancel();
            true
        }
        None => false,
    }
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn results_export(
    state: tauri::State<'_, BrowserCache>,
    path: String,
    view: ViewSpec,
    columns: Vec<String>,
    dest: String,
    format: Option<ExportFormat>,
    on_event: tauri::ipc::Channel<ExportEvent>,
) -> Result<u64, String> {
    let emit: ExportEmit = Arc::new(move |ev| {
        let _ = on_event.send(ev);
    });
    start_export(&state.0, &path, &view, &columns, &dest, format.unwrap_or_default(), emit)
}

#[tauri::command]
pub fn results_cancel(state: tauri::State<'_, BrowserCache>, job_id: u64) -> bool {
    cancel_export(&state.0, job_id)
}

/// The pieces the browser bench (examples/browser_bench.rs) times: the head
/// read, the index, the E-value order and the app's own open, query and
/// export paths. Not used by the app.
#[doc(hidden)]
#[allow(dead_code)] // used by examples/browser_bench.rs only
pub mod bench {
    use super::*;

    pub use super::{ExportFormat, SortSpec, ViewSpec};

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
        let d = r.desc();
        Ok((r.asc.to_vec(), d))
    }

    /// The first page of the E-value view through the app's own query path
    /// (Interactive: file order while the order is built).
    pub fn open_and_query(path: &str) -> Result<(usize, bool), String> {
        let shared = Arc::new(Shared::default());
        // The file is the open one, as after results_open (without the
        // open's own index thread, so the query indexes it here).
        *shared.open.lock().unwrap() =
            Some(OpenState { path: path.to_string(), generation: 1, emit: Arc::new(|_| {}), index: Cancel::default() });
        let spec = ViewSpec { sort: Some(SortSpec { column: RANK_COLUMN.into(), desc: false }), ..Default::default() };
        let p = query_mode(&shared, path, &spec, 0, 500, Mode::Interactive)?;
        Ok((p.rows.len(), p.ranked))
    }

    pub fn typed_probe(path: &str, ix: &Indexed, rss: &dyn Fn(&str)) {
        let t = build_typed(path, &ix.0, &Cancel::default()).unwrap();
        rss("typed built");
        eprintln!("dict {} entries, bytes {}", t.dict.len(), t.dict.iter().map(|d| d.len()).sum::<usize>());
        drop(t);
        rss("typed dropped");
    }

    /// The app's browser on one file, opened as results_open opens it.
    pub struct Session {
        shared: Arc<Shared>,
        path: String,
        events: Arc<Mutex<Vec<BrowserEvent>>>,
    }

    impl Session {
        /// results_open: the head rows (returned) now, the builds after.
        pub fn open(path: &str) -> Result<(Session, usize), String> {
            let shared = Arc::new(Shared::default());
            let events: Arc<Mutex<Vec<BrowserEvent>>> = Arc::default();
            let e = events.clone();
            let head = open(&shared, path, Arc::new(move |ev| e.lock().unwrap().push(ev)))?;
            Ok((Session { shared, path: path.to_string(), events }, head.rows.len()))
        }

        fn wait(&self, done: impl Fn(&Session) -> bool) {
            while !done(self) {
                std::thread::sleep(std::time::Duration::from_micros(200));
            }
        }

        pub fn wait_indexed(&self) {
            self.wait(|s| s.events.lock().unwrap().iter().any(|e| matches!(e, BrowserEvent::Indexed { .. })))
        }

        pub fn wait_ranked(&self) {
            self.wait(|s| s.events.lock().unwrap().iter().any(|e| matches!(e, BrowserEvent::Ranked { .. })))
        }

        pub fn wait_typed(&self) {
            self.wait(|s| s.shared.snaps.read().unwrap().iter().any(|x| x.path == s.path && x.typed.lock().unwrap().is_some()))
        }

        /// A page of @p spec as the table asks for it: (matched rows, rows).
        pub fn query(&self, spec: &ViewSpec, offset: usize, limit: usize) -> Result<(usize, usize), String> {
            let p = query_mode(&self.shared, &self.path, spec, offset, limit, Mode::Interactive)?;
            Ok((p.matched_rows, p.rows.len()))
        }

        /// An export as the job runs it (without the thread).
        pub fn export(&self, spec: &ViewSpec, columns: &[String], dest: &str, fmt: ExportFormat) -> Result<usize, String> {
            export_to(&self.shared, &self.path, spec, columns, dest, fmt, &Cancel::default(), &|_, _| {})
        }
    }
}

/// v1.11's view, the oracle of every P0b and P3 view (GUI-DESIGN 6.1): one
/// scan that filters, keys and sorts, plus the per-spectrum rule over the
/// E-value keys.
#[cfg(test)]
mod reference {
    use super::*;

    /// Sort key: numeric rows first ordered by value, then everything else
    /// byte-wise — so `-` and other non-numbers always sink to the bottom,
    /// ascending or descending.
    enum Key {
        Num(f64),
        Str(Vec<u8>),
    }

    fn key(cell: &str) -> Key {
        match numeric(cell) {
            Some(v) => Key::Num(v),
            None => Key::Str(cell.as_bytes().to_vec()),
        }
    }

    fn cmp(a: &Key, b: &Key) -> std::cmp::Ordering {
        match (a, b) {
            (Key::Num(x), Key::Num(y)) => x.total_cmp(y),
            (Key::Str(x), Key::Str(y)) => x.cmp(y),
            (Key::Num(_), Key::Str(_)) => std::cmp::Ordering::Less,
            (Key::Str(_), Key::Num(_)) => std::cmp::Ordering::Greater,
        }
    }

    pub(super) fn build_view(path: &str, index: &Index, res: &Resolved, cancel: &Cancel) -> Result<Vec<u32>, String> {
        let file = File::open(path).map_err(|e| format!("cannot open {path}: {e}"))?;
        let mut reader = BufReader::with_capacity(1 << 20, file);
        reader
            .seek(SeekFrom::Start(index.offsets.first().copied().unwrap_or(index.data_end)))
            .map_err(|e| e.to_string())?;
        let mut matched: Vec<u32> = Vec::new();
        let mut keys: Vec<Key> = Vec::new();
        // Per spectrum: the E-value key and the spectrum of each match.
        let mut ev: Vec<Key> = Vec::new();
        let mut spectra: Vec<String> = Vec::new();
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
            let get = |c: usize| fields.get(c).map(String::as_str).unwrap_or("");
            matched.push(i as u32);
            if let Some((col, _)) = res.sort {
                keys.push(key(get(col)));
            }
            if let Some((sc, ec, _)) = res.per_spectrum {
                ev.push(key(get(ec)));
                spectra.push(get(sc).to_string());
            }
        }
        if let Some((_, _, nmax)) = res.per_spectrum {
            let mut by_ev: Vec<usize> = (0..matched.len()).collect();
            by_ev.sort_by(|&a, &b| cmp(&ev[a], &ev[b]).then(a.cmp(&b)));
            let mut count: HashMap<&str, u32> = HashMap::new();
            let mut keep = vec![false; matched.len()];
            for a in by_ev {
                let c = count.entry(spectra[a].as_str()).or_default();
                if *c < nmax {
                    *c += 1;
                    keep[a] = true;
                }
            }
            let mut k = keep.iter();
            matched.retain(|_| *k.next().unwrap());
            if res.sort.is_some() {
                let mut k = keep.iter();
                keys.retain(|_| *k.next().unwrap());
            }
        }
        if let Some((_, desc)) = res.sort {
            let mut perm: Vec<usize> = (0..matched.len()).collect();
            perm.sort_unstable_by(|&a, &b| {
                let ord = match (&keys[a], &keys[b]) {
                    (Key::Num(_), Key::Str(_)) => return std::cmp::Ordering::Less,
                    (Key::Str(_), Key::Num(_)) => return std::cmp::Ordering::Greater,
                    (x, y) => cmp(x, y),
                };
                let ord = if desc { ord.reverse() } else { ord };
                ord.then(a.cmp(&b)) // deterministic: file order breaks ties
            });
            return Ok(perm.into_iter().map(|p| matched[p]).collect());
        }
        Ok(matched)
    }
}

#[cfg(test)]
#[path = "browser_p3_tests.rs"]
mod p3_tests;

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
                per_spectrum: Some(1),
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
        let view_ptr = snap(&cache).view_ptr(&tag).unwrap();
        query(&cache, &p, &tag, 0, 100).unwrap();
        assert_eq!(view_ptr, snap(&cache).view_ptr(&tag).unwrap());

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
        reference::build_view(p, &index, &Resolved::bind(spec, &index.columns), &Cancel::default()).unwrap()
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
        // Export and the tests never get file order for a sorted view: they
        // wait for the build in flight (here finished by its stand-in).
        let scans = snap.scans.load(Ordering::Relaxed);
        let worker = finish_rank_after(&shared, &snap, 50);
        let e = query_mode(&shared, &p, &spec, 0, 10, Mode::Exact).unwrap();
        assert!(e.ranked);
        assert_eq!(e.row_ids, [1, 0, 2, 3]);
        assert_eq!(snap.scans.load(Ordering::Relaxed), scans);
        assert!(!token.is_cancelled());
        worker.join().unwrap();
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
        let index_a = shared.index_token(&a).unwrap();
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
        assert_eq!(reference::build_view(&p, &index, &Resolved::bind(&ViewSpec { min_length: Some(1), ..Default::default() }, &index.columns), &t).err().as_deref(), Some(CANCELLED));
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

    fn by_evalue() -> ViewSpec {
        ViewSpec { sort: Some(SortSpec { column: "evalue".into(), desc: false }), ..Default::default() }
    }

    #[test]
    fn a_build_waiting_for_the_old_file_stops_when_another_file_opens() {
        let a = fixture("wait-a.tsv");
        let b = fixture("wait-b.tsv");
        let shared = Arc::new(Shared::default());
        // Another index build holds the lock: A's open and A's first query
        // both wait for it, as when the renderer queries A while A indexes.
        let busy = shared.build.lock().unwrap();
        let (ea, _got_a) = collector();
        open(&shared, &a, ea).unwrap();
        let (s2, a2) = (shared.clone(), a.clone());
        let query_a = std::thread::spawn(move || query_mode(&s2, &a2, &by_evalue(), 0, 10, Mode::Interactive));
        std::thread::sleep(std::time::Duration::from_millis(50));
        let (eb, got_b) = collector();
        let hb = open(&shared, &b, eb).unwrap();
        drop(busy);
        assert_eq!(query_a.join().unwrap().err().as_deref(), Some(CANCELLED));
        assert_eq!(
            wait_for(&got_b, |e| matches!(e, BrowserEvent::Indexed { .. })),
            BrowserEvent::Indexed { generation: hb.generation, total_rows: 4 }
        );
        // Nobody indexed A after it was closed (the old code rebuilt it in
        // full with a token nothing could cancel, holding up B).
        assert!(shared.snaps.read().unwrap().iter().all(|s| s.path != a));
        // An Interactive query of a file that is not open never indexes it;
        // export (Exact) still does.
        assert_eq!(query_mode(&shared, &a, &by_evalue(), 0, 10, Mode::Interactive).err().as_deref(), Some(CANCELLED));
        assert_eq!(query(&shared, &a, &by_evalue(), 0, 10).unwrap().row_ids, [2, 0, 1, 3]);
        std::fs::remove_file(&a).ok();
        std::fs::remove_file(&b).ok();
    }

    #[test]
    fn reopening_a_file_whose_rank_build_was_cancelled_still_ends_ranked() {
        // A -> B -> A before A's cancelled rank build reached a cancel
        // check: its slot still says Building, but that build will end
        // silently.
        let p = fixture("reopen.tsv");
        let shared = Arc::new(Shared::default());
        let snap = shared.snapshot(&p).unwrap();
        let old = Cancel::default();
        old.cancel();
        *snap.rank.lock().unwrap() = RankSlot::Building(old.clone());
        let (emit, got) = collector();
        let h = open(&shared, &p, emit).unwrap();
        assert_eq!(
            wait_for(&got, |e| matches!(e, BrowserEvent::Ranked { .. })),
            BrowserEvent::Ranked { generation: h.generation, column: "evalue".into() }
        );
        assert!(snap.rank_ready().is_some());
        let r = query_mode(&shared, &p, &by_evalue(), 0, 10, Mode::Interactive).unwrap();
        assert!(r.ranked && !r.pending);
        std::fs::remove_file(&p).ok();
    }

    #[test]
    fn a_late_page_query_of_a_closed_file_starts_no_rank_build() {
        let a = fixture("late-a.tsv");
        let b = fixture("late-b.tsv");
        let shared = Arc::new(Shared::default());
        let snap_a = shared.snapshot(&a).unwrap(); // A indexed, not ranked
        let (eb, _got_b) = collector();
        open(&shared, &b, eb).unwrap();
        // The renderer's last page query of A arrives after B was opened.
        let r = query_mode(&shared, &a, &by_evalue(), 0, 10, Mode::Interactive).unwrap();
        assert!(!r.ranked && !r.pending);
        assert!(matches!(&*snap_a.rank.lock().unwrap(), RankSlot::None), "a rank build of the closed file started");
        // Re-opening A ranks it.
        let (ea, got_a) = collector();
        let h = open(&shared, &a, ea).unwrap();
        assert_eq!(
            wait_for(&got_a, |e| matches!(e, BrowserEvent::Ranked { .. })),
            BrowserEvent::Ranked { generation: h.generation, column: "evalue".into() }
        );
        std::fs::remove_file(&a).ok();
        std::fs::remove_file(&b).ok();
    }

    #[test]
    fn export_during_ranking_still_announces_ranked() {
        let p = fixture("export-rank.tsv");
        let shared = Arc::new(Shared::default());
        let snap = shared.snapshot(&p).unwrap();
        // A background build in flight: the export's query waits for it
        // (never a second build beside it, never cancelling it), and the
        // background build announces the order.
        let background = Cancel::default();
        *snap.rank.lock().unwrap() = RankSlot::Building(background.clone());
        let (emit, got) = collector();
        let h = open(&shared, &p, emit).unwrap();
        wait_for(&got, |e| matches!(e, BrowserEvent::Indexed { .. }));
        let pending = query_mode(&shared, &p, &by_evalue(), 0, 10, Mode::Interactive).unwrap();
        assert!(!pending.ranked && pending.pending);
        assert!(got.lock().unwrap().iter().all(|e| !matches!(e, BrowserEvent::Ranked { .. })));
        let scans = snap.scans.load(Ordering::Relaxed);
        let worker = finish_rank_after(&shared, &snap, 100);
        let e = query(&shared, &p, &by_evalue(), 0, 10).unwrap(); // export's query
        assert_eq!(e.row_ids, [2, 0, 1, 3]);
        assert!(!background.is_cancelled());
        assert_eq!(snap.scans.load(Ordering::Relaxed), scans, "the export built a second order beside the one in flight");
        worker.join().unwrap();
        assert_eq!(
            wait_for(&got, |e| matches!(e, BrowserEvent::Ranked { .. })),
            BrowserEvent::Ranked { generation: h.generation, column: "evalue".into() }
        );
        std::fs::remove_file(&p).ok();
    }

    #[test]
    fn concurrent_queries_of_one_view_build_it_once() {
        let p = fixture("dedupe.tsv");
        let shared = Arc::new(Shared::default());
        let snap = shared.snapshot(&p).unwrap();
        let spec = ViewSpec { min_length: Some(7), sort: Some(SortSpec { column: "tag".into(), desc: false }), ..Default::default() };
        // Hold the view builds so that both page queries are in flight at once.
        let hold = snap.view_one.lock().unwrap();
        let pages: Vec<_> = [0usize, 1]
            .into_iter()
            .map(|off| {
                let (s, p, v) = (shared.clone(), p.clone(), spec.clone());
                std::thread::spawn(move || query_mode(&s, &p, &v, off, 1, Mode::Interactive))
            })
            .collect();
        std::thread::sleep(std::time::Duration::from_millis(50));
        drop(hold);
        let got: Vec<_> = pages.into_iter().map(|t| t.join().unwrap().unwrap()).collect();
        assert_eq!(snap.views_built.load(Ordering::SeqCst), 1, "the second query scanned the file again");
        assert_eq!(got[0].matched_rows, got[1].matched_rows);
        let all = query(&shared, &p, &spec, 0, 10).unwrap();
        assert_eq!([got[0].row_ids[0], got[1].row_ids[0]], [all.row_ids[0], all.row_ids[1]]);
        assert_eq!(snap.views_built.load(Ordering::SeqCst), 1);
        // A different spec is a build of its own.
        query(&shared, &p, &ViewSpec { min_length: Some(6), ..Default::default() }, 0, 10).unwrap();
        assert_eq!(snap.views_built.load(Ordering::SeqCst), 2);
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
