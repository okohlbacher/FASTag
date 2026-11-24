// The geometry of the floating Feedback panel (FeedbackDialog): where it
// sits, how big it is, and how a drag, a key or a resize changes that. The
// panel is non-modal: it floats over the app, which stays usable behind it,
// and never leaves the window. Two layouts: the compact form (about 420 px
// wide, docked bottom-right by default, so the screen it reports on stays
// visible) and the wider mark-up editor (centred by default). Each is kept
// for the session (useFeedback holds them), apart from one another.

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Viewport {
  w: number
  h: number
}

export type Layout = 'compact' | 'wide'

/// What the session remembers: the last rectangle of each layout.
export type Remembered = Partial<Record<Layout, Rect>>

export const MARGIN = 16
export const MIN_W = 320
export const MIN_H = 200
/// The title bar's height when it cannot be measured (jsdom).
export const BAR_H = 44
/// A key moves the panel this far (Shift: BIG_STEP).
export const STEP = 16
export const BIG_STEP = 64

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), Math.max(lo, hi))

export const viewport = (): Viewport => ({ w: window.innerWidth, h: window.innerHeight })

/// The first rectangle of @p layout in @p v.
export function defaultRect(layout: Layout, v: Viewport): Rect {
  if (layout === 'compact') {
    const w = Math.min(420, v.w - 2 * MARGIN)
    const h = Math.min(640, v.h - 2 * MARGIN)
    return clampRect({ x: v.w - w - MARGIN, y: v.h - h - MARGIN, w, h }, v)
  }
  const w = Math.min(1180, v.w - 2 * MARGIN)
  const h = Math.min(820, v.h - 2 * MARGIN)
  return clampRect({ x: Math.round((v.w - w) / 2), y: Math.round((v.h - h) / 2), w, h }, v)
}

/// @p r inside @p v: no smaller than the minimum (or the window), no larger
/// than the window, and wholly on screen.
export function clampRect(r: Rect, v: Viewport): Rect {
  const w = clamp(Math.round(r.w), Math.min(MIN_W, v.w), v.w)
  const h = clamp(Math.round(r.h), Math.min(MIN_H, v.h), v.h)
  return { x: clamp(Math.round(r.x), 0, v.w - w), y: clamp(Math.round(r.y), 0, v.h - h), w, h }
}

/// Moved by (@p dx, @p dy), kept on screen. @p shownH is the height on
/// screen (the title bar alone while collapsed).
export function moveRect(r: Rect, dx: number, dy: number, v: Viewport, shownH = r.h): Rect {
  const x = clamp(Math.round(r.x + dx), 0, v.w - r.w)
  const y = clamp(Math.round(r.y + dy), 0, v.h - Math.min(shownH, v.h))
  return { ...r, x, y }
}

/// Resized from its bottom-right corner by (@p dw, @p dh): the top-left
/// corner stays, the panel stays on screen.
export function resizeRect(r: Rect, dw: number, dh: number, v: Viewport): Rect {
  const w = clamp(Math.round(r.w + dw), Math.min(MIN_W, v.w), v.w - r.x)
  const h = clamp(Math.round(r.h + dh), Math.min(MIN_H, v.h), v.h - r.y)
  return { ...r, w, h }
}

/// Whether a panel at @p y with height @p h sits in the lower half of the
/// window: it then collapses toward the bottom and expands upward.
const lower = (y: number, h: number, v: Viewport): boolean => y + h / 2 > v.h / 2

/// The top of the title bar once @p r collapses to a @p bar high strip: a
/// panel in the lower half keeps its bottom edge, one in the upper half
/// its top.
export function collapsedY(r: Rect, bar: number, v: Viewport): number {
  return lower(r.y, r.h, v) ? clamp(r.y + r.h - bar, 0, v.h - bar) : r.y
}

/// The rectangle when a collapsed bar at @p y expands back to @p r's size.
export function expandedAt(r: Rect, y: number, bar: number, v: Viewport): Rect {
  return clampRect({ ...r, y: lower(y, bar, v) ? y + bar - r.h : y }, v)
}

/// The arrow key's direction, or null for any other key.
export function arrow(key: string): { dx: number; dy: number } | null {
  if (key === 'ArrowLeft') return { dx: -1, dy: 0 }
  if (key === 'ArrowRight') return { dx: 1, dy: 0 }
  if (key === 'ArrowUp') return { dx: 0, dy: -1 }
  if (key === 'ArrowDown') return { dx: 0, dy: 1 }
  return null
}
