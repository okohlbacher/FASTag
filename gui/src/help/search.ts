// Search over Help (GUI-DESIGN 3 S10): the pages (content.tsx), the
// troubleshooting entries (faq.tsx), the glossary and the settings
// reference, as one plain-text index built once from the same data the
// pages render. A hit is a link target: openHelp(hit.id) shows it.

import { isValidElement, type ReactNode } from 'react'
import { GLOSSARY, PAGES, SETTINGS_INTRO } from './content'
import { FAQ } from './faq'
import { PARAM_BY_NAME, PARAM_UI, defaultText, humanName, uiOf, type ParamSpec } from '../paramLayout'

// Use the same restrictions and overlays as validation in the settings form.
export function parameterLimits(spec: ParamSpec): string {
  const ui = uiOf(spec.name)
  const parts: string[] = []
  if (spec.type === 'int' || spec.itemType === 'int') parts.push(spec.itemType ? 'Whole numbers, one per line' : 'Whole number')
  if (ui.positive && !(spec.min !== undefined && spec.min > 0)) parts.push('greater than 0')
  else if (spec.min !== undefined) parts.push(`minimum ${spec.min}`)
  if (spec.max !== undefined) parts.push(`${ui.belowMax ? 'below' : 'maximum'} ${spec.max}`)
  if (spec.choices?.length) parts.push(`Choices: ${spec.choices.join(', ')}`)
  if (spec.formats?.length) parts.push(`File formats: ${spec.formats.join(', ')}`)
  return parts.length ? `${parts.join('; ')}.` : ''
}

/// The text of a JSX tree: strings and numbers, and the children of every
/// element (a component's own output is not rendered).
export function textOf(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (isValidElement(node)) {
    const text = textOf((node.props as { children?: ReactNode }).children)
    return typeof node.type === 'string' && /^(p|li|dt|dd|tr|td|th|h[1-6]|br)$/.test(node.type) ? `${text} ` : text
  }
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
    docs.push({ id: p.id, title: p.title, where: 'Help', text: clean(textOf(p.lead) + (p.id === 'settings' ? ` ${textOf(SETTINGS_INTRO)}` : '')) })
    for (const s of p.sections) docs.push({ id: s.id, title: s.title, where: p.title, text: clean(textOf(s.body)) })
  }
  for (const f of FAQ) {
    const text = [textOf(f.symptoms), ...f.causes.map(textOf), ...f.fixes.map(textOf)].join(' ')
    docs.push({ id: f.id, title: f.question, where: `Troubleshooting · ${f.group}`, text: clean(text) })
  }
  for (const g of GLOSSARY) docs.push({ id: g.id, title: g.term, where: 'Glossary', text: clean(textOf(g.text)) })
  for (const [name, { help: h, hidden }] of Object.entries(PARAM_UI)) {
    const spec = PARAM_BY_NAME.get(name)
    if (!h || !spec) continue
    docs.push({
      id: `param-${name}`,
      title: humanName(name),
      where: 'Settings reference',
      text: clean(`-${name} ${h.text} ${h.tip ?? ''} ${hidden ? `Not in the settings form: ${hidden}.` : ''} Default: ${defaultText(spec)}. ${parameterLimits(spec)} ${spec.description}`)
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
/// starts with it, more. An exact CLI parameter name always comes first.
export function searchHelp(query: string, limit = 20): HelpHit[] {
  const q = query.toLowerCase().trim()
  const words = q.split(/\s+/).filter(Boolean)
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
    if (title === q) score += 40
    else if (title.startsWith(q)) score += 20
    if (d.id === `param-${q.replace(/^-/, '')}`) score += 100
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
