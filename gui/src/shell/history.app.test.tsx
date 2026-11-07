// The History view (GUI-DESIGN 3 S9, 6.5; P2a PR h), App-level: one row per
// recorded run with Open, Copy command, Reveal, Settings into form (with
// Undo) and Delete record; a run that did not finish is marked incomplete
// and never opens as if complete (P0a). Copy command copies the argv the
// record keeps, which is the command the run reply offered (fastag.rs
// the_history_argv_is_the_command_line_the_run_was_started_with).

import { act, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installMockBridge, type MockBridge } from '../testing/mockBridge'
import { click, flush, goTo, pickSingle, renderApp, runButton } from '../testing/render'
import { shellLine } from '../app/format'
import { formValue } from '../testing/lastUsed'
import type { RunRecord } from '../types'

afterEach(() => {
  vi.restoreAllMocks()
})

function rec(id: string, input: string, status: RunRecord['status'], extra: Partial<RunRecord> = {}): RunRecord {
  const out = input.replace(/\.mzML$/, '.tags.tsv')
  return {
    id,
    input,
    outputs: [out],
    cwd: input.slice(0, input.lastIndexOf('/')),
    argv: ['/Applications/FASTag.app/Contents/Resources/fastag/FASTag', '-in', input, '-out', out, '-progress'],
    status,
    exitCode: status === 'ok' ? 0 : status === 'failed' ? 2 : null,
    message: status === 'cancelled' ? 'cancelled' : null,
    start: 1762419600000,
    end: 1762419641000,
    cleanup: { removed: status === 'ok' ? [] : [out], renamed: [], failed: [] },
    ...extra
  }
}

function clipboard(): ReturnType<typeof vi.fn> {
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  return writeText
}

async function history(): Promise<HTMLElement[]> {
  await goTo('history')
  const table = await screen.findByRole('table', { name: 'Run history' })
  return within(table).getAllByRole('row').slice(1)
}

const btn = (row: HTMLElement, name: string): HTMLElement | null => within(row).queryByRole('button', { name })

async function showWith(mock: MockBridge, records: RunRecord[]): Promise<HTMLElement[]> {
  mock.history = records
  await renderApp(mock)
  return history()
}

