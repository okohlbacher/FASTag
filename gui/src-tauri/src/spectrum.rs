// The Spectrum tab's two backend commands (GUI-DESIGN S5 and 6.7, P4):
//
// - spectrum_support: whether the CLI has -dump_spectrum, read from the
//   options its `--helphelp` lists (never from the version string: the 1.12
//   builds still say 1.11.0). Without it the renderer hides the tab and the
//   Tags table's row action says "Spectrum view needs FASTag 1.17 or later".
// - spectrum_peaks: `FASTag <the run's argv> -dump_spectrum <nativeId>`, the
//   peaks FASTag tagged in one spectrum, under the run's own options. The
//   JSON lines go to the renderer as text; src/spectrum/dump.ts is their one
//   parser. The last 64 dumps are kept (an LRU keyed by the binary, the
//   input file's size and mtime, and the argv), so prev/next and a redraw
//   start no CLI.
//
// No fallback reader: raw peaks from another reader are not the peaks
// FASTag used, and a ladder on them would mislead. The GUI reads no spectra
// file itself. The CLI is spawned with an argv array (no shell), with the
// environment a run gets, through lifetime::spawn_cli like every CLI child.

use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime};

use serde::Serialize;
use serde_json::{Map, Value};
use tauri::AppHandle;

use crate::fastag::{build_args, no_console_window, quiet_blas, resolve_binary, taxonomy_dir, Resolved, RunParams, MANIFEST};
use crate::lifetime;

/// --helphelp loads the library closure: seconds on a cold cache.
const HELP_TIMEOUT: Duration = Duration::from_secs(60);
/// One spectrum; an mzML without an index is scanned for it, so a large
/// file on a network share may take a while.
pub const DUMP_TIMEOUT: Duration = Duration::from_secs(180);
/// A dump holds at most 1024 peaks (-max_peaks); far more is not a dump.
pub const DUMP_MAX_BYTES: usize = 8 << 20;
/// The dumps kept (GUI-DESIGN 6.7).
pub const LRU_CAPACITY: usize = 64;

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct SpectrumSupport {
    /// --helphelp lists -dump_spectrum.
    pub supported: bool,
    /// --helphelp ran and listed options; false: the CLI could not be asked.
    pub probed: bool,
    pub detail: String,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SpectrumDump {
    /// Exited 0 within the timeout.
    pub ok: bool,
    pub code: Option<i32>,
    pub timed_out: bool,
    /// The input file does not exist (it moved): "Locate input…".
    pub missing: bool,
    /// The JSON lines, for dump.ts.
    pub stdout: String,
    /// The last stderr line: why a dump failed.
    pub reason: Option<String>,
    /// Served from the LRU.
    pub cached: bool,
}

/// The option names of a TOPP `--help`/`--helphelp` text: the lines indented
/// by exactly two spaces that start with one dash ("  -dump_spectrum
/// <nativeId>"). Continuation lines are indented deeper, and the common TOPP
/// flags have two dashes. (The same rule as P2b's inspect.rs, which this
/// follows until both share one probe.)
pub fn parse_options(text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for line in text.lines() {
        let Some(rest) = line.strip_prefix("  -") else { continue };
        if rest.starts_with('-') || rest.starts_with(' ') {
            continue;
        }
        let name: String = rest.chars().take_while(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == ':').collect();
        if !name.is_empty() && !out.contains(&name) {
            out.push(name);
        }
    }
    out
}

/// Option families of the run that do not change the peaks of a spectrum or
/// its tags: the species, glyco, reconciliation, mass-gap and digest/label
/// reports and their settings, and subsampling (which could skip the very
/// spectrum asked for). A dump drops them, beside every file-typed option.
const NOT_FOR_A_DUMP: &[&str] = &["species", "glyco", "recon_", "massgap_", "digest_", "label_", "delta_", "subsample_"];
const NOT_FOR_A_DUMP_EXACT: &[&str] = &["stream", "log", "test", "progress", "no_progress", "dump_spectrum", "probe_input"];

/// Whether a dump keeps the run's option @p name: not a file (TOPPBase
/// checks every file option it reads, so a moved -taxdb or an unwritable
/// report folder would refuse the dump, and the CLI would warn that every
/// output is ignored), nor one of NOT_FOR_A_DUMP.
fn kept_for_a_dump(name: &str, types: &std::collections::HashMap<String, String>) -> bool {
    let file = types.get(name).is_some_and(|t| t == "input-file" || t == "output-file");
    !file && !NOT_FOR_A_DUMP_EXACT.contains(&name) && !NOT_FOR_A_DUMP.iter().any(|p| name.starts_with(p))
}

/// The manifest's option types by name.
fn manifest_types() -> std::collections::HashMap<String, String> {
    let m: Value = serde_json::from_str(MANIFEST).unwrap_or(Value::Null);
    m.get("params")
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|it| Some((it.get("name")?.as_str()?.to_string(), it.get("type")?.as_str()?.to_string())))
                .collect()
        })
        .unwrap_or_default()
}

