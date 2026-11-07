// Help search (GUI-DESIGN 3 S10): one index over the pages, the FAQ, the
// glossary and the settings reference; every hit is a link target that
// exists, the title outranks the text, all words must match.
import { describe, expect, it } from 'vitest'
import { isValidElement, type ReactNode } from 'react'
import { HELP_INDEX, searchHelp, textOf } from './search'
import { PAGE_OF } from './HelpView'
import { FAQ } from './faq'

describe('help search', () => {
  it('flattens JSX to its text', () => {
    const node: ReactNode = (
      <>
        A <code>-tag_length</code> of {3} and <em>more</em>
      </>
    )
    expect(isValidElement(node)).toBe(true)
    expect(textOf(node).replace(/\s+/g, ' ').trim()).toBe('A -tag_length of 3 and more')
    expect(textOf(null)).toBe('')
  })

  it('indexes every page section, FAQ entry, glossary term and parameter', () => {
    const ids = new Set(HELP_INDEX.map((d) => d.id))
    for (const f of FAQ) expect(ids.has(f.id), f.id).toBe(true)
    expect(ids.has('tags-gapped')).toBe(true)
    expect(ids.has('gloss-e-value')).toBe(true)
    expect(ids.has('param-tag_length')).toBe(true)
    // Every hit opens somewhere.
    for (const d of HELP_INDEX) expect(PAGE_OF.has(d.id), d.id).toBe(true)
    for (const d of HELP_INDEX) expect(d.text.length, d.id).toBeGreaterThan(0)
  })

  it('needs every word, ranks title hits first, and is case-insensitive', () => {
    expect(searchHelp('')).toEqual([])
    expect(searchHelp('   ')).toEqual([])
    const gapped = searchHelp('GAPPED tags')
    expect(gapped.length).toBeGreaterThan(0)
    expect(gapped[0].title.toLowerCase()).toContain('gapped')
    for (const h of gapped) expect(`${h.title} ${HELP_INDEX.find((d) => d.id === h.id)!.text}`.toLowerCase()).toMatch(/gapped[\s\S]*|tags/)
    expect(searchHelp('zzqxv no such word')).toEqual([])
    // A title hit outranks a hit in the text only.
    const ev = searchHelp('e-value')
    expect(ev[0].title.toLowerCase()).toContain('e-value')
  })

  it('finds the troubleshooting entry for a failed run, with a snippet around the word', () => {
    const hits = searchHelp('run failed')
    expect(hits.some((h) => h.id === 'faq-run-failed')).toBe(true)
    const h = searchHelp('mzml index')[0]
    expect(h).toBeDefined()
    expect(h.snippet.toLowerCase()).toMatch(/mzml|index/)
    expect(h.snippet.length).toBeLessThanOrEqual(160)
    expect(h.where).toBeTruthy()
  })

  it('a title that is the query comes before one that only starts with it', () => {
    const ids = searchHelp('fragment tolerance').map((h) => h.id)
    expect(ids.indexOf('param-fragment_tolerance')).toBeLessThan(ids.indexOf('param-fragment_tolerance_unit'))
  })

  it('returns at most the limit', () => {
    expect(searchHelp('the', 5)).toHaveLength(5)
  })
})
