// Redaction commit rules (skill gui-feedback 3): a seeded "secret" in the
// image, a redact box drawn over where it shows on screen at DPR 1, 1.5 and
// 2 and fractional display scales, mapped to image pixels, rounded outward
// and filled: no seeded pixel may survive, and nothing far outside changes.
import { describe, expect, it } from 'vitest'
import { displayToImage, fillOpaque, outward, type Pixels } from './redact'
import { redactRects, type Shape } from './shapes'

function seeded(w: number, h: number, s: { x: number; y: number; w: number; h: number }): Pixels {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const secret = x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h
      // The seed: a pattern of near-white "text" (alpha 255), background grey.
      data.set(secret ? [250, (x * 7) % 256, (y * 13) % 256, 255] : [128, 128, 128, 255], i)
    }
  return { data, width: w, height: h }
}

const survivors = (px: Pixels, s: { x: number; y: number; w: number; h: number }): number => {
  let n = 0
  for (let y = s.y; y < s.y + s.h; y++)
    for (let x = s.x; x < s.x + s.w; x++) {
      const i = (y * px.width + x) * 4
      if (!(px.data[i] === 0 && px.data[i + 1] === 0 && px.data[i + 2] === 0 && px.data[i + 3] === 255)) n++
    }
  return n
}

describe('redaction', () => {
  const W = 401
  const H = 263
  const secrets = [
    { x: 37, y: 41, w: 113, h: 17 },
    { x: 0, y: 0, w: 9, h: 5 },
    { x: 390, y: 250, w: 11, h: 13 },
    { x: 201, y: 100, w: 1, h: 1 }
  ]
  for (const dpr of [1, 1.5, 2])
    for (const scale of [1, 0.5, 0.37, 0.8333, 1.27, 2.5]) {
      it(`no seeded pixel survives at DPR ${dpr}, display scale ${scale}`, () => {
        for (const s of secrets) {
          const px = seeded(W, H, s)
          // The box the user draws over the secret as it shows: pointer
          // positions land on the device-pixel grid (1/dpr CSS px), at
          // least covering what is drawn of the secret.
          const q0 = (v: number): number => Math.floor(v * dpr) / dpr
          const q1 = (v: number): number => Math.ceil(v * dpr) / dpr
          const css = { x: q0(s.x * scale), y: q0(s.y * scale), w: 0, h: 0 }
          css.w = q1((s.x + s.w) * scale) - css.x
          css.h = q1((s.y + s.h) * scale) - css.y
          const box = displayToImage(css, scale)
          const shape: Shape = { n: 1, type: 'redact', color: 0, ...box }
          fillOpaque(px, redactRects([shape], W, H))
          expect(survivors(px, s)).toBe(0)
          // Far outside (2 px beyond the rounded box): unchanged grey.
          const far = { x: Math.min(W - 1, s.x + s.w + 2), y: Math.min(H - 1, s.y + s.h + 2) }
          if (far.x > s.x + s.w + 1 && far.y > s.y + s.h + 1) expect(px.data[(far.y * W + far.x) * 4]).toBe(128)
        }
      })
    }

  it('rounds outward, clips to the image and accepts boxes drawn backwards', () => {
    expect(outward({ x: 1.2, y: 2.9, w: 3.1, h: 0.2 }, 100, 100)).toEqual({ x0: 1, y0: 2, x1: 5, y1: 4 })
    expect(outward({ x: 5, y: 5, w: -3.5, h: -2 }, 100, 100)).toEqual({ x0: 1, y0: 3, x1: 5, y1: 5 })
    expect(outward({ x: -10, y: -10, w: 20, h: 20 }, 4, 4)).toEqual({ x0: 0, y0: 0, x1: 4, y1: 4 })
    expect(outward({ x: 200, y: 0, w: 5, h: 5 }, 100, 100)).toBeNull()
    // A float of an integer edge does not take the next pixel.
    expect(outward({ x: 0.1 * 3 * 10, y: 0, w: 10, h: 1 }, 100, 100)).toEqual({ x0: 3, y0: 0, x1: 13, y1: 1 })
  })

  it('fills fully opaque over transparent pixels too', () => {
    const px: Pixels = { data: new Uint8ClampedArray(4 * 4 * 4), width: 4, height: 4 }
    fillOpaque(px, [{ x0: 1, y0: 1, x1: 3, y1: 3 }])
    expect(Array.from(px.data.slice((1 * 4 + 1) * 4, (1 * 4 + 1) * 4 + 4))).toEqual([0, 0, 0, 255])
    expect(px.data[3]).toBe(0)
  })
})
