// Mass shifts by residue (Mass shifts tab, "By residue"): the -delta_out
// table as a matrix, one row per mass shift and one column per site class,
// each cell the localized spectra of that shift on that site (the residues
// column, shiftMatrix.ts). The row totals say how much of each shift is
// localized at all. The shared DataTable sorts, pages and moves by keyboard;
// "Export matrix…" writes the rows and columns shown, in the order shown.

import { useMemo, useRef, useState, type JSX } from 'react'
import DataTable, { type Column } from './DataTable'
import { baseName } from '../digestReport'
import { stripExt } from '../app/paths'
import { pathKey } from '../run/batch'
import { useSticky } from './tableStore'
import type { DeltaTable } from './tables'
import { C_TERM, N_TERM, RESIDUE_NAME, delimited, localizedPct, pivotResidues, shownColumns, type MatrixRow, type TerminalMode } from './shiftMatrix'

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

export default function ResidueMatrix({ t }: { t: DeltaTable }): JSX.Element {
  const [minLoc, setMinLoc] = useSticky(t, 'matrixMin', '1')
  const [hideEmpty, setHideEmpty] = useSticky(t, 'matrixHideEmpty', true)
  const [byResidue, setByResidue] = useSticky(t, 'matrixByResidue', false)
  const mode: TerminalMode = byResidue ? 'residue' : 'terminus'
  const m = useMemo(() => pivotResidues(t, mode), [t, mode])
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

  const cols: MatrixColumn[] = [
    { id: 'delta', label: 'Gap (Da)', num: true, title: 'The mass shift, as -delta_out prints it', text: (i) => rowAt(i).key, key: (i) => rowAt(i).delta, raw: (i) => rowAt(i).key },
    {
      id: 'name',
      label: 'Best name',
      title: 'The first UniMod name that fits a site of the row, else the first PSI-MOD name, else the isotope error; without its mass error',
      text: (i) => rowAt(i).name,
      cellTitle: (i) => rowAt(i).names || undefined,
      raw: (i) => rowAt(i).name
    },
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
    const dest = await window.fastag.saveFile(`${stripExt(t.path)}.by_residue.tsv`, ['tsv', 'csv'])
    if (!dest) return
    const format = /\.csv$/i.test(dest) ? 'csv' : /\.tsv$/i.test(dest) ? 'tsv' : null
    if (!format) {
      setSaved({ ok: false, text: `Not written: name the file .tsv or .csv (${dest}).` })
      return
    }
    if (pathKey(dest) === pathKey(t.path)) {
      setSaved({ ok: false, text: `Not written: ${dest} is the mass-shift table shown. Choose another name.` })
      return
    }
    const rows = order.current && order.current.length === ids.length ? order.current : Array.from(ids)
    const text = delimited(
      cols.map((c) => c.id),
      rows.map((i) => cols.map((c) => c.raw(i))),
      format
    )
    try {
      await window.fastag.writeSummary(dest, text, [t.path])
      setSaved({ ok: true, text: `${en(rows.length)} ${rows.length === 1 ? 'row' : 'rows'} and ${en(sites.length)} site ${sites.length === 1 ? 'column' : 'columns'} written to ${dest}, in the order shown.` })
    } catch (e) {
      setSaved({ ok: false, text: `Could not write the matrix: ${e instanceof Error ? e.message : String(e)}` })
    }
  }

  return (
    <>
      <p className="caveat">
        Localized spectra only: the <code>residues</code> column of {file}, each spectrum counted once on its site; the shading follows the log of the count.
        {m.terminal && !byResidue && ' N-term and C-term hold the terminal-ambiguous sites (N-term|K: the N-terminus or the K side chain).'}{' '}
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
        <button type="button" className="secondary small" disabled={ids.length === 0} onClick={() => void exportMatrix()}>
          Export matrix…
        </button>
      </div>
      <p className="report-sum" aria-live="polite">
        {ids.length === 0
          ? 'No mass shift has that many localized spectra.'
          : `${en(ids.length)} mass ${ids.length === 1 ? 'shift' : 'shifts'} with ${en(spectra)} spectra: ${en(loc)} localized (${spectra > 0 ? Math.round((100 * loc) / spectra) : 0}%), ${en(unloc)} unlocalized.`}
      </p>
      {m.mismatched.length > 0 && (
        <p className="warn" role="status">
          In {en(m.mismatched.length)} {m.mismatched.length === 1 ? 'row' : 'rows'} the sites do not add up to the localized column: the file may be cut or edited.
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
    </>
  )
}
