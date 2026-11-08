// The batch queue as a component (P1 PR c). The job naming moved here from
// App.test.tsx: "numbers colliding batch outputs" and "dedups batch inputs
// across picks" test addJobs, which the queue's Add… uses.

import { render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import BatchList, { type BatchListProps } from './BatchList'
import { addJobs, jobOut, renameJobs, type BatchJob } from './batch'
import { createLogStore } from './logStore'
import { click } from '../testing/render'

describe('batch job naming', () => {
  it('numbers colliding batch outputs', () => {
    // sample.mzML and sample.mzpeak both map to sample.tags.tsv; the
    // extensionless third collides with the full-name fallback too.
    expect(addJobs([], ['/d/s.mzML', '/d/s.mzpeak', '/d/s']).map((j) => j.out)).toEqual([
      '/d/s.tags.tsv',
      '/d/s.mzpeak.tags.tsv',
      '/d/s.2.tags.tsv'
    ])
  })

  it('dedups batch inputs across picks', () => {
    const js = addJobs(addJobs([], ['/d/a.mzML']), ['/d/a.mzML', '/d/b.mzML'])
    expect(js.map((j) => j.input)).toEqual(['/d/a.mzML', '/d/b.mzML'])
    expect(js.every((j) => j.status === 'queued')).toBe(true)
  })

  it('keeps the jobs it has, and returns the same list when nothing is new', () => {
    const one = addJobs([], ['/d/a.mzML'])
    expect(addJobs(one, ['/d/a.mzML'])).toEqual(one)
  })

  // P2b: an output folder (for inputs on a read-only share) holds every
  // job's tags; the reports follow them (perJobOutputs).
  it('names each output in the output folder, by the input name', () => {
    expect(jobOut('/share/run01.mzML', '/out')).toBe('/out/run01.tags.tsv')
    expect(jobOut('/share/run01.mzML', '/out/')).toBe('/out/run01.tags.tsv')
    expect(jobOut('C:\\share\\run01.mzML', 'D:\\out')).toBe('D:\\out\\run01.tags.tsv')
    expect(jobOut('/share/run01.mzML', null)).toBe('/share/run01.tags.tsv')
    expect(addJobs([], ['/a/run01.mzML', '/b/run02.mgf'], '/out').map((j) => j.out)).toEqual(['/out/run01.tags.tsv', '/out/run02.tags.tsv'])
  })

  it('in one output folder, inputs of the same name from two folders still get distinct outputs', () => {
    expect(addJobs([], ['/a/s.mzML', '/b/s.mzML', '/c/s.mzML', '/a/s.mzpeak'], '/out').map((j) => j.out)).toEqual([
      '/out/s.tags.tsv',
      '/out/s.mzML.tags.tsv',
      '/out/s.mzML.2.tags.tsv',
      '/out/s.mzpeak.tags.tsv'
    ])
  })

  it('choosing or clearing the folder renames the jobs not run yet; a done or running job keeps what it wrote', () => {
    const js: BatchJob[] = addJobs([], ['/a/x.mzML', '/a/y.mzML', '/a/z.mzML', '/a/w.mzML']).map((j, i) =>
      i === 0 ? { ...j, status: 'done' } : i === 1 ? { ...j, status: 'running' } : i === 2 ? { ...j, status: 'failed' } : j
    )
    const moved = renameJobs(js, '/out')
    expect(moved.map((j) => j.out)).toEqual(['/a/x.tags.tsv', '/a/y.tags.tsv', '/out/z.tags.tsv', '/out/w.tags.tsv'])
    expect(renameJobs(moved, null).map((j) => j.out)).toEqual(['/a/x.tags.tsv', '/a/y.tags.tsv', '/a/z.tags.tsv', '/a/w.tags.tsv'])
    // A kept output is never given to a second job.
    const kept = renameJobs([{ ...js[0], out: '/out/w.tags.tsv' }, js[3]], '/out')
    expect(kept.map((j) => j.out)).toEqual(['/out/w.tags.tsv', '/out/w.mzML.tags.tsv'])
  })
})

function list(p: Partial<BatchListProps> = {}): BatchListProps {
  const props: BatchListProps = {
    jobs: [],
    busy: false,
    results: null,
    logJob: null,
    logOpen: false,
    onAdd: vi.fn(),
    onClear: vi.fn(),
    onRemove: vi.fn(),
    onShow: vi.fn(),
    onLog: vi.fn(),
    addBatchRef: createRef<HTMLButtonElement>(),
    ...p
  }
  render(<BatchList {...props} />)
  return props
}

const jobs: BatchJob[] = [
  { input: '/d/a.mzML', out: '/d/a.tags.tsv', status: 'done', ms: 61_000, outputs: { out: '/d/a.tags.tsv' }, log: createLogStore(['a']) },
  { input: '/d/b.mzML', out: '/d/b.tags.tsv', status: 'failed', reason: 'exit code 1: Error', log: createLogStore(['b']) },
  { input: '/d/c.mzML', out: '/d/c.tags.tsv', status: 'cancelled', cleaned: 2 },
  { input: '/d/d.mzML', out: '/d/d.tags.tsv', status: 'queued' }
]

describe('the batch queue', () => {
  it('names each job with its status in words and counts the done ones', () => {
    list({ jobs })
    expect(screen.getByRole('heading').textContent).toBe('Batch · 4 files')
    expect(document.querySelector('.block-head .count')?.textContent).toBe('1/4 done')
    expect([...document.querySelectorAll('li.job .js')].map((e) => e.textContent)).toEqual([
      'Done · 1:01',
      'Failed: exit code 1: Error',
      'Cancelled by you, partial outputs removed',
      'Not run'
    ])
  })

  it("a done job's row shows its results, and a job with a log has its own Log button", async () => {
    const p = list({ jobs })
    await click(screen.getByRole('button', { name: /^a\.mzML/ }))
    expect(p.onShow).toHaveBeenCalledWith(jobs[0])
    await click(screen.getByRole('button', { name: 'Log of b.mzML' }))
    expect(p.onLog).toHaveBeenCalledWith('/d/b.mzML')
    expect([...document.querySelectorAll('button.jlog')].map((b) => b.getAttribute('aria-label'))).toEqual([
      'Log of a.mzML',
      'Log of b.mzML'
    ])
  })

  it('the open log is pressed; the shown job is current', () => {
    list({ jobs, logJob: '/d/b.mzML', logOpen: true, results: { path: '/d/a.tags.tsv', gen: 1, input: '/d/a.mzML' } })
    expect(screen.getByRole('button', { name: 'Log of b.mzML' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Log of a.mzML' }).getAttribute('aria-pressed')).toBe('false')
    expect(document.querySelector('li.job.shown')?.querySelector('.jn')?.textContent).toBe('a.mzML')
  })

  it('while busy nothing can be added, cleared, removed or shown', () => {
    list({ jobs, busy: true })
    expect(screen.queryByRole('button', { name: 'Add…' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Remove/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^a\.mzML/ })).toBeNull()
  })

  it('Remove and Clear ask the owner to change the queue', async () => {
    const p = list({ jobs })
    await click(screen.getByRole('button', { name: 'Remove /d/c.mzML' }))
    expect(p.onRemove).toHaveBeenCalledWith(2)
    await click(screen.getByRole('button', { name: 'Clear' }))
    expect(p.onClear).toHaveBeenCalledTimes(1)
    await click(screen.getByRole('button', { name: 'Add…' }))
    expect(p.onAdd).toHaveBeenCalledTimes(1)
  })
})
