// A stretch of one protein of a run's filter database, for the Spectrum
// tab's alignment of the tags that hit that protein uniquely (-fasta_proteins
// names it as identifier@start-end; the CLI writes no sequences to -out).
//
// - fasta_segment(tags, database, identifier, start, end): residues
//   start..end (1-based, inclusive, clipped to the protein) of the entry
//   whose identifier (the header up to the first white space, as OpenMS
//   reads it) is @p identifier, with the protein's length and description,
//   in the database @p database ("fasta" or "entrapment_fasta") of the run
//   that wrote the tags table @p tags.
//
// Which file may be read is bound to that run: when it starts, each of its
// databases is resolved once and its identity recorded (DbIdentity: the
// canonical path, device, inode, size and modification time of the opened
// handle), in this session's list and in its run record. A request opens
// that path once, checks the opened handle is a regular file with that
// identity, and reads from that handle only: a file replaced at the path,
// a symlink retargeted after the run, a folder or a FIFO is refused, never
// read. A record without identities (before 1.16) aligns nothing.
//
// Each verified file is indexed once (Index: the byte offset of each entry,
// its residue count and a checkpoint every CHECKPOINT residues), in one
// bounded pass of CHUNK bytes; concurrent requests for a new file wait for
// that pass instead of reading it again, and the shared lock is held only
// to find the index, never during IO. A segment is then a seek and a read of
// the residues asked for. Positions count residues as the CLI's index does
// (ProteomeIndex::build, ResidueFold normResidue): letters only, upper case;
// a digit, '*' or '-' in a sequence is not a residue.
//
// An identifier that names more than one entry is not placed: the CLI
// counts the entries by ordinal but writes the identifier only, so its
// positions may be of any of them (occurrences > 1, no residues).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{AppHandle, State};

use crate::fastag::RunManager;
use crate::history;

/// The most residues one call returns.
const MAX_SEGMENT: usize = 4096;
/// The longest header kept, in bytes (a description is shown, not parsed).
const MAX_HEADER: usize = 4096;
/// The read size of the index pass.
const CHUNK: usize = 1 << 20;
/// The read size of a segment (a few lines around MAX_SEGMENT residues).
const SEG_CHUNK: usize = 64 << 10;
/// A checkpoint every this many residues of an entry, so a start deep in a
/// long protein is sought to.
const CHECKPOINT: u64 = 1 << 16;
/// The indexes kept (most recently used).
const MAX_INDEXES: usize = 4;

/// The size an index may grow to; a larger database is refused.
#[derive(Clone, Copy)]
struct Limits {
    entries: usize,
    /// An estimate of the index's bytes.
    bytes: usize,
}
const LIMITS: Limits = Limits { entries: 2 << 20, bytes: 256 << 20 };

/// The options whose value is a database a run reads.
const DB_OPTIONS: &[&str] = &["-fasta", "-entrapment_fasta"];

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FastaSegment {
    pub identifier: String,
    pub description: String,
    /// The protein's length in residues (0 when ambiguous).
    pub length: usize,
    /// The residues returned, 1-based and inclusive.
    pub start: usize,
    pub end: usize,
    pub sequence: String,
    /// The entries of the database with this identifier. More than one: the
    /// CLI's positions cannot be placed on one of them, and no residues are
    /// returned (description and sequence empty, start/end as asked).
    pub occurrences: usize,
}

/// A database as a run read it: resolved and opened once when the run
/// started (identity_of). Stored in the run record.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DbIdentity {
    /// The option without '-': "fasta" or "entrapment_fasta".
    pub option: String,
    /// The canonical path the file was opened at.
    pub path: String,
    /// Device and file number (Unix: st_dev/st_ino; Windows: the volume
    /// serial number and file index).
    pub dev: u64,
    pub ino: u64,
    pub len: u64,
    /// Modification time, ns since the Unix epoch.
    pub mtime_ns: i64,
}

impl DbIdentity {
    fn key(&self) -> Key {
        (self.path.clone(), self.dev, self.ino, self.len, self.mtime_ns)
    }
}

/// The run of this session that wrote @p outputs read @p databases.
pub struct SessionRun {
    pub start: u64,
    pub outputs: Vec<PathBuf>,
    pub databases: Vec<DbIdentity>,
}

/// One entry of an index. Its header is read again when asked for.
struct IndexEntry {
    /// The offset of its '>'.
    header_off: u64,
    /// The offset of the line after the header.
    seq_off: u64,
    residues: u64,
    /// The entries with this identifier (the first one is this).
    count: u32,
    /// (residues before, byte offset of the next residue), every CHECKPOINT.
    checkpoints: Vec<(u64, u64)>,
}

struct Index {
    by_id: HashMap<Box<str>, u32>,
    entries: Vec<IndexEntry>,
}

type Key = (String, u64, u64, u64, i64);
type Slot = Arc<OnceLock<Result<Arc<Index>, String>>>;

#[derive(Default)]
struct Shared {
    /// Least recently used first.
    indexes: Mutex<Vec<(Key, Slot)>>,
    /// Index passes started, and bytes read (index and segments).
    builds: AtomicUsize,
    bytes: AtomicU64,
}

