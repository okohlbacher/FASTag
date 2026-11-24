// The run bar: the action bar of Setup steps 2-4 and of Batch (moved from
// App.tsx, P1 PR c; doc/GUI-WORKFLOWS.md 3, doc/GUI-SETUP-WIZARD.md 1): at
// the left what is missing and the plan line with Copy command line and
// Export INI…; at the right ‹ Back, Run, and the step's Next. One button is
// filled: Next while the wizard has a next step, else Run.

import { useEffect, useState, type JSX, type ReactNode } from 'react'
import type { Progress } from '../runJob'
import { humanName, type Conflict } from '../paramLayout'
import type { ParamValue } from '../ParamField'
import { IconError } from '../icons'
import type { SpeciesFix } from '../setup/presets'
import { isMac, keyText } from '../setup/shortcuts'
import { duration } from '../app/format'

/// The wizard's part of the action bar (Setup).
export interface ActionNav {
  /// At the left: "Still missing: …", or what is chosen.
  status?: ReactNode
  back?(): void
  /// The step's filled button (Next: …); Run is then secondary.
  next?: { label: string; onClick(): void }
}

/// The action bar of Setup while the Batch view holds the queue: Back, Next
/// and, in Run's slot, the queue's run (App.tsx).
/// What blocks the queue (Preflight) shows above, the plan beside the
/// status, as in the run bar.
export function NavBar({ nav, run, preflight, plan }: { nav: ActionNav; run?: ReactNode; preflight?: ReactNode; plan?: ReactNode }): JSX.Element {
  return (
    <div className="actionbar">
      <div className="actionbar-col page-col">
        {preflight}
        <div className="actionbar-row">
          <div className="actionbar-lead">
            {nav.status}
            {plan}
          </div>
          <div className="actionbar-nav">
            <NavButtons nav={nav} run={run} />
          </div>
        </div>
      </div>
    </div>
  )
}

function NavButtons({ nav, run }: { nav: ActionNav; run?: ReactNode }): JSX.Element {
  return (
    <>
      {nav.back && (
        <button type="button" className="ghost back" onClick={nav.back}>
          ‹ Back
        </button>
      )}
      {run}
      {nav.next && (
        <button type="button" className="primary next" onClick={nav.next.onClick}>
          {nav.next.label}
        </button>
      )}
    </>
  )
}

