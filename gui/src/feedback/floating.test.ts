// The floating Feedback panel's geometry (floating.ts): docked bottom-right
// by default, always wholly in the window, and collapsing toward the edge
// it is nearer to.
import { describe, expect, it } from 'vitest'
import { APP_BAR_H, arrow, clampRect, collapsedY, defaultRect, expandedAt, MARGIN, MIN_W, moveRect, resizeRect } from './floating'

const v = { w: 1280, h: 800 }

describe('floating panel geometry', () => {
  it('the compact form is about 420 px wide, docked bottom-right; the mark-up editor is wide and centred', () => {
    const c = defaultRect('compact', v)
    expect(c.w).toBe(420)
    expect(c.x + c.w).toBe(v.w - MARGIN)
    expect(c.y + c.h).toBe(v.h - MARGIN)
    const w = defaultRect('wide', v)
    expect(w.w).toBeGreaterThan(c.w)
    expect(w.x).toBe(Math.round((v.w - w.w) / 2))
    // A small window: never wider than the window.
    const s = defaultRect('compact', { w: 360, h: 300 })
    expect(s.x).toBeGreaterThanOrEqual(0)
    expect(s.x + s.w).toBeLessThanOrEqual(360)
    // The smallest app window (960x600): docked below the app bar.
    const m = defaultRect('compact', { w: 960, h: 600 })
    expect(m.y).toBeGreaterThanOrEqual(APP_BAR_H + MARGIN)
    expect(m.y + m.h).toBe(600 - MARGIN)
  })

  it('stays wholly in the window whatever it is moved, resized or clamped to', () => {
    const r = { x: 100, y: 100, w: 420, h: 500 }
    expect(moveRect(r, -5000, -5000, v)).toMatchObject({ x: 0, y: 0 })
    expect(moveRect(r, 5000, 5000, v)).toMatchObject({ x: v.w - 420, y: v.h - 500 })
    // Collapsed (a 44 px bar): it may go as low as its bar.
    expect(moveRect(r, 0, 5000, v, 44).y).toBe(v.h - 44)
    expect(resizeRect(r, 5000, 5000, v)).toMatchObject({ x: 100, y: 100, w: v.w - 100, h: v.h - 100 })
    expect(resizeRect(r, -5000, -5000, v).w).toBe(MIN_W)
    // A window made smaller pulls the panel back in.
    expect(clampRect({ x: 1000, y: 700, w: 420, h: 500 }, { w: 900, h: 600 })).toEqual({ x: 480, y: 100, w: 420, h: 500 })
  })

  it('collapses toward the nearer edge and expands back to the same rectangle', () => {
    const low = { x: 10, y: 400, w: 420, h: 380 }
    const y = collapsedY(low, 44, v)
    expect(y).toBe(400 + 380 - 44)
    expect(expandedAt(low, y, 44, v)).toEqual(low)
    const high = { x: 10, y: 20, w: 420, h: 300 }
    expect(collapsedY(high, 44, v)).toBe(20)
    expect(expandedAt(high, 20, 44, v)).toEqual(high)
  })

  it('maps the arrow keys', () => {
    expect(arrow('ArrowLeft')).toEqual({ dx: -1, dy: 0 })
    expect(arrow('ArrowDown')).toEqual({ dx: 0, dy: 1 })
    expect(arrow('a')).toBeNull()
  })
})
