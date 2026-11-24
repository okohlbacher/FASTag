// The Spectrum tab with -fasta_proteins: the Database hit cell names the
// protein and the tag's range, and the tags that hit one protein uniquely
// are aligned on its residues, read from the run's database.

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import SpectrumPanel from './SpectrumPanel'
import { PROTON, WATER, residueMasses } from './ladder'
import { installMockBridge } from '../testing/mockBridge'
import type { ResultsPage } from '../types'

const R = residueMasses(undefined).masses
const PEP = 'PEPTIDEK'
const sum = (t: string): number => [...t].reduce((a, r) => a + R[r], 0)
const MASS = sum(PEP) + WATER
const b: number[] = []
let m = PROTON
for (const r of PEP.slice(0, 7)) b.push((m += R[r]))
const mz = [...b, ...b.map((x) => MASS - (x - PROTON) + PROTON)].sort((p, q) => p - q)
const dump =
  JSON.stringify({
    record: 'spectrum', format: 1, native_id: 'scan=1', index: 0, ms_level: 2, rt: 1, precursor: (MASS + 2 * PROTON) / 2, charge: 2, charge_given: 2,
    tolerance: 20, tolerance_unit: 'ppm', picked: false, deisotoped: true, tagged: true, n_read: mz.length, n: mz.length, mz, int: mz.map(() => 1000)
  }) + '\n{"record":"end"}\n'
const COLS = ['spectrum', 'tag', 'length', 'charge', 'nterm_mass', 'cterm_mass', 'extended', 'gapped', 'evalue', 'fasta_hit', 'db_proteins', 'db_genes', 'db_protein_count']
const tag = (t: string, nterm: number, e: string, hit: string, prot: string, gene: string, n: string): string[] => [
  'scan=1', t, String(t.length), '1', String(nterm), String(MASS - WATER - nterm - sum(t)), '0', '0', e, hit, prot, gene, n
]
// The protein: PEPTIDEK at 21..28, after K20, in a protein of 40.
const SEQ = 'MAGSTWVLLR' + 'QAHSEGNMAK' + 'PEPTIDEK' + 'WWAAGGSSVV' + 'CC'
const ROWS = [
  tag('EPTIDE', sum('P'), '1e-9', 'fwd', 'sp|P12345|TEST_ECOLI@22-27', 'tstA', '1'),
  tag('EDIT', sum('PEPT') , '1e-5', 'rev', 'sp|P12345|TEST_ECOLI@24-27', 'tstA', '1'),
  tag('PT', sum('PE'), '1e-3', 'fwd', 'sp|P12345|TEST_ECOLI@23-24;sp|Q9|OTHER_ECOLI@5-6;sp|Q8|THIRD_ECOLI@1-2', 'tstA;-;thd', '7')
]
const page = (rows: string[][]): ResultsPage => ({ columns: COLS, totalRows: rows.length, matchedRows: rows.length, rows, rowIds: rows.map((_, i) => i), ranked: true, pending: false })

function panel(rows: string[][], params: Record<string, unknown> | null = { fasta: '/db/e.fasta' }) {
  const mock = installMockBridge()
  mock.spectrumDumps['scan=1'] = dump
  mock.fastaFiles['/db/e.fasta'] = { 'sp|P12345|TEST_ECOLI': `Test protein OS=Escherichia coli GN=tstA\t${SEQ}` }
  // The run that wrote the tags read the databases it was given.
  if (params) mock.fastaRuns['/d/a.tags.tsv'] = params as Record<string, string>
  window.fastag.resultsQuery = () => Promise.resolve(page(rows))
  const r = render(
    <SpectrumPanel target={{ path: '/d/a.tags.tsv', spectrum: 'scan=1', rowId: 0 }} source={{ input: '/d/a.mzML', params, from: 'run' }} onTarget={vi.fn()} onLocate={vi.fn()} />
  )
  return { ...r, mock }
}

