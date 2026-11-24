// The small charts of the Run QC page (qcModel.ts): spectra per MS level by
// analyser, reporter assessability (100 % bars), precursor charges and
// reporter channels (bars), and resolution by m/z band (points). They follow
// MassGapChart: one y axis, a legend for two or more series, a tooltip on
// hover and on the keyboard's active mark, a Table view with every value,
// and theme tokens only (qc.css), so dark mode is its own.

import { useId, useLayoutEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject } from 'react'
import DataTable, { type Column } from './DataTable'
import { xTicks, yTicks } from './MassGapChart'
import { FEW_PEAKS, bandText, bandsOf, int, pctText, type Bar, type ResClass, type Stack, type Tone } from './qcModel'
import './viewers.css'
import './qc.css'

interface Mark {
  x: number
  y: number
  head: string
  lines: string[]
}
interface Drawn {
  svg: ReactNode
  marks: Mark[]
  height: number
}
export interface LegendItem {
  tone: Tone
  label: string
  shape?: 'bar' | 'dot' | 'hollow' | 'dash' | 'rule'
}

/// The width of @p ref in px: the SVG is drawn at its own size, so its text
/// stays 11 px in a narrow column too.
function useWidth(ref: RefObject<HTMLElement | null>, fallback: number): number {
  const [w, setW] = useState(fallback)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((es) => {
      const v = Math.round(es[0]?.contentRect.width ?? 0)
      if (v > 0) setW(v)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return w
}

interface FigureProps {
  caption: ReactNode
  /// The plot in one sentence (its aria-label and footnote).
  summary: string
  legend?: LegendItem[]
  table: { label: string; columns: Column[]; n: number }
  /// The Table view, when it is not a DataTable of @p table.
  tableView?: ReactNode
  draw(W: number, on: number | null): Drawn
  children?: ReactNode
}

/// A chart card: caption, Chart | Table, legend, the plot with its tooltip
/// and keyboard steps, and notes under it.
function QcFigure({ caption, summary, legend = [], table, tableView, draw, children }: FigureProps): JSX.Element {
  const id = useId()
  const ref = useRef<HTMLDivElement>(null)
  const W = Math.max(260, useWidth(ref, 520))
  const [view, setView] = useState<'chart' | 'table'>('chart')
  const [active, setActive] = useState<number | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const shown = active ?? hover
  const { svg, marks, height } = draw(W, shown)
  const cur = shown != null ? marks[shown] : null
  const ids = useMemo(() => Uint32Array.from({ length: table.n }, (_, i) => i), [table.n])

  function onKey(e: KeyboardEvent<HTMLDivElement>): void {
    const n = marks.length
    if (n === 0) return
    const at = active ?? -1
    const to =
      e.key === 'ArrowRight' || e.key === 'ArrowDown' ? Math.min(n - 1, at + 1)
      : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? Math.max(0, at < 0 ? 0 : at - 1)
      : e.key === 'Home' ? 0
      : e.key === 'End' ? n - 1
      : e.key === 'Escape' ? null
      : undefined
    if (to === undefined) return
    e.preventDefault()
    setActive(to)
  }
  function onPointer(e: PointerEvent<SVGSVGElement>): void {
    const r = e.currentTarget.getBoundingClientRect()
    if (r.width === 0) return
    const px = ((e.clientX - r.left) / r.width) * W
    const py = ((e.clientY - r.top) / r.height) * height
    let best = -1
    let bestD = 24
    marks.forEach((m, i) => {
      const d = Math.hypot(m.x - px, (m.y - py) / 2)
      if (d < bestD) {
        best = i
        bestD = d
      }
    })
    setHover(best >= 0 ? best : null)
  }

  return (
    <figure className="mg-chart qc-chart" aria-labelledby={`${id}-cap`}>
      <figcaption id={`${id}-cap`}>{caption}</figcaption>
      <div className="mg-controls">
        <div className="seg" role="group" aria-label="View">
          {(['chart', 'table'] as const).map((v) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}>
              {v === 'chart' ? 'Chart' : 'Table'}
            </button>
          ))}
        </div>
      </div>
      {view === 'table' ? (
        (tableView ?? <DataTable label={table.label} columns={table.columns} ids={ids} total={table.n} />)
      ) : (
        <>
          {legend.length > 1 && (
            <ul className="mg-legend qc-legend" aria-label="Legend">
              {legend.map((l) => (
                <li key={l.label}>
                  <span className={`qc-key ${l.shape ?? 'bar'} qc-t-${l.tone}`} aria-hidden="true" /> {l.label}
                </li>
              ))}
            </ul>
          )}
          <div ref={ref} className="mg-plot" tabIndex={0} role="group" aria-label={`${summary}. Arrow keys step through the marks.`} onKeyDown={onKey} onBlur={() => setActive(null)}>
            <svg viewBox={`0 0 ${W} ${height}`} width={W} height={height} role="presentation" onPointerMove={onPointer} onPointerLeave={() => setHover(null)}>
              {svg}
            </svg>
            {cur && (
              <div className="mg-tip" role="tooltip" style={{ left: `${(cur.x / W) * 100}%`, top: `${(cur.y / height) * 100}%` }}>
                <strong>{cur.head}</strong>
                {cur.lines.map((l) => (
                  <span key={l}>{l}</span>
                ))}
              </div>
            )}
          </div>
          <p className="sr-only" aria-live="polite">
            {active != null && marks[active] ? `${marks[active].head}: ${marks[active].lines.join('; ')}` : ''}
          </p>
        </>
      )}
      {children}
    </figure>
  )
}

