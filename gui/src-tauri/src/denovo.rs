// Stitch and ALPS export (GUI-DESIGN 10 P3, S8, D7): a FASTag -res_conf tags
// TSV as de novo "reads", written exactly as tools/tags_to_denovo.py writes
// them, as an export job (6.1 item 11) with progress and Cancel.
//
// The conversion runs here, on a thread of its own, reading the file once:
// it never goes to the renderer (in export/denovo.ts a 255 MB file blocked
// the renderer's main thread 2.5-3.9 s at 1.6-3.4 GB RSS, before the IPC
// copies), so there is no size cap. Per spectrum only the best top-N rows so
// far are kept, so memory follows the reads written, not the file: with the
// defaults (top-n 1) one row per spectrum.
//
// tools/tags_to_denovo.py is the reference. The golden files in
// src/fixtures/denovo are its output (CI regenerates and compares them,
// scripts/denovo-golden.mjs); this port must equal every one byte for byte
// (tests below), as export/denovo.ts, the TypeScript port the browser test
// bridges use, must (denovo.test.ts). In short:
//
//   stitch  the PEAKS "Old" 15-column positional CSV snijderlab/stitch reads,
//           no quoting, Area 0 (a constant nonzero Area makes Stitch's
//           intensity NaN), mods spelled as PEAKS deltas (S(+79.97));
//   alps    the 5-column CSV denisbeslic/denovopipeline gives ALPS.jar,
//           RFC 4180 quoting (Python's csv module), bare residues, Area 1.
//
// Filters in the script's order: malformed rows are skipped, then rows
// shorter than min_length, then the top_n lowest E-values of each spectrum
// (file order on ties; spectra in the order they first appear among the
// rows kept). Python's own parsers are mirrored where the script leans on
// them: int() and float() (surrounding whitespace, underscores between
// digits, inf and infinity), str.split() whitespace, universal newlines (\n,
// \r\n and a lone \r end a line), round() (half to even) and strict UTF-8.
// A NaN E-value, which no FASTag writes, ranks last (as in denovo.ts);
// Python's sort leaves it wherever its comparisons happen to put it.
//
// The reads go to `<dest>.<pid>-<n>.part` and replace the chosen .csv only
// once complete; a refusal, a failure or Cancel leaves nothing under it, and
// the tags file itself is never the destination.

use std::collections::{HashMap, VecDeque};
use std::fs::File;
use std::io::{BufRead, BufReader, BufWriter, ErrorKind, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use serde::Deserialize;

use crate::browser::{self, BrowserCache, Cancel, ExportEmit, ExportEvent};

#[derive(Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DenovoFormat {
    Stitch,
    Alps,
}

#[derive(Clone, Copy, Debug)]
pub struct DenovoOptions {
    pub format: DenovoFormat,
    /// Reads kept per spectrum, lowest E-value first (script --top-n, >= 1).
    pub top_n: usize,
    /// Tags shorter than this many residues are dropped (--min-length).
    pub min_length: i64,
}

#[derive(Debug, Default, PartialEq)]
pub struct DenovoSummary {
    pub reads: usize,
    /// Non-blank data rows read; below the minimum length; malformed.
    pub rows_read: usize,
    pub short: usize,
    pub malformed: usize,
    /// Mod names outside the built-in delta map, written as the bare residue
    /// in the Stitch spelling, in the order first met.
    pub unknown_mods: Vec<String>,
}

const MOD_DELTAS: [(&str, &str); 5] = [
    ("oxidation", "+15.99"),
    ("phospho", "+79.97"),
    ("carbamidomethyl", "+57.02"),
    ("acetyl", "+42.01"),
    ("deamidated", "+0.98"),
];
const STITCH_HEADER: &str = "Scan,Peptide,Tag Length,ALC (%),length,m/z,z,RT,Area,Mass,ppm,PTM,local confidence,tag,mode";
const ALPS_HEADER: &str = "Spectrum Name,Peptide,aaScore,Score,Area";
const REQUIRED: [&str; 8] = ["spectrum", "tag", "length", "charge", "nterm_mass", "cterm_mass", "evalue", "res_conf"];

/// Python's str.isspace(): Unicode White_Space plus U+001C..U+001F.
fn py_space(c: char) -> bool {
    c.is_whitespace() || ('\u{1c}'..='\u{1f}').contains(&c)
}

/// The digits of `\d(_?\d)*` (ASCII), underscores dropped; None otherwise.
fn digit_part(s: &str) -> Option<String> {
    let b = s.as_bytes();
    if b.is_empty() || !b[0].is_ascii_digit() || !b[b.len() - 1].is_ascii_digit() {
        return None;
    }
    let mut out = String::with_capacity(b.len());
    let mut prev_us = false;
    for &c in b {
        if c == b'_' {
            if prev_us {
                return None;
            }
            prev_us = true;
        } else if c.is_ascii_digit() {
            prev_us = false;
            out.push(c as char);
        } else {
            return None;
        }
    }
    Some(out)
}

