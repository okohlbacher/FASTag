// Review round 15 (doc/GUI-REVIEW-2026-11-20.md): minors only.

import { act, fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { topShift } from '../results/overview'
import { installMockBridge } from '../testing/mockBridge'
import { click, openGroup, renderColdApp } from '../testing/render'

describe('round 15', () => {
  it('an unexplained shift ("?") is named by its mass alone', () => {
    expect(topShift('delta\tspectra\ttop_interps\n15.8000\t30\t?:30\n')?.name).toBeNull()
  })
  it('a Filter database stands in for the Protein database: no required badge', async () => {
    const mock = installMockBridge()
    await renderColdApp(mock)
    await click(screen.getByRole('radio', { name: /^Mass-shift survey/ }))
    const badge = (): Element | null => document.getElementById('p-recon_fasta')!.closest('.field')!.querySelector('.badge')
    expect(badge()?.textContent).toBe('required')
    await click(screen.getByRole('button', { name: /^Advanced/ }))
    await openGroup('Keep only tags found in a database')
    await act(async () => void fireEvent.change(document.getElementById('p-fasta')!, { target: { value: '/d/h.fasta' } }))
    expect(badge()).toBeNull()
    expect(document.getElementById('h-recon_fasta')!.textContent).toMatch(/^Uses the Filter database/)
  })
})