// ---- stacked bars --------------------------------------------------------------

export interface StackChartProps {
  caption: ReactNode
  /// What the rows are, for the table (MS level, Family).
  rowName: string
  stacks: Stack[]
  /// Each bar its own 100 %; else one scale of spectra for every bar.
  relative?: boolean
  /// The text right of a bar.
  end(s: Stack): string
  summary: string
  children?: ReactNode
}

export function StackChart({ caption, rowName, stacks, relative = false, end, summary, children }: StackChartProps): JSX.Element {
  const kinds = [...new Map(stacks.flatMap((s) => s.segments).map((g) => [g.id, g])).values()]
  const flat = stacks.flatMap((s) => s.segments.map((g) => ({ s, g })))
  const columns: Column[] = [
    { id: 'row', label: rowName, text: (i) => flat[i].s.label },
    { id: 'part', label: 'Part', text: (i) => flat[i].g.label },
    { id: 'n', label: 'Spectra', num: true, text: (i) => int(flat[i].g.value), key: (i) => flat[i].g.value },
    { id: 'share', label: `Share of the ${rowName.toLowerCase()}`, num: true, text: (i) => pctText(flat[i].g.value / flat[i].s.total), key: (i) => flat[i].g.value / flat[i].s.total }
  ]
  const draw = (W: number, on: number | null): Drawn => {
    const M = { l: 56, r: 132, t: 6, b: 24 }
    const rowH = 18
    const gap = 10
    const height = M.t + stacks.length * rowH + Math.max(0, stacks.length - 1) * gap + M.b
    const PW = Math.max(40, W - M.l - M.r)
    const max = Math.max(1, ...stacks.map((s) => s.total))
    const ticks = relative ? [0, 0.25, 0.5, 0.75, 1] : xTicks(0, max)
    const sx = (v: number, total: number): number => (relative ? (v / total) * PW : (v / max) * PW)
    const marks: Mark[] = []
    const rects: ReactNode[] = []
    stacks.forEach((s, ri) => {
      const y0 = M.t + ri * (rowH + gap)
      let x0 = M.l
      for (const g of s.segments) {
        const w = sx(g.value, s.total)
        const i = marks.length
        marks.push({ x: x0 + w / 2, y: y0, head: `${s.label}, ${g.label}`, lines: [`${int(g.value)} of ${int(s.total)} spectra (${pctText(g.value / s.total)})`] })
        rects.push(<rect key={`${s.label}-${g.id}`} className={`qc-seg qc-t-${g.tone}${i === on ? ' on' : ''}`} x={x0} y={y0} width={Math.max(w, 1)} height={rowH} />)
        x0 += w
      }
      rects.push(
        <text key={`${s.label}-l`} className="mg-axis qc-row-label" x={M.l - 8} y={y0 + rowH / 2} dy="0.32em" textAnchor="end">
          {s.label}
        </text>,
        <text key={`${s.label}-e`} className="mg-axis" x={x0 + 6} y={y0 + rowH / 2} dy="0.32em">
          {end(s)}
        </text>
      )
    })
    const base = height - M.b
    return {
      height,
      marks,
      svg: (
        <>
          {ticks.map((t) => {
            const x = M.l + (relative ? t * PW : (t / max) * PW)
            return (
              <g key={t} className="mg-grid">
                <line x1={x} x2={x} y1={M.t} y2={base} />
                <text x={x} y={base + 15} textAnchor="middle">
                  {relative ? `${t * 100}%` : int(t)}
                </text>
              </g>
            )
          })}
          {rects}
        </>
      )
    }
  }
  return (
    <QcFigure caption={caption} summary={summary} legend={kinds.map((k) => ({ tone: k.tone, label: k.label }))} table={{ label: typeof caption === 'string' ? caption : rowName, columns, n: flat.length }} draw={draw}>
      {children}
    </QcFigure>
  )
}

// ---- bars ----------------------------------------------------------------------

