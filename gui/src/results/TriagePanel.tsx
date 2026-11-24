// TriagePanel: the overview at the top of Results > Triage (plan "identifiability
// overview" 2): headline tiles, then three charts of the statistics of
// triageOverview.ts — the peptide length the precursor implies with the tag
// lengths on top, tags against peaks, and coverage by peptide length. It is
// computed from every row of the census, whatever the table's filter shows.
//
// The charts follow MassGapChart: one y axis each, a legend, a tooltip on
// hover and on the keyboard's active bin, a Bins view with every value, and
// theme tokens only (triageOverview.css), so dark mode is its own.

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject } from 'react'
import { fmt, pct } from '../digestReport'
import DataTable, { type Column } from './DataTable'
import { xTicks as niceTicks, yTicks } from './MassGapChart'
import { useSticky } from './tableStore'
import {
  AVERAGINE_RESIDUE,
  CHARGE_GROUPS,
  CHARGE_LABEL,
  FEW,
  LEN_MAX,
  LEN_MIN,
  overviewStats,
  share,
  sumGroups,
  summaryTable,
  triageSettings,
  type CensusTable,
  type ChargeGroup,
  type OverviewStats,
  type TriageSettings
} from './triageOverview'
import './viewers.css'
import './triageOverview.css'

export const NO_IDS = 'Give the identifications of this run in Setup to mark identified spectra.'

// The overview's open state, for the session (not stored on disk).
let overviewOpen = true
/// Tests: the overview open again.
export function resetTriageOverview(): void {
  overviewOpen = true
}

const int = (n: number): string => fmt(n)
/// An option name, never broken at its hyphen.
const Opt = ({ children }: { children: ReactNode }): JSX.Element => <span className="tri-opt">{children}</span>

// ---- The chart ---------------------------------------------------------------

type Tone = 'peaks' | 'tag' | 'ok' | 'flag'

interface XBin {
  x0: number
  x1: number
}
interface Bars {
  id: string
  label: string
  values: number[]
  faint?: boolean
}
interface Line {
  id: string
  label: string
  tone: Tone
  values: (number | null)[]
  lo?: (number | null)[]
  hi?: (number | null)[]
  /// A histogram: drawn as steps across each bin.
  step?: boolean
  dashed?: boolean
  /// Points with fewer than FEW spectra are drawn hollow.
  few?: boolean[]
}
interface Marker {
  id: string
  label: string
  tone: Tone
  bin: number
  value: number
  text: string
}
interface Rule {
  y: number
  label: string
}
interface Tip {
  head: string
  lines: string[]
}

interface BinChartProps {
  name: string
  bins: XBin[]
  domain: [number, number]
  ticks: { at: number; label: string }[]
  xTitle: string
  yTitle: string
  yMax: number
  yFmt(v: number): string
  bars?: Bars[]
  lines?: Line[]
  markers?: Marker[]
  rules?: Rule[]
  tip(i: number): Tip
  summary: string
}

const H = 230
const M = { l: 46, r: 14, t: 24, b: 38 }

/// The width of @p ref in px (the SVG is drawn at its own size, so its text
/// stays 11 px at any window width).
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