fn sign_of(t: &str) -> (bool, &str) {
    match t.as_bytes().first() {
        Some(b'-') => (true, &t[1..]),
        Some(b'+') => (false, &t[1..]),
        _ => (false, t),
    }
}

/// Python int(s) for ASCII digits: (negative, digits without leading
/// zeros, "0" for zero); None where int() raises ValueError.
fn py_int(s: &str) -> Option<(bool, String)> {
    let (neg, body) = sign_of(s.trim_matches(py_space));
    let d = digit_part(body)?;
    let d = d.trim_start_matches('0');
    if d.is_empty() {
        // Python's int has no negative zero.
        return Some((false, "0".into()));
    }
    Some((neg, d.to_string()))
}

/// py_int as a number, saturated far outside every range it is checked
/// against (residue counts, 0..100).
fn py_int_value(s: &str) -> Option<i64> {
    let (neg, d) = py_int(s)?;
    let m: i64 = if d.len() > 18 { i64::MAX } else { d.parse().ok()? };
    Some(if neg { -m } else { m })
}

/// Python str(int(s)), exact at any size.
fn py_int_text(s: &str) -> Option<String> {
    py_int(s).map(|(neg, d)| if neg { format!("-{d}") } else { d })
}

/// Python float(s) (ASCII digits); None where float() raises ValueError.
fn py_float(s: &str) -> Option<f64> {
    let t = s.trim_matches(py_space).to_ascii_lowercase();
    let (neg, body) = sign_of(&t);
    let v = match body {
        "inf" | "infinity" => f64::INFINITY,
        "nan" => f64::NAN,
        _ => {
            let (mant, exp) = match body.find('e') {
                Some(i) => (&body[..i], Some(&body[i + 1..])),
                None => (body, None),
            };
            let part = |x: &str| if x.is_empty() { Some(String::new()) } else { digit_part(x) };
            let mut num = match mant.find('.') {
                Some(i) => {
                    let (a, b) = (part(&mant[..i])?, part(&mant[i + 1..])?);
                    if a.is_empty() && b.is_empty() {
                        return None;
                    }
                    format!("{}.{}", if a.is_empty() { "0" } else { &a }, if b.is_empty() { "0" } else { &b })
                }
                None => digit_part(mant)?,
            };
            if let Some(e) = exp {
                let (eneg, d) = sign_of(e);
                num = format!("{num}e{}{}", if eneg { "-" } else { "" }, digit_part(d)?);
            }
            num.parse::<f64>().ok()?
        }
    };
    Some(if neg { -v } else { v })
}

/// tags_to_denovo.py parse_tag: each residue, then an optional [ModName];
/// the whole tag must be such residues. (residue, byte range of the mod).
type Residue = (u8, Option<(usize, usize)>);

fn parse_tag(tag: &str) -> Option<Vec<Residue>> {
    let b = tag.as_bytes();
    let mut out = Vec::new();
    let mut pos = 0;
    while pos < b.len() {
        let c = b[pos];
        if !c.is_ascii_uppercase() {
            return None;
        }
        pos += 1;
        let mut m = None;
        if b.get(pos) == Some(&b'[') {
            if let Some(end) = b[pos + 1..].iter().position(|&x| x == b']') {
                m = Some((pos + 1, pos + 1 + end));
                pos += end + 2;
            }
        }
        out.push((c, m));
    }
    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

/// A row that passed every filter, as much of it as the writers need.
struct Kept {
    tag: Box<str>,
    confs: Box<[u8]>,
    charge: Box<str>,
    nterm: Box<str>,
    cterm: Box<str>,
    evalue: f64,
    order: u64,
}

/// thin_top_n's order: (evalue, order), NaN after +inf.
fn before(a: &Kept, b: &Kept) -> bool {
    let (an, bn) = (a.evalue.is_nan(), b.evalue.is_nan());
    if an != bn {
        return bn;
    }
    if !an && a.evalue != b.evalue {
        return a.evalue < b.evalue;
    }
    a.order < b.order
}

/// The lines of a reader as Python's universal-newline reader splits them,
/// line ends removed: \r\n, \n and a lone \r each end a line.
struct Lines<R> {
    r: R,
    seg: Vec<u8>,
    pending: VecDeque<Vec<u8>>,
    /// Bytes read so far.
    consumed: u64,
}

impl<R: BufRead> Lines<R> {
    fn new(r: R) -> Self {
        Lines { r, seg: Vec::new(), pending: VecDeque::new(), consumed: 0 }
    }
    fn next_line(&mut self) -> std::io::Result<Option<Vec<u8>>> {
        loop {
            if let Some(l) = self.pending.pop_front() {
                return Ok(Some(l));
            }
            self.seg.clear();
            let n = self.r.read_until(b'\n', &mut self.seg)?;
            if n == 0 {
                return Ok(None);
            }
            self.consumed += n as u64;
            let body = self.seg.strip_suffix(b"\n").unwrap_or(&self.seg);
            if !body.contains(&b'\r') {
                return Ok(Some(body.to_vec()));
            }
            let mut parts: Vec<Vec<u8>> = body.split(|&c| c == b'\r').map(<[u8]>::to_vec).collect();
            // A trailing \r ends the line before it (alone or as \r\n): the
            // empty piece after it is no line.
            if body.last() == Some(&b'\r') {
                parts.pop();
            }
            self.pending.extend(parts);
        }
    }
}

fn delta_of(m: &str) -> Option<&'static str> {
    let l = m.to_lowercase();
    MOD_DELTAS.iter().find(|(k, _)| *k == l).map(|(_, v)| *v)
}

