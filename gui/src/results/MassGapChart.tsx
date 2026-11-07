// The mass-gap chart of the Mass gaps & recon tab (GUI-DESIGN S7): spectra
// per gap peak (-delta_out, or the hist rows of -massgap_out, which are the
// same rows) as thin sticks over the precursor - peptide mass, with the
// bundled Unimod deltas marked (results/unimod.ts) and the CLI's explained
// peaks labelled. Dataviz rules: thin marks, a recessive hairline grid, a
// legend for the two layers, a tooltip on hover and on the keyboard's
// active stick, a table view with every value, and theme tokens so dark
// mode is its own (the plot colours are --brand-peaks and --flag).
//
// The zero bin holds most spectra; the y scale is set by the fullest
// shifted bin, so the zero stick is drawn cut at the top with its count.

import { useId, useMemo, useState, type JSX, type KeyboardEvent, type PointerEvent } from 'react'
import { fmt, type GapPeak } from '../digestReport'
import DataTable, { type Column } from './DataTable'
import { marksIn, nearestMark, type Mark } from './unimod'

export interface GapBin {
  gap: number
  /// The gap as the CLI printed it.
  key: string
  spectra: number
  /// The interpretations of the bin's spectra (-delta_out), if known.
  interps?: { name: string; n: number }[]
}

export type GapRange = 'central' | 'mods' | 'all'

const RANGE_LABEL: Record<GapRange, string> = {
  central: 'Central 98 %',
  mods: '−150 to +400 Da',
  all: 'All gaps'
}

export interface MassGapChartProps {
  bins: GapBin[]
  /// The CLI's peaks with their explanations (-massgap_out), if any.
  peaks?: GapPeak[]
  /// Gaps within this many Da count as one mass (the report's window_da).
  window: number
  /// The file the bins come from, for the caption.
  source: string
}

// The SVG's own coordinates; it scales to the card's width.
const W = 800
const H = 260
const M = { l: 52, r: 16, t: 34, b: 30 }
const PW = W - M.l - M.r
const PH = H - M.t - M.b

const da = (v: number, d = 4): string => (v > 0 ? `+${fmt(v, d)}` : v < 0 ? `−${fmt(-v, d)}` : '0')

/// The x range of @p range over @p bins: the central 98 % of the spectra
/// (and 0), a fixed modification window, or everything.
export function gapDomain(bins: GapBin[], range: GapRange): [number, number] {
  if (bins.length === 0) return [-1, 1]
  if (range === 'mods') return [-150, 400]
  if (range === 'all') {
    const lo = Math.min(0, bins[0].gap)
    const hi = Math.max(0, bins[bins.length - 1].gap)
    const pad = Math.max(1, (hi - lo) * 0.02)
    return [lo - pad, hi + pad]
  }
  const total = bins.reduce((n, b) => n + b.spectra, 0)
  const q = (p: number): number => {
    let seen = 0
    for (const b of bins) {
      seen += b.spectra
      if (seen >= p * total) return b.gap
    }
    return bins[bins.length - 1].gap
  }
  const lo = Math.min(0, q(0.01))
  const hi = Math.max(0, q(0.99))
  const pad = Math.max(2, (hi - lo) * 0.04)
  return [lo - pad, hi + pad]
}