function BinChart({ name, bins, domain, ticks, xTitle, yTitle, yMax, yFmt, bars = [], lines = [], markers = [], rules = [], tip, summary }: BinChartProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const W = Math.max(280, useWidth(ref, 560))
  const PW = W - M.l - M.r
  const PH = H - M.t - M.b
  const [active, setActive] = useState<number | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const yt = yTicks(Math.max(yMax, 1e-9))
  const yTop = yt[yt.length - 1]
  const [lo, hi] = domain
  const x = (v: number): number => M.l + ((v - lo) / (hi - lo)) * PW
  const y = (v: number): number => M.t + PH - (Math.max(0, Math.min(v, yTop)) / yTop) * PH
  const cx = (i: number): number => x((bins[i].x0 + bins[i].x1) / 2)

  // The top of a bin's marks, for the tooltip.
  const topOf = (i: number): number => {
    let v = bars.reduce((s, b) => s + (b.values[i] ?? 0), 0)
    for (const l of lines) v = Math.max(v, l.hi?.[i] ?? l.values[i] ?? 0)
    for (const m of markers) if (m.bin === i) v = Math.max(v, m.value)
    return v
  }

  function pathOf(vals: (number | null)[], step: boolean): string {
    let d = ''
    let open = false
    vals.forEach((v, i) => {
      if (v == null || !Number.isFinite(v)) {
        open = false
        return
      }
      if (step) {
        // A histogram outline: up from the base line, across each bin, down at the end.
        d += `${open ? 'L' : `M${x(bins[i].x0)},${y(0)}L`}${x(bins[i].x0)},${y(v)}L${x(bins[i].x1)},${y(v)}`
        const next = vals[i + 1]
        if (next == null || !Number.isFinite(next)) d += `L${x(bins[i].x1)},${y(0)}`
      } else d += `${open ? 'L' : 'M'}${cx(i)},${y(v)}`
      open = true
    })
    return d
  }
  function bandOf(l: Line): string[] {
    // One polygon per run of bins with both ends of the band.
    const out: string[] = []
    let run: number[] = []
    const flush = (): void => {
      if (run.length > 0) {
        const top = run.map((i) => `${cx(i)},${y(l.hi![i]!)}`)
        const bot = [...run].reverse().map((i) => `${cx(i)},${y(l.lo![i]!)}`)
        out.push([...top, ...bot].join(' '))
      }
      run = []
    }
    bins.forEach((_, i) => {
      const a = l.lo?.[i]
      const b = l.hi?.[i]
      if (a != null && b != null && Number.isFinite(a) && Number.isFinite(b)) run.push(i)
      else flush()
    })
    flush()
    return out
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>): void {
    const n = bins.length
    if (n === 0) return
    const cur = active ?? -1
    const to =
      e.key === 'ArrowRight' ? Math.min(n - 1, cur + 1)
      : e.key === 'ArrowLeft' ? Math.max(0, cur < 0 ? 0 : cur - 1)
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
    const i = bins.findIndex((b) => px >= x(b.x0) && px < x(b.x1))
    setHover(i >= 0 ? i : null)
  }

  const shown = active ?? hover
  const t = shown != null ? tip(shown) : null
  let stack = new Array<number>(bins.length).fill(0)
  return (
    <>
      <div
        ref={ref}
        className="mg-plot tri-plot"
        tabIndex={0}
        role="group"
        aria-label={`${name}: ${summary}. Arrow keys step through the bins.`}
        onKeyDown={onKey}
        onBlur={() => setActive(null)}
      >
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="presentation" onPointerMove={onPointer} onPointerLeave={() => setHover(null)}>
          <text className="tri-axis-title" x={M.l} y={12}>
            {yTitle}
          </text>
          {yt.map((v) => (
            <g key={`y${v}`} className="tri-grid">
              <line x1={M.l} x2={W - M.r} y1={y(v)} y2={y(v)} />
              <text x={M.l - 6} y={y(v)} dy="0.32em" textAnchor="end">
                {yFmt(v)}
              </text>
            </g>
          ))}
          {ticks.map((k) => (
            <text key={`x${k.at}`} className="tri-axis" x={x(k.at)} y={H - M.b + 15} textAnchor="middle">
              {k.label}
            </text>
          ))}
          <text className="tri-axis-title" x={M.l + PW / 2} y={H - 4} textAnchor="middle">
            {xTitle}
          </text>
          {shown != null && <rect className="tri-hover" x={x(bins[shown].x0)} y={M.t} width={Math.max(1, x(bins[shown].x1) - x(bins[shown].x0))} height={PH} />}
          {bars.map((b) => {
            const base = stack
            stack = base.map((s, i) => s + (b.values[i] ?? 0))
            return (
              <g key={b.id} className={`tri-bars${b.faint ? ' faint' : ''}`}>
                {b.values.map((v, i) =>
                  v > 0 ? (
                    <rect
                      key={i}
                      x={x(bins[i].x0) + 0.5}
                      width={Math.max(1, x(bins[i].x1) - x(bins[i].x0) - 1)}
                      y={y(base[i] + v)}
                      height={Math.max(0.5, y(base[i]) - y(base[i] + v))}
                    />
                  ) : null
                )}
              </g>
            )
          })}
          {lines.map((l) =>
            l.lo && l.hi ? bandOf(l).map((pts, k) => <polygon key={`${l.id}b${k}`} className={`tri-band tone-${l.tone}`} points={pts} />) : null
          )}
          {lines.map((l) => (
            <g key={l.id} className={`tri-line tone-${l.tone}${l.dashed ? ' dashed' : ''}`}>
              <path d={pathOf(l.values, !!l.step)} />
              {!l.step &&
                l.values.map((v, i) =>
                  v != null && Number.isFinite(v) ? <circle key={i} className={l.few?.[i] ? 'few' : undefined} cx={cx(i)} cy={y(v)} r={3} /> : null
                )}
            </g>
          ))}
          {rules.map((r) => (
            <g key={r.label} className="tri-rule">
              <line x1={M.l} x2={W - M.r} y1={y(r.y)} y2={y(r.y)} />
              <text x={W - M.r} y={y(r.y) - 4} textAnchor="end">
                {r.label}
              </text>
            </g>
          ))}
          {markers.map((m) => (
            <g key={m.id} className={`tri-marker tone-${m.tone}`}>
              <line x1={cx(m.bin)} x2={cx(m.bin)} y1={M.t + PH} y2={y(m.value)} />
              <circle cx={cx(m.bin)} cy={y(m.value)} r={5} />
              <text x={cx(m.bin) + 8} y={y(m.value)} dy="0.32em">
                {m.text}
              </text>
            </g>
          ))}
          <line className="tri-base" x1={M.l} x2={W - M.r} y1={M.t + PH} y2={M.t + PH} />
        </svg>
        {t && shown != null && (
          <div className="mg-tip tri-tip" role="tooltip" style={{ left: `${(cx(shown) / W) * 100}%`, top: `${(y(topOf(shown)) / H) * 100}%` }}>
            <strong>{t.head}</strong>
            {t.lines.map((s) => (
              <span key={s}>{s}</span>
            ))}
          </div>
        )}
      </div>
      <p className="sr-only" aria-live="polite">
        {active != null && t ? [t.head, ...t.lines].join('; ') : ''}
      </p>
    </>
  )
}