#[derive(Default)]
pub struct FastaCache {
    shared: Arc<Shared>,
}

/// The databases @p argv (a run's arguments, the binary first or not) reads,
/// with their option (without '-'), a relative one joined to @p cwd.
pub fn databases_of(argv: &[String], cwd: Option<&Path>) -> Vec<(String, PathBuf)> {
    let mut out = Vec::new();
    for w in argv.windows(2) {
        if DB_OPTIONS.contains(&w[0].as_str()) && !w[1].trim().is_empty() {
            for p in crate::outputs::resolve(std::slice::from_ref(&w[1]), cwd) {
                out.push((w[0][1..].to_string(), p));
            }
        }
    }
    out
}

/// The identities of the databases @p argv reads (databases_of), each
/// resolved and opened once; one that is not a regular file is left out.
pub fn identities_of(argv: &[String], cwd: Option<&Path>) -> Vec<DbIdentity> {
    databases_of(argv, cwd).into_iter().filter_map(|(o, p)| identity_of(&o, &p)).collect()
}

/// Open @p path for reading without following a final symlink or blocking
/// on a FIFO.
fn open_file(path: &Path) -> std::io::Result<File> {
    let mut o = std::fs::OpenOptions::new();
    o.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        o.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    o.open(path)
}

/// The device and file number of the open @p f (@p m its metadata).
#[cfg(unix)]
fn file_id(_f: &File, m: &std::fs::Metadata) -> (u64, u64) {
    use std::os::unix::fs::MetadataExt;
    (m.dev(), m.ino())
}

#[cfg(windows)]
fn file_id(f: &File, _m: &std::fs::Metadata) -> (u64, u64) {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION};
    // SAFETY: a plain-data out struct, filled by the call for a valid handle.
    let mut i: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
    if unsafe { GetFileInformationByHandle(f.as_raw_handle() as _, &mut i) } == 0 {
        return (0, 0);
    }
    (i.dwVolumeSerialNumber as u64, ((i.nFileIndexHigh as u64) << 32) | i.nFileIndexLow as u64)
}

#[cfg(not(any(unix, windows)))]
fn file_id(_f: &File, _m: &std::fs::Metadata) -> (u64, u64) {
    (0, 0)
}

fn mtime_ns(m: &std::fs::Metadata) -> i64 {
    match m.modified().map(|t| t.duration_since(std::time::UNIX_EPOCH)) {
        Ok(Ok(d)) => d.as_nanos() as i64,
        Ok(Err(e)) => -(e.duration().as_nanos() as i64),
        Err(_) => 0,
    }
}

/// @p path (of the option @p option) as a run reads it now: canonical, opened
/// once, and its identity taken from the opened handle. None: missing, not
/// a regular file, or unreadable.
pub fn identity_of(option: &str, path: &Path) -> Option<DbIdentity> {
    let canon = std::fs::canonicalize(path).ok()?;
    let f = open_file(&canon).ok()?;
    let m = f.metadata().ok()?;
    if !m.file_type().is_file() {
        return None;
    }
    let (dev, ino) = file_id(&f, &m);
    Some(DbIdentity { option: option.to_string(), path: canon.to_string_lossy().into_owned(), dev, ino, len: m.len(), mtime_ns: mtime_ns(&m) })
}

/// The file @p ident names, opened once and checked: a regular file with
/// the identity the run recorded. Every read is from this handle.
fn open_verified(ident: &DbIdentity) -> Result<File, String> {
    let gone = |e: std::io::Error| format!("the run's database {} cannot be read: {e}", ident.path);
    let f = open_file(Path::new(&ident.path)).map_err(gone)?;
    let m = f.metadata().map_err(gone)?;
    let (dev, ino) = file_id(&f, &m);
    if !m.file_type().is_file() || (dev, ino, m.len(), mtime_ns(&m)) != (ident.dev, ident.ino, ident.len, ident.mtime_ns) {
        return Err(format!("the database {} changed since the run read it, so its positions cannot be shown on it", ident.path));
    }
    Ok(f)
}

/// The databases of the run that wrote @p tags: this session's newest run
/// with that output (@p session), or the newest record of one (@p record,
/// history::of_output), whichever started later.
pub fn run_databases(session: &[SessionRun], record: Option<history::RunRecord>, tags: &Path) -> Option<Vec<DbIdentity>> {
    let canon = |p: &Path| p.canonicalize().unwrap_or_else(|_| p.to_path_buf());
    let want = canon(tags);
    let mine = session
        .iter()
        .filter(|r| r.outputs.iter().any(|p| p == tags || canon(p) == want))
        .max_by_key(|r| r.start);
    match (mine, record) {
        (Some(s), Some(r)) if r.start > s.start => Some(r.databases),
        (Some(s), _) => Some(s.databases.clone()),
        (None, Some(r)) => Some(r.databases),
        (None, None) => None,
    }
}

/// Count the bytes read through it into @p n.
struct Counted<'a, R> {
    r: R,
    n: &'a AtomicU64,
}

