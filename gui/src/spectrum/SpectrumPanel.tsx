// The Spectrum tab (GUI-DESIGN S5, P4): one spectrum's peaks as FASTag
// tagged them (`-dump_spectrum`, through spectrum.rs spectrum_peaks), as a
// stick plot with zoom and pan, the ladder of the chosen tag drawn on them
// (ladder.ts) with the error of each step, and the tags of the spectrum,
// any of which redraws the ladder. Each ladder's series (b or y, c or z) is
// called from its peaks: a ions, a terminus only one reading lies at
// (terminus.ts), the database peptide when the run placed the tags.
// ◀ and ▶ (Alt+← and Alt+→, Page Up and Page Down) go to the previous and
// next spectrum in the Tags table's order as it was sorted and filtered when
// the spectrum was opened; opened from elsewhere (Triage), or a spectrum
// that order leaves out, each tagged spectrum of the file in file order.
//
// The peaks depend on the run's options (tolerance, centroiding,
// deisotoping, the peak budget), so the dump runs with the parameters the
// run was given: the run shown, else the run record of the file (History).
// A file with neither is dumped at FASTag's defaults, and the tab says so.
// No other reader: without the input there is "Locate input…".

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent, type PointerEvent, type WheelEvent } from 'react'
import { parseDump, type SpectrumPeaks } from './dump'
import { hasStep, ladderFor, laddersFor, residueMasses, seriesText, tagRowFrom, type Ladder, type SeriesCall } from './ladder'
import { TermSeq } from './TermSeq'
import { termContext, terminusMark, terminusOf, type TermContext, type Terminus } from './terminus'
import { pathOf } from './step'
import { dbCall, ladderSteps, likelyPeptide, rulerOf, stepOnRuler, ticksOf, type Candidate } from './peptide'
import { baseName } from '../digestReport'
import { EValue, columnLabel, hitCellText, spectrumHint } from '../ResultsTable'
import { dbCellsOf, dbHitTitle } from '../results/dbProteins'
import { DbAlignment } from './DbAlignment'
import { HelpLink } from '../help/HelpLink'
import type { NavAnswer, ResultsView } from '../types'

