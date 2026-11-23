// The merge graph of one spectrum, laid out around one resolved tag, the
// anchor (the one chosen in the table; choosing another re-anchors).
//
// The x axis is residue positions along the anchor read N to C (a gap step
// is two residues wide), not m/z: a ruler with the anchor's residues and
// its termini (terminus.ts) runs above its row, and the tags that build it
// hang under the ruler as a staircase of thin bars, each over exactly its
// residues, joined by bold arcs. Around it:
// - above: the resolved tags that fork from it (share a peak and continue
//   otherwise), aligned to the peaks they share;
// - below the staircase: the tags inside it, then the resolved tags that only
//   touch it, aligned the same way;
// - then the resolved tags that share nothing with it, one row each in rank
//   order, N to C on their own residues, left-aligned;
// - tags in no resolved tag only behind "Show N unused tags".
// A resolved tag that reads the anchor's residues again (the other series of
// its pair on the complement peaks, or the same residues in another layer:
// isComplement, sameAs) is not drawn again: the anchor gets a b+y badge.
//
// The bars that select a resolved tag are one tab stop (roving tabindex):
// the arrows move along a lane (left, right) and between lanes (up, down);
// Enter or a click chooses it, which re-anchors.

import { useMemo, useRef, useState, type JSX, type KeyboardEvent } from 'react'
import type { SpectrumPeaks } from './dump'
import { layerOf, sequenceOf, stepLabel, type GPath, type Placement, type Step, type TagGraph } from './graph'
import { isComplement, seriesText, type Ladder, type SeriesCall } from './ladder'
import { W } from './plotScale'
import { endWords, NO_TERMINUS, termText, type Terminus } from './terminus'

// Left gutter (rank and band labels, the N marker), right margin (the C marker, the badge).
const GL = 76
const GR = 76
// The widest residue (user units).
const MAX_UNIT = 34
// About the width of a label character (11px mono in a 1000-unit box).
const CHAR = 6.7
const GAP = 8
const RULER_H = 22
const STAIR_H = 9
const LANE_H = 16
const ROW_H = 15
const BAR = 5

const pairOf = (s: Ladder['series']): string => (s === 'b' || s === 'y' ? 'by' : 'cz')
const nTerminal = (s: Ladder['series']): boolean => s === 'b' || s === 'c'
const width = (st: Step): number => (st.readings[0]?.gap ? 2 : 1)

/** How a placement reads: as its resolved tag reads the same peaks, else as judged on its own. */
function readingOf(pl: Placement, path: { series: Ladder['series']; call: SeriesCall; charge: number } | undefined): { series: Ladder['series']; call: SeriesCall; own: boolean } {
  if (path && path.charge === pl.charge && pairOf(path.series) === pairOf(pl.series)) return { series: path.series, call: path.call, own: path.series === pl.series }
  return { series: pl.series, call: pl.call, own: true }
}

// The colour of a rank: the first three apart, the rest alike (the rank is written on the bar).
const rankCls = (path: number): string => `r${Math.min(path + 1, 4)}`

type Kind = 'chain' | 'inside' | 'fork' | 'touch' | 'other' | 'unused'
interface Bar {
  key: string
  kind: Kind
  // The resolved tag it selects (null: unused).
  path: number | null
  // The placement, for a tag (chain, inside, unused); null for a resolved tag.
  node: number | null
  // In user units.
  x1: number
  x2: number
  y: number
  label: string
  title: string
  aria: string
}

