// FASTag CLI integration: locate the binary, run it, stream its stderr as
// events, and cancel by killing the child.
//
// Security: the binary is spawned with an explicit argv array (never a shell
// string), and build_args() only ever emits flags the tool declares in its
// generated manifest — a crafted invoke cannot inject an unknown option.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::{history, outputs};

// name -> declared type, straight from the tool's own -write_ini. This is the
// allowlist build_args() validates against. Embedded at compile time from the
// single source of truth the frontend also reads.
const MANIFEST: &str = include_str!("../../src/params.generated.json");

const EXE: &str = if cfg!(windows) { "FASTag.exe" } else { "FASTag" };

// The single in-flight run. The batch queue runs sequentially, so at most one
// child exists at a time; a second `run` while one is live is refused.
#[derive(Default)]
pub struct RunManager {
    pub current: Mutex<Option<CurrentRun>>,
    pub seq: AtomicU64,
    // Set by the renderer while a batch is running: between two jobs no child
    // exists, but quitting would still drop the rest of the queue.
    pub ui_busy: AtomicBool,
    // The user chose "Cancel run and quit": the next exit request is let
    // through once the run has stopped and its partial outputs are gone.
    pub quitting: AtomicBool,
}

impl RunManager {
    /// A run is in flight (a child exists) or the renderer is in a batch.
    pub fn is_busy(&self) -> bool {
        self.ui_busy.load(Ordering::SeqCst) || self.current.lock().map(|c| c.is_some()).unwrap_or(true)
    }

