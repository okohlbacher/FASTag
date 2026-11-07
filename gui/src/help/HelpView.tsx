import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { DEPENDS, HIDDEN, PARAM_BY_NAME, SECTIONS, defaultText, humanName, masters } from '../paramLayout'
import { GLOSSARY, PAGES, SETTINGS_INTRO, type HelpPage } from './content'
import { FAQ, FAQ_BY_ID, FAQ_GROUPS } from './faq'
import { HelpLink } from './HelpLink'
import { PARAM_HELP } from './params'
import { closeHelp, helpBack, openHelp, rememberHelpPage, showHelpPage, useHelp } from './link'
import { searchHelp } from './search'

export const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

// Where each settings group points for the idea behind it.
const SECTION_TOPIC: Record<string, [string, string]> = {
  Spectra: ['files-inputs', 'Input files'],
  Tagging: ['tags-tag', 'Tags and gapped tags'],
  'Sequence matching': ['results-fasta', 'Matching a sequence database'],
  'Species detection': ['species-howto', 'How species detection works'],
  'Digest and labels': ['digest-ends', 'The Digest tab'],
  Reconciliation: ['digest-gaps', 'Mass gaps'],
  Modifications: ['tags-mods', 'Modifications'],
  Glycopeptides: ['files-glyco', 'The glyco report'],
  Output: ['files-outputs', 'Output files']
}

/// Every link target, with the page it is on.
export const PAGE_OF: Map<string, string> = (() => {
  const m = new Map<string, string>()
  for (const p of PAGES) {
    m.set(p.id, p.id)
    for (const s of p.sections) m.set(s.id, p.id)
  }
  for (const f of FAQ) m.set(f.id, 'troubleshooting')
  for (const g of FAQ_GROUPS) m.set(`faq-group-${slug(g)}`, 'troubleshooting')
  for (const g of GLOSSARY) m.set(g.id, 'glossary')
  for (const s of SECTIONS) m.set(`param-sec-${slug(s.title)}`, 'settings')
  m.set('param-sec-hidden', 'settings')
  for (const n of Object.keys(PARAM_HELP)) m.set(`param-${n}`, 'settings')
  return m
})()

