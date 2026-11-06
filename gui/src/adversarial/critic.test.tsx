// Species ties and the preflight refusals the other files do not cover.
//
// Real FASTag 1.9.0 outputs come from the directory named by
// FASTAG_GUI_TEST_OUTPUTS (public E. coli fixture only); tests that need
// them skip when it is unset (see ./external.ts).
// @ts-ignore -- the GUI's tsconfig carries no node types; vitest runs on node.
import { readFileSync } from 'node:fs'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from '../App'
import SpeciesPanel from '../SpeciesPanel'
import { conflicts, inertBecause } from '../paramLayout'
import { installMockBridge, type MockBridge } from '../testing/mockBridge'
import { applyAndCheck } from '../testing/lastUsed'
import type { SpeciesReport, Taxon } from '../types'
import { haveScratch, scratchPath } from './external'


// species.rs: drop observed <= 0 and keep the CLI's order. logP stays on the
// test's own rows (the GUI does not read it) for the tie-break check below.
type Row = Taxon & { logP: number }
function speciesFromTsv(text: string): { path: string; taxa: Row[] } {
  const [, ...lines] = text.trim().split('\n')
  const taxa = lines
    .map((l) => {
      const [rank, taxid, name, observed, adjusted, , logP, q] = l.split('\t')
      return { rank, taxid: +taxid, name, observed: +observed, adjusted: +adjusted, logP: +logP, q: +q }
    })
    .filter((t) => t.observed > 0)
  return { path: '/r/x.species.tsv', taxa }
}

describe('critic: species headline on an exact tie', () => {
  const f = scratchPath('map/run.tags.species.tsv')
  it.skipIf(!haveScratch('map/run.tags.species.tsv'))('ten genera with identical observed/adjusted counts are headlined as a tie, not one call', () => {
    const rep = speciesFromTsv(readFileSync(f, 'utf8'))
    const tied = rep.taxa.filter((t) => t.adjusted === rep.taxa[0].adjusted && t.observed === rep.taxa[0].observed)
    expect(tied.map((t) => t.name)).toEqual([
      'Escherichia', 'Klebsiella', 'Salmonella', 'Yersinia', 'Sus', 'Bos', 'Ovis', 'Mus', 'Pectobacterium', 'Dickeya'
    ])
    const { container } = render(<SpeciesPanel report={rep} enabled tooShort={null} contributed={7} totalMs2={139} />)
    const head = container.querySelector('.headline')!
    expect(head.querySelector('.taxon')!.textContent).toBe('No single call')
    expect(head.textContent).toMatch(
      /Tie between 10 taxa: Escherichia, Klebsiella, Salmonella, Yersinia, Sus, Bos, Ovis, Mus, Pectobacterium, Dickeya/
    )
    // The CLI breaks the tie by taxid only: Yersinia has the strongest
    // p-value of the tied block, so naming any one genus would mislead.
    const best = [...tied].sort((a, b) => a.logP - b.logP)[0]
    expect(best.name).toBe('Yersinia')
  })

  const b = scratchPath('parsers/b.tags.species.tsv')
  it.skipIf(!haveScratch('parsers/b.tags.species.tsv'))('E. coli fixture, Da run: Chlamydomonas and an exactly tied Zea are headlined as a tie', () => {
    const rep = speciesFromTsv(readFileSync(b, 'utf8'))
    expect(rep.taxa[0].name).toBe('Chlamydomonas')
    expect(rep.taxa[1].name).toBe('Zea')
    expect(rep.taxa[0].adjusted).toBe(rep.taxa[1].adjusted)
    const { container } = render(<SpeciesPanel report={rep} enabled tooShort={null} contributed={null} totalMs2={null} />)
    expect(container.querySelector('.headline .taxon')!.textContent).toBe('No single call')
    expect(container.querySelector('.headline')!.textContent).toMatch(/Tie between 2 taxa: Chlamydomonas, Zea/)
  })
})

async function renderWith(lastUsed: Record<string, unknown>): Promise<MockBridge> {
  const mock = installMockBridge()
  mock.settings = { schemaVersion: 1, lastUsed, presets: {} }
  render(<App />)
  await screen.findByText('FASTag ready')
  await act(async () => {})
  await applyAndCheck(lastUsed) // D6: the offer, clicked; guards the form
  mock.nextPickInput = '/d/a.mzML'
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /^(Choose file|Change)…$/ }))
  })
  return mock
}
const runBtn = (): HTMLElement => screen.getByRole('button', { name: /^(Run( on .+)?|Running…)$/ })

describe('critic: CLI up-front refusals the form never anticipates', () => {
  it('entrapment_fasta + species is refused up front (CLI: rc 6 "-entrapment_fasta cannot be combined with -species")', async () => {
    const mock = await renderWith({ fasta: '/d/t.fasta', entrapment_fasta: '/d/e.fasta', species: true, tag_length: '7' })
    const v = { fasta: '/d/t.fasta', entrapment_fasta: '/d/e.fasta', species: true }
    expect(inertBecause('entrapment_fasta', v)).toBeNull()
    expect(inertBecause('species', v)).toBeNull()
    expect(conflicts(v).map((c) => c.params[0])).toContain('entrapment_fasta')
    expect((runBtn() as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/entrapment_fasta cannot be combined with species/)).toBeDefined()
    await act(async () => {
      fireEvent.click(runBtn())
    })
    expect(mock.runCalls).toHaveLength(0)
  })

  it('entrapment_fasta + tag_lengths is refused up front (CLI: rc 6 "run each of -tag_lengths separately")', async () => {
    const mock = await renderWith({ fasta: '/d/t.fasta', entrapment_fasta: '/d/e.fasta', tag_lengths: ['5', '6'] })
    expect(inertBecause('entrapment_fasta', { fasta: '/d/t.fasta', tag_lengths: ['5', '6'] })).toBeNull()
    expect(conflicts({ fasta: '/d/t.fasta', entrapment_fasta: '/d/e.fasta', tag_lengths: ['5', '6'] })).not.toHaveLength(0)
    expect((runBtn() as HTMLButtonElement).disabled).toBe(true)
    await act(async () => {
      fireEvent.click(runBtn())
    })
    expect(mock.runCalls).toHaveLength(0)
  })

  it('recon_out with neither recon_fasta nor fasta is refused up front (CLI: rc 6 "-recon_out needs a database")', async () => {
    const mock = await renderWith({ recon_out: '/d/a.recon.tsv' })
    expect(inertBecause('recon_out', { recon_out: '/d/a.recon.tsv' })).toBeNull()
    expect(conflicts({ recon_out: '/d/a.recon.tsv' })).not.toHaveLength(0)
    expect((runBtn() as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('recon_out needs a database: set recon_fasta (or fasta).')).toBeDefined()
    await act(async () => {
      fireEvent.click(runBtn())
    })
    expect(mock.runCalls).toHaveLength(0)
  })
})
