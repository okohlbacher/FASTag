// The inspector's two backend commands (GUI-DESIGN 3 S1 and 6.7, P2b):
//
// - cli_capabilities: the options the CLI's `--helphelp` lists. The GUI
//   detects every optional CLI feature by them (the metadata probe, the
//   1.12 acquisition check), never by the version string.
// - probe_input: `FASTag -probe_input <file>`, the metadata probe whose JSON
//   lines the renderer parses (src/inspector/probe.ts has the contract). It
//   runs only when --helphelp lists -probe_input; with a CLI that lacks the
//   flag it refuses, and the inspector shows "not checked".
//
// The GUI reads no spectra file itself: no mzML, mzPeak or MGF reader is
// added here. Both commands spawn the CLI with an argv array (no shell),
// with the same environment a run gets, through lifetime::spawn_cli (the
// spawner thread; on Windows a job of its own) like every CLI child.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime};

use serde::Serialize;
use tauri::AppHandle;

use crate::fastag::{no_console_window, cli_env, resolve_binary, taxonomy_dir, Resolved};
use crate::lifetime;

/// How long a probe may take: it reads metadata only (the 1.12 acquisition
/// probe reads at most 10 x 4000 spectrum heads), so a minute means a hung
/// or a cold network share; the run itself then shows what is wrong.
pub const PROBE_TIMEOUT: Duration = Duration::from_secs(60);
/// The probe prints a handful of JSON lines; more than this is not a probe.
pub const PROBE_MAX_BYTES: usize = 1 << 20;
const HELP_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Capabilities {
    // The option names --helphelp lists, without the leading dash.
    pub options: Vec<String>,
    // --helphelp ran and listed options.
    pub ok: bool,
    pub detail: String,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct ProbeRun {
    // The CLI has -probe_input; false: nothing was run.
    pub supported: bool,
    // Exited 0 within the timeout.
    pub ok: bool,
    pub code: Option<i32>,
    pub timed_out: bool,
    // The JSON lines, for probe.ts (cut at PROBE_MAX_BYTES).
    pub stdout: String,
    // The last stderr line: why a probe failed.
    pub reason: Option<String>,
}

/// The option names of a TOPP `--help`/`--helphelp` text: the lines indented
/// by exactly two spaces that start with one dash ("  -probe_input <file>").
/// Continuation lines are indented deeper, the common TOPP flags have two
/// dashes, and neither is an option of the tool.
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

/// The argv of a probe of @p input (and @p fasta), or why there is none:
/// the CLI lacks -probe_input, or the path is not an absolute file path (the
/// renderer passes picked paths; a relative or dash-led one is refused so it
/// can never read as an option).
pub fn probe_args(options: &[String], input: &str, fasta: Option<&str>) -> Result<Vec<String>, String> {
    if !options.iter().any(|o| o == "probe_input") {
        return Err("this FASTag has no -probe_input".into());
    }
    let abs = |p: &str| Path::new(p).is_absolute() && !p.starts_with('-');
    if !abs(input) {
        return Err(format!("not an absolute path: {input}"));
    }
    let mut a = vec!["-probe_input".to_string(), input.to_string()];
    if let Some(f) = fasta.filter(|f| !f.is_empty()) {
        if !abs(f) {
            return Err(format!("not an absolute path: {f}"));
        }
        if options.iter().any(|o| o == "fasta") {
            a.push("-fasta".into());
            a.push(f.to_string());
        }
    }
    Ok(a)
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
    cli_env(&mut cmd);
    // Started by the spawner thread like every CLI child (lifetime.rs, see
    // run_bounded): the blocking-pool thread that asks may exit when idle.
    lifetime::die_with_parent(&mut cmd);
    cmd
}

struct Bounded {
    code: Option<i32>,
    timed_out: bool,
    // @p cancel said stop before the child ended: it was killed.
    cancelled: bool,
    stdout: String,
    stderr: String,
}

/// Run @p cmd to its end or @p timeout, or until @p cancel returns true
/// (then kill it), reading at most @p max bytes of stdout.
fn run_bounded(mut cmd: Command, timeout: Duration, max: usize, cancel: &dyn Fn() -> bool) -> std::io::Result<Bounded> {
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    // On Windows in a kill-on-close job of its own: job is dropped after the
    // child is reaped, which also ends any process the CLI left behind.
    let (mut child, job) = lifetime::spawn_cli(cmd)?;
    let mut so = child.stdout.take().expect("piped");
    let mut se = child.stderr.take().expect("piped");
    let out = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = so.by_ref().take(max as u64).read_to_end(&mut buf);
        // Drain the rest so the child never blocks on a full pipe.
        let _ = std::io::copy(&mut so, &mut std::io::sink());
        buf
    });
    let err = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = se.by_ref().take(64 * 1024).read_to_end(&mut buf);
        let _ = std::io::copy(&mut se, &mut std::io::sink());
        buf
    });
    let until = Instant::now() + timeout;
    let mut timed_out = false;
    let mut cancelled = false;
    let status = loop {
        if let Some(s) = child.try_wait()? {
            break Some(s);
        }
        cancelled = cancel();
        if cancelled || Instant::now() >= until {
            timed_out = !cancelled;
            // Windows: the job holds the whole tree (a .bat wrapper's exe).
            #[cfg(windows)]
            if let Some(j) = &job {
                j.terminate();
            }
            let _ = child.kill();
            let _ = child.wait();
            break None;
        }
        std::thread::sleep(Duration::from_millis(20));
    };
    // The child is reaped: closing its job (Windows) ends what it left behind.
    #[cfg(windows)]
    drop(job);
    #[cfg(not(windows))]
    let () = job;
    // A grandchild holding the pipes would keep the readers alive: they are
    // joined only when the child itself has ended without a timeout.
    let (stdout, stderr) = if status.is_none() {
        (Vec::new(), Vec::new())
    } else {
        (out.join().unwrap_or_default(), err.join().unwrap_or_default())
    };
    Ok(Bounded {
        code: status.and_then(|s| s.code()),
        timed_out,
        cancelled,
        stdout: String::from_utf8_lossy(&stdout).into_owned(),
        stderr: String::from_utf8_lossy(&stderr).into_owned(),
    })
}

