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
// - spawn_cli(): every CLI child goes through here. On Windows the child is
//   started suspended, put into a JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE job of
//   its own and only then resumed, so everything it starts (the real exe
//   that FASTag.bat starts) is born in that job, with no race against a
//   grandchild. The GUI holds the only handle; when the GUI ends in any way
//   the system closes it and kills the run's whole tree. The GUI itself is
//   in no job of ours, so a browser or editor it opens (the opener plugin,
//   ShellExecute) is not tied to the GUI's life.
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

/// Whether child @p pid has exited, without reaping it (waitid with
/// WNOWAIT): the coordinator releases the run's watchdog between the exit
/// and the reap, while the group id cannot be reused yet. An error (no such
/// child) counts as exited, so the caller never waits for it forever.
#[cfg(unix)]
pub fn exited(pid: u32) -> bool {
    let id: libc::id_t = pid;
    // SAFETY: siginfo_t is plain data; waitid only writes into it, and with
    // WNOWAIT it leaves the child waitable.
    unsafe {
        let mut info: libc::siginfo_t = std::mem::zeroed();
        if libc::waitid(libc::P_PID, id, &mut info, libc::WEXITED | libc::WNOHANG | libc::WNOWAIT) != 0 {
            return true;
        }
        // WNOHANG: si_pid stays 0 while the child is still running.
        #[cfg(any(target_os = "linux", target_os = "android"))]
        let who = info.si_pid();
        #[cfg(not(any(target_os = "linux", target_os = "android")))]
        let who = info.si_pid;
        who != 0
    }
}

/// What keeps a run's processes tied to the GUI on Windows: the run's job
/// (None when it could not be set up). Nothing elsewhere.
#[cfg(windows)]
pub type RunJob = Option<Job>;
#[cfg(not(windows))]
pub type RunJob = ();

/// Start the CLI child @p cmd (spawn()); on Windows inside a kill-on-close
/// job of its own (spawn_in_job). Keep the RunJob until the child is
/// reaped: dropping it on Windows kills whatever of the run is left.
pub fn spawn_cli(cmd: Command) -> io::Result<(Child, RunJob)> {
    #[cfg(windows)]
    return spawn_in_job(cmd, CREATE_NO_WINDOW);
    #[cfg(not(windows))]
    spawn(cmd).map(|c| (c, ()))
}

/// The CLI is a console program and the GUI has none: without this flag
/// Windows gives every child a console window of its own.
#[cfg(windows)]
pub const CREATE_NO_WINDOW: u32 = windows_sys::Win32::System::Threading::CREATE_NO_WINDOW;

/// A kill-on-close job (Windows). Closing its handle, which drop() does and
/// the system does when the GUI ends, kills every process in it.
#[cfg(windows)]
pub struct Job(windows_sys::Win32::Foundation::HANDLE);

// SAFETY: a job handle is a kernel handle, usable from any thread.
#[cfg(windows)]
unsafe impl Send for Job {}
#[cfg(windows)]
unsafe impl Sync for Job {}

#[cfg(windows)]
impl Job {
    /// End every process in the job now (TerminateJobObject, exit code 1,
    /// as a killed child has on Windows). True when the call succeeded.
    pub fn terminate(&self) -> bool {
        // SAFETY: the handle is ours and open until drop().
        unsafe { windows_sys::Win32::System::JobObjects::TerminateJobObject(self.0, 1) != 0 }
    }
}

#[cfg(windows)]
impl Drop for Job {
    fn drop(&mut self) {
        // SAFETY: the handle is ours and closed once.
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.0);
        }
    }
}