/// A legend key per series.
function Legend({ items }: { items: { key: string; label: ReactNode; cls: string }[] }): JSX.Element | null {
  if (items.length === 0) return null
  return (
    <ul className="mg-legend tri-legend" aria-label="Legend">
      {items.map((i) => (
        <li key={i.key}>
          <span className={`tri-key ${i.cls}`} aria-hidden="true" /> {i.label}
        </li>
      ))}
    </ul>
  )
}

interface CardProps {
  title: string
  source: string
  /// A label naming the chart for its controls and table.
  name: string
  view: 'chart' | 'table'
  setView(v: 'chart' | 'table'): void
  controls?: ReactNode
  legend?: ReactNode
  note?: ReactNode
  chart: ReactNode
  table: { columns: Column[]; n: number }
  footnote: ReactNode
}

function ChartCard({ title, source, name, view, setView, controls, legend, note, chart, table, footnote }: CardProps): JSX.Element {
  const id = useId()
  const ids = useMemo(() => Uint32Array.from({ length: table.n }, (_, i) => i), [table.n])
  return (
    <figure className="mg-chart tri-chart" aria-labelledby={`${id}-cap`}>
      <figcaption id={`${id}-cap`}>
        {title} <span className="muted">· {source}</span>
      </figcaption>
      <div className="mg-controls">
        <div className="seg" role="group" aria-label={`${name} view`}>
          {(['chart', 'table'] as const).map((v) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}>
              {v === 'chart' ? 'Chart' : 'Bins'}
            </button>
          ))}
        </div>
        {controls}
      </div>
      {note}
      {view === 'table' ? (
        <DataTable label={`${name} bins`} columns={table.columns} ids={ids} total={table.n} />
      ) : (
        <>
          {legend}
          {chart}
        </>
      )}
      <p className="footnote">{footnote}</p>
    </figure>
  )
}

const spreadText = (m: number, a: number, b: number, unit = ''): string =>
  `median ${fmt(m, 1)}${unit} (middle half ${fmt(a, 1)}–${fmt(b, 1)}${unit})`

// ---- (a) Estimated peptide length ----------------------------------------------

type ChargeChoice = 'all' | ChargeGroup