/// The capabilities of the binary @p r resolves to.
pub fn capabilities_of(r: &Resolved) -> Capabilities {
    if r.source == "missing" {
        return Capabilities { options: vec![], ok: false, detail: "no FASTag binary".into() };
    }
    let mut cmd = command(r);
    cmd.arg("--helphelp");
    match run_bounded(cmd, HELP_TIMEOUT, 4 << 20, &|| false) {
        Ok(b) if b.timed_out => Capabilities { options: vec![], ok: false, detail: "--helphelp timed out".into() },
        // TOPP prints the help on stdout; some builds exit non-zero after it.
        Ok(b) => {
            let options = parse_options(&format!("{}\n{}", b.stdout, b.stderr));
            let ok = !options.is_empty();
            let detail = if ok { format!("{} options", options.len()) } else { "--helphelp listed no options".into() };
            Capabilities { options, ok, detail }
        }
        Err(e) => Capabilities { options: vec![], ok: false, detail: format!("cannot execute: {e}") },
    }
}

/// Probe @p input with the binary @p r, if @p options has -probe_input. The
/// child is killed when @p cancel returns true (a newer probe superseded it).
pub fn probe_with(
    r: &Resolved,
    options: &[String],
    input: &str,
    fasta: Option<&str>,
    timeout: Duration,
    cancel: &dyn Fn() -> bool,
) -> ProbeRun {
    let none = |reason: String, supported: bool| ProbeRun {
        supported,
        ok: false,
        code: None,
        timed_out: false,
        stdout: String::new(),
        reason: Some(reason),
    };
    let args = match probe_args(options, input, fasta) {
        Ok(a) => a,
        Err(e) => return none(e, options.iter().any(|o| o == "probe_input")),
    };
    let mut cmd = command(r);
    cmd.args(&args);
    match run_bounded(cmd, timeout, PROBE_MAX_BYTES, cancel) {
        Ok(b) => {
            let last = b.stderr.lines().map(str::trim).rfind(|l| !l.is_empty()).map(|l| l.chars().take(300).collect());
            ProbeRun {
                supported: true,
                ok: !b.timed_out && !b.cancelled && b.code == Some(0),
                code: b.code,
                timed_out: b.timed_out,
                stdout: b.stdout,
                reason: if b.cancelled {
                    Some("superseded by a newer probe".into())
                } else if b.timed_out {
                    Some(format!("no answer within {} s", timeout.as_secs()))
                } else {
                    last
                },
            }
        }
        Err(e) => none(format!("cannot execute: {e}"), true),
    }
}

// --helphelp loads the CLI's whole library closure: run it once per binary
// (path and mtime), not for every file the inspector looks at.
static CAPS: Mutex<Option<(PathBuf, Option<SystemTime>, Capabilities)>> = Mutex::new(None);