/// Python's round() of the mean confidence (half to even), as text.
fn alc(confs: &[u8]) -> String {
    let sum: u64 = confs.iter().map(|&c| c as u64).sum();
    let mean = sum as f64 / confs.len() as f64;
    format!("{}", mean.round_ties_even() as i64)
}

fn joined(confs: &[u8]) -> String {
    confs.iter().map(|c| c.to_string()).collect::<Vec<_>>().join(" ")
}

/// Python csv.writer's QUOTE_MINIMAL.
fn csv_field(s: &str, out: &mut String) {
    if s.contains([',', '"', '\r', '\n']) {
        out.push('"');
        out.push_str(&s.replace('"', "\"\""));
        out.push('"');
    } else {
        out.push_str(s);
    }
}

/// Convert the tags TSV @p input to reads in @p out, as
/// `tags_to_denovo.py --format F --top-n N --min-length L` writes them.
/// @p progress gets the bytes read so far; @p cancel is checked as it goes.
/// Err where the script refuses the file or stops (what is in @p out then
/// is no export), or browser::CANCELLED.
pub fn convert(
    input: impl BufRead,
    opts: DenovoOptions,
    out: &mut impl Write,
    cancel: &Cancel,
    progress: &mut dyn FnMut(u64),
) -> Result<DenovoSummary, String> {
    if opts.top_n < 1 {
        return Err("the reads per spectrum (top N) must be at least 1".into());
    }
    let mut lines = Lines::new(input);
    let ioerr = |e: std::io::Error| format!("cannot read the tags file: {e}");
    let text = |l: Vec<u8>, at: u64| -> Result<String, String> {
        String::from_utf8(l).map_err(|e| format!("the tags file is not UTF-8 text (byte {})", at + e.utf8_error().valid_up_to() as u64))
    };
    let first = lines.next_line().map_err(ioerr)?.ok_or("the tags file is empty")?;
    let header_line = text(first, 0)?;
    let header: Vec<&str> = header_line.split('\t').collect();
    let mut idx: HashMap<&str, usize> = HashMap::new();
    for (i, h) in header.iter().enumerate() {
        idx.insert(h, i);
    }
    let missing: Vec<&str> = REQUIRED.iter().copied().filter(|c| !idx.contains_key(c)).collect();
    if !missing.is_empty() {
        let hint = if missing.contains(&"res_conf") { " (re-run FASTag with -res_conf)" } else { "" };
        return Err(format!("the tags file lacks column(s) {}{hint}; its header has: {}", missing.join(", "), header.join(", ")));
    }
    let col = |c: &str| idx[c];
    let (c_spec, c_tag, c_len, c_charge) = (col("spectrum"), col("tag"), col("length"), col("charge"));
    let (c_n, c_c, c_ev, c_conf) = (col("nterm_mass"), col("cterm_mass"), col("evalue"), col("res_conf"));
    let ncols = header.len();

    let mut sum = DenovoSummary::default();
    let mut spectra: HashMap<Box<str>, usize> = HashMap::new();
    let mut groups: Vec<(Box<str>, Vec<Kept>)> = Vec::new();
    let mut lineno: u64 = 1;
    let mut confs: Vec<i64> = Vec::new();
    loop {
        let start = lines.consumed;
        let Some(raw) = lines.next_line().map_err(ioerr)? else { break };
        lineno += 1;
        if lineno.is_multiple_of(4096) {
            if cancel.is_cancelled() {
                return Err(browser::CANCELLED.into());
            }
            progress(lines.consumed);
        }
        if raw.is_empty() {
            continue;
        }
        // The offset is the segment's start: exact for \n files, and the
        // byte named is in the right line either way.
        let line = text(raw, start)?;
        sum.rows_read += 1;
        let order = sum.rows_read as u64;
        let f: Vec<&str> = line.split('\t').collect();
        if f.len() < ncols {
            sum.malformed += 1;
            continue;
        }
        let Some(residues) = parse_tag(f[c_tag]) else {
            sum.malformed += 1;
            continue;
        };
        confs.clear();
        let mut ok = true;
        for c in f[c_conf].split(py_space).filter(|x| !x.is_empty()) {
            match py_int_value(c) {
                Some(v) => confs.push(v),
                None => {
                    ok = false;
                    break;
                }
            }
        }
        // Python's chained comparison reads the length only when the residue
        // and confidence counts agree; a length int() cannot read stops the
        // script there.
        if !ok || residues.len() != confs.len() {
            sum.malformed += 1;
            continue;
        }
        let Some(length) = py_int_value(f[c_len]) else {
            return Err(format!("line {lineno}: the length {:?} is not an integer", f[c_len]));
        };
        if length != confs.len() as i64 || confs.iter().any(|c| !(0..=100).contains(c)) {
            sum.malformed += 1;
            continue;
        }
        if (residues.len() as i64) < opts.min_length {
            sum.short += 1;
            continue;
        }
        let row = Kept {
            tag: f[c_tag].into(),
            confs: confs.iter().map(|&c| c as u8).collect(),
            charge: py_int_text(f[c_charge]).unwrap_or_else(|| "0".into()).into(),
            nterm: f[c_n].into(),
            cterm: f[c_c].into(),
            // An E-value float() cannot read ranks last.
            evalue: py_float(f[c_ev]).unwrap_or(f64::INFINITY),
            order,
        };
        let g = match spectra.get(f[c_spec]) {
            Some(&g) => g,
            None => {
                spectra.insert(f[c_spec].into(), groups.len());
                groups.push((f[c_spec].into(), Vec::new()));
                groups.len() - 1
            }
        };
        let rows = &mut groups[g].1;
        // Only the best top_n so far; a later row ranks after every equal
        // one (file order on ties).
        let at = rows.partition_point(|k| !before(&row, k));
        if at < opts.top_n {
            rows.insert(at, row);
            rows.truncate(opts.top_n);
        }
    }
    if cancel.is_cancelled() {
        return Err(browser::CANCELLED.into());
    }
    progress(lines.consumed);

    let werr = |e: std::io::Error| format!("cannot write the reads: {e}");
    let mut unknown: Vec<String> = Vec::new();
    let mut line = String::new();
    line.push_str(match opts.format {
        DenovoFormat::Stitch => STITCH_HEADER,
        DenovoFormat::Alps => ALPS_HEADER,
    });
    line.push('\n');
    out.write_all(line.as_bytes()).map_err(werr)?;
    for (spec, rows) in &groups {
        if cancel.is_cancelled() {
            return Err(browser::CANCELLED.into());
        }
        for r in rows {
            let res = parse_tag(&r.tag).expect("parsed when read");
            let bare: String = res.iter().map(|(c, _)| *c as char).collect();
            let confs = joined(&r.confs);
            let score = alc(&r.confs);
            line.clear();
            match opts.format {
                DenovoFormat::Stitch => {
                    let mut pep = String::new();
                    for (c, m) in &res {
                        pep.push(*c as char);
                        let Some((a, b)) = m else { continue };
                        let name = &r.tag[*a..*b];
                        match delta_of(name) {
                            Some(d) => {
                                pep.push('(');
                                pep.push_str(d);
                                pep.push(')');
                            }
                            None if !unknown.iter().any(|u| u == name) => unknown.push(name.to_string()),
                            None => {}
                        }
                    }
                    let n = res.len().to_string();
                    // Scan: Stitch splits on ',' and cuts at ';'.
                    let scan = spec.replace([',', ';'], "_");
                    let ptm = format!("n={};c={}", r.nterm, r.cterm);
                    // m/z, RT, Area (must be 0: the NaN trap), Mass, ppm.
                    let fields: [&str; 15] = [&scan, &pep, &n, &score, &n, "0", &r.charge, "0", "0", "0", "0", &ptm, &confs, &bare, ""];
                    if let Some(bad) = fields.iter().find(|f| f.contains(',')) {
                        return Err(format!("a comma in {bad:?} would shift every Stitch column after it"));
                    }
                    line.push_str(&fields.join(","));
                }
                DenovoFormat::Alps => {
                    let id = spec.replace(',', "_");
                    for (i, f) in [id.as_str(), &bare, &confs, &score, "1"].iter().enumerate() {
                        if i > 0 {
                            line.push(',');
                        }
                        csv_field(f, &mut line);
                    }
                }
            }
            line.push('\n');
            out.write_all(line.as_bytes()).map_err(werr)?;
            sum.reads += 1;
        }
    }
    sum.unknown_mods = unknown;
    Ok(sum)
}

