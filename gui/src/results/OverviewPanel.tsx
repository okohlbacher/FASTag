// The Overview tab (GUI-DESIGN 3 S3, D8): the landing tab after a run of
// "Characterize a run". It shows the model of overview.ts: key figures, the
// calls the CLI made, the checks, and suggested search settings with the
// evidence of each line. A tile whose report the run did not write offers
// to turn it on and run again.

import { useEffect, useRef, useState, type JSX, type MouseEvent } from 'react'
import { baseName } from '../digestReport'
import { IconChevron } from '../icons'
import type { Tab } from '../app/viewStore'
import { leadTiles, settingWords, shownTiles, type Overview, type Tile, type TileAction } from './overview'
import { TAB_LABEL, tileTarget, type TileTarget } from './tileLinks'

export interface OverviewPanelProps {
  overview: Overview
  /// The input of the run it describes.
  input: string
  /// A run is going: no action may start another.
  busy: boolean
  onAction(a: TileAction): void
  /// The form would repeat this run: its tiles may offer a change and a run
  /// again. Not for an older run or another input (their actions would run
  /// the form, not the run on screen).
  actionable?: boolean
  /// What the run was sent: only the tiles of the reports it asked for are
  /// shown (all of them without).
  params?: Record<string, unknown>
  /// The workflow the run was started from, by name.
  workflow?: string | null
  /// Its id (tasks.ts): its own tiles come first (leadTiles).
  workflowId?: string | null
  /// Reports the run was asked for and did not write, in words.
  missing?: string[]
  /// The tabs shown: a tile whose detail is in one of them opens it
  /// (tileLinks.ts). None: no tile is a link.
  tabs?: readonly Tab[]
  onOpen?(to: TileTarget): void
}

const EVIDENCE: Record<string, string> = { call: 'call', ranking: 'ranking', default: 'default', preset: 'preset', run: 'as run' }

interface TileProps {
  t: Tile
  busy: boolean
  actionable: boolean
  onAction(a: TileAction): void
  to: TileTarget | null
  onOpen?(to: TileTarget): void
}

function TileView({ t, busy, actionable, onAction, to, onOpen }: TileProps): JSX.Element {
  const open = to && onOpen ? () => onOpen(to) : null
  // A click anywhere on the tile opens it, but not one on its own button,
  // nor the end of a text selection; the heading's button is the way for
  // the keyboard and screen readers.
  function onClick(e: MouseEvent<HTMLElement>): void {
    if (!open || (e.target as HTMLElement).closest('button, a, details, summary')) return
    if (window.getSelection()?.toString()) return
    open()
  }
  return (
    <li>
      <section className={`tile tone-${t.tone}`} data-link={open ? '' : undefined} aria-label={t.label} onClick={open ? onClick : undefined}>
        <h3 className="tile-label">
          {open && to ? (
            <button type="button" className="tile-open" onClick={open} aria-label={`${t.label}: open the ${TAB_LABEL[to.tab]} tab`}>
              {t.label}
              <IconChevron size={10} />
            </button>
          ) : (
            t.label
          )}
        </h3>
        <p className={`tile-value${t.muted ? ' muted' : ''}`} title={t.muted}>
          {t.value}
        </p>
        {/* Two lines at most; the whole note is its tooltip. */}
        <p className="tile-note" title={t.note}>
          {t.note}
        </p>
        {t.action && actionable && (
          <button type="button" className="secondary small" disabled={busy} onClick={() => onAction(t.action!)}>
            {t.action.label}
          </button>
        )}
      </section>
    </li>
  )
}

