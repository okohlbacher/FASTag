// What a run is doing, read off the CLI's output (GUI-DESIGN 6.6, P1): the
// phase it is in and, while it tags spectra, its rate and the time left.
//
// The CLI prints few lines, and only one kind is meant for machines
// (FASTAG_PROGRESS done=<n> total=<n>, FASTag.cpp -progress). The phases
// are taken from the lines it prints anyway, pinned by captured output in
// tests/fixtures/stderr. Its tagging progress stops short of 100 %: the
// line with done == total comes once everything is written (FASTag.cpp
// "Completion"), so that line means finished, not "all spectra tagged".

use std::time::Instant;

/// A phase label, as the run bar shows it.
pub const STARTING: &str = "Starting FASTag";
pub const READING: &str = "Reading spectra";
pub const FILTER: &str = "Building the FASTA filter";
pub const RECON: &str = "Building the recon index";
pub const TAGGING: &str = "Tagging spectra";
pub const REPORTS: &str = "Writing reports";
pub const FINISHING: &str = "Finishing";
pub const FINISHED: &str = "Finished";

/// The phase a log line starts, if any.
pub fn phase_of_line(line: &str) -> Option<&'static str> {
    // "-threads 0: using 8 of 16 logical cores." is the first line of every
    // run that got past its parameters; the spectra are read next.
    if line.starts_with("-threads ") && line.contains(": using ") {
        return Some(READING);
    }
    if line.starts_with("Filter index:") || line.starts_with("Filter: ") {
        return Some(FILTER);
    }
    if line.starts_with("Recon index:") {
        return Some(RECON);
    }
    const REPORT_LINES: [&str; 9] = [
        "Digest: ",
        "Labels: ",
        "Species: ",
        "Glyco: ",
        "Mass gaps: ",
        "Delta histogram: ",
        "Recon identifications: ",
        "q_db",
        "Entrapment len ",
    ];
    if REPORT_LINES.iter().any(|p| line.starts_with(p)) {
        return Some(REPORTS);
    }
    // "139 MS2 spectra, 2028 tags[ -> 5 after filtering]": the summary.
    if let Some((n, rest)) = line.split_once(' ') {
        if !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()) && rest.starts_with("MS2 spectra, ") {
            return Some(FINISHING);
        }
    }
    None
}

/// Progress as the run bar shows it.
#[derive(Debug, Clone, PartialEq)]
pub struct Progress {
    pub done: u64,
    pub total: u64,
    /// Spectra per second, exponentially weighted; None until measured.
    pub rate_per_sec: Option<f64>,
    /// Seconds left at that rate; None until measured or when finished.
    pub eta_sec: Option<f64>,
}

/// The weight of the newest rate sample.
const ALPHA: f64 = 0.3;
/// Rate samples shorter than this are merged with the next one: progress
/// lines can come microseconds apart, and a rate over a microsecond is noise.
const MIN_SAMPLE_SECS: f64 = 0.25;

/// The phase and progress of one run.
pub struct Tracker {
    phase: &'static str,
    progress: Option<Progress>,
    // The start of the open rate sample: when, and at which done.
    sample: Option<(Instant, u64)>,
}

impl Default for Tracker {
    fn default() -> Self {
        Tracker { phase: STARTING, progress: None, sample: None }
    }
}

