// The run bar under the setup form (moved from App.tsx, P1 PR c): what a
// run is doing, why it cannot start, the instrument presets and the Run,
// Cancel and Reset actions.

import { useEffect, useRef, useState, type JSX } from 'react'
import type { Progress } from '../runJob'
import { humanName, type Conflict } from '../paramLayout'
import type { ParamValue } from '../ParamField'
import { baseName } from '../digestReport'
import { IconError } from '../icons'
import { INSTRUMENTS, matchesInstrument, presetText, type SpeciesFix } from '../setup/presets'
import { isMac, keyText } from '../setup/shortcuts'
import { duration } from '../app/format'
import { focusLater } from '../app/focus'

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
  input: string
  // The number of queued batch jobs, those not run yet and the failed ones.
  jobs: number
  remaining: number
  failedJobs: number
  binOk: boolean
  canRun: boolean
  // The instrument preset last chosen, and the values it is checked against.
  instrument: string
  values: Record<string, ParamValue>
  onInstrument(id: string): void
  onRun(): void
  onRunBatch(only?: 'failed'): void
  onCancel(): void
  onReset(): void
}

export default function RunBar(p: RunBarProps): JSX.Element {
  const { running, busy, progress, invalid, refused, fixes, jobs, remaining } = p
  // Reset… asks before it throws away every parameter.
  const [resetAsk, setResetAsk] = useState(false)
  const resetRef = useRef<HTMLButtonElement>(null)
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
  const chosenInstrument = INSTRUMENTS.find((x) => x.id === p.instrument)
  // A preset stays shown only while the values are still its own.
  const shownInstrument = chosenInstrument && matchesInstrument(p.values, chosenInstrument) ? chosenInstrument.id : ''

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
          {refused.map((c) => (
            <div key={c.params.join(',')}>
              <p className="warn">
                <IconError />
                <span>{c.note}</span>
              </p>
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
          ))}
        </div>
      )}
      {!busy && !blocked && jobs === 0 && !p.input && <p className="hint">Choose an input file to run.</p>}

      {!busy && (
        <div className="instrument">
          <label htmlFor="instrument">Instrument</label>
          <select
            id="instrument"
            className="small"
            value={shownInstrument}
            onChange={(e) => p.onInstrument(e.target.value)}
            title="Sets the fragment tolerance and its unit, nothing else"
          >
            <option value="">{chosenInstrument ? 'Custom tolerance' : 'Choose a preset…'}</option>
            {INSTRUMENTS.map((x) => (
              <option key={x.id} value={x.id}>
                {presetText(x)}
              </option>
            ))}
          </select>
          {chosenInstrument && shownInstrument && !chosenInstrument.validated && (
            <span className="hint" role="note">
              {chosenInstrument.label}: not validated against the paper's benchmark.
            </span>
          )}
        </div>
      )}
      {resetAsk && !busy ? (
        <div className="confirm" role="group" aria-label="Reset parameters">
          <span>Reset every parameter to its default?</span>
          <button
            className="danger"
            onClick={() => {
              p.onReset()
              setResetAsk(false)
              focusLater(() => resetRef.current)
            }}
          >
            Reset
          </button>
          <button
            className="secondary"
            onClick={() => {
              setResetAsk(false)
              focusLater(() => resetRef.current)
            }}
            autoFocus
          >
            Keep
          </button>
        </div>
      ) : (
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
              aria-keyshortcuts={isMac() ? 'Meta+Enter' : 'Control+Enter'}
              title={`Run (${keyText(isMac() ? '⏎' : 'Enter')})`}
            >
              {running ? 'Running…' : p.input ? `Run on ${baseName(p.input)}` : 'Run'}
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
          ) : (
            <button className="secondary" ref={resetRef} onClick={() => setResetAsk(true)}>
              Reset…
            </button>
          )}
        </div>
      )}
    </div>
  )
}
