// The Spectrum tab (GUI-DESIGN S5, P4): one spectrum's peaks as FASTag
// tagged them (`-dump_spectrum`, through spectrum.rs spectrum_peaks), as a
// stick plot with zoom and pan, the ladder of the chosen tag drawn on them
// (ladder.ts) with the error of each step, and the tags of the spectrum,
// any of which redraws the ladder. ◀ and ▶ go to the previous and next
// tagged spectrum of the file.
//
// The peaks depend on the run's options (tolerance, centroiding,
// deisotoping, the peak budget), so the dump runs with the parameters the
// run was given: the run shown, else the run record of the file (History).
// A file with neither is dumped at FASTag's defaults, and the tab says so.
// No other reader: without the input there is "Locate input…".

import { useEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent, type PointerEvent, type WheelEvent } from 'react'
import { parseDump, type SpectrumPeaks } from './dump'
import { ladderFor, residueMasses, tagRowFrom, type Ladder } from './ladder'
import { baseName } from '../digestReport'
import { HelpLink } from '../help/HelpLink'
import type { ResultsView } from '../types'

export interface SpectrumTarget {
  // The tags file and the spectrum (its native ID).
  path: string
  spectrum: string
  // The file row of the tag that opened it: its ladder is drawn first.
  rowId: number | null
}

export interface SpectrumSource {
  // The spectra file the tags came from; null: not known.
  input: string | null
  // What the run was given (`run`'s params); null: not known.
  params: Record<string, unknown> | null
  // Where they came from, for the caveat.
  from: 'run' | 'history' | 'located' | 'none'
}

interface Props {
  target: SpectrumTarget
  source: SpectrumSource
  // Another spectrum of the file (◀ ▶).
  onTarget(t: SpectrumTarget): void
  // The input moved or is unknown: the user picks it.
  onLocate(input: string): void
}

type Peaks =
  | { state: 'loading' }
  | { state: 'ok'; spectrum: SpectrumPeaks; cached: boolean }
  | { state: 'missing'; reason: string }
  | { state: 'notFound'; reason: string }
  | { state: 'error'; reason: string }

interface TagsOf {
  columns: string[]
  rows: string[][]
  rowIds: (number | null)[]
}

const PER_SPECTRUM: ResultsView = { sort: null, perSpectrum: 1 }
const TAGS_SHOWN = 500
// One page of resultsQuery (browser.rs MAX_WINDOW).
const PAGE = 1000

const fmt = (x: number, d = 4): string => x.toFixed(d)
const ppm = (x: number | null): string => (x == null ? '–' : `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(1)}`)

/** The tags of @p spectrum in @p path, best E-value first: the exact ID
 *  (as a substring, scan=1 would also match scan=10..19, 100..199, ...),
 *  every page of them (a page holds at most PAGE rows). */
async function tagsOf(path: string, spectrum: string): Promise<TagsOf> {
  const view: ResultsView = { sort: { column: 'evalue', desc: false }, spectrum, spectrumExact: true }
  const out: TagsOf = { columns: [], rows: [], rowIds: [] }
  for (;;) {
    const page = await window.fastag.resultsQuery(path, view, out.rows.length, PAGE)
    out.columns = page.columns
    page.rows.forEach((r, i) => {
      out.rows.push(r)
      out.rowIds.push(page.rowIds?.[i] ?? null)
    })
    if (page.rows.length === 0 || out.rows.length >= page.matchedRows) return out
  }
}

/** The spectrum before (-1) or after (+1) @p spectrum in the file's order of
 *  tagged spectra, with the count; null at an end. */