export interface BarChartProps {
  caption: ReactNode
  bars: Bar[]
  xTitle: string
  /// A threshold line (a share, 0..1) with its label.
  rule?: { at: number; label: string }
  tip(b: Bar): { head: string; lines: string[] }
  legend?: LegendItem[]
  columns?: Column[]
  tableLabel: string
  /// The Table view in place of a DataTable of @p columns.
  tableView?: ReactNode
  summary: string
  children?: ReactNode
}

/// Bars of a share (0..1), the y axis in percent.
export function BarChart({ caption, bars, xTitle, rule, tip, legend, columns = [], tableLabel, tableView, summary, children }: BarChartProps): JSX.Element {
  const draw = (W: number, on: number | null): Drawn => {
    const n = Math.max(1, bars.length)
    const M0 = { l: 44, r: 12, t: 14, b: 40 }
    const PW = Math.max(40, W - M0.l - M0.r)
    const step = PW / n
    const tilt = step < 34
    const M = { ...M0, b: tilt ? 52 : 40 }
    const height = 190 + (tilt ? 12 : 0)
    const PH = height - M.t - M.b
    const maxPct = Math.max(10, ...bars.map((b) => (b.share ?? 0) * 100), rule ? rule.at * 100 : 0)
    const ticks = yTicks(maxPct)
    const top = ticks[ticks.length - 1]
    const y = (pct: number): number => M.t + PH - (pct / top) * PH
    const bw = Math.min(40, step * 0.7)
    const marks: Mark[] = bars.map((b, i) => {
      const t = tip(b)
      return { x: M.l + step * (i + 0.5), y: y((b.share ?? 0) * 100), head: t.head, lines: t.lines }
    })
    return {
      height,
      marks,
      svg: (
        <>
          {ticks.map((t) => (
            <g key={t} className="mg-grid">
              <line x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} />
              <text x={M.l - 6} y={y(t)} dy="0.32em" textAnchor="end">
                {t}%
              </text>
            </g>
          ))}
          {bars.map((b, i) => {
            const cx = M.l + step * (i + 0.5)
            const h = Math.max(0, M.t + PH - y((b.share ?? 0) * 100))
            return (
              <g key={b.id}>
                <rect className={`qc-bar${b.muted ? ' muted' : ''}${i === on ? ' on' : ''}`} x={cx - bw / 2} y={M.t + PH - h} width={bw} height={Math.max(h, b.value > 0 ? 1 : 0)} />
                <text className="mg-axis" x={cx} y={M.t + PH + 14} textAnchor={tilt ? 'end' : 'middle'} transform={tilt ? `rotate(-45 ${cx} ${M.t + PH + 14})` : undefined}>
                  {b.label}
                </text>
              </g>
            )
          })}
          <line className="mg-base" x1={M.l} x2={W - M.r} y1={M.t + PH} y2={M.t + PH} />
          {rule && (
            <g className="qc-rule">
              <line x1={M.l} x2={W - M.r} y1={y(rule.at * 100)} y2={y(rule.at * 100)} />
              <text x={W - M.r} y={y(rule.at * 100) - 4} textAnchor="end">
                {rule.label}
              </text>
            </g>
          )}
          <text className="mg-axis" x={M.l + PW / 2} y={height - 4} textAnchor="middle">
            {xTitle}
          </text>
        </>
      )
    }
  }
  return (
    <QcFigure caption={caption} summary={summary} legend={legend} table={{ label: tableLabel, columns, n: bars.length }} tableView={tableView} draw={draw}>
      {children}
    </QcFigure>
  )
}

// ---- resolution ----------------------------------------------------------------

const SERIES: Tone[] = ['tag', 'peaks', 'gap']
export const resText = (v: number): string => (v >= 1000 ? `${Math.round(v / 1000).toLocaleString('en-US')}k` : String(Math.round(v)))

/** Resolution (m/z / FWHM) per m/z band, one series per analyser class and MS
 *  level: the measured medians as points (hollow below FEW_PEAKS peaks), a
 *  stated value as a dashed line. Only the classes with a value are drawn. */
