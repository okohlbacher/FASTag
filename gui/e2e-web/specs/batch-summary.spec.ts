// The Batch summary in a real browser (GUI-DESIGN 3 S6, 9 layer 3, 10 P2b):
// a folder of eight spectra files, one per job of a real batch (FASTag
// integration/1.12 on the public gate inputs, src/fixtures/cli/batch). The
// table is checked against oracles recomputed here from those files with no
// GUI code, the majority flags against the n >= 3 rule, and the exported
// summary TSV against the table.
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { test, expect, goTo, mockState, openApp, chooseTask, toStep } from './fixtures'

const DIR = fileURLToPath(new URL('../../src/fixtures/cli/batch/', import.meta.url))
const read = (c: string, f: string): string => readFileSync(`${DIR}${c}/${f}`, 'utf8')
const rows = (text: string): string[][] => text.trim().split('\n').slice(1).map((l) => l.split('\t'))
const cell = (text: string, sec: string, key: string): string | undefined => rows(text).find((r) => r[0] === sec && r[1] === key)?.[2]

const NAMES = readdirSync(DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort()

// What each job's row must say, from its files alone: the CLI's calls, held
// back below 1,000 tagged spectra (census), "no call" for a CLI no call.
function oracle(c: string) {
  if (!existsSync(`${DIR}${c}/run.digest.tsv`)) return { refused: true as const, name: c }
  const log = read(c, 'run.log')
  const digest = read(c, 'run.digest.tsv')
  const label = read(c, 'run.label.tsv')
  const census = read(c, 'run.tags.census_summary.tsv')
  const tagged = Number(cell(census, 'census', 'count_tagged')) + Number(cell(census, 'census', 'count_placed') ?? 0)
  const low = tagged < 1000
  const genera = rows(read(c, 'run.tags.species.tsv')).filter((r) => r[0] === 'genus')
  const present = genera.find((r) => r[8] === 'present')
  const call = (v: string | null, shown: string, nocall: string): { text: string; call: string | null } =>
    v == null ? { text: nocall, call: null } : low ? { text: 'too little evidence', call: null } : { text: shown, call: v }
  const protease = cell(digest, 'call', 'status') === 'call' ? cell(digest, 'call', 'model')! : null
  const lab = cell(label, 'label_call', 'status') === 'call' ? cell(label, 'label_call', 'label')! : null
  return {
    refused: false as const,
    name: c,
    tags: Number(/^(\d+) MS2 spectra, (\d+) tags/m.exec(log)![2]),
    protease: call(protease, protease ?? '', 'no call'),
    label: call(lab, lab === 'label-free' ? 'none (label-free)' : (lab ?? ''), 'no call'),
    genus: call(present ? present[2] : null, present?.[2] ?? '', genera.length ? (genera.some((r) => r[8] === 'no_call') ? 'no presence call' : 'none detected') : 'no genus')
  }
}

// The majority by the design's rule, recomputed: >= 3 calls, more than half.
function majority(calls: (string | null)[]): string | null {
  const have = calls.filter((c): c is string => c != null)
  if (have.length < 3) return null
  for (const v of new Set(have)) if (2 * have.filter((x) => x === v).length > have.length) return v
  return null
}

const table = (page: Page) => page.getByRole('table', { name: /^Batch summary/ })
const bodyRows = (page: Page) => table(page).locator('tbody tr')
async function shown(page: Page): Promise<string[][]> {
  return bodyRows(page).evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => td.getAttribute('data-text') ?? '')))
}

async function runFolder(page: Page): Promise<void> {
  await openApp(page, 'gate-batch')
  await chooseTask(page, 'Characterize a run')
  await toStep(page, 'Inputs')
  await page.getByRole('radio', { name: 'Batch' }).check()
  await goTo(page, 'Batch')
  await page.getByRole('button', { name: 'Add folder…' }).click()
  await expect(bodyRows(page)).toHaveCount(NAMES.length)
  await page.getByRole('button', { name: `Run ${NAMES.length} remaining files` }).click()
  await expect(page.getByText(`${NAMES.length - 1}/${NAMES.length} done`)).toBeVisible({ timeout: 15_000 })
  // Every done job's reports are read.
  await expect(table(page).getByText('reading…')).toHaveCount(0)
}

