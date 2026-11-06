// Process lifetime (GUI-DESIGN 6.6, P1 PR b): a CLI child never outlives
// the GUI, and a healthy run never dies with an idle thread of it.
//
// - spawn(): every CLI child is started by one long-lived spawner thread.
//   On Linux PR_SET_PDEATHSIG fires when the *thread* that forked the child
//   exits, not the process; a child forked from an async task or Tokio's
//   blocking pool (whose idle threads exit after 10 s) would be killed in
//   the middle of a multi-hour run. The spawner thread never exits.
// - die_with_parent(): Linux only. The child asks for SIGTERM when its
//   parent dies (PR_SET_PDEATHSIG, kept across exec, so the real FASTag.bin
//   the wrapper execs keeps it), then checks getppid(): a parent that died
//   before the prctl would never send it, so the child gives up instead.
// - watch(): a watchdog process (/bin/sh) per run, on every Unix. It blocks
//   on a lifeline pipe whose only write end is held by the GUI; when the
//   GUI ends in any way (kill -9 included) the pipe reads EOF and the
//   watchdog kills the run's process group. A run that ends normally is
//   released first ("done"), and the watchdog leaves. This is the macOS
//   equivalent of PDEATHSIG (macOS has none), and on Linux it also reaches
//   what a wrapper started without exec.
// - kill_group_until_reaped(): a group kill is repeated until the child is
//   reaped. On macOS a SIGKILL sent to a process group misses a process the
//   group is forking at that moment (measured: a shell forking in a loop
//   left a live child after every one of 20 single kills); it then held the
//   run's pipes and the run never ended (the stub_cli flake).
// - adopt_kill_on_close_job(): Windows only. At startup the GUI puts itself
//   into a JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE job: every process it starts
//   later, including the real exe that FASTag.bat starts, is born in that
//   job, and when the GUI ends the system closes the job's last handle and
//   kills them all. No post-spawn assignment, so no race with a grandchild.
//
// std, libc and windows-sys only: no Tauri, so the Linux-only parts can be
// tested on their own.

use std::io;
use std::process::{Child, Command};
use std::sync::mpsc;
use std::sync::OnceLock;

type SpawnJob = (Command, mpsc::Sender<io::Result<Child>>);

/// The spawner thread's queue. Created on first use; the sender is never
/// dropped, so the thread lives as long as the process.
fn spawner() -> &'static mpsc::Sender<SpawnJob> {
    static SPAWNER: OnceLock<mpsc::Sender<SpawnJob>> = OnceLock::new();
    SPAWNER.get_or_init(|| {
        let (tx, rx) = mpsc::channel::<SpawnJob>();
        std::thread::Builder::new()
            .name("fastag-spawner".into())
            .spawn(move || {
                for (mut cmd, reply) in rx {
                    let _ = reply.send(cmd.spawn());
                }
            })
            .expect("cannot start the spawner thread");
        tx
    })
}

/// Start @p cmd on the spawner thread and hand back the child. Every CLI
/// child goes through here (GUI-DESIGN 6.6); it also serializes spawns, so
/// no other spawn of ours can fork while a pipe of a spawn is still without
/// its close-on-exec flag (macOS has no pipe2).
pub fn spawn(cmd: Command) -> io::Result<Child> {
    let (tx, rx) = mpsc::channel();
    spawner().send((cmd, tx)).map_err(|_| io::Error::other("the spawner thread has stopped"))?;
    rx.recv().map_err(|_| io::Error::other("the spawner thread has stopped"))?
}

/// Linux: the child gets SIGTERM when the thread that forked it (the
/// spawner thread, which never exits) or the GUI process dies, and gives up
/// at once if the GUI died before the prctl. Elsewhere a no-op.
pub fn die_with_parent(cmd: &mut Command) {
    #[cfg(target_os = "linux")]
    die_with(cmd, std::process::id() as libc::pid_t);
    #[cfg(not(target_os = "linux"))]
    let _ = cmd;
}

