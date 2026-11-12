// Help: every link lands on a section that exists, every parameter has a
// settings entry, the troubleshooting covers what the app can show, and the
// view is reachable and usable from the keyboard.
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import DigestPanel, { REASON } from '../DigestPanel'
import { parseReport } from '../digestReport'
import { PARAM_BY_NAME, RENDERED, SECTIONS, defaultText } from '../paramLayout'
import manifest from '../params.generated.json'
import { installMockBridge } from '../testing/mockBridge'
import { click, flush } from '../testing/render'
import nocallTsv from '../fixtures/digest_nocall.tsv?raw'
import digestTsv from '../fixtures/digest.tsv?raw'
import labelTsv from '../fixtures/label.tsv?raw'
import massgapTsv from '../fixtures/massgap.tsv?raw'
import { GLOSSARY, PAGES } from './content'
import { CLASSES, FAQ, FAQ_GROUPS, faqForMessage } from './faq'
import HelpView, { COMMON, PAGE_OF, slug } from './HelpView'
import { PARAM_UI } from '../paramUi'
import { closeHelp, helpBack, openHelp, resetHelp, showHelpPage, useHelp } from './link'

// The help of every PARAM_UI entry that has one (help/params.ts before P5).
const PARAM_HELP = Object.fromEntries(Object.entries(PARAM_UI).flatMap(([n, u]) => (u.help ? [[n, u.help]] : [])))

afterEach(() => {
  resetHelp()
  vi.restoreAllMocks()
})

/// Each page rendered on its own: the ids it holds and the targets it links to.
function renderPages(): { ids: Map<string, Set<string>>; links: Set<string> } {
  const ids = new Map<string, Set<string>>()
  const links = new Set<string>()
  for (const p of PAGES) {
    resetHelp()
    act(() => showHelpPage(p.id))
    const { container, unmount } = render(<HelpView />)
    ids.set(p.id, new Set([...container.querySelectorAll('[id]')].map((e) => e.id)))
    container.querySelectorAll('[data-help]').forEach((e) => links.add(e.getAttribute('data-help')!))
    unmount()
  }
  return { ids, links }
}

// The app's own source, for the link targets written in it.
const SOURCES = import.meta.glob(['../**/*.tsx', '../**/*.ts', '!../**/*.test.*'], {
  query: '?raw',
  import: 'default',
  eager: true
}) as Record<string, string>

describe('help: settings reference', () => {
  it('every parameter of the CLI has a plain-language entry, and every entry names a parameter', () => {
    const names = (manifest.params as { name: string }[]).map((p) => p.name)
    expect(names.filter((n) => !PARAM_HELP[n])).toEqual([])
    expect(Object.keys(PARAM_HELP).filter((n) => !names.includes(n))).toEqual([])
    for (const [n, h] of Object.entries(PARAM_HELP)) {
      expect(h.text, n).toMatch(/\.$/)
      if (h.tip) expect(h.tip, n).toMatch(/[.)]$/)
    }
  })

  it('a default named in a tip is the CLI default', () => {
    for (const [n, h] of Object.entries(PARAM_HELP)) {
      const m = /^([\d.]+)(?: Da)? is the default/.exec(h.tip ?? '')
      if (m) expect(Number(m[1]), n).toBe(Number(PARAM_BY_NAME.get(n)!.default))
    }
  })

  it('the settings page has the form sections, in the form order, then the options not in the form', () => {
    act(() => openHelp('param-tag_length'))
    const { container } = render(<HelpView />)
    const groups = [...container.querySelectorAll('.help-page section > h3')].map((h) => h.textContent)
    expect(groups).toEqual(['What to set first', ...SECTIONS.map((s) => s.title), 'Not in the form'])
    // Every rendered parameter has its entry, with the default the form shows.
    for (const n of RENDERED) {
      const d = container.querySelector(`details#param-${n}`)
      expect(d, n).not.toBeNull()
      expect(d!.querySelector('.meta')!.textContent).toContain(`Default: ${defaultText(PARAM_BY_NAME.get(n)!)}`)
    }
  })

  it('a deep link to a hidden option explains that it is unavailable in the form', () => {
    act(() => openHelp('param-species_call'))
    const { container } = render(<HelpView />)
    const entry = container.querySelector<HTMLDetailsElement>('#param-species_call')!
    expect(entry.open).toBe(true)
    expect(entry.textContent).toContain(`Not in the settings form: ${PARAM_UI.species_call.hidden}`)
    expect(entry.textContent).toContain('Choices:')
  })
})

