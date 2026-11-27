// Mass shifts by residue (Mass shifts tab, "By residue"): the -delta_out
// table as a matrix, one row per mass shift and one column per site class,
// each cell the localized spectra of that shift on that site (the residues
// column, shiftMatrix.ts). The row totals say how much of each shift is
// localized at all. The shared DataTable sorts, pages and moves by keyboard;
// "Export matrix…" writes the rows and columns shown, in the order shown.
// The unshifted rows (|gap| under 0.5 Da) are left out and counted in the
// caption. "Add tables…" and "Pool the batch" pool other runs' tables into
// the matrix (shiftMatrix.ts poolTables, read by poolLoad.ts).

import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import DataTable, { type Column } from './DataTable'
import { baseName } from '../digestReport'
import { stripExt } from '../app/paths'
import { pathKey } from '../run/batch'
import { useSticky } from './tableStore'
import type { DeltaTable } from './tables'
import { SHIFT_MIN_DA } from './overview'
import { UnshiftedLine } from './unshifted'
import { readPool, recordedGroup, type PoolRead, type PoolTable } from './poolLoad'
import { C_TERM, N_TERM, RESIDUE_NAME, delimited, localizedPct, poolTables, poolTolerance, shownColumns, sourceOf, type MatrixRow, type TerminalMode } from './shiftMatrix'

const en = (n: number): string => n.toLocaleString('en-US')

/// A cell's shade, 0 to 1: the log of its count against the log of the largest
/// count shown, so a rare modification still shows beside a frequent one
/// (oxidation can outnumber the others a hundredfold).
export const heatOf = (n: number, top: number): number => (n > 0 && top > 0 ? Math.log1p(n) / Math.log1p(top) : 0)

/// The tooltip of a site column's heading.
function columnTitle(c: string, mode: TerminalMode): string {
  if (c === N_TERM) return 'N-term: terminal-ambiguous sites at the peptide or protein N-terminus (N-term|K: the N-terminus or the K side chain)'
  if (c === C_TERM) return 'C-term: terminal-ambiguous sites at the peptide or protein C-terminus (C-term|R: the C-terminus or the R side chain)'
  const name = RESIDUE_NAME[c]
  const ends = mode === 'residue' ? ', terminal-ambiguous sites on it included' : ''
  return name ? `${c}: ${name}${ends}` : `${c}: a site the table names so`
}

/// A matrix column: what it shows, and what the export writes.
interface MatrixColumn extends Column {
  raw(i: number): string
}

/// The tables pooled with the one shown: their rows, the files left out,
/// and the -delta_group of the shown table's run (null: not recorded).
interface Pool extends PoolRead {
  own: number | null
}

/// At most this many files named in the "Not pooled" line.
const FAILED_SHOWN = 3

const plural = (n: number, one: string, many = `${one}s`): string => `${en(n)} ${n === 1 ? one : many}`

export interface ResidueMatrixProps {
  t: DeltaTable
  /// The mass-shift tables of the batch's finished jobs (Pool the batch).
  batch?: readonly string[]
  /// Told how many tables the matrix pools (0: the table shown alone, or the
  /// view gone): the Mass shifts view hides its one-run chart while pooled.
  onPooled?(n: number): void
}

