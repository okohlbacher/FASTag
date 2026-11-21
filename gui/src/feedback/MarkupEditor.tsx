// The mark-up editor (skill gui-feedback 3): rectangle, arrow, pen, text
// label and redaction on the screenshot, each shape numbered. Beside the
// canvas a list of the shapes (focusable rows with x/y/w/h fields and
// Delete), so every shape can be made, moved and removed by keyboard or
// screen reader; Add places one without a pointer and "Click two corners"
// draws a box without dragging (WCAG 2.2 SC 2.5.7). Undo/redo; the raw
// image and the history stay in this component's memory and are gone on
// Done or Cancel. Done flattens (shapes.ts flatten): a failure drops the
// screenshot.

import { useEffect, useLayoutEffect, useRef, useState, type JSX, type KeyboardEvent, type PointerEvent } from 'react'
import { displayToImage } from './redact'
import { PALETTE, TYPE_LABEL, bbox, commit, drawShapes, flatten, history, moveBy, nextNumber, normalize, redo, setField, undo, type History, type Shape } from './shapes'
import type { ShapeType } from './types'

export interface MarkupResult {
  image: HTMLCanvasElement
  shapes: Shape[]
}

const TOOLS: readonly ShapeType[] = ['rect', 'arrow', 'pen', 'text', 'redact']
const MAX_W = 820
const MAX_H = 460

interface Props {
  image: HTMLCanvasElement
  // Numbers already burnt into the image (an earlier mark-up): new shapes go on from there.
  numberBase: number
  onDone(r: MarkupResult | { error: string }): void
  onCancel(): void
}