/// Windows: start @p cmd with creation flags @p flags (they replace any set
/// on @p cmd) and CREATE_SUSPENDED, put it into a new kill-on-close job and
/// resume it. A job that cannot be set up (an old system without nested
/// jobs) is None: the child then runs without one. A child that cannot be
/// resumed is killed and an error.
#[cfg(windows)]
pub fn spawn_in_job(mut cmd: Command, flags: u32) -> io::Result<(Child, RunJob)> {
    use std::os::windows::io::AsRawHandle;
    use std::os::windows::process::CommandExt;
    use windows_sys::Win32::System::JobObjects::AssignProcessToJobObject;
    use windows_sys::Win32::System::Threading::CREATE_SUSPENDED;
    cmd.creation_flags(flags | CREATE_SUSPENDED);
    let mut child = spawn(cmd)?;
    let job = kill_on_close_job().ok().filter(|j| {
        // SAFETY: both handles are valid.
        unsafe { AssignProcessToJobObject(j.0, child.as_raw_handle() as _) != 0 }
    });
    if let Err(e) = resume_threads(child.id()) {
        let _ = child.kill();
        let _ = child.wait();
        return Err(e);
    }
    Ok((child, job))
}

/// Resume every thread of process @p pid (the main thread of a process
/// started suspended).
#[cfg(windows)]
fn resume_threads(pid: u32) -> io::Result<()> {
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Thread32First, Thread32Next, TH32CS_SNAPTHREAD, THREADENTRY32,
    };
    use windows_sys::Win32::System::Threading::{OpenThread, ResumeThread, THREAD_SUSPEND_RESUME};
    // SAFETY: plain Win32 calls; every handle opened here is closed here.
    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
        if snap == INVALID_HANDLE_VALUE {
            return Err(io::Error::last_os_error());
        }
        let mut entry = THREADENTRY32 { dwSize: std::mem::size_of::<THREADENTRY32>() as u32, ..Default::default() };
        let mut resumed = 0;
        let mut more = Thread32First(snap, &mut entry) != 0;
        while more {
            if entry.th32OwnerProcessID == pid {
                let t = OpenThread(THREAD_SUSPEND_RESUME, 0, entry.th32ThreadID);
                if !t.is_null() {
                    if ResumeThread(t) != u32::MAX {
                        resumed += 1;
                    }
                    CloseHandle(t);
                }
            }
            more = Thread32Next(snap, &mut entry) != 0;
        }
        CloseHandle(snap);
        if resumed == 0 {
            return Err(io::Error::other(format!("could not resume process {pid}")));
        }
    }
    Ok(())
}