function LengthChart({ st, set, source, keep }: { st: OverviewStats; set: TriageSettings; source: string; keep: object }): JSX.Element {
  const [view, setView] = useSticky<'chart' | 'table'>(keep, 'tri:len:view', 'chart')
  const [choice, setChoice] = useSticky<ChargeChoice>(keep, 'tri:len:charge', 'all')
  const present = CHARGE_GROUPS.filter((g) => g !== 'assumed' && st.lengths[g].est.n > 0)
  const groups: readonly ChargeGroup[] = choice === 'all' ? CHARGE_GROUPS : [choice]
  const h = sumGroups(st, groups)
  const nEst = h.est.n
  const nTag = h.tag.n
  const nId = h.idTag?.n ?? 0
  // The axis: from the shortest tag (or LEN_MIN) to the longest length drawn.
  const used = (c: number[]): number[] => c.flatMap((v, r) => (v > 0 ? [r] : []))
  const all = [...used(h.est.counts), ...used(h.tag.counts), ...(h.idTag ? used(h.idTag.counts) : [])]
  const r0 = Math.max(1, Math.min(LEN_MIN, ...all))
  const r1 = Math.min(LEN_MAX, Math.max(r0 + 10, ...all))
  const rs = Array.from({ length: r1 - r0 + 1 }, (_, k) => r0 + k)
  const bins = rs.map((r) => ({ x0: r - 0.5, x1: r + 0.5 }))
  const sh = (c: number, n: number): number => (n > 0 ? (100 * c) / n : 0)
  const given = rs.map((r) => sh(h.est.counts[r] - h.assumed.counts[r], nEst))
  const assumed = rs.map((r) => sh(h.assumed.counts[r], nEst))
  // A step series from its first to its last length with spectra.
  const steps = (c: number[], n: number): (number | null)[] => {
    const on = rs.filter((r) => c[r] > 0)
    return rs.map((r) => (on.length && r >= on[0] && r <= on[on.length - 1] ? sh(c[r], n) : null))
  }
  const tag = steps(h.tag.counts, nTag)
  const idTag = h.idTag ? steps(h.idTag.counts, nId) : null
  const single = st.singleLength
  const barMax = Math.max(0, ...given.map((v, i) => v + assumed[i]))
  const top = (v: (number | null)[] | null): number => Math.max(0, ...(v ?? []).map((x) => x ?? 0))
  const yMax = single != null ? Math.max(barMax, top(idTag)) * 1.15 || 1 : Math.max(barMax, top(tag), top(idTag), 1)
  const singleAt = single != null ? rs.indexOf(single) : -1
  const tagLabel = st.tagLenFrom === 'max_len' ? 'Longest tag' : 'Best tag'

  const tip = (i: number): Tip => {
    const r = rs[i]
    const lines = [`estimated length: ${int(h.est.counts[r])} spectra (${pct(share(h.est.counts[r], nEst))})`]
    if (h.assumed.counts[r] > 0) lines.push(`of them charge assumed: ${int(h.assumed.counts[r])}`)
    lines.push(`${tagLabel.toLowerCase()} of this length: ${int(h.tag.counts[r])} (${pct(share(h.tag.counts[r], nTag))})`)
    if (h.idTag) lines.push(`identified: ${int(h.idTag.counts[r])} (${pct(share(h.idTag.counts[r], nId))})`)
    return { head: `${r} residues`, lines }
  }
  const summary = `${int(nEst)} spectra with an estimated length, ${int(nTag)} tagged spectra` + (single != null ? `; every tag has length ${single}` : '')
  const legend: { key: string; label: ReactNode; cls: string }[] = [
    { key: 'est', label: `Estimated peptide length (${int(nEst - h.assumed.n)})`, cls: 'bar' }
  ]
  if (h.assumed.n > 0) legend.push({ key: 'assumed', label: `${CHARGE_LABEL.assumed} (${int(h.assumed.n)})`, cls: 'bar faint' })
  legend.push({ key: 'tag', label: `${tagLabel} length of tagged spectra (${int(nTag)})`, cls: single != null ? 'dot tone-tag' : 'line tone-tag' })
  if (h.idTag) legend.push({ key: 'id', label: `${tagLabel} length of identified spectra (${int(nId)})`, cls: 'line tone-ok' })

  const columns: Column[] = [
    { id: 'len', label: 'Residues', num: true, text: (i) => String(rs[i]), key: (i) => rs[i] },
    { id: 'est', label: 'Estimated length (spectra)', num: true, text: (i) => int(h.est.counts[rs[i]]), key: (i) => h.est.counts[rs[i]] },
    { id: 'assumed', label: 'Of them charge assumed', num: true, text: (i) => int(h.assumed.counts[rs[i]]), key: (i) => h.assumed.counts[rs[i]] },
    { id: 'tag', label: `${tagLabel} length (spectra)`, num: true, text: (i) => int(h.tag.counts[rs[i]]), key: (i) => h.tag.counts[rs[i]] },
    ...(h.idTag ? [{ id: 'id', label: 'Identified (spectra)', num: true, text: (i: number) => int(h.idTag!.counts[rs[i]]), key: (i: number) => h.idTag!.counts[rs[i]] }] : [])
  ]
  const seeded = set.extension === 0 && set.nLengths <= 1
  return (
    <ChartCard
      title="Estimated peptide length and tag length"
      source={source}
      name="Length chart"
      view={view}
      setView={setView}
      controls={
        present.length > 1 || h.assumed.n > 0 ? (
          <div className="seg" role="group" aria-label="Charge">
            {(['all', ...present] as ChargeChoice[]).map((g) => (
              <button key={g} type="button" aria-pressed={choice === g} onClick={() => setChoice(g)}>
                {g === 'all' ? 'All' : CHARGE_LABEL[g]}
              </button>
            ))}
          </div>
        ) : undefined
      }
      note={
        single != null ? (
          <p className="caveat tri-note" role="note">
            All tags have length {single}
            {seeded && set.tagLength === single ? (
              <>
                {' '}
                (seeded at <Opt>-tag_length {single}</Opt>, no <Opt>-extension</Opt>)
              </>
            ) : (
              ''
            )}
            , so tag length says nothing here. Run with <Opt>-extension</Opt> or several <Opt>-tag_length</Opt> values to see it.
          </p>
        ) : null
      }
      legend={<Legend items={legend} />}
      chart={
        <BinChart
          name="Length chart"
          bins={bins}
          domain={[r0 - 0.5, r1 + 0.5]}
          ticks={niceTicks(r0, r1).filter((v) => Number.isInteger(v)).map((v) => ({ at: v, label: String(v) }))}
          xTitle="Residues"
          yTitle="Spectra (%)"
          yMax={yMax}
          yFmt={(v) => fmt(v, 0)}
          bars={[
            { id: 'given', label: 'Estimated length', values: given },
            { id: 'assumed', label: CHARGE_LABEL.assumed, values: assumed, faint: true }
          ]}
          lines={[
            ...(single == null ? [{ id: 'tag', label: 'Tag length', tone: 'tag' as Tone, values: tag, step: true }] : []),
            ...(idTag ? [{ id: 'id', label: 'Identified', tone: 'ok' as Tone, values: idTag, step: true }] : [])
          ]}
          markers={
            single != null && singleAt >= 0
              ? [{ id: 'single', label: 'Tag length', tone: 'tag', bin: singleAt, value: yTicks(yMax)[yTicks(yMax).length - 1], text: `all ${int(nTag)} tags: ${single}` }]
              : []
          }
          tip={tip}
          summary={summary}
        />
      }
      table={{ columns, n: rs.length }}
      footnote={
        <>
          Shares are of the spectra of each series. Estimated length = (precursor mass − water) / {AVERAGINE_RESIDUE} Da (averagine), at the
          charge used; an average residue on a monoisotopic mass adds about 0.06 %. Labels (TMT: about 229 Da, 2 residues, each), modifications
          and a wrong charge shift it.
          {st.noLength > 0 && <> {int(st.noLength)} processed spectra have no length.</>}
          {h.est.under + h.est.over > 0 && (
            <>
              {' '}
              Not drawn: {int(h.est.under)} below {LEN_MIN} and {int(h.est.over)} above {LEN_MAX} residues.
            </>
          )}
        </>
      }
    />
  )
}