export function MergeGraph({
  graph: g,
  spectrum: s,
  chosen,
  onChoose,
  termini
}: {
  graph: TagGraph
  spectrum: SpectrumPeaks
  chosen: number
  onChoose(path: number): void
  // Per resolved tag, where it lies against the termini (none: not shown).
  termini?: Terminus[]
}): JSX.Element {
  const [unused, setUnused] = useState(false)
  const at = g.paths[chosen] ? chosen : 0
  const terms = useMemo(() => termini ?? [], [termini])
  const layout = useMemo(() => lay(g, s, at, terms, unused), [g, s, at, terms, unused])
  const [focus, setFocus] = useState<{ g: TagGraph; at: number; key: string } | null>(null)
  const refs = useRef(new Map<string, SVGGElement>())

  if (!layout)
    return (
      <div className="sp-graph" data-testid="merge-graph">
        <p className="hint" data-testid="merge-graph-empty">
          No resolved tags for this spectrum.
        </p>
      </div>
    )
  const { bars, arcs, ruler, height, dups, nUnused, A } = layout
  const live = bars.filter((b) => b.path != null)
  // The tab stop: the bar of this anchor focused last, else the anchor's first (N-terminal) tag.
  const stop = (focus?.g === g && focus.at === at && live.some((b) => b.key === focus.key) ? focus.key : undefined) ?? live.find((b) => b.kind === 'chain')?.key ?? live[0]?.key

  // The nearest bar that selects along the lane (left, right) or in the nearest lane above or below.
  function move(from: Bar, key: string): Bar | null {
    const dir = key === 'ArrowRight' || key === 'ArrowDown' ? 1 : -1
    const lane = key === 'ArrowLeft' || key === 'ArrowRight'
    const next = live
      .filter((n) => n !== from && (lane ? n.y === from.y && dir * (n.x1 - from.x1) > 0 : dir * (n.y - from.y) > 0))
      .sort((a, b) => Math.abs(a.y - from.y) - Math.abs(b.y - from.y) || Math.abs(a.x1 - from.x1) - Math.abs(b.x1 - from.x1))
    return next[0] ?? null
  }
  function key(e: KeyboardEvent<SVGGElement>, b: Bar): void {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      return onChoose(b.path as number)
    }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return
    e.preventDefault()
    const to = move(b, e.key)
    // Its onFocus makes it the tab stop.
    if (to) refs.current.get(to.key)?.focus()
  }

  const t = terms[at] ?? NO_TERMINUS
  const tt = termText(t)
  const pair = pairOf(A.series) === 'by' ? 'b+y' : 'c+z'
  const badgeX = ruler.x1 + 8 + tt.post.length * CHAR
  return (
    <div className="sp-graph" data-testid="merge-graph">
      <svg
        viewBox={`0 0 ${W} ${height}`}
        className="sp-graph-svg"
        role="group"
        aria-label={`Merge graph around resolved tag ${at + 1}, ${sequenceOf(A)}: ${A.chain.length} tag${A.chain.length === 1 ? ' builds' : 's build'} it, ${A.inside.length} inside it, ${layout.related} resolved tags share peaks with it, ${layout.others} share none${dups.length ? `, ${dups.length} read it again` : ''}${nUnused ? `; ${nUnused} unused tags${unused ? '' : ' hidden'}` : ''}`}
      >
        {/* The ruler: the anchor's residues N to C, its termini, its rank. */}
        <g className="sp-graph-ruler" data-testid="merge-graph-ruler" data-sequence={ruler.cells.map((c) => c.label).join('')}>
          <text x={4} y={ruler.y + 15} className={`sp-graph-rank ${rankCls(at)}`}>
            #{at + 1}
          </text>
          <line x1={ruler.x0} x2={ruler.x1} y1={ruler.y + RULER_H - 1} y2={ruler.y + RULER_H - 1} className="sp-axis" />
          {ruler.cells.map((c, k) => (
            <g key={k}>
              <line x1={c.x1} x2={c.x1} y1={ruler.y + RULER_H - 5} y2={ruler.y + RULER_H - 1} className="sp-ruler-tick" />
              <text x={(c.x1 + c.x2) / 2} y={ruler.y + 15} textAnchor="middle" className={`sp-graph-res${c.gap ? ' gap' : ''}`} data-res={c.label}>
                {c.label}
              </text>
            </g>
          ))}
          <line x1={ruler.x1} x2={ruler.x1} y1={ruler.y + RULER_H - 5} y2={ruler.y + RULER_H - 1} className="sp-ruler-tick" />
          {tt.pre && (
            <text x={ruler.x0 - 4} y={ruler.y + 15} textAnchor="end" className={`sp-graph-term${t.n === 'at' ? '' : ' away'}`} data-term="N" aria-label={endWords('N', t.n) ?? undefined}>
              <title>{endWords('N', t.n)}</title>
              {tt.pre}
            </text>
          )}
          {tt.post && (
            <text x={ruler.x1 + 4} y={ruler.y + 15} className={`sp-graph-term${t.c === 'at' ? '' : ' away'}`} data-term="C" aria-label={endWords('C', t.c) ?? undefined}>
              <title>{endWords('C', t.c)}</title>
              {tt.post}
            </text>
          )}
          {dups.length > 0 && (
            <g className="sp-graph-dup" data-testid="merge-graph-dup" role="img" aria-label={`${pair}: read again by ${dups.map((d) => `#${d.path + 1}`).join(', ')}, not drawn again`}>
              <title>{`The same residues read again, not drawn: ${dups.map((d) => `#${d.path + 1} ${d.seq} (${d.why})`).join('; ')}`}</title>
              <rect x={badgeX} y={ruler.y + 3} width={3 * CHAR + 10} height={15} rx={7} />
              <text x={badgeX + 5} y={ruler.y + 14}>
                {pair}
              </text>
            </g>
          )}
        </g>
        {layout.bands.map((b) => (
          <text key={b.label} x={4} y={b.y + 9} className="sp-graph-band-label">
            {b.label}
          </text>
        ))}
        {/* The joins of the anchor: where the next tag (N to C) starts on the one before. */}
        {arcs.map((a) => (
          <path key={a.key} d={a.d} className={`sp-graph-arc on ${rankCls(at)}${a.touch ? ' touch' : ''}`} data-arc="used" />
        ))}
        {bars.map((b) => {
          const sel = b.path === at
          const cls = `sp-graph-node ${b.kind}${b.path != null ? ` ${rankCls(b.path)}` : ' none'}${sel ? ' sel' : ''}`
          const h = b.kind === 'chain' || b.kind === 'inside' ? BAR : BAR + 1
          return (
            <g
              key={b.key}
              ref={(el) => {
                if (el) refs.current.set(b.key, el)
                else refs.current.delete(b.key)
              }}
              className={cls}
              data-node={b.node ?? undefined}
              data-path={b.node == null && b.path != null ? b.path : undefined}
              data-band={b.kind}
              // A tag in no resolved tag selects nothing: not a tab stop, an image with its label.
              tabIndex={b.path != null ? (b.key === stop ? 0 : -1) : undefined}
              role={b.path != null ? 'button' : 'img'}
              aria-label={b.aria}
              aria-pressed={b.path != null ? sel : undefined}
              onClick={b.path != null ? () => onChoose(b.path as number) : undefined}
              onFocus={b.path != null ? () => setFocus({ g, at, key: b.key }) : undefined}
              onKeyDown={b.path != null ? (e) => key(e, b) : undefined}
            >
              <title>{b.title}</title>
              {/* What a pointer hits: the bar and its label. */}
              <rect x={b.x1 - 2} y={b.y - 3} width={b.x2 - b.x1 + 4 + (b.label ? b.label.length * CHAR + 6 : 0)} height={h + 6} className="sp-graph-hit" />
              <rect x={b.x1} y={b.y} width={Math.max(2, b.x2 - b.x1)} height={h} rx={1.5} className="sp-graph-bar" />
              {b.label && (
                <text x={b.x2 + 4} y={b.y + h + 1} className="sp-graph-label">
                  {b.label}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      <p className="hint sp-legend">
        {nUnused > 0 && (
          <>
            <button type="button" className="link" data-testid="merge-graph-unused" aria-pressed={unused} onClick={() => setUnused(!unused)}>
              {`${unused ? 'Hide' : 'Show'} ${nUnused} unused tag${nUnused === 1 ? '' : 's'}`}
            </button>
            {' · '}
          </>
        )}
        #{at + 1} N→C by residue: its tags under the ruler, bold joins · above: conflicting · below: inside, touching, the rest · {pair}: read again, not drawn · choose one to re-anchor
      </p>
    </div>
  )
}

interface Layout {
  A: GPath
  bars: Bar[]
  arcs: { key: string; d: string; touch: boolean }[]
  ruler: { y: number; x0: number; x1: number; cells: { x1: number; x2: number; label: string; gap: boolean }[] }
  bands: { label: string; y: number }[]
  dups: { path: number; seq: string; why: string }[]
  related: number
  others: number
  nUnused: number
  height: number
}

/** Lanes for spans [x1, x2], packed first fit so none overlap (@p gap apart). */
function pack(items: { x1: number; x2: number }[], gap: number): number[] {
  const ends: number[] = []
  return items.map((it) => {
    let lane = ends.findIndex((e) => e + gap <= it.x1)
    if (lane < 0) lane = ends.push(0) - 1
    ends[lane] = it.x2
    return lane
  })
}

function lay(g: TagGraph, s: SpectrumPeaks, at: number, termini: Terminus[], showUnused: boolean): Layout | null {
  const A = g.paths[at]
  if (!A) return null
  const nc = nTerminal(A.series)
  const z = A.charge
  // The anchor's residue positions: cum[j] before its peak j (m/z order); N to C as pos.
  const cum = [0]
  for (const st of A.steps) cum.push(cum[cum.length - 1] + width(st))
  const T = cum[cum.length - 1]
  const at0 = new Map(A.peaks.map((p, j) => [p, j]))
  /** The residue span (N to C) of a chain of peaks of the anchor's layer, aligned at its first peak on the anchor. */
  const aligned = (peaks: number[], steps: Step[]): [number, number] | null => {
    const k = peaks.findIndex((p) => at0.has(p))
    if (k < 0) return null
    const own = [0]
    for (const st of steps) own.push(own[own.length - 1] + width(st))
    const j = at0.get(peaks[k]) as number
    const ps = own.map((c) => cum[j] + (c - own[k])).map((u) => (nc ? u : T - u))
    return [Math.min(...ps), Math.max(...ps)]
  }
  const owner = g.placements.map((): number | null => null)
  g.paths.forEach((p, k) => {
    for (const i of [...p.chain, ...p.inside]) owner[i] = k
  })
  const anchorPl = [...A.chain, ...A.inside]
  // Read again: the same residues in another layer or series (sameAs), or
  // every tag of it on the complement peaks of the anchor's tags.
  const onComplement = (peaks: number[], charge: number): boolean =>
    charge === z && anchorPl.some((i) => isComplement(g.placements[i].peaks, peaks, z, s) || isComplement(peaks, g.placements[i].peaks, z, s))
  const dups: Layout['dups'] = []
  const dupPath = new Set<number>()
  g.paths.forEach((p, k) => {
    if (k === at) return
    // Every step the same, not one shared reading.
    const same = A.sameAs.some((x) => x.path === k && x.steps >= p.steps.length)
    if (!same && !p.chain.every((i) => onComplement(g.placements[i].peaks, p.charge))) return
    dupPath.add(k)
    dups.push({ path: k, seq: sequenceOf(p), why: `${seriesText(p.series, p.call)} ${p.charge}+, ${same ? 'the same residues at the same masses' : 'on the complement peaks'}` })
  })
  const rel = new Map(A.relations.filter((r) => !dupPath.has(r.path)).map((r) => [r.path, r.kind]))
  const others = g.paths.map((_, k) => k).filter((k) => k !== at && !dupPath.has(k) && !rel.has(k))
  const unusedPl = g.placements.map((_, i) => i).filter((i) => owner[i] == null && !onComplement(g.placements[i].peaks, g.placements[i].charge))

  // The domain: the anchor, and what is aligned to it.
  const spans = new Map<number, [number, number]>()
  for (const k of rel.keys()) {
    const sp = aligned(g.paths[k].peaks, g.paths[k].steps)
    if (sp) spans.set(k, sp)
  }
  const uSpans = new Map<number, [number, number] | null>()
  for (const i of showUnused ? unusedPl : []) uSpans.set(i, layerOf(g.placements[i]) === layerOf(A) ? aligned(g.placements[i].peaks, g.placements[i].steps) : null)
  let lo = 0
  let hi = T
  for (const sp of [...spans.values(), ...uSpans.values()]) {
    if (!sp) continue
    lo = Math.min(lo, sp[0])
    hi = Math.max(hi, sp[1])
  }
  const unit = Math.min(MAX_UNIT, (W - GL - GR) / Math.max(1, hi - lo))
  const X = (u: number): number => GL + (u - lo) * unit
  const lenOf = (p: { steps: Step[] }): number => p.steps.reduce((a, st) => a + width(st), 0)
  const listUnit = Math.min(unit, (W - GL - GR) / Math.max(1, ...others.map((k) => lenOf(g.paths[k]))))

  const bars: Bar[] = []
  const bands: Layout['bands'] = []
  const seqOf = (k: number): string => {
    const tt = termText(termini[k] ?? NO_TERMINUS)
    return `${tt.pre}${sequenceOf(g.paths[k])}${tt.post}`
  }
  const pathTitle = (k: number, how: string): string => {
    const p = g.paths[k]
    const w = termText(termini[k] ?? NO_TERMINUS).words
    return `#${k + 1} ${sequenceOf(p)} (${seriesText(p.series, p.call)} ${p.charge}+) · E-value best ${p.best ?? 'none'}, weakest ${p.weakest ?? 'none'} · ${p.chain.length} tag${p.chain.length === 1 ? '' : 's'}${p.inside.length ? ` + ${p.inside.length} inside` : ''}${w ? ` · ${w}` : ''} · ${how}`
  }
  const tagOf = (i: number, role: string): { seq: string; title: string } => {
    const pl = g.placements[i]
    const o = owner[i]
    const read = readingOf(pl, o != null ? g.paths[o] : undefined)
    const seq = sequenceOf({ series: read.series, steps: pl.steps })
    const own = read.own ? '' : `; on its own peaks ${seriesText(pl.series, pl.call)}, ${sequenceOf(pl)}`
    return { seq, title: `${seq} (${seriesText(read.series, read.call)} ${pl.charge}+${own}) · E-value ${pl.evalue ?? 'none'} · ${pl.rows.length} tag${pl.rows.length === 1 ? '' : 's'}${pl.tags.length ? `: ${pl.tags.join(', ')}` : ''} · ${role}` }
  }
  // Resolved tags aligned to the anchor, one bar each with its rank and sequence; lane 0 nearest the anchor.
  const pathBars = (ks: number[], kind: 'fork' | 'touch', how: string): Bar[] => {
    const items = ks
      .filter((k) => spans.has(k))
      .map((k) => {
        const [a, b] = spans.get(k) as [number, number]
        const label = `#${k + 1} ${seqOf(k)}`
        return { k, x1: X(a), x2: X(b), label }
      })
    const lanes = pack(items.map((it) => ({ x1: it.x1, x2: it.x2 + 4 + it.label.length * CHAR })), GAP)
    return items.map((it, n) => ({ key: `p${it.k}`, kind, path: it.k, node: null, x1: it.x1, x2: it.x2, y: lanes[n], label: it.label, title: pathTitle(it.k, how), aria: `${sequenceOf(g.paths[it.k])}, resolved tag ${it.k + 1}, ${how}` }))
  }
  let y = 4
  const forks = pathBars([...rel].filter(([, v]) => v === 'fork').map(([k]) => k), 'fork', `conflicts with #${at + 1}`)
  const nFork = forks.length ? Math.max(...forks.map((b) => b.y)) + 1 : 0
  if (forks.length) bands.push({ label: 'conflicts', y: y + 2 })
  for (const b of forks) bars.push({ ...b, y: y + (nFork - 1 - b.y) * LANE_H + 4 })
  y += nFork * LANE_H
  // The ruler, and the anchor's tags under it as a staircase.
  const rulerY = y
  const cells = A.steps
    .map((st, k) => {
      const a = nc ? cum[k] : T - cum[k + 1]
      const b = nc ? cum[k + 1] : T - cum[k]
      return { a, x1: X(a), x2: X(b), label: stepLabel(st), gap: width(st) === 2 }
    })
    .sort((p, q) => p.a - q.a)
  y += RULER_H + 3
  const chain = A.chain.map((i) => ({ i, sp: aligned(g.placements[i].peaks, g.placements[i].steps) as [number, number] })).sort((p, q) => p.sp[0] - q.sp[0] || p.sp[1] - q.sp[1])
  const stair = pack(chain.map((c) => ({ x1: c.sp[0], x2: c.sp[1] })), 0)
  const yOf = new Map<number, number>()
  chain.forEach((c, n) => {
    const yy = y + stair[n] * STAIR_H
    yOf.set(c.i, yy)
    const { seq, title } = tagOf(c.i, `builds resolved tag ${at + 1}`)
    const pl = g.placements[c.i]
    bars.push({ key: `n${c.i}`, kind: 'chain', path: at, node: c.i, x1: X(c.sp[0]), x2: X(c.sp[1]), y: yy, label: '', title, aria: `${seq}, builds resolved tag ${at + 1}${pl.evalue != null ? `, E-value ${pl.evalue}` : ''}` })
  })
  y += (Math.max(0, ...stair) + 1) * STAIR_H + 4
  // The joins: a bold arc from the tag before to where the next one starts.
  const arcs: Layout['arcs'] = []
  for (let n = 1; n < chain.length; n++) {
    const p = chain[n - 1]
    const q = chain[n]
    const a = g.arcs.find((x) => (x.from === p.i && x.to === q.i) || (x.from === q.i && x.to === p.i))
    if (!a) continue
    const x = X(q.sp[0])
    const y1 = (yOf.get(p.i) as number) + BAR / 2
    const y2 = (yOf.get(q.i) as number) + BAR / 2
    arcs.push({ key: `${p.i}>${q.i}`, d: `M ${x - 12} ${y1} C ${x - 3} ${y1}, ${x - 6} ${y2}, ${x} ${y2}`, touch: a.touch })
  }
  // The tags inside it.
  const inside = A.inside.map((i) => ({ i, sp: aligned(g.placements[i].peaks, g.placements[i].steps) as [number, number] })).sort((p, q) => p.sp[0] - q.sp[0] || p.i - q.i)
  if (inside.length) {
    const lanes = pack(inside.map((c) => ({ x1: c.sp[0], x2: c.sp[1] })), 0.5)
    bands.push({ label: 'inside', y: y - 2 })
    inside.forEach((c, n) => {
      const { seq, title } = tagOf(c.i, `inside resolved tag ${at + 1}`)
      bars.push({ key: `n${c.i}`, kind: 'inside', path: at, node: c.i, x1: X(c.sp[0]), x2: X(c.sp[1]), y: y + lanes[n] * STAIR_H, label: '', title, aria: `${seq}, inside resolved tag ${at + 1}` })
    })
    y += (Math.max(...lanes) + 1) * STAIR_H + 4
  }
  // Resolved tags that only touch it.
  const touches = pathBars([...rel].filter(([, v]) => v === 'touch').map(([k]) => k), 'touch', `touches #${at + 1}`)
  if (touches.length) {
    bands.push({ label: 'touches', y: y + 2 })
    for (const b of touches) bars.push({ ...b, y: y + b.y * LANE_H + 4 })
    y += (Math.max(...touches.map((b) => b.y)) + 1) * LANE_H
  }
  // The rest, one row each in rank order, left-aligned on their own residues N to C.
  if (others.length) {
    y += 6
    bands.push({ label: 'others', y: y + 2 })
    for (const k of others) {
      const label = `#${k + 1} ${seqOf(k)}`
      bars.push({ key: `p${k}`, kind: 'other', path: k, node: null, x1: GL, x2: GL + lenOf(g.paths[k]) * listUnit, y: y + 4, label, title: pathTitle(k, `shares no peak with #${at + 1}`), aria: `${sequenceOf(g.paths[k])}, resolved tag ${k + 1}` })
      y += ROW_H
    }
  }
  // Unused: aligned when they share a peak with the anchor, else left-aligned.
  if (showUnused && unusedPl.length) {
    y += 6
    bands.push({ label: 'unused', y: y + 2 })
    const items = unusedPl.map((i) => {
      const sp = uSpans.get(i)
      const x1 = sp ? X(sp[0]) : GL
      const x2 = sp ? X(sp[1]) : GL + lenOf(g.placements[i]) * listUnit
      return { i, x1, x2, ...tagOf(i, 'in no resolved tag') }
    })
    const lanes = pack(items.map((it) => ({ x1: it.x1, x2: it.x2 + 4 + it.seq.length * CHAR })), GAP)
    items.forEach((it, n) => bars.push({ key: `n${it.i}`, kind: 'unused', path: null, node: it.i, x1: it.x1, x2: it.x2, y: y + lanes[n] * ROW_H + 4, label: it.seq, title: it.title, aria: `${it.seq}, in no resolved tag` }))
    y += (Math.max(...lanes) + 1) * ROW_H
  }
  return {
    A,
    bars,
    arcs,
    ruler: { y: rulerY, x0: X(0), x1: X(T), cells: cells.map(({ x1, x2, label, gap }) => ({ x1, x2, label, gap })) },
    bands,
    dups,
    related: rel.size,
    others: others.length,
    nUnused: unusedPl.length,
    height: Math.max(y + 6, 40)
  }
}