test('Batch summary: one row per job, the CLI calls and the majority flags equal the oracles', async ({ page }) => {
  await runFolder(page)
  const o = NAMES.map(oracle)
  const got = await shown(page)
  expect(got.map((r) => r[0])).toEqual(NAMES.map((n) => `${n}.mzML`))
  const done = o.filter((x) => !x.refused) as Exclude<ReturnType<typeof oracle>, { refused: true }>[]
  const maj = {
    genus: majority(done.map((x) => x.genus.call)),
    protease: majority(done.map((x) => x.protease.call)),
    label: majority(done.map((x) => x.label.call))
  }
  // The batch as it is: label-free 3 of 5 label calls, Trypsin and Homo everywhere called.
  expect(maj).toEqual({ genus: 'Homo', protease: 'Trypsin', label: 'label-free' })
  for (let i = 0; i < NAMES.length; i++) {
    const x = o[i]
    const r = got[i]
    if (x.refused) {
      expect(r[1]).toMatch(/^Failed: exit code 11: .*is raw DIA/)
      expect(r.slice(2)).toEqual(['—', '—', '—', '—', '—'])
      continue
    }
    expect(r[2]).toBe(x.tags.toLocaleString('en-US'))
    expect([r[3], r[4], r[5]]).toEqual([x.genus.text, x.protease.text, x.label.text])
    // Round 12: Glyco flagged follows the label; no job asked for the
    // alkylation report, so there is no Alkylation column.
    expect(r[6]).toMatch(/^[\d,]+ of [\d,]+ \(\d+\.\d%\)$|^–$|^not written$/)
    expect(r).toHaveLength(7)
  }
  // ≠ exactly where a call differs from its column's majority.
  const flagged = await bodyRows(page).evaluateAll((trs) =>
    trs.flatMap((tr, i) => [...tr.querySelectorAll('td')].flatMap((td, j) => (td.classList.contains('differs') ? [`${i}:${j}`] : [])))
  )
  const want = done.flatMap((x) => {
    const i = NAMES.indexOf(x.name)
    return [
      ...(x.genus.call && maj.genus && x.genus.call !== maj.genus ? [`${i}:3`] : []),
      ...(x.protease.call && maj.protease && x.protease.call !== maj.protease ? [`${i}:4`] : []),
      ...(x.label.call && maj.label && x.label.call !== maj.label ? [`${i}:5`] : [])
    ]
  })
  expect(want.length).toBe(2) // TMT and SILAC
  expect(flagged.sort()).toEqual(want.sort())
  await expect(table(page).locator('tfoot')).toContainText('label-free (3 of 5 calls)')
  // A done row opens that run in Results.
  await table(page).getByRole('button', { name: `Open ${NAMES[0]}.mzML in Results` }).click()
  await expect(page.getByRole('heading', { name: `Overview of ${NAMES[0]}.mzML` })).toBeVisible()
})

test('Export summary TSV writes the table, cell for cell', async ({ page }) => {
  await runFolder(page)
  await page.evaluate(() => {
    ;(window as unknown as { __fastagE2E: { mock: { nextPickOutput: string } } }).__fastagE2E.mock.nextPickOutput = '/data/batch-summary.tsv'
  })
  await page.getByRole('button', { name: 'Export summary TSV…' }).click()
  await expect(page.getByText(`Summary of ${NAMES.length} jobs written to /data/batch-summary.tsv.`)).toBeVisible()
  const writes = await mockState<{ dest: string; text: string }[]>(page, 'summaryWrites')
  expect(writes).toHaveLength(1)
  const [head, ...body] = writes[0].text.trimEnd().split('\n').map((l) => l.split('\t'))
  expect(head.slice(0, 5)).toEqual(['file', 'input', 'status', 'duration_s', 'tags'])
  const got = await shown(page)
  expect(body).toHaveLength(got.length)
  const fromTsv = body.map((b) => [b[0], b[2], b[4] === '' ? '—' : Number(b[4]).toLocaleString('en-US'), b[5], b[7], b[9], b[11]])
  expect(fromTsv).toEqual(got)
  // The flags too: "yes" where the table shows ≠.
  const flags = await bodyRows(page).evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll('td')].slice(3).map((td) => td.classList.contains('differs'))))
  expect(body.map((b) => [b[6], b[8], b[10], b[12]].map((f) => f === 'yes'))).toEqual(flags)
})