// ---- (b) Tags vs peaks ---------------------------------------------------------

function PeaksChart({ st, source, keep }: { st: OverviewStats; source: string; keep: object }): JSX.Element | null {
  const [view, setView] = useSticky<'chart' | 'table'>(keep, 'tri:peaks:view', 'chart')
  const [axis, setAxis] = useSticky<'kept' | 'all'>(keep, 'tri:peaks:x', 'kept')
  const pb = (axis === 'kept' ? st.peaks.kept : st.peaks.all) ?? st.peaks.kept ?? st.peaks.all
  if (!pb) return null
  const which = pb === st.peaks.kept ? 'kept' : 'all'
  const xWord = which === 'kept' ? 'Peaks kept' : 'Peaks in spectrum'
  const bs = pb.bins
  const nb = bs.length
  const bins = bs.map((b, i) => ({ x0: i, x1: i + 1 }))
  const rangeText = (i: number): string => (bs[i].x1 === Infinity ? `≥ ${int(bs[i].x0)}` : `${int(bs[i].x0)}–${int(bs[i].x1 - 1)}`)
  const val = (v: number, n: number): number | null => (n > 0 && Number.isFinite(v) ? v : null)
  const cap = st.cap
  const yMax = Math.max(1, cap?.value ?? 0, ...bs.map((b) => (b.n > 0 ? b.p75 : 0)))
  const step = Math.max(1, Math.ceil(nb / 8))
  const ticks = bs.flatMap((b, i) => (i % step === 0 ? [{ at: i, label: int(b.x0) }] : []))
  if (bs[nb - 1].x1 !== Infinity) ticks.push({ at: nb, label: int(bs[nb - 1].x1) })
  const total = bs.reduce((n, b) => n + b.n, 0)
  const tip = (i: number): Tip => {
    const b = bs[i]
    if (b.n === 0) return { head: `${rangeText(i)} ${xWord.toLowerCase()}`, lines: ['no spectra'] }
    const lines = [`${int(b.n)} spectra${b.n < FEW ? ` (fewer than ${FEW})` : ''}`, `tags reported: ${spreadText(b.median, b.p25, b.p75)}`, `strong tag: ${pct(share(b.strong, b.n))}`]
    if (cap) lines.push(`at the cap (${int(cap.value)}): ${pct(share(b.atCap, b.n))}`)
    return { head: `${rangeText(i)} ${xWord.toLowerCase()}`, lines }
  }
  const legend = [
    { key: 'med', label: 'Tags reported per spectrum: median', cls: 'line tone-tag' },
    { key: 'iqr', label: 'middle half', cls: 'band tone-tag' },
    ...(cap ? [{ key: 'cap', label: cap.from === 'run' ? `Cap (-max_tags) ${int(cap.value)}` : `Cap ${int(cap.value)} (from the data)`, cls: 'rule' }] : [])
  ]
  const columns: Column[] = [
    { id: 'x', label: xWord, text: rangeText, key: (i) => bs[i].x0 },
    { id: 'n', label: 'Spectra', num: true, text: (i) => int(bs[i].n), key: (i) => bs[i].n },
    { id: 'med', label: 'Median tags', num: true, text: (i) => (bs[i].n ? fmt(bs[i].median, 1) : ''), key: (i) => bs[i].median },
    { id: 'p25', label: '25th percentile', num: true, text: (i) => (bs[i].n ? fmt(bs[i].p25, 1) : ''), key: (i) => bs[i].p25 },
    { id: 'p75', label: '75th percentile', num: true, text: (i) => (bs[i].n ? fmt(bs[i].p75, 1) : ''), key: (i) => bs[i].p75 },
    { id: 'strong', label: 'Strong tag', num: true, text: (i) => pct(share(bs[i].strong, bs[i].n)), key: (i) => (bs[i].n ? bs[i].strong / bs[i].n : NaN) },
    ...(cap ? [{ id: 'cap', label: 'At the cap', num: true, text: (i: number) => pct(share(bs[i].atCap, bs[i].n)), key: (i: number) => (bs[i].n ? bs[i].atCap / bs[i].n : NaN) }] : [])
  ]
  return (
    <ChartCard
      title="Tags reported per spectrum by peaks"
      source={source}
      name="Peaks chart"
      view={view}
      setView={setView}
      controls={
        st.peaks.kept && st.peaks.all ? (
          <div className="seg" role="group" aria-label="Peaks">
            {(['kept', 'all'] as const).map((a) => (
              <button key={a} type="button" aria-pressed={which === a} onClick={() => setAxis(a)}>
                {a === 'kept' ? 'Peaks kept' : 'Peaks in spectrum'}
              </button>
            ))}
          </div>
        ) : undefined
      }
      legend={<Legend items={legend} />}
      chart={
        <BinChart
          name="Peaks chart"
          bins={bins}
          domain={[0, nb]}
          ticks={ticks}
          xTitle={`${xWord} (bins of ${int(pb.width)})`}
          yTitle="Tags per spectrum"
          yMax={yMax}
          yFmt={(v) => fmt(v, 0)}
          lines={[
            {
              id: 'med',
              label: 'Median',
              tone: 'tag',
              values: bs.map((b) => val(b.median, b.n)),
              lo: bs.map((b) => val(b.p25, b.n)),
              hi: bs.map((b) => val(b.p75, b.n)),
              few: bs.map((b) => b.n < FEW)
            }
          ]}
          rules={cap ? [{ y: cap.value, label: `cap ${int(cap.value)}` }] : []}
          tip={tip}
          summary={`${int(total)} spectra in ${nb} bins of ${int(pb.width)} ${xWord.toLowerCase()}`}
        />
      }
      table={{ columns, n: nb }}
      footnote={
        <>
          Tags reported per spectrum (n_reported) by {which === 'kept' ? 'the peaks kept for tagging (n_peaks_kept)' : 'the peaks of the spectrum (n_peaks)'}. Line:
          median; band: middle half (25th to 75th percentile). Hollow points: fewer than {FEW} spectra.
          {cap ? ' No spectrum reports more tags than the cap, so the line flattens there.' : ''}
        </>
      }
    />
  )
}

