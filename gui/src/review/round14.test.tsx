// Review round 14 (doc/GUI-REVIEW-2026-11-20.md).

import { render, waitFor } from '@testing-library/react'
import ReportTable from '../results/ReportTable'
import { describe, expect, it, vi } from 'vitest'
import ReconView from '../results/ReconView'
import { installMockBridge } from '../testing/mockBridge'
import { addBatch, click, flush, renderColdApp, showView, chooseTask } from '../testing/render'
import { screen } from '@testing-library/react'
import type { RunRecord } from '../types'
import ecoliMassgap from '../fixtures/cli/v1111-ecoli-recon-loc/run.massgap.tsv?raw'

const rec = (id: string, outputs: string[]): RunRecord => ({
  id, input: '/e/run.mzML', outputs, cwd: '/e', argv: ['FASTag'], status: 'ok', exitCode: 0, message: null,
  start: 0, end: 1, cleanup: { removed: [], renamed: [], failed: [] }, params: {}, workflow: 'mass-shift'
})

describe('round 14: a mass-gap report another run left is not borrowed', () => {
  it('the window stays assumed when the sibling is of another run', async () => {
    const mock = installMockBridge()
    mock.reportFiles = { '/e/run.delta.tsv': 'delta\tspectra\ttop_interps\n15.8000\t30\t?:30\n', '/e/run.massgap.tsv': ecoliMassgap }
    mock.history = [rec('B', ['/e/run.delta.tsv']), rec('A', ['/e/run.massgap.tsv'])]
    render(<ReconView massgap={null} tables={{ delta: '/e/run.delta.tsv' }} onOpen={vi.fn()} />)
    await flush()
    await flush()
    expect(mock.reportCalls).not.toContain('/e/run.massgap.tsv')
    expect(document.querySelector('figcaption')?.textContent).toMatch(/window assumed 0\.5 Da/)
  })
  it('one run wrote both: its window is used', async () => {
    const mock = installMockBridge()
    mock.reportFiles = { '/e/run.delta.tsv': 'delta\tspectra\ttop_interps\n15.8000\t30\t?:30\n', '/e/run.massgap.tsv': ecoliMassgap }
    mock.history = [rec('A', ['/e/run.delta.tsv', '/e/run.massgap.tsv'])]
    render(<ReconView massgap={null} tables={{ delta: '/e/run.delta.tsv' }} onOpen={vi.fn()} />)
    await flush()
    await flush()
    expect(document.querySelector('figcaption')?.textContent).not.toMatch(/assumed/)
  })
})

describe('round 14: batch Outputs name each output as the job writes it', () => {
  it('CLI-derived names keep .tags; database reduction keeps .fasta and .json', async () => {
    const mock = installMockBridge()
    await renderColdApp(mock)
    await chooseTask('Characterize a run')
    await addBatch(mock, ['/d/a.mzML', '/d/b.mzML'])
    const names = (): string[] => [...document.querySelectorAll('[data-step="4"] .product-file')].map((e) => e.textContent ?? '')
    expect(names()).toEqual(expect.arrayContaining(['→ <input>.tags.tsv', '→ <input>.tags.glyco.tsv', '→ <input>.tags.species.tsv', '→ <input>.digest.tsv']))
    showView('setup')
    await chooseTask('Database reduction')
    expect(names()).toEqual(expect.arrayContaining(['→ <input>.reduced.fasta', '→ <input>.search.json']))
  })
})

describe('round 14: an export keeps the order the table shows', () => {
  it('sorted by Best E-value, the file has that order', async () => {
    const mock = installMockBridge()
    mock.reportFiles['/d/a.census_sorted.tsv'] = 'ident_rank\tspectrum\tbest_evalue\tident_score\n1\ts1\t5\t0.9\n2\ts2\t0.1\t0.5\n3\ts3\t1\t0.1\n'
    render(<ReportTable kind="triage" path="/d/a.census_sorted.tsv" />)
    await waitFor(() => expect(document.querySelector('.report-sum')).not.toBeNull())
    await click(screen.getByRole('button', { name: /^Best E-value/ }))
    mock.nextPickOutput = '/d/out.tsv'
    await click(screen.getByRole('button', { name: 'Export shown rows…' }))
    expect(mock.summaryWrites[0].text.split('\n').slice(1, 4).map((l) => l.split('\t')[1])).toEqual(['s2', 's3', 's1'])
  })
})