test('an output folder takes every job output; fewer than 3 jobs flag nothing', async ({ page }) => {
  await openApp(page, 'gate-batch')
  await chooseTask(page, 'Characterize a run')
  await toStep(page, 'Inputs')
  await page.getByRole('radio', { name: 'Batch' }).check()
  await goTo(page, 'Batch')
  await page.evaluate(() => {
    const m = (window as unknown as { __fastagE2E: { mock: { folderFiles: Record<string, string[]>; nextPickFolder: string } } }).__fastagE2E.mock
    m.folderFiles['/data'] = ['/data/pxd003531.mzML', '/data/pxd004541-tmt.mzML']
  })
  await page.getByRole('button', { name: 'Add folder…' }).click()
  await page.evaluate(() => {
    ;(window as unknown as { __fastagE2E: { mock: { nextPickFolder: string } } }).__fastagE2E.mock.nextPickFolder = '/out'
  })
  await page.getByRole('button', { name: 'Choose output folder…' }).click()
  await expect(page.locator('.outdir code')).toHaveText('/out')
  await page.getByRole('button', { name: 'Run 2 remaining files' }).click()
  await expect(page.getByText('2/2 done')).toBeVisible()
  const calls = await mockState<{ in: string; out: string; params: Record<string, unknown> }[]>(page, 'runCalls')
  expect(calls.map((c) => [c.in, c.out, c.params['digest_out'], c.params['label_out']])).toEqual([
    ['/data/pxd003531.mzML', '/out/pxd003531.tags.tsv', '/out/pxd003531.digest.tsv', '/out/pxd003531.label.tsv'],
    ['/data/pxd004541-tmt.mzML', '/out/pxd004541-tmt.tags.tsv', '/out/pxd004541-tmt.digest.tsv', '/out/pxd004541-tmt.label.tsv']
  ])
  // Read from /out: label-free and TMT, two calls, no majority, no ≠.
  await expect(bodyRows(page).nth(1)).toContainText('TMT')
  await expect(table(page).locator('td.differs')).toHaveCount(0)
  await expect(table(page).locator('tfoot')).toContainText('no majority (2 calls, fewer than 3)')
})

test('by keyboard, focus does not fall to the page body after Add folder… or a batch pass', async ({ page }) => {
  await openApp(page, 'gate-batch')
  await chooseTask(page, 'Characterize a run')
  await toStep(page, 'Inputs')
  await page.getByRole('radio', { name: 'Batch' }).check()
  await goTo(page, 'Batch')
  // The empty state's Add folder…: the queue replaces it, focus goes to its Add….
  await page.locator('.batch-empty').getByRole('button', { name: 'Add folder…' }).focus()
  await page.keyboard.press('Enter')
  await expect(bodyRows(page)).toHaveCount(NAMES.length)
  await expect(page.locator('.view[data-view="batch"] .block-head').getByRole('button', { name: 'Add…', exact: true })).toBeFocused()
  // Run by keyboard: Run and the queue's buttons are disabled or gone while
  // the batch runs; when it ends, focus is on the summary it filled.
  await page.getByRole('button', { name: `Run ${NAMES.length} remaining files` }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByText(`${NAMES.length - 1}/${NAMES.length} done`)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('heading', { name: 'Summary' })).toBeFocused()
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY')
})

