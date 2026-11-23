// Review round 15 (doc/GUI-REVIEW-2026-11-20.md): minors only.

import { act, fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { topShift } from '../results/overview'
import { installMockBridge } from '../testing/mockBridge'
import { click, openGroup, renderColdApp, chooseTask, showStep } from '../testing/render'

describe('round 15', () => {
  it('an unexplained shift ("?") is named by its mass alone', () => {
    expect(topShift('delta\tspectra\ttop_interps\n15.8000\t30\t?:30\n')?.name).toBeNull()
  })
  it('a Filter database stands in for the Protein database: said, never "not set"', async () => {
    const mock = installMockBridge()
    // The last run's Filter database comes back with Continue last run.
    mock.settings = { schemaVersion: 1, lastUsed: { fasta: '/d/h.fasta' }, presets: {} }
    await renderColdApp(mock)
    await chooseTask('Mass-shift survey')
    const badge = (): Element | null => document.getElementById('p-recon_fasta')?.closest('.field')?.querySelector('.badge') ?? null
    expect(badge()?.textContent).toBe('required')
    showStep(1)
    await click(screen.getByRole('button', { name: 'Continue last run (1)' }))
    showStep(2)
    expect(document.getElementById('p-recon_fasta')).toBeNull()
    const standin = document.querySelector('.field.standin')!
    expect(standin.textContent).toMatch(/Protein database.*Using your Filter database: h\.fasta/)
    expect(within(standin as HTMLElement).getByRole('button', { name: 'Choose another' })).toBeDefined()
    expect(document.querySelector('.still-missing')!.textContent).toBe('Still missing: spectra')
  })
})
