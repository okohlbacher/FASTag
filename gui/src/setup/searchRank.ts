// Parameter search (GUI-DESIGN 3 S1, P0b): Cmd+K or "/" finds a parameter of
// the form by its name in words, its CLI flag or its help text. Choosing a
// result opens its section and focuses its field (App.tsx).

import { humanName, PARAM_BY_NAME, RENDERED, SECTIONS, UNIT_PARAMS } from '../paramLayout'

export interface ParamHit {
  name: string
  // The section that holds it (opened on choose).
  section: string
  // What matched, for the result line: the words, the flag or the help.
  where: 'name' | 'flag' | 'help'
  score: number
}

const norm = (s: string): string => s.toLowerCase().replace(/[_\-]+/g, ' ').trim()

/// Score one text against the query's words: every word must occur; a word
/// at the start of the text or of a word in it counts more than one inside.
function scoreText(text: string, words: string[]): number {
  const t = norm(text)
  let total = 0
  for (const w of words) {
    const i = t.indexOf(w)
    if (i < 0) return 0
    total += i === 0 ? 3 : t[i - 1] === ' ' ? 2 : 1
  }
  // A whole-text match beats a partial one ("tag length" for tag_length).
  if (t === words.join(' ')) total += 4
  return total
}

const SECTION_OF: Map<string, string> = new Map(SECTIONS.flatMap((s) => s.params.map((p) => [p, s.title] as [string, string])))

/// The parameters of the form that match @p query, best first. Name and flag
/// matches rank above help-text matches; ties keep the form's order.
export function searchParams(query: string, limit = 20): ParamHit[] {
  const words = norm(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  const hits: ParamHit[] = []
  RENDERED.forEach((name, order) => {
    const spec = PARAM_BY_NAME.get(name)
    if (!spec) return
    const byFlag = scoreText(name, words)
    const byName = scoreText(humanName(name), words)
    const byHelp = scoreText(spec.description, words)
    let where: ParamHit['where']
    let score: number
    if (byFlag || byName) {
      where = byFlag >= byName ? 'flag' : 'name'
      score = 100 + Math.max(byFlag, byName) * 10
    } else if (byHelp) {
      where = 'help'
      score = byHelp
    } else return
    // A unit is found with its value (fragment_tolerance before its unit).
    if (UNIT_PARAMS.has(name)) score -= 5
    hits.push({ name, section: SECTION_OF.get(name) ?? '', where, score: score - order / 1000 })
  })
  hits.sort((a, b) => b.score - a.score)
  return hits.slice(0, limit)
}
