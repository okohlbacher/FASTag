// Review round 11 (doc/GUI-REVIEW-2026-11-20.md): simplicity and
// intuitiveness per workflow.

import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { installMockBridge } from '../testing/mockBridge'
import { click, renderColdApp } from '../testing/render'
import { describe, expect, it } from 'vitest'
import DigestPanel from '../DigestPanel'
import { parseReport } from '../digestReport'
import silacLabel from '../fixtures/cli/v112-pxd014764-recon-ext3/run.label.tsv?raw'

describe('round 11: the Labels panel leads with the CLI label call', () => {
  it('a SILAC call is named, not "No label tag ends"', () => {
    const label = parseReport(silacLabel, '/d/run.label.tsv')
    render(<DigestPanel reports={[label]} errors={[]} onOpen={() => {}} />)
    expect(screen.getByText(/^Label call: SILAC$/)).toBeTruthy()
    expect(screen.queryByText('No label tag ends')).toBeNull()
  })
})

describe('round 11: Database reduction shows the protease and, with Comet, its template', () => {
  it('Protease in Settings; the Comet template only with Comet, and the fragment said', async () => {
    const mock = installMockBridge()
    await renderColdApp(mock)
    await click(screen.getByRole('radio', { name: /^Database reduction/ }))
    const settings = screen.getByRole('region', { name: '3 Settings' })
    expect(within(settings).queryByLabelText(/^Protease/)).not.toBeNull()
    expect(document.getElementById('p-search_config_template')).toBeNull()
    await act(async () => void fireEvent.change(document.getElementById('p-search_engine')!, { target: { value: 'comet' } }))
    expect(within(settings).getByText(/^Your comet\.params/)).toBeTruthy()
    expect(document.getElementById('p-search_config_template')).not.toBeNull()
    expect(document.getElementById('out-search_config_out-d')!.textContent).toMatch(/a Comet fragment: merge it into your comet\.params/)
  })
})