describe('help: links', () => {
  it('every link on a Help page, and every page id, lands on a section of the page it names', () => {
    const { ids, links } = renderPages()
    for (const [id, page] of PAGE_OF) {
      if (id === page) continue
      expect(ids.get(page)!.has(id), `${id} on ${page}`).toBe(true)
    }
    const unknown = [...links].filter((t) => !PAGE_OF.has(t))
    expect(unknown).toEqual([])
  })

  it('every link target written in the app source exists', () => {
    const targets = new Set<string>()
    for (const text of Object.values(SOURCES)) {
      for (const m of text.matchAll(/\b(?:to|help)="([a-z0-9_-]+)"|openHelp\('([a-z0-9_-]+)'\)/g)) targets.add(m[1] ?? m[2])
      // Every quoted string with a link-target prefix, wherever it is written (arrays, maps).
      for (const m of text.matchAll(/'((?:faq|param|tags|results|digest|species|files|start|gloss|workflow)-[a-z0-9_]+(?:-[a-z0-9_]+)*)'/g))
        targets.add(m[1])
    }
    for (const id of COMMON) expect(targets.has(id), id).toBe(true)
    expect(targets.size).toBeGreaterThan(50)
    expect([...targets].filter((t) => !PAGE_OF.has(t))).toEqual([])
  })

  it('every Help button on the Digest tab lands on a section that exists', () => {
    installMockBridge()
    const reports = [digestTsv, labelTsv, massgapTsv, nocallTsv].map((t, i) => parseReport(t, `/r/${i}.tsv`))
    const { container } = render(<DigestPanel reports={reports} errors={[]} onOpen={() => {}} />)
    const targets = [...container.querySelectorAll('[data-help]')].map((e) => e.getAttribute('data-help')!)
    expect(targets).toEqual(expect.arrayContaining(['digest-protease', 'digest-labels', 'digest-gaps']))
    expect(targets.filter((t) => !PAGE_OF.has(t))).toEqual([])
  })

  it('every failure class leads to a troubleshooting entry', () => {
    for (const [re, id] of CLASSES) expect(PAGE_OF.get(id), String(re)).toBe('troubleshooting')
  })

  it('links built from data exist: each parameter, each form section, each digest no-call reason', () => {
    for (const n of RENDERED) expect(PAGE_OF.has(`param-${n}`), n).toBe(true)
    for (const s of SECTIONS) expect(PAGE_OF.has(`param-sec-${slug(s.title)}`), s.title).toBe(true)
    for (const r of Object.keys(REASON)) expect(PAGE_OF.has(`faq-digest-${r}`), r).toBe(true)
  })

  it('every glossary entry is linked from somewhere, and links back to a section', () => {
    const { links } = renderPages()
    expect(GLOSSARY.filter((g) => !links.has(g.id)).map((g) => g.id)).toEqual([])
    resetHelp()
    act(() => showHelpPage('glossary'))
    const { container } = render(<HelpView />)
    for (const g of GLOSSARY) {
      const dd = container.querySelector(`#${g.id}`)!.nextElementSibling!
      expect(dd.querySelector('[data-help]'), g.id).not.toBeNull()
    }
  })
})

