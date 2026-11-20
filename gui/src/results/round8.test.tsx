// Review round 8, the pure parts and single components: the (?) popover's
// texts (14), the survey's tile and check (4), the alkylation extension by
// proteome (5, 6, 19, 20), the species database suggestion under a Da
// tolerance (9), the evidence check beside a lead genus tile (10), the
// residue confidence beside the tag (11), the charge note (12), "set by"
// (13), the cz re-run (17, 18) and the Characterize lead tiles (22).

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { popoverTexts } from '../help/HelpPopover'
import { buildOverview, leadTiles, shownTiles, type OverviewInputs } from './overview'
import OverviewPanel from './OverviewPanel'
import { alkylationExtension, alkylationRaise, alkylationTarget, PRODUCT_OF, toggleProduct } from '../setup/products'
import { displayOrder } from '../ResultsTable'
import { PARAM_UI } from '../paramUi'
import { postRunChecks } from '../inspector/checks'
import { sameCall } from '../run/useRun'
import ParamField from '../ParamField'
import { PARAM_BY_NAME, SECTIONS } from '../paramLayout'
import { TASKS } from '../setup/tasks'
import type { SpeciesReport } from '../types'

const base = (over: Partial<OverviewInputs> = {}): OverviewInputs => ({
  log: ['1000 MS2 spectra, 500 tags'],
  reports: [],
  species: null,
  census: null,
  params: {},
  instrument: null,
  ...over
})

describe('round 8, 14: the popover says each fact once', () => {
  it('drops the CLI line the plain text covers, and the default and off sentences', () => {
    const ui = PARAM_UI['max_evalue'].help!
    const t = popoverTexts('E-value cutoff; 0 disables.', ui.text, ui.tip)
    expect(t.text).toBe(ui.text.replace(' 0 turns the cutoff off.', ''))
    expect(t.cli).toBeUndefined()
    expect(t.tip).toBe('Lower it, for example to 1, to keep only the stronger tags.')
    expect(t.off).toBe('0')
  })
  it('a clause of a sentence goes alone: "0 turns extension off; the maximum is 12."', () => {
    const t = popoverTexts('Extension.', PARAM_UI['extension'].help!.text)
    expect(t.text).toMatch(/at each end, and scores the longer tag again\. The maximum is 12\.$/)
    expect(t.off).toBe('0')
  })
  it('the plain text first; a CLI line with more facts follows it (round 9, 8)', () => {
    const t = popoverTexts('A long CLI description that says much more than the short plain text does.', 'Short text.')
    expect(t.text).toBe('Short text.')
    expect(t.cli).toMatch(/^A long CLI/)
  })
})

describe('round 8, 4: the survey always has its tile', () => {
  const params = { delta_out: '/d/a.delta.tsv', delta_counts_out: '/d/a.counts.tsv' }
  it('no shift peak, with the reason, and the low-placement check', () => {
    const o = buildOverview(base({ params, delta: 'delta\tspectra\n0.000\t5\n', deltaCounts: 'key\tvalue\nms2_placed\t5\nms2_tagged\t400\n' }))
    const t = shownTiles(o, params).figures.find((x) => x.id === 'topshift')!
    expect(t).toMatchObject({ value: 'no shift peak', tone: 'nocall' })
    expect(t.note).toMatch(/with 5 placed spectra none could stand out/)
    expect(o.checks.find((c) => c.tone === 'flag')!.text).toMatch(/^Only 5 spectra are placed with a mass gap: too few for any conclusion/)
  })
  it('a found shift keeps its value; enough placements raise no check', () => {
    const o = buildOverview(base({ params, delta: 'delta\tspectra\n15.995\t300\n', deltaCounts: 'key\tvalue\nms2_placed\t900\nms2_tagged\t1000\n' }))
    expect(o.figures.find((x) => x.id === 'topshift')!.value).toBe('+15.995 Da')
    expect(o.checks.some((c) => /spectra are placed/.test(c.text))).toBe(false)
  })
})