#[cfg(target_os = "linux")]
fn die_with(cmd: &mut Command, parent: libc::pid_t) {
    use std::os::unix::process::CommandExt;
    // SAFETY: the closure runs between fork and exec and calls only
    // async-signal-safe functions (prctl, getppid); building an io::Error
    // from an errno does not allocate.
    unsafe {
        cmd.pre_exec(move || {
            if libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGTERM as libc::c_ulong, 0, 0, 0) != 0 {
                return Err(io::Error::last_os_error());
            }
            if libc::getppid() != parent {
                return Err(io::Error::from_raw_os_error(libc::ESRCH));
            }
            Ok(())
        });
    }
}

/// The watchdog of one run (Unix). Dropping it releases it, as release()
/// does; only the death of the GUI process leaves the lifeline unreleased.
#[cfg(unix)]
pub struct Watchdog {
    lifeline: Option<std::process::ChildStdin>,
    process: Child,
}

/// The watchdog: "done" on the lifeline releases it; EOF means the GUI is
/// gone, so the run's group ($1) is killed, again while any of it is left
/// (a member being forked can miss one kill, see kill_group_until_reaped),
/// at most five times a second apart.
#[cfg(unix)]
const WATCHDOG: &str = r#"read -r _ && exit 0
i=0
while kill -s KILL -- "-$1" 2>/dev/null && [ "$i" -lt 5 ]; do i=$((i + 1)); sleep 1; done
exit 0"#;

/// Start the watchdog of the run whose process group is @p pgid. It runs in
/// a process group of its own, so a cancel of the run (a kill of the run's
/// group) or a Ctrl-C to the GUI's terminal does not end it, and it holds
/// none of the run's pipes. It gets no PDEATHSIG: it must outlive the GUI.
#[cfg(unix)]
pub fn watch(pgid: u32) -> io::Result<Watchdog> {
    use std::os::unix::process::CommandExt;
    use std::process::Stdio;
    let mut cmd = Command::new("/bin/sh");
    cmd.args(["-c", WATCHDOG, "fastag-watchdog", &pgid.to_string()])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .process_group(0);
    let mut process = spawn(cmd)?;
    Ok(Watchdog { lifeline: process.stdin.take(), process })
}

#[cfg(unix)]
impl Watchdog {
    /// The run has ended (before its child is reaped, so the group id the
    /// watchdog holds cannot be reused yet): the watchdog leaves without a
    /// kill.
    pub fn release(mut self) {
        self.release_now();
    }

    fn release_now(&mut self) {
        if let Some(mut w) = self.lifeline.take() {
            use std::io::Write;
            // A watchdog that is already gone (killed with its terminal) is
            // a failed write here; the GUI ignores SIGPIPE.
            let _ = w.write_all(b"done\n");
            drop(w);
            let _ = self.process.wait();
        }
    }

    /// The watchdog's pid (for the tests).
    #[cfg(test)]
    pub fn id(&self) -> u32 {
        self.process.id()
    }
}

#[cfg(unix)]
impl Drop for Watchdog {
    fn drop(&mut self) {
        self.release_now();
    }
}

#[cfg(unix)]
extern "C" {
    fn kill(pid: i32, sig: i32) -> i32;
}

/// Send SIGKILL to process group @p pgid now, and again until @p reaped is
/// set (under the @p child lock, by whoever reaps the child), at growing
/// intervals for about ten seconds. While the leader is not reaped its pid,
/// and so the group id, cannot be reused, so no later kill reaches another
/// process. The repeats run on a thread of their own.
#[cfg(unix)]
pub fn kill_group_until_reaped(
    pgid: u32,
    child: std::sync::Arc<std::sync::Mutex<Child>>,
    reaped: std::sync::Arc<std::sync::atomic::AtomicBool>,
) {
    use std::sync::atomic::Ordering;
    let Ok(pgid) = i32::try_from(pgid) else { return };
    let signal = move || {
        // SAFETY: kill(2) with a negative pid only sends a signal.
        unsafe {
            kill(-pgid, 9);
        }
    };
    signal();
    std::thread::spawn(move || {
        for ms in [5u64, 10, 20, 50, 100, 200, 400, 800, 1600, 3200, 3200] {
            std::thread::sleep(std::time::Duration::from_millis(ms));
            let Ok(_guard) = child.lock() else { return };
            if reaped.load(Ordering::SeqCst) {
                return;
            }
            signal();
        }
    });
}

