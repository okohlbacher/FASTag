import { useEffect, useId, useMemo, useRef, useState, type JSX, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import type { BrowserEvent, ExportEvent, ResultsHead, ResultsPage, ResultsSort, ResultsView } from './types'
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
// The most rows in the DOM at once, whatever height the scroller reports. A
// scroller without a definite height (the old stacked layout below 720 px)
// reported the whole 15 M px canvas, and a 10 M-row file then put every row
// in the DOM and froze the window for over 45 s (GUI-DESIGN P0a).
export const MAX_DOM_ROWS = 200

// One callback per animation frame. jsdom without pretendToBeVisual and some
// test setups have no requestAnimationFrame: fall back to a 16 ms timer.
function onNextFrame(cb: () => void): () => void {
  if (typeof window.requestAnimationFrame === 'function') {
    const id = window.requestAnimationFrame(() => cb())
    return () => window.cancelAnimationFrame(id)
  }
  const id = window.setTimeout(cb, 16)
  return () => window.clearTimeout(id)
}

// Fallback widths until the first rows arrive; then columns are sized to
// their content (header and first page) and can be resized by dragging the
// header edge or with the arrow keys on it.
function colWidth(name: string): number {
  if (name === 'spectrum') return 200
  if (name === 'tag' || name === 'proforma') return 150
  return 90
}
// The system UI font at 13 px: an upper-case tag runs to about 9 px a character.
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
// The per-spectrum rule (browser.rs per_spectrum): every tag, or the best N
// of each spectrum by E-value.
const PER_SPECTRUM: [string, string][] = [
  ['', 'All tags'],
  ['1', 'Best tag'],
  ['2', 'Best 2'],
  ['3', 'Best 3'],
  ['5', 'Best 5']
]

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

// One loaded page: its rows and their file-row ids (absent from old mocks).
interface Page {
  rows: string[][]
  ids?: number[]
}

// D5: where the E-value order stands. null: nothing to rank, or not known.
export type RankState = { state: 'ranking'; pct: number | null } | { state: 'ranked' } | null

/// The column the backend ranks in the background (browser.rs RANK_COLUMN).
export const RANK_COLUMN = 'evalue'

/// A view the head rows of results_open can stand in for: no filter, and
/// file order or the E-value order that is still being built.
export function headServes(view: ResultsView): boolean {
  return (
    !view.spectrum &&
    view.minLength == null &&
    view.maxEvalue == null &&
    view.fastaHit == null &&
    view.perSpectrum == null &&
    (view.sort == null || view.sort.column === RANK_COLUMN)
  )
}

/// The scrollTop that puts row @p pos in the middle of a viewport of @p viewH
/// (the same mapping the virtualization reads back, capped spacer included).
export function scrollTopFor(pos: number, matched: number, viewH: number): number {
  const contentH = matched * ROW_H
  if (contentH <= SPACER_CAP) return Math.max(0, pos * ROW_H - Math.floor(viewH / 2) + ROW_H)
  const visible = Math.min(MAX_DOM_ROWS, Math.ceil(viewH / ROW_H) + OVERSCAN)
  const maxScroll = Math.max(1, SPACER_CAP + HEAD_H - viewH)
  return Math.round((Math.max(0, pos - Math.floor(visible / 2)) / Math.max(1, matched - visible)) * maxScroll)
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
  const [perSpectrum, setPerSpectrum] = useState<number | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewH, setViewH] = useState(600)
  const [autoW, setAutoW] = useState<Record<string, number> | null>(null)
  const [userW, setUserW] = useState<Record<string, number>>({})
  const [numeric, setNumeric] = useState<Set<string>>(new Set())
  // Columns the user hid with Columns…; Export writes the shown ones.
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [colsOpen, setColsOpen] = useState(false)
  const [exported, setExported] = useState<{ ok: boolean; text: string } | null>(null)
  // The export job in progress (GUI-DESIGN 6.1 item 11): its id once the
  // backend answered, and rows written of the view's rows.
  const [exporting, setExporting] = useState<{ jobId: number | null; done: number; total: number } | null>(null)
  // Bumped per export: the Channel of an earlier job is not listened to.
  const exportSeq = useRef(0)
  const cancelWanted = useRef(false)
  const id = useId()

  const scrollerRef = useRef<HTMLDivElement>(null)
  const pagesRef = useRef(new Map<number, Page>())
  // D5: the head rows of the open (file order), shown until a page arrives.
  const [head, setHead] = useState<ResultsHead | null>(null)
  const [rank, setRank] = useState<RankState>(null)
  // A loaded page is in file order (ranked: false): the ranked order is
  // swapped in when it is ready.
  const fileOrderShown = useRef(false)
  // The swap waits while a filter field has focus.
  const swapWaiting = useRef(false)
  // The Ranked event of this open has arrived (it can beat a file-order page).
  const rankedSeen = useRef(false)
  // The selected row, by file row: kept across the swap.
  const [active, setActive] = useState<number | null>(null)
  const activeRef = useRef<number | null>(null)
  activeRef.current = active
  // Said once the ranked order is in (aria-live).
  const [rankNote, setRankNote] = useState('')
  const firstRef = useRef(0)
  const matchedRef = useRef(0)
  const formRef = useRef<HTMLFormElement>(null)
  const inflightRef = useRef(new Set<number>())
  // Scroll events are coalesced to one state update per animation frame: a
  // fling fires several per frame, and each re-rendered the table.
  const scrollFrame = useRef<(() => void) | null>(null)
  // Page requests: at most one per animation frame, always for the window in
  // view when the frame comes. Positions a fling passed through in between
  // are never requested (stale requests are dropped, not queued).
  const wantRef = useRef<{ path: string; view: ResultsView; pages: number[] }>({ path, view: {}, pages: [] })
  const frameUsed = useRef(false)
  const pumpFrame = useRef<(() => void) | null>(null)
  // Bumped by a page arriving, to re-render with its rows.
  const [, setArrived] = useState(0)
  // Bumped on every path/view change and on unmount: stale responses check it
  // and drop themselves instead of touching state.
  const genRef = useRef(0)
  // The path whose results_open has answered. Page queries wait for it: the
  // backend indexes only the open file for the table (a query that reached
  // it before the open would be refused), and both IPC calls run
  // concurrently, so sending them together does not order them.
  const openedRef = useRef<string | null>(null)

  const minLength = parseMinLength(filters.minLength)
  const maxEvalue = parseMaxEvalue(filters.maxEvalue)
  const view = useMemo<ResultsView>(
    () => ({
      sort,
      spectrum: filters.spectrum || null,
      minLength: minLength.value,
      maxEvalue: maxEvalue.value,
      fastaHit: fastaHit === 'any' ? null : (fastaHit as ResultsView['fastaHit']),
      perSpectrum
    }),
    [sort, filters.spectrum, minLength.value, maxEvalue.value, fastaHit, perSpectrum]
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
    setHead(null)
    setRank(null)
    setActive(null)
    setRankNote('')
    rankedSeen.current = false
    openedRef.current = null
    // D5: the first rows from the head read, at once; the index and the
    // E-value order follow as events of this open.
    let gen: number | null = null
    let alive = true
    const early: BrowserEvent[] = []
    const onEvent = (e: BrowserEvent): void => {
      if (!alive) return
      if (gen === null) {
        early.push(e)
        return
      }
      if (e.generation !== gen) return
      if (e.kind === 'rankProgress') {
        setRank((r) => (r?.state === 'ranked' ? r : { state: 'ranking', pct: e.total ? Math.floor((100 * e.done) / e.total) : null }))
      } else if (e.kind === 'ranked') {
        rankedSeen.current = true
        if (fileOrderShown.current) swapRef.current()
        else setRank((r) => (r ? { state: 'ranked' } : r))
      } else if (e.kind === 'failed') {
        setRank(null)
      }
    }
    window.fastag.resultsOpen(path, onEvent).then(
      (h) => {
        if (!alive) return
        gen = h.generation
        setHead(h)
        if (h.rows.length > 0) {
          setAutoW((w) => growWidths(w, autoWidths(h.columns, h.rows)))
          setNumeric((n) => (n.size ? n : numericColumns(h.columns, h.rows)))
        }
        early.splice(0).forEach(onEvent)
        openedRef.current = path
        pump()
      },
      // The page query reports the same error.
      () => {
        if (!alive) return
        openedRef.current = path
        pump()
      }
    )
    return () => {
      alive = false
    }
  }, [path])

  useEffect(() => {
    genRef.current++
    pagesRef.current.clear()
    inflightRef.current.clear()
    fileOrderShown.current = false
    swapWaiting.current = false
    // A new file or view is the user's own action, not a fling: its first
    // page goes at once.
    frameUsed.current = false
    pumpFrame.current?.()
    pumpFrame.current = null
    setError(null)
    setScrollTop(0)
    if (scrollerRef.current) scrollerRef.current.scrollTop = 0
    return () => {
      genRef.current++
    }
  }, [path, view])

  // Pending frames die with the table.
  useEffect(
    () => () => {
      scrollFrame.current?.()
      pumpFrame.current?.()
    },
    []
  )

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

  const useHead = !meta && !!head && headServes(view)
  const matched = meta?.matched ?? (useHead ? head!.rows.length : 0)
  matchedRef.current = matched
  const contentH = matched * ROW_H
  const spacerH = Math.min(contentH, SPACER_CAP)
  const visible = Math.min(MAX_DOM_ROWS, Math.ceil(viewH / ROW_H) + OVERSCAN)
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
  firstRef.current = first

  // Request the first missing page of the window in view, if this frame has
  // not sent one yet; otherwise try again next frame. A page that arrives
  // pumps again, so a window spanning two pages fills in two frames.
  const pump = (): void => {
    const { path: p0, view: v0, pages } = wantRef.current
    if (openedRef.current !== p0) return // pumped again when the open answers
    const gen = genRef.current
    const missing = pages.find((p) => !pagesRef.current.has(p) && !inflightRef.current.has(p))
    if (missing === undefined) return
    if (frameUsed.current) {
      if (!pumpFrame.current) {
        pumpFrame.current = onNextFrame(() => {
          pumpFrame.current = null
          frameUsed.current = false
          pump()
        })
      }
      return
    }
    frameUsed.current = true
    onNextFrame(() => {
      frameUsed.current = false
    })
    const page = missing
    inflightRef.current.add(page)
    window.fastag.resultsQuery(p0, v0, page * PAGE, PAGE).then(
      (res: ResultsPage) => {
        if (genRef.current !== gen) return
        inflightRef.current.delete(page)
        if (res.ranked === false) {
          // D5: file order until the E-value order is built.
          fileOrderShown.current = true
          if (rankedSeen.current) {
            // Served before the order was ready, delivered after Ranked. A
            // page the table needs now swaps at once, even with a filter
            // field focused: deferring would drop it and leave rows blank.
            swapRef.current(true)
            return
          }
          setRank((r) => (r?.state === 'ranking' ? r : { state: 'ranking', pct: null }))
        } else if (fileOrderShown.current) {
          // The order became ready between two pages: never show a mix.
          // Swap at once (see above): the needed page is not stored.
          swapRef.current(true)
          return
        }
        pagesRef.current.set(page, { rows: res.rows, ids: res.rowIds })
        // LRU-ish eviction: drop the oldest cached page that is not needed
        // for the current window.
        const now = wantRef.current.pages
        for (const k of pagesRef.current.keys()) {
          if (pagesRef.current.size <= MAX_PAGES) break
          if (!now.includes(k)) pagesRef.current.delete(k)
        }
        setMeta({ columns: res.columns, total: res.totalRows, matched: res.matchedRows })
        setArrived((n) => n + 1)
        // Widths only grow as pages arrive, so a later, longer value
        // (scan=999999 after scan=0) is not cut and nothing jumps narrower.
        if (res.rows.length > 0) {
          setAutoW((w) => growWidths(w, autoWidths(res.columns, res.rows)))
          setNumeric((n) => (n.size ? n : numericColumns(res.columns, res.rows)))
        }
        pump()
      },
      (err: unknown) => {
        if (genRef.current !== gen) return
        inflightRef.current.delete(page)
        setError(err instanceof Error ? err.message : String(err))
      }
    )
  }

  // D5 swap: the ranked order replaces the file order. The active row (or,
  // with none, the first row in view once scrolled) keeps its place in the
  // new order; a filter field with focus defers a swap the Ranked event
  // starts to its blur. A swap a page arrival starts (@p now) never waits:
  // that page is needed for the window in view.
  const swap = (now = false): void => {
    const focus = document.activeElement
    if (!now && focus && formRef.current?.contains(focus) && focus.tagName === 'INPUT') {
      swapWaiting.current = true
      return
    }
    swapWaiting.current = false
    fileOrderShown.current = false
    const firstId = pagesRef.current.get(Math.floor(firstRef.current / PAGE))?.ids?.[firstRef.current % PAGE]
    const anchor = activeRef.current ?? (scrollerRef.current && scrollerRef.current.scrollTop > 0 ? firstId ?? null : null)
    genRef.current++
    pagesRef.current.clear()
    inflightRef.current.clear()
    frameUsed.current = false
    setRank({ state: 'ranked' })
    setRankNote('Ranked by E-value.')
    setArrived((n) => n + 1)
    pump()
    if (anchor != null) {
      const { path: p0, view: v0 } = wantRef.current
      const gen = genRef.current
      window.fastag.resultsPosition(p0, v0, anchor).then(
        (pos) => {
          if (genRef.current !== gen || pos == null || !scrollerRef.current) return
          const el = scrollerRef.current
          el.scrollTop = scrollTopFor(pos, matchedRef.current, el.clientHeight || 600)
          setScrollTop(el.scrollTop)
        },
        () => {}
      )
    }
  }
  const swapRef = useRef(swap)
  swapRef.current = swap

  useEffect(() => {
    const pages: number[] = []
    for (let p = Math.floor(first / PAGE); p * PAGE < Math.max(last, 1); p++) pages.push(p)
    wantRef.current = { path, view, pages }
    pump()
    // pump reads only refs: it needs no dependency of its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, view, first, last])

  const columns = meta?.columns ?? head?.columns ?? []
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
  // columns, as TSV or (a name ending in .csv) CSV. The backend writes it as
  // a job with progress and cancel; the renderer holds only a window.
  async function exportShown(): Promise<void> {
    const stem = path.endsWith('.tsv') ? path.slice(0, -4) : path
    const dest = await window.fastag.saveFile(`${stem}.shown.tsv`, ['tsv', 'csv'])
    if (!dest) return
    const format = dest.toLowerCase().endsWith('.csv') ? 'csv' : 'tsv'
    const seq = ++exportSeq.current
    cancelWanted.current = false
    setExported(null)
    setExporting({ jobId: null, done: 0, total: matched })
    const onEvent = (e: ExportEvent): void => {
      if (exportSeq.current !== seq) return
      if (e.kind === 'progress') {
        setExporting((x) => (x ? { ...x, done: e.done, total: e.total } : x))
        return
      }
      setExporting(null)
      if (e.kind === 'done') setExported({ ok: true, text: `Wrote ${e.rows.toLocaleString('en-US')} rows to ${e.dest}.` })
      else if (e.kind === 'cancelled') setExported({ ok: true, text: 'Export cancelled; nothing was written.' })
      else setExported({ ok: false, text: `Export failed: ${e.message}` })
    }
    try {
      const jobId = await window.fastag.exportResults(path, view, shown.map((j) => columns[j]), dest, format, onEvent)
      if (exportSeq.current !== seq) return
      setExporting((x) => (x ? { ...x, jobId } : x))
      // Cancel was pressed before the backend answered.
      if (cancelWanted.current) void window.fastag.cancelExport(jobId)
    } catch (err) {
      if (exportSeq.current !== seq) return
      setExporting(null)
      setExported({ ok: false, text: `Export failed: ${err instanceof Error ? err.message : String(err)}` })
    }
  }

  const cancelExport = (): void => {
    cancelWanted.current = true
    if (exporting?.jobId != null) void window.fastag.cancelExport(exporting.jobId)
  }

  // Cmd+E and File > Export Shown Rows… (App dispatches 'fastag-action').
  const exportRef = useRef(exportShown)
  exportRef.current = exportShown
  const canExport = !!meta && matched > 0 && !exporting
  useEffect(() => {
    const on = (e: Event): void => {
      if ((e as CustomEvent<string>).detail === 'export' && canExport) void exportRef.current()
    }
    window.addEventListener('fastag-action', on)
    return () => window.removeEventListener('fastag-action', on)
  }, [canExport])

  const rowsOut: JSX.Element[] = []
  for (let i = first; i < last; i++) {
    const pg = pagesRef.current.get(Math.floor(i / PAGE))
    const row = pg?.rows[i % PAGE] ?? (useHead ? head!.rows[i] : undefined)
    const rowId = pg ? pg.ids?.[i % PAGE] : useHead ? i : undefined
    const selected = rowId != null && rowId === active
    rowsOut.push(
      <div
        className={`rt-row${selected ? ' active' : ''}`}
        role="row"
        aria-rowindex={i + 2}
        aria-selected={rowId != null ? selected : undefined}
        key={i}
        style={{ gridTemplateColumns: grid }}
        onClick={() => rowId != null && setActive((a) => (a === rowId ? null : rowId))}
      >
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
          {meta
            ? `${meta.total.toLocaleString('en-US')} ${meta.total === 1 ? 'tag' : 'tags'}`
            : head?.complete
              ? `${head.rows.length.toLocaleString('en-US')} ${head.rows.length === 1 ? 'tag' : 'tags'}`
              : head && head.rows.length > 0
                ? `Reading… first ${head.rows.length.toLocaleString('en-US')} rows shown`
                : 'Reading…'}
          {source && ` · ${source}`}
        </span>
        <HelpButton to="results-columns" what="the tags table" />
        {sort?.column === RANK_COLUMN && rank?.state === 'ranking' && (
          <span className="rt-rank" title="The table shows the file order until the E-value order is ready.">
            <span className="spin" aria-hidden="true">⟳</span> Ranking by E-value…{rank.pct != null ? ` ${rank.pct}%` : ''} (file order shown)
          </span>
        )}
        {/* Always in the page, so the swap is announced. */}
        <span className="sr-only" role="status" aria-live="polite">
          {rankNote}
        </span>
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
        <button type="button" className="secondary" disabled={!canExport} onClick={exportShown}>
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
      {exporting && (
        <p className="rt-note" role="status">
          Exporting… {exporting.total > 0 ? Math.floor((100 * exporting.done) / exporting.total) : 0}% (
          {exporting.done.toLocaleString('en-US')} of {exporting.total.toLocaleString('en-US')} rows){' '}
          <button type="button" className="secondary" onClick={cancelExport}>
            Cancel export
          </button>
        </p>
      )}
      {exported && (
        <p className={exported.ok ? 'rt-note' : 'rt-note bad'} role="status">
          {exported.text}
        </p>
      )}
      <form
        ref={formRef}
        onBlur={() => {
          // The swap waited for the filter field to lose focus.
          if (swapWaiting.current) setTimeout(() => swapRef.current())
        }}
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
        {has('spectrum') && has(RANK_COLUMN) && (
          <div className="rt-f">
            <label htmlFor={`${id}-per`}>Per spectrum</label>
            <select
              id={`${id}-per`}
              title="Keep the best tags of each spectrum by E-value, after the other filters"
              value={perSpectrum == null ? '' : String(perSpectrum)}
              onChange={(e) => setPerSpectrum(e.target.value === '' ? null : Number(e.target.value))}
            >
              {PER_SPECTRUM.map(([v, words]) => (
                <option key={v} value={v}>
                  {words}
                </option>
              ))}
            </select>
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
          onScroll={() => {
            if (scrollFrame.current) return
            scrollFrame.current = onNextFrame(() => {
              scrollFrame.current = null
              if (scrollerRef.current) setScrollTop(scrollerRef.current.scrollTop)
            })
          }}
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
          {!meta && !useHead && <div className="empty" role="status">Reading…</div>}
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