describe('round 8, 5, 6, 19, 20: the alkylation extension follows proteome and tag length', () => {
  const alk = PRODUCT_OF.get('alkylation_out')!
  it('a FASTA proteome is not raised (round 9, 5): its index length grows with its size, the note says the human-sized need', () => {
    expect(alkylationTarget({ alkylation_proteome: '/x/human.fasta' })).toBe(8)
    expect(alkylationExtension({ alkylation_proteome: '/x/human.fasta', tag_length: '3', extension: '0' })).toBeNull()
  })
  it('recomputed while the report is on: yeast lowers the raise, a shorter seed raises it, off puts it back', () => {
    const on = toggleProduct(alk, true, { tag_length: '3', extension: '0' }, '/d/a.tags.tsv', null)
    expect(on.raised).toEqual({ from: '0', to: '3' })
    const yeast = alkylationRaise({ ...on.values, alkylation_proteome: 'yeast' }, on.raised)
    expect(yeast.values['extension']).toBe('2')
    expect(yeast.raised).toEqual({ from: '0', to: '2' })
    const human = alkylationRaise({ ...yeast.values, alkylation_proteome: 'human' }, yeast.raised)
    expect(human.values['extension']).toBe('3')
    // Yeast with Extension 2 ticked by hand (no raise), then mouse: raised.
    const mouse = alkylationRaise({ alkylation_out: '/d/a.alk.tsv', tag_length: '3', extension: '2', alkylation_proteome: 'mouse' }, null)
    expect(mouse).toMatchObject({ values: { extension: '3' }, raised: { from: '2', to: '3' } })
    // Seed 2: (8 - 2) / 2 = 3, from an Extension of 2.
    expect(alkylationRaise({ alkylation_out: 'x', tag_length: '2', extension: '2' }, null).values['extension']).toBe('3')
    // Off: the raise in force goes back.
    const off = toggleProduct(alk, false, human.values, '/d/a.tags.tsv', human.raised)
    expect(off.values['extension']).toBe('0')
  })
  it('the Overview tile and the tags_too_short re-run use the proteome\'s extension', () => {
    const o = buildOverview(base({ params: { extension: '0', alkylation_proteome: 'yeast' } }))
    const t = o.calls.find((x) => x.id === 'alkylation')!
    expect(t.note).toMatch(/raises the extension from 0 to 2, so tags reach the 7 residues/)
    expect(t.action).toMatchObject({ values: { alkylation_out: 'alkylation.tsv', extension: '2' } })
  })
  it('the help states the rule for both proteome sizes', () => {
    const text = PARAM_UI['alkylation_proteome'].help!.text
    expect(text).toMatch(/tag length \+ 2 × Extension/)
    expect(text).toMatch(/Extension 3 for human or mouse, 2 for yeast or E\. coli/)
  })
})

const daSpecies: SpeciesReport = {
  path: '/d/a.species.tsv',
  taxa: [
    { rank: 'genus', taxid: 10028, name: 'Cricetulus', observed: 10, adjusted: 10, q: 0.01 },
    { rank: 'genus', taxid: 9605, name: 'Homo', observed: 3, adjusted: 3, q: 0.4 }
  ]
} as SpeciesReport

describe('round 8, 9 and 10: species under a Da tolerance', () => {
  const params = { species: true, fragment_tolerance: '0.3', fragment_tolerance_unit: 'Da' }
  it('no database is suggested; the genus value is muted', () => {
    const o = buildOverview(base({ params, species: daSpecies }))
    const db = o.suggestions.find((s) => s.setting === 'database')!
    expect(db).toMatchObject({ value: 'not suggested', evidence: 'default' })
    expect(o.copyText).not.toMatch(/Cricetulus proteome/)
    expect(o.calls.find((t) => t.id === 'genus')!.muted).toMatch(/^Unreliable/)
  })
  it('at ppm the suggestion stands and the value is not muted', () => {
    const o = buildOverview(base({ params: { species: true, fragment_tolerance: '20', fragment_tolerance_unit: 'ppm' }, species: daSpecies }))
    expect(o.suggestions.find((s) => s.setting === 'database')!.value).toBe('Cricetulus proteome')
    expect(o.calls.find((t) => t.id === 'genus')!.muted).toBeUndefined()
  })
  it('the Species Overview keeps the evidence cutoff line with the genus tile in the lead', () => {
    const o = buildOverview(base({ params, species: daSpecies }))
    render(<OverviewPanel overview={o} input="/d/a.mzML" busy={false} onAction={vi.fn()} params={params} workflowId="species" />)
    expect(screen.getByText(/^Evidence cutoff not applied/)).toBeDefined()
    const value = screen.getByText('Cricetulus', { selector: '.tile-value' })
    expect(value.classList.contains('muted')).toBe(true)
  })
})