export default function OverviewPanel({ overview: o, input, busy, onAction, actionable = true, params, workflow, workflowId, missing = [], tabs = [], onOpen }: OverviewPanelProps): JSX.Element {
  const [copied, setCopied] = useState<'yes' | 'no' | null>(null)
  const revision = useRef(0)
  useEffect(() => {
    setCopied(null)
    return () => { revision.current++ }
  }, [input, o.copyText])
  const shown = params ? shownTiles(o, params) : { figures: o.figures, calls: o.calls }
  const tiles = leadTiles(shown, workflowId)
  async function copy(): Promise<void> {
    const started = revision.current
    try {
      await navigator.clipboard.writeText(o.copyText)
      if (revision.current === started) setCopied('yes')
    } catch {
      if (revision.current === started) setCopied('no')
    }
  }
  return (
    <div className="overview">
      <h2>
        Overview of <span className="mono">{baseName(input)}</span>
      </h2>
      {missing.length > 0 && (
        <p className="caveat" role="status">
          Asked for, but not written: {missing.join(', ')}. The log says why.
        </p>
      )}
      {o.warning && (
        <ul className="checks" aria-label="Warning">
          <li className="flag">{o.warning}</li>
        </ul>
      )}
      {/* The workflow's own result on a row of its own, the run's facts
          below it: a call never shares a row with a count. */}
      {!!tiles.lead && (
        <>
          <p className="tiles-head">Main result</p>
          <ul className="tiles" aria-label="Main result">
            {tiles.figures.slice(0, tiles.lead).map((t) => (
              <TileView key={t.id} t={t} busy={busy} actionable={actionable} onAction={onAction} to={tileTarget(t, tabs)} onOpen={onOpen} />
            ))}
          </ul>
          <p className="tiles-head">Run</p>
        </>
      )}
      <ul className="tiles" aria-label="Key figures">
        {tiles.figures.slice(tiles.lead ?? 0).map((t) => (
          <TileView key={t.id} t={t} busy={busy} actionable={actionable} onAction={onAction} to={tileTarget(t, tabs)} onOpen={onOpen} />
        ))}
      </ul>
      {tiles.calls.length > 0 && (
      <ul className="tiles" aria-label="Calls">
        {tiles.calls.map((t) => (
          <TileView key={t.id} t={t} busy={busy} actionable={actionable} onAction={onAction} to={tileTarget(t, tabs)} onOpen={onOpen} />
        ))}
      </ul>
      )}
      <ul className="checks" aria-label="Checks">
        {/* The evidence cutoff only next to a call it gates. */}
        {o.checks
          // Decided on the calls before the workflow's own lead the grid
          // (leadTiles moves Top genus among the figures).
          .filter((c) => !c.gates || shown.calls.some((t) => t.tone === 'call' || t.tone === 'nocall' || t.tone === 'low'))
          .map((c) => (
            <li key={c.text} className={c.tone}>
              {c.text}
              {c.detail && (
                <details className="check-detail">
                  <summary>Why</summary>
                  {c.detail}
                </details>
              )}
            </li>
          ))}
      </ul>
      {/* Only when a row comes from a measured call: defaults alone say nothing about this run. */}
      {o.measured && (
      <section className="suggested" aria-labelledby="suggested-h">
        <div className="suggested-head">
          <h3 id="suggested-h">Suggested search settings*</h3>
          <button type="button" className="secondary small" onClick={() => void copy()} aria-label="Copy suggested settings">
            Copy
          </button>
          {copied === 'yes' && <span className="muted">Copied.</span>}
          {copied === 'no' && <span className="muted">The clipboard refused the text.</span>}
        </div>
        <table aria-label="Suggested search settings">
          <tbody>
            {o.suggestions.map((s) => (
              <tr key={s.setting}>
                <th scope="row">{settingWords(s.setting)}</th>
                <td className="mono">{s.value}</td>
                {/* survey-3: the note wraps (tables keep cells on one line). */}
                <td className="sug-note" style={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
                  <span className={`evidence ev-${s.evidence}`}>{EVIDENCE[s.evidence]}</span> {s.note}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="caveat muted">* {o.caveats.join(' ')}</p>
      </section>
      )}
    </div>
  )
}