describe('Spectrum, database proteins', () => {
  it('the Database hit cell names the protein, its gene and the range, "+k more" for the rest', async () => {
    panel(ROWS)
    const table = await screen.findByRole('grid', { name: 'Tags of this spectrum' })
    const cells = within(table).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('gridcell')[5])
    expect(cells.map((c) => c.textContent)).toEqual(['P12345/tstA@22–27', 'P12345/tstA@24–27', 'P12345/tstA@23–24 +6 more'])
    expect(cells[1].getAttribute('title')).toMatch(/^rev: in the database, reversed\. sp\|P12345\|TEST_ECOLI \(tstA\) 24–27\. 1 protein in all\.$/)
    expect(cells[2].getAttribute('title')).toMatch(/4 more not listed\. 7 proteins in all\.$/)
  })

  it('aligns the tags that hit one protein uniquely on its residues, read from the run database', async () => {
    const { mock } = panel(ROWS)
    const block = await screen.findByTestId('align-block')
    await waitFor(() => expect(block.querySelector('.sp-al')).not.toBeNull())
    // Read once, around the tags, from the run's -fasta.
    expect(mock.fastaCalls).toEqual([{ tags: '/d/a.tags.tsv', database: 'fasta', path: '/db/e.fasta', identifier: 'sp|P12345|TEST_ECOLI', start: 1, end: 57 }])
    expect(block.querySelector('h4')!.textContent).toBe('P12345 · tstA · residues 18–31 of 40 · 2 tags')
    expect(block.textContent).toContain('GN=tstA')
    const rows = within(block).getAllByRole('row')
    // The protein, then each tag under its residues (EDIT reversed: TIDE).
    const seqOf = (r: HTMLElement): string => [...r.querySelectorAll('.sp-al-seq .sp-al-res')].map((c) => (c.textContent === ' ' ? '.' : c.textContent)).join('')
    expect(seqOf(rows[0])).toBe('MAKPEPTIDEKWWA')
    expect(seqOf(rows[1])).toBe('....EPTIDE....')
    expect(seqOf(rows[2])).toBe('......TIDE....')
    expect(rows[2].textContent).toContain('reversed')
    // The tryptic peptide PEPTIDEK shaded, 3 residues either side not.
    expect([...rows[0].querySelectorAll('.sp-al-res.pep')].map((c) => c.textContent).join('')).toBe('PEPTIDEK')
    // The tag on several proteins is named, not aligned.
    expect(screen.getByTestId('align-several').textContent).toBe('Not aligned: PT matches 7 proteins.')
    // A tag's name draws its ladder.
    fireEvent.click(within(rows[2]).getByRole('button', { name: 'EDIT' }))
    await waitFor(() => expect(within(rows[2]).getByRole('button', { name: 'EDIT' }).getAttribute('aria-pressed')).toBe('true'))
  })

  it('a run whose database is not known: the positions without the residues', async () => {
    const { mock } = panel(ROWS, {})
    const block = await screen.findByTestId('align-block')
    await waitFor(() => expect(block.textContent).toContain("The run's database is not known here"))
    expect(block.textContent).toContain('EPTIDE at residues 22–27')
    expect(block.textContent).toContain('EDIT at residues 24–27, reversed')
    expect(mock.fastaCalls).toEqual([])
  })

  it('an entrapment match is aligned on the entrapment database, never as a target', async () => {
    const { mock } = panel([tag('EPTIDE', sum('P'), '1e-9', 'efwd', 'ENT1@3-8', '-', '1')], { fasta: '/db/e.fasta', entrapment_fasta: '/db/trap.fasta' })
    mock.fastaFiles['/db/trap.fasta'] = { ENT1: 'KKEPTIDEKK' }
    const block = await screen.findByTestId('align-block')
    expect(block.querySelector('h4')!.textContent).toContain('entrapment database, a known false match')
    await waitFor(() => expect(mock.fastaCalls.map((c) => c.path)).toEqual(['/db/trap.fasta']))
  })

  // Codex #7: the CLI counts entries by ordinal but writes the identifier;
  // one the database gives twice is not aligned on either entry.
  it('an identifier of two entries is named with the run positions, not aligned', async () => {
    const { mock } = panel(ROWS)
    mock.fastaFiles['/db/e.fasta'] = { 'sp|P12345|TEST_ECOLI': [`first\t${SEQ}`, 'second\tPEPTIDEK'] }
    const block = await screen.findByTestId('align-block')
    await waitFor(() => expect(within(block).getByTestId('align-repeated').textContent).toMatch(/^sp\|P12345\|TEST_ECOLI names 2 entries of the database/))
    expect(block.querySelector('.sp-al')).toBeNull()
    expect(block.querySelector('h4')!.textContent).toBe('P12345 · tstA · residues 22–27 · 2 tags')
    expect(block.textContent).toContain('EPTIDE at residues 22–27')
    expect(block.textContent).toContain('EDIT at residues 24–27, reversed')
    expect(mock.fastaCalls.map((c) => c.database)).toEqual(['fasta'])
  })

  // Codex #3: the database read is the one of the run that wrote the tags.
  it('a tags table no run of the app wrote aligns nothing', async () => {
    const { mock } = panel(ROWS)
    delete mock.fastaRuns['/d/a.tags.tsv']
    const block = await screen.findByTestId('align-block')
    await waitFor(() => expect(block.textContent).toContain('Cannot read the protein: /d/a.tags.tsv was not written by a run of this app'))
    expect(block.querySelector('.sp-al')).toBeNull()
    expect(mock.fastaCalls.map((c) => c.tags)).toEqual(['/d/a.tags.tsv'])
  })

  // Codex #8: the tags are placed under the run's own isobaric rules
  // (-fixed_modifications, -isobaric_tolerance), as the CLI derives them.
  it('places a tag under the run\'s fixed modifications; where they give no reading, the positions only', async () => {
    // AKLE matched AGVLE (4..8): with Dimethyl (K) fixed, K weighs G + V.
    const DM = 'MSRAGVLEPKWE'
    const dmRow = [tag('AKLE', sum('MSR'), '1e-9', 'fwd', 'sp|P2|DM_ECOLI@4-8', '-', '1')]
    const cellsOf = (r: HTMLElement): string => [...r.querySelectorAll('.sp-al-seq .sp-al-res')].map((c) => (c.textContent!.trim() === '' ? '.' : c.textContent)).join('')
    {
      const { mock, unmount } = panel(dmRow, { fasta: '/db/e.fasta', fixed_modifications: ['Carbamidomethyl (C)', 'Dimethyl (K)'] })
      mock.fastaFiles['/db/e.fasta'] = { 'sp|P2|DM_ECOLI': `dm\t${DM}` }
      const block = await screen.findByTestId('align-block')
      await waitFor(() => expect(block.querySelector('.sp-al')).not.toBeNull())
      const rows = within(block).getAllByRole('row')
      expect(cellsOf(rows[0])).toBe(DM)
      expect(cellsOf(rows[1])).toBe('...AK.LE....')
      expect([...rows[1].querySelectorAll('.sp-al-res.diff')]).toHaveLength(2)
      expect(within(block).queryByTestId('align-unplaced')).toBeNull()
      unmount()
    }
    // The same match in a run at the default modifications: no reading, so
    // no letter is shifted; the span is marked and the hint says why.
    const { mock } = panel(dmRow, { fasta: '/db/e.fasta' })
    mock.fastaFiles['/db/e.fasta'] = { 'sp|P2|DM_ECOLI': `dm\t${DM}` }
    const block = await screen.findByTestId('align-block')
    await waitFor(() => expect(block.querySelector('.sp-al')).not.toBeNull())
    const rows = within(block).getAllByRole('row')
    expect(cellsOf(rows[1])).toBe('............')
    expect([...rows[1].querySelectorAll('.sp-al-res.span')]).toHaveLength(5)
    expect(within(rows[1]).getByRole('cell').getAttribute('aria-label')).toContain('placement of its residues not reconstructed')
    expect(within(block).getByTestId('align-unplaced').textContent).toContain('the placement of its residues cannot be reconstructed for this run')
  })

  it('no db_proteins column (a run without -fasta_proteins, an older CLI): In database, no alignment', async () => {
    installMockBridge().spectrumDumps['scan=1'] = dump
    const cols = COLS.slice(0, 10)
    window.fastag.resultsQuery = () => Promise.resolve({ ...page([]), columns: cols, rows: ROWS.map((r) => r.slice(0, 10)), totalRows: 3, matchedRows: 3, rowIds: [0, 1, 2] })
    render(<SpectrumPanel target={{ path: '/d/a.tags.tsv', spectrum: 'scan=1', rowId: 0 }} source={{ input: '/d/a.mzML', params: { fasta: '/db/e.fasta' }, from: 'run' }} onTarget={vi.fn()} onLocate={vi.fn()} />)
    const table = await screen.findByRole('grid', { name: 'Tags of this spectrum' })
    expect(within(table).getAllByRole('row')[1].textContent).toContain('In database')
    expect(screen.queryByRole('region', { name: 'Alignment on the database' })).toBeNull()
  })
})