describe('help: troubleshooting', () => {
  it('inside an entry, the two sub-labels are headings', () => {
    act(() => showHelpPage('troubleshooting'))
    const { container } = render(<HelpView />)
    for (const entry of container.querySelectorAll('details.help-entry')) {
      expect([...entry.querySelectorAll('h4')].map((h) => h.textContent)).toEqual([
        'Possible causes, the usual ones first',
        'What to do'
      ])
    }
    expect(container.querySelector('p.sub-h')).toBeNull()
  })

  it('entries have unique ids, a known group, causes and fixes', () => {
    const ids = FAQ.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const f of FAQ) {
      expect(f.id).toMatch(/^faq-[a-z0-9_-]+$/)
      expect(FAQ_GROUPS).toContain(f.group)
      expect(f.causes.length, f.id).toBeGreaterThan(0)
      expect(f.fixes.length, f.id).toBeGreaterThan(0)
    }
  })

  it('a failure message leads to the entry for it, as FASTag and the app word it', () => {
    const cases: [string, string][] = [
      ['-species: tag_length (3) + 2*extension (0) = 3 cannot reach the index k = 7', 'faq-species-short'],
      ["-species: no taxdb. Looked in '/x'. Pass -taxdb explicitly, or set FASTAG_TAXONOMY_DIR.", 'faq-species-reference'],
      ["Input 'run.raw' is neither .mzML, .mzpeak nor .mgf.", 'faq-input'],
      ["Input 'run.mgf.gz' is gzip-compressed; FASTag reads uncompressed input only. Decompress it first.", 'faq-input'],
      ['Error: File not found (the file /d/a.mzML could not be found)', 'faq-input'],
      ['Cannot open output file /ro/a.tags.tsv for writing.', 'faq-cannot-write'],
      ['-digest_out and -label_out name the same file (/d/a.tsv).', 'faq-cannot-write'],
      ["Unknown modification 'Carbamidomethyl' (not in OpenMS's", 'faq-modification'],
      ['No spectrum carried a reported tag; not writing hits.mzML', 'faq-out-spectra-none'],
      ['No reportable tag can reach the minimum filter length. This database of 300 residues needs tags of at least 4', 'faq-min-filter'],
      ['The entrapment database shares its entire key space', 'faq-entrapment'],
      ['FASTag could not start: no such file', 'faq-will-not-start'],
      ['FASTAG_REFUSED reason=raw_dia windows=33 median_width=25', 'faq-raw-dia'],
      ["'/d/run.mzML' is raw DIA: 33 isolation windows. Each MS2 mixes several peptides", 'faq-raw-dia'],
      ['stopped before it finished', 'faq-run-failed']
    ]
    for (const [msg, id] of cases) expect(faqForMessage(msg), msg).toBe(id)
    for (const [, id] of cases) expect(PAGE_OF.get(id)).toBe('troubleshooting')
  })
})

async function renderApp(): Promise<HTMLElement> {
  installMockBridge()
  const { container } = render(<App />)
  await screen.findByText('FASTag ready')
  await flush()
  return container
}