/// A new job object whose processes die when its last handle is closed. Its
/// handle is not inheritable, so no child keeps the job open.
#[cfg(windows)]
fn kill_on_close_job() -> io::Result<Job> {
    use windows_sys::Win32::System::JobObjects::{
        CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    // SAFETY: plain Win32 calls with valid arguments; the info struct is
    // plain data, zeroed then filled.
    unsafe {
        let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if handle.is_null() {
            return Err(io::Error::last_os_error());
        }
        let job = Job(handle);
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let ok = SetInformationJobObject(
            job.0,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const std::ffi::c_void,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        );
        if ok == 0 {
            return Err(io::Error::last_os_error());
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
    use std::io::{BufRead, BufReader, Read};
    use std::os::windows::io::AsRawHandle;
    use std::process::{ChildStdout, Stdio};
    use std::time::Duration;
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{
        GetExitCodeProcess, OpenProcess, TerminateProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_TERMINATE,
    };

    /// Read @p r to EOF on a thread; true if EOF came within @p secs.
    fn eof_within<R: Read + Send + 'static>(mut r: R, secs: u64) -> bool {
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            let mut sink = Vec::new();
            let _ = r.read_to_end(&mut sink);
            let _ = tx.send(());
        });
        rx.recv_timeout(Duration::from_secs(secs)).is_ok()
    }

    /// Process @p pid is still running.
    fn alive(pid: u32) -> bool {
        // SAFETY: plain Win32 calls; the handle is closed here.
        unsafe {
            let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if h.is_null() {
                return false;
            }
            let mut code = 0u32;
            let ok = GetExitCodeProcess(h, &mut code);
            CloseHandle(h);
            ok != 0 && code == 259 // STILL_ACTIVE
        }
    }

    fn terminate(pid: u32) {
        // SAFETY: plain Win32 calls; the handle is closed here.
        unsafe {
            let h = OpenProcess(PROCESS_TERMINATE, 0, pid);
            if !h.is_null() {
                TerminateProcess(h, 1);
                CloseHandle(h);
            }
        }
    }

    // The job of a run: when its last handle closes (the GUI process ends),
    // its processes end too.
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
            windows_sys::Win32::System::JobObjects::AssignProcessToJobObject(job.0, child.as_raw_handle() as _)
        };
        assert_ne!(assigned, 0, "{}", io::Error::last_os_error());
        std::thread::sleep(Duration::from_millis(300));
        assert!(child.try_wait().unwrap().is_none(), "ended before the job closed");
        drop(job);
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

    // A child started suspended in its job runs once resumed, and its exit
    // code comes back.
    #[test]
    fn spawn_cli_resumes_the_child_it_started_in_a_job() {
        let mut cmd = Command::new("cmd");
        cmd.args(["/C", "exit 4"]).stdin(Stdio::null());
        let (mut child, job) = spawn_cli(cmd).unwrap();
        assert!(job.is_some(), "no job for the run");
        assert_eq!(child.wait().unwrap().code(), Some(4));
    }

    // A stand-in GUI process: this test binary run again with
    // FASTAG_LIFETIME_HELPER set, so the test can kill it (TerminateProcess,
    // the Windows kill -9). It starts one "CLI" the way start_run does
    // (spawn_cli): cmd.exe that starts a second cmd.exe that runs ping, a
    // grandchild like the real exe FASTag.bat starts, all with the helper's
    // own stdout (the pipe to the test), so the test sees EOF only once the
    // whole tree is gone. It also starts a process the way the opener
    // plugin's launches are started (a plain CreateProcess from the GUI,
    // outside any job of a run), prints "ready <cli> <opened>" and waits to
    // be killed.
    const HELPER_ENV: &str = "FASTAG_LIFETIME_HELPER";

    #[test]
    #[ignore = "a helper process of the test below, not a test"]
    fn gui_process_helper() {
        if std::env::var(HELPER_ENV).is_err() {
            return;
        }
        let mut cmd = Command::new("cmd");
        cmd.args(["/C", "cmd /C ping -n 30 127.0.0.1"]).stdin(Stdio::null()).stderr(Stdio::null());
        let (cli, job) = spawn_cli(cmd).unwrap();
        assert!(job.is_some(), "no job for the run");
        // The pipe to the test is an inherited, so inheritable, handle here:
        // the opened program must not hold it too, as the app's would not.
        // SAFETY: the handle is this process's stdout.
        unsafe {
            windows_sys::Win32::Foundation::SetHandleInformation(
                std::io::stdout().as_raw_handle() as _,
                windows_sys::Win32::Foundation::HANDLE_FLAG_INHERIT,
                0,
            );
        }
        let opened = Command::new("cmd")
            .args(["/C", "ping -n 30 127.0.0.1 >NUL"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        println!("ready {} {}", cli.id(), opened.id());
        let _keep = (cli, job, opened);
        std::thread::sleep(Duration::from_secs(60));
    }

    #[allow(clippy::zombie_processes)]
    fn gui_process() -> (Child, BufReader<ChildStdout>, u32, u32) {
        let mut gui = Command::new(std::env::current_exe().unwrap())
            .args(["lifetime::tests::gui_process_helper", "--exact", "--ignored", "--nocapture", "--test-threads=1"])
            .env(HELPER_ENV, "job")
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
                let mut f = line[i + 6..].split_whitespace().map(|x| x.parse::<u32>().unwrap());
                return (gui, out, f.next().unwrap(), f.next().unwrap());
            }
        }
    }

    // P1 acceptance on Windows: killing the GUI process ends the CLI and the
    // process it started within 3 s; a program the GUI opened for the user
    // (browser, editor) is not in the run's job and lives on.
    #[test]
    fn a_killed_gui_ends_the_cli_tree_but_not_what_it_opened() {
        let (mut gui, out, cli, opened) = gui_process();
        assert!(alive(cli) && alive(opened));
        gui.kill().unwrap();
        let _ = gui.wait();
        let ended = eof_within(out, 3);
        let opened_alive = alive(opened);
        terminate(opened);
        terminate(cli);
        assert!(ended, "the CLI tree outlived the killed GUI by more than 3 s");
        assert!(opened_alive, "a program the GUI opened died with it");
    }
}
