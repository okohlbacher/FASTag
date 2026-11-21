// The mark-up model (skill gui-feedback 3): numbered shapes in screenshot
// pixels, their history (undo/redo), drawing and flattening. The editor
// (MarkupEditor.tsx) is a view over these functions.

import { fillOpaque, outward, type Box, type PixelRect } from './redact'
import type { Annotation, ShapeType } from './types'

export interface Shape {
  n: number
  type: ShapeType
  // rect, redact: the box; arrow: the start and the vector to the head;
  // text: the anchor (w, h unused); pen: the bounding box of points.
  x: number
  y: number
  w: number
  h: number
  // pen: x0, y0, x1, y1, ... in image pixels.
  points?: number[]
  text?: string
  // A palette index (redactions are always solid black).
  color: number
}

/// Colours that differ by line style too (not by colour alone), each drawn
/// over a dark halo so it keeps ≥ 3:1 contrast on any screenshot (the
/// contrast test is in shapes.test.ts).
export const PALETTE: readonly { name: string; color: string; dash: number[] }[] = [
  { name: 'Red, solid', color: '#ff453a', dash: [] },
  { name: 'Yellow, dashed', color: '#ffd60a', dash: [10, 6] },
  { name: 'Cyan, dotted', color: '#40c8ff', dash: [2, 5] }
]
export const HALO = '#000000'

export const TYPE_LABEL: Record<ShapeType, string> = {
  rect: 'Rectangle',
  arrow: 'Arrow',
  pen: 'Pen',
  text: 'Text label',
  redact: 'Redaction'
}

const r1 = (v: number): number => Math.round(v * 10) / 10

/// A box with positive width and height (rect, redact).
export function normalize(b: Box): Box {
  return { x: Math.min(b.x, b.x + b.w), y: Math.min(b.y, b.y + b.h), w: Math.abs(b.w), h: Math.abs(b.h) }
}

export function bbox(points: number[]): Box {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (let i = 0; i + 1 < points.length; i += 2) {
    x0 = Math.min(x0, points[i])
    x1 = Math.max(x1, points[i])
    y0 = Math.min(y0, points[i + 1])
    y1 = Math.max(y1, points[i + 1])
  }
  return Number.isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : { x: 0, y: 0, w: 0, h: 0 }
}

/// The next shape number: one more than any so far (numbers are never reused).
export function nextNumber(shapes: Shape[], base = 0): number {
  return Math.max(base, ...shapes.map((s) => s.n)) + 1
}

/// @p s with field @p k set to @p v (x/y move a pen's points; its w/h stay).
export function setField(s: Shape, k: 'x' | 'y' | 'w' | 'h', v: number): Shape {
  if (!Number.isFinite(v)) return s
  if (s.type === 'pen' && s.points) {
    if (k === 'w' || k === 'h') return s
    const d = v - s[k]
    const points = s.points.map((p, i) => (i % 2 === (k === 'x' ? 0 : 1) ? p + d : p))
    return { ...s, points, ...bbox(points) }
  }
  const next = { ...s, [k]: v }
  if ((s.type === 'rect' || s.type === 'redact') && (k === 'w' || k === 'h')) next[k] = Math.max(1, v)
  return next
}

export function moveBy(s: Shape, dx: number, dy: number): Shape {
  return setField(setField(s, 'x', s.x + dx), 'y', s.y + dy)
}

/// The shape as the report stores it (screenshot pixels, for reference).
export function toAnnotation(s: Shape): Annotation {
  const px =
    s.type === 'pen' ? (s.points ?? []).slice(0, 4000).map(r1) : s.type === 'text' ? [r1(s.x), r1(s.y)] : [r1(s.x), r1(s.y), r1(s.w), r1(s.h)]
  return { n: s.n, type: s.type, px, text: s.type === 'text' ? (s.text ?? '').slice(0, 200) : null }
}

/// The redactions as whole image pixels (rounded outward).
export function redactRects(shapes: Shape[], width: number, height: number): PixelRect[] {
  return shapes
    .filter((s) => s.type === 'redact')
    .map((s) => outward(s, width, height))
    .filter((r): r is PixelRect => r !== null)
}

// ------------------------------------------------------------- history

export interface History {
  past: Shape[][]
  present: Shape[]
  future: Shape[][]
}

export const history = (present: Shape[] = []): History => ({ past: [], present, future: [] })
export const commit = (h: History, next: Shape[]): History => ({ past: [...h.past, h.present].slice(-200), present: next, future: [] })
export const undo = (h: History): History =>
  h.past.length ? { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] } : h