/// What blocks a run, and the way to each fix (Go to Inputs, Go to
/// Settings, one-click fixes): the run bar's, and the Setup footer's beside
/// the queue's Run while the Batch view holds the queue (App.tsx).
export function Preflight({
  invalid,
  refused,
  fixes,
  onFix,
  goTo,
  id
}: {
  invalid: Record<string, string>
  refused: Conflict[]
  fixes: SpeciesFix[]
  onFix(values: Record<string, ParamValue>): void
  goTo?(c: Conflict): { label: string; go(): void } | null
  id?: string
}): JSX.Element {
  const nInvalid = Object.keys(invalid).length
  return (
        <div className="preflight" role="status" id={id}>
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
            const to = goTo?.(c)
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
                  <button type="button" className="small" onClick={() => onFix(c.fix!.values)}>
                    {c.fix.label}
                  </button>
                  {c.alt && (
                    <button type="button" className="secondary small" onClick={() => onFix(c.alt!.values)}>
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
                      onClick={() => onFix(f.values)}
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
  )
}

export interface RunBarProps {
  // What a screen reader hears of a run.
  announce: string
  // The app keeps the live region in its top bar, which is always shown
  // (the run bar sits in one view of four).
  announceElsewhere?: boolean
  running: boolean
  busy: boolean
  batchRunning: boolean
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
  // ... of which this many are blocks, which no Run anyway overrides.
  inspectorBlocks?: number
  /// The Setup step shown (the checks and their Run anyway are on step 2).
  step?: number
  /// Show the checks: Inputs, focus on the first held check.
  onReviewChecks?(): void
  onRun(): void
  onRunBatch(only?: 'failed'): void
  /// The plan row (setup/PlanFooter.tsx): what a run does, Copy command
  /// line and Export INI…; shown while no run goes.
  plan?: ReactNode
  /// Setup: the still-missing status, Back and Next.
  nav?: ActionNav
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

  const nav = p.nav ?? {}
  // Run is the filled button unless the wizard offers a next step, or a run
  // goes (an inert Running… is not the screen's action; the pill's Cancel
  // is).
  const runClass = nav.next || busy ? 'run-btn' : 'primary run-btn'
  // After a batch whose failed jobs are all that is left, Retry failed is
  // the one action: it takes the filled slot, and no inert Run 0 is shown.
  const retryOnly = !busy && remaining === 0 && p.failedJobs > 0
  const runButtons =
    jobs > 0 ? (
      retryOnly ? (
        <button className={runClass} onClick={() => p.onRunBatch('failed')} disabled={!p.binOk || blocked}>
          Retry failed
        </button>
      ) : (
        <>
          {!busy && p.failedJobs > 0 && (
            <button className="secondary" onClick={() => p.onRunBatch('failed')} disabled={!p.binOk || blocked}>
              Retry failed
            </button>
          )}
          <button
            className={runClass}
            onClick={() => p.onRunBatch()}
            disabled={p.batchRunning || running || !p.binOk || blocked || remaining === 0}
          >
            {p.batchRunning ? 'Running batch…' : remaining === 0 ? 'All files run' : `Run ${remaining} remaining ${remaining === 1 ? 'file' : 'files'}`}
          </button>
        </>
      )
    ) : (
      <button
        className={runClass}
        onClick={p.onRun}
        disabled={!p.canRun}
        data-run=""
        aria-describedby={[held ? 'run-held' : '', single && p.input && !p.out ? 'run-output-required' : ''].filter(Boolean).join(' ') || undefined}
        aria-keyshortcuts={isMac() ? 'Meta+Enter' : 'Control+Enter'}
        title={`Run (${keyText(isMac() ? '⏎' : 'Enter')})`}
      >
        {running ? 'Running…' : 'Run'}
      </button>
    )

  return (
    <div className="runbar actionbar">
      <div className="actionbar-col page-col">
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

      {!busy && blocked && <Preflight invalid={invalid} refused={refused} fixes={fixes} onFix={p.onFix} goTo={p.goTo} />}
      {/* What is missing shows once, at the left of the bar (Setup); the
          Batch view has no wizard, so it says it here. */}
      {!busy && !blocked && !nav.status && single && !p.input && <p className="hint">Choose an input file to run.</p>}
      {!busy && !blocked && !nav.status && jobs === 0 && p.batchMode && <p className="hint">Add files or a folder to run.</p>}
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
          <span>
            {(p.inspectorBlocks ?? 0) > 0
              ? 'Run waits for the checks before the run: an input check blocks the run; fix the file or settings it names.'
              : 'Run waits for the checks before the run: fix them, or choose Run anyway beside each red flag in Inputs.'}
          </span>
          {/* The checks are on Inputs: a way there from Settings and Outputs. */}
          {p.onReviewChecks && p.step !== 2 && (
            <>
              {' '}
              <button type="button" className="link small" onClick={p.onReviewChecks}>
                Review input checks
              </button>
            </>
          )}
        </p>
      )}

      {/* Two groups: what is missing and the plan at the left, the buttons
          at the right. When both no longer fit in one row, the left group
          takes its own row above, so the buttons never move or overlap. */}
      <div className="row actions actionbar-row">
        <div className="actionbar-lead">
          {!busy && nav.status}
          {!busy && p.plan}
        </div>
        <div className="actionbar-nav">
        {/* No Cancel here: the run status pill in the app bar holds the
            run's one Cancel on every view. */}
        <NavButtons nav={busy ? {} : nav} run={runButtons} />
        </div>
      </div>
      </div>
    </div>
  )
}
