// The merge graph of one spectrum: its tag graph as a node-link drawing on
// the stick plot's m/z axis. A node is a placement (the tags on one chain of
// peaks), a bar from its first to its last peak, in the band of its layer
// (ion series pair and fragment charge), in lanes so bars do not overlap.
// An arc is one placement continuing another (solid: they share a step,
// dashed: they only touch); arcs that build a resolved tag are bold in the
// colour of its rank, the tags inside it hang from it. A node selects its
// resolved tag, as a row of the resolved tags table does. The nodes that
// select one are a single tab stop (roving tabindex): the arrows move along
// a lane (left, right) and between lanes (up, down).
//
// It follows the stick plot's zoom (the same m/z range): the lanes are laid
// out on the whole spectrum, so they stay put while zooming; a bar outside
// the range is not drawn (nor a tab stop), one across its edge is clipped,
// and an arc to a bar outside runs to the edge.

import { useId, useMemo, useRef, useState, type JSX, type KeyboardEvent } from 'react'
import type { SpectrumPeaks } from './dump'
import { layerOf, sequenceOf, type TagGraph } from './graph'
import { seriesText } from './ladder'
import { PAD, W, fullRange } from './plotScale'

const BAND_TOP = 18
const LANE_H = 28
const BAR_Y = 13
const BAR_H = 9
// Least room between two bars of a lane (user units).
const GAP = 8
// About the width of a label character (12px mono in a 1000-unit box).
const CHAR = 7.4

// The colour of a rank: the first three apart, the rest alike (the rank is written on the node).
const rankCls = (path: number): string => `r${Math.min(path + 1, 4)}`

