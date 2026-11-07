// The Results pane while a run is going (GUI-DESIGN 3 S2, replaces "No
// results yet"): the file, the phase, the progress with rate and ETA, Cancel
// and Show log. A phase that prints no progress gets an indeterminate bar
// with its step label (progress.rs) and the time elapsed.

import { useEffect, useState, type JSX } from 'react'
import type { Progress } from '../runJob'
import { baseName } from '../digestReport'
import { duration } from '../app/format'

export interface RunningPanelProps {
  input: string
  phase: string | null
  progress: Progress | null
  startedAt: number
  cancelling: boolean
  onCancel(): void
  onShowLog(): void
}

const en = (v: number): string => v.toLocaleString('en-US')

export default function RunningPanel(p: RunningPanelProps): JSX.Element {
  // The elapsed time runs on between progress events.
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])
  const { progress } = p
  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : null
  const what = p.cancelling ? 'Cancelling…' : (p.phase ?? 'Starting FASTag')
  const elapsed = p.startedAt ? duration(Date.now() - p.startedAt) : null
  const facts = [
    progress && pct != null ? `${en(progress.done)} / ${en(progress.total)}` : progress ? `${en(progress.done)} spectra` : null,
    progress?.ratePerSec != null ? `${en(Math.round(progress.ratePerSec))}/s` : null,
    progress?.etaSec != null ? `ETA ${duration(progress.etaSec * 1000)}` : null,
    elapsed ? `${elapsed} elapsed` : null
  ].filter(Boolean)
  return (
    <section className="running" aria-label="Running">
      <p className="running-what">
        <span className="mono">{baseName(p.input)}</span> — {what}
        {pct != null && ` ${pct}%`}
      </p>
      {pct != null && progress ? (
        <div
          className="bar"
          role="progressbar"
          aria-label="Run progress"
          aria-valuemin={0}
          aria-valuemax={progress.total}
          aria-valuenow={progress.done}
          aria-valuetext={`${en(progress.done)} of ${en(progress.total)} spectra`}
        >
          <div className="fill" style={{ width: `${pct}%` }} />
        </div>
      ) : (
        <div className="bar indeterminate" role="progressbar" aria-label="Run progress" aria-valuetext={what}>
          <div className="fill" />
        </div>
      )}
      <p className="running-facts muted">{facts.join(' · ')}</p>
      <div className="row-actions">
        <button type="button" className="danger small" onClick={p.onCancel} disabled={p.cancelling}>
          Cancel
        </button>
        <button type="button" className="secondary small" onClick={p.onShowLog}>
          Show log
        </button>
      </div>
    </section>
  )
}