export default function ResidueMatrix({ t, batch = [], onPooled }: ResidueMatrixProps): JSX.Element {
  const [minLoc, setMinLoc] = useSticky(t, 'matrixMin', '1')
  const [hideEmpty, setHideEmpty] = useSticky(t, 'matrixHideEmpty', true)
  const [byResidue, setByResidue] = useSticky(t, 'matrixByResidue', false)
  // Kept with the table shown, as its filters are: a tab switch keeps the pool.
  const [pool, setPool] = useSticky<Pool | null>(t, 'matrixPool', null)
  const [reading, setReading] = useState<{ done: number; of: number } | null>(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const mode: TerminalMode = byResidue ? 'residue' : 'terminus'
  const own = useMemo(() => sourceOf(t), [t])
  const tol = useMemo(() => (pool ? poolTolerance([pool.own, ...pool.tables.map((x) => x.group)]) : null), [pool])
  // One table: its own rows (tolerance 0 merges nothing); pooled: merged by mass.
  const m = useMemo(() => (own ? poolTables([own, ...(pool?.tables.map((x) => x.source) ?? [])], mode, tol ? tol.tolerance : 0) : null), [own, pool, mode, tol])
  const pooled = !!pool && pool.tables.length > 0
  const nPooled = pooled ? pool.tables.length + 1 : 0
  useEffect(() => {
    onPooled?.(nPooled)
  }, [nPooled, onPooled])
  useEffect(() => () => onPooled?.(0), [onPooled])
  const min = minLoc.trim() !== '' && Number.isFinite(Number(minLoc)) ? Number(minLoc) : 0
  const ids = useMemo(() => {
    if (!m) return new Uint32Array(0)
    return Uint32Array.from(m.rows.filter((r) => r.localized >= min).map((r) => r.row))
  }, [m, min])
  const shown = useMemo(() => (m ? Array.from(ids, (i) => m.rows[i]) : []), [m, ids])
  const sites = useMemo(() => (m ? shownColumns(m, shown, hideEmpty, mode) : []), [m, shown, hideEmpty, mode])
  // The shade of a cell: the log of its count against the largest cell shown (heatOf).
  const top = useMemo(() => shown.reduce((x, r) => Math.max(x, ...sites.map((c) => r.counts.get(c) ?? 0)), 0), [shown, sites])
  const order = useRef<readonly number[] | null>(null)
  const [saved, setSaved] = useState<{ ok: boolean; text: string } | null>(null)

  if (!m) return <p className="muted">This mass-shift table has no residues column (FASTag 1.15.2 or later writes it).</p>
  const rowAt = (i: number): MatrixRow => m.rows[i]
  const count = (i: number, c: string): number => rowAt(i).counts.get(c) ?? 0
  const file = baseName(t.path)
  const paths = [t.path, ...(pool?.tables.map((x) => x.source.path) ?? [])]
  const inPool = new Set(paths.map(pathKey))
  const batchNew = batch.filter((p) => !inPool.has(pathKey(p)))
  const batchAll = new Set([pathKey(t.path), ...batch.map(pathKey)]).size

  /// Pool @p add with the tables shown, a few files at a time.
  async function addTables(add: readonly string[]): Promise<void> {
    const fresh = add.filter((p) => !inPool.has(pathKey(p)))
    if (fresh.length === 0) return
    setSaved(null)
    setReading({ done: 0, of: fresh.length })
    let shown = 0
    const read = await readPool(fresh, (done, of) => {
      // The progress line, at most ten times a second.
      const now = performance.now()
      if (mounted.current && (done === of || now - shown > 100)) {
        shown = now
        setReading({ done, of })
      }
    })
    const ownGroup = pool ? pool.own : await recordedGroup(t.path)
    const before = pool ?? { own: ownGroup, tables: [] as PoolTable[], failed: [] }
    setPool({ own: ownGroup, tables: [...before.tables, ...read.tables], failed: [...before.failed, ...read.failed] })
    if (mounted.current) setReading(null)
  }

  async function pickTables(): Promise<void> {
    const picked = await window.fastag.pickFiles(['tsv'])
    if (picked.length) await addTables(picked)
  }

  const cols: MatrixColumn[] = [
    {
      id: 'delta',
      label: 'Gap (Da)',
      num: true,
      title: pooled ? 'The mass shift: the gap of the pooled row with the most spectra, as -delta_out prints it' : 'The mass shift, as -delta_out prints it',
      text: (i) => rowAt(i).key,
      key: (i) => rowAt(i).delta,
      cellTitle: (i) => {
        const r = rowAt(i)
        if (r.members < 2) return undefined
        return `Pooled from ${plural(r.members, 'row')} of ${plural(r.tables, 'table')}, gaps ${r.lo.toFixed(4)} to ${r.hi.toFixed(4)} Da`
      },
      raw: (i) => rowAt(i).key
    },
    {
      id: 'name',
      label: 'Best name',
      title: pooled
        ? "The best name the most of the row's spectra carry, over the pooled rows (each row's: the first UniMod name that fits a site, else the first PSI-MOD name, else the isotope error); without its mass error"
        : 'The first UniMod name that fits a site of the row, else the first PSI-MOD name, else the isotope error; without its mass error',
      text: (i) => rowAt(i).name,
      cellTitle: (i) => rowAt(i).names || undefined,
      raw: (i) => rowAt(i).name
    },
    ...(pooled
      ? [
          {
            id: 'tables',
            label: 'Tables',
            num: true,
            title: 'The pooled tables with a row at this mass shift',
            text: (i: number) => en(rowAt(i).tables),
            key: (i: number) => rowAt(i).tables,
            raw: (i: number) => String(rowAt(i).tables)
          }
        ]
      : []),
    { id: 'spectra', label: 'Spectra', num: true, title: 'Spectra in the row', text: (i) => en(rowAt(i).spectra), key: (i) => rowAt(i).spectra, raw: (i) => String(rowAt(i).spectra) },
    { id: 'localized', label: 'Localized', num: true, title: 'Spectra whose shift is placed on one site class: the sum of the site columns', text: (i) => en(rowAt(i).localized), key: (i) => rowAt(i).localized, raw: (i) => String(rowAt(i).localized) },
    { id: 'unlocalized', label: 'Unlocalized', num: true, title: 'Spectra with a shift and no site-determining evidence', text: (i) => en(rowAt(i).unlocalized), key: (i) => rowAt(i).unlocalized, raw: (i) => String(rowAt(i).unlocalized) },
    {
      id: 'localized_pct',
      label: 'Localized %',
      num: true,
      title: "Localized spectra as a share of the row's spectra",
      text: (i) => {
        const p = localizedPct(rowAt(i))
        return p == null ? '' : `${p}%`
      },
      key: (i) => localizedPct(rowAt(i)) ?? NaN,
      raw: (i) => String(localizedPct(rowAt(i)) ?? '')
    },
    ...sites.map(
      (c): MatrixColumn => ({
        id: c,
        label: c,
        num: true,
        title: columnTitle(c, mode),
        // An empty cell is no count: blank, so the counts stand out.
        text: (i) => (count(i, c) ? en(count(i, c)) : ''),
        key: (i) => count(i, c),
        cellTitle: (i) => {
          const d = rowAt(i).detail.get(c)
          if (!d) return undefined
          return `${c} at ${rowAt(i).key} Da: ${en(count(i, c))} localized (${d.map((s) => `${s.site} ${en(s.n)}`).join(', ')})`
        },
        heat: (i) => heatOf(count(i, c), top),
        raw: (i) => String(count(i, c))
      })
    )
  ]

  const loc = shown.reduce((n, r) => n + r.localized, 0)
  const unloc = shown.reduce((n, r) => n + r.unlocalized, 0)
  const spectra = shown.reduce((n, r) => n + r.spectra, 0)

  async function exportMatrix(): Promise<void> {
    setSaved(null)
    const dest = await window.fastag.saveFile(`${stripExt(t.path)}${pooled ? '.pooled' : ''}.by_residue.tsv`, ['tsv', 'csv'])
    if (!dest) return
    const format = /\.csv$/i.test(dest) ? 'csv' : /\.tsv$/i.test(dest) ? 'tsv' : null
    if (!format) {
      setSaved({ ok: false, text: `Not written: name the file .tsv or .csv (${dest}).` })
      return
    }
    // A pooled matrix names its tables in a sidecar beside it: <name>.sources.tsv (or .csv).
    const side = pooled ? `${stripExt(dest)}.sources.${format}` : null
    for (const out of side ? [dest, side] : [dest]) {
      if (inPool.has(pathKey(out))) {
        setSaved({ ok: false, text: `Not written: ${out} is ${pathKey(out) === pathKey(t.path) ? 'the mass-shift table shown' : 'a pooled mass-shift table'}. Choose another name.` })
        return
      }
    }
    const rows = order.current && order.current.length === ids.length ? order.current : Array.from(ids)
    const text = delimited(
      cols.map((c) => c.id),
      rows.map((i) => cols.map((c) => c.raw(i))),
      format
    )
    try {
      await window.fastag.writeSummary(dest, text, paths)
      const written = `${plural(rows.length, 'row')} and ${en(sites.length)} site ${sites.length === 1 ? 'column' : 'columns'} written to ${dest}, in the order shown`
      if (side && pool && tol) {
        const groups = [pool.own, ...pool.tables.map((x) => x.group)]
        const sources = delimited(
          ['source', 'shift_rows', 'shift_spectra', 'unshifted_rows', 'unshifted_spectra', 'delta_group'],
          m!.parts.map((p, k) => [p.path, String(p.rows), String(p.spectra), String(p.unshiftedRows), String(p.unshiftedSpectra), groups[k] == null ? '-' : String(groups[k])]),
          format
        )
        await window.fastag.writeSummary(side, sources, paths)
        setSaved({ ok: true, text: `${written}; the ${plural(paths.length, 'table')} pooled (rows within ${tol.tolerance} Da merged) listed in ${side}.` })
      } else setSaved({ ok: true, text: `${written}.` })
    } catch (e) {
      setSaved({ ok: false, text: `Could not write the matrix: ${e instanceof Error ? e.message : String(e)}` })
    }
  }

  return (
    <>
      {pooled && tol && (
        <p className="caveat pool-sum">
          Pooled:{' '}
          <span className="pool-files" tabIndex={0} title={paths.join('\n')}>
            {plural(paths.length, 'mass-shift table')}
          </span>{' '}
          (hover for the files); rows of different tables within {tol.tolerance} Da of each other are one row ({tol.recorded ? 'the -delta_group of their runs' : 'the -delta_group default: the tables do not record their own'}), their counts summed.
        </p>
      )}
      <p className="caveat">
        Localized spectra only: the <code>residues</code> column of {pooled ? 'each table' : file}, each spectrum counted once on its site; the shading follows the log of the count.
        {m.terminal && !byResidue && ' N-term and C-term hold the terminal-ambiguous sites (N-term|K: the N-terminus or the K side chain).'}{' '}
        {m.unshiftedRows > 0 &&
          `Rows with a gap under ${SHIFT_MIN_DA} Da (unshifted placements) are left out: their site is the residue the placement ends on, not a modification site. `}
        Candidates, not identifications.
      </p>
      <div className="dt-filters" role="group" aria-label="Matrix filters">
        <label>
          Localized at least
          <input type="number" min={0} step={1} value={minLoc} onChange={(e) => setMinLoc(e.target.value)} />
        </label>
        <label className="check">
          <input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} /> Hide empty residue columns
        </label>
        {m.terminal && (
          <label className="check" title="Count a terminal-ambiguous site (N-term|K) under its residue (K) instead of under N-term or C-term">
            <input type="checkbox" checked={byResidue} onChange={(e) => setByResidue(e.target.checked)} /> Terminal sites under their residue
          </label>
        )}
        <button type="button" className="secondary small" disabled={ids.length === 0 || !!reading} onClick={() => void exportMatrix()}>
          Export matrix…
        </button>
        <button type="button" className="secondary small" disabled={!!reading} title="Pool other runs' mass-shift tables (<run>.delta.tsv) with this one into one matrix" onClick={() => void pickTables()}>
          Add tables…
        </button>
        {batchNew.length > 0 && (
          <button type="button" className="secondary small" disabled={!!reading} title="Pool the mass-shift tables of the batch's finished jobs into one matrix" onClick={() => void addTables(batchNew)}>
            Pool the batch ({plural(batchAll, 'table')})
          </button>
        )}
        {pool && (
          <button type="button" className="secondary small" disabled={!!reading} onClick={() => setPool(null)}>
            This table only
          </button>
        )}
      </div>
      {reading && (
        <p className="hint" role="status">
          Reading mass-shift tables: {en(reading.done)} of {en(reading.of)}…
        </p>
      )}
      {pool && pool.failed.length > 0 && (
        <p className="warn" role="status">
          Not pooled: {pool.failed.slice(0, FAILED_SHOWN).map((f) => `${f.path} (${f.why})`).join('; ')}
          {pool.failed.length > FAILED_SHOWN && `; and ${plural(pool.failed.length - FAILED_SHOWN, 'more file')}`}.
        </p>
      )}
      <p className="report-sum" aria-live="polite">
        {ids.length === 0
          ? 'No mass shift has that many localized spectra.'
          : `${en(ids.length)} mass ${ids.length === 1 ? 'shift' : 'shifts'} with ${en(spectra)} spectra: ${en(loc)} localized (${spectra > 0 ? Math.round((100 * loc) / spectra) : 0}%), ${en(unloc)} unlocalized.`}
      </p>
      {m.mismatched.length > 0 && (
        <p className="warn" role="status">
          In {en(m.mismatched.length)} {m.mismatched.length === 1 ? 'row' : 'rows'} the sites do not add up to the localized column: {pooled ? 'a file' : 'the file'} may be cut or edited.
        </p>
      )}
      {saved && (
        <p className={saved.ok ? 'hint' : 'warn'} role="status">
          {saved.text}
        </p>
      )}
      <DataTable
        label="Mass shifts by residue"
        className="matrix"
        columns={cols}
        ids={ids}
        total={m.rows.length}
        empty="No mass shift has that many localized spectra: lower Localized at least."
        sort={{ column: 'spectra', desc: true }}
        keep={t}
        onOrder={(o) => {
          order.current = o
        }}
      />
      <UnshiftedLine n={m.unshiftedSpectra} />
    </>
  )
}