export function MergeGraph({
  graph: g,
  spectrum: s,
  range,
  chosen,
  onChoose
}: {
  graph: TagGraph
  spectrum: SpectrumPeaks
  // The m/z range the stick plot shows; left out, the whole spectrum.
  range?: [number, number]
  chosen: number
  onChoose(path: number): void
}): JSX.Element {
  const clip = useId()
  // Lanes on the whole spectrum's scale: zooming moves the bars, not their lanes.
  const layout = useMemo(() => {
    const [lo, hi] = fullRange(s.mz)
    const X = (x: number): number => PAD.l + ((x - lo) / (hi - lo)) * (W - PAD.l - PAD.r)
    const owner = g.placements.map((): { path: number; inside: boolean } | null => null)
    g.paths.forEach((p, k) => {
      for (const i of p.chain) owner[i] = { path: k, inside: false }
      for (const i of p.inside) owner[i] = { path: k, inside: true }
    })
    const layers = [...new Set(g.placements.map(layerOf))].sort()
    const nodes = g.placements.map((pl, i) => {
      const x1 = X(s.mz[pl.peaks[0]])
      return { i, x1, x2: Math.max(x1 + 3, X(s.mz[pl.peaks[pl.peaks.length - 1]])), y: 0, seq: sequenceOf(pl) }
    })
    const bands: { label: string; top: number; height: number }[] = []
    let top = 0
    for (const layer of layers) {
      const mine = nodes.filter((n) => layerOf(g.placements[n.i]) === layer).sort((a, b) => a.x1 - b.x1 || a.i - b.i)
      const ends: number[] = []
      for (const n of mine) {
        let lane = ends.findIndex((e) => e + GAP < n.x1)
        if (lane < 0) lane = ends.push(0) - 1
        ends[lane] = n.x2
        n.y = top + BAND_TOP + lane * LANE_H + BAR_Y
      }
      const pl = g.placements[mine[0].i]
      bands.push({ label: `${layer.startsWith('cz') ? 'c/z' : 'b/y'} ${pl.charge}+`, top, height: BAND_TOP + ends.length * LANE_H })
      top += BAND_TOP + ends.length * LANE_H
    }
    return { nodes, owner, bands, height: Math.max(top, 40) + 4 }
  }, [g, s])
  const { owner, bands, height } = layout
  // The bars on the plot's m/z range: in view when any of a bar lies inside it.
  const [lo, hi] = range ?? fullRange(s.mz)
  const nodes = useMemo(() => {
    const X = (x: number): number => PAD.l + ((x - lo) / (hi - lo)) * (W - PAD.l - PAD.r)
    return layout.nodes.map((n) => {
      const pl = g.placements[n.i]
      const x1 = X(s.mz[pl.peaks[0]])
      const x2 = Math.max(x1 + 3, X(s.mz[pl.peaks[pl.peaks.length - 1]]))
      return { ...n, x1, x2, shown: x2 >= PAD.l && x1 <= W - PAD.r }
    })
  }, [layout, g, s, lo, hi])
  const outside = nodes.filter((n) => !n.shown).length
  const mid = (i: number): number => nodes[i].y + BAR_H / 2
  // The tab stop: the node of this graph focused last, else the first of the chosen chain.
  const [focus, setFocus] = useState<{ g: TagGraph; i: number } | null>(null)
  const refs = useRef(new Map<number, SVGGElement>())
  // A node outside the range is no tab stop: then the first node in view of the chosen chain, else of any.
  const pick = (i: number | undefined): number | undefined => (i != null && nodes[i]?.shown && owner[i] ? i : undefined)
  const stop = pick(focus?.g === g ? focus.i : undefined) ?? pick(g.paths[chosen]?.chain.find((i) => nodes[i].shown)) ?? nodes.find((n) => n.shown && owner[n.i])?.i ?? -1

  // The nearest node that selects something along the lane (left, right) or in the nearest lane above or below.
  function move(from: number, key: string): number | null {
    const at = nodes[from]
    const dir = key === 'ArrowRight' || key === 'ArrowDown' ? 1 : -1
    const lane = key === 'ArrowLeft' || key === 'ArrowRight'
    const next = nodes
      .filter((n) => n.shown && owner[n.i] && (lane ? n.y === at.y && dir * (n.x1 - at.x1) > 0 : dir * (n.y - at.y) > 0))
      .sort((a, b) => Math.abs(a.y - at.y) - Math.abs(b.y - at.y) || Math.abs(a.x1 - at.x1) - Math.abs(b.x1 - at.x1) || a.i - b.i)
    return next[0]?.i ?? null
  }

  function key(e: KeyboardEvent<SVGGElement>, i: number, path: number): void {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      return onChoose(path)
    }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return
    e.preventDefault()
    const to = move(i, e.key)
    // Its onFocus makes it the tab stop.
    if (to != null) refs.current.get(to)?.focus()
  }

  return (
    <div className="sp-graph" data-testid="merge-graph">
      <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" className="sp-graph-svg" style={{ height }} role="group" aria-label={`Merge graph: ${g.placements.length} distinct tags, ${g.arcs.length} joins, ${g.paths.length} resolved tags${outside ? `; ${outside} outside m/z ${lo.toFixed(1)}–${hi.toFixed(1)}` : ''}`}>
        <defs>
          <clipPath id={clip}>
            <rect x={PAD.l} y={0} width={W - PAD.l - PAD.r} height={height} />
          </clipPath>
        </defs>
        {bands.map((b, k) => (
          <g key={b.label} className="sp-graph-band">
            {k > 0 && <line x1={PAD.l} x2={W - PAD.r} y1={b.top} y2={b.top} className="sp-axis" />}
            <text x={4} y={b.top + 14} className="sp-series">
              {b.label}
            </text>
          </g>
        ))}
        <g clipPath={`url(#${clip})`}>
          {/* Arcs under the nodes: from the end of one to the start of the next (to the edge, for a bar outside the range). */}
          {g.arcs.map((a) => {
            const from = nodes[a.from]
            const to = nodes[a.to]
            const on = a.used ? owner[a.from] : null
            const d = `M ${from.x2} ${mid(a.from)} C ${from.x2 + 28} ${mid(a.from)}, ${to.x1 - 28} ${mid(a.to)}, ${to.x1} ${mid(a.to)}`
            return (
              <path
                key={`${a.from}>${a.to}`}
                d={d}
                className={`sp-graph-arc${a.touch ? ' touch' : ''}${on ? ` on ${rankCls(on.path)}` : ''}`}
                data-arc={a.used ? 'used' : 'other'}
              />
            )
          })}
          {/* A tag inside a resolved tag hangs from the chain tag that holds its first peak. */}
          {g.placements.map((pl, i) => {
            const o = owner[i]
            if (!o?.inside || !nodes[i].shown) return null
            const holder = g.paths[o.path].chain.find((c) => g.placements[c].peaks.includes(pl.peaks[0]))
            if (holder == null) return null
            const x = Math.min(nodes[i].x1 + 4, nodes[i].x2)
            return <line key={`in${i}`} x1={x} x2={x} y1={mid(holder)} y2={mid(i)} className={`sp-graph-attach ${rankCls(o.path)}`} />
          })}
          {nodes.map((n) => {
            if (!n.shown) return null
            const pl = g.placements[n.i]
            const o = owner[n.i]
            const rank = o ? `#${o.path + 1}` : ''
            const label = [o && !o.inside ? rank : '', n.seq].filter(Boolean).join(' ')
            // The label starts where the bar comes into view.
            const lx = Math.max(n.x1, PAD.l)
            const fits = label.length * CHAR <= Math.max(n.x2 - lx, 0) + 24
            const role = o ? `${o.inside ? 'inside' : 'builds'} resolved tag ${o.path + 1}` : 'in no resolved tag'
            const title = `${n.seq} (${seriesText(pl.series, pl.call)} ${pl.charge}+) · E-value ${pl.evalue ?? 'none'} · ${pl.rows.length} tag${pl.rows.length === 1 ? '' : 's'}${pl.tags.length ? `: ${pl.tags.join(', ')}` : ''} · ${role}`
            const cls = `sp-graph-node${o ? ` ${rankCls(o.path)}${o.inside ? ' inside' : ''}` : ' none'}${o && o.path === chosen ? ' sel' : ''}`
            return (
              <g
                key={n.i}
                ref={(el) => {
                  if (el) refs.current.set(n.i, el)
                  else refs.current.delete(n.i)
                }}
                className={cls}
                data-node={n.i}
                // A node in no resolved tag selects nothing: not a tab stop, an image with its label.
                tabIndex={o ? (n.i === stop ? 0 : -1) : undefined}
                role={o ? 'button' : 'img'}
                aria-label={`${n.seq}, ${role}${pl.evalue != null ? `, E-value ${pl.evalue}` : ''}`}
                aria-pressed={o ? o.path === chosen : undefined}
                onClick={o ? () => onChoose(o.path) : undefined}
                onFocus={o ? () => setFocus({ g, i: n.i }) : undefined}
                onKeyDown={o ? (e) => key(e, n.i, o.path) : undefined}
              >
                <title>{title}</title>
                {/* What a pointer hits: the bar and its label. */}
                <rect x={n.x1 - 3} y={n.y - 13} width={Math.max(n.x2 - n.x1, (fits ? label : rank).length * CHAR) + 6} height={BAR_H + 15} className="sp-graph-hit" />
                <rect x={n.x1} y={n.y} width={n.x2 - n.x1} height={BAR_H} rx={2} className="sp-graph-bar" />
                <text x={lx} y={n.y - 3} className="sp-graph-label">
                  {fits ? label : rank}
                </text>
              </g>
            )
          })}
        </g>
      </svg>
      <p className="hint sp-legend">
        Each bar is a distinct tag from its first to its last peak (m/z as in the plot, zoomed with it), one band per ion layer · solid: it continues the tag before over a
        shared step, dashed: they only touch · bold: joins that build resolved tag #n (its colour); thin bars hang inside it · choose a tag to select its resolved tag
      </p>
    </div>
  )
}