async function neighbour(path: string, spectrum: string, rowId: number | null, dir: -1 | 1): Promise<{ spectrum: string; rowId: number | null } | null> {
  // The file row the per-spectrum view keeps for this spectrum (its best tag).
  const mine = await window.fastag.resultsQuery(path, { ...PER_SPECTRUM, spectrum, spectrumExact: true }, 0, 1)
  const sp = mine.columns.indexOf('spectrum')
  const i = mine.rows.findIndex((r) => r[sp] === spectrum)
  const row = i >= 0 ? (mine.rowIds?.[i] ?? null) : rowId
  if (row == null) return null
  const pos = await window.fastag.resultsPosition(path, PER_SPECTRUM, row)
  if (pos == null || pos < 0) return null
  const to = pos + dir
  if (to < 0) return null
  const page = await window.fastag.resultsQuery(path, PER_SPECTRUM, to, 1)
  if (page.rows.length === 0) return null
  return { spectrum: page.rows[0][page.columns.indexOf('spectrum')] ?? '', rowId: page.rowIds?.[0] ?? null }
}

export default function SpectrumPanel({ target, source, onTarget, onLocate }: Props): JSX.Element {
  const [peaks, setPeaks] = useState<Peaks>({ state: 'loading' })
  const [tags, setTags] = useState<TagsOf | null>(null)
  const [tagsError, setTagsError] = useState<string | null>(null)
  // The tag whose ladder is drawn: an index into tags.rows.
  const [chosen, setChosen] = useState<number>(0)
  const [nav, setNav] = useState<{ prev: boolean; next: boolean }>({ prev: false, next: false })
  const [navNote, setNavNote] = useState('')
  const [retry, setRetry] = useState(0)

  // The dump.
  useEffect(() => {
    let live = true
    setPeaks({ state: 'loading' })
    if (!source.input) return
    window.fastag
      .spectrumPeaks(source.input, target.spectrum, source.params)
      .then((d) => {
        if (!live) return
        if (d.missing) return setPeaks({ state: 'missing', reason: d.reason ?? `${source.input} is not there` })
        if (!d.ok) {
          const r = d.reason ?? (d.timedOut ? 'FASTag did not answer' : `FASTag exited ${d.code ?? '?'}`)
          return setPeaks(d.code === 6 && /no spectrum of/.test(r) ? { state: 'notFound', reason: r } : { state: 'error', reason: r })
        }
        const p = parseDump(d.stdout)
        setPeaks(p.ok ? { state: 'ok', spectrum: p.spectrum, cached: d.cached } : { state: 'error', reason: `FASTag's dump could not be read: ${p.error}` })
      })
      .catch((e: unknown) => live && setPeaks({ state: 'error', reason: e instanceof Error ? e.message : String(e) }))
    return () => {
      live = false
    }
  }, [source.input, source.params, target.spectrum, retry])

  // The tags of the spectrum, and where ◀ ▶ lead.
  useEffect(() => {
    let live = true
    setTags(null)
    setTagsError(null)
    tagsOf(target.path, target.spectrum)
      .then((t) => {
        if (!live) return
        setTags(t)
        const at = target.rowId != null ? t.rowIds.indexOf(target.rowId) : -1
        setChosen(at >= 0 ? at : 0)
      })
      .catch((e: unknown) => live && setTagsError(e instanceof Error ? e.message : String(e)))
    setNav({ prev: false, next: false })
    Promise.all([neighbour(target.path, target.spectrum, target.rowId, -1), neighbour(target.path, target.spectrum, target.rowId, 1)])
      .then(([p, n]) => live && setNav({ prev: !!p, next: !!n }))
      .catch(() => live && setNav({ prev: false, next: false }))
    return () => {
      live = false
    }
  }, [target.path, target.spectrum, target.rowId])

  const residues = useMemo(() => {
    const f = source.params?.['fixed_modifications']
    return residueMasses(Array.isArray(f) ? f.map(String) : undefined)
  }, [source.params])

  const spectrum = peaks.state === 'ok' ? peaks.spectrum : null
  const row = tags && tags.rows[chosen] ? tagRowFrom(tags.columns, tags.rows[chosen]) : null
  const ladder = spectrum && row ? ladderFor(row, spectrum, residues) : null

  async function go(dir: -1 | 1): Promise<void> {
    const n = await neighbour(target.path, target.spectrum, target.rowId, dir).catch(() => null)
    if (!n) {
      setNavNote(dir < 0 ? 'This is the first tagged spectrum.' : 'This is the last tagged spectrum.')
      return
    }
    setNavNote(`Spectrum ${n.spectrum}`)
    onTarget({ path: target.path, spectrum: n.spectrum, rowId: n.rowId })
  }

  async function locate(): Promise<void> {
    const p = await window.fastag.pickInput()
    if (p) onLocate(p)
  }

  const header = (
    <div className="sp-head">
      <h2 className="mono" title={target.spectrum}>
        {target.spectrum}
      </h2>
      {spectrum && (
        <span className="muted">
          {spectrum.precursor != null ? `precursor ${fmt(spectrum.precursor, 2)} ` : 'no precursor '}
          {spectrum.charge}+{spectrum.chargeGiven === 0 ? ' (assumed)' : ''} · {spectrum.mz.length} peaks (FASTag&apos;s processed peaks
          {spectrum.picked ? ', centroided' : ''}
          {spectrum.deisotoped ? ', deisotoped' : ''}) · tolerance {spectrum.tolerance} {spectrum.toleranceUnit}
        </span>
      )}
      <span className="spacer" />
      <button type="button" className="secondary" disabled={!nav.prev} onClick={() => void go(-1)} aria-label="Previous tagged spectrum">
        ◀ prev
      </button>
      <button type="button" className="secondary" disabled={!nav.next} onClick={() => void go(1)} aria-label="Next tagged spectrum">
        next ▶
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {navNote}
      </span>
    </div>
  )

  const caveats: string[] = []
  if (source.from === 'none' || source.params == null)
    caveats.push("The parameters of the run that wrote this table are not known, so the peaks are prepared with FASTag's defaults; with other options of that run they may differ.")
  if (residues.unknownFixed.length > 0)
    caveats.push(`The mass of the fixed modification ${residues.unknownFixed.join(', ')} is not known here; ladders over those residues may be off.`)

  let body: JSX.Element
  if (!source.input) {
    body = (
      <div className="empty-state">
        <h2>Which spectra file did these tags come from?</h2>
        <p>
          The table was opened from disk and no run of this app wrote it. Locate its input to see the spectrum
          with FASTag&apos;s processed peaks.
        </p>
        <button type="button" className="secondary big" onClick={() => void locate()}>
          Locate input…
        </button>
      </div>
    )
  } else if (peaks.state === 'loading') {
    body = (
      <div className="empty" role="status">
        Reading the spectrum with FASTag…
      </div>
    )
  } else if (peaks.state === 'missing' || peaks.state === 'notFound') {
    body = (
      <div className="banner warn" role="alert">
        <span>
          {peaks.state === 'missing' ? (
            <>
              <strong>Input not found.</strong> <code>{source.input}</code> is not there (moved or renamed?).
            </>
          ) : (
            <>
              <strong>Spectrum not found.</strong> <code>{baseName(source.input)}</code> has no spectrum{' '}
              <code>{target.spectrum}</code>: is it the file these tags came from?
            </>
          )}{' '}
          <button type="button" className="link" onClick={() => void locate()}>
            Locate input…
          </button>
        </span>
      </div>
    )
  } else if (peaks.state === 'error') {
    body = (
      <div className="banner error" role="alert">
        <span>
          <strong>No spectrum.</strong> {peaks.reason}{' '}
          <button type="button" className="link" onClick={() => setRetry((r) => r + 1)}>
            Try again
          </button>
        </span>
      </div>
    )
  } else {
    body = (
      <>
        <StickPlot spectrum={peaks.spectrum} ladder={ladder} />
        {ladder && <LadderLine ladder={ladder} tag={row?.tag ?? ''} />}
        {!row && tags && tags.rows.length > 0 && <p className="hint">This file has no nterm_mass, cterm_mass or charge column: no ladder can be drawn.</p>}
      </>
    )
  }

  return (
    <div className="sp" role="region" aria-label="Spectrum">
      {header}
      {caveats.map((c) => (
        <p className="hint sp-caveat" key={c}>
          {c}
        </p>
      ))}
      {body}
      <section className="sp-tags" aria-label="Tags of this spectrum">
        <h3>
          Tags of this spectrum{tags ? ` (n=${tags.rows.length.toLocaleString('en-US')})` : ''}
          <span className="hint"> · choose one to draw its ladder · <HelpLink to="results-spectrum">the Spectrum tab</HelpLink></span>
        </h3>
        {tagsError ? (
          <p className="hint">Cannot read the tags: {tagsError}</p>
        ) : !tags ? (
          <p className="hint">Reading…</p>
        ) : (
          <TagsTable tags={tags} chosen={chosen} onChoose={setChosen} spectrum={spectrum} residues={residues} />
        )}
      </section>
    </div>
  )
}