describe('help: in the app', () => {
  // P2a: Help is a side panel beside the view (GUI-DESIGN 2), no longer a
  // page in place of it; "Close Help" replaces "Back to FASTag".
  const setupView = (c: HTMLElement): HTMLElement => c.querySelector('.view[data-view="setup"]') as HTMLElement

  it('the Help button opens Getting started beside the view; Close Help returns focus to the Help button', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const c = await renderApp()
    const helpBtn = screen.getByRole('button', { name: 'Help' })
    helpBtn.focus()
    await click(helpBtn)
    expect(screen.getByRole('complementary', { name: 'Help' })).toBeDefined()
    expect(setupView(c).hidden).toBe(false)
    const nav = screen.getByRole('navigation', { name: 'Help pages' })
    expect(nav.querySelector('[aria-current="page"]')?.textContent).toBe('Getting started')
    expect(document.activeElement?.id).toBe('help-page-h')
    // The page is the main landmark, named by its heading.
    expect(screen.getByRole('main', { name: 'Getting started' })).toBeDefined()
    // Every section is named by its heading.
    for (const s of c.querySelectorAll('.help-page section')) {
      expect(document.getElementById(s.getAttribute('aria-labelledby')!)?.textContent).toBeTruthy()
    }
    // The page itself is named once, by the main landmark, not again by its article.
    expect(c.querySelector('.help-page')?.hasAttribute('aria-labelledby')).toBe(false)
    // A figure is named by its title.
    for (const svg of c.querySelectorAll('.help-page svg[role="img"]')) {
      expect(document.getElementById(svg.getAttribute('aria-labelledby')!)?.tagName).toBe('title')
    }
    await click(screen.getByRole('button', { name: 'Close Help' }))
    await act(async () => {
      vi.runAllTimers()
    })
    expect(screen.queryByRole('complementary', { name: 'Help' })).toBeNull()
    expect(setupView(c).hidden).toBe(false)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Help' }))
    vi.useRealTimers()
  })

  it.each(['hidden', 'disabled', 'removed'] as const)('closing Help recovers focus when its opener is %s', async (state) => {
    await renderApp()
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    act(() => openHelp())
    if (state === 'hidden') opener.hidden = true
    else if (state === 'disabled') opener.disabled = true
    else opener.remove()
    act(() => closeHelp())
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Help' }))
    opener.remove()
  })

  it('F1 opens Help, Esc closes it; ? typed in a field does not open it', async () => {
    const c = await renderApp()
    const out = screen.getByLabelText(/Tags TSV/)
    await act(async () => {
      fireEvent.keyDown(out, { key: '?' })
    })
    expect(screen.queryByRole('navigation', { name: 'Help pages' })).toBeNull()
    await act(async () => {
      fireEvent.keyDown(window, { key: 'F1' })
    })
    expect(screen.getByRole('navigation', { name: 'Help pages' })).toBeDefined()
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Escape' })
    })
    expect(screen.queryByRole('navigation', { name: 'Help pages' })).toBeNull()
    expect(setupView(c).hidden).toBe(false)
  })

  it('? with Help open keeps the place; Back returns to the last place', async () => {
    let state = { page: '', target: null as { id: string } | null }
    function Probe(): null {
      const h = useHelp()
      state = { page: h.page, target: h.target }
      return null
    }
    await renderApp()
    render(<Probe />)
    await act(async () => openHelp('tags-gapped'))
    await act(async () => {
      fireEvent.keyDown(window, { key: '?' })
    })
    expect(state.target?.id).toBe('tags-gapped')
    await act(async () => openHelp('gloss-ms2'))
    await click(screen.getByRole('button', { name: /Back to Tags and gapped tags/ }))
    expect(state.target?.id).toBe('tags-gapped')
    act(() => helpBack())
    expect(state.target?.id).toBe('tags-gapped')
  })

  it('a field\'s ? opens its settings entry, open and focused; the form keeps its values', async () => {
    await renderApp()
    const tl = screen.getByLabelText('Tag length tag_length') as HTMLInputElement
    await act(async () => {
      fireEvent.change(tl, { target: { value: '5' } })
    })
    await click(screen.getByRole('button', { name: 'Help on Tag length' }))
    const entry = document.getElementById('param-tag_length') as HTMLDetailsElement
    expect(entry.open).toBe(true)
    expect(document.activeElement).toBe(entry.querySelector('summary'))
    expect(screen.getByRole('navigation', { name: 'Help pages' }).querySelector('[aria-current="page"]')?.textContent).toBe(
      'Settings reference'
    )
    // A page picked by hand starts at its top, with focus on its heading.
    await click(screen.getByRole('button', { name: 'Glossary' }))
    expect(document.activeElement?.id).toBe('help-page-h')
    expect(document.activeElement?.textContent).toBe('Glossary')
    await click(screen.getByRole('button', { name: 'Close Help' }))
    expect((screen.getByLabelText('Tag length tag_length') as HTMLInputElement).value).toBe('5')
  })

  it('scrolls smoothly, unless the system asks for reduced motion', async () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    for (const reduce of [false, true]) {
      // jsdom has no matchMedia.
      window.matchMedia = vi.fn(() => ({ matches: reduce }) as MediaQueryList)
      resetHelp()
      const { unmount } = render(<HelpView />)
      await act(async () => openHelp('tags-gapped'))
      expect(scroll).toHaveBeenLastCalledWith({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
      unmount()
    }
    // @ts-expect-error -- restore jsdom's absence of both
    delete window.matchMedia
    // @ts-expect-error -- see above
    delete Element.prototype.scrollIntoView
  })

  it('a digest no-call links to its troubleshooting entry', async () => {
    installMockBridge()
    render(
      <>
        <DigestPanel reports={[parseReport(nocallTsv, '/r/a.digest.tsv')]} errors={[]} onOpen={() => {}} />
        <HelpView />
      </>
    )
    await click(screen.getByRole('button', { name: /What this no-call means/ }))
    const entry = document.getElementById('faq-digest-low_resolution') as HTMLDetailsElement
    expect(entry.open).toBe(true)
    expect(entry.querySelector('summary')?.textContent).toMatch(/the fragment tolerance is in Da/)
  })
})