export interface SpectrumTarget {
  // The tags file and the spectrum (its native ID).
  path: string
  spectrum: string
  // The file row of the tag that opened it: its ladder is drawn first.
  rowId: number | null
  // The Tags table's view (sort and filters) it was opened from: ◀ ▶ walk
  // its order. Null or left out: every tagged spectrum in file order.
  view?: ResultsView | null
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
  // The tags table its tags are read from: the Tags tab's, or the tags
  // output of the run that wrote the ranking it was opened from; null: no
  // tags table is open (a ranking opened alone is not one). Left out, the
  // target's own file.
  tags?: string | null
  // The run's tag placements (-recon_out), when it wrote them: the peptide
  // most tags of the spectrum were placed on is drawn as a ruler.
  placements?: string | null
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

// The stick plot's frame (SVG user units; the element scales to its box).
// The left margin is at least PAD.l, wider when a label needs it (leftMargin).
const W = 1000
const PAD = { l: 48, r: 12, t: 56, b: 28 }
// A character of the plot's labels (.sp-series: 12px of the monospace
// --font-seq, about 0.6 em; 0.62 em leaves room), the gap between a label
// and the plot, and the room left of the label.
const LABEL_CHAR = 0.62 * 12
const LABEL_GAP = 6
const LABEL_INSET = 4

/** The plot's left margin (SVG user units) that fits each of @p labels, drawn
 *  right-aligned LABEL_GAP left of the plot: at least PAD.l, so a plot with
 *  short labels ("b", "y?") keeps its frame. @p measured: the widest label
 *  as the browser drew it, when it could measure it. */
export function leftMargin(labels: string[], measured = 0): number {
  const widest = Math.max(measured, ...labels.map((t) => t.length * LABEL_CHAR))
  return Math.max(PAD.l, Math.ceil(widest) + LABEL_GAP + LABEL_INSET)
}

/** The m/z range of the whole spectrum @p mz, with a margin. */
function fullRange(mz: number[]): [number, number] {
  if (mz.length === 0) return [0, 1]
  const pad = Math.max(1, (mz[mz.length - 1] - mz[0]) * 0.03)
  return [Math.max(0, mz[0] - pad), mz[mz.length - 1] + pad]
}

/// The ladder with the series the database peptide decides, when the run
/// placed this spectrum's tags on one (and more of its steps lie on one series).
function withDb(l: Ladder, cand: Candidate | null, s: SpectrumPeaks | null, residues: ReturnType<typeof residueMasses>): Ladder {
  const c = cand && s && l.positions.some((q) => q.peak != null) ? dbCall(cand, ladderSteps(l), l.charge, l.series, residues, s) : null
  return c ? { ...l, series: c.series, call: c } : l
}

/// A tag's residues from N to C terminus under @p series (b and c read up the
/// m/z axis, y and z down it); @p asc in ascending m/z.
export const nToC = (series: Ladder['series'], asc: string[]): string => (series === 'b' || series === 'c' ? asc : [...asc].reverse()).join('')
const callTitle = (call: SeriesCall | undefined): string | undefined =>
  call ? `${call.level === 'sure' ? 'Ion series' : call.level === 'likely' ? 'Ion series, likely' : 'Ion series not told apart'}: ${call.why}. FASTag writes a tag in ascending m/z without saying whether it read b or y ions; the series decides which way it reads N→C.` : undefined

/** A call of this panel to the browser backend. The backend lets a query
 *  of a new view spec cancel the view build in flight (browser.rs
 *  view_token: the Tags table's newer filter or sort supersedes the older
 *  one), and then rejects that call with "cancelled". The panel's calls
 *  supersede nothing: one cancelled by another view's query is asked again. */
async function retried<T>(call: () => Promise<T>): Promise<T> {
  for (let tries = 1; ; tries++) {
    try {
      return await call()
    } catch (e) {
      if (String(e) !== 'cancelled' || tries >= 5) throw e
    }
  }
}
const query = (...a: Parameters<typeof window.fastag.resultsQuery>): ReturnType<typeof window.fastag.resultsQuery> => retried(() => window.fastag.resultsQuery(...a))

/** The rows of @p spectrum in @p path, best E-value first (@p sort) or in
 *  file order: the exact ID (as a substring, scan=1 would also match
 *  scan=10..19, 100..199, ...), every page of them (a page holds at most
 *  PAGE rows). */
async function tagsOf(path: string, spectrum: string, sort: ResultsView['sort'] = { column: 'evalue', desc: false }): Promise<TagsOf> {
  const view: ResultsView = { sort, spectrum, spectrumExact: true }
  const out: TagsOf = { columns: [], rows: [], rowIds: [] }
  for (;;) {
    const page = await query(path, view, out.rows.length, PAGE)
    out.columns = page.columns
    page.rows.forEach((r, i) => {
      out.rows.push(r)
      out.rowIds.push(page.rowIds?.[i] ?? null)
    })
    if (page.rows.length === 0 || out.rows.length >= page.matchedRows) return out
  }
}

/// Another spectrum ◀ ▶ lead to: its first row in the order walked (its
/// ladder is drawn first), and that order (null: all tagged spectra).
export interface Step {
  spectrum: string
  rowId: number | null
  view: ResultsView | null
}
/// The order ◀ ▶ walk, where the spectrum shown sits in it and the spectra
/// either side: one answer of results_neighbours, so all of one snapshot
/// of the file (browser.rs neighbours).
interface Order {
  view: ResultsView
  pos: number
  matched: number
  snapshot: number
  prev: Step | null
  next: Step | null
}
// A view waiting for the E-value order (browser.rs D5, pending) is not
// in its final order yet, so its positions are not known: asked again this often.
export const RANK_WAIT = { ms: 250, tries: 40 }
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/// Where a spectrum sits in a view, as far as it is known: at a position of
/// a ranked (or final) snapshot of the view, confirmed absent from it (in
/// snapshot @p snapshot), still waiting for its E-value order (D5 pending)
/// after RANK_WAIT, or a lookup that failed. Pending and failed are not
/// absence: nothing falls back on them.
type Lookup = { kind: 'at'; order: Order } | { kind: 'absent'; snapshot: number } | { kind: 'pending' } | { kind: 'failed'; reason: string }
const reasonOf = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** Where @p target sits in @p view (its row, else, that row not in the
 *  view or of another spectrum, the spectrum's first row there) and the
 *  spectra either side, in one call that the backend answers from one
 *  snapshot of the file: a file rewritten meanwhile (a rerun) cannot give a
 *  position of one file and the neighbours of another. A view not in its
 *  final order yet is asked again, RANK_WAIT. */
async function lookupIn(path: string, view: ResultsView, target: SpectrumTarget): Promise<Lookup> {
  const stepView = view === PER_SPECTRUM ? null : view
  const step = (n: { spectrum: string; rowId: number } | null): Step | null => (n ? { spectrum: n.spectrum, rowId: n.rowId, view: stepView } : null)
  for (let tries = 1; ; tries++) {
    let a: NavAnswer
    try {
      a = await retried(() => window.fastag.resultsNeighbours(path, view, target.rowId, target.spectrum))
    } catch (e) {
      return { kind: 'failed', reason: reasonOf(e) }
    }
    if (a.status === 'at') return { kind: 'at', order: { view, pos: a.pos, matched: a.matched, snapshot: a.snapshot, prev: step(a.prev), next: step(a.next) } }
    if (a.status === 'absent') return { kind: 'absent', snapshot: a.snapshot }
    if (tries >= RANK_WAIT.tries) return { kind: 'pending' }
    await sleep(RANK_WAIT.ms)
  }
}

/// The order ◀ ▶ walk, and how it was found.
interface Walk {
  // Null: none (status ok: the spectrum is in no order walked).
  order: Order | null
  // 'absent': the spectrum is confirmed not in the Tags table's view, so
  // ◀ ▶ walk each tagged spectrum in file order.
  fellBack: 'absent' | null
  status: 'ok' | 'pending' | 'failed'
  reason?: string
}

/** The order ◀ ▶ walk from @p target: the Tags table's view it was opened
 *  from (its sort and filters); each tagged spectrum once in file order when
 *  it was opened without one, or the spectrum is confirmed absent from it.
 *  A view still waiting for its E-value order, or a lookup that failed, is
 *  said so: the file order is not walked in its place. Absent from the
 *  table's view is taken only of the snapshot the file order is then read
 *  from: of another (the file was rewritten between the two answers), the
 *  lookup starts again, at most RANK_WAIT.tries times. */
async function orderOf(path: string, target: SpectrumTarget): Promise<Walk> {
  for (let tries = 1; ; tries++) {
    let fellBack: Walk['fellBack'] = null
    let absentIn: number | null = null
    if (target.view) {
      const l = await lookupIn(path, target.view, target)
      if (l.kind === 'at') return { order: l.order, fellBack: null, status: 'ok' }
      if (l.kind === 'pending') return { order: null, fellBack: null, status: 'pending' }
      if (l.kind === 'failed') return { order: null, fellBack: null, status: 'failed', reason: l.reason }
      fellBack = 'absent'
      absentIn = l.snapshot
    }
    const l = await lookupIn(path, PER_SPECTRUM, target)
    const of = l.kind === 'at' ? l.order.snapshot : l.kind === 'absent' ? l.snapshot : null
    if (absentIn != null && of != null && of !== absentIn) {
      if (tries >= RANK_WAIT.tries) return { order: null, fellBack: null, status: 'failed', reason: 'the tags file kept changing while it was read' }
      continue
    }
    if (l.kind === 'at') return { order: l.order, fellBack, status: 'ok' }
    if (l.kind === 'pending') return { order: null, fellBack, status: 'pending' }
    if (l.kind === 'failed') return { order: null, fellBack, status: 'failed', reason: l.reason }
    return { order: null, fellBack, status: 'ok' }
  }
}

/// Where ◀ ▶ lead: undefined while it is looked up, null at an end.
interface Nav {
  prev: Step | null | undefined
  next: Step | null | undefined
  // The spectrum shown in that order: row (or spectrum) k of n.
  at: { k: number; n: number; spectra: boolean } | null
  // loading: being looked up (or superseded); ok: prev and next are known
  // (null: an end); pending: the E-value order is still being built;
  // failed: the lookup failed (reason). Only ok has ends.
  status: 'loading' | 'ok' | 'pending' | 'failed'
  // The order walked is the Tags table's (false: each tagged spectrum in file order).
  table: boolean
  // The spectrum is not in the Tags table's view: file order in its place.
  fellBack: boolean
  reason?: string
}
const NAV0: Nav = { prev: undefined, next: undefined, at: null, status: 'loading', table: false, fellBack: false }

/** Where ◀ ▶ lead from @p target in @p path; @p live: false once the
 *  panel shows another spectrum (the lookup stops, as loading). */
async function navOf(path: string, target: SpectrumTarget, live: () => boolean): Promise<Nav> {
  if (!live()) return NAV0
  const w = await orderOf(path, target)
  const base = { prev: null, next: null, at: null, table: false, fellBack: w.fellBack === 'absent' }
  if (w.status !== 'ok') return { ...base, status: w.status, reason: w.reason }
  const o = w.order
  if (!o) return { ...base, status: 'ok' }
  if (!live()) return NAV0
  return {
    ...base,
    prev: o.prev,
    next: o.next,
    at: { k: o.pos + 1, n: o.matched, spectra: o.view.perSpectrum === 1 },
    status: 'ok',
    table: o.view !== PER_SPECTRUM
  }
}

const typingIn = (t: EventTarget | null): boolean => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))