impl<R: Read> Read for Counted<'_, R> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let k = self.r.read(buf)?;
        self.n.fetch_add(k as u64, Ordering::Relaxed);
        Ok(k)
    }
}

/// The identifier of a header (without '>'): up to the first white space.
fn identifier_bytes(header: &[u8]) -> &[u8] {
    let end = header.iter().position(|b| b.is_ascii_whitespace()).unwrap_or(header.len());
    &header[..end]
}

const TOO_LARGE: &str = "the database is too large to index for the alignment";

/// Index the FASTA @p r in one pass of CHUNK reads. Memory: one chunk, one
/// header of at most MAX_HEADER bytes, and the index (within @p lim).
fn build_index<R: Read>(mut r: R, lim: Limits) -> Result<Index, String> {
    #[derive(PartialEq)]
    enum At {
        LineStart,
        Header,
        Seq,
    }
    let mut buf = vec![0u8; CHUNK];
    let mut ix = Index { by_id: HashMap::new(), entries: Vec::new() };
    let mut est = 0usize;
    let mut at = At::LineStart;
    let mut header: Vec<u8> = Vec::with_capacity(MAX_HEADER);
    let mut header_off = 0u64;
    // The entry whose residues are counted (None: before the first header,
    // or a repeated identifier's entry).
    let mut cur: Option<usize> = None;
    let mut off = 0u64;
    let begin = |ix: &mut Index, header: &[u8], header_off: u64, seq_off: u64, est: &mut usize| -> Result<Option<usize>, String> {
        let id = String::from_utf8_lossy(identifier_bytes(header));
        if let Some(&i) = ix.by_id.get(id.as_ref()) {
            let e = &mut ix.entries[i as usize];
            e.count = e.count.saturating_add(1);
            return Ok(None);
        }
        *est += id.len() + 96;
        if ix.entries.len() >= lim.entries || *est > lim.bytes {
            return Err(TOO_LARGE.into());
        }
        let i = ix.entries.len();
        ix.entries.push(IndexEntry { header_off, seq_off, residues: 0, count: 1, checkpoints: Vec::new() });
        ix.by_id.insert(id.into(), i as u32);
        Ok(Some(i))
    };
    loop {
        let n = match r.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => n,
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(e) => return Err(format!("cannot read the database: {e}")),
        };
        for (k, &b) in buf[..n].iter().enumerate() {
            let pos = off + k as u64;
            if at == At::LineStart && b == b'>' {
                at = At::Header;
                header.clear();
                header_off = pos;
                continue;
            }
            if at == At::Header {
                if b == b'\n' {
                    cur = begin(&mut ix, &header, header_off, pos + 1, &mut est)?;
                    at = At::LineStart;
                } else if header.len() < MAX_HEADER {
                    header.push(b);
                }
                continue;
            }
            if b == b'\n' {
                at = At::LineStart;
                continue;
            }
            at = At::Seq;
            if let (Some(i), true) = (cur, b.is_ascii_alphabetic()) {
                let e = &mut ix.entries[i];
                if e.residues > 0 && e.residues.is_multiple_of(CHECKPOINT) {
                    e.checkpoints.push((e.residues, pos));
                    est += 16;
                    if est > lim.bytes {
                        return Err(TOO_LARGE.into());
                    }
                }
                e.residues += 1;
            }
        }
        off += n as u64;
    }
    if at == At::Header {
        begin(&mut ix, &header, header_off, off, &mut est)?;
    }
    Ok(ix)
}

/// The index of the verified file @p f (@p key its identity), built once:
/// a concurrent caller for the same file waits for the one pass. The lock
/// is held only to find or add the slot.
fn index_of(sh: &Shared, key: Key, f: &File, lim: Limits) -> Result<Arc<Index>, String> {
    let slot: Slot = {
        let mut v = sh.indexes.lock().map_err(|_| "the database index is unavailable".to_string())?;
        match v.iter().position(|(k, _)| *k == key) {
            Some(i) => {
                let e = v.remove(i);
                let s = e.1.clone();
                v.push(e);
                s
            }
            None => {
                let s: Slot = Arc::default();
                v.push((key, s.clone()));
                if v.len() > MAX_INDEXES {
                    v.remove(0);
                }
                s
            }
        }
    };
    let res = slot
        .get_or_init(|| {
            sh.builds.fetch_add(1, Ordering::Relaxed);
            let mut h: &File = f;
            h.seek(SeekFrom::Start(0)).map_err(|e| format!("cannot read the database: {e}"))?;
            build_index(Counted { r: h, n: &sh.bytes }, lim).map(Arc::new)
        })
        .clone();
    if res.is_err() {
        // Not kept: the next request tries again.
        if let Ok(mut v) = sh.indexes.lock() {
            v.retain(|(_, s)| !Arc::ptr_eq(s, &slot));
        }
    }
    res
}