/// The argv of a dump of @p native_id in @p input under the run's @p params
/// (as `run` was sent them; none: the CLI's defaults), or why there is none.
/// The options that prepare the peaks and build the tags are kept (the
/// tolerance, deisotoping, the peak budget, modifications, tag lengths,
/// threads); -in is the one file. Every other file option (-out, -fasta,
/// -taxdb, the reports), the species/glyco/report modes, subsampling and
/// -progress are not (kept_for_a_dump).
pub fn dump_args(input: &str, native_id: &str, params: Option<&Map<String, Value>>) -> Result<Vec<String>, String> {
    if !Path::new(input).is_absolute() || input.starts_with('-') {
        return Err(format!("not an absolute path: {input}"));
    }
    if native_id.is_empty() || native_id.starts_with('-') || native_id.contains(['\n', '\r', '\0']) {
        return Err(format!("not a native ID: {native_id:?}"));
    }
    let mut rp = serde_json::json!({ "in": input, "out": "" });
    if let Some(p) = params {
        let types = manifest_types();
        rp["params"] = Value::Object(p.iter().filter(|(k, _)| kept_for_a_dump(k, &types)).map(|(k, v)| (k.clone(), v.clone())).collect());
    }
    let rp: RunParams = serde_json::from_value(rp).map_err(|e| e.to_string())?;
    let built = build_args(&rp);
    let mut args: Vec<String> = Vec::with_capacity(built.len() + 2);
    let mut i = 0;
    while i < built.len() {
        let a = built[i].as_str();
        match a {
            "-progress" => i += 1,
            // An option and its value.
            "-out" | "-dump_spectrum" | "-probe_input" => i += 2,
            _ => {
                args.push(built[i].clone());
                i += 1;
            }
        }
    }
    args.push("-dump_spectrum".into());
    args.push(native_id.into());
    Ok(args)
}

/// A small LRU of dumps by key; the most recent last.
pub struct Lru<V> {
    cap: usize,
    items: Vec<(String, V)>,
}

impl<V: Clone> Lru<V> {
    pub fn new(cap: usize) -> Self {
        Lru { cap, items: Vec::new() }
    }
    pub fn get(&mut self, key: &str) -> Option<V> {
        let i = self.items.iter().position(|(k, _)| k == key)?;
        let it = self.items.remove(i);
        let v = it.1.clone();
        self.items.push(it);
        Some(v)
    }
    pub fn put(&mut self, key: String, v: V) {
        self.items.retain(|(k, _)| *k != key);
        self.items.push((key, v));
        if self.items.len() > self.cap {
            self.items.remove(0);
        }
    }
    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.items.len()
    }
}

fn command(r: &Resolved) -> Command {
    let mut cmd = Command::new(&r.bin);
    no_console_window(&mut cmd);
    if let Some(d) = &r.data {
        cmd.env("OPENMS_DATA_PATH", d);
    }
    if let Some(t) = taxonomy_dir(r) {
        cmd.env("FASTAG_TAXONOMY_DIR", t);
    }
    quiet_blas(&mut cmd);
    lifetime::die_with_parent(&mut cmd);
    cmd
}

struct Bounded {
    code: Option<i32>,
    timed_out: bool,
    stdout: String,
    stderr: String,
}

