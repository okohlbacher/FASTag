// FASTag CLI integration: locate the binary, run it, stream its output to
// the run's own Channel (events.rs), and cancel by killing the child.
//
// Security: the binary is spawned with an explicit argv array (never a shell
// string), and build_args() only ever emits flags the tool declares in its
// generated manifest — a crafted invoke cannot inject an unknown option.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};

use crate::events::{Batcher, RunEvent, RunResult, Sink, FLUSH_INTERVAL};
use crate::reveal::ResolvedOutputs;
use crate::{history, lifetime, outputs, sweep};

// name -> declared type, straight from the tool's own -write_ini. This is the
// allowlist build_args() validates against. Embedded at compile time from the
// single source of truth the frontend also reads.
const MANIFEST: &str = include_str!("../../src/params.generated.json");

const EXE: &str = if cfg!(windows) { "FASTag.exe" } else { "FASTag" };

// The single in-flight run. The batch queue runs sequentially, so at most one
// child exists at a time; a second `run` while one is live is refused.
#[derive(Default)]
pub struct RunManager {
    // Shared with the run's coordinator thread, which frees it.
    pub current: Arc<Mutex<Option<CurrentRun>>>,
    // Set by the renderer while a batch is running: between two jobs no child
    // exists, but quitting would still drop the rest of the queue.
    pub ui_busy: AtomicBool,
    // The user chose "Cancel run and quit": the next exit request is let
    // through once the run has stopped and its partial outputs are gone.
    pub quitting: AtomicBool,
    // The outputs of the runs of this session, absolute: the files
    // reveal_output may show (reveal.rs). Earlier sessions' come from the
    // run record.
    pub revealable: Mutex<Vec<PathBuf>>,
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
    pub child: Arc<Mutex<Child>>,
    // Set by cancel() so the done event can say "cancelled" rather than
    // "failed" (on Windows a killed child exits with code 1).
    pub cancelled: Arc<AtomicBool>,
    // Set by the coordinator, under the child lock, once the child is reaped:
    // its pid may then be reused, so kill_run() no longer signals it, only
    // its process group (whose id cannot be reused while the group has
    // members), and only while the run still holds the slot.
    pub reaped: Arc<AtomicBool>,
    // What ties the run's processes to the GUI on Windows (its kill-on-close
    // job, lifetime::spawn_cli); kill_tree ends the job. Nothing elsewhere.
    pub job: Arc<lifetime::RunJob>,
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
// The reply of `run` (GUI-DESIGN 6.2). Its events go to the Channel the
// renderer passed, never to a global event, so they cannot reach another
// job; the renderer merges reply and events into the job it created itself,
// and a Done that beats this reply is a defined state there.
pub struct RunStarted {
    pub started: bool,
    pub reason: Option<String>,
    // The -out path the CLI was actually given, absolute (outputs.out).
    pub out: Option<String>,
    // Every output of the run, absolute, resolved from the argv the CLI was
    // given (GUI-DESIGN 6.3): what the renderer reads, Reveal and Open folder
    // act on, and what is removed again if the run does not finish.
    pub outputs: Option<ResolvedOutputs>,
    // The command line, binary first: the failure banner offers it to copy,
    // so a refused run can be reproduced in a terminal.
    pub command: Option<Vec<String>>,
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
    cmd.arg("--help").stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    no_console_window(&mut cmd);
    if let Some(d) = &r.data {
        cmd.env("OPENMS_DATA_PATH", d);
    }
    quiet_blas(&mut cmd);
    // Started by the spawner thread like every CLI child (lifetime.rs): this
    // blocking-pool thread may exit as soon as it is idle.
    lifetime::die_with_parent(&mut cmd);
    // On Windows in a job of its own, which is closed once it has ended.
    match lifetime::spawn_cli(cmd).and_then(|(c, _job)| c.wait_with_output()) {
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
    /// The child's process id (part of the record's id).
    pub pid: u32,
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

/// How often the coordinator looks whether the child has exited.
const POLL: Duration = Duration::from_millis(20);
/// How long the coordinator waits, once the child has exited, for the rest
/// of its output. A process the CLI started can keep the pipes open after
/// it (a grandchild that outlived a kill, or one that inherited the pipes
/// from a parallel spawn): waiting for their end left the run without a
/// Done event, its outputs uncleaned and the slot taken.
const DRAIN: Duration = Duration::from_secs(2);
/// How long the coordinator waits for the streams to end once it has killed
/// what was left of the CLI's process group.
const KILL_GRACE: Duration = Duration::from_millis(500);
/// The log line of a run whose output did not end with it, not even once
/// the CLI's process group was killed: a process outside the group (one that
/// inherited the pipes from a parallel spawn) holds them.
pub const STREAMS_OPEN: &str =
    "Note: the output streams stayed open after FASTag ended (a process it started still holds them); later lines are not shown.";
/// The log line of a run whose CLI left a process behind in its group that
/// still held the output streams: it is stopped before the cleanup, so
/// nothing writes to the outputs after the run is reported ended.
pub const LEFT_BEHIND_KILLED: &str =
    "Note: a process FASTag started was still running after FASTag ended; it was stopped.";

/// Start @p cmd as the run of @p files. Refused when one of its outputs
/// already exists and @p files.overwrite is false: an existing file is
/// confirmed before the run, never after (GUI-DESIGN 6.4). Its stderr and
/// stdout go to @p sink in batches (events.rs); when it has ended, a run
/// that did not finish has every file at its output paths removed
/// (outputs::cleanup), @p finish gets how it ended (it records the run), the
/// slot in @p mgr is freed, and the last thing @p sink gets is
/// RunEvent::Done.
pub fn start_run(
    mgr: &RunManager,
    mut cmd: Command,
    files: RunFiles<'_>,
    sink: Sink,
    finish: Box<dyn FnOnce(&RunEnd) + Send>,
) -> Result<(), String> {
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
    // Every CLI child is started by the one long-lived spawner thread and
    // ends with the GUI: PDEATHSIG on Linux, the watchdog on every Unix, a
    // kill-on-close job of the run's own on Windows (lifetime.rs,
    // GUI-DESIGN 6.6).
    lifetime::die_with_parent(&mut cmd);
    let (mut child, job) = lifetime::spawn_cli(cmd).map_err(|e| e.to_string())?;
    // Held by the slot (kill_run) and the coordinator until the run ends.
    let job = Arc::new(job);
    #[cfg(unix)]
    let watchdog = lifetime::watch(child.id());

    let pid = child.id();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let child_arc = Arc::new(Mutex::new(child));
    let cancelled = Arc::new(AtomicBool::new(false));
    let reaped = Arc::new(AtomicBool::new(false));
    *mgr.current.lock().unwrap() = Some(CurrentRun {
        child: child_arc.clone(),
        cancelled: cancelled.clone(),
        reaped: reaped.clone(),
        job: job.clone(),
    });

    let batcher = Arc::new(Batcher::start(sink, FLUSH_INTERVAL));
    // The tail of the log, for last-failure.log.
    let tail = Arc::new(Mutex::new(std::collections::VecDeque::<String>::new()));

    // One reader thread per stream (stderr carries the progress contract;
    // stdout is drained as log so a full pipe can never block the child).
    // Each says when its stream has ended.
    let (eof_tx, eof_rx) = std::sync::mpsc::channel::<()>();
    for (stream, is_err) in [(stderr.map(|s| Box::new(s) as Box<dyn Read + Send>), true), (stdout.map(|s| Box::new(s) as Box<dyn Read + Send>), false)] {
        let (b, tail, eof) = (batcher.clone(), tail.clone(), eof_tx.clone());
        std::thread::spawn(move || {
            if let Some(s) = stream {
                for_each_line(s, |line| {
                    {
                        let mut t = tail.lock().unwrap_or_else(|p| p.into_inner());
                        if t.len() == LOG_TAIL {
                            t.pop_front();
                        }
                        t.push_back(line.clone());
                    }
                    b.line(line, is_err);
                });
            }
            let _ = eof.send(());
        });
    }
    drop(eof_tx);

    #[cfg(windows)]
    if job.is_none() {
        batcher.line("warning: no job object for this run: if the app is killed, the run may go on".into(), false);
    }
    #[cfg(unix)]
    let mut watchdog = match watchdog {
        Ok(w) => Some(w),
        Err(e) => {
            batcher.line(format!("warning: no watchdog for this run ({e}): if the app is killed, the run may go on"), false);
            None
        }
    };

    // Coordinator: once the child has exited, take the rest of its output
    // (at most DRAIN), remove what an unfinished run left, record the run,
    // release the slot and send exactly one Done. The child is polled, not
    // waited for under its lock: kill_run takes that lock, and a child that
    // closed its pipes but kept running would otherwise block Cancel. The
    // slot is released after the cleanup, so a quit that waits for an idle
    // RunManager never cuts the cleanup short.
    let current = mgr.current.clone();
    std::thread::spawn(move || {
        let status = loop {
            // The watchdog is released once the child has exited but before
            // it is reaped (lifetime::exited does not reap): until then the
            // group id it would kill cannot be reused.
            #[cfg(unix)]
            if watchdog.is_some() {
                if !lifetime::exited(pid) {
                    std::thread::sleep(POLL);
                    continue;
                }
                if let Some(w) = watchdog.take() {
                    w.release();
                }
            }
            {
                let mut c = child_arc.lock().unwrap_or_else(|e| e.into_inner());
                match c.try_wait() {
                    Ok(Some(s)) => {
                        reaped.store(true, Ordering::SeqCst);
                        break Ok(s);
                    }
                    Ok(None) => {}
                    Err(e) => {
                        reaped.store(true, Ordering::SeqCst);
                        break Err(e);
                    }
                }
            }
            std::thread::sleep(POLL);
        };
        // Both streams ended within @p within (or no reader is left).
        let mut ended = 0;
        let mut drain = |within: Duration| -> bool {
            let until = std::time::Instant::now() + within;
            while ended < 2 {
                match eof_rx.recv_timeout(until.saturating_duration_since(std::time::Instant::now())) {
                    Ok(()) => ended += 1,
                    Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => return true,
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => return false,
                }
            }
            true
        };
        if !drain(DRAIN) {
            // A process the CLI started (a wrapper's worker, a backgrounded
            // helper) still holds the pipes: kill the CLI's process group
            // (Windows: the run's job) before the cleanup and the slot
            // release, or it would go on writing to outputs the cleanup
            // removes or the next run writes. The group id cannot be reused
            // while the group has members.
            kill_tree(pid, &job);
            let note = if drain(KILL_GRACE) { LEFT_BEHIND_KILLED } else { STREAMS_OPEN };
            batcher.line(note.to_string(), false);
        }
        // Windows: the run has ended and its output is in; end anything of
        // it still left in its job, as closing the job would (lifetime.rs).
        #[cfg(windows)]
        if let Some(j) = &*job {
            j.terminate();
        }
        let (ok, code, message) = match &status {
            Ok(s) => (s.success(), s.code(), exit_message(s)),
            Err(e) => (false, None, Some(format!("lost track of the process: {e}"))),
        };
        // A cancel that lost the race to a clean exit is not a cancellation.
        let was_cancelled = !ok && cancelled.load(Ordering::SeqCst);
        let message = if was_cancelled { Some("cancelled".to_string()) } else { message };
        let cleanup = if ok { outputs::Cleanup::default() } else { outputs::cleanup(&paths, &input_path) };
        let log: Vec<String> = tail.lock().map(|t| t.iter().cloned().collect()).unwrap_or_default();
        let end = RunEnd { pid, ok, code, message, cancelled: was_cancelled, cleanup, log };
        finish(&end);
        release_slot(&current, &child_arc);
        batcher.finish(RunResult {
            ok: end.ok,
            code: end.code,
            message: end.message,
            cancelled: end.cancelled,
            cleanup: end.cleanup,
        });
    });
    Ok(())
}

/// The run record of a run that ended as @p end (history.rs).
pub fn record_of(
    files: &RunFiles<'_>,
    argv: &[String],
    start: u64,
    end: &RunEnd,
) -> history::RunRecord {
    history::RunRecord {
        id: format!("{start}-{}", end.pid),
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
        params: None,
        tags: if end.ok { history::tags_of_log(&end.log) } else { None },
    }
}

/// The record of a run that is about to start, for its marker
/// (sweep::mark_running): what the next session records if this one never
/// sees the run end.
pub fn marker_of(files: &RunFiles<'_>, argv: &[String], start: u64) -> history::RunRecord {
    history::RunRecord {
        id: format!("{start}-interrupted"),
        input: files.input.to_string(),
        outputs: files.outputs.to_vec(),
        cwd: files.cwd.map(|d| d.display().to_string()),
        argv: argv.to_vec(),
        status: history::Status::Failed,
        exit_code: None,
        message: Some(sweep::INTERRUPTED.to_string()),
        start,
        end: start,
        cleanup: outputs::Cleanup::default(),
        params: None,
        tags: None,
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

/// Free the slot of the run of @p child (a later run may already hold it).
fn release_slot(current: &Mutex<Option<CurrentRun>>, child: &Arc<Mutex<Child>>) {
    let mut cur = current.lock().unwrap_or_else(|e| e.into_inner());
    if cur.as_ref().is_some_and(|c| Arc::ptr_eq(&c.child, child)) {
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

/// What a run of @p params is, resolved once for `run` and `outputs_check`:
/// the argv (build_args), the child's cwd (the input's folder), the outputs
/// as given to the CLI, and every output resolved against that cwd.
struct Plan {
    args: Vec<String>,
    cwd: Option<PathBuf>,
    outputs: Vec<String>,
    resolved: ResolvedOutputs,
}

fn plan(params: &RunParams) -> Plan {
    let args = build_args(params);
    // Anything still relative (e.g. a path the CLI derives itself) lands next
    // to the input, not in the app's cwd ("/" for a Finder launch).
    let cwd = base_dir(&params.input).filter(|d| d.is_dir());
    let outputs = outputs::resolved_outputs(&args);
    let resolved = crate::reveal::resolved(&args, cwd.as_deref());
    Plan { args, cwd, outputs, resolved }
}

/// The outputs a run of @p params would write, and those already on disk,
/// resolved exactly as `run` resolves them (build_args, the input's folder).
#[tauri::command]
pub fn outputs_check(params: RunParams) -> OutputsCheck {
    let pl = plan(&params);
    let paths = outputs::resolve(&pl.outputs, pl.cwd.as_deref());
    let input = match &pl.cwd {
        Some(d) if Path::new(&params.input).is_relative() => d.join(&params.input),
        _ => PathBuf::from(&params.input),
    };
    let show = |v: &[PathBuf]| v.iter().map(|p| p.display().to_string()).collect();
    OutputsCheck { existing: show(&outputs::existing(&paths, &input)), outputs: show(&paths) }
}

fn refused(reason: String) -> RunStarted {
    RunStarted { started: false, reason: Some(reason), out: None, outputs: None, command: None }
}

/// Run @p params with the binary @p r, its events to @p sink: the whole of
/// the `run` command but the AppHandle, so the cargo tests drive exactly
/// this against the stub CLI. @p history_dir is where the run is recorded.
pub fn launch(mgr: &RunManager, r: &Resolved, params: RunParams, sink: Sink, history_dir: Option<PathBuf>) -> RunStarted {
    if mgr.current.lock().map(|c| c.is_some()).unwrap_or(true) {
        return refused("a run is already in progress".into());
    }
    let Plan { args, cwd, outputs, resolved } = plan(&params);
    // The command line the reply offers and the record keeps (one vector,
    // so Copy command in History equals the run's): the argv as run, with
    // no binary path that is gone once the app quits.
    let appdir = std::env::var_os("APPDIR").map(PathBuf::from);
    let command = history::argv_as_run(&r.bin, &args, appdir.as_deref());
    let mut cmd = Command::new(&r.bin);
    // stdin is null: the CLI never reads it, and an inherited one could block.
    cmd.args(&args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    if let Some(d) = &cwd {
        cmd.current_dir(d);
    }
    new_process_group(&mut cmd);
    if let Some(d) = &r.data {
        cmd.env("OPENMS_DATA_PATH", d);
    }
    quiet_blas(&mut cmd);
    no_console_window(&mut cmd);
    if let Some(t) = taxonomy_dir(r) {
        // Point -species at the taxonomy explicitly (the CLI's own
        // <bin>/../share lookup fails for a copied/symlinked binary) -- the
        // user's own directory if set, the same one species.rs reports on.
        cmd.env("FASTAG_TAXONOMY_DIR", t);
    }
    let start = history::now_ms();
    let files = RunFiles { input: &params.input, outputs: &outputs, cwd: cwd.as_deref(), overwrite: params.overwrite };
    // Before the CLI starts: if the app is killed while it runs, the next
    // start finds this run's marker and offers what it left (sweep.rs).
    let marker = history_dir.as_deref().and_then(|d| sweep::mark_running(d, &marker_of(&files, &command, start)).ok());
    // When the run has ended: record it (history.rs).
    let (rec_input, rec_outputs, rec_cwd, rec_argv) = (params.input.clone(), outputs.clone(), cwd.clone(), command.clone());
    let rec_params = params.params.clone();
    let run_marker = marker.clone();
    let finish = Box::new(move |end: &RunEnd| {
        // The marker first: a record next to a stale marker would be
        // followed by a second, "interrupted" one at the next start.
        if let Some(m) = &run_marker {
            sweep::clear_running(m);
        }
        if let Some(d) = history_dir {
            let files = RunFiles { input: &rec_input, outputs: &rec_outputs, cwd: rec_cwd.as_deref(), overwrite: true };
            let mut rec = record_of(&files, &rec_argv, start, end);
            rec.params = Some(rec_params);
            record_run(&d, &rec, &end.log);
        }
    });
    let abs: Vec<PathBuf> = resolved.paths().into_iter().map(PathBuf::from).collect();
    // A spawn failure is known synchronously: report it as a non-start so the
    // frontend reports "FASTag could not start" and settles cleanly.
    match start_run(mgr, cmd, files, sink, finish) {
        Ok(()) => {
            if let Ok(mut r) = mgr.revealable.lock() {
                r.extend(abs);
            }
            RunStarted {
                started: true,
                reason: None,
                out: resolved.out.clone(),
                outputs: Some(resolved),
                command: Some(command),
            }
        }
        Err(e) => {
            // Its own marker only: a refusal because another run is live
            // must not take that run's marker.
            if let Some(m) = &marker {
                sweep::clear_running(m);
            }
            refused(e)
        }
    }
}

/// Start a run; its events go to @p on_event, the job's own Channel.
#[tauri::command]
pub fn run(app: AppHandle, state: State<'_, RunManager>, params: RunParams, on_event: Channel<RunEvent>) -> RunStarted {
    // Sending to a closed window is a harmless no-op.
    let sink: Sink = Arc::new(move |e| {
        let _ = on_event.send(e);
    });
    launch(&state, &resolve_binary(&app), params, sink, history::dir(&app))
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

/// Kill the process group of a run's child (Unix: the child leads it, see
/// new_process_group) or, on Windows, everything in the run's job @p job
/// (lifetime::spawn_cli), or its process tree when it has no job. True when
/// the kill reached a process. Only while the slot of the run is held: the
/// child's handle keeps its pid (Windows), and the group id cannot be
/// reused while the group has members (Unix).
fn kill_tree(pid: u32, job: &lifetime::RunJob) -> bool {
    #[cfg(not(windows))]
    let () = *job;
    #[cfg(unix)]
    {
        let Ok(pgid) = i32::try_from(pid) else { return false };
        // SAFETY: kill(2) with a negative pid only sends a signal.
        unsafe { kill(-pgid, 9) == 0 }
    }
    #[cfg(windows)]
    {
        // The job holds the whole tree, the real exe a .bat wrapper starts
        // included, also once the CLI itself has ended.
        if let Some(j) = job {
            return j.terminate();
        }
        // No job (lifetime::spawn_in_job could not set one up): a .bat
        // wrapper runs the real exe as a grandchild that TerminateProcess
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
        tk.status().is_ok_and(|s| s.success())
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = pid;
        false
    }
}

/// Kill a run's child and everything it started. Returns false when there was
/// nothing left to kill (already cancelled once, or the CLI has ended and
/// nothing of its group is left).
pub fn kill_run(run: &CurrentRun, cancel: bool) -> bool {
    if cancel && run.cancelled.swap(true, Ordering::SeqCst) {
        return false; // a second click: the first kill is already under way
    }
    let Ok(mut child) = run.child.lock() else { return false };
    let pid = child.id();
    if run.reaped.load(Ordering::SeqCst) {
        // The CLI has ended, but its run still holds the slot (the
        // coordinator is draining its output or cleaning up): what it started
        // may still run in its group. Signal the group only, never the pid.
        return kill_tree(pid, &run.job);
    }
    // The child leads its own group (new_process_group): signal the group,
    // and again until the child is reaped, for a process the group was
    // forking at the first kill (lifetime.rs).
    #[cfg(unix)]
    lifetime::kill_group_until_reaped(pid, run.child.clone(), run.reaped.clone());
    #[cfg(not(unix))]
    kill_tree(pid, &run.job);
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
    use crate::events::parse_progress_line;

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
            child: Arc::new(Mutex::new(child)),
            cancelled: Arc::new(AtomicBool::new(false)),
            reaped: Arc::new(AtomicBool::new(false)),
            job: Arc::default(),
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
        // A reaped run signals only its group, and only while the group
        // exists: wait until the killed grandchild's zombie is gone (it is
        // reaped by its new parent, not by us), then nothing is signalled.
        let pgid = run.child.lock().unwrap().id() as i32;
        let until = std::time::Instant::now() + std::time::Duration::from_secs(5);
        // SAFETY: signal 0 only checks that the group exists.
        while unsafe { kill(-pgid, 0) } == 0 && std::time::Instant::now() < until {
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        assert!(!kill_run(&run, false), "a reaped child whose group is gone is never signalled");
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

    /// The value of every output option in @p args.
    fn argv_outputs(args: &[String]) -> Vec<(String, String)> {
        outputs::outputs_by_option(args).into_iter().map(|(o, v)| (o.to_string(), v)).collect()
    }

    // GUI-DESIGN 6.3: every output of the run, resolved from the argv the
    // CLI is given, never guessed by the renderer.
    #[test]
    fn resolved_outputs_name_every_output_as_the_cli_gets_it() {
        let d = std::env::temp_dir().join(format!("fastag-resolved-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        let input = d.join("a.mzML");
        // ponytail: a JSON-escaped path and an ABS that is absolute on the host (Windows needs a drive).
        let inp = input.display().to_string().replace('\\', "\\\\");
        let abs = if cfg!(windows) { "C:/abs/l.tsv" } else { "/abs/l.tsv" };
        let params = format!(
            r#"{{"in":"{}","out":"a.tags.tsv","params":{{"species":true,"glyco":true,"digest_out":"a.digest.tsv",
               "label_out":"{abs}","massgap_out":"-m.tsv","recon_out":"r/recon.tsv","delta_out":"a.delta.tsv",
               "recon_id_out":"a.ids.tsv","out_spectra":"a.spectra.mzML"}}}}"#,
            inp
        );
        let pl = plan(&rp(&params));
        assert_eq!(pl.cwd.as_deref(), Some(d.as_path()));
        let at = |n: &str| Some(d.join(n).display().to_string());
        assert_eq!(
            pl.resolved,
            ResolvedOutputs {
                out: at("a.tags.tsv"),
                species_out: at("a.tags.species.tsv"),
                digest_out: at("a.digest.tsv"),
                label_out: Some(abs.into()),
                massgap_out: at("-m.tsv"),
                recon_out: at("r/recon.tsv"),
                delta_out: at("a.delta.tsv"),
                recon_id_out: at("a.ids.tsv"),
                glyco_out: at("a.tags.glyco.tsv"),
                out_spectra: at("a.spectra.mzML"),
            }
        );
        // The same files the cleanup removes.
        let mut a: Vec<String> = pl.resolved.paths().into_iter().map(String::from).collect();
        let mut b: Vec<String> =
            outputs::resolve(&pl.outputs, pl.cwd.as_deref()).iter().map(|p| p.display().to_string()).collect();
        a.sort();
        b.sort();
        assert_eq!(a, b);
        // Explicit report paths win over derived ones; an unset option is None.
        let pl = plan(&rp(&format!(
            r#"{{"in":"{}","out":"a.tags.tsv","params":{{"species":true,"species_out":"s.tsv"}}}}"#,
            inp
        )));
        assert_eq!(pl.resolved.species_out, at("s.tsv"));
        assert_eq!(pl.resolved.glyco_out, None);
        assert_eq!(pl.resolved.digest_out, None);
        let _ = std::fs::remove_dir_all(&d);
    }

    // The renderer took `\data\a.mzML` for absolute; Windows (and the CLI)
    // do not. On a Unix build a Windows path is a relative name: the
    // outputs are then exactly the argv's values, never re-resolved.
    #[test]
    fn resolved_outputs_of_windows_paths_are_the_argv_values() {
        let params = r#"{"in":"\\data\\a.mzML","out":"C:\\r.1\\x","params":{"species":true,"digest_out":"\\data\\d.tsv",
                        "label_out":"D:\\l.tsv","out_spectra":"\\\\srv\\share\\s.mzML","glyco_out":"-g.tsv"}}"#;
        let pl = plan(&rp(params));
        for (option, value) in argv_outputs(&pl.args) {
            let want = outputs::resolve(&[value], pl.cwd.as_deref()).remove(0).display().to_string();
            let got = pl.resolved.paths();
            assert!(got.contains(&want.as_str()), "{option}: {want} not in {got:?}");
        }
        #[cfg(windows)]
        {
            // \data\a.mzML has no drive, so it is not absolute on Windows
            // either: nothing is resolved against it. The dotted folder
            // keeps its name; UNC and other drives stay as they are.
            assert_eq!(pl.cwd, None);
            assert_eq!(pl.resolved.out.as_deref(), Some(r"C:\r.1\x"));
            assert_eq!(pl.resolved.species_out.as_deref(), Some(r"C:\r.1\x.species.tsv"));
            assert_eq!(pl.resolved.digest_out.as_deref(), Some(r"\data\d.tsv"));
            assert_eq!(pl.resolved.label_out.as_deref(), Some(r"D:\l.tsv"));
            assert_eq!(pl.resolved.out_spectra.as_deref(), Some(r"\\srv\share\s.mzML"));
            assert_eq!(pl.resolved.glyco_out.as_deref(), Some("./-g.tsv"));
            // An absolute input: relative outputs land in its folder, and a
            // root-relative path joins its drive (the renderer's own guess
            // read it from \data on whatever drive it ran on).
            let pl = plan(&rp(r#"{"in":"C:\\d\\a.mzML","out":"a.tags.tsv","params":{"species":true,"digest_out":"\\data\\x.tsv"}}"#));
            assert_eq!(pl.resolved.out.as_deref(), Some(r"C:\d\a.tags.tsv"));
            assert_eq!(pl.resolved.species_out.as_deref(), Some(r"C:\d\a.tags.species.tsv"));
            assert_eq!(pl.resolved.digest_out.as_deref(), Some(r"C:\data\x.tsv"));
        }
        #[cfg(unix)]
        {
            assert_eq!(pl.cwd, None);
            assert_eq!(pl.resolved.out.as_deref(), Some(r"C:\r.1\x"));
            assert_eq!(pl.resolved.species_out.as_deref(), Some(r"C:\r.1\x.species.tsv"));
            assert_eq!(pl.resolved.digest_out.as_deref(), Some(r"\data\d.tsv"));
            assert_eq!(pl.resolved.out_spectra.as_deref(), Some(r"\\srv\share\s.mzML"));
            assert_eq!(pl.resolved.glyco_out.as_deref(), Some("./-g.tsv"));
        }
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
            // Each log line, and "progress d/t", as one string.
            let sink: Sink = Arc::new(move |e| match e {
                RunEvent::Log { lines } => {
                    for (l, _) in lines {
                        let _ = etx.lock().unwrap().send(l);
                    }
                }
                RunEvent::Progress { done, total, .. } => {
                    let _ = etx.lock().unwrap().send(format!("progress {done}/{total}"));
                }
                RunEvent::Phase { .. } => {}
                RunEvent::Done(r) => {
                    let _ = dtx.lock().unwrap().send(serde_json::to_value(r).unwrap());
                }
            });
            let (input, outs, h) = (p.input.clone(), outputs.clone(), hist.clone());
            let argv: Vec<String> = std::iter::once("FASTag".to_string()).chain(args.iter().cloned()).collect();
            let files = RunFiles { input: &p.input, outputs: &outputs, cwd: None, overwrite: p.overwrite };
            let marker = sweep::mark_running(&hist, &marker_of(&files, &argv, 1)).unwrap();
            let run_marker = marker.clone();
            let finish = Box::new(move |end: &RunEnd| {
                sweep::clear_running(&run_marker);
                let files = RunFiles { input: &input, outputs: &outs, cwd: None, overwrite: true };
                record_run(&h, &record_of(&files, &argv, 1, end), &end.log);
            });
            if let Err(e) = start_run(&mgr, cmd, files, sink, finish) {
                sweep::clear_running(&marker);
                return Err(e);
            }
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
            // The stub writes the partial table, then prints progress 2/4:
            // waiting for the file alone let the cancel land before that
            // line, and the log check below failed now and then.
            wait_for_line(&r, "progress 2/4");
            assert!(out.exists(), "the partial table is on disk");
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
            // The record marks the run cancelled, before the done event.
            let (rec, faillog) = recorded(&r);
            assert_eq!(rec.status, history::Status::Cancelled);
            assert_eq!(rec.outputs, r.outputs);
            assert_eq!(rec.cleanup.removed, vec![out.display().to_string()]);
            assert_eq!(history::of_output(&r.hist, &out).unwrap().status, history::Status::Cancelled);
            let faillog = faillog.expect("no last-failure.log");
            assert!(faillog.contains("status: Cancelled") && faillog.contains("Reading spectra (stub)"), "{faillog}");
            assert!(sweep::markers(&r.hist).is_empty(), "a cancelled run left its marker");
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
            assert!(sweep::markers(&input.with_extension("appdata")).is_empty(), "a refused run left a marker");
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
            assert!(sweep::markers(&r.hist).is_empty(), "a finished run left its marker");
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

        // A stand-in GUI process for the test below: this test binary run
        // again with FASTAG_GUI_HELPER=<data folder>. It starts a run as the
        // `run` command does, waits until the partial table is on disk,
        // prints "ready <pgid of the CLI>" and waits to be killed.
        const GUI_HELPER: &str = "FASTAG_GUI_HELPER";

        #[test]
        #[ignore = "a helper process of a_killed_gui_ends_the_run_and_the_next_start_offers_what_it_left"]
        fn gui_process_helper() {
            let Ok(d) = std::env::var(GUI_HELPER) else { return };
            let input = Path::new(&d).join("a.mzML");
            let params = format!(r#"{{"in":"{}","out":"a.tags.tsv","params":{{"digest_out":"a.digest.tsv"}}}}"#, input.display());
            let r = start(&params, &[("STUB_SLEEP", "30")]).unwrap();
            wait_for(&Path::new(&d).join("a.tags.tsv"));
            let pgid = r.mgr.current.lock().unwrap().as_ref().unwrap().child.lock().unwrap().id();
            println!("ready {pgid}");
            std::thread::sleep(Duration::from_secs(60));
        }

        /// A process of group @p pgid is alive (a zombie is not).
        fn group_alive(pgid: u32) -> bool {
            let ps = Command::new("ps").args(["-A", "-o", "pgid=,stat="]).output().unwrap();
            String::from_utf8_lossy(&ps.stdout).lines().any(|l| {
                let mut f = l.split_whitespace();
                f.next() == Some(&pgid.to_string()) && f.next().is_some_and(|st| !st.starts_with('Z'))
            })
        }

        // P1 acceptance: killing the GUI process (kill -9) ends the CLI
        // within 3 s, and the next start records the run as interrupted and
        // offers the partial table it left for removal.
        #[test]
        fn a_killed_gui_ends_the_run_and_the_next_start_offers_what_it_left() {
            use std::io::BufRead;
            let d = dir("killed");
            let input = d.join("a.mzML");
            std::fs::write(&input, "spectra").unwrap();
            let mut gui = Command::new(std::env::current_exe().unwrap())
                .args(["fastag::tests::stub_cli::gui_process_helper", "--exact", "--ignored", "--nocapture", "--test-threads=1"])
                .env(GUI_HELPER, &d)
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .spawn()
                .unwrap();
            let mut out = BufReader::new(gui.stdout.take().unwrap());
            let mut line = String::new();
            let pgid: u32 = loop {
                line.clear();
                assert!(out.read_line(&mut line).unwrap() > 0, "the helper ended before it was ready");
                // libtest prints "test <name> ... " before it, on the same line.
                if let Some(i) = line.find("ready ") {
                    break line[i + 6..].trim().parse().unwrap();
                }
            };
            assert!(group_alive(pgid));
            gui.kill().unwrap();
            let _ = gui.wait();
            let t = std::time::Instant::now();
            while group_alive(pgid) && t.elapsed() < Duration::from_secs(3) {
                std::thread::sleep(Duration::from_millis(50));
            }
            let alive = group_alive(pgid);
            if alive {
                lifetime_kill(pgid);
            }
            assert!(!alive, "the CLI outlived the killed GUI by more than 3 s");
            // The next start.
            let hist = input.with_extension("appdata");
            let out_path = d.join("a.tags.tsv");
            assert_eq!(sweep::markers(&hist).len(), 1, "no marker of the run");
            let rec = sweep::recover(&hist).pop().expect("the killed run was not recovered");
            assert_eq!(rec.status, history::Status::Failed);
            assert_eq!(rec.message.as_deref(), Some(sweep::INTERRUPTED));
            assert_eq!(history::of_output(&hist, &out_path).unwrap().message.as_deref(), Some(sweep::INTERRUPTED));
            assert_eq!(sweep::leftovers(&hist), vec![out_path.clone()]);
            let c = sweep::sweep(&hist, &[out_path.display().to_string()]);
            assert_eq!(c.removed, vec![out_path.display().to_string()]);
            assert!(!out_path.exists() && input.exists());
            assert!(sweep::leftovers(&hist).is_empty());
            let _ = std::fs::remove_dir_all(&d);
        }

        fn lifetime_kill(pgid: u32) {
            let _ = Command::new("kill").args(["-9", "--", &format!("-{pgid}")]).status();
        }

        /// What the renderer gets on a run's Channel: the JSON of each
        /// message, with when it arrived.
        type Wire = mpsc::Receiver<(std::time::Instant, Value)>;

        fn channel() -> (Sink, Wire) {
            let (tx, rx) = mpsc::channel();
            let tx = Mutex::new(tx);
            let ch: Channel<RunEvent> = Channel::new(move |body| {
                if let tauri::ipc::InvokeResponseBody::Json(s) = body {
                    let _ = tx.lock().unwrap().send((std::time::Instant::now(), serde_json::from_str(&s).unwrap()));
                }
                Ok(())
            });
            (Arc::new(move |e| { let _ = ch.send(e); }), rx)
        }

        /// The stub as the `run` command starts it (launch), with @p control
        /// as <in>.stub (the stub's switches).
        fn launch_stub(d: &Path, params: &str, control: &str) -> (Arc<RunManager>, RunStarted, Wire) {
            launch_bin(d, Path::new(STUB), params, control)
        }

        /// launch_stub with the stub at @p bin.
        fn launch_bin(d: &Path, bin: &Path, params: &str, control: &str) -> (Arc<RunManager>, RunStarted, Wire) {
            let input = d.join("a.mzML");
            std::fs::write(&input, "spectra").unwrap();
            std::fs::write(d.join("a.mzML.stub"), control).unwrap();
            let r = Resolved { bin: bin.to_path_buf(), data: None, taxonomy: None, source: "env" };
            let mgr = Arc::new(RunManager::default());
            let (sink, wire) = channel();
            let params = params.replace("$IN", &input.display().to_string());
            let started = launch(&mgr, &r, serde_json::from_str(&params).unwrap(), sink, Some(d.join("appdata")));
            (mgr, started, wire)
        }

        /// Every message up to Done (included); none may follow it.
        fn until_done(wire: &Wire, within: Duration) -> Vec<(std::time::Instant, Value)> {
            let until = std::time::Instant::now() + within;
            let mut v = Vec::new();
            loop {
                let left = until.saturating_duration_since(std::time::Instant::now());
                let m = wire.recv_timeout(left).expect("no Done in time");
                let done = m.1["kind"] == "done";
                v.push(m);
                if done {
                    assert!(wire.recv_timeout(Duration::from_millis(300)).is_err(), "a message after Done");
                    return v;
                }
            }
        }

        fn kinds(v: &[(std::time::Instant, Value)], kind: &str) -> Vec<Value> {
            v.iter().filter(|m| m.1["kind"] == kind).map(|m| m.1.clone()).collect()
        }

        // GUI-DESIGN 6.2: the real `run` against the stub CLI, its events on a
        // real Channel in order: batched Log{lines}, the phases, coalesced
        // progress, and Done last.
        #[test]
        fn the_run_command_sends_its_events_in_order_on_the_jobs_channel() {
            let d = dir("channel");
            let (mgr, started, wire) =
                launch_stub(&d, r#"{"in":"$IN","out":"a.tags.tsv","params":{"species":true}}"#, "");
            assert!(started.started, "{:?}", started.reason);
            let outs = started.outputs.clone().unwrap();
            assert_eq!(outs.out, Some(d.join("a.tags.tsv").display().to_string()));
            assert_eq!(outs.species_out, Some(d.join("a.tags.species.tsv").display().to_string()));
            assert_eq!(started.out, outs.out);
            assert_eq!(started.command.as_ref().unwrap()[0], STUB);
            let v = until_done(&wire, Duration::from_secs(10));
            let done = &v.last().unwrap().1;
            assert_eq!(done["ok"], true, "{done}");
            assert_eq!(kinds(&v, "done").len(), 1);
            // The log, in the order each stream wrote it, with its stream.
            let lines: Vec<(String, bool)> = kinds(&v, "log")
                .iter()
                .flat_map(|m| serde_json::from_value::<Vec<(String, bool)>>(m["lines"].clone()).unwrap())
                .collect();
            let err: Vec<&str> = lines.iter().filter(|l| l.1).map(|l| l.0.as_str()).collect();
            assert_eq!(err, ["-threads 0: using 1 of 1 logical cores.", "Reading spectra (stub)"]);
            assert_eq!(lines.iter().filter(|l| !l.1).map(|l| l.0.as_str()).collect::<Vec<_>>(), ["4 MS2 spectra, 1 tags"]);
            assert!(lines.len() > kinds(&v, "log").len(), "one message per line: {v:?}");
            // Phases in run order (a flush may skip one), ending finished.
            let phases: Vec<String> = kinds(&v, "phase").iter().map(|p| p["label"].as_str().unwrap().to_string()).collect();
            let order = [crate::progress::READING, crate::progress::TAGGING, crate::progress::FINISHING, crate::progress::FINISHED];
            let mut at = 0;
            for p in &phases {
                at += order[at..].iter().position(|o| o == p).unwrap_or_else(|| panic!("{p} out of order: {phases:?}"));
            }
            assert_eq!(phases.last().map(String::as_str), Some(crate::progress::FINISHED));
            let progress = kinds(&v, "progress");
            let last = progress.last().unwrap();
            assert_eq!((last["done"].as_u64(), last["total"].as_u64()), (Some(4), Some(4)));
            // Recorded and freed before Done.
            assert!(!mgr.is_busy());
            assert_eq!(history::list(&d.join("appdata"), 1)[0].status, history::Status::Ok);
            let _ = std::fs::remove_dir_all(&d);
        }

        /// The newest record in @p d's app data, once the run of @p wire ended.
        fn record_after(d: &Path, wire: &Wire) -> history::RunRecord {
            until_done(wire, Duration::from_secs(10));
            history::list(&d.join("appdata"), 1).pop().expect("the run was not recorded")
        }

        // P2a PR h: History's Copy command is the run's own command line.
        // The record keeps the argv the CLI was started with, the same
        // vector the run reply offered, its outputs at their final paths
        // (no staging folder, no .part, no .incomplete), the parameters the
        // run was sent and the tags it wrote.
        #[test]
        fn the_history_argv_is_the_command_line_the_run_was_started_with() {
            let d = dir("hist-argv");
            let params = r#"{"in":"$IN","out":"a.tags.tsv","params":{"species":true,"digest_out":"a.digest.tsv"}}"#;
            let (_mgr, started, wire) = launch_stub(&d, params, "");
            assert!(started.started, "{:?}", started.reason);
            let rec = record_after(&d, &wire);
            assert_eq!(rec.status, history::Status::Ok);
            let command = started.command.clone().unwrap();
            assert_eq!(rec.argv, command);
            let sent = params.replace("$IN", &d.join("a.mzML").display().to_string());
            assert_eq!(rec.argv[0], STUB);
            assert_eq!(&rec.argv[1..], &build_args(&super::rp(&sent))[..]);
            // Every output in it is a final path the reply named, beside the input.
            let finals: Vec<String> = started.outputs.as_ref().unwrap().paths().iter().map(|p| p.to_string()).collect();
            let given = outputs::resolved_outputs(&rec.argv[1..]);
            assert!(!given.is_empty());
            for o in &given {
                assert!(finals.contains(o), "{o} is not a final output path: {finals:?}");
                assert!(Path::new(o).starts_with(&d) && !o.ends_with(".part") && !o.ends_with(".incomplete"), "{o}");
                assert!(Path::new(o).exists(), "{o}");
            }
            assert!(!rec.argv.iter().any(|a| a.contains("appdata")), "{:?}", rec.argv);
            let sent_params = serde_json::from_str::<Value>(&sent).unwrap()["params"].as_object().cloned();
            assert_eq!(rec.params, sent_params);
            // The stub's summary line: "4 MS2 spectra, 1 tags".
            assert_eq!(rec.tags, Some(1));
            let _ = std::fs::remove_dir_all(&d);
        }

        // Review of PR h (GUI-DESIGN 3 S9, 6.5 history_rerun): a Re-run
        // starts the recorded run again through launch, so its record keeps
        // the same argv; over the outputs the first run left it needs the
        // overwrite confirmation like any run.
        #[test]
        fn a_rerun_starts_the_recorded_command_line() {
            let d = dir("hist-rerun");
            let params = r#"{"in":"$IN","out":"a.tags.tsv","params":{"species":true,"digest_out":"a.digest.tsv","tag_length":"4"}}"#;
            let (_mgr, started, wire) = launch_stub(&d, params, "");
            assert!(started.started, "{:?}", started.reason);
            let first = record_after(&d, &wire);
            assert_eq!(first.status, history::Status::Ok);
            let again = history::rerun_params(&first).expect("the record keeps its parameters");
            let r = Resolved { bin: PathBuf::from(STUB), data: None, taxonomy: None, source: "env" };
            let mgr = Arc::new(RunManager::default());
            // Not over the existing outputs without the confirmation.
            let (sink, _w) = channel();
            let refused = launch(&mgr, &r, serde_json::from_value(again.clone()).unwrap(), sink, Some(d.join("appdata")));
            assert!(!refused.started);
            let mut confirmed = again.clone();
            confirmed["overwrite"] = Value::Bool(true);
            let (sink, wire) = channel();
            let started2 = launch(&mgr, &r, serde_json::from_value(confirmed).unwrap(), sink, Some(d.join("appdata")));
            assert!(started2.started, "{:?}", started2.reason);
            let second = record_after(&d, &wire);
            assert_ne!(second.id, first.id);
            assert_eq!(second.status, history::Status::Ok);
            assert_eq!(second.argv, first.argv);
            assert_eq!(started2.command.as_ref(), Some(&first.argv));
            assert_eq!(second.params, first.params);
            assert_eq!(history::list(&d.join("appdata"), 10).len(), 2);
            // A record of 1.13 keeps no parameters: no Re-run.
            let mut old = first.clone();
            old.params = None;
            assert!(history::rerun_params(&old).is_none());
            let _ = std::fs::remove_dir_all(&d);
        }

        // A failed run is recorded failed (P0a), with its exit code and the
        // same command line, and its outputs are gone from their paths.
        #[test]
        fn a_failed_run_is_recorded_failed_with_its_command_line() {
            let d = dir("hist-failed");
            let (_mgr, started, wire) = launch_stub(&d, r#"{"in":"$IN","out":"a.tags.tsv"}"#, "STUB_FAIL=3\n");
            assert!(started.started, "{:?}", started.reason);
            let rec = record_after(&d, &wire);
            assert_eq!((rec.status, rec.exit_code, rec.tags), (history::Status::Failed, Some(3), None));
            assert_eq!(Some(&rec.argv), started.command.as_ref());
            let out = d.join("a.tags.tsv");
            assert!(rec.argv.contains(&out.display().to_string()), "{:?}", rec.argv);
            assert!(!out.exists());
            assert_eq!(history::of_output(&d.join("appdata"), &out).unwrap().status, history::Status::Failed);
            let _ = std::fs::remove_dir_all(&d);
        }

        // An app started from a macOS App Translocation copy runs its CLI
        // from there; that copy is gone when the app quits, so the reply and
        // the record name the program, and the run itself is unchanged.
        #[test]
        fn a_cli_on_a_temporary_mount_is_recorded_by_its_name() {
            let d = dir("hist-mount");
            let bin_dir = d.join("AppTranslocation/0A1B/d/FASTag.app/Contents/Resources/fastag");
            std::fs::create_dir_all(&bin_dir).unwrap();
            let bin = bin_dir.join("FASTag");
            std::fs::copy(STUB, &bin).unwrap();
            let (_mgr, started, wire) = launch_bin(&d, &bin, r#"{"in":"$IN","out":"a.tags.tsv"}"#, "");
            assert!(started.started, "{:?}", started.reason);
            let rec = record_after(&d, &wire);
            assert_eq!(rec.status, history::Status::Ok, "the CLI ran from the mount");
            assert_eq!(rec.argv[0], history::PROGRAM);
            assert_eq!(Some(&rec.argv), started.command.as_ref());
            assert!(!rec.argv.iter().any(|a| a.contains("AppTranslocation")), "{:?}", rec.argv);
            let _ = std::fs::remove_dir_all(&d);
        }

        /// Run the stub with a chatty phase of @p n lines (@p control adds
        /// its pace) and report the IPC message rate the renderer sees.
        fn chatty(name: &str, n: usize, control: &str) -> (usize, usize, f64) {
            let d = dir(name);
            let (_mgr, started, wire) = launch_stub(&d, r#"{"in":"$IN","out":"a.tags.tsv"}"#, control);
            assert!(started.started);
            let v = until_done(&wire, Duration::from_secs(60));
            let logs = kinds(&v, "log");
            let lines: usize = logs.iter().map(|m| m["lines"].as_array().unwrap().len()).sum();
            assert!(lines >= n, "{lines} lines");
            assert!(logs.iter().all(|m| m["lines"].as_array().unwrap().len() <= crate::events::MAX_BATCH));
            let secs = (v.last().unwrap().0 - v[0].0).as_secs_f64().max(1e-3);
            // The stub prints n/100 + 3 progress lines: 0, 2, every 100th, the end.
            println!(
                "IPC rate ({name}): {lines} log lines and {} progress lines in {secs:.3} s -> {} messages \
                 ({} log, {} progress, {} phase): {:.0} messages/s for {:.0} lines/s (one message per line: {})",
                n / 100 + 3,
                v.len(),
                logs.len(),
                kinds(&v, "progress").len(),
                kinds(&v, "phase").len(),
                v.len() as f64 / secs,
                lines as f64 / secs,
                lines + n / 100 + 3 + 1
            );
            let _ = std::fs::remove_dir_all(&d);
            (lines, v.len(), secs)
        }

        // The P1 gate: the IPC message rate during a chatty phase. A burst
        // of 20,000 lines goes out in messages of MAX_BATCH lines ...
        #[test]
        fn ipc_rate_a_burst_of_log_lines_goes_out_in_full_batches() {
            let (lines, msgs, secs) = chatty("burst", 20_000, "STUB_CHATTY=20000\n");
            // Batches, not lines: on a loaded runner the sender can drain a
            // part-filled buffer (CI: 45 log + 6 progress + 3 phase = 55 in
            // 0.077 s, ideal 41 log), so allow twice the full-batch count.
            // Still about 200x fewer messages than one per line.
            let bound = 2 * (lines / crate::events::MAX_BATCH) + 12;
            assert!(msgs <= bound, "{msgs} messages for {lines} lines in {secs:.3} s (bound {bound})");
        }

        // ... and a sustained one (about 5,000 lines/s for 1-2 s) costs at
        // most three messages (log, phase, progress) per flush interval.
        #[test]
        fn ipc_rate_a_sustained_chatty_phase_is_bounded_by_the_flush_interval() {
            let (lines, msgs, secs) = chatty("sustained", 6_000, "STUB_CHATTY=6000\nSTUB_CHATTY_PAUSE=0.02\n");
            // GUI-DESIGN 6.2 allows a flush every 50 ms at most.
            let flushes = secs / 0.050 + 2.0;
            let bound = 3.0 * flushes + (lines / crate::events::MAX_BATCH) as f64 + 1.0;
            assert!((msgs as f64) <= bound, "{msgs} messages for {lines} lines in {secs:.3} s (bound {bound:.0})");
            assert!(secs > 0.5, "the phase was a burst ({secs:.3} s), not sustained");
        }

        /// Whether process @p pid still exists (a zombie counts until its
        /// new parent reaps it, so this waits up to @p within for it to go).
        fn alive_after(pid: i32, within: Duration) -> bool {
            let until = std::time::Instant::now() + within;
            loop {
                // SAFETY: signal 0 only checks that the process exists.
                if unsafe { kill(pid, 0) } != 0 {
                    return false;
                }
                if std::time::Instant::now() >= until {
                    return true;
                }
                std::thread::sleep(Duration::from_millis(20));
            }
        }

        fn orphan_pid(d: &Path) -> i32 {
            std::fs::read_to_string(d.join("orphan.pid")).unwrap().trim().parse().unwrap()
        }

        fn logged(v: &[(std::time::Instant, Value)], line: &str) -> bool {
            kinds(v, "log").iter().any(|m| m["lines"].as_array().unwrap().iter().any(|l| l[0] == line))
        }

        // The flake of a_cancel_before_the_cli_writes_removes_the_confirmed_earlier_outputs
        // (about 1 in 8 parallel runs): the run ended, but a process holding
        // its pipes kept the readers, and so Done, waiting. A run whose
        // streams stay open after the CLI exited still ends, within DRAIN, and
        // what the CLI left behind in its process group is killed before the
        // cleanup and the slot release: nothing writes after the run ended.
        #[test]
        fn a_run_whose_streams_outlive_the_cli_still_ends() {
            let d = dir("orphan");
            let t0 = std::time::Instant::now();
            let control = format!("STUB_ORPHAN=12\nSTUB_ORPHAN_PID={}\n", d.join("orphan.pid").display());
            let (mgr, started, wire) = launch_stub(&d, r#"{"in":"$IN","out":"a.tags.tsv"}"#, &control);
            assert!(started.started);
            let v = until_done(&wire, Duration::from_secs(7));
            assert!(t0.elapsed() < Duration::from_secs(7));
            assert_eq!(v.last().unwrap().1["ok"], true);
            assert!(logged(&v, LEFT_BEHIND_KILLED), "the log does not say what was stopped: {v:?}");
            assert!(!logged(&v, STREAMS_OPEN));
            assert!(!mgr.is_busy());
            assert!(d.join("a.tags.tsv").exists());
            let pid = orphan_pid(&d);
            assert!(!alive_after(pid, Duration::from_secs(2)), "the process the CLI left behind ({pid}) survived the run");
            let _ = std::fs::remove_dir_all(&d);
        }

        // A holder outside the CLI's process group (one that inherited the
        // pipes from a parallel spawn) is not the run's to kill: the run
        // still ends, within DRAIN, and says why later lines are missing.
        #[test]
        fn a_run_whose_streams_are_held_outside_its_group_still_ends() {
            let d = dir("detached");
            let t0 = std::time::Instant::now();
            let control =
                format!("STUB_ORPHAN=12\nSTUB_ORPHAN_DETACH=1\nSTUB_ORPHAN_PID={}\n", d.join("orphan.pid").display());
            let (mgr, started, wire) = launch_stub(&d, r#"{"in":"$IN","out":"a.tags.tsv"}"#, &control);
            assert!(started.started);
            let v = until_done(&wire, Duration::from_secs(7));
            assert!(t0.elapsed() < Duration::from_secs(7));
            assert_eq!(v.last().unwrap().1["ok"], true);
            assert!(logged(&v, STREAMS_OPEN), "the log does not say why lines may be missing: {v:?}");
            assert!(!mgr.is_busy());
            let pid = orphan_pid(&d);
            assert!(alive_after(pid, Duration::ZERO), "a process outside the run's group was signalled");
            // SAFETY: the test's own detached sleep; leave nothing behind.
            unsafe {
                kill(pid, 9);
            }
            assert!(!alive_after(pid, Duration::from_secs(2)));
            let _ = std::fs::remove_dir_all(&d);
        }

        // Cancel after the CLI has exited, while its run still drains: the
        // group is killed at once, not only when DRAIN runs out.
        #[test]
        fn a_cancel_while_the_run_drains_kills_what_the_cli_left_behind() {
            let d = dir("drain-cancel");
            let control = format!("STUB_ORPHAN=12\nSTUB_ORPHAN_PID={}\n", d.join("orphan.pid").display());
            let (mgr, started, wire) = launch_stub(&d, r#"{"in":"$IN","out":"a.tags.tsv"}"#, &control);
            assert!(started.started);
            // The pid file is written just before the stub exits.
            let until = std::time::Instant::now() + Duration::from_secs(5);
            while !d.join("orphan.pid").exists() || std::fs::read_to_string(d.join("orphan.pid")).unwrap().trim().is_empty() {
                assert!(std::time::Instant::now() < until, "the stub did not start its orphan");
                std::thread::sleep(Duration::from_millis(10));
            }
            let pid = orphan_pid(&d);
            // Wait until the coordinator has reaped the CLI.
            let until = std::time::Instant::now() + Duration::from_secs(1);
            loop {
                let reaped = mgr.current.lock().unwrap().as_ref().map(|r| r.reaped.load(Ordering::SeqCst));
                if reaped != Some(false) {
                    break;
                }
                assert!(std::time::Instant::now() < until, "the CLI was not reaped");
                std::thread::sleep(Duration::from_millis(5));
            }
            let t0 = std::time::Instant::now();
            let killed = mgr.current.lock().unwrap().as_ref().is_some_and(|run| kill_run(run, true));
            assert!(killed, "Cancel in the drain window did nothing");
            assert!(!alive_after(pid, Duration::from_secs(1)), "the process the CLI left behind ({pid}) survived Cancel");
            let v = until_done(&wire, Duration::from_secs(5));
            // Its pipes closed with it: no DRAIN timeout.
            assert!(t0.elapsed() < DRAIN, "{:?}", t0.elapsed());
            assert!(!logged(&v, STREAMS_OPEN) && !logged(&v, LEFT_BEHIND_KILLED));
            // The CLI itself had finished: the run is not cancelled.
            assert_eq!(v.last().unwrap().1["ok"], true);
            assert!(!mgr.is_busy());
            let _ = std::fs::remove_dir_all(&d);
        }

        fn kill_current_of(mgr: &RunManager) {
            if let Some(run) = mgr.current.lock().unwrap().as_ref() {
                kill_run(run, true);
            }
        }
    }

    // GUI-DESIGN 6.3: the reply of `run` as the renderer gets it. The keys of
    // its outputs are the option names types.ts and App.tsx read; a
    // rename_all on ResolvedOutputs once sent speciesOut and digestOut, so
    // every report but -out went unread while the TS mocks, which built
    // their own keys, stayed green. The same JSON is the fixture the vitest
    // contract tests replay (api.test.ts, p1a.test.tsx).
    #[test]
    fn the_run_reply_names_every_output_by_its_option_name() {
        let s = |p: &str| Some(p.to_string());
        let started = RunStarted {
            started: true,
            reason: None,
            out: s("/d/a.tags.tsv"),
            outputs: Some(ResolvedOutputs {
                out: s("/d/a.tags.tsv"),
                species_out: s("/d/a.tags.species.tsv"),
                digest_out: s("/d/a.digest.tsv"),
                label_out: s("/d/a.label.tsv"),
                massgap_out: s("/d/a.massgap.tsv"),
                recon_out: s("/d/a.recon.tsv"),
                delta_out: s("/d/a.delta.tsv"),
                recon_id_out: s("/d/a.recon_id.tsv"),
                glyco_out: s("/d/a.tags.glyco.tsv"),
                out_spectra: s("/d/a.spectra.mzpeak"),
            }),
            command: Some(["/bin/FASTag", "-in", "/d/a.mzML", "-out", "/d/a.tags.tsv", "-progress"].map(String::from).to_vec()),
        };
        let json = serde_json::to_value(&started).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "started": true,
                "reason": null,
                "out": "/d/a.tags.tsv",
                "outputs": {
                    "out": "/d/a.tags.tsv",
                    "species_out": "/d/a.tags.species.tsv",
                    "digest_out": "/d/a.digest.tsv",
                    "label_out": "/d/a.label.tsv",
                    "massgap_out": "/d/a.massgap.tsv",
                    "recon_out": "/d/a.recon.tsv",
                    "delta_out": "/d/a.delta.tsv",
                    "recon_id_out": "/d/a.recon_id.tsv",
                    "glyco_out": "/d/a.tags.glyco.tsv",
                    "out_spectra": "/d/a.spectra.mzpeak"
                },
                "command": ["/bin/FASTag", "-in", "/d/a.mzML", "-out", "/d/a.tags.tsv", "-progress"]
            })
        );
        let fixture: Value = serde_json::from_str(include_str!("../../src/testing/fixtures/run-started.json")).unwrap();
        assert_eq!(json, fixture, "gui/src/testing/fixtures/run-started.json is not what `run` sends");
        // A refused run: no outputs at all.
        assert_eq!(
            serde_json::to_value(refused("busy".into())).unwrap(),
            serde_json::json!({"started": false, "reason": "busy", "out": null, "outputs": null, "command": null})
        );
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
