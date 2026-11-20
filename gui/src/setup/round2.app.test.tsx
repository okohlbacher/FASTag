// Setup after the second workflow review (doc/GUI-WORKFLOWS.md): Batch mode
// gates Run on its queue, a batch sends no identifications, product wiring
// (census, USI, the engine configuration) and the (?) popover's flag.
import { act, fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { installMockBridge } from '../testing/mockBridge'
import { click, flush, pickSingle, renderColdApp, runButton } from '../testing/render'
import { PRODUCT_OF, isOn, neededBy, renameSearchConfig, setProduct } from './products'
import { startValues } from './tasks'

const workflow = (name: string): HTMLInputElement => screen.getByRole('radio', { name: new RegExp(`^${name}`) }) as HTMLInputElement
const field = (n: string): HTMLInputElement | null => document.getElementById(`p-${n}`) as HTMLInputElement | null

describe('Batch mode', () => {
  it('never runs the hidden single file: Run waits for queued files, with the batch plan line and its output folder', async () => {
    const mock = installMockBridge()
    await renderColdApp(mock)
    await pickSingle(mock, '/d/run01.mzML')
    expect((runButton() as HTMLButtonElement).disabled).toBe(false)
    await click(screen.getByRole('radio', { name: 'Batch' }))
    expect((runButton() as HTMLButtonElement).disabled).toBe(true)
    const bar = document.querySelector('.view-setup .runbar')!
    expect(bar.textContent).toContain('no files yet')
    expect(bar.textContent).toContain('Add files or a folder to run.')
    expect(bar.textContent).not.toContain('Choose an input file to run.')
    // The output folder is in the Input card, under the file list.
    const input = screen.getByRole('region', { name: '1 Input' })
    expect(within(input).getByText('Output folder')).toBeDefined()
    expect(within(input).getByRole('button', { name: 'Change the output folder' })).toBeDefined()
    // Neither the Run shortcut nor the menu starts the single file.
    await act(async () => mock.emitMenu('run'))
    await flush()
    expect(mock.runCalls).toHaveLength(0)
  })

  it('disables the identifications field with the reason, and a batch sends none', async () => {
    const mock = installMockBridge()
    await renderColdApp(mock)
    await click(workflow('Identifiability triage'))
    expect(field('census_ids')!.disabled).toBe(false)
    await click(screen.getByRole('radio', { name: 'Batch' }))
    expect(field('census_ids')!.disabled).toBe(true)
    expect(document.getElementById('h-census_ids')!.textContent).toMatch(/Not in Batch mode/)
  })
})

describe('products', () => {
  it('the ranked spectra need the identifiability table: it is checked with them and locked', () => {
    const sorted = PRODUCT_OF.get('census_sorted_out')!
    const table = PRODUCT_OF.get('census_out')!
    const v = setProduct(sorted, true, startValues('defaults', '/d/a.tags.tsv'), '/d/a.tags.tsv')
    expect(v['census']).toBe(true)
    expect(v['census_score']).toBe(true)
    expect(isOn(table, v)).toBe(true)
    expect(neededBy(table, v)).toEqual(['Spectra ranked by identifiability'])
    // The triage workflow starts that way.
    const t = startValues('builtin:triage', '/d/a.tags.tsv')
    expect(neededBy(table, t)).toEqual(['Spectra ranked by identifiability'])
  })

  it('USI column writes the column at once, with the placeholder accession the CLI accepts', async () => {
    const mock = installMockBridge()
    await renderColdApp(mock)
    await pickSingle(mock, '/d/run01.mzML')
    const usi = document.getElementById('out-usi_collection') as HTMLInputElement
    await click(usi)
    expect(usi.checked).toBe(true)
    expect((screen.getByRole('textbox', { name: 'PRIDE accession for the USI column' }) as HTMLInputElement).value).toBe('USI000000')
    await click(runButton())
    expect(mock.runCalls[0].params?.['usi_collection']).toBe('USI000000')
  })

  it('names the engine configuration by its engine: .json for Sage, .params for Comet and MSFragger', () => {
    const v = startValues('builtin:db-reduction', '/d/a.tags.tsv')
    expect(v['search_config_out']).toBe('/d/a.search.json')
    expect(renameSearchConfig(v, 'comet')['search_config_out']).toBe('/d/a.search.params')
    expect(renameSearchConfig({ ...v, search_config_out: '/d/a.search.params' }, 'sage')['search_config_out']).toBe('/d/a.search.json')
    // A name of the user's own stays.
    expect(renameSearchConfig({ ...v, search_config_out: '/d/my.json' }, 'comet')['search_config_out']).toBe('/d/my.json')
  })
})

describe('the (?) popover', () => {
  it('shows the flag with one dash, as the CLI takes it', async () => {
    const mock = installMockBridge()
    await renderColdApp(mock)
    const q = document.querySelector('button[data-param-help="max_evalue"]')!
    await click(q)
    const pop = screen.getByRole('dialog', { name: /^About / })
    expect(pop.textContent).toContain('-max_evalue')
    expect(pop.textContent).not.toContain('--max_evalue')
    expect(pop.querySelector('code.cli')).toBeNull()
    fireEvent.keyDown(pop, { key: 'Escape' })
  })

  it('documents the Instrument: tolerance, unit and ion series', async () => {
    const mock = installMockBridge()
    await renderColdApp(mock)
    const settings = screen.getByRole('region', { name: '3 Settings' })
    await click(within(settings).getByRole('button', { name: 'About Instrument' }))
    const pop = screen.getByRole('dialog', { name: 'About Instrument' })
    for (const f of ['-fragment_tolerance', '-fragment_tolerance_unit', '-ion_series']) expect(pop.textContent).toContain(f)
  })
})