/// Run @p cmd to its end or @p timeout (then kill it), reading at most
/// @p max bytes of stdout.
fn run_bounded(mut cmd: Command, timeout: Duration, max: usize) -> std::io::Result<Bounded> {
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let (mut child, job) = lifetime::spawn_cli(cmd)?;
    let mut so = child.stdout.take().expect("piped");
    let mut se = child.stderr.take().expect("piped");
    let out = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = so.by_ref().take(max as u64).read_to_end(&mut buf);
        let _ = std::io::copy(&mut so, &mut std::io::sink());
        buf
    });
    let err = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = se.by_ref().take(256 * 1024).read_to_end(&mut buf);
        let _ = std::io::copy(&mut se, &mut std::io::sink());
        buf
    });
    let until = Instant::now() + timeout;
    let status = loop {
        if let Some(s) = child.try_wait()? {
            break Some(s);
        }
        if Instant::now() >= until {
            #[cfg(windows)]
            if let Some(j) = &job {
                j.terminate();
            }
            let _ = child.kill();
            let _ = child.wait();
            break None;
        }
        std::thread::sleep(Duration::from_millis(10));
    };
    #[cfg(windows)]
    drop(job);
    #[cfg(not(windows))]
    let () = job;
    // A grandchild holding the pipes would keep the readers alive: joined
    // only when the child itself ended in time.
    let (stdout, stderr) = if status.is_none() {
        (Vec::new(), Vec::new())
    } else {
        (out.join().unwrap_or_default(), err.join().unwrap_or_default())
    };
    Ok(Bounded {
        code: status.and_then(|s| s.code()),
        timed_out: status.is_none(),
        stdout: String::from_utf8_lossy(&stdout).into_owned(),
        stderr: String::from_utf8_lossy(&stderr).into_owned(),
    })
}

/// The binary's identity for the caches: its path, size and mtime (a new
/// CLI under the same name is asked again).
fn bin_key(bin: &Path) -> String {
    let m = std::fs::metadata(bin).ok();
    let mtime = m.as_ref().and_then(|m| m.modified().ok()).and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok());
    format!("{}\u{0}{:?}\u{0}{:?}", bin.display(), m.map(|m| m.len()), mtime)
}

/// Whether the binary @p r resolves to has -dump_spectrum.
pub fn support_of(r: &Resolved) -> SpectrumSupport {
    if r.source == "missing" {
        return SpectrumSupport { supported: false, probed: false, detail: "no FASTag binary".into() };
    }
    let mut cmd = command(r);
    cmd.arg("--helphelp");
    match run_bounded(cmd, HELP_TIMEOUT, 4 << 20) {
        Ok(b) => {
            // TOPP prints its help to stderr.
            let options = parse_options(&format!("{}\n{}", b.stdout, b.stderr));
            if options.is_empty() {
                let why = if b.timed_out { "timed out".to_string() } else { format!("exit {:?}", b.code) };
                return SpectrumSupport { supported: false, probed: false, detail: format!("--helphelp listed no options ({why})") };
            }
            let supported = options.iter().any(|o| o == "dump_spectrum");
            let detail = if supported { "the CLI has -dump_spectrum" } else { "the CLI has no -dump_spectrum" };
            SpectrumSupport { supported, probed: true, detail: detail.into() }
        }
        Err(e) => SpectrumSupport { supported: false, probed: false, detail: format!("cannot execute: {e}") },
    }
}

/// The last stderr line that says something.
fn last_line(text: &str) -> Option<String> {
    text.lines().map(str::trim).rfind(|l| !l.is_empty() && !l.starts_with("FASTag took ")).map(|l| l.chars().take(300).collect())
}

/// The CLI's answer for a native ID the input does not have (exit 6).
fn is_not_found(code: Option<i32>, reason: Option<&str>) -> bool {
    code == Some(6) && reason.is_some_and(|r| r.starts_with("-dump_spectrum: no spectrum of"))
}