export const redo = (h: History): History =>
  h.future.length ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) } : h

// ------------------------------------------------------------- drawing

/// Draw @p shapes over the image already on @p ctx, in image pixels times
/// @p k (the context's scale to image pixels is set by the caller).
/// Redactions are drawn last, fully opaque.
export function drawShapes(ctx: CanvasRenderingContext2D, shapes: Shape[], k: number, selected: number | null = null): void {
  const line = Math.max(2, 3 / k)
  const label = (s: Shape, x: number, y: number): void => {
    const r = Math.max(9, 11 / k)
    ctx.save()
    ctx.setLineDash([])
    ctx.fillStyle = HALO
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.font = `bold ${Math.round(r * 1.2)}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(s.n), x, y + 0.5)
    ctx.restore()
  }
  const stroke = (s: Shape, path: () => void): void => {
    const p = PALETTE[s.color] ?? PALETTE[0]
    ctx.save()
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.setLineDash(p.dash.map((d) => d / Math.min(1, k)))
    ctx.strokeStyle = HALO
    ctx.lineWidth = line + 3 / k
    path()
    ctx.stroke()
    ctx.strokeStyle = p.color
    ctx.lineWidth = s.n === selected ? line * 1.6 : line
    path()
    ctx.stroke()
    ctx.restore()
  }
  for (const s of shapes) {
    if (s.type === 'redact') continue
    if (s.type === 'rect') {
      stroke(s, () => {
        ctx.beginPath()
        ctx.rect(s.x, s.y, s.w, s.h)
      })
      label(s, s.x, s.y)
    } else if (s.type === 'arrow') {
      const ex = s.x + s.w
      const ey = s.y + s.h
      const a = Math.atan2(s.h, s.w)
      const head = Math.max(12, 16 / k)
      stroke(s, () => {
        ctx.beginPath()
        ctx.moveTo(s.x, s.y)
        ctx.lineTo(ex, ey)
        ctx.moveTo(ex - head * Math.cos(a - 0.45), ey - head * Math.sin(a - 0.45))
        ctx.lineTo(ex, ey)
        ctx.lineTo(ex - head * Math.cos(a + 0.45), ey - head * Math.sin(a + 0.45))
      })
      label(s, s.x, s.y)
    } else if (s.type === 'pen' && s.points && s.points.length >= 2) {
      const pts = s.points
      stroke(s, () => {
        ctx.beginPath()
        ctx.moveTo(pts[0], pts[1])
        for (let i = 2; i + 1 < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1])
      })
      label(s, pts[0], pts[1])
    } else if (s.type === 'text') {
      const p = PALETTE[s.color] ?? PALETTE[0]
      const size = Math.max(14, 16 / k)
      ctx.save()
      ctx.font = `600 ${Math.round(size)}px system-ui, sans-serif`
      ctx.textBaseline = 'top'
      const t = s.text || ' '
      const w = ctx.measureText(t).width
      ctx.fillStyle = 'rgba(0,0,0,0.85)'
      ctx.fillRect(s.x + size * 0.9, s.y - 3, w + 8, size + 6)
      ctx.fillStyle = p.color
      ctx.fillText(t, s.x + size * 0.9 + 4, s.y)
      ctx.restore()
      label(s, s.x, s.y + size / 2)
    }
  }
  // Redactions last.
  for (const s of shapes) {
    if (s.type !== 'redact') continue
    const b = normalize(s)
    ctx.save()
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = '#000000'
    ctx.fillRect(b.x, b.y, b.w, b.h)
    if (s.n === selected) {
      ctx.strokeStyle = '#ffffff'
      ctx.setLineDash([6 / k, 4 / k])
      ctx.lineWidth = 2 / k
      ctx.strokeRect(b.x, b.y, b.w, b.h)
    }
    ctx.restore()
  }
}

/// The image with the shapes burnt in at full resolution, redactions
/// filled pixel by pixel (rounded outward, opaque) after everything else.
/// Throws when the canvas fails; the caller then drops the screenshot.
export function flatten(image: HTMLCanvasElement, shapes: Shape[]): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = image.width
  c.height = image.height
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('no 2D canvas')
  ctx.drawImage(image, 0, 0)
  drawShapes(ctx, shapes, 1)
  const rects = redactRects(shapes, c.width, c.height)
  if (rects.length) {
    const px = ctx.getImageData(0, 0, c.width, c.height)
    fillOpaque(px, rects)
    ctx.putImageData(px, 0, 0)
  }
  return c
}
