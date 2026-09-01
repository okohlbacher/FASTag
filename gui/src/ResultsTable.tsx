import { useEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent } from 'react'
import type { ResultsPage, ResultsSort, ResultsView } from './types'

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

function colWidth(name: string): number {
  if (name === 'spectrum') return 220
  if (name === 'tag' || name === 'proforma') return 150
  return 90
}

interface Meta {
  columns: string[]
  total: number
  matched: number
}

export default function ResultsTable({ path }: { path: string }): JSX.Element {
  const [meta, setMeta] = useState<Meta | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sort, setSort] = useState<ResultsSort | null>(null)
  // Text/number filters commit on Enter or blur (each distinct view costs the
  // backend a full-file scan; per-keystroke would burn one per character).
  const [draft, setDraft] = useState({ spectrum: '', minLength: '', maxEvalue: '' })
  const [filters, setFilters] = useState(draft)
  const [fastaHit, setFastaHit] = useState<'any' | 'only' | 'none'>('any')
  const [scrollTop, setScrollTop] = useState(0)
  const [viewH, setViewH] = useState(600)

  const scrollerRef = useRef<HTMLDivElement>(null)
  const pagesRef = useRef(new Map<number, string[][]>())
  const inflightRef = useRef(new Set<number>())
  // Bumped on every path/view change and on unmount: stale responses check it
  // and drop themselves instead of touching state.
  const genRef = useRef(0)

  const view = useMemo<ResultsView>(() => {
    const minLength = Number.parseInt(filters.minLength, 10)
    const maxEvalue = Number(filters.maxEvalue)
    return {
      sort,
      spectrum: filters.spectrum || null,
      minLength: Number.isFinite(minLength) ? minLength : null,
      maxEvalue: filters.maxEvalue !== '' && Number.isFinite(maxEvalue) ? maxEvalue : null,
      fastaHit: fastaHit === 'any' ? null : fastaHit
    }
  }, [sort, filters, fastaHit])

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
  const grid = columns.map((c) => `${colWidth(c)}px`).join(' ')
  const totalW = columns.reduce((w, c) => w + colWidth(c), 0)

  const clickSort = (column: string): void =>
    setSort((s) =>
      s?.column !== column ? { column, desc: false } : s.desc ? null : { column, desc: true }
    )

  const commit = (): void => setFilters(draft)
  const onEnter = (e: KeyboardEvent): void => {
    if (e.key === 'Enter') commit()
  }

  const rowsOut: JSX.Element[] = []
  for (let i = first; i < last; i++) {
    const row = pagesRef.current.get(Math.floor(i / PAGE))?.[i % PAGE]
    rowsOut.push(
      <div className="rt-row" key={i} style={{ gridTemplateColumns: grid }}>
        {row ? (
          row.map((c, j) => (
            <div className="rt-cell" key={j} title={c}>
              {c}
            </div>
          ))
        ) : (
          <div className="rt-cell dim">…</div>
        )}
      </div>
    )
  }

  return (
    <div className="rt">
      <div className="rt-bar">
        {has('spectrum') && (
          <input
            placeholder="spectrum contains… (Enter)"
            value={draft.spectrum}
            onChange={(e) => setDraft((d) => ({ ...d, spectrum: e.target.value }))}
            onKeyDown={onEnter}
            onBlur={commit}
          />
        )}
        {has('length') && (
          <input
            className="num"
            placeholder="min length"
            value={draft.minLength}
            onChange={(e) => setDraft((d) => ({ ...d, minLength: e.target.value }))}
            onKeyDown={onEnter}
            onBlur={commit}
          />
        )}
        {has('evalue') && (
          <input
            className="num"
            placeholder="max evalue"
            value={draft.maxEvalue}
            onChange={(e) => setDraft((d) => ({ ...d, maxEvalue: e.target.value }))}
            onKeyDown={onEnter}
            onBlur={commit}
          />
        )}
        {has('fasta_hit') && (
          <select
            value={fastaHit}
            title="fasta_hit filter"
            onChange={(e) => setFastaHit(e.target.value as 'any' | 'only' | 'none')}
          >
            <option value="any">any hit</option>
            <option value="only">hits only</option>
            <option value="none">no hit</option>
          </select>
        )}
        {meta && (
          <span className="rt-status">
            matched {matched.toLocaleString()} of {meta.total.toLocaleString()} rows
          </span>
        )}
      </div>
      {error ? (
        <div className="empty">Cannot read results: {error}</div>
      ) : (
        <div className="rt-scroll" ref={scrollerRef} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
          <div className="rt-canvas" style={{ height: HEAD_H + spacerH, minWidth: totalW }}>
            <div className="rt-head" style={{ gridTemplateColumns: grid }}>
              {columns.map((c) => (
                <button className="rt-th" key={c} onClick={() => clickSort(c)} title="sort">
                  {c}
                  {sort?.column === c && <span className="dir">{sort.desc ? ' ▾' : ' ▴'}</span>}
                </button>
              ))}
            </div>
            <div className="rt-rows" style={{ top: blockTop }}>
              {rowsOut}
            </div>
            {meta && matched === 0 && <div className="empty">No rows match.</div>}
          </div>
        </div>
      )}
    </div>
  )
}