/// The description of the entry whose header starts at @p off in @p f:
/// the header after the identifier, at most MAX_HEADER bytes read.
fn description_at(f: &File, off: u64, n: &AtomicU64) -> Result<String, String> {
    let mut h: &File = f;
    h.seek(SeekFrom::Start(off + 1)).map_err(|e| e.to_string())?;
    let mut b = Vec::with_capacity(MAX_HEADER);
    Counted { r: h, n }.take(MAX_HEADER as u64).read_to_end(&mut b).map_err(|e| e.to_string())?;
    if let Some(i) = b.iter().position(|&c| c == b'\n') {
        b.truncate(i);
    }
    let id = identifier_bytes(&b).len();
    Ok(String::from_utf8_lossy(&b[id..]).trim().chars().take(MAX_HEADER).collect())
}

/// Residues @p s..=@p t (1-based, within the entry) of @p e in @p f, read
/// from the checkpoint before @p s in SEG_CHUNK reads.
fn residues_of(f: &File, e: &IndexEntry, s: u64, t: u64, n: &AtomicU64) -> Result<String, String> {
    let (mut count, from) = e.checkpoints.iter().rev().find(|c| c.0 < s).copied().unwrap_or((0, e.seq_off));
    let mut h: &File = f;
    h.seek(SeekFrom::Start(from)).map_err(|e| e.to_string())?;
    let mut r = Counted { r: h, n };
    let mut buf = vec![0u8; SEG_CHUNK];
    let mut out = String::with_capacity((t + 1 - s) as usize);
    // A checkpoint is at a residue, inside a line.
    let mut line_start = from == e.seq_off;
    'read: loop {
        let k = r.read(&mut buf).map_err(|e| e.to_string())?;
        if k == 0 {
            break;
        }
        for &b in &buf[..k] {
            if line_start && b == b'>' {
                break 'read;
            }
            line_start = b == b'\n';
            if b.is_ascii_alphabetic() {
                count += 1;
                if count >= s {
                    out.push(b.to_ascii_uppercase() as char);
                }
                if count >= t {
                    break 'read;
                }
            }
        }
    }
    Ok(out)
}