impl Tracker {
    pub fn phase(&self) -> &'static str {
        self.phase
    }

    pub fn progress(&self) -> Option<&Progress> {
        self.progress.as_ref()
    }

    /// A log line. Returns the new phase when the line changes it.
    pub fn line(&mut self, line: &str) -> Option<&'static str> {
        let p = phase_of_line(line)?;
        self.set_phase(p)
    }

    fn set_phase(&mut self, p: &'static str) -> Option<&'static str> {
        // Nothing comes after finished.
        if p == self.phase || self.phase == FINISHED {
            return None;
        }
        self.phase = p;
        Some(p)
    }

    /// A FASTAG_PROGRESS line at @p now. Returns the new phase when it changes
    /// it: the first tagging progress starts Tagging, done == total ends the run.
    pub fn progress_at(&mut self, done: u64, total: u64, now: Instant) -> Option<&'static str> {
        let finished = total > 0 && done >= total;
        let mut rate = self.progress.as_ref().and_then(|p| p.rate_per_sec);
        match self.sample {
            Some((t0, d0)) if !finished => {
                let secs = now.saturating_duration_since(t0).as_secs_f64();
                if secs >= MIN_SAMPLE_SECS && done >= d0 {
                    let r = (done - d0) as f64 / secs;
                    rate = Some(match rate {
                        Some(old) => ALPHA * r + (1.0 - ALPHA) * old,
                        None => r,
                    });
                    self.sample = Some((now, done));
                }
            }
            _ => self.sample = Some((now, done)),
        }
        let eta = match rate {
            Some(r) if r > 0.0 && !finished => Some(total.saturating_sub(done) as f64 / r),
            _ => None,
        };
        self.progress = Some(Progress { done, total, rate_per_sec: rate, eta_sec: eta });
        if finished {
            return self.set_phase(FINISHED);
        }
        // Tagging starts with the first progress line; a report line later on
        // does not send it back.
        if matches!(self.phase, STARTING | READING | FILTER | RECON) {
            return self.set_phase(TAGGING);
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    const FIXTURES: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/stderr");

    /// The phases a captured run goes through, in order, as the tracker reports them.
    fn phases_of(name: &str) -> Vec<&'static str> {
        let text = std::fs::read_to_string(format!("{FIXTURES}/{name}")).unwrap();
        let mut t = Tracker::default();
        let mut seen = vec![t.phase()];
        let t0 = Instant::now();
        for (i, line) in text.lines().enumerate() {
            let changed = match crate::events::parse_progress_line(line) {
                Some((d, n)) => t.progress_at(d, n, t0 + Duration::from_millis(10 * i as u64)),
                None => t.line(line),
            };
            if let Some(p) = changed {
                seen.push(p);
            }
        }
        seen
    }

    #[test]
    fn a_plain_run_reads_tags_and_finishes() {
        assert_eq!(phases_of("ecoli-plain.txt"), vec![STARTING, READING, TAGGING, FINISHING, FINISHED]);
    }

    #[test]
    fn a_filtered_run_with_reports_names_each_phase() {
        assert_eq!(
            phases_of("ecoli-filter-reports.txt"),
            vec![STARTING, READING, FILTER, TAGGING, REPORTS, FINISHING, FINISHED]
        );
    }

    #[test]
    fn a_recon_run_builds_its_index_first() {
        assert_eq!(
            phases_of("ecoli-recon-glyco-spectra.txt"),
            vec![STARTING, READING, RECON, TAGGING, REPORTS, FINISHING, FINISHED]
        );
    }

    #[test]
    fn a_run_that_cannot_read_its_input_never_starts_tagging() {
        assert_eq!(phases_of("missing-input.txt"), vec![STARTING, READING]);
    }

    #[test]
    fn eta_follows_a_weighted_rate() {
        let mut t = Tracker::default();
        let t0 = Instant::now();
        let at = |ms: u64| t0 + Duration::from_millis(ms);
        assert_eq!(t.progress_at(1, 1000, at(0)), Some(TAGGING));
        assert_eq!(t.progress().unwrap().rate_per_sec, None, "one point is no rate");
        // 100 spectra in 1 s: 100/s, 899 left -> 8.99 s.
        t.progress_at(101, 1000, at(1000));
        let p = t.progress().unwrap().clone();
        assert_eq!(p.rate_per_sec, Some(100.0));
        assert!((p.eta_sec.unwrap() - 8.99).abs() < 1e-9, "{p:?}");
        // A burst 1 ms later is not a sample of its own.
        t.progress_at(111, 1000, at(1001));
        assert_eq!(t.progress().unwrap().rate_per_sec, Some(100.0));
        // 400 more in the next second: 0.3 * 400 + 0.7 * 100 = 190/s (from 101).
        t.progress_at(501, 1000, at(2000));
        let p = t.progress().unwrap().clone();
        assert!((p.rate_per_sec.unwrap() - 190.0).abs() < 1e-9, "{p:?}");
        assert!((p.eta_sec.unwrap() - 499.0 / 190.0).abs() < 1e-9);
        // done == total: finished, no time left to show.
        assert_eq!(t.progress_at(1000, 1000, at(2500)), Some(FINISHED));
        assert_eq!(t.progress().unwrap().eta_sec, None);
        // Nothing comes after finished.
        assert_eq!(t.line("Digest: 0 filtered tags -> d.tsv"), None);
        assert_eq!(t.phase(), FINISHED);
    }

    #[test]
    fn a_report_line_does_not_restart_tagging() {
        let mut t = Tracker::default();
        let now = Instant::now();
        t.progress_at(5, 10, now);
        assert_eq!(t.line("Glyco: 0 of 10 processed MS2 spectra carry oxonium evidence -> g.tsv"), Some(REPORTS));
        assert_eq!(t.progress_at(6, 10, now), None);
        assert_eq!(t.phase(), REPORTS);
        // A line repeating the phase changes nothing.
        assert_eq!(t.line("Labels: 0 filtered tags -> l.tsv"), None);
        assert_eq!(phase_of_line("12 MS2 spectra, 3 tags"), Some(FINISHING));
        assert_eq!(phase_of_line("MS2 spectra, 3 tags"), None);
        assert_eq!(phase_of_line("No two peaks anywhere in this file are closer than 0.6 Th"), None);
    }
}
