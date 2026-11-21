import { describe, expect, it } from 'vitest'
import { HALO, PALETTE, commit, history, moveBy, nextNumber, redo, setField, toAnnotation, undo, type Shape } from './shapes'

const lum = (hex: string): number => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
const contrast = (a: string, b: string): number => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

const rect: Shape = { n: 1, type: 'rect', color: 0, x: 10, y: 20, w: 30, h: 40 }

describe('mark-up shapes', () => {
  it('the palette keeps 3:1 against its halo and differs by line style', () => {
    for (const p of PALETTE) expect(contrast(p.color, HALO), p.name).toBeGreaterThanOrEqual(3)
    const styles = new Set(PALETTE.map((p) => JSON.stringify(p.dash)))
    expect(styles.size).toBe(PALETTE.length)
  })

  it('numbers are never reused', () => {
    expect(nextNumber([])).toBe(1)
    expect(nextNumber([rect, { ...rect, n: 4 }])).toBe(5)
    expect(nextNumber([], 3)).toBe(4)
  })

  it('fields move and size a box; a pen moves its points and keeps its size', () => {
    expect(setField(rect, 'x', 15)).toMatchObject({ x: 15, w: 30 })
    expect(setField(rect, 'w', -5).w).toBe(1)
    expect(setField(rect, 'x', NaN)).toBe(rect)
    const pen: Shape = { n: 2, type: 'pen', color: 1, points: [0, 0, 10, 5], x: 0, y: 0, w: 10, h: 5 }
    const moved = moveBy(pen, 3, 4)
    expect(moved.points).toEqual([3, 4, 13, 9])
    expect(moved).toMatchObject({ x: 3, y: 4, w: 10, h: 5 })
    expect(setField(pen, 'w', 99)).toBe(pen)
  })

  it('annotations are in screenshot pixels', () => {
    expect(toAnnotation({ ...rect, x: 10.04 })).toEqual({ n: 1, type: 'rect', px: [10, 20, 30, 40], text: null })
    expect(toAnnotation({ n: 3, type: 'text', color: 0, x: 5, y: 6, w: 0, h: 0, text: 'see here' })).toEqual({ n: 3, type: 'text', px: [5, 6], text: 'see here' })
  })

  it('undo and redo', () => {
    let h = history()
    h = commit(h, [rect])
    h = commit(h, [rect, { ...rect, n: 2 }])
    expect(undo(h).present).toEqual([rect])
    expect(redo(undo(h)).present).toHaveLength(2)
    expect(undo(undo(undo(h))).present).toEqual([])
    expect(commit(undo(h), []).future).toEqual([])
  })
})