function TagsTable(p: {
  tags: TagsOf
  chosen: number
  onChoose(i: number): void
  spectrum: SpectrumPeaks | null
  residues: ReturnType<typeof residueMasses>
}): JSX.Element {
  const { tags, chosen } = p
  const col = (n: string): number => tags.columns.indexOf(n)
  const show = ['tag', 'length', 'charge', 'evalue', 'gapped', 'fasta_hit'].filter((c) => col(c) >= 0)
  const rows = tags.rows.slice(0, TAGS_SHOWN)
  function key(e: KeyboardEvent<HTMLTableRowElement>, i: number): void {
    const to = e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowUp' ? i - 1 : e.key === 'Enter' || e.key === ' ' ? i : -2
    if (to === -2 || to < 0 || to >= rows.length) return
    e.preventDefault()
    p.onChoose(to)
    const tr = (e.currentTarget.parentElement?.children[to] as HTMLElement | undefined) ?? null
    tr?.focus()
  }
  return (
    <div className="sp-tags-wrap">
      {/* A grid: aria-selected on a row is announced only in a grid (or a
          treegrid or listbox); one row is in the tab order (roving). */}
      <table className="history-table sp-tags-table" role="grid" aria-readonly="true" aria-label="Tags of this spectrum">
        <thead>
          <tr>
            {show.map((c) => (
              <th key={c} scope="col" role="columnheader">
                {c}
              </th>
            ))}
            <th scope="col" role="columnheader">
              ladder
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const tr = tagRowFrom(tags.columns, r)
            const l = tr && p.spectrum ? ladderFor(tr, p.spectrum, p.residues) : null
            return (
              <tr
                key={i}
                tabIndex={i === chosen ? 0 : -1}
                aria-selected={i === chosen}
                className={i === chosen ? 'on' : undefined}
                onClick={() => p.onChoose(i)}
                onKeyDown={(e) => key(e, i)}
              >
                {show.map((c) => (
                  <td key={c} role="gridcell" className={c === 'tag' ? 'mono' : c === 'fasta_hit' ? undefined : 'num'}>
                    {r[col(c)] ?? ''}
                  </td>
                ))}
                <td role="gridcell">{!l ? '–' : l.complete ? `${l.series} on ${l.matched}/${l.positions.length} peaks` : `not on the peaks (${l.matched}/${l.positions.length})`}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {tags.rows.length > TAGS_SHOWN && <p className="hint">The first {TAGS_SHOWN} of {tags.rows.length.toLocaleString('en-US')} tags by E-value.</p>}
    </div>
  )
}

function LadderLine({ ladder, tag }: { ladder: Ladder; tag: string }): JSX.Element {
  const steps = ladder.residues.map((res, k) => ({ res, to: ladder.positions[k + 1] }))
  return (
    <div className="sp-ladder" data-testid="ladder">
      {/* Polite: choosing another tag redraws the ladder and its verdict. */}
      <p aria-live="polite" aria-atomic="true">
        <strong>
          {ladder.series}-ladder <span className="mono">{tag}</span>
        </strong>{' '}
        {ladder.complete ? (
          <span data-testid="ladder-verdict">
            on {ladder.matched} of {ladder.positions.length} positions within the run&apos;s tolerance
          </span>
        ) : (
          <span className="warn-text" data-testid="ladder-verdict">
            not on the peaks: {ladder.reason}
          </span>
        )}
        {ladder.charge > 1 ? ` · fragment charge ${ladder.charge}+` : ''}
      </p>
      <ol className="sp-steps" aria-label="Ladder steps">
        <li>
          <span className="mono">{ladder.positions[0].mz != null ? fmt(ladder.positions[0].mz) : `(${fmt(ladder.positions[0].expected)})`}</span>
        </li>
        {steps.map((s, k) => (
          <li key={k} className={s.to.peak == null ? 'off' : undefined}>
            <span className="sp-res">—{s.res}—</span>
            <span className="mono">{s.to.mz != null ? fmt(s.to.mz) : `(${fmt(s.to.expected)} missing)`}</span>
            <span className="muted"> Δ {ppm(s.to.deltaPpm)} ppm</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

// The plot's frame (SVG user units; the element scales to its box).
const W = 1000
const H = 260
const PAD = { l: 48, r: 12, t: 28, b: 28 }

function StickPlot({ spectrum, ladder }: { spectrum: SpectrumPeaks; ladder: Ladder | null }): JSX.Element {
  const { mz, int } = spectrum
  const full = useMemo((): [number, number] => {
    if (mz.length === 0) return [0, 1]
    const pad = Math.max(1, (mz[mz.length - 1] - mz[0]) * 0.03)
    return [Math.max(0, mz[0] - pad), mz[mz.length - 1] + pad]
  }, [mz])
  const [range, setRange] = useState<[number, number]>(full)
  useEffect(() => setRange(full), [full])
  const drag = useRef<{ x: number; range: [number, number] } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const [lo, hi] = range
  const inView = (x: number): boolean => x >= lo && x <= hi
  let top = 0
  for (let i = 0; i < mz.length; i++) if (inView(mz[i]) && int[i] > top) top = int[i]
  if (top <= 0) top = 1
  const X = (x: number): number => PAD.l + ((x - lo) / (hi - lo)) * (W - PAD.l - PAD.r)
  const Y = (y: number): number => H - PAD.b - (y / top) * (H - PAD.t - PAD.b)
  const onLadder = new Set(ladder?.positions.map((p) => p.peak).filter((p): p is number => p != null))

  const zoom = (factor: number, at = (lo + hi) / 2): void => {
    const span = Math.min(full[1] - full[0], Math.max(0.5, (hi - lo) * factor))
    const f = (at - lo) / (hi - lo)
    let a = at - f * span
    a = Math.max(full[0], Math.min(full[1] - span, a))
    setRange([a, a + span])
  }
  const pan = (dx: number): void => {
    const span = hi - lo
    const a = Math.max(full[0], Math.min(full[1] - span, lo + dx))
    setRange([a, a + span])
  }
  const userX = (clientX: number): number => {
    const r = svgRef.current?.getBoundingClientRect()
    if (!r || r.width === 0) return (lo + hi) / 2
    const u = ((clientX - r.left) / r.width) * W
    return lo + ((u - PAD.l) / (W - PAD.l - PAD.r)) * (hi - lo)
  }
  function onWheel(e: WheelEvent<SVGSVGElement>): void {
    e.preventDefault()
    zoom(e.deltaY > 0 ? 1.25 : 0.8, userX(e.clientX))
  }
  function onDown(e: PointerEvent<SVGSVGElement>): void {
    drag.current = { x: e.clientX, range }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  function onMove(e: PointerEvent<SVGSVGElement>): void {
    const d = drag.current
    const r = svgRef.current?.getBoundingClientRect()
    if (!d || !r || r.width === 0) return
    const span = d.range[1] - d.range[0]
    const dx = -((e.clientX - d.x) / r.width) * (W / (W - PAD.l - PAD.r)) * span
    const a = Math.max(full[0], Math.min(full[1] - span, d.range[0] + dx))
    setRange([a, a + span])
  }
  function onKey(e: KeyboardEvent<SVGSVGElement>): void {
    const k = e.key
    if (k === '+' || k === '=') zoom(0.8)
    else if (k === '-' || k === '_') zoom(1.25)
    else if (k === 'ArrowLeft') pan(-(hi - lo) * 0.1)
    else if (k === 'ArrowRight') pan((hi - lo) * 0.1)
    else if (k === '0' || k === 'Home') setRange(full)
    else return
    e.preventDefault()
  }
  function toLadder(): void {
    const xs = ladder?.positions.map((p) => p.mz ?? p.expected) ?? []
    if (xs.length === 0) return
    const a = Math.min(...xs)
    const b = Math.max(...xs)
    const pad = Math.max(2, (b - a) * 0.15)
    setRange([Math.max(full[0], a - pad), Math.min(full[1], b + pad)])
  }

  // Axis ticks at a round step.
  const span = hi - lo
  const raw = span / 8
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw
  const ticks: number[] = []
  for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) ticks.push(t)

  const lp = ladder?.positions ?? []
  return (
    <div className="sp-plot">
      <div className="sp-plot-tools">
        <button type="button" className="secondary" onClick={() => zoom(0.8)} aria-label="Zoom in">
          +
        </button>
        <button type="button" className="secondary" onClick={() => zoom(1.25)} aria-label="Zoom out">
          −
        </button>
        <button type="button" className="secondary" onClick={toLadder} disabled={!ladder || lp.length === 0}>
          Zoom to ladder
        </button>
        <button type="button" className="secondary" onClick={() => setRange(full)}>
          Whole spectrum
        </button>
        <span className="hint">
          m/z {fmt(lo, 1)}–{fmt(hi, 1)} · wheel or +/− zooms, drag or ←/→ pans
        </span>
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="sp-svg"
        role="img"
        tabIndex={0}
        aria-label={`Stick plot of ${mz.length} peaks, m/z ${fmt(lo, 1)} to ${fmt(hi, 1)}${ladder ? `, ${ladder.matched} on the ladder` : ''}`}
        onWheel={onWheel}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onKeyDown={onKey}
      >
        <line x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} className="sp-axis" />
        {ticks.map((t) => (
          <g key={t}>
            <line x1={X(t)} x2={X(t)} y1={H - PAD.b} y2={H - PAD.b + 4} className="sp-axis" />
            <text x={X(t)} y={H - PAD.b + 16} className="sp-tick" textAnchor="middle">
              {Number(t.toFixed(6))}
            </text>
          </g>
        ))}
        {Array.from(mz, (x, i) =>
          inView(x) ? (
            <line
              key={i}
              x1={X(x)}
              x2={X(x)}
              y1={H - PAD.b}
              y2={Y(int[i])}
              className={onLadder.has(i) ? 'sp-peak on' : 'sp-peak'}
              data-peak={onLadder.has(i) ? 'ladder' : undefined}
            />
          ) : null
        )}
        {lp.map((p, k) => {
          const x = p.mz ?? p.expected
          if (!inView(x)) return null
          return p.peak == null ? (
            <line key={`m${k}`} x1={X(x)} x2={X(x)} y1={H - PAD.b} y2={PAD.t} className="sp-missing" />
          ) : null
        })}
        {ladder &&
          ladder.residues.map((res, k) => {
            const a = lp[k]
            const b = lp[k + 1]
            if (!a || !b) return null
            const xa = X(a.mz ?? a.expected)
            const xb = X(b.mz ?? b.expected)
            if (Math.max(xa, xb) < PAD.l || Math.min(xa, xb) > W - PAD.r) return null
            const y = PAD.t - 12
            return (
              <g key={`r${k}`}>
                <line x1={xa} x2={xb} y1={y} y2={y} className="sp-step" />
                <text x={(xa + xb) / 2} y={y - 4} className="sp-res-label" textAnchor="middle">
                  {res}
                </text>
              </g>
            )
          })}
      </svg>
    </div>
  )
}