fn same_file(a: &str, b: &str) -> bool {
    match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        (Ok(x), Ok(y)) => x == y,
        _ => a == b,
    }
}

/// Refusals before a job starts: reads go to a .csv that is neither a
/// folder nor the tags file itself.
pub(crate) fn check_dest(source: &str, dest: &str) -> Result<(), String> {
    if !dest.to_ascii_lowercase().ends_with(".csv") {
        return Err(format!("reads are written to a .csv file, not {dest:?}"));
    }
    if same_file(source, dest) {
        return Err(format!("{dest} is the tags file being exported; choose another name"));
    }
    if Path::new(dest).is_dir() {
        return Err(format!("cannot write {dest}: it is a folder"));
    }
    Ok(())
}

/// The reads of @p source to @p dest through a .part file of this export's
/// own, renamed over @p dest only when complete. @p progress gets (bytes
/// read, file size).
pub fn export_reads(
    source: &str,
    dest: &str,
    opts: DenovoOptions,
    cancel: &Cancel,
    progress: &mut dyn FnMut(u64, u64),
) -> Result<DenovoSummary, String> {
    check_dest(source, dest)?;
    let src = File::open(source).map_err(|e| match e.kind() {
        ErrorKind::NotFound => format!("{source} does not exist"),
        _ => format!("cannot open {source}: {e}"),
    })?;
    let meta = src.metadata().map_err(|e| format!("{source}: {e}"))?;
    if !meta.is_file() {
        return Err(format!("{source} is not a file"));
    }
    let total = meta.len();
    static PART: AtomicU64 = AtomicU64::new(0);
    let part = format!("{dest}.{}-{}.part", std::process::id(), PART.fetch_add(1, Ordering::Relaxed));
    let run = || -> Result<DenovoSummary, String> {
        let werr = |e: std::io::Error| format!("cannot write {dest}: {e}");
        let mut w = BufWriter::with_capacity(4 << 20, File::create(&part).map_err(werr)?);
        progress(0, total);
        let s = convert(BufReader::with_capacity(4 << 20, src), opts, &mut w, cancel, &mut |done| progress(done, total))?;
        w.flush().map_err(werr)?;
        drop(w);
        if cancel.is_cancelled() {
            return Err(browser::CANCELLED.into());
        }
        std::fs::rename(&part, dest).map_err(werr)?;
        Ok(s)
    };
    let r = run();
    if r.is_err() {
        std::fs::remove_file(&part).ok();
    }
    r
}

