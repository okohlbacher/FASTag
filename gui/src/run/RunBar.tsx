// The run bar under the setup form (moved from App.tsx, P1 PR c;
// doc/GUI-WORKFLOWS.md 3): the plan line with Copy command line and Export
// INI…, what a run is doing, why it cannot start, and Run or Cancel.

import { useEffect, useState, type JSX, type ReactNode } from 'react'
import type { Progress } from '../runJob'
import { humanName, type Conflict } from '../paramLayout'
import type { ParamValue } from '../ParamField'
import { IconError } from '../icons'
import type { SpeciesFix } from '../setup/presets'
import { isMac, keyText } from '../setup/shortcuts'
import { duration } from '../app/format'

export interface RunBarProps {
  // What a screen reader hears of a run.
  announce: string
  // The app keeps the live region in its top bar, which is always shown
  // (the run bar sits in one view of four).
  announceElsewhere?: boolean
  running: boolean
  busy: boolean
  batchRunning: boolean
  cancelling: boolean
  progress: Progress | null
  phase: string | null
  // When the run in flight started (ms since the epoch).
  startedAt: number
  // Values the CLI would refuse, and combinations it refuses (rc 6).
  invalid: Record<string, string>
  refused: Conflict[]
  // One-click fixes of the species reach conflict.
  fixes: SpeciesFix[]
  onFix(values: Record<string, ParamValue>): void
  /// The Setup step that fixes a refusal (Go to Inputs, Go to Settings).
  goTo?(c: Conflict): { label: string; go(): void } | null
  input: string
  out: string
  // Batch input mode: the queue is the input, never the single file.
  batchMode?: boolean
  // The number of queued batch jobs, those not run yet and the failed ones.
  jobs: number
  remaining: number
  failedJobs: number
  binOk: boolean
  canRun: boolean
  // Run waits for the inspector: a block, or a red flag not yet answered.
  inspectorHeld?: boolean
  // ... because the checks are not known yet (--helphelp or the probe runs).
  inspectorChecking?: boolean
  onRun(): void
  onRunBatch(only?: 'failed'): void
  onCancel(): void
  /// The plan row (setup/PlanFooter.tsx): what a run does, Copy command
  /// line and Export INI…; shown while no run goes.
  plan?: ReactNode
}