// ---- (c) Coverage ---------------------------------------------------------------

function CoverageChart({ st, source, keep }: { st: OverviewStats; source: string; keep: object }): JSX.Element {
  const [view, setView] = useSticky<'chart' | 'table'>(keep, 'tri:cov:view', 'chart')
  // Only the bins from the first to the last with a value.
  const has = st.coverage.map((b) => !!(b.tag || b.cover))
  const first = Math.max(0, has.indexOf(true))
  const last = Math.max(first, has.lastIndexOf(true))
  const cb = st.coverage.slice(first, last + 1)
  const bins = cb.map((_, i) => ({ x0: i, x1: i + 1 }))
  const proxy = st.coverFrom === 'proxy'
  const tagWord = st.tagLenFrom === 'max_len' ? 'Longest tag' : 'Best tag'
  const coverWord = proxy ? 'All tags, m/z span (proxy)' : 'All tags, residues covered'
  const single = st.singleLength
  const tagLine: Line = {
    id: 'tag',
    label: tagWord,
    tone: 'tag',
    values: cb.map((b) => b.tag?.median ?? null),
    lo: cb.map((b) => b.tag?.p25 ?? null),
    hi: cb.map((b) => b.tag?.p75 ?? null),
    few: cb.map((b) => (b.tag?.n ?? 0) < FEW)
  }
  const coverLine: Line | null = st.coverFrom
    ? {
        id: 'cover',
        label: coverWord,
        tone: 'flag',
        dashed: proxy,
        values: cb.map((b) => b.cover?.median ?? null),
        lo: cb.map((b) => b.cover?.p25 ?? null),
        hi: cb.map((b) => b.cover?.p75 ?? null),
        few: cb.map((b) => (b.cover?.n ?? 0) < FEW)
      }
    : null
  // With one tag length the tag line is just length / L: the cover series first.
  const lines = coverLine ? (single != null ? [coverLine, tagLine] : [tagLine, coverLine]) : [tagLine]
  const legend = lines.map((l) => ({ key: l.id, label: `${l.label}: median, middle half`, cls: `line tone-${l.tone}${l.dashed ? ' dashed' : ''}` }))
  const tip = (i: number): Tip => {
    const b = cb[i]
    const lines: string[] = []
    if (b.tag) lines.push(`${tagWord.toLowerCase()}: ${spreadText(b.tag.median, b.tag.p25, b.tag.p75, ' %')}, ${int(b.tag.n)} spectra`)
    if (b.cover) lines.push(`${proxy ? 'm/z span (proxy)' : 'residues covered'}: ${spreadText(b.cover.median, b.cover.p25, b.cover.p75, ' %')}, ${int(b.cover.n)} spectra`)
    if (lines.length === 0) lines.push('no tagged spectra')
    return { head: `${b.label} residues (estimated)`, lines }
  }
  const sp = (k: 'tag' | 'cover', f: 'median' | 'p25' | 'p75' | 'n') => (i: number): string => {
    const s = cb[i][k]
    return s ? (f === 'n' ? int(s.n) : fmt(s[f], 1)) : ''
  }
  const columns: Column[] = [
    { id: 'len', label: 'Estimated length', text: (i) => cb[i].label, key: (i) => cb[i].r0 },
    { id: 'tn', label: `${tagWord}: spectra`, num: true, text: sp('tag', 'n'), key: (i) => cb[i].tag?.n ?? 0 },
    { id: 'tm', label: `${tagWord}: median %`, num: true, text: sp('tag', 'median'), key: (i) => cb[i].tag?.median ?? NaN },
    { id: 't25', label: '25th', num: true, text: sp('tag', 'p25'), key: (i) => cb[i].tag?.p25 ?? NaN },
    { id: 't75', label: '75th', num: true, text: sp('tag', 'p75'), key: (i) => cb[i].tag?.p75 ?? NaN },
    ...(st.coverFrom
      ? [
          { id: 'cn', label: `${proxy ? 'Proxy' : 'Covered'}: spectra`, num: true, text: sp('cover', 'n'), key: (i: number) => cb[i].cover?.n ?? 0 },
          { id: 'cm', label: `${proxy ? 'Proxy' : 'Covered'}: median %`, num: true, text: sp('cover', 'median'), key: (i: number) => cb[i].cover?.median ?? NaN },
          { id: 'c25', label: '25th ', num: true, text: sp('cover', 'p25'), key: (i: number) => cb[i].cover?.p25 ?? NaN },
          { id: 'c75', label: '75th ', num: true, text: sp('cover', 'p75'), key: (i: number) => cb[i].cover?.p75 ?? NaN }
        ]
      : [])
  ]
  const n = cb.reduce((s, b) => s + (b.tag?.n ?? 0), 0)
  return (
    <ChartCard
      title="Peptide covered by tags, by estimated length"
      source={source}
      name="Coverage chart"
      view={view}
      setView={setView}
      note={
        <>
          {proxy && (
            <p className="caveat tri-note" role="note">
              Approximate: this table has no res_cover column, so the dashed line is the m/z span of all tags over the peptide mass, not a share of
              residues.
            </p>
          )}
          {st.coverFrom === 'res_cover' && st.coverFolded && st.coverFolded.folded > 0 && (
            <p className="caveat tri-note" role="note">
              Approximate: orientation unresolved (folded, lower bound) for {int(st.coverFolded.folded)} of{' '}
              {int(st.coverFolded.of)} tagged spectra. Without a -fasta match a tag may be a b or a y read, so
              residues covered counts mirror-image residues once.
            </p>
          )}
          {st.coverFrom === 'res_cover' && !st.coverFolded && (
            <p className="caveat tri-note" role="note">
              Approximate: this census (format 2) placed every tag as a y read, so b and y tags over the same
              residues count twice and residues covered can exceed the peptide. Re-run FASTag for format 3.
            </p>
          )}
          {!st.coverFrom && (
            <p className="caveat tri-note" role="note">
              This table has no tag_cover column: only the {tagWord.toLowerCase()} is shown.
            </p>
          )}
          {single != null && (
            <p className="hint tri-note">
              With one tag length the {tagWord.toLowerCase()} line is just {single} / length.
            </p>
          )}
        </>
      }
      legend={<Legend items={legend} />}
      chart={
        <BinChart
          name="Coverage chart"
          bins={bins}
          domain={[0, Math.max(1, cb.length)]}
          ticks={cb.flatMap((b, i) => (i % Math.max(1, Math.ceil(cb.length / 9)) === 0 ? [{ at: i + 0.5, label: b.label }] : []))}
          xTitle="Estimated peptide length (residues)"
          yTitle="Covered (%)"
          yMax={100}
          yFmt={(v) => fmt(v, 0)}
          lines={lines}
          tip={tip}
          summary={`${int(n)} tagged spectra with an estimated length`}
        />
      }
      table={{ columns, n: cb.length }}
      footnote={
        <>
          Coverage = {st.tagLenFrom === 'max_len' ? 'the longest tag' : 'the best tag'} (residues) / estimated length, at most 100 %.{' '}
          {proxy
            ? 'Proxy: the union of the m/z ranges of all reported tags / (precursor mass − water); it mixes b and y ions and fragment charges.'
            : st.coverFrom
              ? st.coverFolded && st.coverFolded.folded > 0
                ? 'Residues covered: the residues under the union of all reported tags (res_cover) / estimated length; approximate: orientation unresolved (folded, lower bound).'
                : 'Residues covered: the residues under the union of all reported tags (res_cover) / estimated length.'
              : ''}{' '}
          Line: median; band: middle half; hollow points: fewer than {FEW} spectra.
        </>
      }
    />
  )
}