// C13: a refused (raw DIA) job in a finished batch. The job list stays above
// the failure banner; the banner says why and what to run once, with one
// command, and FASTag's own sentence (which repeats both) is behind a closed
// disclosure; the failed job's line is clamped; the summary's status cell
// wraps instead of an ellipsis, and the table shows a cue that it scrolls.
test('a refused job: the queue above one short explanation and one command; the summary wraps its status and cues its scroll', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await runFolder(page)
  const alert = page.getByRole('alert')
  await expect(alert).toContainText('FASTag did not tag this file: it is raw DIA')
  const m = await page.evaluate(() => {
    const main = document.querySelector('.view-batch .batch-main')!
    const jobs = main.querySelector('ul.jobs')!
    const banner = main.querySelector('.failure')!
    const details = banner.querySelector('details.why-more') as HTMLDetailsElement | null
    // What shows without opening anything: the banner minus the closed disclosure.
    const clone = banner.cloneNode(true) as HTMLElement
    clone.querySelectorAll('details.why-more').forEach((d) => d.remove())
    const shown = clone.textContent ?? ''
    const count = (s: string, re: RegExp): number => (s.match(re) ?? []).length
    const failedJs = main.querySelector('li.job.failed .js') as HTMLElement
    const lh = parseFloat(getComputedStyle(failedJs).lineHeight) || 16
    const wrap = document.querySelector('.view-batch .summary-wrap') as HTMLElement
    const status = [...document.querySelectorAll('.view-batch table.summary-table td.status')].find((td) =>
      /exit code 11/.test(td.textContent ?? '')
    ) as HTMLElement | undefined
    return {
      jobsFirst: !!(jobs.compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING),
      detailsClosed: !!details && !details.open,
      whyInDetails: !!details?.querySelector('code.why'),
      leads: count(shown, /FASTag did not tag this file/g),
      commands: count(shown, /DIAspeXtract -in /g),
      paragraphs: banner.querySelectorAll('.refusal p').length,
      failedJsLines: failedJs.getBoundingClientRect().height / lh,
      cue: getComputedStyle(wrap).backgroundImage,
      statusCut: status ? status.scrollWidth > status.clientWidth + 0.5 : null,
      statusText: status?.textContent ?? null,
      // Wrapped to at most three lines, its first line the reason's start.
      statusLines: status ? (status.querySelector('.status-text') as HTMLElement).getBoundingClientRect().height / (parseFloat(getComputedStyle(status).lineHeight) || 16) : null
    }
  })
  expect(m.jobsFirst).toBe(true)
  expect(m.detailsClosed).toBe(true)
  expect(m.whyInDetails).toBe(true)
  expect(m.leads).toBe(1)
  expect(m.commands).toBe(1)
  expect(m.paragraphs).toBe(1)
  expect(m.failedJsLines).toBeLessThanOrEqual(2.05)
  expect(m.cue).toMatch(/radial-gradient/)
  expect(m.statusText).not.toBeNull()
  expect(m.statusCut).toBe(false)
  expect(m.statusLines).toBeGreaterThan(1.5)
  expect(m.statusLines).toBeLessThanOrEqual(3.05)
  // The queue's top is in the window, not pushed off by the banner.
  await page.locator('.view-batch .page-scroll').evaluate((e) => e.scrollTo(0, 0))
  const jobsBox = (await page.locator('.view-batch ul.jobs').boundingBox())!
  expect(jobsBox.y).toBeLessThan(800)
  // The full message opens on request.
  await alert.locator('details.why-more > summary').click()
  await expect(alert.locator('details.why-more code.why')).toBeVisible()
})