const reducedMotion = (): boolean =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/// Show the element @p id: open it if it is a <details>, scroll to it, and
/// move focus there, so a keyboard or screen-reader user lands where a
/// sighted one looks.
export function reveal(id: string): void {
  // A page id has no element of its own: its heading stands for it.
  const el = document.getElementById(id) ?? document.getElementById('help-page-h')
  if (!el) return
  if (el instanceof HTMLDetailsElement) el.open = true
  el.scrollIntoView?.({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' })
  const target =
    el instanceof HTMLDetailsElement
      ? el.querySelector('summary')
      : el.matches('h2, h3, dt')
        ? el
        : el.querySelector<HTMLElement>('h2, h3')
  const f = (target ?? el) as HTMLElement
  if (!f.matches('summary, button, a, input, select, textarea')) f.tabIndex = -1
  f.focus({ preventScroll: true })
}

function ParamEntry({ name }: { name: string }): JSX.Element | null {
  const spec = PARAM_BY_NAME.get(name)
  const h = PARAM_HELP[name]
  if (!spec || !h) return null
  const needs = DEPENDS[name] ?? []
  return (
    <details id={`param-${name}`} className="help-entry">
      <summary>
        <span className="pname">{humanName(name)}</span> <code className="cli">{name}</code>
      </summary>
      <p>{h.text}</p>
      {h.tip && <p className="tip">{h.tip}</p>}
      <p className="meta">
        Default: {defaultText(spec)}
        {needs.map((d) => (
          <span key={masters(d).join()}>
            {' · '}
            {d.replaced ? 'Replaced by ' : 'Needs '}
            {masters(d).map((m, i) => (
              <span key={m}>
                {i > 0 && ' or '}
                <HelpLink to={`param-${m}`}>{humanName(m)}</HelpLink>
              </span>
            ))}
          </span>
        ))}
      </p>
      {spec.description && (
        <details className="cli-desc">
          <summary>Command-line description</summary>
          {spec.description}
        </details>
      )}
    </details>
  )
}

function Settings(): JSX.Element {
  return (
    <>
      <section aria-labelledby="settings-first-h">
        <h3 id="settings-first-h">What to set first</h3>
        {SETTINGS_INTRO}
        <nav aria-label="Settings groups">
          <ul className="help-quick">
            {SECTIONS.map((sec) => (
              <li key={sec.title}>
                <HelpLink to={`param-sec-${slug(sec.title)}`}>{sec.title}</HelpLink>
              </li>
            ))}
            <li>
              <HelpLink to="param-sec-hidden">Not in the form</HelpLink>
            </li>
          </ul>
        </nav>
      </section>
      {SECTIONS.map((sec) => {
        const id = `param-sec-${slug(sec.title)}`
        const topic = SECTION_TOPIC[sec.title]
        return (
          <section key={sec.title} id={id} aria-labelledby={`${id}-h`}>
            <h3 id={`${id}-h`}>{sec.title}</h3>
            {(sec.blurb || topic) && (
              <p className="help-blurb">
                {sec.blurb}
                {topic && (
                  <>
                    {' '}
                    More: <HelpLink to={topic[0]}>{topic[1]}</HelpLink>.
                  </>
                )}
              </p>
            )}
            {sec.params.map((n) => (
              <ParamEntry key={n} name={n} />
            ))}
          </section>
        )
      })}
      <section id="param-sec-hidden" aria-labelledby="param-sec-hidden-h">
        <h3 id="param-sec-hidden-h">Not in the form</h3>
        <p className="help-blurb">FASTag options the app sets itself, or that have no use in the app.</p>
        {Object.keys(HIDDEN).map((n) => (
          <ParamEntry key={n} name={n} />
        ))}
      </section>
    </>
  )
}

// The problems readers meet most, linked above the groups.
export const COMMON = ['faq-no-tags', 'faq-run-failed', 'faq-run-disabled']

function Troubleshooting(): JSX.Element {
  return (
    <>
      <nav aria-label="Troubleshooting shortcuts">
        <h3 className="sub-h">Most common</h3>
        <ul className="help-quick">
          {COMMON.map((id) => (
            <li key={id}>
              <HelpLink to={id}>{FAQ_BY_ID.get(id)!.question}</HelpLink>
            </li>
          ))}
        </ul>
        <h3 className="sub-h">Groups</h3>
        <ul className="help-quick">
          {FAQ_GROUPS.map((g) => (
            <li key={g}>
              <HelpLink to={`faq-group-${slug(g)}`}>{g}</HelpLink>
            </li>
          ))}
        </ul>
      </nav>
      {FAQ_GROUPS.map((g) => (
        <section key={g} id={`faq-group-${slug(g)}`} aria-labelledby={`faq-group-${slug(g)}-h`}>
          <h3 id={`faq-group-${slug(g)}-h`}>{g}</h3>
          {FAQ.filter((f) => f.group === g).map((f) => (
            <details key={f.id} id={f.id} className="help-entry">
              <summary>{f.question}</summary>
              <p>
                <strong>What you see:</strong> {f.symptoms}
              </p>
              <h4 className="sub-h">Possible causes, the usual ones first</h4>
              <ol>
                {f.causes.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ol>
              <h4 className="sub-h">What to do</h4>
              <ul>
                {f.fixes.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </details>
          ))}
        </section>
      ))}
    </>
  )
}

function Glossary(): JSX.Element {
  return (
    <dl className="glossary">
      {GLOSSARY.map((g) => (
        <div key={g.id}>
          <dt id={g.id}>{g.term}</dt>
          <dd>{g.text}</dd>
        </div>
      ))}
    </dl>
  )
}

function PageBody({ page }: { page: HelpPage }): JSX.Element {
  if (page.id === 'settings') return <Settings />
  if (page.id === 'troubleshooting') return <Troubleshooting />
  if (page.id === 'glossary') return <Glossary />
  return (
    <>
      {page.sections.map((s) => (
        <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`}>
          <h3 id={`${s.id}-h`}>{s.title}</h3>
          {s.body}
        </section>
      ))}
    </>
  )
}

/// Search over every page, the FAQ, the glossary and the settings
/// (search.ts); a hit opens its entry and clears the box.
function HelpSearch(): JSX.Element {
  const [q, setQ] = useState('')
  const hits = useMemo(() => searchHelp(q), [q])
  return (
    <div className="help-search" role="search">
      <input
        type="search"
        aria-label="Search Help"
        placeholder="Search Help"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && q) {
            e.stopPropagation()
            setQ('')
          } else if (e.key === 'Enter' && hits[0]) {
            openHelp(hits[0].id)
            setQ('')
          }
        }}
      />
      {q.trim() !== '' &&
        (hits.length ? (
          <ul className="help-hits" aria-label="Search results">
            {hits.map((h) => (
              <li key={h.id}>
                <button
                  type="button"
                  onClick={() => {
                    openHelp(h.id)
                    setQ('')
                  }}
                >
                  <span className="hit-title">{h.title}</span>
                  <span className="hit-where">{h.where}</span>
                  <span className="hit-snippet">{h.snippet}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="hint">Nothing in Help matches “{q.trim()}”.</p>
        ))}
    </div>
  )
}

/// The Help panel (GUI-DESIGN 3 S10, a side panel beside any view from P2a):
/// search and the page list above, the page below.
export default function HelpView(): JSX.Element {
  const { page, target, back } = useHelp()
  const shown = (target && PAGE_OF.get(target.id)) || page
  const current = PAGES.find((p) => p.id === shown) ?? PAGES[0]
  const mainRef = useRef<HTMLElement>(null)

  useEffect(() => rememberHelpPage(current.id), [current.id])

  // A section asked for: show it. A page picked by hand: start at its top.
  useEffect(() => {
    if (target) reveal(target.id)
    else {
      if (mainRef.current) mainRef.current.scrollTop = 0
      const h = document.getElementById('help-page-h')
      if (h) {
        h.tabIndex = -1
        h.focus({ preventScroll: true })
      }
    }
  }, [target, current.id])

  return (
    <div className="helpview">
      <div className="help-head">
        <HelpSearch />
        <button type="button" className="secondary small" onClick={() => closeHelp()}>
          Close Help
        </button>
      </div>
      <nav className="help-nav" aria-label="Help pages">
        <ul>
          {PAGES.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="help-page-btn"
                aria-current={p.id === current.id ? 'page' : undefined}
                onClick={() => showHelpPage(p.id)}
              >
                {p.title}
              </button>
            </li>
          ))}
        </ul>
        {back && (
          <button type="button" className="link help-back" onClick={helpBack}>
            <span aria-hidden="true">←</span> Back to {PAGES.find((p) => p.id === back.page)?.title ?? 'the last page'}
          </button>
        )}
        <p className="hint">F1 opens Help; Esc closes it.</p>
      </nav>
      <main className="help-main" ref={mainRef} aria-labelledby="help-page-h">
        <article className="help-page">
          <h2 id="help-page-h">{current.title}</h2>
          <p className="lead">{current.lead}</p>
          <PageBody page={current} />
        </article>
      </main>
    </div>
  )
}