// ---- The overview ----------------------------------------------------------------

export interface TriageOverviewProps {
  tsv: CensusTable
  /// The parameters of the run that wrote the table, if known.
  params?: Record<string, unknown> | null
  /// The census summary of that run, if written (max_tags, subsampled).
  summaryPath?: string | null
  summaryGen?: number
  /// The file name, for the captions.
  source: string
}

function useSummary(path: string | null | undefined, gen = 0): CensusTable | null {
  const [s, setS] = useState<{ key: string; t: CensusTable | null }>({ key: '', t: null })
  const key = `${path ?? ''}#${gen}`
  useEffect(() => {
    if (!path) return
    let live = true
    window.fastag
      .report(path)
      .then((t) => live && setS({ key, t: t == null ? null : summaryTable(t) }))
      .catch(() => live && setS({ key, t: null }))
    return () => {
      live = false
    }
  }, [path, key])
  return s.key === key ? s.t : null
}

interface TileProps {
  label: string
  value: string
  note: ReactNode
  lead?: boolean
  off?: boolean
}
function Tile({ label, value, note, lead, off }: TileProps): JSX.Element {
  return (
    <li>
      <section className={`tri-tile${lead ? ' lead' : ''}${off ? ' off' : ''}`} aria-label={label}>
        <h3 className="tri-tile-label">{label}</h3>
        <p className="tri-tile-value">{value}</p>
        <p className="tri-tile-note">{note}</p>
      </section>
    </li>
  )
}

