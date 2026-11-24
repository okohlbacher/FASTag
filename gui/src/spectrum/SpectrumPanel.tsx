// The Spectrum tab (GUI-DESIGN S5, P4): one spectrum's peaks as FASTag
// tagged them (`-dump_spectrum`, through spectrum.rs spectrum_peaks), as a
// stick plot with zoom and pan, the ladder of the chosen tag drawn on them
// (ladder.ts) with the error of each step, and the tags of the spectrum,
// any of which redraws the ladder. Each ladder's series (b or y, c or z) is
// called from its peaks: a ions, a terminus only one reading lies at
// (terminus.ts), the database peptide when the run placed the tags.
// ◀ and ▶ go to the previous and next tagged spectrum of the file.
//
// The peaks depend on the run's options (tolerance, centroiding,
// deisotoping, the peak budget), so the dump runs with the parameters the
// run was given: the run shown, else the run record of the file (History).
// A file with neither is dumped at FASTag's defaults, and the tab says so.
// No other reader: without the input there is "Locate input…".

import { useEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent, type PointerEvent, type WheelEvent } from 'react'
import { parseDump, type SpectrumPeaks } from './dump'
import { hasStep, ladderFor, laddersFor, residueMasses, seriesText, tagRowFrom, type Ladder, type SeriesCall } from './ladder'
import { TermSeq } from './TermSeq'
import { termContext, terminusMark, terminusOf, type TermContext, type Terminus } from './terminus'
import { pathOf } from './step'
import { dbCall, ladderSteps, likelyPeptide, rulerOf, stepOnRuler, ticksOf, type Candidate } from './peptide'
import { baseName } from '../digestReport'
import { EValue, columnLabel, hitWords, spectrumHint } from '../ResultsTable'
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
const W = 1000
const PAD = { l: 48, r: 12, t: 56, b: 28 }

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

/** One resultsQuery of this panel. The browser backend lets a query of a
 *  new view spec cancel the view build in flight (browser.rs view_token: the
 *  Tags table's newer filter or sort supersedes the older one), and then
 *  rejects that query with "cancelled". The panel's queries supersede
 *  nothing: one cancelled by another view's query is asked again. */
async function query(...a: Parameters<typeof window.fastag.resultsQuery>): ReturnType<typeof window.fastag.resultsQuery> {
  for (let tries = 1; ; tries++) {
    try {
      return await window.fastag.resultsQuery(...a)
    } catch (e) {
      if (String(e) !== 'cancelled' || tries >= 5) throw e
    }
  }
}

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

/** The spectrum before (-1) or after (+1) @p spectrum in the file's order of
 *  tagged spectra, with the count; null at an end. */
async function neighbour(path: string, spectrum: string, rowId: number | null, dir: -1 | 1): Promise<{ spectrum: string; rowId: number | null } | null> {
  // The file row the per-spectrum view keeps for this spectrum (its best tag).
  const mine = await query(path, { ...PER_SPECTRUM, spectrum, spectrumExact: true }, 0, 1)
  const sp = mine.columns.indexOf('spectrum')
  const i = mine.rows.findIndex((r) => r[sp] === spectrum)
  const row = i >= 0 ? (mine.rowIds?.[i] ?? null) : rowId
  if (row == null) return null
  const pos = await window.fastag.resultsPosition(path, PER_SPECTRUM, row)
  if (pos == null || pos < 0) return null
  const to = pos + dir
  if (to < 0) return null
  const page = await query(path, PER_SPECTRUM, to, 1)
  if (page.rows.length === 0) return null
  return { spectrum: page.rows[0][page.columns.indexOf('spectrum')] ?? '', rowId: page.rowIds?.[0] ?? null }
}