export function ResolutionChart({ classes, summary, children }: { classes: ResClass[]; summary: string; children?: ReactNode }): JSX.Element {
  const drawn = classes.filter((c) => c.bands.length > 0 || c.stated != null)
  const tone = (c: ResClass): Tone => SERIES[drawn.indexOf(c) % SERIES.length]
  const bands = bandsOf(drawn)
  const cols = bands.length > 0 ? bands : ['all']
  const flat = drawn.flatMap((c) => [
    ...c.bands.map((b) => ({ c, band: bandText(b.band), value: b.value, n: b.n, kind: 'measured' })),
    ...(c.stated != null ? [{ c, band: 'all m/z', value: c.stated, n: null, kind: 'stated' }] : [])
  ])
  const columns: Column[] = [
    { id: 'cls', label: 'Spectra', text: (i) => flat[i].c.label },
    { id: 'band', label: 'm/z band', text: (i) => flat[i].band },
    { id: 'res', label: 'Resolution', num: true, text: (i) => int(flat[i].value), key: (i) => flat[i].value },
    { id: 'n', label: 'Peaks', num: true, text: (i) => (flat[i].n == null ? '' : int(flat[i].n!)), key: (i) => flat[i].n ?? NaN },
    { id: 'kind', label: 'Source', text: (i) => flat[i].kind }
  ]
  const few = drawn.some((c) => c.bands.some((b) => (b.n ?? 0) < FEW_PEAKS))
  const legend: LegendItem[] = [
    ...drawn.map((c) => ({ tone: tone(c), shape: 'dot' as const, label: `${c.label}${c.value != null ? `: ${resText(c.value)}${c.source ? ` ${c.source}` : ''}` : ''}` })),
    ...(drawn.some((c) => c.stated != null) ? [{ tone: 'muted' as Tone, shape: 'dash' as const, label: 'stated by the file' }] : []),
    ...(few ? [{ tone: 'muted' as Tone, shape: 'hollow' as const, label: `fewer than ${FEW_PEAKS} peaks` }] : [])
  ]
  const draw = (W: number, on: number | null): Drawn => {
    const M = { l: 48, r: 12, t: 12, b: 38 }
    const height = 190
    const PW = Math.max(40, W - M.l - M.r)
    const PH = height - M.t - M.b
    const step = PW / cols.length
    const max = Math.max(1, ...flat.map((f) => f.value))
    const ticks = yTicks(max)
    const top = ticks[ticks.length - 1]
    const y = (v: number): number => M.t + PH - (v / top) * PH
    const k = drawn.length
    const xOf = (band: string, ci: number): number => M.l + step * (cols.indexOf(band) + 0.5) + (ci - (k - 1) / 2) * 8
    const marks: Mark[] = []
    const nodes: ReactNode[] = []
    drawn.forEach((c, ci) => {
      const t = tone(c)
      if (c.stated != null) {
        const i = marks.length
        marks.push({ x: M.l + PW / 2, y: y(c.stated), head: `${c.label}, stated`, lines: [`${int(c.stated)} (stated by the file, all m/z)`] })
        nodes.push(<line key={`${c.cls}-s`} className={`qc-stated qc-t-${t}${i === on ? ' on' : ''}`} x1={M.l} x2={W - M.r} y1={y(c.stated)} y2={y(c.stated)} />)
      }
      const pts = c.bands.map((b) => ({ b, x: xOf(b.band, ci), y: y(b.value) }))
      if (pts.length > 1) nodes.push(<polyline key={`${c.cls}-l`} className={`qc-res-line qc-t-${t}`} points={pts.map((p) => `${p.x},${p.y}`).join(' ')} />)
      for (const p of pts) {
        const i = marks.length
        const lowN = (p.b.n ?? 0) < FEW_PEAKS
        marks.push({ x: p.x, y: p.y, head: `${c.label}, m/z ${bandText(p.b.band)}`, lines: [`${int(p.b.value)}${p.b.n != null ? ` (n = ${int(p.b.n)} peaks)` : ''}`, ...(lowN ? ['few peaks'] : [])] })
        nodes.push(<circle key={`${c.cls}-${p.b.band}`} className={`qc-dot qc-t-${t}${lowN ? ' hollow' : ''}${i === on ? ' on' : ''}`} cx={p.x} cy={p.y} r={i === on ? 5.5 : 4} />)
      }
    })
    return {
      height,
      marks,
      svg: (
        <>
          {ticks.map((t) => (
            <g key={t} className="mg-grid">
              <line x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} />
              <text x={M.l - 6} y={y(t)} dy="0.32em" textAnchor="end">
                {resText(t)}
              </text>
            </g>
          ))}
          {cols.map((b, i) => (
            <text key={b} className="mg-axis" x={M.l + step * (i + 0.5)} y={M.t + PH + 14} textAnchor="middle">
              {b === 'all' ? 'all m/z' : bandText(b)}
            </text>
          ))}
          <line className="mg-base" x1={M.l} x2={W - M.r} y1={M.t + PH} y2={M.t + PH} />
          {nodes}
          <text className="mg-axis" x={M.l + PW / 2} y={height - 4} textAnchor="middle">
            m/z band
          </text>
        </>
      )
    }
  }
  return (
    <QcFigure caption="Resolution by m/z band" summary={summary} legend={legend} table={{ label: 'Resolution by m/z band', columns, n: flat.length }} draw={draw}>
      {children}
    </QcFigure>
  )
}