// Codex round 2, 13: at 1024x700 with Help open the Batch pane, not the
// window, decides the layout: the summary goes under the queue instead of a
// ~250 px sliver; the sticky File column is bounded, so scrolling to Label
// shows it uncovered; and the refused job's recovery (short reason and its
// DIAspeXtract command) is beside it in the queue, above the banner.
test('with Help open at 1024x700: the summary stacks by pane width, Label scrolls clear of File, the recovery is beside the failed job', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __copied: string[] }
    w.__copied = []
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: (t: string) => (w.__copied.push(t), Promise.resolve()) }
    })
  })
  await page.setViewportSize({ width: 1024, height: 700 })
  await runFolder(page)
  await page.getByRole('button', { name: 'Help', exact: true }).click()
  await expect(page.locator('#help-panel')).toBeVisible()
  // The window is wider than the old 1000 px breakpoint: only the pane is narrow.
  const main = (await page.locator('.view-batch .batch-main').boundingBox())!
  const side = (await page.locator('.view-batch .batch-side').boundingBox())!
  expect(side.y).toBeGreaterThanOrEqual(main.y + main.height - 0.5)
  expect(side.width).toBeGreaterThan(500)
  // The summary's toolbar fits its pane.
  const head = (await page.locator('.view-batch .batch-table .block-head').boundingBox())!
  for (const name of ['Show cutoffs and caveats', 'Export summary TSV…']) {
    const b = (await page.getByRole('button', { name }).boundingBox())!
    expect(b.x + b.width).toBeLessThanOrEqual(head.x + head.width + 0.5)
  }

  // Scrolled to Label (a long file name in File must not cover it): the
  // header and each row's Label cell are what is under their centre.
  const wrap = page.locator('.view-batch .summary-wrap')
  const label = table(page).getByRole('columnheader', { name: 'Label', exact: true })
  await label.evaluate((th) => {
    const w = th.closest('.summary-wrap') as HTMLElement
    w.scrollLeft = (th as HTMLElement).offsetLeft - w.clientWidth / 2 + (th as HTMLElement).offsetWidth / 2
    // A file name far longer than the pane: the column stays bounded.
    const first = w.querySelector('tbody td:first-child .file-name') as HTMLElement
    first.textContent = 'a-very-long-spectra-file-name-from-an-instrument-export-'.repeat(4) + '.mzML'
  })
  await label.scrollIntoViewIfNeeded()
  const uncovered = await wrap.evaluate((w) => {
    const th = [...w.querySelectorAll('thead th')].find((e) => e.textContent === 'Label') as HTMLTableCellElement
    const col = th.cellIndex
    const cells = [th, ...[...w.querySelectorAll('tbody tr')].map((tr) => (tr as HTMLTableRowElement).cells[col])]
    const file = w.querySelector('tbody td:first-child') as HTMLElement
    const wr = w.getBoundingClientRect()
    return {
      fileShare: file.getBoundingClientRect().width / wr.width,
      hits: cells.map((c) => {
        const r = c.getBoundingClientRect()
        const x = Math.min(Math.max(r.left + r.width / 2, wr.left + 1), wr.right - 1)
        const hit = document.elementFromPoint(x, r.top + Math.min(r.height / 2, 10))
        return !!hit && (hit === c || c.contains(hit))
      })
    }
  })
  expect(uncovered.fileShare).toBeLessThanOrEqual(0.45)
  expect(uncovered.hits.every(Boolean)).toBe(true)

  // The recovery is in the failed job's row, before the banner, and works.
  const failed = page.locator('.view-batch li.job.failed')
  await expect(failed.locator('.js')).toHaveText(/^Failed: raw DIA, not tagged/)
  const copy = failed.getByRole('button', { name: /^Copy the DIAspeXtract command for / })
  const before = await copy.evaluate(
    (b) => !!(b.compareDocumentPosition(document.querySelector('.view-batch .failure')!) & Node.DOCUMENT_POSITION_FOLLOWING)
  )
  expect(before).toBe(true)
  await page.locator('.view-batch .page-scroll').evaluate((e) => e.scrollTo(0, 0))
  await copy.scrollIntoViewIfNeeded()
  const bar = (await page.locator('.actionbar:visible').first().boundingBox())!
  const cb = (await copy.boundingBox())!
  expect(cb.y + cb.height).toBeLessThanOrEqual(bar.y + 0.5)
  await copy.click()
  await expect(copy).toHaveText('Copied')
  const sent = await page.evaluate(() => (window as unknown as { __copied: string[] }).__copied)
  expect(sent).toHaveLength(1)
  expect(sent[0]).toMatch(/^DIAspeXtract -in /)
})