/// The dump of @p native_id in @p input under @p params, through @p lru.
pub fn dump_of(
    r: &Resolved,
    lru: &Mutex<Lru<Arc<SpectrumDump>>>,
    input: &str,
    native_id: &str,
    params: Option<&Map<String, Value>>,
) -> Result<SpectrumDump, String> {
    let args = dump_args(input, native_id, params)?;
    let meta = match std::fs::metadata(input) {
        Ok(m) if m.is_file() => m,
        Ok(_) => return Err(format!("{input} is not a file")),
        Err(_) => {
            return Ok(SpectrumDump {
                ok: false,
                code: None,
                timed_out: false,
                missing: true,
                stdout: String::new(),
                reason: Some(format!("{input} does not exist")),
                cached: false,
            })
        }
    };
    let mtime = meta.modified().ok().and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok());
    // The environment the CLI is given is part of what it answers.
    let env = format!("{:?}\u{0}{:?}", r.data, taxonomy_dir(r));
    let key = format!("{}\u{0}{}\u{0}{:?}\u{0}{}\u{0}{}", bin_key(&r.bin), meta.len(), mtime, env, args.join("\u{0}"));
    if let Some(hit) = lru.lock().map_err(|_| "the dump cache is poisoned")?.get(&key) {
        return Ok(SpectrumDump { cached: true, ..(*hit).clone() });
    }
    if r.source == "missing" {
        return Err("no FASTag binary".into());
    }
    let mut cmd = command(r);
    cmd.args(&args);
    let b = run_bounded(cmd, DUMP_TIMEOUT, DUMP_MAX_BYTES).map_err(|e| format!("cannot execute {}: {e}", r.bin.display()))?;
    let ok = b.code == Some(0) && !b.timed_out;
    let d = SpectrumDump {
        ok,
        code: b.code,
        timed_out: b.timed_out,
        missing: false,
        stdout: if ok { b.stdout } else { String::new() },
        reason: if ok { None } else if b.timed_out { Some(format!("no answer within {} s", DUMP_TIMEOUT.as_secs())) } else { last_line(&b.stderr) },
        cached: false,
    };
    // Only answers that hold until the input changes: a dump, or the
    // spectrum is not in the file. Every other refusal (exit 6 is any
    // ILLEGAL_PARAMETERS: an option this CLI does not take, a check on a file
    // the key does not cover) and a timeout may pass on a second try.
    if ok || is_not_found(b.code, d.reason.as_deref()) {
        lru.lock().map_err(|_| "the dump cache is poisoned")?.put(key, Arc::new(d.clone()));
    }
    Ok(d)
}

/// Managed state: the dumps and the support answer per binary.
pub struct SpectrumCache {
    // An Arc: the blocking task of a dump outlives the State borrow.
    lru: Arc<Mutex<Lru<Arc<SpectrumDump>>>>,
    support: Mutex<Option<(String, SpectrumSupport)>>,
}

impl Default for SpectrumCache {
    fn default() -> Self {
        SpectrumCache { lru: Arc::new(Mutex::new(Lru::new(LRU_CAPACITY))), support: Mutex::new(None) }
    }
}

// async + spawn_blocking: --helphelp and a dump start the CLI, and a sync
// command would block the main thread meanwhile.
#[tauri::command]
pub async fn spectrum_support(app: AppHandle, state: tauri::State<'_, SpectrumCache>) -> Result<SpectrumSupport, String> {
    let r = resolve_binary(&app);
    let key = bin_key(&r.bin);
    if let Some((k, s)) = state.support.lock().map_err(|_| "the support cache is poisoned")?.as_ref() {
        if *k == key {
            return Ok(s.clone());
        }
    }
    let s = tauri::async_runtime::spawn_blocking(move || support_of(&r)).await.map_err(|e| e.to_string())?;
    // A CLI that could not be asked is asked again next time.
    if s.probed {
        *state.support.lock().map_err(|_| "the support cache is poisoned")? = Some((key, s.clone()));
    }
    Ok(s)
}

