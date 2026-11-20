// Review round 13 (doc/GUI-REVIEW-2026-11-20.md).

import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { installMockBridge } from '../testing/mockBridge'
import { addBatch, click, pickSingle, renderColdApp } from '../testing/render'

describe('round 13: Batch names outputs per input and offers no single destination', () => {
  it('<input>.qc.tsv, no Change…; Sage note from the queued inputs', async () => {
    const mock = installMockBridge()
    await renderColdApp(mock)
    await pickSingle(mock, '/d/one.mzML')
    await click(screen.getByRole('radio', { name: /^Run QC/ }))
    await addBatch(mock, ['/d/a.mzML', '/d/b.mzML'])
    const outputs = document.getElementById('card-outputs')!
    expect([...outputs.querySelectorAll('.product-file')].map((e) => e.textContent)).toContain('→ <input>.qc.tsv')
    expect(outputs.querySelector('button[aria-label^="Change the file of"]')).toBeNull()
  })
  it('Database reduction batch of .raw files: the Sage note', async () => {
    const mock = installMockBridge()
    await renderColdApp(mock)
    await click(screen.getByRole('radio', { name: /^Database reduction/ }))
    await addBatch(mock, ['/d/a.raw', '/d/b.mzML'])
    expect(document.getElementById('out-search_config_out-d')!.textContent).toMatch(/Sage cannot read \.raw, mzPeak or \.d\.zip/)
  })
  it('the CLI-default note has two lines and is in the tooltip', async () => {
    const mock = installMockBridge()
    await renderColdApp(mock)
    const h = document.getElementById('h-extension')!
    expect(h.classList.contains('with-default')).toBe(true)
    expect(h.getAttribute('title')).toBe('3 lets a seed of 3 grow to 9. FASTag default 0.')
  })
})