/// Windows: put the GUI process into a job that kills every process in it
/// when its last handle closes, which the system does when the GUI ends.
/// Children inherit the job at creation. The handle is kept open for the
/// life of the process on purpose.
#[cfg(windows)]
pub fn adopt_kill_on_close_job() -> io::Result<()> {
    use windows_sys::Win32::System::Threading::GetCurrentProcess;
    let job = kill_on_close_job()?;
    // SAFETY: both handles are valid; the job handle is never closed.
    if unsafe { windows_sys::Win32::System::JobObjects::AssignProcessToJobObject(job, GetCurrentProcess()) } == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

/// A new job object whose processes die when its last handle is closed.
/// Breakaway is allowed, so a process started with CREATE_BREAKAWAY_FROM_JOB
/// can leave it.
#[cfg(windows)]
fn kill_on_close_job() -> io::Result<windows_sys::Win32::Foundation::HANDLE> {
    use windows_sys::Win32::System::JobObjects::{
        CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_BREAKAWAY_OK, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    // SAFETY: plain Win32 calls with valid arguments; the info struct is
    // plain data, zeroed then filled.
    unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() {
            return Err(io::Error::last_os_error());
        }
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_BREAKAWAY_OK;
        let ok = SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const std::ffi::c_void,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        );
        if ok == 0 {
            let e = io::Error::last_os_error();
            windows_sys::Win32::Foundation::CloseHandle(job);
            return Err(e);
        }
        Ok(job)
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Read};
    use std::os::unix::process::CommandExt;
    use std::process::{ChildStdout, Stdio};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    /// Read @p r to EOF on a thread; true if EOF came within @p secs. EOF
    /// means every process holding the write end has ended.
    fn eof_within<R: Read + Send + 'static>(mut r: R, secs: u64) -> bool {
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            let mut sink = Vec::new();
            let _ = r.read_to_end(&mut sink);
            let _ = tx.send(());
        });
        rx.recv_timeout(Duration::from_secs(secs)).is_ok()
    }

    fn kill_group(pgid: i32) {
        // SAFETY: kill(2) only sends a signal.
        unsafe {
            kill(-pgid, 9);
        }
    }

    // A stand-in GUI process: this test binary run again with
    // FASTAG_LIFETIME_HELPER=<mode>, so the test can kill -9 it. It starts
    // one "CLI" whose stdout is the helper's own (the pipe to the test), so
    // the test sees EOF only once the CLI and everything it started are
    // gone, prints "ready <pgid>" and waits to be killed.
    const HELPER_ENV: &str = "FASTAG_LIFETIME_HELPER";

    #[test]
    #[ignore = "a helper process of the tests below, not a test"]
    fn gui_process_helper() {
        let Ok(mode) = std::env::var(HELPER_ENV) else { return };
        let (cli, wd) = match mode.as_str() {
            // The CLI with PDEATHSIG and nothing else (Linux).
            "pdeathsig" => {
                let mut cmd = Command::new("sleep");
                cmd.arg("30").stdin(Stdio::null()).stderr(Stdio::null()).process_group(0);
                die_with_parent(&mut cmd);
                (spawn(cmd).unwrap(), None)
            }
            // A CLI that starts a worker of its own, watched by the watchdog
            // and without PDEATHSIG (as on macOS).
            "watchdog" => {
                let mut cmd = Command::new("sh");
                cmd.args(["-c", "sleep 30 & sleep 30 & wait"]).stdin(Stdio::null()).stderr(Stdio::null()).process_group(0);
                let cli = spawn(cmd).unwrap();
                let wd = watch(cli.id()).unwrap();
                (cli, Some(wd))
            }
            other => panic!("unknown helper mode {other}"),
        };
        println!("ready {}", cli.id());
        let _keep = (cli, wd);
        std::thread::sleep(Duration::from_secs(60));
    }

    /// Start the helper in @p mode; its stdout (after "ready") and the CLI's
    /// process group. The caller kills it and waits for it.
    #[allow(clippy::zombie_processes)]
    fn gui_process(mode: &str) -> (Child, BufReader<ChildStdout>, i32) {
        let mut gui = Command::new(std::env::current_exe().unwrap())
            .args(["lifetime::tests::gui_process_helper", "--exact", "--ignored", "--nocapture", "--test-threads=1"])
            .env(HELPER_ENV, mode)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let mut out = BufReader::new(gui.stdout.take().unwrap());
        let mut line = String::new();
        loop {
            line.clear();
            assert!(out.read_line(&mut line).unwrap() > 0, "the helper ended before it was ready");
            // libtest prints "test <name> ... " before it, on the same line.
            if let Some(i) = line.find("ready ") {
                return (gui, out, line[i + 6..].trim().parse().unwrap());
            }
        }
    }

    // P1 acceptance: "a CLI run spawned before an idle worker thread exits
    // keeps running". The worker stands for a Tokio blocking-pool thread
    // that asks for the spawn and then exits idle; on Linux the child's
    // PDEATHSIG would fire with it if that thread had forked the child.
    #[test]
    fn a_child_outlives_the_idle_thread_that_asked_for_it() {
        let worker = std::thread::spawn(|| {
            let mut cmd = Command::new("sleep");
            cmd.arg("30").stdin(Stdio::null());
            die_with_parent(&mut cmd);
            spawn(cmd).unwrap()
        });
        let mut child = worker.join().unwrap();
        std::thread::sleep(Duration::from_millis(500));
        let still = child.try_wait().unwrap();
        let _ = child.kill();
        let _ = child.wait();
        assert!(still.is_none(), "the child died with the thread that asked for it: {still:?}");
    }

    // Why spawn() exists: the same child forked by the exiting thread itself
    // gets its PDEATHSIG when that thread ends.
    #[cfg(target_os = "linux")]
    #[test]
    fn a_child_forked_by_an_exiting_thread_dies_with_it() {
        let worker = std::thread::spawn(|| {
            let mut cmd = Command::new("sleep");
            cmd.arg("30").stdin(Stdio::null());
            die_with_parent(&mut cmd);
            cmd.spawn().unwrap()
        });
        let mut child = worker.join().unwrap();
        let mut status = None;
        for _ in 0..300 {
            status = child.try_wait().unwrap();
            if status.is_some() {
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        let _ = child.kill();
        use std::os::unix::process::ExitStatusExt;
        assert_eq!(status.and_then(|s| s.signal()), Some(libc::SIGTERM), "PDEATHSIG did not fire");
    }

    // The getppid check: a parent that is already gone at the prctl never
    // sends the signal, so the child gives up.
    #[cfg(target_os = "linux")]
    #[test]
    fn a_child_whose_parent_is_already_gone_gives_up() {
        let mut cmd = Command::new("sleep");
        cmd.arg("30").stdin(Stdio::null());
        die_with(&mut cmd, 1); // not this process: "the parent has died"
        let err = spawn(cmd).expect_err("the child ran although its parent was gone");
        assert_eq!(err.raw_os_error(), Some(libc::ESRCH));
    }

    // GUI-DESIGN 9 cargo layer: "kill the parent and assert the child is
    // reaped", through PDEATHSIG alone.
    #[cfg(target_os = "linux")]
    #[test]
    fn pdeathsig_ends_the_cli_when_the_gui_process_is_killed() {
        let (mut gui, out, pgid) = gui_process("pdeathsig");
        gui.kill().unwrap();
        let _ = gui.wait();
        let ended = eof_within(out, 3);
        kill_group(pgid);
        assert!(ended, "the CLI outlived the killed GUI by more than 3 s");
    }

    // P1 acceptance: "killing the GUI process (kill -9) ends the CLI within
    // 3 s", here through the watchdog alone (the macOS path), for the CLI
    // and the worker it started.
    #[test]
    fn the_watchdog_ends_the_cli_and_its_workers_when_the_gui_process_is_killed() {
        let (mut gui, out, pgid) = gui_process("watchdog");
        gui.kill().unwrap();
        let _ = gui.wait();
        let ended = eof_within(out, 3);
        kill_group(pgid);
        assert!(ended, "the CLI outlived the killed GUI by more than 3 s");
    }

    fn sleeper() -> Child {
        let mut cmd = Command::new("sleep");
        cmd.arg("30").stdin(Stdio::null()).process_group(0);
        spawn(cmd).unwrap()
    }

    // A run that ended normally releases its watchdog, which then leaves
    // without killing anything (the group id could be reused after the reap).
    #[test]
    fn a_released_or_dropped_watchdog_kills_nothing() {
        for drop_it in [false, true] {
            let mut child = sleeper();
            let wd = watch(child.id()).unwrap();
            let wd_pid = wd.id();
            if drop_it {
                drop(wd);
            } else {
                wd.release(); // returns once the watchdog has exited
            }
            std::thread::sleep(Duration::from_millis(300));
            let still = child.try_wait().unwrap();
            let _ = child.kill();
            let _ = child.wait();
            assert!(still.is_none(), "the watchdog killed a released run (drop: {drop_it})");
            // SAFETY: kill(2) with signal 0 only checks for the process.
            assert_ne!(unsafe { kill(wd_pid as i32, 0) }, 0, "the watchdog is still there");
        }
    }

    // The stub_cli flake: a cancel that lands while the CLI forks (the stub
    // shell starting `sleep`) left that new process alive on macOS; it held
    // the run's pipes and the run never ended. One kill of a group forking in
    // a loop leaves survivors there every time; the repeated kill ends them.
    #[test]
    fn a_group_kill_reaches_the_processes_the_group_is_forking() {
        let mut cmd = Command::new("sh");
        cmd.args(["-c", "echo go; i=0; while [ $i -lt 300 ]; do sleep 30 & i=$((i + 1)); done; wait"])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .process_group(0);
        let mut child = spawn(cmd).unwrap();
        let mut out = BufReader::new(child.stdout.take().unwrap());
        let mut go = String::new();
        out.read_line(&mut go).unwrap();
        std::thread::sleep(Duration::from_millis(10)); // in the middle of the loop
        let pgid = child.id();
        let child = Arc::new(Mutex::new(child));
        let reaped = Arc::new(AtomicBool::new(false));
        kill_group_until_reaped(pgid, child.clone(), reaped.clone());
        let ended = eof_within(out, 5);
        {
            let mut c = child.lock().unwrap();
            let _ = c.wait();
            reaped.store(true, Ordering::SeqCst);
        }
        if !ended {
            kill_group(pgid as i32);
        }
        assert!(ended, "a process of the killed group still holds its stdout");
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use std::os::windows::io::AsRawHandle;
    use std::process::Stdio;
    use std::time::Duration;

    // What the GUI's startup job does to its children: when the job's last
    // handle closes (the GUI process ends), they end too. The child here is
    // put into the job after its start; the GUI's own children are born in it.
    #[test]
    fn a_kill_on_close_job_ends_its_processes_when_its_handle_closes() {
        let job = kill_on_close_job().unwrap();
        let mut child = Command::new("cmd")
            .args(["/C", "ping -n 30 127.0.0.1 >NUL"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .spawn()
            .unwrap();
        // SAFETY: valid handles.
        let assigned = unsafe {
            windows_sys::Win32::System::JobObjects::AssignProcessToJobObject(job, child.as_raw_handle() as _)
        };
        assert_ne!(assigned, 0, "{}", io::Error::last_os_error());
        std::thread::sleep(Duration::from_millis(300));
        assert!(child.try_wait().unwrap().is_none(), "ended before the job closed");
        // SAFETY: the job handle is ours and closed once.
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(job);
        }
        let mut ended = false;
        for _ in 0..300 {
            if child.try_wait().unwrap().is_some() {
                ended = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        let _ = child.kill();
        assert!(ended, "the process outlived its kill-on-close job");
    }

    #[test]
    fn spawn_starts_a_child_from_the_spawner_thread() {
        let mut cmd = Command::new("cmd");
        cmd.args(["/C", "exit 3"]).stdin(Stdio::null());
        let st = spawn(cmd).unwrap().wait().unwrap();
        assert_eq!(st.code(), Some(3));
    }
}