/// Residues @p start..@p end (1-based, inclusive) of @p identifier in the
/// database @p ident, clipped to the protein and to MAX_SEGMENT residues.
fn segment_in(sh: &Shared, ident: &DbIdentity, identifier: &str, start: usize, end: usize, lim: Limits) -> Result<FastaSegment, String> {
    let f = open_verified(ident)?;
    let ix = index_of(sh, ident.key(), &f, lim)?;
    let e = ix.by_id.get(identifier).map(|&i| &ix.entries[i as usize]).ok_or_else(|| format!("{identifier} is not in {}", ident.path))?;
    if e.count > 1 {
        return Ok(FastaSegment {
            identifier: identifier.to_string(),
            description: String::new(),
            length: 0,
            start,
            end,
            sequence: String::new(),
            occurrences: e.count as usize,
        });
    }
    let n = e.residues as usize;
    if n == 0 {
        return Err(format!("{identifier} has no residues"));
    }
    let s = start.max(1).min(n);
    let t = end.max(s).min(n).min(s + MAX_SEGMENT - 1);
    Ok(FastaSegment {
        identifier: identifier.to_string(),
        description: description_at(&f, e.header_off, &sh.bytes)?,
        length: n,
        start: s,
        end: t,
        sequence: residues_of(&f, e, s as u64, t as u64, &sh.bytes)?,
        occurrences: 1,
    })
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn fasta_segment(
    app: AppHandle,
    mgr: State<'_, RunManager>,
    cache: State<'_, FastaCache>,
    tags: String,
    database: String,
    identifier: String,
    start: usize,
    end: usize,
) -> Result<FastaSegment, String> {
    let record = history::dir(&app).and_then(|d| history::of_output(&d, Path::new(&tags)));
    let dbs = {
        let session = mgr.databases.lock().map_err(|_| "the run list is unavailable".to_string())?;
        run_databases(&session, record, Path::new(&tags))
    }
    .ok_or_else(|| format!("{tags} was not written by a run of this app"))?;
    let ident = dbs
        .into_iter()
        .find(|d| d.option == database)
        .ok_or_else(|| format!("the run that wrote {tags} recorded no -{database} database it read"))?;
    let sh = cache.shared.clone();
    tauri::async_runtime::spawn_blocking(move || segment_in(&sh, &ident, &identifier, start, end, LIMITS))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    // The bytes allocated by this thread, and their peak: the bound on
    // memory of a segment read (long_lines_are_read_in_bounded_memory).
    thread_local! {
        static NOW: Cell<isize> = const { Cell::new(0) };
        static PEAK: Cell<isize> = const { Cell::new(0) };
    }
    struct Counting;
    unsafe impl std::alloc::GlobalAlloc for Counting {
        unsafe fn alloc(&self, l: std::alloc::Layout) -> *mut u8 {
            add(l.size() as isize);
            unsafe { std::alloc::System.alloc(l) }
        }
        unsafe fn dealloc(&self, p: *mut u8, l: std::alloc::Layout) {
            add(-(l.size() as isize));
            unsafe { std::alloc::System.dealloc(p, l) }
        }
        unsafe fn realloc(&self, p: *mut u8, l: std::alloc::Layout, n: usize) -> *mut u8 {
            add(n as isize - l.size() as isize);
            unsafe { std::alloc::System.realloc(p, l, n) }
        }
    }
    fn add(d: isize) {
        let _ = NOW.try_with(|c| {
            let v = c.get() + d;
            c.set(v);
            let _ = PEAK.try_with(|p| p.set(p.get().max(v)));
        });
    }
    #[global_allocator]
    static ALLOC: Counting = Counting;
    /// The peak of this thread's allocations during @p f, above the start.
    fn peak_during<T>(f: impl FnOnce() -> T) -> (T, isize) {
        let base = NOW.with(Cell::get);
        PEAK.with(|p| p.set(base));
        let v = f();
        (v, PEAK.with(Cell::get) - base)
    }

    const FASTA: &str = ">sp|P0A6F5|CH60_ECOLI 60 kDa chaperonin OS=Escherichia coli GN=groL PE=1\n\
MAAKDVKFGN\nDARVKMLRGV\r\nNVLADAVKVT LGPKGRNVVL*\n\
>plain_one\nmkil-ivs1T\n\
>sp|P0A6F6|CH60_ECOLI a second chaperonin\nWWWW\n\
>empty\n\
>last no newline\nACDE";

    fn dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("fastag-fasta-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn file(name: &str, text: &str) -> PathBuf {
        let p = dir(name).join("db.fasta");
        std::fs::write(&p, text).unwrap();
        p
    }

    fn ident(p: &Path) -> DbIdentity {
        identity_of("fasta", p).expect("a regular file")
    }

    /// The segment of @p path as a run that reads it now records it.
    fn segment(c: &FastaCache, path: &Path, identifier: &str, start: usize, end: usize) -> Result<FastaSegment, String> {
        segment_in(&c.shared, &ident(path), identifier, start, end, LIMITS)
    }

    #[test]
    fn a_segment_counts_residues_as_the_cli_index_does() {
        let p = file("seg", FASTA);
        let c = FastaCache::default();
        let s = segment(&c, &p, "sp|P0A6F5|CH60_ECOLI", 11, 20).unwrap();
        assert_eq!(s.sequence, "DARVKMLRGV");
        assert_eq!((s.start, s.end, s.length, s.occurrences), (11, 20, 40, 1));
        assert!(s.description.contains("GN=groL"), "{}", s.description);
        // Spaces, '\r' and '*' are not residues: 40 letters, the last L.
        assert_eq!(segment(&c, &p, "sp|P0A6F5|CH60_ECOLI", 31, 40).unwrap().sequence, "LGPKGRNVVL");
        // Lower case upper-cased; '-' and digits dropped (normResidue).
        assert_eq!(segment(&c, &p, "plain_one", 1, 100).unwrap().sequence, "MKILIVST");
        assert_eq!(segment(&c, &p, "sp|P0A6F6|CH60_ECOLI", 1, 4).unwrap().sequence, "WWWW");
        assert_eq!(segment(&c, &p, "last", 2, 3).unwrap().sequence, "CD");
        assert_eq!(segment(&c, &p, "last", 2, 3).unwrap().description, "no newline");
    }

    #[test]
    fn a_segment_is_clipped_to_the_protein() {
        let p = file("clip", FASTA);
        let c = FastaCache::default();
        let s = segment(&c, &p, "plain_one", 0, 999).unwrap();
        assert_eq!((s.start, s.end, s.sequence.as_str()), (1, 8, "MKILIVST"));
        let s = segment(&c, &p, "plain_one", 7, 3).unwrap();
        assert_eq!((s.start, s.end), (7, 7));
        assert!(segment(&c, &p, "no_such", 1, 3).unwrap_err().contains("not in"));
        assert!(segment(&c, &p, "empty", 1, 3).unwrap_err().contains("no residues"));
    }

    // Codex #10 (f).
    #[test]
    fn at_most_max_segment_residues_are_returned() {
        let seq: String = (0..10_000).map(|i| b"ACDEFGHIKLMNPQRSTVWY"[i % 20] as char).collect();
        let p = file("max", &format!(">long\n{seq}\n"));
        let c = FastaCache::default();
        let s = segment(&c, &p, "long", 100, 9_000).unwrap();
        assert_eq!((s.start, s.end, s.length), (100, 100 + MAX_SEGMENT - 1, 10_000));
        assert_eq!(s.sequence, seq[99..99 + MAX_SEGMENT]);
    }

    // A new run of a changed file reads it again (a new index); the run that
    // read the file before it changed is refused, not shown the new residues.
    #[test]
    fn a_changed_file_is_read_again() {
        let p = file("stale", ">a\nAAAA\n");
        let c = FastaCache::default();
        let before = ident(&p);
        assert_eq!(segment_in(&c.shared, &before, "a", 1, 4, LIMITS).unwrap().sequence, "AAAA");
        std::fs::write(&p, ">a\nCCCCC\n>b\nK\n").unwrap();
        assert!(segment_in(&c.shared, &before, "a", 1, 5, LIMITS).unwrap_err().contains("changed"));
        assert_eq!(segment(&c, &p, "a", 1, 5).unwrap().sequence, "CCCCC");
        assert_eq!(segment(&c, &p, "b", 1, 1).unwrap().sequence, "K");
    }

    #[test]
    fn every_entry_is_indexed_and_a_single_one_read() {
        let p = file("one", FASTA);
        let c = FastaCache::default();
        assert_eq!(segment(&c, &p, "plain_one", 1, 8).unwrap().sequence, "MKILIVST");
        let ix = index_of(&c.shared, ident(&p).key(), &File::open(&p).unwrap(), LIMITS).unwrap();
        assert_eq!(ix.entries.len(), 5);
        assert_eq!(ix.entries.iter().map(|e| e.residues).collect::<Vec<_>>(), [40, 8, 4, 0, 4]);
        assert_eq!(c.shared.builds.load(Ordering::Relaxed), 1);
    }

    // Codex #7: the CLI writes the identifier of the entry it counted by
    // ordinal; with two entries of one identifier its positions may be of
    // either, so none is placed (was: the first entry's AAAAK for a hit in
    // the second).
    #[test]
    fn a_repeated_identifier_is_not_placed_on_one_entry() {
        let c = FastaCache::default();
        let p = file("dup", ">X first\nAAAAK\n>Y\nMM\n>X second\nPEPTIDE\n");
        let s = segment(&c, &p, "X", 1, 7).unwrap();
        assert_eq!((s.occurrences, s.sequence.as_str(), s.length, s.start, s.end), (2, "", 0, 1, 7));
        assert_eq!(segment(&c, &p, "Y", 1, 2).unwrap().sequence, "MM");
        // The first copy a long entry (checkpoints), the second at the end
        // of the file.
        let long: String = (0..200_000).map(|i| b"ACDEFGHIKLMNPQRSTVWY"[i % 20] as char).collect();
        let p = file("dup-long", &format!(">X\n{long}\n>Z\nKK\n>X\nPEPTIDE"));
        let s = segment(&c, &p, "X", 150_000, 150_006).unwrap();
        assert_eq!((s.occurrences, s.sequence.as_str()), (2, ""));
        assert_eq!(segment(&c, &p, "Z", 1, 2).unwrap().sequence, "KK");
    }

    #[test]
    fn a_start_deep_in_a_long_protein_is_sought_to() {
        // Lines of 60 and "\r\n", so a checkpoint falls inside a line.
        let seq: Vec<u8> = (0..300_000).map(|i| b"ACDEFGHIKLMNPQRSTVWY"[(i * 7 + i / 13) % 20]).collect();
        let mut text = b">deep d\n".to_vec();
        for l in seq.chunks(60) {
            text.extend_from_slice(l);
            text.extend_from_slice(b"\r\n");
        }
        text.extend_from_slice(b">next\nKK\n");
        let p = dir("deep").join("db.fasta");
        std::fs::write(&p, &text).unwrap();
        let c = FastaCache::default();
        for s in [1usize, 65_535, 65_536, 65_537, 131_072, 200_001, 299_990] {
            let g = segment(&c, &p, "deep", s, s + 99).unwrap();
            let t = (s + 99).min(300_000);
            assert_eq!(g.sequence.as_bytes(), &seq[s - 1..t], "start {s}");
        }
        assert_eq!(segment(&c, &p, "next", 1, 9).unwrap().sequence, "KK");
    }

    // Codex #10 (a): one 64 Mi-residue line after a 10 kB header is indexed
    // and read with bounded buffers (was: the line read whole, then the
    // protein built whole, > 128 MB).
    #[test]
    fn long_lines_are_read_in_bounded_memory() {
        const N: usize = 64 << 20;
        let p = dir("longline").join("db.fasta");
        {
            use std::io::Write;
            let mut w = std::io::BufWriter::new(File::create(&p).unwrap());
            writeln!(w, ">big {}", "h".repeat(10_000)).unwrap();
            let block: Vec<u8> = (0..1 << 20).map(|i| b"ACDEFGHIKLMNPQRSTVWY"[i % 20]).collect();
            for _ in 0..N >> 20 {
                w.write_all(&block).unwrap();
            }
            w.write_all(b"\n>small\nPEPTIDE").unwrap();
        }
        let c = FastaCache::default();
        let (s, peak) = peak_during(|| segment(&c, &p, "big", 30_000_000, 30_000_100).unwrap());
        let want: String = (30_000_000 - 1..30_000_100).map(|i| b"ACDEFGHIKLMNPQRSTVWY"[(i % (1 << 20)) % 20] as char).collect();
        assert_eq!(s.sequence.len(), 101);
        assert_eq!(s.sequence, want);
        assert_eq!(s.length, N);
        assert_eq!(s.description.len(), MAX_HEADER - 4, "the header is cut at MAX_HEADER bytes");
        assert!(peak < 32 << 20, "peak allocation {peak} bytes");
        assert_eq!(segment(&c, &p, "small", 1, 7).unwrap().sequence, "PEPTIDE");
        // After the index, a read is a seek and a few chunks.
        let before = c.shared.bytes.load(Ordering::Relaxed);
        let (_, peak) = peak_during(|| segment(&c, &p, "big", 60_000_000, 60_004_095).unwrap());
        assert!(peak < 2 << 20, "peak allocation {peak} bytes");
        assert!(c.shared.bytes.load(Ordering::Relaxed) - before < (4 * SEG_CHUNK) as u64);
        assert_eq!(c.shared.builds.load(Ordering::Relaxed), 1);
    }

    fn many(name: &str, n: usize) -> PathBuf {
        use std::io::Write;
        let p = dir(name).join("db.fasta");
        let mut w = std::io::BufWriter::new(File::create(&p).unwrap());
        for i in 0..n {
            write!(w, ">P{i:06} protein {i}\nMK{}\nAC{}\n", "W".repeat(i % 40), "G".repeat(i % 7)).unwrap();
        }
        drop(w);
        p
    }

    // Codex #10 (b): the file is read once for all identifiers (was: a full
    // rescan from byte 0 for each one once the file was not kept whole).
    #[test]
    fn many_entries_are_indexed_once() {
        const N: usize = 300_000;
        let p = many("many", N);
        let len = std::fs::metadata(&p).unwrap().len();
        let c = FastaCache::default();
        for k in 0..100 {
            let i = if k == 99 { N - 1 } else { k * (N / 100) + 17 };
            let s = segment(&c, &p, &format!("P{i:06}"), 1, 1000).unwrap();
            assert_eq!(s.sequence, format!("MK{}AC{}", "W".repeat(i % 40), "G".repeat(i % 7)));
            assert_eq!(s.description, format!("protein {i}"));
        }
        assert_eq!(c.shared.builds.load(Ordering::Relaxed), 1);
        let read = c.shared.bytes.load(Ordering::Relaxed);
        assert!(read <= len + 100 * (SEG_CHUNK + MAX_HEADER) as u64, "{read} bytes read of {len}");
        // An index larger than its limits is refused, not grown.
        let small = Limits { entries: 1000, bytes: 256 << 20 };
        let e = segment_in(&FastaCache::default().shared, &ident(&p), "P000001", 1, 3, small).unwrap_err();
        assert!(e.contains("too large"), "{e}");
        let small = Limits { entries: N * 2, bytes: 1 << 20 };
        assert!(segment_in(&FastaCache::default().shared, &ident(&p), "P000001", 1, 3, small).unwrap_err().contains("too large"));
    }

    // Codex #10 (c).
    #[test]
    fn concurrent_requests_for_a_new_file_index_it_once() {
        let p = many("conc", 50_000);
        let c = Arc::new(FastaCache::default());
        let b = Arc::new(std::sync::Barrier::new(4));
        let hs: Vec<_> = (0..4)
            .map(|k| {
                let (c, b, p) = (c.clone(), b.clone(), p.clone());
                std::thread::spawn(move || {
                    b.wait();
                    segment(&c, &p, &format!("P{:06}", 49_000 + k * 40), 1, 2).unwrap().sequence
                })
            })
            .collect();
        for h in hs {
            assert_eq!(h.join().unwrap(), "MK");
        }
        assert_eq!(c.shared.builds.load(Ordering::Relaxed), 1);
    }

    #[test]
    fn the_databases_a_run_reads_are_recorded_by_identity() {
        let p = file("allowed", FASTA);
        let argv: Vec<String> = ["/bin/FASTag", "-in", "a.mzML", "-fasta", "db.fasta", "-entrapment_fasta", "/x/e.fasta", "-out", "o.tsv"]
            .map(String::from)
            .to_vec();
        let dbs = databases_of(&argv, p.parent());
        assert_eq!(dbs, vec![("fasta".to_string(), p.clone()), ("entrapment_fasta".to_string(), PathBuf::from("/x/e.fasta"))]);
        // The missing one is left out; the other is canonical.
        let ids = identities_of(&argv, p.parent());
        assert_eq!(ids.len(), 1);
        assert_eq!(ids[0].path, std::fs::canonicalize(&p).unwrap().to_string_lossy());
        // A folder, a missing file: no identity.
        assert!(identity_of("fasta", p.parent().unwrap()).is_none());
        assert!(identity_of("fasta", &p.with_file_name("gone.fasta")).is_none());
        // `a/../b` names the same file.
        std::fs::create_dir_all(p.parent().unwrap().join("sub")).unwrap();
        let dotted = p.parent().unwrap().join("sub").join("..").join("db.fasta");
        assert_eq!(identity_of("fasta", &dotted), Some(ids[0].clone()));
        let c = FastaCache::default();
        assert_eq!(segment_in(&c.shared, &ids[0], "plain_one", 1, 8, LIMITS).unwrap().sequence, "MKILIVST");
        // Another file is another identity.
        let other = p.with_file_name("other.fasta");
        std::fs::write(&other, ">x\nA\n").unwrap();
        assert_ne!(identity_of("fasta", &other).unwrap().ino, ids[0].ino);
    }

    // Codex #3 (a): the run read A through a symlink; retargeted to B, the
    // alignment never shows B (was: the link resolved again at request
    // time, and B authorised).
    #[cfg(unix)]
    #[test]
    fn a_retargeted_symlink_does_not_authorise_another_file() {
        let d = dir("link");
        std::fs::write(d.join("a.fasta"), ">p\nAAAAK\n").unwrap();
        std::fs::write(d.join("b.fasta"), ">p\nCCCCK\n").unwrap();
        let link = d.join("current.fasta");
        std::os::unix::fs::symlink(d.join("a.fasta"), &link).unwrap();
        let run = identity_of("fasta", &link).unwrap();
        std::fs::remove_file(&link).unwrap();
        std::os::unix::fs::symlink(d.join("b.fasta"), &link).unwrap();
        let c = FastaCache::default();
        // The file the run read, unchanged: its residues, never B's.
        assert_eq!(segment_in(&c.shared, &run, "p", 1, 5, LIMITS).unwrap().sequence, "AAAAK");
        // A itself replaced by a symlink to B: refused.
        std::fs::remove_file(d.join("a.fasta")).unwrap();
        std::os::unix::fs::symlink(d.join("b.fasta"), d.join("a.fasta")).unwrap();
        assert!(segment_in(&c.shared, &run, "p", 1, 5, LIMITS).is_err());
    }

    // Codex #3 (b): a new file renamed over the recorded path is refused.
    #[test]
    fn a_file_replaced_at_the_recorded_path_is_refused() {
        let p = file("replaced", ">p\nAAAAK\n");
        let run = ident(&p);
        let tmp = p.with_file_name("new.fasta");
        std::fs::write(&tmp, ">p\nCCCCK\n").unwrap();
        std::fs::rename(&tmp, &p).unwrap();
        let c = FastaCache::default();
        assert!(segment_in(&c.shared, &run, "p", 1, 5, LIMITS).unwrap_err().contains("changed since the run"));
    }

    // Codex #3 (d): a recorded path that is now a folder or a FIFO is
    // refused, without blocking on the FIFO.
    #[test]
    fn a_folder_or_fifo_at_the_recorded_path_is_refused() {
        let p = file("kind", ">p\nAAAAK\n");
        let run = ident(&p);
        std::fs::remove_file(&p).unwrap();
        std::fs::create_dir(&p).unwrap();
        let c = FastaCache::default();
        assert!(segment_in(&c.shared, &run, "p", 1, 5, LIMITS).is_err());
        #[cfg(unix)]
        {
            std::fs::remove_dir(&p).unwrap();
            let cp = std::ffi::CString::new(p.to_string_lossy().as_bytes()).unwrap();
            assert_eq!(unsafe { libc::mkfifo(cp.as_ptr(), 0o600) }, 0);
            let (tx, rx) = std::sync::mpsc::channel();
            let sh = c.shared.clone();
            std::thread::spawn(move || {
                let _ = tx.send(segment_in(&sh, &run, "p", 1, 5, LIMITS));
            });
            let r = rx.recv_timeout(std::time::Duration::from_secs(5)).expect("the FIFO blocked the read");
            assert!(r.unwrap_err().contains("changed since the run"));
        }
    }

    // Codex #3 (c): a run's databases are those of the run that wrote the
    // tags asked for, never another run's.
    #[test]
    fn a_database_of_another_run_is_not_read() {
        let d = dir("runs");
        let x = file("runs-x", ">p\nAAAAK\n");
        let y = file("runs-y", ">q\nCCCCK\n");
        let xi = identity_of("entrapment_fasta", &x).unwrap();
        let session = vec![
            SessionRun { start: 1, outputs: vec![d.join("x.tags.tsv")], databases: vec![ident(&x), xi] },
            SessionRun { start: 2, outputs: vec![d.join("y.tags.tsv")], databases: vec![ident(&y)] },
        ];
        let of_y = run_databases(&session, None, &d.join("y.tags.tsv")).unwrap();
        assert_eq!(of_y, vec![ident(&y)]);
        assert!(!of_y.iter().any(|i| i.option == "entrapment_fasta"));
        assert!(run_databases(&session, None, &d.join("z.tags.tsv")).is_none());
        // A record that started later wins; one of an older version has no
        // identities, so nothing is read for it (not its argv).
        let mut rec: history::RunRecord = serde_json::from_value(serde_json::json!({
            "id": "3-1", "input": "a.mzML", "outputs": [d.join("y.tags.tsv")], "cwd": null,
            "argv": ["FASTag", "-fasta", x.display().to_string()], "status": "ok", "exitCode": 0, "message": null,
            "start": 3, "end": 4, "cleanup": {"removed": [], "renamed": [], "failed": []}
        }))
        .unwrap();
        assert!(rec.databases.is_empty());
        assert_eq!(run_databases(&session, Some(rec.clone()), &d.join("y.tags.tsv")), Some(vec![]));
        rec.start = 1;
        assert_eq!(run_databases(&session, Some(rec), &d.join("y.tags.tsv")), Some(vec![ident(&y)]));
    }
}
