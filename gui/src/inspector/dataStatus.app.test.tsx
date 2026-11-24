// The check before a run for FASTag's shipped data, in the app: an engine
// without its digest data and proteomes (a build tree or a bare copy under
// FASTAG_BIN) blocks Characterize a run before Run, with the reason and the
// fix, instead of failing with exit 6 a moment after it (report
// 20261124T094950Z_54456a88).

import { act, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { installMockBridge } from '../testing/mockBridge'
import { click, flush, pickSingle, renderCharacterizeApp, runButton } from '../testing/render'

const IN = '/data/run01.mzML'
const runDisabled = (): boolean => (runButton() as HTMLButtonElement).disabled
const checkItem = (title: RegExp): HTMLElement => {
  const all = [...document.querySelectorAll<HTMLElement>('li.check')]
  const hit = all.find((li) => title.test(li.querySelector('strong')?.textContent ?? ''))
  if (!hit) throw new Error(`no check ${title}: ${all.map((l) => l.querySelector('strong')?.textContent).join(' | ')}`)
  return hit
}

describe('shipped data before a run', () => {
  it('Characterize with a bare engine: blocked with the folders searched, and the fix runs without the digest report', async () => {
    const mock = installMockBridge()
    mock.dataStatusResult = {
      digestDir: null,
      files: { digestModels: false, digestModelsV2: false, massgapMods: false, calibration: false },
      alkylationDir: null,
      proteomes: [],
      searched: ['/b/share/FASTag/digest', '/b/bin/share-FASTag-digest', '/b/bin/digest'],
      fromEnv: false
    }
    await renderCharacterizeApp(mock)
    await pickSingle(mock, IN)
    await flush()
    expect(mock.dataStatusCalls).toBeGreaterThan(0)
    const digest = checkItem(/^Blocks the run: The digest report needs FASTag's shipped data \(digest_models\.tsv\)/)
    expect(digest.textContent).toContain('looked in /b/share/FASTag/digest, /b/bin/share-FASTag-digest, /b/bin/digest')
    expect(digest.textContent).toContain('FASTAG_DIGEST_DIR')
    // The alkylation report is off in Characterize: it needs nothing.
    expect(document.querySelector('li.check[data-check="no-shipped-data-alkylation_out"]')).toBeNull()
    expect(runDisabled()).toBe(true)
    // Installed meanwhile: the focus back re-checks.
    const missing = mock.dataStatusResult
    mock.dataStatusResult = {
      ...missing,
      digestDir: '/b/share/FASTag/digest',
      files: { digestModels: true, digestModelsV2: true, massgapMods: true, calibration: true },
      alkylationDir: '/b/share/FASTag/alkylation',
      proteomes: ['human']
    }
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })
    await flush()
    expect(document.querySelector('li.check[data-check^="no-shipped-data"]')).toBeNull()
    // Gone again: the fixes clear the reports, and the run goes without them.
    mock.dataStatusResult = missing
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })
    await flush()
    await click(within(checkItem(/digest report needs/)).getByRole('button', { name: 'Run without the digest report' }))
    await flush()
    expect(document.querySelector('li.check[data-check^="no-shipped-data"]')).toBeNull()
    expect(runDisabled()).toBe(false)
    await click(runButton())
    expect(mock.runCalls).toHaveLength(1)
    expect(mock.runCalls[0].params['digest_out'] ?? '').toBe('')
  })
})
