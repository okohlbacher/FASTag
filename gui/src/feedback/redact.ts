// The redaction commit rules (skill gui-feedback 3): a redact box drawn on
// the display is mapped to image pixels, rounded outward to whole pixels and
// filled fully opaque, after every other shape, into the pixels that are
// then encoded as a fresh PNG. Pure functions on an ImageData-like buffer,
// so the tests seed a pattern and check that no pixel of it survives
// (redact.test.ts, at DPR 1, 1.5 and 2 and fractional display scales).

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export interface PixelRect {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface Pixels {
  data: Uint8ClampedArray
  width: number
  height: number
}

/// A box in display (CSS) pixels as image pixels; @p scale: display pixels
/// per image pixel (the display width over the image width).
export function displayToImage(b: Box, scale: number): Box {
  return { x: b.x / scale, y: b.y / scale, w: b.w / scale, h: b.h / scale }
}

/// @p b (image pixels, any sign of w/h) rounded outward to whole pixels and
/// clipped to the image; null when nothing of it is on the image.
export function outward(b: Box, width: number, height: number): PixelRect | null {
  const xa = Math.min(b.x, b.x + b.w)
  const xb = Math.max(b.x, b.x + b.w)
  const ya = Math.min(b.y, b.y + b.h)
  const yb = Math.max(b.y, b.y + b.h)
  // A tiny epsilon keeps 10.0000001 (a float of 10) from taking pixel 10.
  const eps = 1e-6
  const x0 = Math.max(0, Math.floor(xa + eps))
  const y0 = Math.max(0, Math.floor(ya + eps))
  const x1 = Math.min(width, Math.ceil(xb - eps))
  const y1 = Math.min(height, Math.ceil(yb - eps))
  if (x1 <= x0 || y1 <= y0) return null
  return { x0, y0, x1, y1 }
}

/// Fill @p rects fully opaque with @p rgb (alpha 255).
export function fillOpaque(px: Pixels, rects: PixelRect[], rgb: [number, number, number] = [0, 0, 0]): void {
  for (const r of rects) {
    for (let y = r.y0; y < r.y1; y++) {
      for (let x = r.x0; x < r.x1; x++) {
        const i = (y * px.width + x) * 4
        px.data[i] = rgb[0]
        px.data[i + 1] = rgb[1]
        px.data[i + 2] = rgb[2]
        px.data[i + 3] = 255
      }
    }
  }
}
