// The Glyco tab (GUI-DESIGN S8): the -glyco_out table, one row per
// processed MS2 spectrum with its oxonium ions, the summed oxonium fraction
// and the CLI's flag, and how often each ion occurs among the flagged
// spectra. Oxonium ions are evidence of a glycan, not an identification.

import { useMemo, useState, type JSX } from 'react'
import { baseName, fmt, pct } from '../digestReport'
import DataTable, { type Column } from './DataTable'
import type { GlycoTable as Glyco } from './tables'
import { useTable } from './useTable'
import './viewers.css'

export interface GlycoTableProps {
  path: string
  /// The run's -glyco_min_fraction, when it was sent one.
  minFraction?: number | null
}

export default function GlycoTable({ path, minFraction }: GlycoTableProps): JSX.Element {
  const st = useTable(path, 'glyco')
  if (st.error)
    return (
      <p className="warn" role="alert">
        {st.error}
      </p>
    )
  if (st.missing) return <p className="muted">The run named {path}, but the file does not exist.</p>
  if (!st.table) return <p className="muted">Reading {baseName(path)}…</p>
  return <GlycoBody t={st.table} minFraction={minFraction ?? null} />
}

function GlycoBody({ t, minFraction }: { t: Glyco; minFraction: number | null }): JSX.Element {
  const [flaggedOnly, setFlaggedOnly] = useState(t.flaggedCount > 0)
  const [ion, setIon] = useState('')
  const [text, setText] = useState('')
  const rows = useMemo(() => {
    const needle = text.trim().toLowerCase()
    const out = new Uint32Array(t.rows)
    let k = 0
    for (let i = 0; i < t.rows; i++) {
      if (flaggedOnly && !t.flagged[i]) continue
      if (ion && !t.ions[i].includes(ion)) continue
      if (needle && !t.spectrum[i].toLowerCase().includes(needle)) continue
      out[k++] = i
    }
    return out.slice(0, k)
  }, [t, flaggedOnly, ion, text])
  const cols: Column[] = [
    { id: 'spectrum', label: 'Spectrum', mono: true, text: (i) => t.spectrum[i] },
    { id: 'n', label: 'Oxonium ions', num: true, text: (i) => String(t.nOxonium[i]), key: (i) => t.nOxonium[i] },
    { id: 'frac', label: 'Oxonium / base peak', num: true, title: 'Summed oxonium intensity over the base peak (can exceed 1)', text: (i) => (Number.isNaN(t.frac[i]) ? '' : t.frac[i].toFixed(3)), key: (i) => t.frac[i] },
    { id: 'flag', label: 'Flagged', text: (i) => (t.flagged[i] ? 'yes' : '') },
    { id: 'ions', label: 'Ions', mono: true, text: (i) => t.ions[i].join(', ') }
  ]
  const ionCols: Column[] = [
    { id: 'ion', label: 'Ion', mono: true, text: (i) => t.ionCounts[i].ion },
    { id: 'flagged', label: 'Flagged spectra', num: true, text: (i) => fmt(t.ionCounts[i].flagged), key: (i) => t.ionCounts[i].flagged },
    { id: 'share', label: 'Share of flagged', num: true, text: (i) => (t.flaggedCount ? pct(t.ionCounts[i].flagged / t.flaggedCount) : '–'), key: (i) => t.ionCounts[i].flagged },
    { id: 'all', label: 'All spectra', num: true, text: (i) => fmt(t.ionCounts[i].all), key: (i) => t.ionCounts[i].all }
  ]
  const ionIds = useMemo(() => Uint32Array.from(t.ionCounts, (_, i) => i), [t])
  return (
    <div className="glyco-view">
      <div className="card-head">
        <h2>Glyco: oxonium ions per spectrum</h2>
        <code className="src" title={t.path}>
          {baseName(t.path)}
        </code>
      </div>
      {t.warnings.map((w) => (
        <div className="caveat" key={w}>
          {w}
        </div>
      ))}
      <dl className="headline stats">
        <div className="stat big">
          <dt>Flagged spectra</dt>
          <dd>
            {fmt(t.flaggedCount)} <span className="sub">of {fmt(t.rows)} processed MS2 spectra ({pct(t.rows ? t.flaggedCount / t.rows : null)})</span>
          </dd>
        </div>
        {minFraction != null && (
          <div className="stat">
            <dt>Flag rule (glyco_min_fraction)</dt>
            <dd>{fmt(minFraction, 3)}</dd>
          </div>
        )}
      </dl>
      <p className="caveat">Oxonium ions are evidence of a glycan, not an identification of a glycopeptide.</p>
      <div className="dt-filters" role="group" aria-label="Glyco filters">
        <label className="check">
          <input type="checkbox" checked={flaggedOnly} onChange={(e) => setFlaggedOnly(e.target.checked)} /> Flagged only
        </label>
        <label>
          With ion
          <select value={ion} onChange={(e) => setIon(e.target.value)}>
            <option value="">any</option>
            {t.ionCounts.map((c) => (
              <option key={c.ion} value={c.ion}>
                {c.ion}
              </option>
            ))}
          </select>
        </label>
        <label>
          Spectrum contains
          <input type="search" value={text} onChange={(e) => setText(e.target.value)} />
        </label>
      </div>
      <DataTable label="Glyco spectra" columns={cols} ids={rows} total={t.rows} sort={{ column: 'frac', desc: true }} empty="No spectrum matches these filters." />
      {t.ionCounts.length > 0 && (
        <details className="raw">
          <summary>Oxonium ions among the flagged spectra ({fmt(t.ionCounts.length)} ions)</summary>
          <DataTable label="Oxonium ions" columns={ionCols} ids={ionIds} total={t.ionCounts.length} />
        </details>
      )}
    </div>
  )
}