export default function SpectrumPanel({ target, source, tags: tagsFile, placements, onTarget, onLocate }: Props): JSX.Element {
  const tagsPath = tagsFile === undefined ? target.path : tagsFile
  const [peaks, setPeaks] = useState<Peaks>({ state: 'loading' })
  const [tags, setTags] = useState<TagsOf | null>(null)
  const [tagsError, setTagsError] = useState<string | null>(null)
  // The tag whose ladder is drawn: an index into tags.rows.
  const [chosen, setChosen] = useState<number>(0)
  const [nav, setNav] = useState<{ prev: boolean; next: boolean }>({ prev: false, next: false })
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
    setNav({ prev: false, next: false })
    setCand(null)
    // The tags first, then where ◀ ▶ lead: one view build at a time, so the
    // panel's own queries do not cancel each other (see query()).
    if (!tagsPath) return
    tagsOf(tagsPath, target.spectrum)
      .then((t) => {
        if (!live) return
        setTags(t)
        const at = target.rowId != null ? t.rowIds.indexOf(target.rowId) : -1
        setChosen(at >= 0 ? at : 0)
      })
      .catch((e: unknown) => live && setTagsError(e instanceof Error ? e.message : String(e)))
      .then(() => Promise.all([neighbour(tagsPath, target.spectrum, target.rowId, -1), neighbour(tagsPath, target.spectrum, target.rowId, 1)]))
      .then(([p, n]) => live && setNav({ prev: !!p, next: !!n }))
      .catch(() => live && setNav({ prev: false, next: false }))
      // Last, the peptide the run placed this spectrum's tags on (first
      // page). No Results table has -recon_out open while the Spectrum tab
      // shows: resultsQuery would refuse it ("cancelled"), tableQuery reads it.
      .then(() => (placements ? window.fastag.tableQuery(placements, { spectrum: target.spectrum, spectrumExact: true }, 0, PAGE) : null))
      .then((pg) => live && pg && setCand(likelyPeptide(pg.columns, pg.rows)))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [tagsPath, placements, target.spectrum, target.rowId])

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

  async function go(dir: -1 | 1): Promise<void> {
    const n = tagsPath ? await neighbour(tagsPath, target.spectrum, target.rowId, dir).catch(() => null) : null
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
                  <td key={c} role="gridcell" className={c === 'tag' ? 'mono' : NUMERIC.has(c) ? 'num' : undefined}>
                    {c === 'evalue' ? <EValue text={r[col(c)] ?? ''} /> : c === 'fasta_hit' ? hitWords(r[col(c)] ?? '') : (r[col(c)] ?? '')}
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
  const X = (x: number): number => PAD.l + ((x - lo) / (hi - lo)) * (W - PAD.l - PAD.r)
  const Y = (y: number): number => HP - PAD.b - (y / top) * (HP - padT - PAD.b)
  const peaksOf = (l: Ladder | null | undefined): Set<number> => new Set(l?.positions.map((p) => p.peak).filter((p): p is number => p != null))
  const onLadder = peaksOf(ladder)
  // Peaks only the other series' line lies on.
  const onOther = new Set([...lines.filter((l) => l !== ladder).flatMap((l) => [...peaksOf(l)])].filter((i) => !onLadder.has(i)))

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
  // The error strip: zero in the middle, the scale wide enough for every value.
  const sTop = HP + 6
  const sH = STRIP_H - 14
  const sMid = sTop + sH / 2
  const sMax = strip ? Math.max(strip.tolerance, ...[...strip.steps, ...strip.drift, ...strip.onPeptide].map((q) => Math.abs(q.value))) * 1.1 || 1 : 1
  const SY = (v: number): number => sMid - (v / sMax) * (sH / 2)
  const num = (v: number): string => (strip?.unit === 'Da' ? v.toFixed(3) : v.toFixed(1))
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
        <span className="hint">
          m/z {fmt(lo, 1)}–{fmt(hi, 1)} · wheel or +/− zooms, drag or ←/→ pans
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
        <line x1={PAD.l} x2={W - PAD.r} y1={HP - PAD.b} y2={HP - PAD.b} className="sp-axis" />
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
              className={onLadder.has(i) ? 'sp-peak on' : onOther.has(i) ? 'sp-peak on alt' : 'sp-peak'}
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
        {lp.map((p, k) => {
          const x = p.mz ?? p.expected
          if (!inView(x)) return null
          return p.peak == null ? (
            <line key={`m${k}`} x1={X(x)} x2={X(x)} y1={HP - PAD.b} y2={ladder ? lineY(Math.max(0, lines.indexOf(ladder))) : padT} className="sp-missing" />
          ) : null
        })}
        {lines.map((l, li) => {
          const y = lineY(li)
          const alt = l !== ladder ? ' alt' : ''
          const q = l.positions
          const shown = q.some((p) => inView(p.mz ?? p.expected))
          return (
            <g key={li} data-series={l.series} className={`sp-line${alt}`}>
              {shown && (
                <text x={PAD.l - 6} y={y + 4} className="sp-series" textAnchor="end">
                  {seriesText(l.series, l.call)}
                  {l.call && <title>{callTitle(l.call)}</title>}
                </text>
              )}
              {/* A dashed line from the tag line down to each peak it lies on. */}
              {q.map((p, k) =>
                p.peak != null && inView(p.mz ?? p.expected) ? (
                  <line key={`d${k}`} x1={X(p.mz ?? p.expected)} x2={X(p.mz ?? p.expected)} y1={y} y2={Y(int[p.peak])} className={`sp-drop${alt}`} data-drop={l.series} />
                ) : null
              )}
              {/* Each residue spans the two peaks whose difference it is. */}
              {l.residues.map((res, k) => {
                const a = q[k]
                const b = q[k + 1]
                if (!a || !b) return null
                const xa = X(a.mz ?? a.expected)
                const xb = X(b.mz ?? b.expected)
                if (Math.max(xa, xb) < PAD.l || Math.min(xa, xb) > W - PAD.r) return null
                return (
                  <g key={`r${k}`}>
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
            <text x={PAD.l - 6} y={22} className="sp-series" textAnchor="end">
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
            <rect x={PAD.l} y={SY(strip.tolerance)} width={W - PAD.l - PAD.r} height={SY(-strip.tolerance) - SY(strip.tolerance)} className="sp-strip-band" />
            <line x1={PAD.l} x2={W - PAD.r} y1={sMid} y2={sMid} className="sp-axis" />
            <text x={PAD.l - 6} y={sTop + 8} className="sp-tick" textAnchor="end">
              +{num(sMax)}
            </text>
            <text x={PAD.l - 6} y={sTop + sH} className="sp-tick" textAnchor="end">
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
