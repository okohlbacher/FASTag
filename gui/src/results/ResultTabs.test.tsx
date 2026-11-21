// The result tabs as a component (P1 PR c). "moves between the tabs with
// the arrow keys" moved here from App.test.tsx ("digest tab").

import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState, type JSX } from 'react'
import { describe, expect, it, vi } from 'vitest'
import ResultTabs, { type ResultTabsProps } from './ResultTabs'
import type { Tab } from '../app/viewStore'
import { installMockBridge } from '../testing/mockBridge'
import { click } from '../testing/render'

function Harness(p: Partial<ResultTabsProps>): JSX.Element {
  const [tab, setTab] = useState<Tab>(p.tab ?? 'results')
  const props: ResultTabsProps = {
    species: null,
    speciesRun: null,
    speciesOn: false,
    tooShort: null,
    evidence: { contributed: null, ms2: null },
    reports: { list: [], errors: [] },
    batchMiss: null,
    results: null,
    setResults: vi.fn(),
    running: false,
    busy: false,
    failure: null,
    setFailure: vi.fn(),
    copied: null,
    setCopied: vi.fn(),
    openResults: vi.fn(),
    openReport: vi.fn(),
    openLog: vi.fn(),
    ...p,
    tab,
    setTab
  }
  return <ResultTabs {...props} />
}

const SPECIES = { path: '/d/a.species.tsv', taxa: [{ rank: 'genus', taxid: 561, name: 'Escherichia', observed: 7, adjusted: 7, q: 1e-13 }] }
// A report that could not be read: the Digest tab shows it.
const REPORTS = { list: [], errors: ['Cannot read /d/a.digest.tsv'] }
// A tags table shown: the Tags tab is there only with one.
const TAGS = { path: '/d/a.tags.tsv', gen: 1 }

const selected = (): string | undefined =>
  screen.getAllByRole('tab').find((t) => t.getAttribute('aria-selected') === 'true')?.textContent ?? undefined

describe('result tabs', () => {
  it('moves between the tabs with the arrow keys', async () => {
    installMockBridge()
    render(<Harness species={SPECIES} results={TAGS} />)
    const tags = screen.getByRole('tab', { name: 'Tags' })
    await act(async () => {
      fireEvent.keyDown(tags, { key: 'ArrowRight' })
    })
    expect(screen.getByRole('tab', { name: /^Species/ }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe('tab-species')
  })

  it('wraps with the arrows; Home and End go to the first and last tab, and focus follows', async () => {
    installMockBridge()
    render(<Harness species={SPECIES} reports={REPORTS} results={TAGS} />)
    const list = screen.getByRole('tablist')
    await act(async () => void fireEvent.keyDown(list, { key: 'ArrowLeft' }))
    expect(selected()).toBe('Digest')
    expect(document.activeElement?.id).toBe('tab-digest')
    await act(async () => void fireEvent.keyDown(list, { key: 'Home' }))
    expect(selected()).toBe('Tags')
    await act(async () => void fireEvent.keyDown(list, { key: 'End' }))
    expect(selected()).toBe('Digest')
    await act(async () => void fireEvent.keyDown(list, { key: 'x' }))
    expect(selected()).toBe('Digest')
  })

  it('shows only the tabs whose report exists, in the order of the workflows', () => {
    installMockBridge()
    const { rerender } = render(<Harness />)
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Tags'])
    const all = { ...REPORTS, workflow: { qc: '/d/a.qc.tsv', shortlist: '/d/a.shortlist.tsv', triage: '/d/a.census_sorted.tsv' } }
    rerender(<Harness species={SPECIES} reports={all} results={TAGS} />)
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Tags', 'QC', 'Species1', 'Shortlist', 'Triage', 'Digest'])
    // Reports without a tags table: no Tags tab.
    rerender(<Harness species={SPECIES} reports={all} />)
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['QC', 'Species1', 'Shortlist', 'Triage', 'Digest'])
    // A workflow's own tabs first, in its order (doc/GUI-WORKFLOWS.md 1):
    // the reports, then Tags.
    rerender(<Harness species={SPECIES} reports={all} results={TAGS} workflow="characterize" />)
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Digest', 'Species1', 'Tags', 'QC', 'Shortlist', 'Triage'])
    rerender(<Harness species={SPECIES} reports={all} results={TAGS} workflow="db-reduction" />)
    expect(screen.getAllByRole('tab').map((t) => t.textContent).slice(0, 2)).toEqual(['Shortlist', 'Tags'])
    rerender(<Harness species={SPECIES} reports={all} results={TAGS} workflow="triage" />)
    expect(screen.getAllByRole('tab').map((t) => t.textContent).slice(0, 2)).toEqual(['Triage', 'Tags'])
    rerender(<Harness species={SPECIES} reports={all} results={TAGS} workflow="run-qc" />)
    expect(screen.getAllByRole('tab').map((t) => t.textContent).slice(0, 2)).toEqual(['QC', 'Tags'])
  })

  it('a species report not read gets no tab, and a census summary alone opens Triage', () => {
    installMockBridge()
    const { rerender } = render(<Harness speciesRun={{ input: '/d/a.mzML', enabled: true }} results={TAGS} />)
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Tags'])
    rerender(<Harness tab="triage" reports={{ list: [], errors: [], workflow: { censusSummary: '/d/a.census_summary.tsv' } }} />)
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Triage'])
    expect(screen.getByRole('tabpanel').textContent).toContain('a.census_summary.tsv')
  })

  it('the empty pane offers both opens, locked while busy', async () => {
    installMockBridge()
    const openResults = vi.fn()
    const { rerender } = render(<Harness openResults={openResults} />)
    await click(screen.getByRole('button', { name: 'Open a tags TSV…' }))
    expect(openResults).toHaveBeenCalledTimes(1)
    rerender(<Harness openResults={openResults} busy />)
    expect(screen.getByRole('button', { name: 'Open a tags TSV…' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Open report…' }).hasAttribute('disabled')).toBe(true)
  })

  it('a failure banner opens the log of its batch job and dismisses itself', async () => {
    installMockBridge()
    const openLog = vi.fn()
    const setFailure = vi.fn()
    render(
      <Harness
        openLog={openLog}
        setFailure={setFailure}
        failure={{ title: '1 of 2 batch jobs failed', reasons: [{ what: 'b.mzML (exit code 1)', text: 'Error: x', input: '/d/b.mzML' }], logOf: '/d/b.mzML' }}
      />
    )
    expect(screen.getByRole('alert').textContent).toMatch(/^1 of 2 batch jobs failed/)
    await click(screen.getByRole('button', { name: 'Show full log' }))
    expect(openLog).toHaveBeenCalledWith('/d/b.mzML')
    await click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(setFailure).toHaveBeenCalledWith(null)
  })

  it('counts the species on its tab; no Digest tab without a report', () => {
    installMockBridge()
    render(<Harness species={SPECIES} />)
    expect(screen.getByRole('tab', { name: /Species/ }).textContent).toBe('Species1')
    expect(screen.queryByRole('tab', { name: /Digest/ })).toBeNull()
  })
})