#[tauri::command]
pub async fn spectrum_peaks(
    app: AppHandle,
    state: tauri::State<'_, SpectrumCache>,
    input: String,
    native_id: String,
    params: Option<Map<String, Value>>,
) -> Result<SpectrumDump, String> {
    let r = resolve_binary(&app);
    let lru = state.lru.clone();
    tauri::async_runtime::spawn_blocking(move || dump_of(&r, &lru, &input, &native_id, params.as_ref()))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    // Real --helphelp output (gui/src/fixtures/cli/v112-ecoli-dump/README):
    // the G1 CLI, which has -dump_spectrum, and FASTag 1.11.0, which has not.
    fn fixture(name: &str) -> String {
        let p = format!("{}/../src/fixtures/cli/v112-ecoli-dump/{name}", env!("CARGO_MANIFEST_DIR"));
        std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("{p}: {e}"))
    }
    const STUB: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../testing/stub-fastag/FASTag");
    const STUB_111: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../testing/stub-fastag-1.11/FASTag");
    const SCAN: &str = "controllerType=0 controllerNumber=1 scan=11461";

    fn resolved(bin: &str) -> Resolved {
        Resolved { bin: PathBuf::from(bin), data: None, taxonomy: None, source: "env" }
    }

    #[test]
    fn helphelp_of_the_g1_cli_lists_dump_spectrum_and_1_11_does_not() {
        let g1 = parse_options(&fixture("helphelp.txt"));
        assert!(g1.iter().any(|o| o == "dump_spectrum"), "{g1:?}");
        assert!(g1.iter().any(|o| o == "probe_input"));
        assert!(g1.iter().any(|o| o == "fragment_tolerance"));
        let v111 = parse_options(&fixture("helphelp-1.11.0.txt"));
        assert!(v111.iter().any(|o| o == "fragment_tolerance"), "{v111:?}");
        assert!(!v111.iter().any(|o| o == "dump_spectrum"));
        // Neither the TOPP common flags (two dashes) nor continuation lines.
        assert!(!g1.iter().any(|o| o.starts_with('-') || o == "helphelp"));
    }

    #[test]
    fn a_dump_keeps_the_runs_options_and_drops_out_and_progress() {
        let params: Map<String, Value> = serde_json::from_str(
            r#"{"fragment_tolerance": "0.3", "fragment_tolerance_unit": "Da", "deisotope": true,
                "digest_out": "run.digest.tsv", "dump_spectrum": "other", "fixed_modifications": [],
                "taxdb": "/moved/custom.taxdb", "species": true, "species_out": "/ro/run.species.tsv",
                "species_rank": "genus", "taxonomy_nodes": "/moved/nodes.dmp", "fasta": "/db/ecoli.fasta",
                "glyco": true, "glyco_out": "/ro/g.tsv", "recon_out": "/ro/r.tsv", "subsample_spectra": 10,
                "max_peaks": 300, "tag_length": 4, "threads": 2, "no_deisotope": true}"#,
        )
        .unwrap();
        let a = dump_args("/data/run01.mzML", SCAN, Some(&params)).unwrap();
        let has = |o: &str| a.iter().position(|x| x == o);
        assert_eq!(&a[0..2], ["-in", "/data/run01.mzML"]);
        let t = has("-fragment_tolerance").expect("the run's tolerance");
        assert_eq!(a[t + 1], "0.3");
        assert!(has("-out").is_none() && has("-progress").is_none(), "{a:?}");
        // No file but -in, no species/glyco/report mode, no subsampling.
        for o in ["-digest_out", "-taxdb", "-species_out", "-species", "-species_rank", "-taxonomy_nodes", "-fasta", "-glyco", "-glyco_out", "-recon_out", "-subsample_spectra"] {
            assert!(has(o).is_none(), "{o} in {a:?}");
        }
        // What prepares the peaks and builds the tags stays.
        for (o, v) in [("-max_peaks", "300"), ("-tag_length", "4"), ("-threads", "2")] {
            assert_eq!(a[has(o).unwrap_or_else(|| panic!("{o} in {a:?}")) + 1], v);
        }
        assert!(has("-no_deisotope").is_some() && has("-fragment_tolerance_unit").is_some(), "{a:?}");
        assert_eq!(a.iter().filter(|x| *x == "-dump_spectrum").count(), 1, "{a:?}");
        assert_eq!(&a[a.len() - 2..], ["-dump_spectrum", SCAN]);
        // A cleared fixed-modification list stays cleared ("-name ''").
        let f = has("-fixed_modifications").expect("cleared list");
        assert_eq!(a[f + 1], "");
        // No params: the CLI's defaults.
        assert_eq!(dump_args("/d/a.mgf", "index=3", None).unwrap(), ["-in", "/d/a.mgf", "-dump_spectrum", "index=3"]);
    }

    #[test]
    fn a_dump_refuses_a_relative_input_and_an_id_that_reads_as_an_option() {
        assert!(dump_args("run.mzML", SCAN, None).is_err());
        assert!(dump_args("/d/a.mzML", "-force", None).is_err());
        assert!(dump_args("/d/a.mzML", "", None).is_err());
        assert!(dump_args("/d/a.mzML", "scan=1\n-force", None).is_err());
    }

    #[test]
    fn the_lru_keeps_the_64_most_recent_and_a_get_refreshes() {
        let mut l: Lru<u32> = Lru::new(LRU_CAPACITY);
        for i in 0..LRU_CAPACITY as u32 {
            l.put(format!("k{i}"), i);
        }
        assert_eq!(l.get("k0"), Some(0)); // now the most recent
        l.put("new".into(), 99);
        assert_eq!(l.len(), LRU_CAPACITY);
        assert_eq!(l.get("k1"), None, "the least recent went");
        assert_eq!(l.get("k0"), Some(0));
        assert_eq!(l.get("new"), Some(99));
        l.put("new".into(), 100);
        assert_eq!(l.len(), LRU_CAPACITY);
        assert_eq!(l.get("new"), Some(100));
    }

    #[cfg(unix)]
    #[test]
    fn the_stub_cli_has_dump_spectrum_and_the_1_11_stub_has_not() {
        let s = support_of(&resolved(STUB));
        assert!(s.probed && s.supported, "{s:?}");
        let old = support_of(&resolved(STUB_111));
        assert!(old.probed && !old.supported, "{old:?}");
        let gone = support_of(&Resolved { source: "missing", ..resolved("/nonexistent/FASTag") });
        assert!(!gone.probed && !gone.supported);
    }

    #[cfg(unix)]
    #[test]
    fn a_dump_through_the_stub_is_the_cli_output_and_is_cached() {
        let dir = std::env::temp_dir().join(format!("fastag-spectrum-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let input = dir.join("run01.mzML");
        std::fs::write(&input, "spectra (the stub reads nothing)\n").unwrap();
        let input = input.to_str().unwrap();
        let lru = Mutex::new(Lru::new(LRU_CAPACITY));
        let r = resolved(STUB);
        let d = dump_of(&r, &lru, input, SCAN, None).unwrap();
        assert!(d.ok && !d.cached, "{d:?}");
        assert!(d.stdout.starts_with(r#"{"record":"spectrum","format":1,"native_id":"controllerType=0 controllerNumber=1 scan=11461""#));
        assert!(d.stdout.ends_with("{\"record\":\"end\"}\n"));
        let again = dump_of(&r, &lru, input, SCAN, None).unwrap();
        assert!(again.cached && again.stdout == d.stdout);
        // Other options are another dump.
        let p: Map<String, Value> = serde_json::from_str(r#"{"fragment_tolerance": "0.3"}"#).unwrap();
        assert!(!dump_of(&r, &lru, input, SCAN, Some(&p)).unwrap().cached);
        // An unknown ID: exit 6, its reason, nothing to parse.
        let none = dump_of(&r, &lru, input, "scan=does-not-exist", None).unwrap();
        assert!(!none.ok && none.code == Some(6) && none.stdout.is_empty(), "{none:?}");
        assert!(none.reason.as_deref().unwrap_or("").contains("has the native ID 'scan=does-not-exist'"), "{none:?}");
        // An input that moved: "Locate input…", no CLI started.
        let moved = dump_of(&r, &lru, &format!("{input}.moved"), SCAN, None).unwrap();
        assert!(moved.missing && !moved.ok);
        // ... and is cached: the input does not have it.
        assert!(dump_of(&r, &lru, input, "scan=does-not-exist", None).unwrap().cached);
        // The 1.11 CLI refuses the option: exit 6 too, but no answer about
        // the spectrum, so it is asked again (Try again can pass).
        let old_lru = Mutex::new(Lru::new(4));
        let old = dump_of(&resolved(STUB_111), &old_lru, input, SCAN, None).unwrap();
        assert!(!old.ok && old.code == Some(6), "{old:?}");
        assert!(!old.reason.as_deref().unwrap_or("").starts_with("-dump_spectrum: no spectrum of"), "{old:?}");
        let again = dump_of(&resolved(STUB_111), &old_lru, input, SCAN, None).unwrap();
        assert!(!again.cached && again.code == Some(6), "{again:?}");
        assert_eq!(old_lru.lock().unwrap().len(), 0);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn the_unknown_id_message_of_the_real_cli_is_the_reason() {
        // unknown.err: the G1 CLI's stderr for an unknown ID (exit 6).
        let r = last_line(&fixture("unknown.err")).unwrap();
        assert!(r.starts_with("-dump_spectrum: no spectrum of '") && r.contains("scan=does-not-exist"), "{r}");
    }
}