fn cached_capabilities(r: &Resolved) -> Capabilities {
    let mtime = std::fs::metadata(&r.bin).and_then(|m| m.modified()).ok();
    if let Ok(g) = CAPS.lock() {
        if let Some((p, t, c)) = g.as_ref() {
            if *p == r.bin && *t == mtime {
                return c.clone();
            }
        }
    }
    let c = capabilities_of(r);
    if c.ok {
        if let Ok(mut g) = CAPS.lock() {
            *g = Some((r.bin.clone(), mtime, c.clone()));
        }
    }
    c
}

#[tauri::command]
pub async fn cli_capabilities(app: AppHandle) -> Capabilities {
    tauri::async_runtime::spawn_blocking(move || cached_capabilities(&resolve_binary(&app)))
        .await
        .unwrap_or_else(|e| Capabilities { options: vec![], ok: false, detail: format!("failed: {e}") })
}

// The generation of the newest probe of each kind (0: the spectra file, 1:
// with a FASTA). The renderer probes one input at a time, so a newer call
// of a kind supersedes the older one, whose CLI child is killed instead of
// running on to its timeout.
static PROBE_GEN: [AtomicU64; 2] = [AtomicU64::new(0), AtomicU64::new(0)];

#[tauri::command]
pub async fn probe_input(app: AppHandle, input: String, fasta: Option<String>) -> ProbeRun {
    let kind = usize::from(fasta.as_deref().is_some_and(|f| !f.is_empty()));
    let generation = PROBE_GEN[kind].fetch_add(1, Ordering::SeqCst) + 1;
    tauri::async_runtime::spawn_blocking(move || {
        let r = resolve_binary(&app);
        let caps = cached_capabilities(&r);
        let superseded = || PROBE_GEN[kind].load(Ordering::SeqCst) != generation;
        if superseded() {
            return ProbeRun {
                supported: true,
                ok: false,
                code: None,
                timed_out: false,
                stdout: String::new(),
                reason: Some("superseded by a newer probe".into()),
            };
        }
        probe_with(&r, &caps.options, &input, fasta.as_deref(), PROBE_TIMEOUT, &superseded)
    })
    .await
    .unwrap_or_else(|e| ProbeRun {
        supported: false,
        ok: false,
        code: None,
        timed_out: false,
        stdout: String::new(),
        reason: Some(format!("failed: {e}")),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // The real --helphelp of the integration/1.12 build (0e4b0c5) on node
    // data: src/fixtures/cli-1.12/helphelp.txt.
    const HELPHELP_112: &str = include_str!("../../src/fixtures/cli-1.12/helphelp.txt");

    #[test]
    fn options_of_the_real_1_12_helphelp() {
        let o = parse_options(HELPHELP_112);
        for name in ["in", "out", "fasta", "fragment_tolerance_unit", "acquisition_check", "acquisition_probe_spectra", "pick_profile"] {
            assert!(o.iter().any(|x| x == name), "{name} missing");
        }
        // No 1.12 build has the probe yet; the common TOPP flags and the
        // continuation lines are not options.
        assert!(!o.iter().any(|x| x == "probe_input"));
        assert!(!o.iter().any(|x| x == "helphelp" || x == "help" || x.is_empty()));
        assert_eq!(o.iter().filter(|x| *x == "threads").count(), 1);
        assert_eq!(o.len(), o.iter().collect::<std::collections::HashSet<_>>().len());
    }

    #[test]
    fn a_helphelp_with_the_probe_lists_it() {
        let t = HELPHELP_112.replacen("  -in <file>", "  -probe_input <file>               Print the input's metadata as JSON lines and exit\n  -in <file>", 1);
        assert!(parse_options(&t).iter().any(|x| x == "probe_input"));
    }

    #[test]
    fn probe_args_need_the_flag_and_absolute_paths() {
        let without = parse_options(HELPHELP_112);
        assert!(probe_args(&without, "/d/a.mzML", None).unwrap_err().contains("no -probe_input"));
        let with: Vec<String> = ["probe_input", "fasta"].iter().map(|s| s.to_string()).collect();
        assert_eq!(probe_args(&with, "/d/a.mzML", None).unwrap(), vec!["-probe_input", "/d/a.mzML"]);
        assert_eq!(
            probe_args(&with, "/d/a.mzML", Some("/d/h.fasta")).unwrap(),
            vec!["-probe_input", "/d/a.mzML", "-fasta", "/d/h.fasta"]
        );
        assert!(probe_args(&with, "a.mzML", None).is_err());
        assert!(probe_args(&with, "-force", None).is_err());
        assert!(probe_args(&with, "/d/a.mzML", Some("-x")).is_err());
        // A CLI whose probe takes no -fasta: the FASTA is left out.
        let only: Vec<String> = vec!["probe_input".into()];
        assert_eq!(probe_args(&only, "/d/a.mzML", Some("/d/h.fasta")).unwrap(), vec!["-probe_input", "/d/a.mzML"]);
    }

    #[cfg(unix)]
    mod stub_cli {
        use super::super::*;

        const STUB: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../testing/stub-fastag/FASTag");
        const PROBE_FIXTURE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../src/fixtures/probe/iontrap.probe.jsonl");

        fn stub() -> Resolved {
            Resolved { bin: PathBuf::from(STUB), data: None, taxonomy: None, source: "env" }
        }

        fn dir(name: &str) -> PathBuf {
            let d = std::env::temp_dir().join(format!("fastag-inspect-{}-{name}", std::process::id()));
            let _ = std::fs::remove_dir_all(&d);
            std::fs::create_dir_all(&d).unwrap();
            d
        }

        fn opts() -> Vec<String> {
            vec!["probe_input".into(), "fasta".into()]
        }

        #[test]
        fn the_stub_helphelp_has_no_probe_unless_asked() {
            // Like the real 1.12 CLI: the GUI must not probe with it.
            let c = capabilities_of(&stub());
            assert!(c.ok, "{}", c.detail);
            assert!(c.options.iter().any(|o| o == "out"));
            assert!(!c.options.iter().any(|o| o == "probe_input"));
        }

        #[test]
        fn a_probe_returns_the_cli_json_lines() {
            let d = dir("ok");
            let input = d.join("run01.mzML");
            std::fs::write(&input, "").unwrap();
            std::fs::copy(PROBE_FIXTURE, d.join("run01.mzML.probe.jsonl")).unwrap();
            let p = probe_with(&stub(), &opts(), input.to_str().unwrap(), None, PROBE_TIMEOUT, &|| false);
            assert!(p.ok && p.supported && !p.timed_out, "{p:?}");
            assert_eq!(p.code, Some(0));
            assert_eq!(p.stdout, std::fs::read_to_string(PROBE_FIXTURE).unwrap());
        }

        #[test]
        fn a_file_the_probe_cannot_read_fails_with_its_reason() {
            let d = dir("unreadable");
            let p = probe_with(&stub(), &opts(), d.join("gone.mzML").to_str().unwrap(), None, PROBE_TIMEOUT, &|| false);
            assert!(!p.ok && p.supported);
            assert_eq!(p.code, Some(5));
            assert!(p.reason.unwrap().contains("cannot read"));
        }

        #[test]
        fn a_hung_probe_is_killed_at_the_timeout() {
            let d = dir("hang");
            let input = d.join("run01.mzML");
            std::fs::write(&input, "").unwrap();
            std::fs::write(d.join("run01.mzML.stub"), "STUB_PROBE_SLEEP=30\n").unwrap();
            let t = Instant::now();
            let p = probe_with(&stub(), &opts(), input.to_str().unwrap(), None, Duration::from_millis(500), &|| false);
            assert!(p.timed_out && !p.ok, "{p:?}");
            assert!(t.elapsed() < Duration::from_secs(10));
        }

        #[test]
        fn a_superseded_probe_is_killed_at_once() {
            let d = dir("superseded");
            let input = d.join("run01.mzML");
            std::fs::write(&input, "").unwrap();
            std::fs::write(d.join("run01.mzML.stub"), "STUB_PROBE_SLEEP=30\n").unwrap();
            let t = Instant::now();
            // A newer probe arrives 300 ms in.
            let newer = || t.elapsed() > Duration::from_millis(300);
            let p = probe_with(&stub(), &opts(), input.to_str().unwrap(), None, PROBE_TIMEOUT, &newer);
            assert!(!p.ok && !p.timed_out, "{p:?}");
            assert_eq!(p.reason.as_deref(), Some("superseded by a newer probe"));
            assert!(t.elapsed() < Duration::from_secs(10));
        }

        #[test]
        fn without_the_flag_nothing_runs() {
            let p = probe_with(&stub(), &["in".to_string()], "/d/a.mzML", None, PROBE_TIMEOUT, &|| false);
            assert!(!p.supported && !p.ok && p.code.is_none());
        }
    }
}