describe('History', () => {
  it('Copy command copies the argv the run record keeps, quoted for a shell', async () => {
    const mock = installMockBridge()
    const writeText = clipboard()
    const r = rec('1', "/d/my data/it's.mzML", 'ok', {
      argv: ['/opt/FASTag', '-in', "/d/my data/it's.mzML", '-out', "/d/my data/it's.tags.tsv", '-fixed_mods', '', '-progress']
    })
    const [row] = await showWith(mock, [r])
    await click(btn(row, 'Copy command')!)
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText.mock.calls[0][0]).toBe(shellLine(r.argv))
    expect(writeText.mock.calls[0][0]).toBe(
      "/opt/FASTag -in '/d/my data/it'\\''s.mzML' -out '/d/my data/it'\\''s.tags.tsv' -fixed_mods '' -progress"
    )
    expect(btn(row, 'Copied')).not.toBeNull()
  })

  it('says so when the clipboard refuses the command', async () => {
    const mock = installMockBridge()
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      configurable: true
    })
    const [row] = await showWith(mock, [rec('1', '/d/a.mzML', 'ok')])
    await click(btn(row, 'Copy command')!)
    expect(screen.getByText('The clipboard refused the command.')).toBeDefined()
  })

  it('the failure banner and History copy the same command line for the same run', async () => {
    const mock = installMockBridge()
    mock.recordRuns = true
    const writeText = clipboard()
    await renderApp(mock)
    await pickSingle(mock, '/d/my data/a.mzML')
    await click(runButton())
    await act(async () => mock.emitDone({ ok: false, code: 1, runId: mock.lastRunId }))
    await flush()
    await click(screen.getByRole('button', { name: 'Copy command' }))
    const fromBanner = writeText.mock.calls[0][0] as string
    expect(fromBanner).toBe("/mock/FASTag -in '/d/my data/a.mzML' -out '/d/my data/a.tags.tsv'")
    const rows = await history()
    expect(rows).toHaveLength(1)
    expect(rows[0].textContent).toMatch(/Failed \(exit 1\)/)
    await click(btn(rows[0], 'Copy command')!)
    expect(writeText.mock.calls[1][0]).toBe(fromBanner)
  })

  it('a cancelled or failed run is marked incomplete and offers no Open or Reveal; a finished one opens in Results', async () => {
    const mock = installMockBridge()
    const rows = await showWith(mock, [
      rec('3', '/d/c.mzML', 'cancelled'),
      rec('2', '/d/b.mzML', 'failed'),
      rec('1', '/d/a.mzML', 'ok', { tags: 2028 })
    ])
    expect(rows.map((r) => within(r).getAllByRole('cell')[1].textContent)).toEqual(['c.mzML', 'b.mzML', 'a.mzML'])
    for (const r of rows.slice(0, 2)) {
      expect(r.textContent).toMatch(/incomplete/)
      expect(btn(r, 'Open')).toBeNull()
      expect(btn(r, 'Reveal')).toBeNull()
      expect(btn(r, 'Copy command')).not.toBeNull()
    }
    expect(rows[0].textContent).toMatch(/Cancelled/)
    expect(rows[1].textContent).toMatch(/Failed \(exit 2\)/)
    expect(rows[2].textContent).not.toMatch(/incomplete/)
    // The tags it wrote; none for a run that did not finish.
    const tagsCol = (r: HTMLElement): string | null => within(r).getAllByRole('cell')[4].textContent
    expect(rows.map(tagsCol)).toEqual(['—', '—', '2,028'])
    await click(btn(rows[2], 'Open')!)
    await flush()
    expect(mock.resultsOpenCalls).toEqual(['/d/a.tags.tsv'])
    expect(screen.getByRole('navigation', { name: 'Views' }).querySelector('[aria-current="page"]')?.getAttribute('data-view')).toBe('results')
  })

  it('Reveal shows the run\'s tags file through the backend\'s checked reveal', async () => {
    const mock = installMockBridge()
    const [row] = await showWith(mock, [rec('1', '/d/a.mzML', 'ok')])
    await click(btn(row, 'Reveal')!)
    expect(mock.revealCalls).toEqual([{ path: '/d/a.tags.tsv', folder: false }])
  })

  // Review of PR h: Delete record asks first (it has no Undo), and keyboard
  // focus never drops to the page (WCAG 2.4.3): the row that takes the
  // deleted one's place gets it, or the heading once the list is empty.
  it('Delete record asks first, removes the record only, says the files were kept, and keeps focus in the list', async () => {
    const mock = installMockBridge()
    const rows = await showWith(mock, [rec('2', '/d/b.mzML', 'ok'), rec('1', '/d/a.mzML', 'ok')])
    await click(btn(rows[0], 'Delete record')!)
    // Asked, nothing deleted yet, focus on Keep.
    const ask = within(rows[0]).getByRole('group', { name: 'Delete this record?' })
    expect(mock.historyDeleteCalls).toEqual([])
    expect(document.activeElement).toBe(within(ask).getByRole('button', { name: 'Keep' }))
    await click(within(ask).getByRole('button', { name: 'Keep' }))
    expect(mock.historyDeleteCalls).toEqual([])
    expect(document.activeElement).toBe(btn(rows[0], 'Delete record'))
    // Escape keeps it too.
    await click(btn(rows[0], 'Delete record')!)
    await act(async () => {
      ;(document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(within(rows[0]).queryByRole('group', { name: 'Delete this record?' })).toBeNull()
    expect(document.activeElement).toBe(btn(rows[0], 'Delete record'))
    await click(btn(rows[0], 'Delete record')!)
    await click(within(rows[0]).getByRole('button', { name: 'Delete' }))
    await flush()
    expect(mock.historyDeleteCalls).toEqual(['2'])
    const left = within(screen.getByRole('table', { name: 'Run history' })).getAllByRole('row').slice(1)
    expect(left.map((r) => within(r).getAllByRole('cell')[1].textContent)).toEqual(['a.mzML'])
    expect(screen.getByRole('status', { name: 'History' }).textContent).toMatch(/b\.mzML.*files were kept/)
    // Focus is on the next row's first action, not on <body>.
    expect(document.activeElement).toBe(within(left[0]).getAllByRole('button')[0])
    // The last record: focus goes to the heading.
    await click(btn(left[0], 'Delete record')!)
    await click(within(left[0]).getByRole('button', { name: 'Delete' }))
    await flush()
    expect(screen.queryByRole('table', { name: 'Run history' })).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'History' }))
  })

  // Review of PR h (P0a, GUI-DESIGN 3 S9, 6.4): the record of a cancelled
  // run whose cleanup could not remove its tags file is what makes that
  // file open as incomplete; deleting it would let an older finished
  // record of the same path (or none) open it as complete.
  it('Delete record keeps the record that alone marks a left-over tags file incomplete, and says why', async () => {
    const mock = installMockBridge()
    mock.existingOutputs = ['/d/a.tags.tsv']
    const cancelled = rec('2', '/d/a.mzML', 'cancelled', { cleanup: { removed: [], renamed: [], failed: ['/d/a.tags.tsv'] } })
    const rows = await showWith(mock, [cancelled, rec('1', '/d/a.mzML', 'ok')])
    await click(btn(rows[0], 'Delete record')!)
    await click(within(rows[0]).getByRole('button', { name: 'Delete' }))
    await flush()
    expect(mock.historyDeleteCalls).toEqual(['2'])
    expect(mock.history.map((r) => r.id)).toEqual(['2', '1'])
    const left = within(screen.getByRole('table', { name: 'Run history' })).getAllByRole('row').slice(1)
    expect(left).toHaveLength(2)
    expect(screen.getByRole('status', { name: 'History' }).textContent).toMatch(
      /record was kept: it is what marks \/d\/a\.tags\.tsv as incomplete/
    )
    expect(document.activeElement).toBe(btn(left[0], 'Delete record'))
    // The file still opens marked incomplete, also from the older finished row.
    await click(btn(left[1], 'Open')!)
    await flush()
    expect(document.querySelector('.tabpanel')?.textContent).toContain('The run that wrote /d/a.tags.tsv was cancelled')
    expect(mock.resultsQueryCalls).toHaveLength(0)
    // The finished run's record is no marker: it may go.
    await goTo('history')
    const again = within(screen.getByRole('table', { name: 'Run history' })).getAllByRole('row').slice(1)
    await click(btn(again[1], 'Delete record')!)
    await click(within(again[1]).getByRole('button', { name: 'Delete' }))
    await flush()
    expect(mock.history.map((r) => r.id)).toEqual(['2'])
  })

  // Review of PR h (GUI-DESIGN 3 S9, 6.5 history_rerun): Re-run starts the
  // recorded run again with the parameters it was sent, not the form's,
  // through the overwrite question like any run, and shows it in Results.
  it('Re-run starts the recorded run with its own parameters, asks before overwriting, and moves to Results', async () => {
    const mock = installMockBridge()
    mock.recordRuns = true
    await renderApp(mock)
    // The form holds another file and other settings.
    await pickSingle(mock, '/d/x.mzML')
    mock.existingOutputs = ['/d/a.tags.tsv']
    const params = { species: true, tag_length: '5' }
    mock.history = [rec('1', '/d/a.mzML', 'ok', { params })]
    const [row] = await history()
    await click(btn(row, 'Re-run')!)
    await flush()
    expect(mock.historyRerunCalls).toEqual(['1'])
    expect(mock.outputsCheckCalls[mock.outputsCheckCalls.length - 1]).toEqual({ in: '/d/a.mzML', out: '/d/a.tags.tsv', params })
    const ask = screen.getByRole('alertdialog')
    expect(ask.textContent).toContain('/d/a.tags.tsv')
    expect(mock.runCalls).toHaveLength(0)
    await click(within(ask).getByRole('button', { name: 'Overwrite and run' }))
    expect(mock.runCalls).toEqual([{ in: '/d/a.mzML', out: '/d/a.tags.tsv', params, overwrite: true }])
    expect(screen.getByRole('navigation', { name: 'Views' }).querySelector('[aria-current="page"]')?.getAttribute('data-view')).toBe('results')
    await act(async () => mock.emitDone({ ok: true, code: 0, runId: mock.lastRunId }))
    await flush()
    // The form was not touched.
    await goTo('setup')
    expect(document.querySelector('.input-card .fname')?.textContent).toBe('x.mzML')
    // The new record keeps the same parameters (and, from the backend, the
    // same argv: fastag.rs a_rerun_starts_the_recorded_command_line).
    expect(mock.history[0].params).toEqual(params)
    expect(mock.history[0].input).toBe('/d/a.mzML')
  })

  it('Re-run is not offered for a record without its parameters, and is off while a run is busy', async () => {
    const mock = installMockBridge()
    const [row] = await showWith(mock, [rec('1', '/d/a.mzML', 'ok')])
    expect(btn(row, 'Re-run')).toBeNull()
    mock.history = [rec('2', '/d/b.mzML', 'failed', { params: {} }), ...mock.history]
    await pickSingle(mock, '/d/x.mzML')
    await click(runButton())
    const [busyRow] = await history()
    expect((btn(busyRow, 'Re-run') as HTMLButtonElement).disabled).toBe(true)
  })

  it('Settings into form loads the run\'s input, output and parameters; Undo puts the form back', async () => {
    const mock = installMockBridge()
    await renderApp(mock)
    await pickSingle(mock, '/d/x.mzML')
    mock.history = [rec('1', '/d/a.mzML', 'ok', { params: { species: true, tag_length: '5', not_a_param: 'x' } })]
    const [row] = await history()
    await click(btn(row, 'Settings into form')!)
    const note = screen.getByRole('status', { name: 'History' })
    expect(note.textContent).toMatch(/a\.mzML/)
    await goTo('setup')
    expect(await formValue('tag_length')).toBe('5')
    expect(await formValue('species')).toBe(true)
    expect((document.getElementById('out') as HTMLInputElement).value).toBe('/d/a.tags.tsv')
    expect(document.querySelector('.input-card .fname')?.textContent).toBe('a.mzML')
    await goTo('history')
    await click(within(note).getByRole('button', { name: 'Undo' }))
    await goTo('setup')
    expect(await formValue('tag_length')).toBe('3')
    expect(await formValue('species')).toBe(false)
    expect((document.getElementById('out') as HTMLInputElement).value).toBe('/d/x.tags.tsv')
    expect(document.querySelector('.input-card .fname')?.textContent).toBe('x.mzML')
  })

  it('a record without the parameters (from 1.13) offers no Settings into form; Open is off while a run is busy', async () => {
    const mock = installMockBridge()
    const [row] = await showWith(mock, [rec('1', '/d/a.mzML', 'ok')])
    expect(btn(row, 'Settings into form')).toBeNull()
    await pickSingle(mock, '/d/x.mzML')
    await click(runButton())
    const [busyRow] = await history()
    expect((btn(busyRow, 'Open') as HTMLButtonElement).disabled).toBe(true)
  })
})
