// Facts about the parameter manifest and the form: choices, types and
// columns as the CLI declares them.
import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import manifest from '../params.generated.json'
import { PARAM_BY_NAME, RENDERED, HIDDEN } from '../paramLayout'
import SpeciesPanel from '../SpeciesPanel'

const raw = (name: string) => (manifest.params as { name: string; choices?: string[] }[]).find((p) => p.name === name)

describe('map: param overlay vs CLI manifest', () => {
  it('orientation offers exactly the manifest choices the 1.9.0 CLI accepts', () => {
    expect(raw('orientation')?.choices).toEqual(['both', 'forward'])
    expect(PARAM_BY_NAME.get('orientation')?.choices).toEqual(['both', 'forward'])
  })
  it('species_rank offers "domain", the bundled taxdump rank, not superkingdom', () => {
    const c = PARAM_BY_NAME.get('species_rank')?.choices ?? []
    expect(c).toContain('domain')
    expect(c).not.toContain('superkingdom')
  })
  it('renders 68 parameters and hides 74 (mzpeak_read_memory and 63 of the 64 1.12 options among them)', () => {
    // 1.10.0 added species_evidence (rendered) to the 1.9.0 set; 1.12.0 adds
    // 64 options (8 of them #17 -search_shifts), hidden until each has its GUI design, except
    // acquisition_check: its default refuses raw DIA, so the form offers warn/off.
    expect(RENDERED.length).toBe(68)
    expect(Object.keys(HIDDEN).length).toBe(74)
    expect(RENDERED).toContain('acquisition_check')
    expect(PARAM_BY_NAME.get('acquisition_check')?.choices).toEqual(['refuse', 'warn', 'off'])
    expect(manifest.params.length).toBe(142)
  })
  it('tag_lengths reaches the UI as an int list with min 1', () => {
    const p = PARAM_BY_NAME.get('tag_lengths')
    expect(p?.type).toBe('string-list')
    expect(p?.itemType).toBe('int')
    expect(p?.min).toBe(1)
  })
})

describe('map: SpeciesPanel columns', () => {
  const report = {
    path: '/x.species.tsv',
    empty: false,
    taxa: [
      // CLI order: adjusted desc. Deconvolution case from species.rs's own test.
      { rank: 'genus', taxid: 3, name: 'True', observed: 100, adjusted: 90, expected: 2, logP: -50, q: 0 },
      { rank: 'genus', taxid: 2, name: 'Neighbour', observed: 200, adjusted: 1, expected: 2, logP: -99, q: 0 }
    ]
  }
  it('the column is "adjusted", and rel. is relative to the top (rank-1) taxon', () => {
    render(<SpeciesPanel report={report} enabled tooShort={null} contributed={null} totalMs2={null} />)
    const rows = screen.getAllByRole('row')
    expect(within(rows[0]).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Taxon', 'Rank', 'Relative to top taxon', 'Observed', 'Adjusted', 'q-value'
    ])
    const top = within(rows[1]).getAllByRole('cell').map((c) => c.textContent)
    const second = within(rows[2]).getAllByRole('cell').map((c) => c.textContent)
    expect(top[0]).toBe('True')
    expect(top[2]).toBe('100%') // the rank-1 taxon is the reference
    expect(top[4]).toBe('90')
    expect(second[2]).toBe('1%')
  })
})
