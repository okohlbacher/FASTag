// Search over Help (GUI-DESIGN 3 S10): the pages (content.tsx), the
// troubleshooting entries (faq.tsx), the glossary and the settings
// reference, as one plain-text index built once from the same data the
// pages render. A hit is a link target: openHelp(hit.id) shows it.

import { isValidElement, type ReactNode } from 'react'
import { GLOSSARY, PAGES } from './content'
import { FAQ } from './faq'
import { PARAM_HELP } from './params'
import { PARAM_BY_NAME, humanName } from '../paramLayout'

/// The text of a JSX tree: strings and numbers, and the children of every
/// element (a component's own output is not rendered).
export function textOf(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children)
  return ''
}

export interface HelpDoc {
  id: string
  title: string
  /// Where it is: the page, or "Troubleshooting · group".
  where: string
  text: string
}

const clean = (s: string): string => s.replace(/\s+/g, ' ').trim()

export const HELP_INDEX: HelpDoc[] = (() => {
  const docs: HelpDoc[] = []
  for (const p of PAGES) {
    for (const s of p.sections) docs.push({ id: s.id, title: s.title, where: p.title, text: clean(textOf(s.body)) })
  }
  for (const f of FAQ) {
    const text = [textOf(f.symptoms), ...f.causes.map(textOf), ...f.fixes.map(textOf)].join(' ')
    docs.push({ id: f.id, title: f.question, where: `Troubleshooting · ${f.group}`, text: clean(text) })
  }
  for (const g of GLOSSARY) docs.push({ id: g.id, title: g.term, where: 'Glossary', text: clean(textOf(g.text)) })
  for (const [name, h] of Object.entries(PARAM_HELP)) {
    if (!PARAM_BY_NAME.has(name)) continue
    docs.push({
      id: `param-${name}`,
      title: humanName(name),
      where: 'Settings reference',
      text: clean(`-${name} ${h.text} ${h.tip ?? ''}`)
    })
  }
  return docs
})()

export interface HelpHit {
  id: string
  title: string
  where: string
  snippet: string
}

const SNIPPET = 150

function snippet(text: string, word: string): string {
  const at = text.toLowerCase().indexOf(word)
  if (text.length <= SNIPPET) return text
  const from = Math.max(0, at < 0 ? 0 : at - 40)
  const cut = text.slice(from, from + SNIPPET)
  return `${from > 0 ? '…' : ''}${cut}${from + SNIPPET < text.length ? '…' : ''}`
}

/// The docs that hold every word of @p query, best first: a word in the
/// title counts ten times one in the text; a title that is the query, or
/// starts with it, more.
export function searchHelp(query: string, limit = 20): HelpHit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  const scored: { d: HelpDoc; score: number; i: number }[] = []
  HELP_INDEX.forEach((d, i) => {
    const title = d.title.toLowerCase()
    const text = d.text.toLowerCase()
    let score = 0
    for (const w of words) {
      const inTitle = title.includes(w)
      let n = 0
      for (let at = text.indexOf(w); at >= 0 && n < 20; at = text.indexOf(w, at + w.length)) n++
      if (!inTitle && n === 0) return
      score += (inTitle ? 10 : 0) + n
    }
    const q = query.toLowerCase().trim()
    if (title === q) score += 40
    else if (title.startsWith(q)) score += 20
    scored.push({ d, score, i })
  })
  scored.sort((a, b) => b.score - a.score || a.i - b.i)
  return scored.slice(0, limit).map(({ d }) => ({
    id: d.id,
    title: d.title,
    where: d.where,
    snippet: snippet(d.text, words.find((w) => d.text.toLowerCase().includes(w)) ?? words[0])
  }))
}
