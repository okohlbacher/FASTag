import { writeFileSync } from 'node:fs'
import { test, expect, openApp } from './fixtures'

// The P1 gate "Log line with drawer open" (GUI-DESIGN section 7): with the
// drawer open and 5,000 lines in the log, the time from a Log message to
// its commit (React render, DOM mutation and the layout it forces; paint
// excluded) per single line and per 500-line batch, median and p95, in
// Chromium and Playwright's WebKit. Playwright's WebKit is not WebKitGTK:
// that half of the gate, and the IPC message rate on WebKitGTK, are
// measured by the tauri-driver job of P1 PR d.
//
// A measure-and-record gate (provisional target < 1 ms per frame batch):
// the spec only checks that it measured, and with PERF_OUT=<file> writes its
// numbers there (bench-<version>.json). It runs on any build whose bridge
// has emitLog; with emitEvent (P1a's Channel) a batch is one Log{lines}
// message, without it (the global fastag:log events before P1a) it is 500
// log events in one task, as the backend sent them then.

interface Stats {
  n: number
  median_ms: number
  p95_ms: number
}

test('the log drawer commits a line and a 500-line batch quickly with 5,000 lines in it', async ({ page, browserName }) => {
  test.setTimeout(180_000)
  await openApp(page, 'slow')
  await page.getByRole('button', { name: 'Choose file…' }).click()
  await page.getByRole('button', { name: 'Run on run01.mzML' }).click()
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible()
  await page.locator('.logdrawer .drawer-toggle').click()
  await expect(page.locator('pre.log')).toBeVisible()

  const r = await page.evaluate(async () => {
    type Mock = {
      lastRunId: number
      emitLog(line: string): void
      emitEvent?: (runId: number, e: { kind: 'log'; lines: [string, boolean][] }) => void
    }
    const m = (window as unknown as { __fastagE2E: { mock: Mock } }).__fastagE2E.mock
    const batched = typeof m.emitEvent === 'function'
    const pre = document.querySelector('pre.log') as HTMLElement
    const emit = (lines: string[]): void => {
      if (batched) m.emitEvent!(m.lastRunId, { kind: 'log', lines: lines.map((l) => [l, true]) })
      else for (const l of lines) m.emitLog(l)
    }
    const frame = (): Promise<void> => new Promise((res) => requestAnimationFrame(() => setTimeout(res, 0)))
    // From the message to the commit it causes, with the layout it forces.
    const commit = async (lines: string[]): Promise<number> => {
      const t0 = performance.now()
      const done = new Promise<number>((res) => {
        const mo = new MutationObserver(() => {
          mo.disconnect()
          void pre.scrollHeight
          res(performance.now() - t0)
        })
        mo.observe(pre, { childList: true, subtree: true, characterData: true })
      })
      emit(lines)
      const dt = await done
      await frame()
      return dt
    }
    const stats = (xs: number[]): { n: number; median_ms: number; p95_ms: number } => {
      const s = xs.slice().sort((a, b) => a - b)
      const q = (p: number): number => s[Math.min(s.length - 1, Math.floor(p * s.length))]
      const round = (x: number): number => Math.round(x * 100) / 100
      return { n: s.length, median_ms: round(q(0.5)), p95_ms: round(q(0.95)) }
    }
    let k = 0
    const lines = (n: number): string[] =>
      Array.from({ length: n }, () => `Warning: spectrum ${k++} has no precursor charge, assuming 2+`)
    // Fill the log to 5,000 lines.
    for (let i = 0; i < 10; i++) {
      emit(lines(500))
      await frame()
    }
    const perLine: number[] = []
    for (let i = 0; i < 200; i++) perLine.push(await commit(lines(1)))
    const perBatch: number[] = []
    for (let i = 0; i < 60; i++) perBatch.push(await commit(lines(500)))
    return {
      batched,
      domLines: (pre.textContent ?? '').split('\n').length,
      line: stats(perLine.slice(20)),
      batch: stats(perBatch.slice(10))
    }
  })

  const out = { browser: browserName, ...r }
  console.log(`log drawer perf ${JSON.stringify(out)}`)
  expect(r.line.n).toBe(180)
  expect(r.batch.n).toBe(50)
  expect(Number.isFinite(r.batch.median_ms)).toBe(true)
  const file = process.env.PERF_OUT
  if (file) writeFileSync(`${file}.${browserName}.json`, JSON.stringify(out, null, 2))
})
