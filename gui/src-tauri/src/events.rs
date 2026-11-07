// The events of a run, as they reach the renderer over the run's own
// Channel (GUI-DESIGN 6.2, P1), and the batching that keeps their number
// small.
//
// On WKWebView and WebKitGTK every Channel send is its own IPC delivery, so
// one send per log line flooded the main thread before React could batch
// anything. The reader threads therefore only push into a buffer here, and
// one sender thread flushes it every FLUSH_INTERVAL (or at once at
// MAX_BATCH lines) as one Log{lines} message, followed by the latest phase
// and the latest progress of that interval. Done is the last message a
// run's Channel carries: anything pushed after it is dropped.

use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::outputs::Cleanup;
use crate::progress::{Progress, Tracker};

/// How a run ended (the Done event; RunResult in types.ts).
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RunResult {
    pub ok: bool,
    pub code: Option<i32>,
    pub message: Option<String>,
    pub cancelled: bool,
    pub cleanup: Cleanup,
}

/// One message on a run's Channel. serde tag "kind" (RunEvent in types.ts).
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum RunEvent {
    /// Log lines in the order the CLI wrote them: (text, from stderr).
    Log { lines: Vec<(String, bool)> },
    /// The latest progress of a flush interval.
    Progress { done: u64, total: u64, rate_per_sec: Option<f64>, eta_sec: Option<f64> },
    /// The phase the run entered (progress.rs).
    Phase { label: String },
    /// The last message of the run.
    Done(RunResult),
}

impl From<&Progress> for RunEvent {
    fn from(p: &Progress) -> Self {
        RunEvent::Progress { done: p.done, total: p.total, rate_per_sec: p.rate_per_sec, eta_sec: p.eta_sec }
    }
}

/// Where a run's events go: the run's Channel (or a test's collector).
pub type Sink = Arc<dyn Fn(RunEvent) + Send + Sync>;

/// A flush every 75 ms at most (the design allows 50-100 ms) ...
pub const FLUSH_INTERVAL: Duration = Duration::from_millis(75);
/// ... or at once when this many lines are waiting.
pub const MAX_BATCH: usize = 500;

const PROGRESS_PREFIX: &str = "FASTAG_PROGRESS ";

