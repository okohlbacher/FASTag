// The Overview tab (GUI-DESIGN 3 S3, D8): the landing tab after a run of
// "Characterize a run". It shows the model of overview.ts: key figures, the
// calls the CLI made, the checks, and suggested search settings with the
// evidence of each line. A tile whose report the run did not write offers
// to turn it on and run again.

import { useEffect, useRef, useState, type JSX } from 'react'
import { baseName } from '../digestReport'
import type { Overview, Tile, TileAction } from './overview'
import { HelpLink } from '../help/HelpLink'

export interface OverviewPanelProps {
  overview: Overview
  /// The input of the run it describes.
  input: string
  /// A run is going: no action may start another.
  busy: boolean
  onAction(a: TileAction): void
}

const EVIDENCE: Record<string, string> = { call: 'call', ranking: 'ranking', default: 'default', preset: 'preset', run: 'as run' }

function TileView({ t, busy, onAction }: { t: Tile; busy: boolean; onAction(a: TileAction): void }): JSX.Element {
  return (
    <li>
      <section className={`tile tone-${t.tone}`} aria-label={t.label}>
        <h3 className="tile-label">{t.label}</h3>
        <p className="tile-value">{t.value}</p>
        <p className="tile-note">{t.note}</p>
        {t.action && (
          <button type="button" className="secondary small" disabled={busy} onClick={() => onAction(t.action!)}>
            {t.action.label}
          </button>
        )}
      </section>
    </li>
  )
}

export default function OverviewPanel({ overview: o, input, busy, onAction }: OverviewPanelProps): JSX.Element {
  const [copied, setCopied] = useState<'yes' | 'no' | null>(null)
  const revision = useRef(0)
  useEffect(() => {
    setCopied(null)
    return () => { revision.current++ }
  }, [input, o.copyText])
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
      <p><HelpLink to="workflow-overview">How to read this overview</HelpLink></p>
      <ul className="tiles" aria-label="Key figures">
        {o.figures.map((t) => (
          <TileView key={t.id} t={t} busy={busy} onAction={onAction} />
        ))}
      </ul>
      <ul className="tiles" aria-label="Calls">
        {o.calls.map((t) => (
          <TileView key={t.id} t={t} busy={busy} onAction={onAction} />
        ))}
      </ul>
      <ul className="checks" aria-label="Checks">
        {o.checks.map((c) => (
          <li key={c.text} className={c.tone}>
            {c.text}
          </li>
        ))}
      </ul>
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
                <th scope="row">{s.setting}</th>
                <td className="mono">{s.value}</td>
                <td>
                  <span className={`evidence ev-${s.evidence}`}>{EVIDENCE[s.evidence]}</span> {s.note}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="caveat muted">* {o.caveats.join(' ')}</p>
      </section>
    </div>
  )
}
