import type { JSX } from 'react'
import type { LogoColumn } from './digestReport'

// Residue colour groups (by side chain). Colours are CSS tokens so the logo
// reads in both themes.
const GROUP: Record<string, string> = {
  D: 'acid',
  E: 'acid',
  K: 'base',
  R: 'base',
  H: 'base',
  S: 'polar',
  T: 'polar',
  Y: 'polar',
  C: 'polar',
  N: 'polar',
  Q: 'polar',
  G: 'polar'
}

const COL_W = 34
const GAP_W = 14 // between P1 and P1': the cleavage site
const PLOT_H = 110
const LEFT = 34
const TOP = 8
const AXIS_H = 34 // position labels and n
// A bold sans glyph at font-size 100 is about 72 units tall and 62 wide.
const CAP = 72
const ADV = 62

interface Props {
  title: string
  columns: LogoColumn[]
  /// Top of the y axis in bits; shared between logos so they compare.
  maxBits: number
  /// Show n under each column.
  showN?: boolean
}

/// A sequence logo P4..P1 | P1'..P4' in bits against a background. Letter
/// heights are already in bits (see logoColumn); this only draws them.
export default function SequenceLogo({ title, columns, maxBits, showN = false }: Props): JSX.Element {
  const top = Math.max(maxBits, 0.1)
  const split = columns.findIndex((c) => c.label.endsWith("'"))
  const xOf = (i: number): number => LEFT + i * COL_W + (split >= 0 && i >= split ? GAP_W : 0)
  const width = xOf(columns.length - 1) + COL_W + 4
  const height = TOP + PLOT_H + AXIS_H
  const yOf = (bits: number): number => TOP + PLOT_H - (bits / top) * PLOT_H
  const ticks = top <= 4 ? Array.from({ length: Math.floor(top) + 1 }, (_, i) => i) : [0, Math.floor(top / 2), Math.floor(top)]
  const summary = columns
    .filter((c) => c.letters.length)
    .map((c) => `${c.label} ${c.letters[c.letters.length - 1].aa} ${c.bits.toFixed(2)} bits`)
    .join(', ')

  return (
    <figure className="logo-fig">
      <figcaption>{title}</figcaption>
      <svg
        className="seqlogo"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${title}: ${summary || 'no information above background'}`}
      >
        <line className="axis" x1={LEFT - 4} x2={LEFT - 4} y1={TOP} y2={TOP + PLOT_H} />
        {ticks.map((t) => (
          <g key={t}>
            <line className="axis" x1={LEFT - 7} x2={LEFT - 4} y1={yOf(t)} y2={yOf(t)} />
            <text className="tick" x={LEFT - 9} y={yOf(t) + 3} textAnchor="end">
              {t}
            </text>
          </g>
        ))}
        <text className="tick" transform={`translate(9 ${TOP + PLOT_H / 2}) rotate(-90)`} textAnchor="middle">
          bits
        </text>
        {split > 0 && (
          <line
            className="site"
            x1={xOf(split) - GAP_W / 2}
            x2={xOf(split) - GAP_W / 2}
            y1={TOP}
            y2={TOP + PLOT_H + 4}
          />
        )}
        <line className="axis" x1={LEFT - 4} x2={width - 4} y1={TOP + PLOT_H} y2={TOP + PLOT_H} />
        {columns.map((c, i) => {
          let base = TOP + PLOT_H
          const x = xOf(i) + COL_W / 2
          return (
            <g key={c.label}>
              {c.letters.map((l) => {
                const h = (l.bits / top) * PLOT_H
                const y = base
                base -= h
                if (h < 0.75) return null
                return (
                  <text
                    key={l.aa}
                    className={`aa ${GROUP[l.aa] ?? 'hydro'}`}
                    fontSize={100}
                    textAnchor="middle"
                    transform={`translate(${x} ${y}) scale(${((COL_W - 4) / ADV).toFixed(4)} ${(h / CAP).toFixed(4)})`}
                  >
                    <title>{`${l.aa} at ${c.label}: ${l.bits.toFixed(3)} bits`}</title>
                    {l.aa}
                  </text>
                )
              })}
              <text className="pos" x={x} y={TOP + PLOT_H + 14} textAnchor="middle">
                {c.label}
              </text>
              {showN && c.n != null && (
                <text className="tick" x={x} y={TOP + PLOT_H + 27} textAnchor="middle">
                  {c.n.toLocaleString()}
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </figure>
  )
}