    /// Wait until no child is left (the coordinator has cleaned up and
    /// released the slot), at most @p timeout. True when idle.
    pub fn wait_idle(&self, timeout: std::time::Duration) -> bool {
        let until = std::time::Instant::now() + timeout;
        loop {
            if self.current.lock().map(|c| c.is_none()).unwrap_or(false) {
                return true;
            }
            if std::time::Instant::now() >= until {
                return false;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
    }
}

pub struct CurrentRun {
    pub run_id: u64,
    pub child: Arc<Mutex<Child>>,
    // Set by cancel() so the done event can say "cancelled" rather than
    // "failed" (on Windows a killed child exits with code 1).
    pub cancelled: Arc<AtomicBool>,
    // Set by the coordinator, under the child lock, once the child is reaped:
    // its pid (and process group id) may then be reused, so kill_run() must
    // not signal it any more.
    pub reaped: Arc<AtomicBool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BinaryInfo {
    bin: String,
    source: String,
    ok: bool,
    version: Option<String>,
    detail: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunStarted {
    started: bool,
    run_id: Option<u64>,
    reason: Option<String>,
    // The -out path the CLI was actually given: a relative Output is resolved
    // against the input's folder (see build_args), and the renderer must read
    // the results from there, not from its own cwd.
    out: Option<String>,
    // Every file the run writes (outputs::resolved_outputs), as the CLI was
    // given them: removed again if the run does not finish.
    outputs: Option<Vec<String>>,
    // The command line, binary first: the failure banner offers it to copy,
    // so a refused run can be reproduced in a terminal.
    command: Option<Vec<String>>,
}

#[derive(Deserialize)]
pub struct RunParams {
    #[serde(rename = "in")]
    input: String,
    out: String,
    #[serde(default)]
    params: Map<String, Value>,
    // The user confirmed overwriting the outputs that already exist
    // (outputs_check). Without it a run with an existing output is refused.
    #[serde(default)]
    overwrite: bool,
}

pub struct Resolved {
    pub bin: PathBuf,
    pub data: Option<PathBuf>,
    // The bundled taxonomy dir (share/FASTag/taxonomy), if present. Passed to the
    // child as FASTAG_TAXONOMY_DIR so -species works without depending on the
    // CLI's own <bin>/../share path arithmetic (which a copied/symlinked binary
    // can get wrong).
    pub taxonomy: Option<PathBuf>,
    pub source: &'static str,
}

// Resolve the binary in priority order: FASTAG_BIN env override, then bundled
// beside the app (the resource dir). Debug builds also try the dev resources
// dir baked in at compile time, then the bare name on PATH. A release build
// does neither: the baked-in path is the CI runner's (and on Windows would sit
// on a drive any user can create), and a PATH lookup cannot find the Windows
// CLI (FASTag.bat) and could pick up an unrelated binary. It reports
// "missing" instead, which the probe turns into a clear error.
pub fn resolve_binary(app: &AppHandle) -> Resolved {
    if let Ok(env_bin) = std::env::var("FASTAG_BIN") {
        if !env_bin.is_empty() && PathBuf::from(&env_bin).exists() {
            let data = std::env::var("OPENMS_DATA_PATH").ok().map(PathBuf::from);
            // The CLI already honours a user-set FASTAG_TAXONOMY_DIR itself.
            return Resolved { bin: PathBuf::from(env_bin), data, taxonomy: None, source: "env" };
        }
    }
    let mut roots: Vec<PathBuf> = Vec::new();
    if let Ok(rd) = app.path().resource_dir() {
        roots.push(rd.join("resources").join("fastag"));
    }
    // Dev fallback: the resources dir next to this crate (tauri dev does not
    // populate resource_dir the way a bundle does).
    if cfg!(debug_assertions) {
        roots.push(PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/resources/fastag")));
    }
    let expected = roots.first().map(|r| r.join("bin").join(EXE));
    for root in roots {
        let bin = root.join("bin").join(EXE);
        if bin.exists() {
            let data = root.join("share").join("OpenMS");
            let data = if data.exists() { Some(data) } else { None };
            let taxonomy = root.join("share").join("FASTag").join("taxonomy");
            let taxonomy = if taxonomy.join("tax_k7.taxdb").exists() { Some(taxonomy) } else { None };
            return Resolved { bin, data, taxonomy, source: "bundled" };
        }
    }
    if cfg!(debug_assertions) {
        return Resolved { bin: PathBuf::from(EXE), data: None, taxonomy: None, source: "path" };
    }
    Resolved { bin: expected.unwrap_or_else(|| PathBuf::from(EXE)), data: None, taxonomy: None, source: "missing" }
}

// TOPP --help prints "... Version: X.Y.Z ...". Capture the version token as
// proof the binary actually runs and links its libraries on this machine.
fn parse_version(text: &str) -> Option<String> {
    let idx = text.find("Version:")?;
    let rest = text[idx + "Version:".len()..].trim_start();
    let tok: String = rest.chars().take_while(|c| !c.is_whitespace() && *c != ',').collect();
    if tok.chars().next().is_some_and(|c| c.is_ascii_digit()) {
        Some(tok)
    } else {
        None
    }
}

/// The CLI is a console program and the release GUI has no console
/// (windows_subsystem = "windows"), so Windows gave every child a console
/// window of its own -- one flashing at launch for the probe, one open for
/// every run, and closing it killed the run. CREATE_NO_WINDOW suppresses it;
/// piped stdio is unaffected.
fn no_console_window(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    let _ = cmd;
}

/// The taxonomy directory a run's child gets: the user's own
/// FASTAG_TAXONOMY_DIR if it names a directory (the CLI honours it first,
/// and species.rs reports on it), else the bundled one. Overriding the
/// user's value made the species panel describe one index while the run
/// loaded another.
pub fn taxonomy_dir(r: &Resolved) -> Option<PathBuf> {
    if let Ok(env) = std::env::var("FASTAG_TAXONOMY_DIR") {
        if !env.is_empty() && PathBuf::from(&env).is_dir() {
            return Some(PathBuf::from(env));
        }
    }
    r.taxonomy.clone()
}

/// libOpenMS pulls in OpenBLAS, which starts one spinning thread per core at
/// load time (127 on a 128-thread node, ~2 s of CPU even for --help). FASTag
/// never calls BLAS. The CLI wrappers set the same default; a user's own
/// OPENBLAS_NUM_THREADS still wins.
fn quiet_blas(cmd: &mut Command) {
    if std::env::var_os("OPENBLAS_NUM_THREADS").is_none() {
        cmd.env("OPENBLAS_NUM_THREADS", "1");
    }
}

// async + spawn_blocking: a sync command would run on the main thread.
// `FASTag --help` loads the whole library closure, which can take seconds on a
// cold cache or during a first-launch Gatekeeper/antivirus scan, and the window
// must stay responsive meanwhile.
#[tauri::command]
pub async fn probe(app: AppHandle) -> BinaryInfo {
    tauri::async_runtime::spawn_blocking(move || probe_blocking(&app))
        .await
        .unwrap_or_else(|e| BinaryInfo {
            bin: String::new(),
            source: "path".into(),
            ok: false,
            version: None,
            detail: format!("probe failed: {e}"),
        })
}

fn probe_blocking(app: &AppHandle) -> BinaryInfo {
    let r = resolve_binary(app);
    let bin_s = r.bin.display().to_string();
    if r.source == "missing" {
        return BinaryInfo {
            detail: format!(
                "the FASTag command-line tool is not in this app ({bin_s} is missing); reinstall FASTag, or set FASTAG_BIN to the FASTag binary"
            ),
            bin: bin_s,
            source: r.source.into(),
            ok: false,
            version: None,
        };
    }
    let mut cmd = Command::new(&r.bin);
    cmd.arg("--help");
    no_console_window(&mut cmd);
    if let Some(d) = &r.data {
        cmd.env("OPENMS_DATA_PATH", d);
    }
    quiet_blas(&mut cmd);
    match cmd.output() {
        Ok(out) => {
            let text = format!(
                "{}\n{}",
                String::from_utf8_lossy(&out.stdout),
                String::from_utf8_lossy(&out.stderr)
            );
            let (ok, version, detail) = probe_verdict(out.status.success(), exit_message(&out.status), &text, r.source);
            BinaryInfo { bin: bin_s, source: r.source.into(), ok, version, detail }
        }
        Err(e) => BinaryInfo {
            bin: bin_s,
            source: r.source.into(),
            ok: false,
            version: None,
            detail: format!("cannot execute: {e}"),
        },
    }
}

/// A binary works if --help succeeds or at least prints its version banner.
/// One that aborts while loading (dyld/DLL failure, exit 134) prints neither
/// and is not ok, because a run with it could not start.
fn probe_verdict(success: bool, failure: Option<String>, text: &str, source: &str) -> (bool, Option<String>, String) {
    // Where the binary came from, in words.
    let source = match source {
        "bundled" => "bundled with the app",
        "env" => "from FASTAG_BIN",
        "path" => "found on PATH",
        other => other,
    };
    let version = parse_version(text);
    if let Some(v) = &version {
        return (true, version.clone(), format!("FASTag {v} ({source})"));
    }
    if success {
        return (true, None, format!("runs, version unknown ({source})"));
    }
    let why = failure.unwrap_or_else(|| "failed".into());
    let last = text.lines().map(str::trim).rfind(|l| !l.is_empty()).unwrap_or("");
    let last: String = last.chars().take(200).collect();
    let detail = if last.is_empty() {
        format!("cannot run: {why} ({source})")
    } else {
        format!("cannot run: {why}: {last} ({source})")
    };
    (false, None, detail)
}

/// Why a child that did not succeed ended, in words: a Unix signal by name
/// (a SIGSEGV or an OOM kill otherwise read "stopped before it finished"), a
/// Windows crash status by name, or the exit code.
fn exit_message(status: &ExitStatus) -> Option<String> {
    if status.success() {
        return None;
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt;
        if let Some(sig) = status.signal() {
            return Some(signal_text(sig));
        }
    }
    let code = status.code()?;
    #[cfg(windows)]
    if let Some(t) = ntstatus_text(code) {
        return Some(t);
    }
    Some(format!("exit code {code}"))
}

#[cfg_attr(not(unix), allow(dead_code))]
fn signal_text(sig: i32) -> String {
    let name = match sig {
        1 => "SIGHUP",
        2 => "SIGINT",
        3 => "SIGQUIT",
        4 => "SIGILL",
        5 => "SIGTRAP",
        6 => "SIGABRT",
        #[cfg(target_os = "linux")]
        7 => "SIGBUS",
        #[cfg(not(target_os = "linux"))]
        10 => "SIGBUS",
        8 => "SIGFPE",
        9 => "SIGKILL",
        11 => "SIGSEGV",
        13 => "SIGPIPE",
        14 => "SIGALRM",
        15 => "SIGTERM",
        _ => "",
    };
    let hint = match sig {
        9 => "; the system may have run out of memory",
        11 => "; the program crashed",
        _ => "",
    };
    if name.is_empty() {
        format!("killed by signal {sig}")
    } else {
        format!("killed by signal {sig} ({name}{hint})")
    }
}

#[cfg_attr(not(windows), allow(dead_code))]
fn ntstatus_text(code: i32) -> Option<String> {
    let c = code as u32;
    if c < 0xC000_0000 {
        return None;
    }
    let name = match c {
        0xC000_0005 => "access violation; the program crashed",
        0xC000_0017 | 0xC000_009A => "out of memory",
        0xC000_00FD => "stack overflow",
        0xC000_0135 => "a required DLL was not found",
        0xC000_013A => "interrupted",
        0xC000_0409 => "aborted",
        _ => "crashed",
    };
    Some(format!("exit status 0x{c:08X} ({name})"))
}

// In the manifest but not settable on the command line, or managed by the app:
// -progress is always added by build_args, and -stream (stdin/stdout protocol)
// cannot work from the GUI, which gives the child no stdin.
const NOT_SETTABLE: [&str; 10] =
    ["version", "log", "debug", "no_progress", "force", "test", "in", "out", "progress", "stream"];

// The key allowlist alone is not the whole trust boundary: a VALUE beginning
// with '-' would be re-parsed by the CLI as a fresh option (OpenMS treats any
// token starting '-' + non-digit as one), letting a hostile renderer smuggle
// registered flags like -force or -no_progress through a benign key. Negative
// numbers stay valid; genuinely dash-named paths stay usable via a ./ prefix.
fn looks_like_flag(s: &str) -> bool {
    let b = s.as_bytes();
    b.first() == Some(&b'-') && !matches!(b.get(1), Some(c) if c.is_ascii_digit() || *c == b'.')
}

fn defang_path(p: &str) -> String {
    if looks_like_flag(p) { format!("./{p}") } else { p.to_string() }
}

/// The folder relative paths are resolved against: the input's own folder,
/// when the input is an absolute path. A Finder-launched app runs with cwd
/// "/", so a bare Output name like "tags.tsv" would otherwise resolve to an
/// unwritable "/tags.tsv".
fn base_dir(input: &str) -> Option<PathBuf> {
    let p = Path::new(input);
    if !p.is_absolute() {
        return None;
    }
    p.parent().filter(|d| !d.as_os_str().is_empty()).map(Path::to_path_buf)
}

/// A file-typed value: made absolute against @p base when relative (which
/// also defuses a leading '-'), else defanged with "./".
fn file_arg(p: &str, base: Option<&Path>) -> String {
    match base {
        Some(b) if !p.is_empty() && !Path::new(p).is_absolute() => b.join(p).display().to_string(),
        _ => defang_path(p),
    }
}

fn is_file_type(t: &str) -> bool {
    t == "input-file" || t == "output-file"
}

fn value_to_scalar(v: &Value) -> Option<String> {
    match v {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        Value::Bool(b) => Some(b.to_string()),
        _ => None, // null / array / object have no scalar CLI form
    }
}

// Build the argv from typed params. Only names the tool declares are emitted,
// arrays only for list-typed options, and each value is its own argv element.
fn build_args(p: &RunParams) -> Vec<String> {
    let manifest: Value = serde_json::from_str(MANIFEST).unwrap_or(Value::Null);
    let mut types: HashMap<String, String> = HashMap::new();
    // String lists whose CLI default is not empty: an explicitly cleared one
    // must reach the CLI as "-name ''", or the default comes back.
    let mut nonempty_default: std::collections::HashSet<String> = std::collections::HashSet::new();
    if let Some(arr) = manifest.get("params").and_then(|v| v.as_array()) {
        for it in arr {
            if let (Some(n), Some(t)) = (
                it.get("name").and_then(|v| v.as_str()),
                it.get("type").and_then(|v| v.as_str()),
            ) {
                types.insert(n.to_string(), t.to_string());
                let has_default = it
                    .get("default")
                    .and_then(|d| d.as_array())
                    .is_some_and(|d| d.iter().any(|x| x.as_str().is_some_and(|s| !s.trim().is_empty())));
                if t == "string-list" && has_default {
                    nonempty_default.insert(n.to_string());
                }
            }
        }
    }

    let base = base_dir(&p.input);
    let base = base.as_deref();
    let mut args: Vec<String> =
        vec!["-in".into(), defang_path(&p.input), "-out".into(), file_arg(&p.out, base)];

    for (name, value) in &p.params {
        let Some(t) = types.get(name) else { continue };
        if NOT_SETTABLE.contains(&name.as_str()) {
            continue;
        }
        if t == "bool" {
            // presence-only flags: passing "false" would set them
            if value.as_bool() == Some(true) {
                args.push(format!("-{name}"));
            }
            continue;
        }
        if let Some(arr) = value.as_array() {
            // multiple values are only meaningful for a list-typed option
            if t != "string-list" {
                continue;
            }
            let items: Vec<String> = arr
                .iter()
                .filter_map(value_to_scalar)
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty() && !looks_like_flag(s))
                .collect();
            if !items.is_empty() {
                args.push(format!("-{name}"));
                args.extend(items);
            } else if nonempty_default.contains(name) && !arr.iter().any(|v| {
                value_to_scalar(v).is_some_and(|s| looks_like_flag(s.trim()))
            }) {
                // Cleared on purpose (e.g. no fixed modification for an
                // unalkylated sample): the CLI reads an empty item as none.
                // Dropping the option brought back Carbamidomethyl (C).
                args.push(format!("-{name}"));
                args.push(String::new());
            }
            continue;
        }
        let Some(s) = value_to_scalar(value) else { continue };
        let s = s.trim().to_string();
        if s.is_empty() {
            continue; // unset optional (an empty path is not "no path")
        }
        if is_file_type(t) {
            // A dash-leading file name is a real file name, not an option:
            // dropping it ran an unfiltered search for -fasta "-db.fasta".
            args.push(format!("-{name}"));
            args.push(file_arg(&s, base));
            continue;
        }
        if looks_like_flag(&s) {
            continue; // would be re-parsed as an option — hostile, drop it
        }
        args.push(format!("-{name}"));
        args.push(s);
    }

    // The GUI always wants machine-readable progress.
    args.push("-progress".into());
    args
}

/// build_args for a run request as the renderer sends it (JSON), for the
/// end-to-end CLI tests (examples/build_args.rs), so they run the shipped
/// argv code rather than a copy of it.
pub fn build_args_json(json: &str) -> Result<Vec<String>, String> {
    let p: RunParams = serde_json::from_str(json).map_err(|e| e.to_string())?;
    Ok(build_args(&p))
}

const PROGRESS_PREFIX: &str = "FASTAG_PROGRESS ";

fn parse_progress_line(line: &str) -> Option<(u64, u64)> {
    let rest = line.strip_prefix(PROGRESS_PREFIX)?;
    let mut done = None;
    let mut total = None;
    for tok in rest.split_whitespace() {
        if let Some(v) = tok.strip_prefix("done=") {
            done = v.parse().ok();
        } else if let Some(v) = tok.strip_prefix("total=") {
            total = v.parse().ok();
        }
    }
    Some((done?, total?))
}

/// What a run reports while it goes, independent of Tauri so the run
/// lifecycle can be tested against a stub CLI.
pub enum RunEmit {
    Log(String),
    Progress { done: u64, total: u64 },
    Done(Value),
}

pub type Sink = Arc<dyn Fn(RunEmit) + Send + Sync>;

fn read_stream<R: Read>(stream: R, sink: &Sink, parse_progress: bool) {
    for_each_line(stream, |line| {
        if parse_progress {
            if let Some((done, total)) = parse_progress_line(&line) {
                sink(RunEmit::Progress { done, total });
                return;
            }
        }
        sink(RunEmit::Log(line));
    });
}

/// Every line of @p stream, decoded lossily, until EOF. lines() stops at the
/// first line that is not UTF-8 (a cp1252 path echoed by a Windows build):
/// the reader then dropped the pipe while the child still wrote to it, which
/// killed it with SIGPIPE on Unix and silenced the log and progress on
/// Windows. Only EOF or a real read error ends the loop.
fn for_each_line<R: Read, F: FnMut(String)>(stream: R, mut f: F) {
    let mut reader = BufReader::new(stream);
    let mut buf: Vec<u8> = Vec::new();
    loop {
        buf.clear();
        match reader.read_until(b'\n', &mut buf) {
            Ok(0) => break,
            Ok(_) => {
                while matches!(buf.last(), Some(b'\n') | Some(b'\r')) {
                    buf.pop();
                }
                f(String::from_utf8_lossy(&buf).into_owned());
            }
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => break,
        }
    }
}

/// The files of a run: its input, the outputs it writes (see
/// outputs::resolved_outputs, as given to the CLI), the child's cwd that
/// relative ones are joined to, and whether the user confirmed overwriting
/// the outputs that already exist.
pub struct RunFiles<'a> {
    pub input: &'a str,
    pub outputs: &'a [String],
    pub cwd: Option<&'a Path>,
    pub overwrite: bool,
}

/// How a run ended, for the done event and the run record.
pub struct RunEnd {
    pub run_id: u64,
    pub ok: bool,
    pub code: Option<i32>,
    pub message: Option<String>,
    pub cancelled: bool,
    pub cleanup: outputs::Cleanup,
    /// The last LOG_TAIL log lines (for last-failure.log).
    pub log: Vec<String>,
}

/// The log lines a run keeps for last-failure.log.
const LOG_TAIL: usize = 2000;

/// The refusal of a run whose outputs already exist and were not confirmed.
pub fn exists_reason(existing: &[PathBuf]) -> String {
    let list: Vec<String> = existing.iter().map(|p| p.display().to_string()).collect();
    format!("these outputs already exist and overwriting them was not confirmed: {}", list.join(", "))
}

/// Start @p cmd as the run of @p files. Refused when one of its outputs
/// already exists and @p files.overwrite is false: an existing file is
/// confirmed before the run, never after (GUI-DESIGN 6.4). Its stderr and
/// stdout go to @p sink line by line; when it has ended, a run that did not
/// finish has every file at its output paths removed (outputs::cleanup),
/// @p finish gets how it ended (it records the run and frees the slot in
/// @p mgr), and the last thing @p sink gets is RunEmit::Done. Returns the run
/// id.
pub fn start_run(
    mgr: &RunManager,
    mut cmd: Command,
    files: RunFiles<'_>,
    sink: Sink,
    finish: Box<dyn FnOnce(&RunEnd) + Send>,
) -> Result<u64, String> {
    if mgr.current.lock().map(|c| c.is_some()).unwrap_or(true) {
        return Err("a run is already in progress".into());
    }
    let paths = outputs::resolve(files.outputs, files.cwd);
    let input_path = match files.cwd {
        Some(d) if Path::new(files.input).is_relative() => d.join(files.input),
        _ => PathBuf::from(files.input),
    };
    let existing = outputs::existing(&paths, &input_path);
    if !files.overwrite && !existing.is_empty() {
        return Err(exists_reason(&existing));
    }
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;

    let run_id = mgr.seq.fetch_add(1, Ordering::SeqCst) + 1;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let child_arc = Arc::new(Mutex::new(child));
    let cancelled = Arc::new(AtomicBool::new(false));
    let reaped = Arc::new(AtomicBool::new(false));
    *mgr.current.lock().unwrap() = Some(CurrentRun {
        run_id,
        child: child_arc.clone(),
        cancelled: cancelled.clone(),
        reaped: reaped.clone(),
    });

    // The tail of the log, for last-failure.log.
    let tail = Arc::new(Mutex::new(std::collections::VecDeque::<String>::new()));
    let sink: Sink = {
        let tail = tail.clone();
        Arc::new(move |e| {
            if let RunEmit::Log(l) = &e {
                let mut t = tail.lock().unwrap_or_else(|p| p.into_inner());
                if t.len() == LOG_TAIL {
                    t.pop_front();
                }
                t.push_back(l.clone());
            }
            sink(e)
        })
    };

    // One reader thread per stream (stderr carries the progress contract; stdout
    // is drained as log so a full pipe can never block the child).
    let s_err = sink.clone();
    let t_err = std::thread::spawn(move || {
        if let Some(s) = stderr {
            read_stream(s, &s_err, true);
        }
    });
    let s_out = sink.clone();
    let t_out = std::thread::spawn(move || {
        if let Some(s) = stdout {
            read_stream(s, &s_out, false);
        }
    });

    // Coordinator: once both streams hit EOF the process has ended; reap it,
    // remove what an unfinished run left, record the run, release the slot
    // and emit exactly one terminal event. The slot is released after the
    // cleanup, so a quit that waits for an idle RunManager never cuts the
    // cleanup short.
    std::thread::spawn(move || {
        let _ = t_err.join();
        let _ = t_out.join();
        let status = {
            let mut c = child_arc.lock().unwrap();
            let s = c.wait();
            reaped.store(true, Ordering::SeqCst);
            s
        };
        let (ok, code, message) = match &status {
            Ok(s) => (s.success(), s.code(), exit_message(s)),
            Err(e) => (false, None, Some(format!("lost track of the process: {e}"))),
        };
        // A cancel that lost the race to a clean exit is not a cancellation.
        let was_cancelled = !ok && cancelled.load(Ordering::SeqCst);
        let message = if was_cancelled { Some("cancelled".to_string()) } else { message };
        let cleanup = if ok { outputs::Cleanup::default() } else { outputs::cleanup(&paths, &input_path) };
        let log: Vec<String> = tail.lock().map(|t| t.iter().cloned().collect()).unwrap_or_default();
        let end = RunEnd { run_id, ok, code, message, cancelled: was_cancelled, cleanup, log };
        finish(&end);
        sink(RunEmit::Done(serde_json::json!({
            "runId": end.run_id,
            "ok": end.ok,
            "code": end.code,
            "message": end.message,
            "cancelled": end.cancelled,
            "cleanup": end.cleanup,
        })));
    });
    Ok(run_id)
}

/// The run record of a run that ended as @p end (history.rs).
pub fn record_of(
    files: &RunFiles<'_>,
    argv: &[String],
    start: u64,
    end: &RunEnd,
) -> history::RunRecord {
    history::RunRecord {
        id: format!("{start}-{}", end.run_id),
        input: files.input.to_string(),
        outputs: files.outputs.to_vec(),
        cwd: files.cwd.map(|d| d.display().to_string()),
        argv: argv.to_vec(),
        status: if end.ok {
            history::Status::Ok
        } else if end.cancelled {
            history::Status::Cancelled
        } else {
            history::Status::Failed
        },
        exit_code: end.code,
        message: end.message.clone(),
        start,
        end: history::now_ms(),
        cleanup: end.cleanup.clone(),
    }
}

/// Append the record of a run to @p dir/history.jsonl and, for a run that
/// did not finish, write its log to @p dir/last-failure.log.
pub fn record_run(dir: &Path, rec: &history::RunRecord, log: &[String]) {
    let _ = history::append(dir, rec);
    if rec.status != history::Status::Ok {
        let _ = history::write_failure_log(dir, rec, log);
    }
}

/// Free the slot of run @p run_id (a later run may already hold it).
pub fn release_slot(mgr: &RunManager, run_id: u64) {
    let mut cur = mgr.current.lock().unwrap_or_else(|e| e.into_inner());
    if cur.as_ref().is_some_and(|c| c.run_id == run_id) {
        *cur = None;
    }
}

#[derive(Serialize)]
pub struct OutputsCheck {
    // Every output of the run, absolute as the CLI's cwd makes them.
    outputs: Vec<String>,
    // Those that already hold a file: the UI asks before overwriting them.
    existing: Vec<String>,
}

/// The outputs a run of @p params would write, and those already on disk,
/// resolved exactly as `run` resolves them (build_args, the input's folder).
#[tauri::command]
pub fn outputs_check(params: RunParams) -> OutputsCheck {
    let args = build_args(&params);
    let cwd = base_dir(&params.input).filter(|d| d.is_dir());
    let paths = outputs::resolve(&outputs::resolved_outputs(&args), cwd.as_deref());
    let input = match &cwd {
        Some(d) if Path::new(&params.input).is_relative() => d.join(&params.input),
        _ => PathBuf::from(&params.input),
    };
    let show = |v: &[PathBuf]| v.iter().map(|p| p.display().to_string()).collect();
    OutputsCheck { existing: show(&outputs::existing(&paths, &input)), outputs: show(&paths) }
}

#[tauri::command]
pub fn run(app: AppHandle, state: State<'_, RunManager>, params: RunParams) -> RunStarted {
    let refused = |reason: String| RunStarted {
        started: false,
        run_id: None,
        reason: Some(reason),
        out: None,
        outputs: None,
        command: None,
    };
    if state.current.lock().map(|c| c.is_some()).unwrap_or(true) {
        return refused("a run is already in progress".into());
    }
    let r = resolve_binary(&app);
    let args = build_args(&params);
    let command: Vec<String> = std::iter::once(r.bin.display().to_string()).chain(args.iter().cloned()).collect();
    let mut cmd = Command::new(&r.bin);
    // stdin is null: the CLI never reads it, and an inherited one could block.
    cmd.args(&args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    // Anything still relative (e.g. a path the CLI derives itself) lands next
    // to the input, not in the app's cwd ("/" for a Finder launch).
    let cwd = base_dir(&params.input).filter(|d| d.is_dir());
    if let Some(d) = &cwd {
        cmd.current_dir(d);
    }
    new_process_group(&mut cmd);
    if let Some(d) = &r.data {
        cmd.env("OPENMS_DATA_PATH", d);
    }
    quiet_blas(&mut cmd);
    no_console_window(&mut cmd);
    if let Some(t) = taxonomy_dir(&r) {
        // Point -species at the taxonomy explicitly (the CLI's own
        // <bin>/../share lookup fails for a copied/symlinked binary) -- the
        // user's own directory if set, the same one species.rs reports on.
        cmd.env("FASTAG_TAXONOMY_DIR", t);
    }
    let outputs = outputs::resolved_outputs(&args);
    let start = history::now_ms();
    // Emitting to a closed window is a harmless no-op.
    let a = app.clone();
    let sink: Sink = Arc::new(move |e| {
        let _ = match e {
            RunEmit::Log(line) => a.emit("fastag:log", line),
            RunEmit::Progress { done, total } => {
                a.emit("fastag:progress", serde_json::json!({ "done": done, "total": total }))
            }
            RunEmit::Done(v) => a.emit("fastag:done", v),
        };
    });
    // When the run has ended: record it (history.rs), then free the slot.
    let a = app.clone();
    let (rec_input, rec_outputs, rec_cwd, rec_argv) = (params.input.clone(), outputs.clone(), cwd.clone(), command.clone());
    let finish = Box::new(move |end: &RunEnd| {
        if let Some(d) = history::dir(&a) {
            let files = RunFiles { input: &rec_input, outputs: &rec_outputs, cwd: rec_cwd.as_deref(), overwrite: true };
            record_run(&d, &record_of(&files, &rec_argv, start, end), &end.log);
        }
        release_slot(&a.state::<RunManager>(), end.run_id);
    });
    let files = RunFiles { input: &params.input, outputs: &outputs, cwd: cwd.as_deref(), overwrite: params.overwrite };
    // A spawn failure is known synchronously: report it as a non-start so the
    // frontend reports "FASTag could not start" and settles cleanly.
    match start_run(&state, cmd, files, sink, finish) {
        Ok(run_id) => RunStarted {
            started: true,
            run_id: Some(run_id),
            reason: None,
            out: args.get(3).cloned(),
            outputs: Some(outputs),
            command: Some(command),
        },
        Err(e) => refused(e),
    }
}

/// Unix: start the child as the leader of its own process group, so Cancel also
/// kills anything it started (for example a wrapper script's real binary).
/// Otherwise that worker would keep the pipes open and the run would never
/// finish.
fn new_process_group(cmd: &mut Command) {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    #[cfg(not(unix))]
    let _ = cmd;
}

#[cfg(unix)]
extern "C" {
    fn kill(pid: i32, sig: i32) -> i32;
}

/// Kill a run's child and everything it started. Returns false when there was
/// nothing left to kill (already reaped, or already cancelled once).
pub fn kill_run(run: &CurrentRun, cancel: bool) -> bool {
    if cancel && run.cancelled.swap(true, Ordering::SeqCst) {
        return false; // a second click: the first kill is already under way
    }
    let Ok(mut child) = run.child.lock() else { return false };
    if run.reaped.load(Ordering::SeqCst) {
        return false; // its pid may already belong to another process
    }
    let pid = child.id();
    #[cfg(unix)]
    if let Ok(pgid) = i32::try_from(pid) {
        // The child leads its own group (new_process_group): signal the group.
        // SAFETY: kill(2) with a negative pid only sends a signal.
        unsafe {
            kill(-pgid, 9);
        }
    }
    #[cfg(windows)]
    {
        // A .bat wrapper runs the real exe as a grandchild that TerminateProcess
        // on cmd.exe does not reach: end the whole tree.
        let taskkill = std::env::var_os("SystemRoot")
            .map(|r| PathBuf::from(r).join("System32").join("taskkill.exe"))
            .unwrap_or_else(|| PathBuf::from("taskkill.exe"));
        let mut tk = Command::new(taskkill);
        tk.args(["/T", "/F", "/PID", &pid.to_string()])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        no_console_window(&mut tk);
        let _ = tk.status();
    }
    let _ = child.kill(); // the coordinator reaps and emits done
    true
}

/// Kill the in-flight run, if any (window closed, app quitting).
pub fn kill_current(app: &AppHandle) {
    let st = app.state::<RunManager>();
    let cur = st.current.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(run) = cur.as_ref() {
        kill_run(run, false);
    }
}

#[tauri::command]
pub fn cancel(state: State<'_, RunManager>) -> Value {
    let cur = state.current.lock().unwrap();
    let cancelled = cur.as_ref().is_some_and(|run| kill_run(run, true));
    serde_json::json!({ "cancelled": cancelled })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rp(json: &str) -> RunParams {
        serde_json::from_str(json).unwrap()
    }

    // build_args is the trust boundary: the renderer is untrusted, and only
    // manifest-declared flags may ever reach the CLI's argv.
    #[test]
    fn build_args_minimal() {
        let a = build_args(&rp(r#"{"in":"i.mzML","out":"o.tsv"}"#));
        assert_eq!(a, vec!["-in", "i.mzML", "-out", "o.tsv", "-progress"]);
    }

    #[test]
    fn build_args_drops_unknown_and_not_settable() {
        let a = build_args(&rp(
            r#"{"in":"i","out":"o","params":{"no_such_flag":"1","version":"9.9","force":true,"tag_length":"7"}}"#,
        ));
        assert!(a.contains(&"-tag_length".to_string()));
        assert!(!a.iter().any(|s| s.contains("no_such_flag")));
        assert!(!a.contains(&"-version".to_string()));
        assert!(!a.contains(&"-force".to_string()));
    }

    #[test]
    fn build_args_bool_is_presence_only() {
        let a = build_args(&rp(r#"{"in":"i","out":"o","params":{"no_deisotope":true,"species":false}}"#));
        assert!(a.contains(&"-no_deisotope".to_string()));
        assert!(!a.contains(&"-species".to_string()));
    }

    #[test]
    fn build_args_rejects_array_on_scalar_and_objects() {
        let a = build_args(&rp(
            r#"{"in":"i","out":"o","params":{"tag_length":["7","8"],"max_tags":{"a":1}}}"#,
        ));
        assert!(!a.contains(&"-tag_length".to_string()));
        assert!(!a.contains(&"-max_tags".to_string()));
    }

    #[test]
    fn build_args_string_list_expands() {
        let a = build_args(&rp(
            r#"{"in":"i","out":"o","params":{"fixed_modifications":["Carbamidomethyl (C)"," ",""]}}"#,
        ));
        let i = a.iter().position(|s| s == "-fixed_modifications").unwrap();
        assert_eq!(a[i + 1], "Carbamidomethyl (C)");
        assert_eq!(a.len(), i + 2 + 1); // one item kept, then -progress
    }

    #[test]
    fn build_args_skips_empty_scalar() {
        let a = build_args(&rp(r#"{"in":"i","out":"o","params":{"taxdb":"  "}}"#));
        assert!(!a.contains(&"-taxdb".to_string()));
    }

    #[test]
    fn build_args_blocks_value_side_flag_injection() {
        // a value like "-force" must never surface as an argv option
        let a = build_args(&rp(
            r#"{"in":"-force","out":"o","params":{"species_rank":"-no_progress","gap_penalty":"-5","fixed_modifications":["-test"]}}"#,
        ));
        assert_eq!(a[1], "./-force", "dash-leading path is defanged, not dropped");
        assert!(!a.contains(&"-no_progress".to_string()));
        assert!(!a.contains(&"-test".to_string()));
        let i = a.iter().position(|s| s == "-gap_penalty").expect("negative numbers still pass");
        assert_eq!(a[i + 1], "-5");
    }

    #[test]
    fn build_args_cleared_fixed_mods_reach_the_cli_as_empty() {
        // Cleared in the form: [""]. The CLI default (Carbamidomethyl) must not return.
        let a = build_args(&rp(r#"{"in":"i","out":"o","params":{"fixed_modifications":[""]}}"#));
        let i = a.iter().position(|s| s == "-fixed_modifications").expect("option kept");
        assert_eq!(a[i + 1], "");
        // A list whose default is empty is still left out when empty.
        let b = build_args(&rp(r#"{"in":"i","out":"o","params":{"variable_modifications":[""]}}"#));
        assert!(!b.contains(&"-variable_modifications".to_string()));
    }

    #[test]
    fn build_args_keeps_dash_leading_file_names() {
        // -fasta "-db.fasta" vanished and the run went unfiltered.
        let a = build_args(&rp(r#"{"in":"i","out":"o","params":{"fasta":"-db.fasta","digest_out":"-a.digest.tsv"}}"#));
        let i = a.iter().position(|s| s == "-fasta").expect("-fasta kept");
        assert_eq!(a[i + 1], "./-db.fasta");
        let j = a.iter().position(|s| s == "-digest_out").expect("-digest_out kept");
        assert_eq!(a[j + 1], "./-a.digest.tsv");
    }

    #[cfg(unix)]
    #[test]
    fn build_args_resolves_relative_paths_against_the_input_folder() {
        // A Finder launch has cwd "/", so a bare "run.tags.tsv" failed.
        let a = build_args(&rp(
            r#"{"in":"/d/a.mzML","out":"run.tags.tsv","params":{"fasta":"-db.fasta","species_out":"/abs/s.tsv","species_rank":"-x"}}"#,
        ));
        assert_eq!(&a[..4], ["-in", "/d/a.mzML", "-out", "/d/run.tags.tsv"]);
        let i = a.iter().position(|s| s == "-fasta").unwrap();
        assert_eq!(a[i + 1], "/d/-db.fasta");
        let j = a.iter().position(|s| s == "-species_out").unwrap();
        assert_eq!(a[j + 1], "/abs/s.tsv");
        assert!(!a.contains(&"-species_rank".to_string()), "non-file values still drop a flag");
        // An absolute out is left alone; an empty one stays empty.
        assert_eq!(build_args(&rp(r#"{"in":"/d/a.mzML","out":"/o/t.tsv"}"#))[3], "/o/t.tsv");
        assert_eq!(build_args(&rp(r#"{"in":"/d/a.mzML","out":""}"#))[3], "");
    }

    #[test]
    fn build_args_progress_and_stream_are_app_managed() {
        // The renderer could add -stream and a second -progress.
        let a = build_args(&rp(r#"{"in":"i","out":"o","params":{"stream":true,"progress":true}}"#));
        assert_eq!(a, vec!["-in", "i", "-out", "o", "-progress"]);
    }

    #[test]
    fn probe_verdict_needs_success_or_a_version() {
        // A binary aborting in dyld (exit 134, no banner) was "ok".
        let (ok, v, d) = probe_verdict(false, Some("killed by signal 6 (SIGABRT)".into()), "dyld: Library not loaded: @rpath/libOpenMS.dylib\n", "bundled");
        assert!(!ok);
        assert_eq!(v, None);
        assert!(d.contains("SIGABRT") && d.contains("libOpenMS"), "{d}");
        assert!(probe_verdict(true, None, "no banner", "env").0);
        let (ok, v, _) = probe_verdict(false, Some("exit code 1".into()), "Version: 1.9.0 Jan", "path");
        assert!(ok);
        assert_eq!(v.as_deref(), Some("1.9.0"));
    }

    #[test]
    fn crash_texts_name_the_cause() {
        // A SIGSEGV or OOM kill read "stopped before it finished".
        assert!(signal_text(11).contains("SIGSEGV"));
        assert!(signal_text(9).contains("out of memory"));
        assert_eq!(signal_text(64), "killed by signal 64");
        assert_eq!(ntstatus_text(1), None);
        assert!(ntstatus_text(0xC000_0005_u32 as i32).unwrap().contains("0xC0000005"));
    }

    #[cfg(unix)]
    #[test]
    fn exit_message_reads_the_signal() {
        let st = Command::new("sh").args(["-c", "kill -SEGV $$"]).status().unwrap();
        assert!(exit_message(&st).unwrap().contains("SIGSEGV"));
        let st = Command::new("sh").args(["-c", "exit 5"]).status().unwrap();
        assert_eq!(exit_message(&st).as_deref(), Some("exit code 5"));
        let st = Command::new("sh").args(["-c", "exit 0"]).status().unwrap();
        assert_eq!(exit_message(&st), None);
    }

    #[cfg(unix)]
    #[test]
    fn cancel_kills_the_whole_process_group_once() {
        // Through a wrapper the worker survived the kill and kept the
        // pipes open, so the run never ended. A second cancel is a no-op.
        let mut cmd = Command::new("sh");
        cmd.args(["-c", "sleep 30 & wait"]).stdin(Stdio::null()).stdout(Stdio::piped());
        new_process_group(&mut cmd);
        let mut child = cmd.spawn().unwrap();
        let mut stdout = child.stdout.take().unwrap();
        let run = CurrentRun {
            run_id: 1,
            child: Arc::new(Mutex::new(child)),
            cancelled: Arc::new(AtomicBool::new(false)),
            reaped: Arc::new(AtomicBool::new(false)),
        };
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let mut sink = Vec::new();
            let _ = stdout.read_to_end(&mut sink);
            let _ = tx.send(());
        });
        assert!(kill_run(&run, true));
        assert!(!kill_run(&run, true), "second cancel does nothing");
        assert!(rx.recv_timeout(std::time::Duration::from_secs(5)).is_ok(), "grandchild still holds the pipe");
        let st = run.child.lock().unwrap().wait().unwrap();
        run.reaped.store(true, Ordering::SeqCst);
        assert!(!st.success());
        assert!(!kill_run(&run, false), "a reaped child is never signalled");
    }

    #[test]
    fn lines_survive_invalid_utf8() {
        // A cp1252 byte between progress lines must not end the stream.
        let data: &[u8] = b"FASTAG_PROGRESS done=1 total=3\nLabels: C:\\J\xFCrgen\\x.tsv\nFASTAG_PROGRESS done=3 total=3\n";
        let mut got = Vec::new();
        for_each_line(data, |l| got.push(l));
        assert_eq!(got.len(), 3);
        assert_eq!(got[2], "FASTAG_PROGRESS done=3 total=3");
        assert!(got[1].contains('\u{FFFD}'));
    }

    #[test]
    fn progress_line_parses() {
        assert_eq!(parse_progress_line("FASTAG_PROGRESS done=42 total=100"), Some((42, 100)));
        assert_eq!(parse_progress_line("FASTAG_PROGRESS done=7 total=0"), Some((7, 0)));
        assert_eq!(parse_progress_line("something else"), None);
        assert_eq!(parse_progress_line("FASTAG_PROGRESS done=x total=1"), None);
    }

    // The run lifecycle against the stub CLI (gui/testing/stub-fastag):
    // what an unfinished run wrote is gone, a finished run's outputs stay.
    #[cfg(unix)]
    mod stub_cli {
        use super::super::*;
        use std::sync::mpsc;
        use std::time::Duration;

        const STUB: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../testing/stub-fastag/FASTag");

        fn dir(name: &str) -> PathBuf {
            let d = std::env::temp_dir().join(format!("fastag-run-{}-{name}", std::process::id()));
            let _ = std::fs::remove_dir_all(&d);
            std::fs::create_dir_all(&d).unwrap();
            d
        }

        struct Run {
            mgr: Arc<RunManager>,
            events: mpsc::Receiver<String>,
            done: mpsc::Receiver<Value>,
            outputs: Vec<String>,
            // The app-data folder the run is recorded in.
            hist: PathBuf,
        }

        /// Start the stub as the GUI's `run` command does: build_args, the
        /// resolved outputs, a process group of its own, the run record.
        fn start(params: &str, env: &[(&str, &str)]) -> Result<Run, String> {
            let p: RunParams = serde_json::from_str(params).unwrap();
            let args = build_args(&p);
            let mut cmd = Command::new("sh");
            cmd.arg(STUB).args(&args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
            for (k, v) in env {
                cmd.env(k, v);
            }
            new_process_group(&mut cmd);
            let outputs = outputs::resolved_outputs(&args);
            let hist = Path::new(&p.input).with_extension("appdata");
            let mgr = Arc::new(RunManager::default());
            let (etx, events) = mpsc::channel();
            let (dtx, done) = mpsc::channel();
            let etx = Mutex::new(etx);
            let dtx = Mutex::new(dtx);
            let sink: Sink = Arc::new(move |e| match e {
                RunEmit::Log(l) => {
                    let _ = etx.lock().unwrap().send(l);
                }
                RunEmit::Progress { done, total } => {
                    let _ = etx.lock().unwrap().send(format!("progress {done}/{total}"));
                }
                RunEmit::Done(v) => {
                    let _ = dtx.lock().unwrap().send(v);
                }
            });
            let m = mgr.clone();
            let (input, outs, h) = (p.input.clone(), outputs.clone(), hist.clone());
            let argv: Vec<String> = std::iter::once("FASTag".to_string()).chain(args.iter().cloned()).collect();
            let finish = Box::new(move |end: &RunEnd| {
                let files = RunFiles { input: &input, outputs: &outs, cwd: None, overwrite: true };
                record_run(&h, &record_of(&files, &argv, 1, end), &end.log);
                release_slot(&m, end.run_id);
            });
            let files = RunFiles { input: &p.input, outputs: &outputs, cwd: None, overwrite: p.overwrite };
            start_run(&mgr, cmd, files, sink, finish)?;
            Ok(Run { mgr, events, done, outputs, hist })
        }

        fn wait_for(path: &Path) {
            for _ in 0..500 {
                if path.exists() {
                    return;
                }
                std::thread::sleep(Duration::from_millis(10));
            }
            panic!("{} was never written", path.display());
        }

        fn wait_for_line(r: &Run, line: &str) {
            loop {
                let l = r.events.recv_timeout(Duration::from_secs(10)).expect("the stub never printed it");
                if l == line {
                    return;
                }
            }
        }

        fn cancel_of(mgr: &RunManager) {
            let cur = mgr.current.lock().unwrap();
            assert!(kill_run(cur.as_ref().unwrap(), true));
        }

        /// The newest record and the failure log of @p r.
        fn recorded(r: &Run) -> (history::RunRecord, Option<String>) {
            let rec = history::list(&r.hist, 1).pop().expect("the run was not recorded");
            (rec, std::fs::read_to_string(r.hist.join(history::FAILURE_LOG)).ok())
        }

        #[test]
        fn a_cancelled_run_leaves_no_output_at_any_resolved_path() {
            let d = dir("cancel");
            let input = d.join("a.mzML");
            std::fs::write(&input, "spectra").unwrap();
            let out = d.join("a.tags.tsv");
            let params = format!(
                r#"{{"in":"{}","out":"a.tags.tsv","params":{{"species":true,"digest_out":"a.digest.tsv"}}}}"#,
                input.display()
            );
            let r = start(&params, &[("STUB_SLEEP", "30")]).unwrap();
            assert_eq!(
                r.outputs,
                vec![
                    out.display().to_string(),
                    d.join("a.digest.tsv").display().to_string(),
                    d.join("a.tags.species.tsv").display().to_string()
                ]
            );
            wait_for(&out); // the partial table is on disk
            assert!(r.mgr.is_busy());
            cancel_of(&r.mgr);
            let done = r.done.recv_timeout(Duration::from_secs(10)).expect("no done event");
            assert_eq!(done["cancelled"], true);
            assert_eq!(done["ok"], false);
            assert_eq!(done["cleanup"]["removed"], serde_json::json!([out.display().to_string()]));
            for p in &r.outputs {
                assert!(!Path::new(p).exists(), "{p} survived the cancel");
            }
            assert!(input.exists());
            // The slot is free before the done event: a quit may go ahead.
            assert!(!r.mgr.is_busy());
            let log: Vec<String> = r.events.try_iter().collect();
            assert!(log.iter().any(|l| l == "progress 2/4"), "{log:?}");
            // The record marks the run cancelled, before the done event.
            let (rec, faillog) = recorded(&r);
            assert_eq!(rec.status, history::Status::Cancelled);
            assert_eq!(rec.outputs, r.outputs);
            assert_eq!(rec.cleanup.removed, vec![out.display().to_string()]);
            assert_eq!(history::of_output(&r.hist, &out).unwrap().status, history::Status::Cancelled);
            let faillog = faillog.expect("no last-failure.log");
            assert!(faillog.contains("status: Cancelled") && faillog.contains("Reading spectra (stub)"), "{faillog}");
            let _ = std::fs::remove_dir_all(&d);
        }

        // Replaces a_failed_run_removes_its_partial_reports_but_keeps_an_earlier_file,
        // whose earlier file was not a resolved output of that run: here the
        // earlier files sit at resolved paths.
        #[test]
        fn a_run_over_existing_outputs_is_refused_unless_confirmed() {
            let d = dir("refuse");
            let input = d.join("a.mzML");
            std::fs::write(&input, "spectra").unwrap();
            let out = d.join("a.tags.tsv");
            let digest = d.join("a.digest.tsv");
            std::fs::write(&out, "earlier table\n").unwrap();
            std::fs::write(&digest, "earlier digest\n").unwrap();
            let params = format!(
                r#"{{"in":"{}","out":"a.tags.tsv","params":{{"digest_out":"a.digest.tsv","label_out":"a.label.tsv"}}}}"#,
                input.display()
            );
            let err = start(&params, &[]).err().expect("ran over existing outputs without a confirmation");
            assert_eq!(err, exists_reason(&[out.clone(), digest.clone()]));
            // Nothing ran: the earlier files are as they were, no record.
            assert_eq!(std::fs::read_to_string(&out).unwrap(), "earlier table\n");
            assert_eq!(std::fs::read_to_string(&digest).unwrap(), "earlier digest\n");
            assert!(!d.join("a.label.tsv").exists());
            assert!(history::list(&input.with_extension("appdata"), 1).is_empty());
            let _ = std::fs::remove_dir_all(&d);
        }

        #[test]
        fn a_failed_confirmed_rerun_leaves_no_file_at_any_resolved_path() {
            let d = dir("fail");
            let input = d.join("a.mzML");
            std::fs::write(&input, "spectra").unwrap();
            let out = d.join("a.tags.tsv");
            let digest = d.join("a.digest.tsv");
            std::fs::write(&out, "earlier table\n").unwrap();
            std::fs::write(&digest, "earlier digest\n").unwrap();
            let params = format!(
                r#"{{"in":"{}","out":"a.tags.tsv","overwrite":true,"params":{{"glyco":true,"label_out":"a.label.tsv","digest_out":"a.digest.tsv"}}}}"#,
                input.display()
            );
            let r = start(&params, &[("STUB_FAIL", "3")]).unwrap();
            let done = r.done.recv_timeout(Duration::from_secs(10)).expect("no done event");
            assert_eq!(done["ok"], false);
            assert_eq!(done["cancelled"], false);
            assert_eq!(done["code"], 3);
            let removed: Vec<String> = serde_json::from_value(done["cleanup"]["removed"].clone()).unwrap();
            assert_eq!(removed.len(), 4, "{removed:?}");
            assert_eq!(r.outputs.len(), 4);
            for p in &r.outputs {
                assert!(!Path::new(p).exists(), "{p} survived the failure");
            }
            assert!(input.exists());
            let (rec, faillog) = recorded(&r);
            assert_eq!(rec.status, history::Status::Failed);
            assert_eq!(rec.exit_code, Some(3));
            assert!(faillog.expect("no last-failure.log").contains("Error: stub told to fail"));
            let _ = std::fs::remove_dir_all(&d);
        }

        #[test]
        fn a_cancel_before_the_cli_writes_removes_the_confirmed_earlier_outputs() {
            let d = dir("early");
            let input = d.join("a.mzML");
            std::fs::write(&input, "spectra").unwrap();
            let out = d.join("a.tags.tsv");
            let digest = d.join("a.digest.tsv");
            std::fs::write(&out, "earlier table\n").unwrap();
            std::fs::write(&digest, "earlier digest\n").unwrap();
            let params = format!(
                r#"{{"in":"{}","out":"a.tags.tsv","overwrite":true,"params":{{"digest_out":"a.digest.tsv"}}}}"#,
                input.display()
            );
            // Cancelled while loading: the CLI has opened no output yet.
            let r = start(&params, &[("STUB_SLEEP_BEFORE", "30")]).unwrap();
            wait_for_line(&r, "Reading spectra (stub)");
            assert_eq!(std::fs::read_to_string(&out).unwrap(), "earlier table\n");
            cancel_of(&r.mgr);
            let done = r.done.recv_timeout(Duration::from_secs(10)).expect("no done event");
            assert_eq!(done["cancelled"], true);
            assert_eq!(
                done["cleanup"]["removed"],
                serde_json::json!([out.display().to_string(), digest.display().to_string()])
            );
            for p in &r.outputs {
                assert!(!Path::new(p).exists(), "{p} survived the cancel");
            }
            assert!(input.exists());
            assert_eq!(recorded(&r).0.status, history::Status::Cancelled);
            let _ = std::fs::remove_dir_all(&d);
        }

        #[test]
        fn a_finished_run_keeps_its_outputs() {
            let d = dir("ok");
            let input = d.join("a.mzML");
            std::fs::write(&input, "spectra").unwrap();
            let params = format!(r#"{{"in":"{}","out":"a.tags.tsv","params":{{"species":true}}}}"#, input.display());
            let r = start(&params, &[]).unwrap();
            let done = r.done.recv_timeout(Duration::from_secs(10)).expect("no done event");
            assert_eq!(done["ok"], true);
            assert_eq!(done["cleanup"], serde_json::json!({"removed": [], "renamed": [], "failed": []}));
            for p in &r.outputs {
                assert!(Path::new(p).exists(), "{p} missing after a finished run");
            }
            let (rec, faillog) = recorded(&r);
            assert_eq!(rec.status, history::Status::Ok);
            assert_eq!(rec.exit_code, Some(0));
            assert!(faillog.is_none(), "a finished run writes no last-failure.log");
            let _ = std::fs::remove_dir_all(&d);
        }

        #[test]
        fn a_second_run_is_refused_while_one_is_live() {
            let d = dir("second");
            let input = d.join("a.mzML");
            std::fs::write(&input, "spectra").unwrap();
            let params = format!(r#"{{"in":"{}","out":"a.tags.tsv"}}"#, input.display());
            let r = start(&params, &[("STUB_SLEEP", "30")]).unwrap();
            let sink: Sink = Arc::new(|_| {});
            let files = RunFiles { input: "x", outputs: &[], cwd: None, overwrite: false };
            let again = start_run(&r.mgr, Command::new("true"), files, sink, Box::new(|_| {}));
            assert_eq!(again.unwrap_err(), "a run is already in progress");
            kill_current_of(&r.mgr);
            let _ = r.done.recv_timeout(Duration::from_secs(10));
            let _ = std::fs::remove_dir_all(&d);
        }

        fn kill_current_of(mgr: &RunManager) {
            if let Some(run) = mgr.current.lock().unwrap().as_ref() {
                kill_run(run, true);
            }
        }
    }

    #[test]
    fn version_parses_from_help_banner() {
        assert_eq!(
            parse_version("FASTag -- blah\nVersion: 3.6.0-pre-HEAD-2026-04-24 Jul 23 2026"),
            Some("3.6.0-pre-HEAD-2026-04-24".to_string())
        );
        assert_eq!(parse_version("no banner here"), None);
    }
}