export default function RunBar(p: RunBarProps): JSX.Element {
  const { running, busy, progress, invalid, refused, fixes, jobs, remaining } = p
  // Re-renders the run bar once a second, so the elapsed time runs on between
  // progress events (loading spectra and building the index print none).
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [running])

  const nInvalid = Object.keys(invalid).length
  const blocked = nInvalid > 0 || refused.length > 0
  const single = jobs === 0 && !p.batchMode
  const held = !busy && !blocked && single && !!p.input && !!p.inspectorHeld

  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : null
  const elapsed = running && p.startedAt ? ` · ${duration(Date.now() - p.startedAt)} elapsed` : ''
  // The time left at the run's weighted rate (progress.rs), once measured.
  const eta = running && progress?.etaSec != null ? ` · about ${duration(progress.etaSec * 1000)} left` : ''

  return (
    <div className="runbar">
      {/* Always in the page, so its changes are announced. */}
      {!p.announceElsewhere && (
        <p className="sr-only" role="status">
          {p.announce}
        </p>
      )}
      {running && (
        <div className="progress">
          <div className="progress-text">
            <span className="what">{p.phase ?? 'Starting FASTag'}</span>
            <span className="pct">
              {pct != null && progress
                ? `${pct}% · ${progress.done.toLocaleString('en-US')} of ${progress.total.toLocaleString('en-US')} spectra${elapsed}${eta}`
                : progress
                  ? `${progress.done.toLocaleString('en-US')} spectra${elapsed}`
                  : `starting…${elapsed}`}
            </span>
          </div>
          {pct != null && progress ? (
            <div
              className="bar"
              role="progressbar"
              aria-label="Run progress"
              aria-valuemin={0}
              aria-valuemax={progress.total}
              aria-valuenow={progress.done}
              aria-valuetext={`${progress.done.toLocaleString('en-US')} of ${progress.total.toLocaleString('en-US')} spectra`}
            >
              <div className="fill" style={{ width: `${pct}%` }} />
            </div>
          ) : (
            <div
              className="bar indeterminate"
              role="progressbar"
              aria-label="Run progress"
              aria-valuetext={progress ? `${progress.done.toLocaleString('en-US')} spectra` : 'starting'}
            >
              <div className="fill" />
            </div>
          )}
        </div>
      )}

      {!busy && blocked && (
        <div className="preflight" role="status">
          {nInvalid > 0 && (
            <p className="warn">
              <IconError />
              <span>
                {nInvalid} {nInvalid === 1 ? 'value' : 'values'} to fix before running:{' '}
                {Object.entries(invalid).map(([n, why]) => `${humanName(n)} (${why})`).join('; ')}.
              </span>
            </p>
          )}
          {refused.map((c) => {
            const to = p.goTo?.(c)
            const link = to ? (
              <>
                {' '}
                <button type="button" className="link small" onClick={to.go}>
                  {to.label}
                </button>
              </>
            ) : null
            return (
            <div key={c.params.join(',') + c.note}>
              {c.neutral ? (
                <p className="hint">
                  <span>{c.note}</span>
                  {link}
                </p>
              ) : (
                <p className="warn">
                  <IconError />
                  <span>{c.note}</span>
                  {link}
                </p>
              )}
              {c.fix && (
                <div className="row fixes">
                  <button type="button" className="small" onClick={() => p.onFix(c.fix!.values)}>
                    {c.fix.label}
                  </button>
                  {c.alt && (
                    <button type="button" className="secondary small" onClick={() => p.onFix(c.alt!.values)}>
                      {c.alt.label}
                    </button>
                  )}
                </div>
              )}
              {/* The species reach conflict: one-click fixes. */}
              {c.params.includes('species') && c.params.includes('extension') && fixes.length > 0 && (
                <div className="row fixes">
                  {fixes.map((f, i) => (
                    <button
                      key={f.label}
                      type="button"
                      className={i === 0 ? 'small' : 'secondary small'}
                      onClick={() => p.onFix(f.values)}
                      title={f.note}
                    >
                      {f.label}
                      {f.note ? ` (${f.note})` : ''}
                    </button>
                  ))}
                </div>
              )}
            </div>
            )
          })}
        </div>
      )}
      {!busy && p.plan}
      {!busy && !blocked && single && !p.input && <p className="hint">Choose an input file to run.</p>}
      {!busy && !blocked && jobs === 0 && p.batchMode && <p className="hint">Add files or a folder to run.</p>}
      {!busy && single && !!p.input && !p.out && <p className="warn" id="run-output-required">Choose a run name in Outputs before running.</p>}
      {/* No live region of its own: the checks' summary (InspectorPanel) is
          announced; Run's aria-describedby names this line. */}
      {held && p.inspectorChecking && (
        <p className="hint" id="run-held">
          Checking the input with FASTag… Run waits for the checks before the run.
        </p>
      )}
      {held && !p.inspectorChecking && (
        <p className="warn" id="run-held">
          <IconError />
          <span>Run waits for the checks before the run: fix them, or answer a red flag with Run anyway.</span>
        </p>
      )}

        <div className="row actions">
          {jobs > 0 ? (
            <>
              <button
                className="primary"
                onClick={() => p.onRunBatch()}
                disabled={p.batchRunning || running || !p.binOk || blocked || remaining === 0}
              >
                {p.batchRunning ? 'Running batch…' : `Run ${remaining} remaining ${remaining === 1 ? 'file' : 'files'}`}
              </button>
              {!busy && p.failedJobs > 0 && (
                <button className="secondary" onClick={() => p.onRunBatch('failed')} disabled={!p.binOk || blocked}>
                  Retry failed
                </button>
              )}
            </>
          ) : (
            <button
              className="primary"
              onClick={p.onRun}
              disabled={!p.canRun}
              data-run=""
              aria-describedby={[held ? 'run-held' : '', single && p.input && !p.out ? 'run-output-required' : ''].filter(Boolean).join(' ') || undefined}
              aria-keyshortcuts={isMac() ? 'Meta+Enter' : 'Control+Enter'}
              title={`Run (${keyText(isMac() ? '⏎' : 'Enter')})`}
            >
              {running ? 'Running…' : 'Run'}
            </button>
          )}
          {busy ? (
            <button
              className="secondary"
              onClick={p.onCancel}
              aria-keyshortcuts={isMac() ? 'Meta+.' : 'Control+.'}
              disabled={!running || p.cancelling}
            >
              Cancel
            </button>
          ) : null}
        </div>
    </div>
  )
}
