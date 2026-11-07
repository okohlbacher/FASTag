// One table for the P4c viewers (GUI-DESIGN S7: "one shared DataTable for
// recon_out, delta_out and recon_id_out"; S8 the glyco table): the rows the
// caller's typed-array filter kept, sorted by a column, with an active row
// moved by the keyboard (↑ ↓ PgUp PgDn Home End) and at most PAGE rows in
// the DOM (the 200-row rule of section 7). The data stays in the caller's
// typed columns; a column reads a row by its id.

import { useEffect, useId, useMemo, useRef, useState, type JSX, type KeyboardEvent, type ReactNode } from 'react'

export interface Column {
  id: string
  label: string
  /// Right-aligned, sorted as a number (NaN and missing last).
  num?: boolean
  mono?: boolean
  /// The text of row @p i.
  text(i: number): string
  /// The sort key of row @p i; text() when absent.
  key?(i: number): number | string
  title?: string
}

export const PAGE = 100
const JUMP = 20

export interface DataTableProps {
  /// The accessible name of the table.
  label: string
  /// The columns may be rebuilt on every render, but must read the data
  /// that @p ids indexes: the sorted order is kept until @p ids or the sort
  /// changes (a new array of the same columns does not sort again).
  columns: Column[]
  /// The rows to show (after the filters), as row ids.
  ids: ArrayLike<number>
  /// The rows before the filters, for "n of m".
  total: number
  /// What shows when no row passed the filters.
  empty?: ReactNode
  sort?: { column: string; desc: boolean } | null
}

/// The ids of @p ids in the order of @p col (stable: ties keep file order).
export function sortIds(ids: ArrayLike<number>, col: Column | undefined, desc: boolean): number[] {
  const out = Array.from(ids)
  if (!col) return out
  const key = col.key ?? col.text
  if (col.num) {
    const k = new Float64Array(out.length)
    out.forEach((id, j) => {
      const v = key(id)
      k[j] = typeof v === 'number' ? v : Number(v)
    })
    const order = out.map((_, j) => j)
    order.sort((a, b) => {
      const x = k[a]
      const y = k[b]
      const nx = Number.isNaN(x)
      const ny = Number.isNaN(y)
      if (nx || ny) return nx === ny ? a - b : nx ? 1 : -1
      return (desc ? y - x : x - y) || a - b
    })
    return order.map((j) => out[j])
  }
  const k = out.map((id) => String(key(id)))
  const order = out.map((_, j) => j)
  order.sort((a, b) => (k[a] < k[b] ? (desc ? 1 : -1) : k[a] > k[b] ? (desc ? -1 : 1) : a - b))
  return order.map((j) => out[j])
}