/// Clean ticks from 0 to at least @p max (3-5 of them).
function yTicks(max: number): number[] {
  const raw = max / 4
  const p = 10 ** Math.floor(Math.log10(Math.max(raw, 1e-9)))
  const step = [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? p * 10
  const top = Math.max(step, Math.ceil(max / step) * step)
  const out: number[] = []
  for (let v = 0; v <= top + 1e-9; v += step) out.push(Math.round(v))
  return out
}

function xTicks(lo: number, hi: number): number[] {
  const raw = (hi - lo) / 6
  const p = 10 ** Math.floor(Math.log10(Math.max(raw, 1e-9)))
  const step = [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? p * 10
  const out: number[] = []
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(Math.round(v * 1e6) / 1e6)
  return out
}

interface Drawn {
  bin: GapBin
  x: number
  h: number
  cut: boolean
  mark: Mark | null
  peak: GapPeak | null
}

export default function MassGapChart({ bins, peaks = [], window, source }: MassGapChartProps): JSX.Element {
  const [range, setRange] = useState<GapRange>('central')
  const [view, setView] = useState<'chart' | 'table'>('chart')
  const [showMarks, setShowMarks] = useState(true)
  const [active, setActive] = useState<number | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const id = useId()

  const sorted = useMemo(() => [...bins].sort((a, b) => a.gap - b.gap), [bins])
  const [lo, hi] = useMemo(() => gapDomain(sorted, range), [sorted, range])
  const x = (v: number): number => M.l + ((v - lo) / (hi - lo)) * PW
  const shiftedAt = 2 * window
  const inRange = useMemo(() => sorted.filter((b) => b.gap >= lo && b.gap <= hi), [sorted, lo, hi])
  const outside = sorted.length - inRange.length
  const outsideSpectra = sorted.reduce((n, b) => n + (b.gap < lo || b.gap > hi ? b.spectra : 0), 0)
  const shifted = inRange.filter((b) => Math.abs(b.gap) > shiftedAt)
  const yMax = Math.max(1, ...(shifted.length ? shifted : inRange).map((b) => b.spectra))
  const ticks = yTicks(yMax)
  const yTop = ticks[ticks.length - 1]
  const y = (v: number): number => M.t + PH - (Math.min(v, yTop) / yTop) * PH

  // A CLI peak spans the gap rows within the window around it.
  const peakOf = (b: GapBin): GapPeak | null =>
    peaks.find((p) => p.delta != null && Math.abs(p.delta - b.gap) <= window + 1e-9) ?? null
  const drawn: Drawn[] = inRange.map((b) => ({
    bin: b,
    x: x(b.gap),
    h: b.spectra,
    cut: b.spectra > yTop,
    mark: nearestMark(b.gap, window),
    peak: peakOf(b)
  }))
  const marks = showMarks ? marksIn(lo, hi) : []

  // Direct labels, sparingly: the CLI's explained peaks, then the fullest
  // shifted bins that sit on a mark; at most 5, never two within 70 px.
  const labels: { x: number; text: string }[] = []
  const candidates = [
    ...peaks
      .filter((p) => p.delta != null && p.delta >= lo && p.delta <= hi && p.explainedBy !== 'none')
      .map((p) => ({ x: x(p.delta!), text: `${da(p.delta!, 3)} ${p.explainedBy}` })),
    ...drawn
      .filter((d) => d.mark && Math.abs(d.bin.gap) > shiftedAt)
      .sort((a, b) => b.h - a.h)
      .map((d) => ({ x: d.x, text: `${da(d.bin.gap, 3)} ${d.mark!.name}` }))
  ]
  for (const c of candidates) {
    if (labels.length >= 5) break
    if (labels.some((l) => Math.abs(l.x - c.x) < 70)) continue
    labels.push(c)
  }

  const shown = active ?? hover
  const cur = shown != null ? drawn[shown] : null

  function describe(d: Drawn): string {
    const parts = [`${da(d.bin.gap)} Da: ${fmt(d.bin.spectra)} spectra`]
    if (d.peak) parts.push(`peak ${d.peak.index}${d.peak.explainedBy !== 'none' ? `, explained by ${d.peak.explainedBy}` : ', not explained'}`)
    if (d.mark) parts.push(`near ${d.mark.name} (${da(d.mark.mass)} Da, ${fmt(Math.abs(d.bin.gap - d.mark.mass) * 1000, 1)} mDa off)`)
    if (d.bin.interps?.length) parts.push(`recon: ${d.bin.interps.map((i) => `${i.name} ${fmt(i.n)}`).join(', ')}`)
    return parts.join('; ')
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>): void {
    if (drawn.length === 0) return
    const n = drawn.length
    const cur = active ?? -1
    const to =
      e.key === 'ArrowRight' ? Math.min(n - 1, cur + 1)
      : e.key === 'ArrowLeft' ? Math.max(0, cur < 0 ? 0 : cur - 1)
      : e.key === 'PageDown' ? Math.min(n - 1, cur + 10)
      : e.key === 'PageUp' ? Math.max(0, cur - 10)
      : e.key === 'Home' ? 0
      : e.key === 'End' ? n - 1
      : e.key === 'Escape' ? null
      : undefined
    if (to === undefined) return
    e.preventDefault()
    setActive(to)
  }

  function onPointer(e: PointerEvent<SVGSVGElement>): void {
    const svg = e.currentTarget
    const r = svg.getBoundingClientRect()
    if (r.width === 0) return
    const px = ((e.clientX - r.left) / r.width) * W
    let best = -1
    let bestD = 8
    drawn.forEach((d, i) => {
      const dd = Math.abs(d.x - px)
      if (dd < bestD) {
        best = i
        bestD = dd
      }
    })
    setHover(best >= 0 ? best : null)
  }

  const zero = drawn.find((d) => Math.abs(d.bin.gap) <= shiftedAt && d.cut)
  const summary =
    `${fmt(sorted.reduce((n, b) => n + b.spectra, 0))} placed spectra in ${fmt(sorted.length)} gap peaks; ` +
    `shown ${da(lo, 0)} to ${da(hi, 0)} Da` +
    (zero ? `; the zero bin (${fmt(zero.bin.spectra)}) is cut at ${fmt(yTop)}` : '') +
    (outside ? `; ${fmt(outside)} peaks (${fmt(outsideSpectra)} spectra) lie outside` : '')

  const tableCols: Column[] = [
    { id: 'gap', label: 'Gap (Da)', num: true, text: (i) => sorted[i].key, key: (i) => sorted[i].gap },
    { id: 'spectra', label: 'Spectra', num: true, text: (i) => fmt(sorted[i].spectra), key: (i) => sorted[i].spectra },
    {
      id: 'mark',
      label: 'Unimod delta within window',
      text: (i) => {
        const m = nearestMark(sorted[i].gap, window)
        return m ? `${m.name} (${m.site})` : ''
      }
    },
    {
      id: 'off',
      label: 'Off by (mDa)',
      num: true,
      text: (i) => {
        const m = nearestMark(sorted[i].gap, window)
        return m ? fmt((sorted[i].gap - m.mass) * 1000, 1) : ''
      },
      key: (i) => {
        const m = nearestMark(sorted[i].gap, window)
        return m ? Math.abs(sorted[i].gap - m.mass) : NaN
      }
    },
    {
      id: 'peak',
      label: 'CLI peak',
      text: (i) => {
        const p = peakOf(sorted[i])
        return p ? `${p.index}: ${p.explainedBy}` : ''
      }
    },
    { id: 'interps', label: 'Recon interpretations', text: (i) => (sorted[i].interps ?? []).map((x) => `${x.name} ${x.n}`).join(', ') }
  ]
  const allIds = useMemo(() => Uint32Array.from(sorted, (_, i) => i), [sorted])

  return (
    <figure className="mg-chart" aria-labelledby={`${id}-cap`}>
      <figcaption id={`${id}-cap`}>
        Spectra placed in a database peptide, by precursor − peptide mass (Da) <span className="muted">· {source}</span>
      </figcaption>
      <div className="mg-controls">
        <div className="seg" role="group" aria-label="View">
          {(['chart', 'table'] as const).map((v) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}>
              {v === 'chart' ? 'Chart' : 'Table'}
            </button>
          ))}
        </div>
        {view === 'chart' && (
          <>
            <div className="seg" role="group" aria-label="Gap range">
              {(Object.keys(RANGE_LABEL) as GapRange[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  aria-pressed={range === r}
                  onClick={() => {
                    setRange(r)
                    setActive(null)
                  }}
                >
                  {RANGE_LABEL[r]}
                </button>
              ))}
            </div>
            <label className="mg-toggle">
              <input type="checkbox" checked={showMarks} onChange={(e) => setShowMarks(e.target.checked)} /> Unimod marks
            </label>
          </>
        )}
      </div>
      {view === 'table' ? (
        <DataTable label="Gap peaks" columns={tableCols} ids={allIds} total={sorted.length} sort={{ column: 'spectra', desc: true }} />
      ) : (
        <>
          <ul className="mg-legend" aria-label="Legend">
            <li>
              <span className="key stick" aria-hidden="true" /> Spectra per gap peak
            </li>
            {showMarks && (
              <li>
                <span className="key mark" aria-hidden="true" /> Unimod delta ({fmt(marks.length)} in range)
              </li>
            )}
          </ul>
          <div
            className="mg-plot"
            tabIndex={0}
            role="group"
            aria-label={`Mass-gap chart: ${summary}. Arrow keys step through the gap peaks.`}
            onKeyDown={onKey}
            onBlur={() => setActive(null)}
          >
            <svg
              viewBox={`0 0 ${W} ${H}`}
              role="presentation"
              onPointerMove={onPointer}
              onPointerLeave={() => setHover(null)}
            >
              {/* Recessive hairline grid and axes. */}
              {ticks.map((t) => (
                <g key={`y${t}`} className="mg-grid">
                  <line x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} />
                  <text x={M.l - 6} y={y(t)} dy="0.32em" textAnchor="end">
                    {fmt(t)}
                  </text>
                </g>
              ))}
              {xTicks(lo, hi).map((t) => (
                <text key={`x${t}`} className="mg-axis" x={x(t)} y={H - M.b + 16} textAnchor="middle">
                  {da(t, 0)}
                </text>
              ))}
              <line className="mg-base" x1={M.l} x2={W - M.r} y1={M.t + PH} y2={M.t + PH} />
              {marks.map((m) => (
                <line key={m.name} className={`mg-mark ${m.kind}`} x1={x(m.mass)} x2={x(m.mass)} y1={M.t} y2={M.t + PH}>
                  <title>{`${m.name} (${m.site}) ${da(m.mass)} Da`}</title>
                </line>
              ))}
              {drawn.map((d, i) => (
                <line
                  key={d.bin.key + '#' + i}
                  className={`mg-stick${i === shown ? ' on' : ''}${d.cut ? ' cut' : ''}`}
                  x1={d.x}
                  x2={d.x}
                  y1={M.t + PH}
                  y2={y(d.h)}
                />
              ))}
              {drawn
                .filter((d) => d.cut)
                .map((d) => (
                  <text key={`cut${d.bin.key}`} className="mg-cut" x={d.x + 4} y={M.t + 10}>
                    ⫽ {fmt(d.bin.spectra)}
                  </text>
                ))}
              {labels.map((l) => (
                <text key={`l${l.x}`} className="mg-label" x={l.x} y={M.t - 8} textAnchor="middle">
                  {l.text}
                </text>
              ))}
            </svg>
            {cur && (
              <div
                className="mg-tip"
                role="tooltip"
                style={{ left: `${(cur.x / W) * 100}%`, top: `${(y(cur.h) / H) * 100}%` }}
              >
                <strong>{fmt(cur.bin.spectra)} spectra</strong>
                <span>at {da(cur.bin.gap)} Da</span>
                {cur.peak && <span>CLI peak {cur.peak.index}: {cur.peak.explainedBy}</span>}
                {cur.mark ? (
                  <span>
                    {cur.mark.name} ({cur.mark.site}), {fmt(Math.abs(cur.bin.gap - cur.mark.mass) * 1000, 1)} mDa off
                  </span>
                ) : (
                  <span className="muted">no bundled delta within {fmt(window, 3)} Da</span>
                )}
                {cur.bin.interps && cur.bin.interps.length > 0 && (
                  <span className="muted">recon: {cur.bin.interps.map((i) => `${i.name} ${fmt(i.n)}`).join(', ')}</span>
                )}
              </div>
            )}
          </div>
          <p className="sr-only" aria-live="polite">
            {active != null && drawn[active] ? describe(drawn[active]) : ''}
          </p>
          <p className="footnote">
            {summary}. A mark is a hypothesis, not an identification: localization is region-level and nothing here is
            FDR-controlled.
          </p>
        </>
      )}
    </figure>
  )
}