/// Start a reads export job on a thread of its own; its events go to
/// @p emit as an export job's do, and results_cancel stops it. Returns its
/// id, or why it did not start.
pub(crate) fn start_reads(shared: &Arc<browser::Shared>, source: &str, dest: &str, opts: DenovoOptions, emit: ExportEmit) -> Result<u64, String> {
    if opts.top_n < 1 {
        return Err("the reads per spectrum (top N) must be at least 1".into());
    }
    check_dest(source, dest)?;
    let (job_id, token) = browser::register_job(shared, dest)?;
    let (me, source, dest) = (shared.clone(), source.to_string(), dest.to_string());
    std::thread::spawn(move || {
        // Progress at most every 100 ms, and always the first and the last.
        let last: Mutex<Option<Instant>> = Mutex::new(None);
        let mut progress = |done: u64, total: u64| {
            let mut l = last.lock().unwrap();
            if done == 0 || done == total || l.is_none_or(|t| t.elapsed().as_millis() >= 100) {
                *l = Some(Instant::now());
                emit(ExportEvent::Progress { job_id, done: done as usize, total: total as usize });
            }
        };
        let r = export_reads(&source, &dest, opts, &token, &mut progress);
        browser::end_job(&me, job_id);
        emit(match r {
            Ok(s) => ExportEvent::ReadsDone {
                job_id,
                reads: s.reads,
                rows_read: s.rows_read,
                short: s.short,
                malformed: s.malformed,
                unknown_mods: s.unknown_mods,
                dest,
            },
            Err(_) if token.is_cancelled() => ExportEvent::Cancelled { job_id },
            Err(message) => ExportEvent::Failed { job_id, message },
        });
    });
    Ok(job_id)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn denovo_export(
    state: tauri::State<'_, BrowserCache>,
    source: String,
    dest: String,
    format: DenovoFormat,
    top_n: u64,
    min_length: i64,
    on_event: tauri::ipc::Channel<ExportEvent>,
) -> Result<u64, String> {
    let emit: ExportEmit = Arc::new(move |ev| {
        let _ = on_event.send(ev);
    });
    let opts = DenovoOptions { format, top_n: usize::try_from(top_n).unwrap_or(usize::MAX), min_length };
    start_reads(state.shared(), &source, &dest, opts, emit)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
    use std::time::Duration;

    const DIR: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../src/fixtures/denovo");

    fn fixture(name: &str) -> Vec<u8> {
        std::fs::read(format!("{DIR}/{name}")).unwrap()
    }

    fn run(input: &[u8], format: DenovoFormat, top_n: usize, min_length: i64) -> Result<(String, DenovoSummary), String> {
        let mut out = Vec::new();
        let s = convert(Cursor::new(input), DenovoOptions { format, top_n, min_length }, &mut out, &Cancel::default(), &mut |_| {})?;
        Ok((String::from_utf8(out).unwrap(), s))
    }

    fn tmp(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("fastag-denovo-{}-{}", std::process::id(), name))
    }

    const HEAD: &str = "spectrum\ttag\tlength\tcharge\tnterm_mass\tcterm_mass\tevalue\tres_conf\n";
    fn row(spec: &str, tag: &str, ev: &str, conf: &str) -> String {
        let len = parse_tag(tag).map(|r| r.len()).unwrap_or(tag.len());
        format!("{spec}\t{tag}\t{len}\t2\t0\t0\t{ev}\t{conf}\n")
    }

    #[test]
    fn equals_every_golden_file_of_the_script() {
        let cases: Vec<serde_json::Value> = serde_json::from_slice(&fixture("cases.json")).unwrap();
        assert_eq!(cases.len(), 10);
        for c in cases {
            let format = match c["format"].as_str().unwrap() {
                "stitch" => DenovoFormat::Stitch,
                "alps" => DenovoFormat::Alps,
                f => panic!("{f}"),
            };
            let golden = fixture(c["golden"].as_str().unwrap());
            let input = fixture(c["input"].as_str().unwrap());
            let (text, s) = run(&input, format, c["topN"].as_u64().unwrap() as usize, c["minLength"].as_i64().unwrap()).unwrap();
            assert!(text.as_bytes() == golden.as_slice(), "{}:\n{text}", c["golden"]);
            assert_eq!(s.reads, golden.iter().filter(|&&b| b == b'\n').count() - 1);
        }
    }

    #[test]
    fn best_tag_export_has_one_read_per_tagged_spectrum() {
        let input = fixture("ecoli.res_conf.tags.tsv");
        let spectra: std::collections::HashSet<&[u8]> =
            input.split(|&b| b == b'\n').skip(1).filter(|l| !l.is_empty()).map(|l| l.split(|&b| b == b'\t').next().unwrap()).collect();
        assert_eq!(spectra.len(), 134);
        for format in [DenovoFormat::Stitch, DenovoFormat::Alps] {
            let (text, s) = run(&input, format, 1, 1).unwrap();
            assert_eq!(s.reads, 134);
            let ids: std::collections::HashSet<&[u8]> = text.lines().skip(1).map(|l| l.split(',').next().unwrap().as_bytes()).collect();
            assert_eq!(ids.len(), 134);
            assert_eq!(ids, spectra);
        }
    }

    #[test]
    fn counts_rows_and_unknown_mods_as_the_script() {
        let edge = fixture("edge.tags.tsv");
        let (_, s) = run(&edge, DenovoFormat::Stitch, 1, 8).unwrap();
        assert_eq!((s.rows_read, s.short, s.malformed, s.reads), (25, 4, 7, 4));
        assert!(s.unknown_mods.is_empty());
        let (_, s) = run(&edge, DenovoFormat::Stitch, 50, 1).unwrap();
        let mut m = s.unknown_mods.clone();
        m.sort();
        assert_eq!(m, ["", "Foo"]);
    }

    #[test]
    fn keeps_the_lowest_evalue_file_order_on_ties_spectra_in_first_order() {
        let text = format!(
            "{HEAD}{}{}{}{}",
            row("b", "KKKK", "0.5", "1 1 1 1"),
            row("a", "LLLL", "0.1", "2 2 2 2"),
            row("b", "MMMM", "0.01", "3 3 3 3"),
            row("a", "NNNN", "0.1", "4 4 4 4")
        );
        let (out, _) = run(text.as_bytes(), DenovoFormat::Alps, 1, 1).unwrap();
        let got: Vec<String> = out.lines().skip(1).map(|l| l.split(',').take(2).collect::<Vec<_>>().join(",")).collect();
        assert_eq!(got, ["b,MMMM", "a,LLLL"]);
        // NaN after +inf and after an E-value float() cannot read (+inf).
        let text = format!("{HEAD}{}{}{}", row("a", "KKKK", "nan", "1 1 1 1"), row("a", "LLLL", "inf", "1 1 1 1"), row("a", "MMMM", "x", "1 1 1 1"));
        let (out, _) = run(text.as_bytes(), DenovoFormat::Alps, 3, 1).unwrap();
        let got: Vec<&str> = out.lines().skip(1).map(|l| l.split(',').nth(1).unwrap()).collect();
        assert_eq!(got, ["LLLL", "MMMM", "KKKK"]);
    }

    #[test]
    fn refuses_what_the_script_refuses() {
        let e = run(b"spectrum\ttag\tlength\tcharge\tnterm_mass\tcterm_mass\tevalue\n", DenovoFormat::Stitch, 1, 1).unwrap_err();
        assert!(e.contains("res_conf") && e.contains("-res_conf"), "{e}");
        assert!(run(b"", DenovoFormat::Alps, 1, 1).unwrap_err().contains("empty"));
        assert!(run(HEAD.as_bytes(), DenovoFormat::Alps, 0, 1).unwrap_err().contains("top"));
        let four = format!("{HEAD}a\tKKKK\tfour\t2\t0\t0\t0.1\t1 1 1 1\n");
        assert!(run(four.as_bytes(), DenovoFormat::Alps, 1, 1).unwrap_err().contains("length"));
        // A count mismatch is a skipped row before the length is read.
        let skip = format!("{HEAD}a\tKKKK\tfour\t2\t0\t0\t0.1\t1 1 1\n");
        let (_, s) = run(skip.as_bytes(), DenovoFormat::Alps, 1, 1).unwrap();
        assert_eq!((s.reads, s.malformed), (0, 1));
        let comma = format!("{HEAD}a\tKKKK\t4\t2\t1,5\t0\t0.1\t1 1 1 1\n");
        assert!(run(comma.as_bytes(), DenovoFormat::Stitch, 1, 1).unwrap_err().contains("comma"));
        assert_eq!(run(comma.as_bytes(), DenovoFormat::Alps, 1, 1).unwrap().0, "Spectrum Name,Peptide,aaScore,Score,Area\na,KKKK,1 1 1 1,1,1\n");
        let mut latin = HEAD.as_bytes().to_vec();
        latin.extend_from_slice(b"\xe9\n");
        let e = run(&latin, DenovoFormat::Alps, 1, 1).unwrap_err();
        assert!(e.contains(&format!("UTF-8 text (byte {})", HEAD.len())), "{e}");
    }

    #[test]
    fn mirrors_python_int_float_and_round() {
        assert_eq!(py_int_text(" +0_07 ").as_deref(), Some("7"));
        assert_eq!(py_int_text("-0").as_deref(), Some("0"));
        assert_eq!(py_int_text("\u{2003}-12\u{1f}").as_deref(), Some("-12"));
        assert_eq!(py_int_text("123456789012345678901234567890").as_deref(), Some("123456789012345678901234567890"));
        assert_eq!(py_int_value("123456789012345678901234567890"), Some(i64::MAX));
        for bad in ["", "1_", "_1", "1__0", "x", "1.0", "+", "-", "\u{663}"] {
            assert_eq!(py_int(bad), None, "{bad}");
        }
        assert_eq!(py_float("1e400"), Some(f64::INFINITY));
        assert_eq!(py_float("-Infinity"), Some(f64::NEG_INFINITY));
        assert_eq!(py_float(" 1_0 "), Some(10.0));
        assert_eq!(py_float("5."), Some(5.0));
        assert_eq!(py_float(".5e-1_0"), Some(0.5e-10));
        assert_eq!(py_float("1E5"), Some(1e5));
        assert!(py_float("NaN").unwrap().is_nan());
        for bad in ["", ".", "-", "1e", "e5", "1_.5", "0x10", "inf1", "1e+", "1.5.5"] {
            assert_eq!(py_float(bad), None, "{bad}");
        }
        assert_eq!(alc(&[50, 51]), "50");
        assert_eq!(alc(&[51, 52]), "52");
        assert_eq!(alc(&[0, 0, 0, 1]), "0");
    }

    #[test]
    fn splits_lines_as_universal_newlines() {
        let mut l = Lines::new(Cursor::new(b"a\r\nb\rc\n\r\n\rd\r\re".to_vec()));
        let mut got = Vec::new();
        while let Some(x) = l.next_line().unwrap() {
            got.push(String::from_utf8(x).unwrap());
        }
        assert_eq!(got, ["a", "b", "c", "", "", "d", "", "e"]);
        assert_eq!(l.consumed, 14);
    }

    fn wait(got: &Arc<Mutex<Vec<ExportEvent>>>, id: u64) -> ExportEvent {
        for _ in 0..4000 {
            if let Some(e) = got.lock().unwrap().iter().find(|e| e.job_id() == id && e.is_terminal()) {
                return e.clone();
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        panic!("job {id} did not end");
    }

    fn collector() -> (ExportEmit, Arc<Mutex<Vec<ExportEvent>>>) {
        let got: Arc<Mutex<Vec<ExportEvent>>> = Arc::default();
        let g = got.clone();
        (Arc::new(move |e| g.lock().unwrap().push(e)), got)
    }

    fn parts_left(dest: &Path) -> bool {
        let stem = dest.file_name().unwrap().to_string_lossy().into_owned();
        let dir = std::fs::read_dir(dest.parent().unwrap()).unwrap();
        dir.flatten().any(|e| {
            let n = e.file_name().to_string_lossy().into_owned();
            n.starts_with(&stem) && n.ends_with(".part")
        })
    }

    #[test]
    fn a_job_writes_the_reads_through_a_part_file_with_progress() {
        let src = tmp("job.tags.tsv");
        let dest = tmp("job.stitch.csv");
        std::fs::copy(format!("{DIR}/ecoli.res_conf.tags.tsv"), &src).unwrap();
        std::fs::write(&dest, "old\n").unwrap();
        let shared = Arc::new(browser::Shared::default());
        let (emit, got) = collector();
        let opts = DenovoOptions { format: DenovoFormat::Stitch, top_n: 1, min_length: 8 };
        let id = start_reads(&shared, src.to_str().unwrap(), dest.to_str().unwrap(), opts, emit).unwrap();
        let golden = fixture("ecoli.stitch.csv");
        let reads = golden.iter().filter(|&&b| b == b'\n').count() - 1;
        match wait(&got, id) {
            ExportEvent::ReadsDone { reads: r, rows_read, dest: d, .. } => {
                assert_eq!((r, rows_read), (reads, 2322));
                assert_eq!(d, dest.to_str().unwrap());
            }
            e => panic!("{e:?}"),
        }
        assert!(std::fs::read(&dest).unwrap() == golden);
        let size = std::fs::metadata(&src).unwrap().len() as usize;
        let ev = got.lock().unwrap();
        assert_eq!(ev.first(), Some(&ExportEvent::Progress { job_id: id, done: 0, total: size }));
        assert!(ev.contains(&ExportEvent::Progress { job_id: id, done: size, total: size }));
        assert!(!parts_left(&dest));
        std::fs::remove_file(&src).ok();
        std::fs::remove_file(&dest).ok();
    }

    #[test]
    fn a_cancelled_job_writes_nothing_and_frees_its_name() {
        let src = tmp("big.tags.tsv");
        let dest = tmp("big.alps.csv");
        // Enough rows that the job is still reading when Cancel comes.
        let mut text = String::from(HEAD);
        for i in 0..400_000 {
            text.push_str(&row(&format!("s{i}"), "KKKKKKKK", "0.1", "1 1 1 1 1 1 1 1"));
        }
        std::fs::write(&src, text).unwrap();
        let shared = Arc::new(browser::Shared::default());
        let (emit, got) = collector();
        let opts = DenovoOptions { format: DenovoFormat::Alps, top_n: 1, min_length: 1 };
        let (s, d) = (src.to_str().unwrap(), dest.to_str().unwrap());
        let id = start_reads(&shared, s, d, opts, emit.clone()).unwrap();
        // One job per name at a time, as the table export.
        assert!(start_reads(&shared, s, d, opts, emit.clone()).unwrap_err().contains("still running"));
        assert!(browser::cancel_export(&shared, id));
        assert_eq!(wait(&got, id), ExportEvent::Cancelled { job_id: id });
        assert!(!dest.exists());
        assert!(!parts_left(&dest));
        assert!(!browser::cancel_export(&shared, id));
        // The name is free again; the next job gets a larger id.
        let next = start_reads(&shared, s, d, opts, emit).unwrap();
        assert!(next > id);
        assert!(matches!(wait(&got, next), ExportEvent::ReadsDone { reads: 400_000, .. }));
        std::fs::remove_file(&src).ok();
        std::fs::remove_file(&dest).ok();
    }

    #[test]
    fn a_cancel_token_stops_the_conversion_and_the_write() {
        let text = format!("{HEAD}{}", row("a", "KKKK", "0.1", "1 1 1 1").repeat(10_000));
        let c = Cancel::default();
        c.cancel();
        let mut out = Vec::new();
        let opts = DenovoOptions { format: DenovoFormat::Alps, top_n: 1, min_length: 1 };
        assert_eq!(convert(Cursor::new(text.as_bytes()), opts, &mut out, &c, &mut |_| {}).unwrap_err(), browser::CANCELLED);
        let src = tmp("c.tags.tsv");
        let dest = tmp("c.alps.csv");
        std::fs::write(&src, &text).unwrap();
        assert_eq!(export_reads(src.to_str().unwrap(), dest.to_str().unwrap(), opts, &c, &mut |_, _| {}).unwrap_err(), browser::CANCELLED);
        assert!(!dest.exists());
        assert!(!parts_left(&dest));
        std::fs::remove_file(&src).ok();
    }

    #[test]
    fn never_over_the_source_only_to_a_csv_and_failures_write_nothing() {
        let src = tmp("s.csv");
        std::fs::write(&src, "spectrum\n").unwrap();
        let s = src.to_str().unwrap();
        let shared = Arc::new(browser::Shared::default());
        let opts = DenovoOptions { format: DenovoFormat::Alps, top_n: 1, min_length: 1 };
        let e = start_reads(&shared, s, s, opts, collector().0).unwrap_err();
        assert!(e.contains("being exported"), "{e}");
        assert_eq!(std::fs::read_to_string(&src).unwrap(), "spectrum\n");
        let e = start_reads(&shared, s, tmp("r.tsv").to_str().unwrap(), opts, collector().0).unwrap_err();
        assert!(e.contains(".csv"), "{e}");
        let folder = tmp("folder.csv");
        std::fs::create_dir_all(&folder).unwrap();
        let e = start_reads(&shared, s, folder.to_str().unwrap(), opts, collector().0).unwrap_err();
        assert!(e.contains("folder"), "{e}");
        std::fs::remove_dir(&folder).ok();
        let bad = DenovoOptions { top_n: 0, ..opts };
        assert!(start_reads(&shared, s, tmp("t.csv").to_str().unwrap(), bad, collector().0).unwrap_err().contains("top"));
        // Failures end the job and leave nothing: a missing folder, a file
        // the script refuses, a missing tags file.
        let dest = tmp("refused.alps.csv");
        let missing = std::env::temp_dir().join("fastag-no-such-dir").join("r.csv");
        for (from, to, says) in [
            (s, missing.to_str().unwrap(), "cannot write"),
            (s, dest.to_str().unwrap(), "lacks column"),
            ("/nonexistent/fastag/x.tags.tsv", dest.to_str().unwrap(), "does not exist"),
        ] {
            let (emit, got) = collector();
            let id = start_reads(&shared, from, to, opts, emit).unwrap();
            match wait(&got, id) {
                ExportEvent::Failed { message, .. } => assert!(message.contains(says), "{message}"),
                e => panic!("{e:?}"),
            }
            assert!(!Path::new(to).exists());
        }
        assert!(!parts_left(&dest));
        std::fs::remove_file(&src).ok();
    }
}
