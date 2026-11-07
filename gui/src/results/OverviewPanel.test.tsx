// The Overview tab as a component (GUI-DESIGN 3 S3), over the model of real
// gate-PXD CLI output (overview.ts).

import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { parseReport } from '../digestReport'
import { CLI_CASES, logLines, type CliCase } from '../testing/cliFixtures'
import { speciesFromTsv } from '../testing/speciesTsv'
import { click } from '../testing/render'
import { buildOverview } from './overview'
import OverviewPanel from './OverviewPanel'

const model = (c: CliCase) =>
  buildOverview({
    log: logLines(c),
    reports: [parseReport(c.digest, '/d/r.digest.tsv'), parseReport(c.label, '/d/r.label.tsv')],
    species: speciesFromTsv(c.species, '/d/r.species.tsv'),
    census: null,
    params: c.params,
    instrument: null
  })

const tile = (name: string): HTMLElement => screen.getByRole('region', { name })

describe('Overview panel', () => {
  it('shows each tile with its value and its cutoff or caveat', () => {
    render(<OverviewPanel overview={model(CLI_CASES.v112)} input="/d/run01.mzML" busy={false} onAction={vi.fn()} />)
    expect(screen.getByRole('heading', { name: /Overview of run01\.mzML/ })).toBeDefined()
    expect(within(tile('Protease')).getByText('Trypsin')).toBeDefined()
    expect(within(tile('Top genus')).getByText('Homo')).toBeDefined()
    expect(within(tile('Label')).getByText('none (label-free)')).toBeDefined()
    expect(within(tile('Alkylation')).getByText('not assessed (needs a FASTA)')).toBeDefined()
    for (const t of screen.getAllByRole('region').filter((r) => r.classList.contains('tile')))
      expect(t.querySelector('.tile-note')?.textContent?.trim(), t.getAttribute('aria-label') ?? '').not.toBe('')
  })

  it('lists the suggested settings with their evidence, the C+57.021 line a default', () => {
    render(<OverviewPanel overview={model(CLI_CASES.v112)} input="/d/run01.mzML" busy={false} onAction={vi.fn()} />)
    const table = screen.getByRole('table', { name: 'Suggested search settings' })
    const row = within(table).getByRole('row', { name: /fixed C\+57\.021/ })
    expect(within(row).getByText('default')).toBeDefined()
    expect(row.textContent).toMatch(/alkylation not assessed \(no FASTA\)/)
    expect(within(within(table).getByRole('row', { name: /^enzyme/ })).getByText('call')).toBeDefined()
  })

  it('a tile action asks to turn the option on and run again; locked while busy', async () => {
    const onAction = vi.fn()
    const { rerender } = render(<OverviewPanel overview={model(CLI_CASES.v112)} input="/d/a.mzML" busy={false} onAction={onAction} />)
    await click(within(tile('Alkylation')).getByRole('button', { name: 'Add FASTA and run again' }))
    expect(onAction).toHaveBeenCalledWith({ kind: 'add-fasta', label: 'Add FASTA and run again' })
    rerender(<OverviewPanel overview={model(CLI_CASES.v112)} input="/d/a.mzML" busy onAction={onAction} />)
    expect(within(tile('Alkylation')).getByRole('button', { name: 'Add FASTA and run again' }).hasAttribute('disabled')).toBe(true)
  })

  it('copies the suggested settings as text', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(<OverviewPanel overview={model(CLI_CASES.v112)} input="/d/a.mzML" busy={false} onAction={vi.fn()} />)
    await click(screen.getByRole('button', { name: 'Copy suggested settings' }))
    expect(writeText).toHaveBeenCalledWith(model(CLI_CASES.v112).copyText)
    expect(await screen.findByText('Copied.')).toBeDefined()
  })

  it('flags the checks: a Da run and electron activation', () => {
    render(<OverviewPanel overview={model(CLI_CASES.v112Da)} input="/d/a.mzML" busy={false} onAction={vi.fn()} />)
    const checks = within(screen.getByRole('list', { name: 'Checks' })).getAllByRole('listitem')
    expect(checks.filter((c) => c.classList.contains('flag'))).toHaveLength(2)
    expect(within(tile('Protease')).getByText('too little evidence')).toBeDefined()
  })
})