export default function SpectrumPanel({ target, source, tags: tagsFile, placements, onTarget, onLocate }: Props): JSX.Element {
  const tagsPath = tagsFile === undefined ? target.path : tagsFile
  const [peaks, setPeaks] = useState<Peaks>({ state: 'loading' })
  const [tags, setTags] = useState<TagsOf | null>(null)
  const [tagsError, setTagsError] = useState<string | null>(null)
  // The tag whose ladder is drawn: an index into tags.rows.
  const [chosen, setChosen] = useState<number>(0)
  const [nav, setNav] = useState<Nav>(NAV0)
  // The lookup of where ◀ ▶ lead, for a press before it is done.
  const navRef = useRef<Promise<Nav> | null>(null)
  // The lookup in flight: a newer one (another spectrum, Try again) supersedes it.
  const navGen = useRef(0)
  const [navNote, setNavNote] = useState('')
  const [retry, setRetry] = useState(0)
  const [cand, setCand] = useState<Candidate | null>(null)

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
    setNav(NAV0)
    setCand(null)
    navRef.current = null
    const gen = ++navGen.current
    // The tags first, then where ◀ ▶ lead: one view build at a time, so the
    // panel's own queries do not cancel each other (see query()).
    if (!tagsPath) return
    let done: (n: Nav) => void = () => undefined
    navRef.current = new Promise<Nav>((r) => (done = r))
    tagsOf(tagsPath, target.spectrum)
      .then((t) => {
        if (!live) return
        setTags(t)
        const at = target.rowId != null ? t.rowIds.indexOf(target.rowId) : -1
        setChosen(at >= 0 ? at : 0)
      })
      .catch((e: unknown) => live && setTagsError(e instanceof Error ? e.message : String(e)))
      // The peptide the run placed this spectrum's tags on (first page). No
      // Results table has -recon_out open while the Spectrum tab shows:
      // resultsQuery would refuse it ("cancelled"), tableQuery reads it.
      .then(() => (placements ? window.fastag.tableQuery(placements, { spectrum: target.spectrum, spectrumExact: true }, 0, PAGE) : null))
      .then((pg) => live && pg && setCand(likelyPeptide(pg.columns, pg.rows)))
      .catch(() => undefined)
      // Last, where ◀ ▶ lead (it may wait for the E-value order); one
      // lookup after the other.
      .then(() => navOf(tagsPath, target, () => live && navGen.current === gen))
      .catch((e: unknown): Nav => ({ ...NAV0, prev: null, next: null, status: 'failed', reason: reasonOf(e) }))
      .then((n) => {
        done(n)
        if (live && navGen.current === gen) setNav(n)
      })
    return () => {
      live = false
      done(NAV0)
    }
    // target.view: the order is the one it was opened with.
  }, [tagsPath, placements, target.spectrum, target.rowId, target.view])

  const residues = useMemo(() => {
    const f = source.params?.['fixed_modifications']
    return residueMasses(Array.isArray(f) ? f.map(String) : undefined)
  }, [source.params])

  const spectrum = peaks.state === 'ok' ? peaks.spectrum : null
  // The run's termini and isotope offsets, for the series call and the terminus mark.
  const tctx = useMemo(() => termContext(source.params, residues), [source.params, residues])
  const row = useMemo(() => (tags && tags.rows[chosen] ? tagRowFrom(tags.columns, tags.rows[chosen]) : null), [tags, chosen])
  const { ladder, one } = useMemo(() => {
    const lads = spectrum && row ? laddersFor(row, spectrum, residues, tctx) : null
    if (!lads) return { ladder: null, one: [] as Ladder[] }
    const best = withDb(lads.best, cand, spectrum, residues)
    // Each ladder with a step on the peaks gets its own line (#127).
    return { ladder: best, one: lads.both.filter((l) => l === lads.best || hasStep(l)).map((l) => (l === lads.best ? best : withDb(l, cand, spectrum, residues))) }
  }, [spectrum, row, residues, tctx, cand])
  // Where the tag drawn lies against the peptide's termini, under its series.
  const term = useMemo((): Terminus | undefined => (spectrum && ladder ? terminusOf(pathOf(ladder), spectrum, residues, tctx) : undefined), [spectrum, ladder, residues, tctx])
  const termMarks = useMemo(() => {
    const mk = spectrum && ladder && term ? terminusMark(pathOf(ladder), term, spectrum, residues, tctx) : null
    return mk ? [mk] : []
  }, [spectrum, ladder, term, residues, tctx])
  // The peptide's fragments in the layer of the tag drawn.
  const ruler = useMemo(() => (cand && ladder && ladder.charge > 0 ? rulerOf(cand, ladder.series, ladder.charge, residues) : null), [cand, ladder, residues])
  // Mass errors of the tag drawn.
  const strip = useMemo((): ErrorStrip | null => {
    if (!spectrum || !ladder || !ladder.complete) return null
    const ppmUnit = spectrum.toleranceUnit === 'ppm'
    const mzOf = (p: Ladder['positions'][number]): number => p.mz ?? p.expected
    const steps: StripPoint[] = []
    const drift: StripPoint[] = [{ mz: mzOf(ladder.positions[0]), value: 0 }]
    let cum = 0
    let from = ladder.positions[0]
    for (const p of ladder.positions.slice(1)) {
      if (p.peak == null || p.deltaMz == null) continue
      cum += p.deltaMz
      steps.push({ mz: (mzOf(from) + mzOf(p)) / 2, value: ppmUnit ? (p.deltaPpm ?? 0) : p.deltaMz })
      drift.push({ mz: mzOf(p), value: ppmUnit ? (cum / mzOf(p)) * 1e6 : cum })
      from = p
    }
    const onPeptide: StripPoint[] = []
    if (ruler && ruler.series === ladder.series && ruler.charge === ladder.charge) {
      const peaks = ladder.positions.map((p) => p.peak).filter((p): p is number => p != null)
      ticksOf(ruler, peaks, spectrum).forEach((t, k) => {
        if (t < 0) return
        const x = spectrum.mz[peaks[k]]
        const d = x - (ruler.ticks[t] as number)
        onPeptide.push({ mz: x, value: ppmUnit ? (d / x) * 1e6 : d })
      })
    }
    return { unit: spectrum.toleranceUnit, tolerance: spectrum.tolerance, steps, drift, onPeptide }
  }, [spectrum, ladder, ruler])
  const plotRuler = useMemo((): PlotRuler | null => {
    if (!ruler || !spectrum) return null
    // Bold: the residues the tag drawn reads as the peptide has them.
    const on = ruler.residues.map(() => false)
    for (const st of ladder ? ladderSteps(ladder) : []) {
      if (!stepOnRuler(st, ruler, spectrum)) continue
      const [a, b] = ticksOf(ruler, [st.u, st.v], spectrum)
      for (let k = a; k < b; k++) on[k] = true
    }
    return { label: `${ruler.series}${ruler.charge > 1 ? ` ${ruler.charge}+` : ''} DB`, ticks: ruler.ticks, residues: ruler.residues, on }
  }, [ruler, spectrum, ladder])

  // Where ◀ ▶ lead once more, after the E-value order was not ready or the
  // lookup failed (the tags are read already: only the lookup runs).
  function retryNav(): void {
    if (!tagsPath) return
    const gen = ++navGen.current
    setNav(NAV0)
    setNavNote('')
    const p = navOf(tagsPath, target, () => navGen.current === gen).catch((e: unknown): Nav => ({ ...NAV0, prev: null, next: null, status: 'failed', reason: reasonOf(e) }))
    navRef.current = p
    void p.then((n) => navGen.current === gen && setNav(n))
  }
  // In which order ◀ ▶ walk, for their tooltips and the notes: the order
  // walked once it is known; before, the one it was opened with.
  const tableOrder = 'in the Tags table order'
  const fileOrder = 'with tags, in file order'
  const fellBackWords = `${fileOrder} (this spectrum is not in the Tags table's filtered view)`
  const orderWords = (n: Nav): string => (n.status !== 'ok' ? (target.view ? tableOrder : fileOrder) : n.table ? tableOrder : n.fellBack ? fellBackWords : fileOrder)
  // Why ◀ ▶ do not lead anywhere yet (pending, failed); null: they may.
  const navBlocked = (n: Nav): string | null =>
    n.status === 'pending'
      ? `The E-value order of ${target.view ? 'the Tags table' : 'the tagged spectra'} is still being built; try again in a moment.`
      : n.status === 'failed'
        ? `Could not look up the neighbouring spectra: ${n.reason ?? 'unknown error'}.`
        : null
  const endNote = (n: Nav, dir: -1 | 1): string => {
    const end = dir < 0 ? 'first' : 'last'
    return n.table ? `This is the ${end} spectrum in the Tags table order.` : `This is the ${end} tagged spectrum${n.fellBack ? " in file order (this spectrum is not in the Tags table's filtered view)" : ''}.`
  }
  const blocked = navBlocked(nav)
  // Said once it is known, as the end notes are when pressed.
  useEffect(() => {
    if (blocked) setNavNote(blocked)
  }, [blocked])
  async function go(dir: -1 | 1): Promise<void> {
    const pending = navRef.current
    const r = pending ? await pending : null
    // Superseded (another spectrum is shown) or nothing to walk.
    if (!r || r.status === 'loading') return
    const why = navBlocked(r)
    if (why) {
      setNavNote(why)
      return
    }
    const n = dir < 0 ? r.prev : r.next
    if (!n) {
      setNavNote(endNote(r, dir))
      return
    }
    setNavNote(`Spectrum ${spectrumHint(n.spectrum) || n.spectrum}`)
    onTarget({ path: target.path, spectrum: n.spectrum, rowId: n.rowId, view: n.view })
  }
  // Alt+← and Alt+→, Page Up and Page Down, with the focus anywhere in the
  // panel but a text field (the plot keeps ← and → to pan, the tags list its
  // scroll), or on what holds the panel (the view, the page: WebKit does not
  // focus a button clicked), not in another part of the window.
  const rootRef = useRef<HTMLDivElement>(null)
  const keyRef = useRef<(e: globalThis.KeyboardEvent) => void>(() => undefined)
  keyRef.current = (e) => {
    const t = e.target
    const root = rootRef.current
    if (e.defaultPrevented || typingIn(t) || e.metaKey || e.ctrlKey || e.shiftKey || !root) return
    if (!(t instanceof Node && (root.contains(t) || t.contains(root)))) return
    const page = !e.altKey && (e.key === 'PageUp' || e.key === 'PageDown')
    if (page && t instanceof Element && t.closest('.sp-tags-wrap')) return
    const dir = page ? (e.key === 'PageUp' ? -1 : 1) : e.altKey && e.key === 'ArrowLeft' ? -1 : e.altKey && e.key === 'ArrowRight' ? 1 : 0
    if (dir === 0) return
    e.preventDefault()
    if (blocked) {
      setNavNote(blocked)
      return
    }
    if (nav.status === 'ok' && (dir < 0 ? nav.prev : nav.next) === null) {
      setNavNote(endNote(nav, dir))
      return
    }
    void go(dir)
  }
  useEffect(() => {
    const on = (e: globalThis.KeyboardEvent): void => keyRef.current(e)
    document.addEventListener('keydown', on)
    return () => document.removeEventListener('keydown', on)
  }, [])

  async function locate(): Promise<void> {
    const p = await window.fastag.pickInput()
    if (p) onLocate(p)
  }

  const header = (
    <div className="sp-head">
      <h2 className="mono" title={target.spectrum} tabIndex={-1}>
        {spectrumHint(target.spectrum) || target.spectrum}
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
      {nav.at && (
        <span
          className="hint"
          data-testid="nav-at"
          title={
            nav.table
              ? 'Where this spectrum is in the Tags table order'
              : `Where this spectrum is among the tagged spectra of the file${nav.fellBack ? ", in file order (this spectrum is not in the Tags table's filtered view)" : ''}`
          }
        >
          {nav.at.spectra ? 'spectrum' : 'tag'} {nav.at.k.toLocaleString('en-US')} of {nav.at.n.toLocaleString('en-US')}
        </span>
      )}
      {blocked && (
        <button type="button" className="secondary" onClick={retryNav} title={blocked} aria-label="Look up the previous and next spectrum again">
          Try again
        </button>
      )}
      <button
        type="button"
        className="secondary"
        disabled={!!blocked || nav.prev === null}
        onClick={() => void go(-1)}
        aria-label="Previous tagged spectrum"
        aria-keyshortcuts="Alt+ArrowLeft PageUp"
        title={blocked ?? `Previous spectrum ${orderWords(nav)} (Alt+← or Page Up)`}
      >
        ◀ prev
      </button>
      <button
        type="button"
        className="secondary"
        disabled={!!blocked || nav.next === null}
        onClick={() => void go(1)}
        aria-label="Next tagged spectrum"
        aria-keyshortcuts="Alt+ArrowRight PageDown"
        title={blocked ?? `Next spectrum ${orderWords(nav)} (Alt+→ or Page Down)`}
      >
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
        <StickPlot spectrum={peaks.spectrum} ladder={ladder} lines={one} ruler={plotRuler} strip={strip} marks={termMarks} />
        {cand && (
          <p className="hint sp-peptide" data-testid="peptide">
            Tags placed on <strong className="mono">{cand.peptide}</strong>
            {cand.protein ? ` (${cand.protein.split(' ')[0]})` : ''}: {cand.tags} tag{cand.tags === 1 ? '' : 's'}, {cand.exact} exactly
            {cand.delta !== 0 ? `; mass left over ${cand.delta >= 0 ? '+' : '−'}${Math.abs(cand.delta).toFixed(4)} Da${cand.region ? ` in residues ${cand.region[0] + 1}–${cand.region[1] + 1}` : ''}` : ''}
            {cand.of > 1 ? ` · ${cand.of - 1} other peptide${cand.of === 2 ? '' : 's'} with fewer tags` : ''}. A candidate from the database placement, not an identification
            {plotRuler ? '; its fragments are the top row of the plot' : ''}.
          </p>
        )}
        {ladder && <LadderLine ladder={ladder} tag={nToC(ladder.series, ladder.residues)} terminus={term} written={row?.tag} unit={peaks.spectrum.toleranceUnit} />}
        {!row && tags && tags.rows.length > 0 && <p className="hint">This file has no nterm_mass, cterm_mass or charge column: no ladder can be drawn.</p>}
      </>
    )
  }

  return (
    <div className="sp" role="region" aria-label="Spectrum" ref={rootRef}>
      {header}
      {caveats.map((c) => (
        <p className="hint sp-caveat" key={c}>
          {c}
        </p>
      ))}
      {body}
      {tags && <DbAlignment columns={tags.columns} rows={tags.rows} tags={tagsPath} params={source.params} chosen={chosen} onChoose={setChosen} />}
      <section className="sp-tags" aria-label="Tags of this spectrum">
        <h3>
          Tags of this spectrum{tags ? ` (n=${tags.rows.length.toLocaleString('en-US')})` : ''}
          {tagsPath && <span className="hint"> · choose one to draw its ladder</span>}
        </h3>
        {!tagsPath ? (
          <p className="hint">Tags file not opened: open the run's tags table to see the tags of this spectrum.</p>
        ) : tagsError ? (
          <p className="hint">Cannot read the tags: {tagsError}</p>
        ) : !tags ? (
          <p className="hint">Reading…</p>
        ) : (
          <TagsTable tags={tags} chosen={chosen} onChoose={setChosen} spectrum={spectrum} residues={residues} ctx={tctx} cand={cand} />
        )}
      </section>
    </div>
  )
}

