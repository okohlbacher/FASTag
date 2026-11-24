// The GUI's terminal anchor and FASTag's -terminus columns agree row by row
// (b/y). Real CLI output on 23 MS2 spectra of the public PXD003531 Q
// Exactive run at 20 ppm, with the dumps of the same build
// (src/fixtures/cli/v115-pxd003531-terminus, cmd.txt).
//
// For each row the ladder on the row's own peaks (walked from cterm_mass as
// y ions, its low peak the tag's low peak) is read both ways (anchorsOf); the
// GUI's anchor-only decision (usedAnchor, at a tolerance the anchors are used
// at) must be the CLI's series column, and the tokens of each reading the
// CLI's terminus column.

import { describe, expect, it } from 'vitest'
import { laddersFor, residueMasses, tagRowFrom } from './ladder'
import { parseDump, splitDumps, type SpectrumPeaks } from './dump'
import { anchorsOf, terminusText, termContext, usedAnchor } from './terminus'
import tags from '../fixtures/cli/v115-pxd003531-terminus/run.tags.tsv?raw'
import dumps from '../fixtures/cli/v115-pxd003531-terminus/dumps.jsonl?raw'

const RES = residueMasses(undefined)
const CTX = termContext(null, RES)

function dumpsById(text: string): Map<string, SpectrumPeaks> {
  const m = new Map<string, SpectrumPeaks>()
  for (const d of splitDumps(text)) {
    const r = parseDump(d)
    if (!r.ok) throw new Error(r.error)
    m.set(r.spectrum.nativeId, r.spectrum)
  }
  return m
}

describe('-terminus parity: the GUI anchor and the CLI series column', () => {
  const lines = tags.split('\n').filter((l) => l !== '')
  const columns = lines[0].split('\t')
  const rows = lines.slice(1).map((l) => l.split('\t'))
  const spectra = dumpsById(dumps)
  const col = (name: string): number => columns.indexOf(name)

  it('the fixture is a 20 ppm run with calls of both series and rows anchored both ways', () => {
    expect(col('series')).toBeGreaterThan(0)
    expect(col('terminus')).toBe(col('series') + 1)
    expect(new Set(rows.map((r) => r[0])).size).toBe(spectra.size)
    for (const s of spectra.values()) expect([s.tolerance, s.toleranceUnit]).toEqual([20, 'ppm'])
    const series = rows.map((r) => r[col('series')])
    expect(series.filter((s) => s === 'y').length).toBeGreaterThan(20)
    expect(series.filter((s) => s === 'b').length).toBeGreaterThan(20)
    // Rows whose tokens the series does not use (b(n-1) of K/R, C+X), and rows with both readings anchored.
    expect(rows.filter((r) => r[col('series')] === '-' && r[col('terminus')] !== '-').length).toBeGreaterThan(5)
    // A lone K or R from the precursor (b(n-1)): listed, not called.
    expect(rows.filter((r) => r[col('series')] === '-' && /^C\+[KR]$/.test(r[col('terminus')])).length).toBeGreaterThan(5)
    // Both readings anchored, one through a used token: called.
    expect(rows.filter((r) => r[col('series')] !== '-' && r[col('terminus')].startsWith('y:')).length).toBeGreaterThan(0)
  })

  it('every row: the anchor-only series is the CLI series, and the same tokens for each reading', () => {
    const bad: string[] = []
    let anchored = 0
    for (const cells of rows) {
      const row = tagRowFrom(columns, cells)
      if (!row) throw new Error(`not a tag row: ${cells.join(' ')}`)
      const s = spectra.get(row.spectrum)
      if (!s) throw new Error(`no dump of ${row.spectrum}`)
      const own = laddersFor(row, s, RES, CTX).both.find((l) => l.walked === 'y')
      if (!own) throw new Error(`no ladder for ${row.tag}`)
      const anchors = anchorsOf(own, s, RES, CTX)
      const tok = (series: 'b' | 'y'): string => {
        const a = anchors.find((x) => x.series === series)
        return a ? terminusText(a.t) : ''
      }
      const ty = tok('y')
      const tb = tok('b')
      const terminus = ty && tb ? `y:${ty};b:${tb}` : ty || tb || '-'
      const used = usedAnchor(anchors)
      const series = used ? used.series : '-'
      if (terminus !== '-') anchored++
      const cli = { series: cells[col('series')], terminus: cells[col('terminus')] }
      if (series !== cli.series || terminus !== cli.terminus)
        bad.push(`${row.spectrum} ${row.tag}: GUI ${series} ${terminus}, CLI ${cli.series} ${cli.terminus}`)
    }
    expect(bad).toEqual([])
    expect(anchored).toBeGreaterThan(100)
  })
})