export default function DataTable({ label, columns, ids, total, empty, sort: initial = null }: DataTableProps): JSX.Element {
  const [sort, setSort] = useState(initial)
  const [active, setActive] = useState(0)
  const base = useId()
  const gridRef = useRef<HTMLTableElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  // Set when the keyboard, a page button or a click moved the active row:
  // only then is the row scrolled into the table's view.
  const moved = useRef(false)
  // The callers build their columns anew on each render; keyed on the
  // column id, moving the active row does not sort all rows again.
  const columnsNow = useRef(columns)
  columnsNow.current = columns
  const sortColumn = sort?.column
  const sortDesc = !!sort?.desc
  const order = useMemo(
    () => sortIds(ids, columnsNow.current.find((c) => c.id === sortColumn), sortDesc),
    [ids, sortColumn, sortDesc]
  )
  const n = order.length
  // A new filter or sort starts at the first row.
  useEffect(() => setActive(0), [ids, sort])
  const at = Math.min(active, Math.max(0, n - 1))
  const start = Math.floor(at / PAGE) * PAGE
  const shown = order.slice(start, start + PAGE)
  const rowId = (j: number): string => `${base}-r${j}`

  // Bring the active row into view within the table's own scroll box, and
  // only after the user moved it there: never on mount, a new filter or any
  // other render, and never by scrolling the page around the table
  // (scrollIntoView would scroll every ancestor too).
  useEffect(() => {
    if (!moved.current) return
    moved.current = false
    const wrap = wrapRef.current
    const el = document.getElementById(rowId(at))
    if (!wrap || !el) return
    const w = wrap.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    // The sticky header covers the top of the box.
    const head = wrap.querySelector('thead')?.getBoundingClientRect().height ?? 0
    if (r.top < w.top + head) wrap.scrollTop -= w.top + head - r.top
    else if (r.bottom > w.bottom) wrap.scrollTop += r.bottom - w.bottom
  }, [at, start])

  function move(to: number): void {
    if (n === 0) return
    const j = Math.max(0, Math.min(n - 1, to))
    // A move that stays put leaves no flag for a later render to act on.
    moved.current = j !== at
    setActive(j)
  }
  function onKey(e: KeyboardEvent<HTMLTableElement>): void {
    const to =
      e.key === 'ArrowDown' ? at + 1
      : e.key === 'ArrowUp' ? at - 1
      : e.key === 'PageDown' ? at + JUMP
      : e.key === 'PageUp' ? at - JUMP
      : e.key === 'Home' ? 0
      : e.key === 'End' ? n - 1
      : null
    if (to == null) return
    e.preventDefault()
    move(to)
  }
  function sortBy(c: Column): void {
    setSort((s) => (s?.column === c.id ? (s.desc ? null : { column: c.id, desc: true }) : { column: c.id, desc: false }))
  }

  return (
    <div className="dtable">
      <div className="dt-bar">
        <span className="dt-count" aria-live="polite">
          {n === total ? `${n.toLocaleString('en-US')} rows` : `${n.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} rows`}
          {n > PAGE && ` · showing ${(start + 1).toLocaleString('en-US')}–${Math.min(n, start + PAGE).toLocaleString('en-US')}`}
        </span>
        {n > PAGE && (
          <span className="dt-pages">
            <button type="button" className="secondary" disabled={start === 0} onClick={() => move(start - PAGE)}>
              Previous {PAGE}
            </button>
            <button type="button" className="secondary" disabled={start + PAGE >= n} onClick={() => move(start + PAGE)}>
              Next {PAGE}
            </button>
          </span>
        )}
      </div>
      {n === 0 ? (
        <div className="dt-empty">{empty ?? 'No rows match.'}</div>
      ) : (
        <div className="dt-wrap" ref={wrapRef}>
          <table
            ref={gridRef}
            className="taxa dt"
            role="grid"
            aria-label={label}
            aria-rowcount={n + 1}
            aria-activedescendant={rowId(at)}
            tabIndex={0}
            onKeyDown={onKey}
          >
            <thead>
              <tr role="row" aria-rowindex={1}>
                {columns.map((c) => {
                  const on = sort?.column === c.id
                  return (
                    <th
                      key={c.id}
                      role="columnheader"
                      scope="col"
                      className={c.num ? 'num' : undefined}
                      aria-sort={on ? (sort!.desc ? 'descending' : 'ascending') : 'none'}
                      title={c.title}
                    >
                      <button type="button" className="th-sort" onClick={() => sortBy(c)}>
                        {c.label}
                        <span className="sort-mark" aria-hidden="true">
                          {on ? (sort!.desc ? ' ↓' : ' ↑') : ''}
                        </span>
                      </button>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {shown.map((id, k) => {
                const j = start + k
                const on = j === at
                return (
                  <tr
                    key={id}
                    id={rowId(j)}
                    role="row"
                    aria-rowindex={j + 2}
                    aria-selected={on}
                    className={on ? 'active' : undefined}
                    onClick={() => {
                      moved.current = j !== at
                      setActive(j)
                      gridRef.current?.focus({ preventScroll: true })
                    }}
                  >
                    {columns.map((c) => (
                      <td key={c.id} role="gridcell" className={[c.num ? 'num' : '', c.mono ? 'mono' : ''].join(' ').trim() || undefined}>
                        {c.text(id)}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {n > 0 && (
        <p className="dt-help">
          Click a column to sort; in the table ↑ ↓, Page Up/Down, Home and End move the active row.
        </p>
      )}
    </div>
  )
}
