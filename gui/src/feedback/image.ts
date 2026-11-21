// Screenshot images in the renderer: decoding, the caps (≤ 2,560 px on the
// long side and ≤ 8 M pixels, applied before anything is shown or saved),
// and PNG encoding. The image lives in canvases only (the CSP allows no
// blob: images), and the raw capture never reaches the disk: what is saved
// is the flattened canvas, encoded fresh (no metadata).

export const MAX_LONG_SIDE = 2560
export const MAX_PIXELS = 8_000_000

/// The size @p w × @p h is scaled to under the caps (never up).
export function fitCaps(w: number, h: number): { width: number; height: number; factor: number } {
  if (w <= 0 || h <= 0) return { width: 0, height: 0, factor: 0 }
  let f = Math.min(1, MAX_LONG_SIDE / Math.max(w, h))
  if (w * h * f * f > MAX_PIXELS) f = Math.min(f, Math.sqrt(MAX_PIXELS / (w * h)))
  let width = Math.max(1, Math.floor(w * f))
  let height = Math.max(1, Math.floor(h * f))
  while (width * height > MAX_PIXELS) {
    width--
    height = Math.max(1, Math.floor((width * h) / w))
  }
  return { width, height, factor: width / w }
}

export function newCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

/// @p source drawn into a canvas under the caps.
export function capped(source: CanvasImageSource & { width: number; height: number }): HTMLCanvasElement {
  const { width, height } = fitCaps(source.width, source.height)
  const c = newCanvas(width, height)
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('no 2D canvas')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, width, height)
  return c
}

/// A PNG's bytes decoded into a canvas under the caps.
export async function decodePng(png: Uint8Array): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(new Blob([png as BlobPart], { type: 'image/png' }))
  try {
    return capped(bmp)
  } finally {
    bmp.close?.()
  }
}

/// A canvas as fresh PNG bytes.
export function encodePng(c: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    c.toBlob((b) => {
      if (!b) return reject(new Error('the image could not be encoded'))
      b.arrayBuffer().then((a) => resolve(new Uint8Array(a)), reject)
    }, 'image/png')
  })
}