export default function TriageOverview({ tsv, params, summaryPath, summaryGen, source }: TriageOverviewProps): JSX.Element {
  const summary = useSummary(summaryPath, summaryGen)
  const set = useMemo(() => triageSettings(params, summary, tsv.rows.length), [params, summary, tsv])
  const st = useMemo(() => overviewStats(tsv, set), [tsv, set])
  const [open, setOpen] = useState(overviewOpen)
  const thr = fmt(st.threshold, 4)
  const ids = st.ids
  const known = ids ? ids.identified + ids.not : 0
  return (
    <details
      className="tri-overview"
      open={open}
      onToggle={(e) => {
        const o = (e.currentTarget as HTMLDetailsElement).open
        overviewOpen = o
        setOpen(o)
      }}
    >
      <summary className="section-label">Overview</summary>
      <section aria-label="Identifiability overview" className="tri-body">
        <p className="hint">
          From all {int(st.rows)} {set.subsampled ? 'sampled ' : ''}spectra of the table, whatever the filter below shows.
        </p>
        <ul className="tri-tiles" aria-label="Headline figures">
          <Tile label="MS2 spectra" value={int(st.rows)} note={set.subsampled ? 'Read from a subsample of the run.' : 'One row each in the table.'} />
          <Tile label="Processed" value={int(st.processed)} note={`${pct(share(st.processed, st.rows))} had peaks and a precursor.`} />
          <Tile
            lead
            label={`Strong tag (E ≤ ${thr})`}
            value={st.strong == null ? '—' : pct(share(st.strong, st.processed))}
            note={st.strong == null ? 'This table has no best_evalue column.' : `${int(st.strong)} of ${int(st.processed)} processed spectra.`}
          />
          <Tile
            label="Tagged"
            value={pct(share(st.tagged, st.processed))}
            note={
              <>
                {int(st.tagged)} spectra: a tag passed <Opt>-max_evalue{set.maxEvalue != null ? ` ${fmt(set.maxEvalue)}` : ''}</Opt>; not a quality call.
              </>
            }
          />
          {ids ? (
            <Tile
              label="Identified"
              value={pct(share(ids.identified, known))}
              note={
                `${int(ids.identified)} of ${int(known)} with a known state` +
                (ids.unknown ? `; ${int(ids.unknown)} unknown` : '') +
                (ids.candidates != null ? `; ${int(ids.candidates)} triage candidates` : '') +
                '.'
              }
            />
          ) : (
            <Tile off label="Identified" value="—" note={NO_IDS} />
          )}
        </ul>
        {st.processed === 0 ? (
          <p className="hint">No spectrum was processed: there is nothing to chart.</p>
        ) : (
          <div className="tri-charts">
            <LengthChart st={st} set={set} source={source} keep={tsv} />
            <PeaksChart st={st} source={source} keep={tsv} />
            <CoverageChart st={st} source={source} keep={tsv} />
          </div>
        )}
        {st.missing.length > 0 && (
          <p className="hint">
            Not in this table: {st.missing.join(', ')}. The parts that need {st.missing.length === 1 ? 'it' : 'them'} are left out.
          </p>
        )}
      </section>
    </details>
  )
}
