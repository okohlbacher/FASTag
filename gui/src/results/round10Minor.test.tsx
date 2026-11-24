// Review round 10 minors (doc/GUI-REVIEW-2026-11-20.md section 4).

import { render, screen, within } from '@testing-library/react'
import { installMockBridge } from '../testing/mockBridge'
import { click, openGroup, pickSingle, renderApp, renderCharacterizeApp, runButton, showStep } from '../testing/render'
import { act, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import SpeciesPanel from '../SpeciesPanel'
import { TASKS } from '../setup/tasks'
import { PRODUCTS } from '../setup/products'
import { PARAM_UI } from '../paramUi'
import { buildOverview } from './overview'
import OverviewPanel from './OverviewPanel'

describe('round 10 minor: Species tab, empty report', () => {
  it('says the caveat of a tolerance in Da on an empty report too', () => {
    const { container } = render(
      <SpeciesPanel report={{ path: '/d/a.tags.species.tsv', taxa: [] }} enabled tooShort={null} contributed={null} totalMs2={null} daTolerance={0.5} />
    )
    expect(container.querySelector('.banner.warn')!.textContent).toMatch(/fragment tolerance is 0\.5 Da/)
    expect(container.textContent).toMatch(/No taxon in the report/)
  })
  it('no banner at ppm', () => {
    const { container } = render(
      <SpeciesPanel report={{ path: '/d/a.tags.species.tsv', taxa: [] }} enabled tooShort={null} contributed={null} totalMs2={null} daTolerance={null} />
    )
    expect(container.querySelector('.banner.warn')).toBeNull()
  })
})

describe('round 10 minor: the identifiability score is experimental', () => {
  it('says so in the task, the product, the option help and the Overview tile', () => {
    expect(TASKS.find((t) => t.id === 'triage')!.blurb).toMatch(/experimental/)
    expect(PRODUCTS.find((p) => p.param === 'census_sorted_out')!.what).toMatch(/experimental/)
    expect(PARAM_UI.census_score.help!.text).toMatch(/Experimental/)
    const ids = 'ident_rank\tident_score\tidentified\n1\t0.9\t1\n2\t0.5\t0\n'
    const o = buildOverview({ log: ['2 MS2 spectra, 5 tags'], reports: [], species: null, census: null, params: { census: true }, instrument: null, triage: ids })
    expect(o.figures.find((f) => f.id === 'ident-score')!.note).toMatch(/experimental ranking/)
  })
})

describe('round 10 minor: the alkylation note says where Extension is', () => {
  it('in Generate tags: Settings, and no species/digest clause when neither report is on', async () => {
    const mock = installMockBridge()
    await renderApp(mock)
    if (!document.getElementById('out-alkylation_out')) {
      showStep(3)
      await click(screen.getByRole('button', { name: /^Advanced/ }))
      await openGroup('Other analyses')
      await openGroup('Alkylation')
    }
    const note = document.getElementById('out-alkylation_out-d')!
    // feedback 202dbcf4: no database, so no raise; the note links Extension.
    expect(note.textContent).toBe('No database needed: the call is read off the tags; a longer Extension (Settings) gives more votes.')
  })
})

describe('round 10 minor: alkylation_proteome help names the field plainly', () => {
  it('no comma-laden path; says where the group is outside Mass-shift survey', () => {
    const t = PARAM_UI.alkylation_proteome.help!.text
    expect(t).not.toMatch(/Advanced › Placement, advanced,/)
    expect(t).toMatch(/group “Placement, advanced”, which is under Other analyses in every workflow but Mass-shift survey/)
  })
})

describe('round 10 minor: the Outputs card layout of the alkylation row', () => {
  it('the (?) follows the label and the note takes a full line', async () => {
    const mock = installMockBridge()
    await renderCharacterizeApp(mock)
    const row = document.getElementById('out-alkylation_out')!.closest('li')!
    expect(row.classList.contains('wide')).toBe(true)
    const kids = [...row.children]
    const label = kids.findIndex((e) => e.tagName === 'LABEL')
    const help = kids.findIndex((e) => e.classList.contains('help-pop-wrap'))
    const note = kids.findIndex((e) => e.classList.contains('product-note'))
    expect(help).toBe(label + 1)
    expect(note).toBeGreaterThan(help)
  })
})

describe('round 10 minor: Overview headings', () => {
  it('a workflow with a main result heads it and the run facts', () => {
    const ids = 'ident_rank\tident_score\tidentified\n1\t0.9\t1\n2\t0.5\t0\n'
    const params = { census: true, census_sorted_out: 'c.tsv', census_ids: '/d/a.idXML' }
    const o = buildOverview({ log: ['2 MS2 spectra, 5 tags'], reports: [], species: null, census: null, params, instrument: null, triage: ids })
    const { container } = render(<OverviewPanel overview={o} input="/d/a.mzML" busy={false} onAction={() => {}} params={params} workflowId="triage" />)
    const heads = [...container.querySelectorAll('.tiles-head')]
    expect(heads.map((h) => h.textContent)).toEqual(['Main result', 'Run'])
    expect(heads[0].nextElementSibling!.getAttribute('aria-label')).toBe('Main result')
    expect(heads[1].nextElementSibling!.getAttribute('aria-label')).toBe('Key figures')
  })
  it('no headings without a main result', () => {
    const o = buildOverview({ log: ['2 MS2 spectra, 5 tags'], reports: [], species: null, census: null, params: {}, instrument: null })
    const { container } = render(<OverviewPanel overview={o} input="/d/a.mzML" busy={false} onAction={() => {}} />)
    expect(container.querySelector('.tiles-head')).toBeNull()
  })
})

describe('round 10 minor: Advanced density', () => {
  it('a group waiting for a report is one line with its Turn on, and opens once it is on', async () => {
    const mock = installMockBridge()
    await renderApp(mock) // FASTag defaults: species off
    await openGroup('Species')
    const line = document.querySelector('[data-group="Species, advanced"]') as HTMLElement
    expect(line.tagName).toBe('DIV')
    expect(line.classList.contains('waiting-line')).toBe(true)
    expect(line.querySelector('summary')).toBeNull()
    await click(within(line).getByRole('button', { name: 'Turn on Species report' }))
    const group = document.querySelector('[data-group="Species, advanced"]') as HTMLElement
    expect(group.tagName).toBe('DETAILS')
    expect(document.getElementById('p-species_min_len')).not.toBeNull()
  })
})

describe('round 10 minor: the last-used values keep their workflow', () => {
  it('a run saves the workflow it ran in with its values', async () => {
    const mock = installMockBridge()
    await renderCharacterizeApp(mock)
    await pickSingle(mock, '/d/a.mzML')
    await click(runButton())
    await act(async () => mock.emitDone({ ok: true, code: 0, runId: mock.lastRunId }))
    await waitFor(() => expect(mock.savedLast.length).toBeGreaterThan(0))
    expect(mock.savedLast[0]['workflow']).toBe('characterize')
  })
})
