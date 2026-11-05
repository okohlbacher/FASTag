import { useEffect, useId, useMemo, useRef, useState, type JSX, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import type { ResultsPage, ResultsSort, ResultsView } from './types'
import { baseName, DECIMAL } from './digestReport'
import { HelpButton, HelpLink } from './help/HelpLink'

// Hand-rolled fixed-row-height virtualization. Not react-window: above ~600k
// rows the spacer div would exceed WebKit's ~16.7M px element-height limit and
// any library breaks the same way, so the capped-spacer proportional mapping
// has to be hand-written regardless.
const ROW_H = 28
const HEAD_H = 28
const PAGE = 500
const MAX_PAGES = 40
const SPACER_CAP = 15_000_000
const OVERSCAN = 4

// Fallback widths until the first rows arrive; then columns are sized to
// their content (header and first page) and can be resized by dragging the
// header edge or with the arrow keys on it.
function colWidth(name: string): number {
  if (name === 'spectrum') return 200
  if (name === 'tag' || name === 'proforma') return 150
  return 90
}
// IBM Plex Sans at 13 px: an upper-case tag runs to about 9 px a character.
const CHAR_W = 9
const CELL_PAD = 20
const MIN_W = 48
const MAX_AUTO_W = 480
const MAX_W = 2000
const clampW = (w: number): number => Math.max(MIN_W, Math.min(MAX_W, Math.round(w)))
// Header labels are mixed case, narrower than an upper-case tag; the sort
// glyph needs room beside them.
const HEAD_CHAR_W = 7.5
const GLYPH_W = 16
// A spectrum ID runs to 45 characters (`controllerType=0 controllerNumber=1
// scan=11482`): sized to it, the column alone pushed E-value and Database hit
// out of an 840 px pane. Its cells are middle-truncated (fitMiddle), so the
// scan number stays visible; dragging the edge widens it.
const SPECTRUM_AUTO_W = 200

// The tags file's column names in words, the optional ones (-proforma,
// -res_conf, -usi_collection, -entrapment_fasta) included; any other column
// keeps its name.
const LABEL: Record<string, string> = {
  spectrum: 'Spectrum',
  tag: 'Tag',
  length: 'Length',
  charge: 'Charge',
  nterm_mass: 'N-term mass',
  cterm_mass: 'C-term mass',
  extended: 'Extended',
  gapped: 'Gapped',
  evalue: 'E-value',
  min_conf: 'Min. conf.',
  mean_conf: 'Mean conf.',
  fasta_hit: 'Database hit',
  proforma: 'ProForma',
  res_conf: 'Residue conf.',
  usi: 'USI',
  q_db: 'Database q-value'
}
export const columnLabel = (c: string): string => LABEL[c] ?? c

// A fasta_hit value in the words of the Database hit filter; the raw value
// stays the cell's name and tooltip.
function hitWords(v: string): string {
  if (v === '-' || v === '') return 'No match'
  if (v === 'efwd' || v === 'erev') return 'Entrapment'
  if (v === 'fwd' || v === 'rev') return 'In database'
  return v
}

export function autoWidths(columns: string[], rows: string[][]): Record<string, number> {
  const out: Record<string, number> = {}
  columns.forEach((c, j) => {
    let w = columnLabel(c).length * HEAD_CHAR_W + GLYPH_W + CELL_PAD
    for (const r of rows) {
      const v = r[j] ?? ''
      w = Math.max(w, (c === 'fasta_hit' ? hitWords(v) : v).length * CHAR_W + CELL_PAD)
    }
    out[c] = Math.round(Math.max(MIN_W, Math.min(c === 'spectrum' ? SPECTRUM_AUTO_W : MAX_AUTO_W, w)))
  })
  return out
}

function growWidths(
  prev: Record<string, number> | null,
  next: Record<string, number>
): Record<string, number> {
  if (!prev) return next
  let changed = false
  const out = { ...prev }
  for (const [c, w] of Object.entries(next)) {
    if (!(w <= (out[c] ?? 0))) {
      out[c] = w
      changed = true
    }
  }
  return changed ? out : prev
}

// Middle ellipsis: spectrum IDs differ at the end (`… scan=N`), so an
// end-truncated cell hides exactly the part that tells rows apart.
function fitMiddle(text: string, width: number): string {
  const cap = Math.floor((width - CELL_PAD) / CHAR_W)
  if (text.length <= cap || cap < 5) return text
  const keep = cap - 1
  const head = Math.floor(keep * 0.4)
  return `${text.slice(0, head)}…${text.slice(text.length - (keep - head))}`
}

const U32_MAX = 4294967295

// Filter boxes: '' is "no filter"; anything else must parse completely, or the
// box is marked invalid and the filter is not applied (never silently).
function parseMinLength(s: string): { value: number | null; invalid: boolean } {
  const t = s.trim()
  if (t === '') return { value: null, invalid: false }
  if (!/^\d+$/.test(t)) return { value: null, invalid: true }
  return { value: Math.min(Number(t), U32_MAX), invalid: false }
}

function parseMaxEvalue(s: string): { value: number | null; invalid: boolean } {
  // A decimal comma (`0,005`) is accepted as a decimal point.
  const t = s.trim().replace(',', '.')
  if (t === '') return { value: null, invalid: false }
  const v = Number(t)
  // A negative E-value is never a valid maximum.
  if (t.startsWith('-') || !DECIMAL.test(t) || !Number.isFinite(v)) {
    return { value: null, invalid: true }
  }
  return { value: v, invalid: false }
}

type FastaHitChoice = 'any' | 'only' | 'none' | 'entrapment'
// The fasta_hit filter as a segmented control. In database: fwd/rev.
// Entrapment: efwd/erev, only in the entrapment database. Not in database: '-' or efwd/erev (no -fasta hit).
const HIT_CHOICES: [FastaHitChoice, string][] = [
  ['any', 'All'],
  ['only', 'In database'],
  ['entrapment', 'Entrapment'],
  ['none', 'Not in database']
]

// A column is numeric when every value of the first page is a number (or the
// CLI's '-' for none): it is right-aligned in tabular figures.
function numericColumns(columns: string[], rows: string[][]): Set<string> {
  const out = new Set<string>()
  columns.forEach((c, j) => {
    let any = false
    for (const r of rows) {
      const v = r[j] ?? ''
      if (v === '' || v === '-') continue
      if (!Number.isFinite(Number(v))) return
      any = true
    }
    if (any) out.add(c)
  })
  return out
}

// An E-value below 10^-3 as a × 10^n: `4.2e-08` is read wrong at a glance.
// The exponent is drawn with <sup>; the raw value stays the cell's name.
function EValue({ text }: { text: string }): JSX.Element {
  const v = Number(text)
  if (text.trim() === '' || !Number.isFinite(v) || v === 0 || Math.abs(v) >= 1e-3) return <>{text}</>
  const [m, e] = v.toExponential(1).split('e')
  const exp = Number(e)
  return (
    <>
      {m} × 10<sup>{exp < 0 ? '−' : ''}{Math.abs(exp)}</sup>
    </>
  )
}

interface Meta {
  columns: string[]
  total: number
  matched: number
}

interface Props {
  path: string
  /// Where the file came from, beside its row count: the run that wrote it.
  source?: string
}

export default function ResultsTable({ path, source }: Props): JSX.Element {
  const [meta, setMeta] = useState<Meta | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Best tags first, as the CLI ranks them. A file without an evalue column
  // ignores the sort (browser.rs drops a sort on a missing column).
  const [sort, setSort] = useState<ResultsSort | null>({ column: 'evalue', desc: false })
  // Text/number filters commit on Enter or blur (each distinct view costs the
  // backend a full-file scan; per-keystroke would burn one per character).
  const [draft, setDraft] = useState({ spectrum: '', minLength: '', maxEvalue: '' })
  const [filters, setFilters] = useState(draft)
  const [fastaHit, setFastaHit] = useState<FastaHitChoice>('any')
  const [scrollTop, setScrollTop] = useState(0)
  const [viewH, setViewH] = useState(600)
  const [autoW, setAutoW] = useState<Record<string, number> | null>(null)
  const [userW, setUserW] = useState<Record<string, number>>({})
  const [numeric, setNumeric] = useState<Set<string>>(new Set())
  // Columns the user hid with Columns…; Export writes the shown ones.
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [colsOpen, setColsOpen] = useState(false)
  const [exported, setExported] = useState<{ ok: boolean; text: string } | null>(null)
  const id = useId()

  const scrollerRef = useRef<HTMLDivElement>(null)
  const pagesRef = useRef(new Map<number, string[][]>())
  const inflightRef = useRef(new Set<number>())
  // Bumped on every path/view change and on unmount: stale responses check it
  // and drop themselves instead of touching state.
  const genRef = useRef(0)

  const minLength = parseMinLength(filters.minLength)
  const maxEvalue = parseMaxEvalue(filters.maxEvalue)
  const view = useMemo<ResultsView>(
    () => ({
      sort,
      spectrum: filters.spectrum || null,
      minLength: minLength.value,
      maxEvalue: maxEvalue.value,
      fastaHit: fastaHit === 'any' ? null : (fastaHit as ResultsView['fastaHit'])
    }),
    [sort, filters.spectrum, minLength.value, maxEvalue.value, fastaHit]
  )
  const ignored = [minLength.invalid && 'min. length', maxEvalue.invalid && 'max. E-value'].filter(Boolean)
  // How a decimal comma in the box is read, before it is committed.
  const draftE = parseMaxEvalue(draft.maxEvalue)
  const commaRead = draft.maxEvalue.includes(',') && !draftE.invalid && draftE.value != null ? draftE.value : null

  useEffect(() => {
    setAutoW(null)
    setUserW({})
    setNumeric(new Set())
    setHidden(new Set())
  }, [path])

  useEffect(() => {
    genRef.current++
    pagesRef.current.clear()
    inflightRef.current.clear()
    setError(null)
    setScrollTop(0)
    if (scrollerRef.current) scrollerRef.current.scrollTop = 0
    return () => {
      genRef.current++
    }
  }, [path, view])

  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const measure = (): void => setViewH(el.clientHeight || 600)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const matched = meta?.matched ?? 0
  const contentH = matched * ROW_H
  const spacerH = Math.min(contentH, SPACER_CAP)
  const visible = Math.ceil(viewH / ROW_H) + OVERSCAN
  let first: number
  let blockTop: number
  if (contentH <= SPACER_CAP) {
    first = Math.floor(scrollTop / ROW_H)
    blockTop = HEAD_H + first * ROW_H
  } else {
    // Proportional mapping: scrollTop no longer addresses rows 1:1, so map the
    // scroll fraction onto the row space and pin the block to the viewport.
    const maxScroll = Math.max(1, spacerH + HEAD_H - viewH)
    const frac = Math.min(1, scrollTop / maxScroll)
    first = Math.floor(frac * Math.max(0, matched - visible))
    blockTop = HEAD_H + Math.min(scrollTop, spacerH - visible * ROW_H)
  }
  first = Math.max(0, Math.min(first, Math.max(0, matched - 1)))
  const last = Math.min(matched, first + visible)

  useEffect(() => {
    const gen = genRef.current
    const wanted: number[] = []
    for (let p = Math.floor(first / PAGE); p * PAGE < Math.max(last, 1); p++) wanted.push(p)
    for (const p of wanted) {
      if (pagesRef.current.has(p) || inflightRef.current.has(p)) continue
      inflightRef.current.add(p)
      window.fastag.resultsQuery(path, view, p * PAGE, PAGE).then(
        (page: ResultsPage) => {
          if (genRef.current !== gen) return
          inflightRef.current.delete(p)
          pagesRef.current.set(p, page.rows)
          // LRU-ish eviction: drop the oldest cached page that is not needed
          // for the current window.
          for (const k of pagesRef.current.keys()) {
            if (pagesRef.current.size <= MAX_PAGES) break
            if (!wanted.includes(k)) pagesRef.current.delete(k)
          }
          setMeta({ columns: page.columns, total: page.totalRows, matched: page.matchedRows })
          // Widths only grow as pages arrive, so a later, longer value
          // (scan=999999 after scan=0) is not cut and nothing jumps narrower.
          if (page.rows.length > 0) {
            setAutoW((w) => growWidths(w, autoWidths(page.columns, page.rows)))
            setNumeric((n) => (n.size ? n : numericColumns(page.columns, page.rows)))
          }
        },
        (err: unknown) => {
          if (genRef.current !== gen) return
          inflightRef.current.delete(p)
          setError(err instanceof Error ? err.message : String(err))
        }
      )
    }
  }, [path, view, first, last])

  const columns = meta?.columns ?? []
  const has = (c: string): boolean => columns.includes(c)
  // The shown columns, as indices into each row.
  const shown = columns.map((_, j) => j).filter((j) => !hidden.has(columns[j]))
  const width = (c: string): number => userW[c] ?? autoW?.[c] ?? colWidth(c)
  const grid = shown.map((j) => `${width(columns[j])}px`).join(' ')
  const totalW = shown.reduce((w, j) => w + width(columns[j]), 0)

  const resizeTo = (c: string, w: number): void => setUserW((u) => ({ ...u, [c]: clampW(w) }))
  const startResize = (c: string, e: ReactPointerEvent): void => {
    e.preventDefault()
    const x0 = e.clientX
    const w0 = width(c)
    const move = (ev: PointerEvent): void => resizeTo(c, w0 + ev.clientX - x0)
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const resizeKey = (c: string, e: KeyboardEvent): void => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      resizeTo(c, width(c) + (e.key === 'ArrowLeft' ? -16 : 16))
    }
  }
  const resetWidth = (c: string): void =>
    setUserW((u) => {
      const { [c]: _drop, ...rest } = u
      return rest
    })

  const clickSort = (column: string): void =>
    setSort((s) =>
      s?.column !== column ? { column, desc: false } : s.desc ? null : { column, desc: true }
    )

  const commit = (): void => setFilters(draft)
  const onEnter = (e: KeyboardEvent): void => {
    if (e.key === 'Enter') commit()
  }

  const toggleColumn = (c: string): void =>
    setHidden((h) => {
      const n = new Set(h)
      if (n.has(c)) n.delete(c)
      else n.add(c)
      return n
    })

  // Export what the table shows: this view's rows, in its order, in the shown
  // columns. The backend writes it; the renderer holds only a window.
  async function exportShown(): Promise<void> {
    const stem = path.endsWith('.tsv') ? path.slice(0, -4) : path
    const dest = await window.fastag.saveFile(`${stem}.shown.tsv`, ['tsv'])
    if (!dest) return
    setExported(null)
    try {
      const n = await window.fastag.exportResults(path, view, shown.map((j) => columns[j]), dest)
      setExported({ ok: true, text: `Wrote ${n.toLocaleString('en-US')} rows to ${dest}.` })
    } catch (err) {
      setExported({ ok: false, text: `Export failed: ${err instanceof Error ? err.message : String(err)}` })
    }
  }

  const rowsOut: JSX.Element[] = []
  for (let i = first; i < last; i++) {
    const row = pagesRef.current.get(Math.floor(i / PAGE))?.[i % PAGE]
    rowsOut.push(
      <div className="rt-row" role="row" aria-rowindex={i + 2} key={i} style={{ gridTemplateColumns: grid }}>
        {row ? (
          shown.map((j) => {
            const c = row[j] ?? ''
            const name = columns[j] ?? ''
            return (
              <div className={`rt-cell${numeric.has(name) ? ' n' : ''}`} role="cell" key={j} title={c} aria-label={c}>
                {name === 'evalue' ? <EValue text={c} /> : name === 'fasta_hit' ? hitWords(c) : fitMiddle(c, width(name))}
              </div>
            )
          })
        ) : (
          <div className="rt-cell dim" role="cell">
            …
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="rt">
      <div className="rt-title">
        <h2 title={path}>
          <code>{baseName(path)}</code>
        </h2>
        <span className="muted">
          {meta ? `${meta.total.toLocaleString('en-US')} ${meta.total === 1 ? 'tag' : 'tags'}` : 'Reading…'}
          {source && ` · ${source}`}
        </span>
        <HelpButton to="results-columns" what="the tags table" />
        <span className="spacer" />
        <button
          type="button"
          className="secondary"
          aria-expanded={colsOpen}
          aria-controls={`${id}-cols`}
          disabled={!meta}
          onClick={() => setColsOpen((o) => !o)}
        >
          Columns…
        </button>
        <button type="button" className="secondary" disabled={!meta || matched === 0} onClick={exportShown}>
          Export shown rows…
        </button>
      </div>
      {colsOpen && meta && (
        <fieldset className="rt-cols" id={`${id}-cols`}>
          <legend>Columns shown</legend>
          {columns.map((c) => (
            <label key={c}>
              <input
                type="checkbox"
                checked={!hidden.has(c)}
                // The last shown column stays: a table of nothing reads as empty.
                disabled={!hidden.has(c) && shown.length === 1}
                onChange={() => toggleColumn(c)}
              />
              <span title={c}>{columnLabel(c)}</span>
            </label>
          ))}
        </fieldset>
      )}
      {exported && (
        <p className={exported.ok ? 'rt-note' : 'rt-note bad'} role="status">
          {exported.text}
        </p>
      )}
      <form
        className="rt-bar"
        role="search"
        aria-label="Filter tags"
        onSubmit={(e) => {
          e.preventDefault()
          commit()
        }}
      >
        {has('spectrum') && (
          <div className="rt-f">
            <label htmlFor={`${id}-sp`}>Spectrum contains</label>
            <input
              id={`${id}-sp`}
              className="wide"
              placeholder="scan=4112"
              value={draft.spectrum}
              onChange={(e) => setDraft((d) => ({ ...d, spectrum: e.target.value }))}
              onKeyDown={onEnter}
              onBlur={commit}
            />
          </div>
        )}
        {has('length') && (
          <div className="rt-f">
            <label htmlFor={`${id}-len`}>Min. length</label>
            <input
              id={`${id}-len`}
              className="num"
              inputMode="numeric"
              aria-invalid={minLength.invalid || undefined}
              aria-describedby={minLength.invalid ? `${id}-len-h` : undefined}
              value={draft.minLength}
              onChange={(e) => setDraft((d) => ({ ...d, minLength: e.target.value }))}
              onKeyDown={onEnter}
              onBlur={commit}
            />
            {minLength.invalid && (
              <span className="rt-hint bad" id={`${id}-len-h`}>
                not a whole number
              </span>
            )}
          </div>
        )}
        {has('evalue') && (
          <div className="rt-f">
            <label htmlFor={`${id}-ev`}>Max. E-value</label>
            <input
              id={`${id}-ev`}
              className="num"
              inputMode="decimal"
              aria-invalid={maxEvalue.invalid || undefined}
              aria-describedby={`${id}-ev-h`}
              value={draft.maxEvalue}
              onChange={(e) => setDraft((d) => ({ ...d, maxEvalue: e.target.value }))}
              onKeyDown={onEnter}
              onBlur={commit}
            />
            <span className={maxEvalue.invalid ? 'rt-hint bad' : 'rt-hint'} id={`${id}-ev-h`}>
              {maxEvalue.invalid ? 'not a number' : commaRead != null ? `read as ${commaRead}` : ''}
            </span>
          </div>
        )}
        {has('fasta_hit') && (
          <fieldset
            className="rt-f seg-field"
            title="Whether the tag occurs in the sequence database (fasta) or only in the entrapment database (entrapment_fasta)"
          >
            <legend>Database hit</legend>
            <div className="seg">
              {HIT_CHOICES.map(([v, words]) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={fastaHit === v}
                  onClick={() => setFastaHit(v)}
                >
                  {words}
                </button>
              ))}
            </div>
          </fieldset>
        )}
        {meta && (
          <span className="rt-status" role="status">
            Showing {matched.toLocaleString('en-US')} of {meta.total.toLocaleString('en-US')}
            {ignored.length > 0 && <span className="rt-ignored"> · {ignored.join(' and ')} not applied (invalid)</span>}
          </span>
        )}
      </form>
      {error ? (
        <div className="empty">Cannot read results: {error}</div>
      ) : (
        // Focusable scroller: PageUp/PageDown/arrows scroll the rows from the
        // keyboard (the virtualized rows themselves hold nothing focusable).
        // A table, not a grid: the cells are read-only, and a grid would
        // promise arrow-key cell navigation.
        <div
          className="rt-scroll"
          ref={scrollerRef}
          tabIndex={0}
          role="region"
          aria-label="Tags table"
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        >
          <div
            className="rt-canvas"
            role="table"
            aria-label={`Tags in ${baseName(path)}`}
            aria-rowcount={matched + 1}
            aria-colcount={shown.length}
            style={{ height: HEAD_H + spacerH, minWidth: totalW }}
          >
            <div className="rt-head" role="row" aria-rowindex={1} style={{ gridTemplateColumns: grid }}>
              {shown.map((j) => {
                const c = columns[j]
                const label = columnLabel(c)
                return (
                  // Named by its label alone: the resize separator inside
                  // would otherwise be read with every cell of the column.
                  <div
                    role="columnheader"
                    aria-label={label}
                    key={c}
                    className={numeric.has(c) ? 'n' : undefined}
                    aria-sort={sort?.column === c ? (sort.desc ? 'descending' : 'ascending') : undefined}
                    style={{ position: 'relative', display: 'flex', minWidth: 0 }}
                  >
                    <button
                      type="button"
                      className="rt-th"
                      style={{ flex: 1, minWidth: 0 }}
                      onClick={() => clickSort(c)}
                      title={`Sort by ${label}`}
                    >
                      {label}
                      {sort?.column === c && (
                        <span className="dir" aria-hidden="true">
                          {sort.desc ? ' ▾' : ' ▴'}
                        </span>
                      )}
                    </button>
                    <span
                      role="separator"
                      aria-orientation="vertical"
                      aria-label={`Resize column ${label}`}
                      aria-valuenow={width(c)}
                      aria-valuemin={MIN_W}
                      aria-valuemax={MAX_W}
                      tabIndex={0}
                      title="drag to resize, double-click to fit"
                      onPointerDown={(e) => startResize(c, e)}
                      onKeyDown={(e) => resizeKey(c, e)}
                      onDoubleClick={() => resetWidth(c)}
                      className="rt-resize"
                    />
                  </div>
                )
              })}
            </div>
            <div className="rt-rows" role="rowgroup" style={{ top: blockTop }}>
              {rowsOut}
            </div>
          </div>
          {/* The first page of a large file takes a while to read. */}
          {!meta && <div className="empty" role="status">Reading…</div>}
          {meta && matched === 0 && (
            <div className="empty">
              {meta.total === 0 ? (
                <>
                  The file has no tags. <HelpLink to="faq-no-tags">Possible causes</HelpLink>
                </>
              ) : (
                'No rows match the filters.'
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