export default function MarkupEditor({ image, numberBase, onDone, onCancel }: Props): JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [hist, setHist] = useState<History>(() => history())
  const shapes = hist.present
  const [tool, setTool] = useState<ShapeType>('rect')
  const [color, setColor] = useState(0)
  const [corners, setCorners] = useState(false)
  const [firstCorner, setFirstCorner] = useState<{ x: number; y: number } | null>(null)
  const [draft, setDraft] = useState<Shape | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const drag = useRef<{ start: { x: number; y: number } } | null>(null)
  const listRef = useRef<HTMLOListElement>(null)

  // The display size: the image fitted into the editor (never enlarged).
  const fit = Math.min(1, MAX_W / image.width, MAX_H / image.height)
  const dispW = Math.max(1, Math.round(image.width * fit))
  const dispH = Math.max(1, Math.round(image.height * fit))
  const scale = dispW / image.width

  useLayoutEffect(() => {
    const c = canvas.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx) return
    const dpr = window.devicePixelRatio || 1
    c.width = Math.round(dispW * dpr)
    c.height = Math.round(dispH * dpr)
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, c.width, c.height)
    const k = (dispW * dpr) / image.width
    ctx.setTransform(k, 0, 0, k, 0, 0)
    ctx.drawImage(image, 0, 0)
    drawShapes(ctx, draft ? [...shapes, draft] : shapes, k / dpr, selected)
    if (firstCorner) {
      ctx.fillStyle = '#ffffff'
      ctx.strokeStyle = '#000000'
      ctx.lineWidth = 2 / k
      ctx.beginPath()
      ctx.arc(firstCorner.x, firstCorner.y, 5 / (k / dpr), 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }
  }, [image, shapes, draft, selected, firstCorner, dispW, dispH])

  const n = (): number => nextNumber([...shapes, ...(draft ? [draft] : [])], numberBase)
  const put = (next: Shape[]): void => setHist((h) => commit(h, next))
  const update = (num: number, f: (s: Shape) => Shape): void => put(shapes.map((s) => (s.n === num ? f(s) : s)))
  const remove = (num: number): void => {
    put(shapes.filter((s) => s.n !== num))
    setSelected(null)
    setNote(`Shape ${num} deleted.`)
  }

  // A pointer position as image pixels (displayToImage over the canvas's
  // CSS box, whatever the device pixel ratio).
  const at = (e: PointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const r = e.currentTarget.getBoundingClientRect()
    const k = r.width > 0 ? r.width / image.width : scale
    const b = displayToImage({ x: e.clientX - r.left, y: e.clientY - r.top, w: 0, h: 0 }, k)
    return { x: Math.max(0, Math.min(image.width, b.x)), y: Math.max(0, Math.min(image.height, b.y)) }
  }

  const make = (type: ShapeType, a: { x: number; y: number }, b: { x: number; y: number }, num = n()): Shape => {
    const base = { n: num, type, color: type === 'redact' ? 0 : color }
    if (type === 'arrow') return { ...base, x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y }
    if (type === 'text') return { ...base, x: a.x, y: a.y, w: 0, h: 0, text: '' }
    return { ...base, ...normalize({ x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y }) }
  }

  const added = (s: Shape): void => {
    put([...shapes, s])
    setSelected(s.n)
    setNote(`${TYPE_LABEL[s.type]} ${s.n} added.`)
    // A text label is written in its row.
    if (s.type === 'text') setTimeout(() => listRef.current?.querySelector<HTMLInputElement>(`[data-text="${s.n}"]`)?.focus())
  }

  function onPointerDown(e: PointerEvent<HTMLCanvasElement>): void {
    const p = at(e)
    if (tool === 'text') {
      added(make('text', p, p))
      return
    }
    if (corners && tool !== 'pen') {
      if (!firstCorner) {
        setFirstCorner(p)
        setNote('First corner set: click the opposite corner.')
      } else {
        const s = make(tool, firstCorner, p)
        setFirstCorner(null)
        if (s.type === 'arrow' ? Math.hypot(s.w, s.h) >= 2 : s.w >= 1 && s.h >= 1) added(s)
      }
      return
    }
    e.currentTarget.setPointerCapture?.(e.pointerId)
    drag.current = { start: p }
    setDraft(tool === 'pen' ? { n: n(), type: 'pen', color, points: [p.x, p.y], x: p.x, y: p.y, w: 0, h: 0 } : make(tool, p, p))
  }

  function onPointerMove(e: PointerEvent<HTMLCanvasElement>): void {
    if (!drag.current || !draft) return
    const p = at(e)
    if (draft.type === 'pen') {
      const points = [...(draft.points ?? []), p.x, p.y]
      setDraft({ ...draft, points, ...bbox(points) })
    } else setDraft(make(draft.type, drag.current.start, p, draft.n))
  }

  function onPointerUp(): void {
    const d = draft
    drag.current = null
    setDraft(null)
    if (!d) return
    const big = d.type === 'pen' ? (d.points?.length ?? 0) >= 4 : d.type === 'arrow' ? Math.hypot(d.w, d.h) >= 3 : d.w >= 3 && d.h >= 3
    if (big) added(d)
  }

  // Add: the current tool's shape in the middle of the image, for keyboard
  // and screen-reader users (then placed through its row's fields).
  function addCentered(): void {
    const w = Math.round(image.width / 4)
    const h = Math.round(image.height / 4)
    const a = { x: Math.round((image.width - w) / 2), y: Math.round((image.height - h) / 2) }
    if (tool === 'pen') {
      const pts = [a.x, a.y + h, a.x + w / 2, a.y, a.x + w, a.y + h]
      added({ n: n(), type: 'pen', color, points: pts, ...bbox(pts) })
    } else added(make(tool, a, { x: a.x + w, y: a.y + h }))
  }

  function done(): void {
    try {
      const flat = flatten(image, shapes)
      onDone({ image: flat, shapes })
    } catch (e) {
      onDone({ error: e instanceof Error ? e.message : String(e) })
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    const t = e.target as HTMLElement
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return
    const mod = e.metaKey || e.ctrlKey
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      e.stopPropagation()
      setHist((h) => (e.shiftKey ? redo(h) : undo(h)))
    } else if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault()
      setHist(redo)
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && selected != null) {
      e.preventDefault()
      remove(selected)
    } else if (selected != null && e.key.startsWith('Arrow') && t.closest('[data-shape-row]')) {
      e.preventDefault()
      const step = e.shiftKey ? 10 : 1
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
      update(selected, (s) => moveBy(s, dx, dy))
    }
  }

  useEffect(() => {
    if (!corners) setFirstCorner(null)
  }, [corners, tool])

  const field = (s: Shape, k: 'x' | 'y' | 'w' | 'h'): JSX.Element => (
    <label className="fb-xy">
      {k}
      <input
        type="number"
        step={1}
        value={Math.round(s[k])}
        readOnly={s.type === 'pen' && (k === 'w' || k === 'h')}
        aria-label={`Shape ${s.n} ${k === 'x' ? 'left' : k === 'y' ? 'top' : k === 'w' ? (s.type === 'arrow' ? 'horizontal length' : 'width') : s.type === 'arrow' ? 'vertical length' : 'height'} in pixels`}
        onChange={(e) => update(s.n, (x) => setField(x, k, Number(e.target.value)))}
      />
    </label>
  )

  return (
    <div className="fb-markup" onKeyDown={onKeyDown}>
      <h3 id="fb-markup-h">Mark up the screenshot</h3>
      <div className="fb-toolbar" role="toolbar" aria-label="Mark-up tools">
        {TOOLS.map((t) => (
          <button key={t} type="button" className={`secondary small${tool === t ? ' on' : ''}`} aria-pressed={tool === t} onClick={() => setTool(t)}>
            {TYPE_LABEL[t]}
          </button>
        ))}
        <label className="fb-inline">
          Colour
          <select value={color} onChange={(e) => setColor(Number(e.target.value))} disabled={tool === 'redact'}>
            {PALETTE.map((p, i) => (
              <option key={p.name} value={i}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="fb-inline">
          <input type="checkbox" checked={corners} onChange={(e) => setCorners(e.target.checked)} disabled={tool === 'pen' || tool === 'text'} />
          Click two corners
        </label>
        <button type="button" className="secondary small" onClick={addCentered}>
          Add {TYPE_LABEL[tool].toLowerCase()}
        </button>
        <button type="button" className="secondary small" onClick={() => setHist(undo)} disabled={!hist.past.length} aria-keyshortcuts="Meta+Z Control+Z">
          Undo
        </button>
        <button type="button" className="secondary small" onClick={() => setHist(redo)} disabled={!hist.future.length} aria-keyshortcuts="Meta+Shift+Z Control+Y">
          Redo
        </button>
      </div>
      <div className="fb-markup-body">
        <canvas
          ref={canvas}
          className="fb-canvas"
          style={{ width: dispW, height: dispH, cursor: tool === 'text' ? 'text' : 'crosshair' }}
          role="img"
          aria-label={`Screenshot, ${image.width} by ${image.height} pixels, with ${shapes.length} ${shapes.length === 1 ? 'shape' : 'shapes'}. Use the list of shapes to edit them by keyboard.`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            drag.current = null
            setDraft(null)
          }}
        />
        <div className="fb-shapes">
          <h4 id="fb-shapes-h">Shapes</h4>
          {shapes.length === 0 && <p className="muted">None yet. Draw on the image, or choose a tool and Add.</p>}
          <ol ref={listRef} aria-labelledby="fb-shapes-h">
            {shapes.map((s) => (
              <li
                key={s.n}
                data-shape-row={s.n}
                tabIndex={0}
                className={selected === s.n ? 'on' : undefined}
                aria-current={selected === s.n ? 'true' : undefined}
                aria-label={`${s.n}: ${TYPE_LABEL[s.type]}`}
                onFocus={() => setSelected(s.n)}
                onClick={() => setSelected(s.n)}
              >
                <span className="fb-shape-name">
                  <b>{s.n}</b> {TYPE_LABEL[s.type]}
                </span>
                <span className="fb-shape-fields">
                  {field(s, 'x')}
                  {field(s, 'y')}
                  {s.type !== 'text' && field(s, 'w')}
                  {s.type !== 'text' && field(s, 'h')}
                  {s.type === 'text' && (
                    <label className="fb-xy">
                      text
                      <input
                        type="text"
                        data-text={s.n}
                        maxLength={200}
                        value={s.text ?? ''}
                        aria-label={`Shape ${s.n} label text`}
                        onChange={(e) => update(s.n, (x) => ({ ...x, text: e.target.value }))}
                      />
                    </label>
                  )}
                </span>
                <button type="button" className="secondary small" onClick={() => remove(s.n)} aria-label={`Delete shape ${s.n}`}>
                  Delete
                </button>
              </li>
            ))}
          </ol>
          <p className="hint">Arrow keys move the selected shape (Shift: 10 px); Delete removes it.</p>
        </div>
      </div>
      <p className="sr-only" role="status">
        {note}
      </p>
      <div className="row actions">
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" onClick={done}>
          Done
        </button>
      </div>
    </div>
  )
}