describe('round 8, 22: Characterize leads with its calls', () => {
  it('protease, label, genus, glyco, alkylation first', () => {
    const params = { digest_out: 'd', label_out: 'l', species: true, glyco: true, alkylation_out: 'a' }
    const o = buildOverview(base({ params }))
    const t = leadTiles(shownTiles(o, params), 'characterize')
    expect(t.figures.slice(0, 5).map((x) => x.id)).toEqual(['protease', 'label', 'genus', 'glyco', 'alkylation'])
    expect(t.calls).toEqual([])
  })
})

describe('round 8, 11: residue confidence beside the tag', () => {
  it('after Tag and Length, ahead of the flank masses', () => {
    const cols = ['spectrum', 'tag', 'length', 'charge', 'nterm_mass', 'cterm_mass', 'extended', 'gapped', 'evalue', 'res_conf']
    expect(displayOrder(cols).map((j) => cols[j])).toEqual(['spectrum', 'tag', 'length', 'res_conf', 'charge', 'nterm_mass', 'cterm_mass', 'extended', 'gapped', 'evalue'])
    expect(displayOrder(['spectrum', 'tag', 'evalue'])).toEqual([0, 1, 2])
  })
})

describe('round 8, 12: the charge note reads as a sentence', () => {
  it('no "on is on"', () => {
    const d = PARAM_UI['charge_min'].depends!.find((x) => x.say)!
    expect(d.say).toBe('Precursors without a charge set to try other charges, or the Charge check on')
  })
})

describe('round 8, 13: a value the workflow set reads "set by", not "changed"', () => {
  it('ParamField', () => {
    const spec = PARAM_BY_NAME.get('extension')!
    const { rerender } = render(<ParamField spec={spec} value="2" onChange={vi.fn()} setBy="Characterize a run" />)
    expect(document.getElementById('h-extension-c')!.textContent).toMatch(/Default 0 · set by Characterize a run/)
    rerender(<ParamField spec={spec} value="4" onChange={vi.fn()} />)
    expect(document.getElementById('h-extension-c')!.textContent).toMatch(/Default 0 · changed/)
  })
})

describe('round 8, 17 and 18: the cz re-run only for an all-electron run', () => {
  const NOCOL = 'Ion series: 40 electron-activated MS2 spectra were tagged as b/y ions: -ion_series auto reads the activation of mzML input only and writes no ion_series column here; use -ion_series cz to read them as c/z-dot ions.'
  it('a mixed run gets the advice without a re-run', () => {
    const mixed = postRunChecks({ reports: [], notes: [NOCOL], ionSeries: 'auto', input: '/d/a.mgf', ms2: 400 }).checks.find((x) => x.id === 'auto-no-column')!
    expect(mixed.fix).toBeUndefined()
    const unknown = postRunChecks({ reports: [], notes: [NOCOL], ionSeries: 'auto', input: '/d/a.mgf' }).checks.find((x) => x.id === 'auto-no-column')!
    expect(unknown.fix).toBeUndefined()
  })
  it('the hybrid line no longer reads "only under auto"', () => {
    const line = 'Hybrid activation: 12 of 400 MS2 spectra were activated by a hybrid method'
    const c = postRunChecks({ reports: [], notes: [line], ionSeries: 'auto', input: '/d/a.mzML' }).checks.find((x) => x.id === 'hybrid-auto')
    expect(c!.detail).toMatch(/tagged as b\/y ions only: under Ion series auto their c\/z ions were not read/)
  })
})

describe('round 8, 8: a re-run fix only for the run the form would send', () => {
  it('sameCall ignores overwrite and the workflow name, nothing else', () => {
    const a = { in: '/d/a.mzML', out: '/d/a.tags.tsv', params: { extension: '2' }, overwrite: true, workflow: 'characterize' }
    expect(sameCall(a, { in: '/d/a.mzML', out: '/d/a.tags.tsv', params: { extension: '2' } })).toBe(true)
    expect(sameCall(a, { in: '/d/a.mzML', out: '/d/a.tags.tsv', params: { extension: '3' } })).toBe(false)
    expect(sameCall(undefined, { in: '/d/a.mzML', out: '/d/a.tags.tsv', params: {} })).toBe(false)
  })
})

describe('round 8, 3: Characterize leads with the species groups', () => {
  it('its lead groups exist and have another home', () => {
    const t = TASKS.find((x) => x.id === 'characterize')!
    expect(t.leadGroups).toEqual(['Species', 'Species, advanced', 'Taxonomy'])
    for (const g of t.leadGroups!) expect(SECTIONS.find((s) => s.title === g)?.home).toBe('species')
  })
})