// The columns of the tags table that hold numbers: right-aligned, header too.
const NUMERIC = new Set(['length', 'charge', 'evalue', 'gapped'])

function TagsTable(p: {
  tags: TagsOf
  chosen: number
  onChoose(i: number): void
  spectrum: SpectrumPeaks | null
  residues: ReturnType<typeof residueMasses>
  ctx: TermContext
  cand?: Candidate | null
}): JSX.Element {
  const { tags, chosen } = p
  const col = (n: string): number => tags.columns.indexOf(n)
  // No Database column for a run without a database filter: every cell '-'.
  const noDb = col('fasta_hit') >= 0 && tags.rows.every((r) => (r[col('fasta_hit')] ?? '-') === '-' || r[col('fasta_hit')] === '')
  const show = ['tag', 'length', 'charge', 'evalue', 'gapped', 'fasta_hit'].filter((c) => col(c) >= 0 && !(c === 'fasta_hit' && noDb))
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
              <th key={c} scope="col" role="columnheader" className={NUMERIC.has(c) ? 'num' : undefined} title={c}>
                {columnLabel(c)}
              </th>
            ))}
            <th scope="col" role="columnheader">
              Ladder
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const tr = tagRowFrom(tags.columns, r)
            const l = tr && p.spectrum ? withDb(ladderFor(tr, p.spectrum, p.residues, p.ctx), p.cand ?? null, p.spectrum, p.residues) : null
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
                  <td
                    key={c}
                    role="gridcell"
                    className={c === 'tag' ? 'mono' : NUMERIC.has(c) ? 'num' : undefined}
                    title={c === 'fasta_hit' ? dbHitTitle(r[col(c)] ?? '', dbCellsOf(tags.columns, r)) : undefined}
                  >
                    {c === 'evalue' ? <EValue text={r[col(c)] ?? ''} /> : c === 'fasta_hit' ? hitCellText(tags.columns, r, r[col(c)] ?? '') : (r[col(c)] ?? '')}
                  </td>
                ))}
                <td role="gridcell">{!l ? '–' : l.complete ? `${seriesText(l.series, l.call)} on ${l.matched}/${l.positions.length} peaks` : `not on the peaks (${l.matched}/${l.positions.length})`}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {tags.rows.length > TAGS_SHOWN && <p className="hint">The first {TAGS_SHOWN} of {tags.rows.length.toLocaleString('en-US')} tags by E-value.</p>}
    </div>
  )
}