/// done and total of a `FASTAG_PROGRESS done=<n> total=<n>` line.
pub fn parse_progress_line(line: &str) -> Option<(u64, u64)> {
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

#[derive(Default)]
struct Pending {
    lines: Vec<(String, bool)>,
    tracker: Tracker,
    // Changed since the last flush.
    phase_changed: bool,
    progress_changed: bool,
    done: Option<RunResult>,
    // Done was sent: the sender has ended, nothing more is taken.
    closed: bool,
}

/// The buffer between a run's reader threads and its Channel.
pub struct Batcher {
    shared: Arc<(Mutex<Pending>, Condvar)>,
}

impl Batcher {
    /// Start the sender thread that flushes into @p sink every @p interval.
    pub fn start(sink: Sink, interval: Duration) -> Batcher {
        let shared = Arc::new((Mutex::new(Pending::default()), Condvar::new()));
        let s = shared.clone();
        std::thread::spawn(move || send_loop(&s, &sink, interval));
        Batcher { shared }
    }

    fn with<R>(&self, f: impl FnOnce(&mut Pending) -> R) -> Option<R> {
        let (m, cv) = &*self.shared;
        let mut g = m.lock().unwrap_or_else(|e| e.into_inner());
        if g.closed || g.done.is_some() {
            return None;
        }
        let r = f(&mut g);
        cv.notify_one();
        Some(r)
    }

    /// One line the CLI wrote, on stderr (@p stderr) or stdout. A progress
    /// line on stderr updates the progress instead of the log.
    pub fn line(&self, text: String, stderr: bool) {
        let progress = if stderr { parse_progress_line(&text) } else { None };
        let now = Instant::now();
        self.with(|p| {
            if let Some((done, total)) = progress {
                if p.tracker.progress_at(done, total, now).is_some() {
                    p.phase_changed = true;
                }
                p.progress_changed = true;
            } else {
                if p.tracker.line(&text).is_some() {
                    p.phase_changed = true;
                }
                p.lines.push((text, stderr));
            }
        });
    }

    /// The run has ended: flush what is left, then send @p r as Done, the
    /// last message. Later calls are ignored.
    pub fn finish(&self, r: RunResult) {
        self.with(|p| p.done = Some(r));
    }
}

/// The pending lines (MAX_BATCH per message), phase and progress as
/// messages, in that order. Returns Done when the run has ended.
fn take(p: &mut Pending) -> (Vec<RunEvent>, Option<RunResult>) {
    let mut out = Vec::new();
    // Lines that piled up while the last flush was being sent go out as
    // several messages of at most MAX_BATCH lines, so none is unbounded.
    let mut lines = std::mem::take(&mut p.lines).into_iter().peekable();
    while lines.peek().is_some() {
        out.push(RunEvent::Log { lines: lines.by_ref().take(MAX_BATCH).collect() });
    }
    if std::mem::take(&mut p.phase_changed) {
        out.push(RunEvent::Phase { label: p.tracker.phase().to_string() });
    }
    if std::mem::take(&mut p.progress_changed) {
        if let Some(pr) = p.tracker.progress() {
            out.push(pr.into());
        }
    }
    let done = p.done.take();
    if done.is_some() {
        p.closed = true;
    }
    (out, done)
}

fn has_news(p: &Pending) -> bool {
    !p.lines.is_empty() || p.phase_changed || p.progress_changed || p.done.is_some()
}

fn send_loop(shared: &(Mutex<Pending>, Condvar), sink: &Sink, interval: Duration) {
    let (m, cv) = shared;
    // The first news of a quiet run goes out at once.
    let mut last = Instant::now() - interval;
    loop {
        let (events, done) = {
            let mut g = m.lock().unwrap_or_else(|e| e.into_inner());
            while !has_news(&g) {
                g = cv.wait(g).unwrap_or_else(|e| e.into_inner());
            }
            // Gather until the interval is up, the batch is full, or the run ended.
            loop {
                let wait = (last + interval).saturating_duration_since(Instant::now());
                if wait.is_zero() || g.lines.len() >= MAX_BATCH || g.done.is_some() {
                    break;
                }
                g = cv.wait_timeout(g, wait).unwrap_or_else(|e| e.into_inner()).0;
            }
            take(&mut g)
        };
        last = Instant::now();
        for e in events {
            sink(e);
        }
        if let Some(r) = done {
            sink(RunEvent::Done(r));
            return;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    fn collector() -> (Sink, mpsc::Receiver<(Instant, RunEvent)>) {
        let (tx, rx) = mpsc::channel();
        let tx = Mutex::new(tx);
        (Arc::new(move |e| { let _ = tx.lock().unwrap().send((Instant::now(), e)); }), rx)
    }

    fn ok() -> RunResult {
        RunResult { ok: true, code: Some(0), message: None, cancelled: false, cleanup: Cleanup::default() }
    }

    /// Every event until Done (included).
    fn until_done(rx: &mpsc::Receiver<(Instant, RunEvent)>) -> Vec<RunEvent> {
        let mut v = Vec::new();
        loop {
            let (_, e) = rx.recv_timeout(Duration::from_secs(5)).expect("no Done");
            let end = matches!(e, RunEvent::Done(_));
            v.push(e);
            if end {
                return v;
            }
        }
    }

    #[test]
    fn the_wire_format_is_tagged_by_kind() {
        let log = RunEvent::Log { lines: vec![("a".into(), true), ("b".into(), false)] };
        assert_eq!(serde_json::to_value(&log).unwrap(), serde_json::json!({"kind": "log", "lines": [["a", true], ["b", false]]}));
        let p = RunEvent::Progress { done: 1, total: 2, rate_per_sec: Some(3.5), eta_sec: None };
        assert_eq!(
            serde_json::to_value(&p).unwrap(),
            serde_json::json!({"kind": "progress", "done": 1, "total": 2, "ratePerSec": 3.5, "etaSec": null})
        );
        let ph = RunEvent::Phase { label: "Reading spectra".into() };
        assert_eq!(serde_json::to_value(&ph).unwrap(), serde_json::json!({"kind": "phase", "label": "Reading spectra"}));
        assert_eq!(
            serde_json::to_value(RunEvent::Done(ok())).unwrap(),
            serde_json::json!({"kind": "done", "ok": true, "code": 0, "message": null, "cancelled": false,
                               "cleanup": {"removed": [], "renamed": [], "failed": []}})
        );
    }

    #[test]
    fn a_burst_of_lines_becomes_one_message_and_progress_is_coalesced() {
        let (sink, rx) = collector();
        let b = Batcher::start(sink, Duration::from_millis(200));
        // The first line of a quiet run goes out at once ...
        b.line("-threads 0: using 8 of 16 logical cores.".into(), true);
        let (_, first) = rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(first, RunEvent::Log { lines: vec![("-threads 0: using 8 of 16 logical cores.".into(), true)] });
        // ... and the next ones wait for the interval, in one message.
        for i in 0..300 {
            b.line(format!("line {i}"), i % 2 == 0);
            b.line(format!("FASTAG_PROGRESS done={i} total=1000"), true);
        }
        b.finish(ok());
        let ev = until_done(&rx);
        let logs: Vec<&RunEvent> = ev.iter().filter(|e| matches!(e, RunEvent::Log { .. })).collect();
        assert_eq!(logs.len(), 1, "{ev:?}");
        let RunEvent::Log { lines } = logs[0] else { unreachable!() };
        assert_eq!(lines.len(), 300);
        assert_eq!(lines[7], ("line 7".to_string(), false));
        let progress: Vec<&RunEvent> = ev.iter().filter(|e| matches!(e, RunEvent::Progress { .. })).collect();
        assert_eq!(progress.len(), 1, "progress coalesced to the latest: {ev:?}");
        assert!(matches!(progress[0], RunEvent::Progress { done: 299, total: 1000, .. }));
        let phases: Vec<&RunEvent> = ev.iter().filter(|e| matches!(e, RunEvent::Phase { .. })).collect();
        // The phase the first line started, then the one the progress started.
        assert_eq!(
            phases,
            vec![
                &RunEvent::Phase { label: crate::progress::READING.into() },
                &RunEvent::Phase { label: crate::progress::TAGGING.into() }
            ]
        );
        assert!(matches!(ev.last(), Some(RunEvent::Done(_))));
    }

    #[test]
    fn a_full_batch_goes_out_before_the_interval() {
        let (sink, rx) = collector();
        let b = Batcher::start(sink, Duration::from_secs(30));
        b.line("first".into(), false);
        let _ = rx.recv_timeout(Duration::from_secs(5)).unwrap();
        let t0 = Instant::now();
        for i in 0..MAX_BATCH {
            b.line(format!("l{i}"), false);
        }
        let (at, e) = rx.recv_timeout(Duration::from_secs(5)).expect("a full batch waited for the interval");
        assert!(at - t0 < Duration::from_secs(5));
        let RunEvent::Log { lines } = e else { panic!("{e:?}") };
        assert_eq!(lines.len(), MAX_BATCH);
        b.finish(ok());
        assert!(matches!(until_done(&rx).last(), Some(RunEvent::Done(_))));
    }

    #[test]
    fn done_is_last_and_nothing_follows_it() {
        let (sink, rx) = collector();
        let b = Batcher::start(sink, Duration::from_millis(50));
        b.line("Reading".into(), true);
        b.line("FASTAG_PROGRESS done=1 total=4".into(), true);
        b.finish(ok());
        // A reader that is still running after the end.
        b.line("late".into(), false);
        b.line("FASTAG_PROGRESS done=2 total=4".into(), true);
        b.finish(RunResult { ok: false, ..ok() });
        let ev = until_done(&rx);
        assert_eq!(ev.last(), Some(&RunEvent::Done(ok())));
        assert!(!ev.iter().any(|e| matches!(e, RunEvent::Log { lines } if lines.iter().any(|l| l.0 == "late"))));
        assert!(rx.recv_timeout(Duration::from_millis(300)).is_err(), "an event after Done");
    }

    #[test]
    fn progress_lines_on_stdout_are_log() {
        let (sink, rx) = collector();
        let b = Batcher::start(sink, Duration::from_millis(10));
        b.line("FASTAG_PROGRESS done=1 total=4".into(), false);
        b.finish(ok());
        let ev = until_done(&rx);
        assert_eq!(ev[0], RunEvent::Log { lines: vec![("FASTAG_PROGRESS done=1 total=4".into(), false)] });
        assert!(!ev.iter().any(|e| matches!(e, RunEvent::Progress { .. })));
    }
}