/// A step's distance from where it should be, in the run's tolerance unit
/// (a Da run's +0.12 Da, not +160.8 ppm), the other unit in its tooltip.
function StepDelta({ to, unit }: { to: Ladder['positions'][number]; unit: string }): JSX.Element {
  const da = to.deltaMz == null ? '–' : `${to.deltaMz >= 0 ? '+' : '−'}${Math.abs(to.deltaMz).toFixed(3)}`
  return unit === 'Da' ? (
    <span className="muted" title={`${ppm(to.deltaPpm)} ppm`}> Δ {da} Da</span>
  ) : (
    <span className="muted" title={`${da} Da`}> Δ {ppm(to.deltaPpm)} ppm</span>
  )
}

/// The tag's ladder and its verdict. A ladder that could not be built (a
/// modification without a known mass, a tag that does not parse) has no
/// positions: then only the verdict with its reason is shown.
export function LadderLine({ ladder, tag, unit, written, terminus }: { ladder: Ladder; tag: string; unit: string; written?: string; terminus?: Terminus }): JSX.Element {
  const steps = ladder.residues.map((res, k) => ({ res, to: ladder.positions[k + 1] }))
  return (
    <div className="sp-ladder" data-testid="ladder">
      {/* Polite: choosing another tag redraws the ladder and its verdict. */}
      <p aria-live="polite" aria-atomic="true">
        <strong title={callTitle(ladder.call)}>
          {seriesText(ladder.series, ladder.call)} ions{ladder.call?.level === 'open' ? ` (read as ${ladder.series})` : ''}: <span className="mono">
            <TermSeq seq={tag} t={terminus} />
          </span>{' '}
          N→C
        </strong>
        {written && written !== tag && <span className="muted"> (written {written})</span>}{' '}
        {ladder.complete ? (
          <span data-testid="ladder-verdict">
            on {ladder.matched} of {ladder.positions.length} positions within the run&apos;s tolerance
          </span>
        ) : ladder.positions.length === 0 ? (
          <span className="warn-text" data-testid="ladder-verdict">
            no ladder: {ladder.reason}
          </span>
        ) : (
          <span className="warn-text" data-testid="ladder-verdict">
            not on the peaks: {ladder.reason}
          </span>
        )}
        {ladder.charge > 1 ? ` · fragment charge ${ladder.charge}+` : ''}
      </p>
      {ladder.positions.length > 0 && (
        <ol className="sp-steps" aria-label="Ladder steps">
          <li>
            <span className="mono">{ladder.positions[0].mz != null ? fmt(ladder.positions[0].mz) : `(${fmt(ladder.positions[0].expected)})`}</span>
          </li>
          {steps.map((s, k) => (
            <li key={k} className={s.to.peak == null ? 'off' : undefined}>
              <span className="sp-res">—{s.res}—</span>
              <span className="mono">{s.to.mz != null ? fmt(s.to.mz) : `(${fmt(s.to.expected)} missing)`}</span>
              <StepDelta to={s.to} unit={unit} />
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

// The tag lines above the peaks: the N-terminal series (b, c) on the upper,
// the C-terminal one (y, z) on the lower.
const LINE_Y = (series: Ladder['series']): number => (series === 'b' || series === 'c' ? 18 : 42)
const ROW_H = 24
/// The database peptide's fragments in one layer, drawn as the top row.
export interface PlotRuler {
  label: string
  ticks: (number | null)[]
  residues: string[]
  // Residues the tag drawn reads as the peptide has them.
  on: boolean[]
}
export interface StripPoint {
  mz: number
  value: number
}
/// Mass errors under the plot, in the run's tolerance unit.
export interface ErrorStrip {
  unit: string
  tolerance: number
  // Each step of the tag drawn: observed minus expected distance of its peaks.
  steps: StripPoint[]
  // The same, summed from the tag's first peak.
  drift: StripPoint[]
  // Its peaks against the peptide's fragments.
  onPeptide: StripPoint[]
}
const STRIP_H = 64

/** A residue step's tooltip: the m/z of its two peaks and how far their
 *  distance is from the residue's (observed minus expected), e.g.
 *  "G: m/z 158.0920 → 215.1135, Δ +0.0012 Da (+5.6 ppm)". */
export function stepWords(res: string, a: Ladder['positions'][number], b: Ladder['positions'][number], unit: string): string {
  const at = (p: Ladder['positions'][number]): string => (p.mz != null ? fmt(p.mz) : `${fmt(p.expected)} (no peak)`)
  const both = a.peak != null && b.peak != null && b.deltaMz != null
  const da = both ? `${b.deltaMz! >= 0 ? '+' : '−'}${Math.abs(b.deltaMz!).toFixed(4)} Da` : ''
  const delta = !both ? '' : unit === 'Da' ? `, Δ ${da} (${ppm(b.deltaPpm)} ppm)` : `, Δ ${ppm(b.deltaPpm)} ppm (${da})`
  return `${res}: m/z ${at(a)} → ${at(b)}${delta}`
}

export function StickPlot({
  spectrum,
  ladder,
  lines = ladder ? [ladder] : [],
  ruler = null,
  strip = null,
  marks = []
}: {
  spectrum: SpectrumPeaks
  ladder: Ladder | null
  // The ladders drawn, each on its own line: b/c on the upper, y/z on the lower.
  lines?: Ladder[]
  ruler?: PlotRuler | null
  strip?: ErrorStrip | null
  // Ticks at the terminus of the tag drawn (terminus.ts terminusMark), drawn when in view.
  marks?: { mz: number; label: string; words: string; away: boolean }[]
}): JSX.Element {
  const { mz, int } = spectrum
  // By default b/c on the upper line, y/z on the lower; two ladders judged the same series (or not told apart) one above the other.
  const byRow = lines.map((l) => (LINE_Y(l.series) === 18 ? 0 : 1))
  if (lines.length === 2 && byRow[0] === byRow[1]) byRow.splice(0, 2, 0, 1)
  const rowOf = (i: number): number => byRow[i]
  const nRows = Math.max(2, ...lines.map((_, i) => rowOf(i) + 1))
  // The peptide ruler takes the first row.
  const top0 = 18 + (ruler ? ROW_H : 0)
  const lineY = (i: number): number => top0 + rowOf(i) * ROW_H
  const padT = top0 + (nRows - 1) * ROW_H + 14
  // The plot's own height; the error strip hangs below the axis.
  const HP = 260 - PAD.t + padT
  const H = HP + (strip ? STRIP_H : 0)
  const full = useMemo(() => fullRange(mz), [mz])
  const [range, setRange] = useState<[number, number]>(full)
  useEffect(() => setRange(full), [full])
  const drag = useRef<{ x: number; range: [number, number] } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const [lo, hi] = range
  const inView = (x: number): boolean => x >= lo && x <= hi
  let top = 0
  for (let i = 0; i < mz.length; i++) if (inView(mz[i]) && int[i] > top) top = int[i]
  if (top <= 0) top = 1
  // The error strip: zero in the middle, the scale wide enough for every value.
  const sMax = strip ? Math.max(strip.tolerance, ...[...strip.steps, ...strip.drift, ...strip.onPeptide].map((q) => Math.abs(q.value))) * 1.1 || 1 : 1
  const num = (v: number): string => (strip?.unit === 'Da' ? v.toFixed(3) : v.toFixed(1))
  // The labels left of the plot: each line's series ("b or y?"), the
  // ruler's ("y 2+ DB"), the strip's scale. The margin fits the widest, as
  // estimated (monospace) or as the browser measured it.
  const leftLabels = [...lines.map((l) => seriesText(l.series, l.call)), ...(ruler ? [ruler.label] : []), ...(strip ? [`+${num(sMax)}`, `−${num(sMax)}`] : [])]
  const leftKey = leftLabels.join('\n')
  const [measured, setMeasured] = useState(0)
  useLayoutEffect(() => {
    let w = 0
    svgRef.current?.querySelectorAll<SVGTextContentElement>('[data-left]').forEach((t) => {
      if (typeof t.getComputedTextLength === 'function') w = Math.max(w, t.getComputedTextLength())
    })
    setMeasured((m) => (Math.abs(m - w) > 0.5 ? w : m))
  }, [leftKey])
  const padL = leftMargin(leftLabels, measured)
  const X = (x: number): number => padL + ((x - lo) / (hi - lo)) * (W - padL - PAD.r)
  const Y = (y: number): number => HP - PAD.b - (y / top) * (HP - padT - PAD.b)
  const peaksOf = (l: Ladder | null | undefined): Set<number> => new Set(l?.positions.map((p) => p.peak).filter((p): p is number => p != null))
  const onLadder = peaksOf(ladder)
  // Peaks only the other series' line lies on.
  const onOther = new Set([...lines.filter((l) => l !== ladder).flatMap((l) => [...peaksOf(l)])].filter((i) => !onLadder.has(i)))
  // The residue step hovered or focused (a line and its step k: positions k, k + 1).
  const [hl, setHl] = useState<{ line: number; step: number } | null>(null)
  const linesKey = lines.map((l) => `${l.series}:${l.positions.map((p) => p.expected).join(',')}`).join('|')
  useEffect(() => setHl(null), [linesKey])
  const hq = hl ? lines[hl.line]?.positions : undefined
  const litPeaks = new Set([hq?.[hl!.step]?.peak, hq?.[hl!.step + 1]?.peak].filter((p): p is number => p != null))
  const unit = spectrum.toleranceUnit

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
    return lo + ((u - padL) / (W - padL - PAD.r)) * (hi - lo)
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
    const dx = -((e.clientX - d.x) / r.width) * (W / (W - padL - PAD.r)) * span
    const a = Math.max(full[0], Math.min(full[1] - span, d.range[0] + dx))
    setRange([a, a + span])
  }
  function onKey(e: KeyboardEvent<SVGSVGElement>): void {
    const k = e.key
    // Alt+← and Alt+→ go to another spectrum (the panel's keys).
    if (e.altKey) return
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
  const sTop = HP + 6
  const sH = STRIP_H - 14
  const sMid = sTop + sH / 2
  const SY = (v: number): number => sMid - (v / sMax) * (sH / 2)
  const tip = (what: string, q: StripPoint): string => `${what}: ${q.value >= 0 ? '+' : '−'}${num(Math.abs(q.value))} ${strip?.unit ?? ''} at m/z ${fmt(q.mz, 2)}`
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
        <span className="hint" title="The wheel or + and − zoom; drag or ← and → pan.">
          m/z {fmt(lo, 1)}–{fmt(hi, 1)}
        </span>
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="sp-svg"
        style={{ height: H }}
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
        <line x1={padL} x2={W - PAD.r} y1={HP - PAD.b} y2={HP - PAD.b} className="sp-axis" data-axis="" />
        {ticks.map((t) => (
          <g key={t}>
            <line x1={X(t)} x2={X(t)} y1={HP - PAD.b} y2={HP - PAD.b + 4} className="sp-axis" />
            <text x={X(t)} y={HP - PAD.b + 16} className="sp-tick" textAnchor="middle">
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
              y1={HP - PAD.b}
              y2={Y(int[i])}
              className={`${onLadder.has(i) ? 'sp-peak on' : onOther.has(i) ? 'sp-peak on alt' : 'sp-peak'}${litPeaks.has(i) ? ' hl' : ''}`}
              data-peak={onLadder.has(i) ? 'ladder' : onOther.has(i) ? 'other' : undefined}
            />
          ) : null
        )}
        {/* The terminus of the tag drawn (b0/c0 or y0/z0), when in view. */}
        {marks.map((m) =>
          inView(m.mz) ? (
            <g key={m.label} className={`sp-term-mark${m.away ? ' away' : ''}`} data-testid="terminus-mark" role="img" aria-label={`${m.label} at m/z ${fmt(m.mz)}: ${m.words}`}>
              <title>{`${m.label} at m/z ${fmt(m.mz)}: ${m.words}`}</title>
              <line x1={X(m.mz)} x2={X(m.mz)} y1={HP - PAD.b + 6} y2={HP - PAD.b - 14} />
              <text x={X(m.mz) + 3} y={HP - PAD.b - 6}>
                {m.label}
              </text>
            </g>
          ) : null
        )}
        {lines.map((l, li) => {
          const y = lineY(li)
          const alt = l !== ladder ? ' alt' : ''
          const q = l.positions
          const shown = q.some((p) => inView(p.mz ?? p.expected))
          // The step hovered or focused: its two peaks and drop lines stand out.
          const lit = (k: number): boolean => hl != null && hl.line === li && (k === hl.step || k === hl.step + 1)
          return (
            <g key={li} data-series={l.series} className={`sp-line${alt}`}>
              {shown && (
                <text x={padL - LABEL_GAP} y={y + 4} className="sp-series" textAnchor="end" data-left="">
                  {seriesText(l.series, l.call)}
                  {l.call && <title>{callTitle(l.call)}</title>}
                </text>
              )}
              {/* A position with no peak: flagged from this line down to the axis. */}
              {q.map((p, k) =>
                p.peak == null && inView(p.expected) ? (
                  <line key={`m${k}`} x1={X(p.expected)} x2={X(p.expected)} y1={HP - PAD.b} y2={y} className={`sp-missing${alt}`} data-missing={l.series}>
                    <title>{`No peak at m/z ${fmt(p.expected)} (${seriesText(l.series, l.call)})`}</title>
                  </line>
                ) : null
              )}
              {/* A dashed line from the tag line down to each peak it lies on. */}
              {q.map((p, k) =>
                p.peak != null && inView(p.mz ?? p.expected) ? (
                  <line
                    key={`d${k}`}
                    x1={X(p.mz ?? p.expected)}
                    x2={X(p.mz ?? p.expected)}
                    y1={y}
                    y2={Y(int[p.peak])}
                    className={`sp-drop${alt}${lit(k) ? ' hl' : ''}`}
                    data-drop={l.series}
                  />
                ) : null
              )}
              {/* Each residue spans the two peaks whose difference it is;
                  hovering or focusing it picks out those two peaks. */}
              {l.residues.map((res, k) => {
                const a = q[k]
                const b = q[k + 1]
                if (!a || !b) return null
                const xa = X(a.mz ?? a.expected)
                const xb = X(b.mz ?? b.expected)
                if (Math.max(xa, xb) < padL || Math.min(xa, xb) > W - PAD.r) return null
                const words = stepWords(res, a, b, unit)
                const on = hl != null && hl.line === li && hl.step === k
                const pick = (): void => setHl({ line: li, step: k })
                const drop = (): void => setHl((h) => (h && h.line === li && h.step === k ? null : h))
                return (
                  <g
                    key={`r${k}`}
                    className={`sp-step-g${on ? ' hl' : ''}`}
                    data-step={k}
                    tabIndex={0}
                    role="img"
                    aria-label={words}
                    onPointerEnter={pick}
                    onPointerLeave={drop}
                    onFocus={pick}
                    onBlur={drop}
                  >
                    <title>{words}</title>
                    <rect x={Math.min(xa, xb)} y={y - 16} width={Math.abs(xb - xa)} height={22} className="sp-step-hit" />
                    <line x1={xa} x2={xb} y1={y} y2={y} className={`sp-step${alt}`} />
                    <line x1={xa} x2={xa} y1={y - 4} y2={y + 4} className={`sp-step${alt}`} />
                    <line x1={xb} x2={xb} y1={y - 4} y2={y + 4} className={`sp-step${alt}`} />
                    <text x={(xa + xb) / 2} y={y - 5} className="sp-res-label" textAnchor="middle">
                      {res}
                    </text>
                  </g>
                )
              })}
            </g>
          )
        })}
        {ruler && (
          <g className="sp-ruler" data-ruler="">
            <title>The database peptide the run placed this spectrum&apos;s tags on: where its fragments fall (a candidate, not an identification)</title>
            <text x={padL - LABEL_GAP} y={22} className="sp-series" textAnchor="end" data-left="">
              {ruler.label}
            </text>
            {ruler.ticks.map((t, k) => (t != null && inView(t) ? <line key={`t${k}`} x1={X(t)} x2={X(t)} y1={12} y2={24} className="sp-ruler-tick" /> : null))}
            {ruler.residues.map((r, k) => {
              const a = ruler.ticks[k]
              const b = ruler.ticks[k + 1]
              if (a == null || b == null || !inView((a + b) / 2)) return null
              return (
                <text key={`p${k}`} x={X((a + b) / 2)} y={22} className={ruler.on[k] ? 'sp-ruler-res on' : 'sp-ruler-res'} textAnchor="middle">
                  {r}
                </text>
              )
            })}
          </g>
        )}
        {strip && (
          <g className="sp-strip" data-strip="">
            <rect x={padL} y={SY(strip.tolerance)} width={W - padL - PAD.r} height={SY(-strip.tolerance) - SY(strip.tolerance)} className="sp-strip-band" />
            <line x1={padL} x2={W - PAD.r} y1={sMid} y2={sMid} className="sp-axis" />
            <text x={padL - LABEL_GAP} y={sTop + 8} className="sp-tick" textAnchor="end" data-left="">
              +{num(sMax)}
            </text>
            <text x={padL - LABEL_GAP} y={sTop + sH} className="sp-tick" textAnchor="end" data-left="">
              −{num(sMax)}
            </text>
            <text x={W - PAD.r} y={H - 2} className="sp-tick" textAnchor="end">
              mass error ({strip.unit}; band: the run&apos;s tolerance) ● each step · line: summed from the first peak
              {strip.onPeptide.length > 0 ? ' · × peak against the peptide' : ''}
            </text>
            {strip.drift.length > 1 && (
              <polyline
                points={strip.drift
                  .filter((q) => inView(q.mz))
                  .map((q) => `${X(q.mz)},${SY(q.value)}`)
                  .join(' ')}
                className="sp-strip-drift"
              />
            )}
            {strip.onPeptide.map((q, k) =>
              inView(q.mz) ? (
                <g key={`x${k}`} className="sp-strip-pep">
                  <title>{tip('Peak against the peptide’s fragment', q)}</title>
                  <line x1={X(q.mz) - 3} x2={X(q.mz) + 3} y1={SY(q.value) - 3} y2={SY(q.value) + 3} />
                  <line x1={X(q.mz) - 3} x2={X(q.mz) + 3} y1={SY(q.value) + 3} y2={SY(q.value) - 3} />
                </g>
              ) : null
            )}
            {strip.steps.map((q, k) =>
              inView(q.mz) ? (
                <circle key={`s${k}`} cx={X(q.mz)} cy={SY(q.value)} r={3} className="sp-strip-step" data-step-error="">
                  <title>{tip('Step', q)}</title>
                </circle>
              ) : null
            )}
          </g>
        )}
      </svg>
    </div>
  )
}
