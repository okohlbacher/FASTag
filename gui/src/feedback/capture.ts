// The one capture path (skill gui-feedback 2): the Feedback button, the
// Help menu item and Cmd/Ctrl+Shift+F all call capture(). One capture is in
// flight per window: a second call while one runs gets the same attempt. It
// runs before the dialog opens (an overlay would darken the image). Native
// first, the DOM rasteriser when that fails; after 5 s the report goes
// text-only with capture.status failed and the reason. A result that comes
// after the timeout or a cancel is dropped.

import type { CaptureMethod, CaptureStatus, NativeCapture } from './types'

export const CAPTURE_TIMEOUT_MS = 5000

/// A capture as the dialog gets it, frozen at the moment it was taken.
export interface Frozen {
  attemptId: string
  status: CaptureStatus
  method: CaptureMethod
  api: string | null
  error: string | null
  // The image (null for a failed capture), already under the caps.
  image: HTMLCanvasElement | null
  width: number
  height: number
  // Image pixels per CSS pixel.
  scale: number
  capturedUtc: string
}

export interface CaptureDeps {
  native: () => Promise<NativeCapture>
  // Decode the native PNG into a canvas under the caps.
  decode: (png: Uint8Array) => Promise<HTMLCanvasElement>
  // The DOM rasteriser: a canvas of the visible viewport (under the caps).
  dom: () => Promise<HTMLCanvasElement>
  // Whether the view holds content a webview snapshot may leave out
  // (WebGL, video): the capture is then 'degraded'.
  degraded?: () => boolean
  cssWidth?: () => number
  timeoutMs?: number
  now?: () => Date
}

const iso = (d: Date): string => d.toISOString().replace(/\.\d+Z$/, 'Z')
const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e)).slice(0, 400)

export interface Capturer {
  capture(): Promise<Frozen>
  // Drop the attempt in flight (its result, when it comes, is discarded).
  cancel(): void
  readonly busy: boolean
}

export function createCapturer(deps: CaptureDeps): Capturer {
  let seq = 0
  let inflight: { id: string; promise: Promise<Frozen>; settle: (f: Frozen) => void } | null = null

  const failed = (id: string, error: string, at: Date): Frozen => ({
    attemptId: id,
    status: 'failed',
    method: 'none',
    api: null,
    error,
    image: null,
    width: 0,
    height: 0,
    scale: 0,
    capturedUtc: iso(at)
  })

  async function attempt(id: string, at: Date): Promise<Frozen> {
    const cssW = deps.cssWidth?.() ?? window.innerWidth
    let nativeError: string | null = null
    try {
      const n = await deps.native()
      if (n.status === 'ok' && n.png) {
        const image = await deps.decode(n.png)
        return {
          attemptId: id,
          status: deps.degraded?.() ? 'degraded' : 'ok',
          method: 'native',
          api: n.api,
          error: deps.degraded?.() ? 'the view holds WebGL or video, which a webview snapshot may leave out' : null,
          image,
          width: image.width,
          height: image.height,
          scale: cssW > 0 ? image.width / cssW : 1,
          capturedUtc: iso(at)
        }
      }
      nativeError = n.error ?? 'no native snapshot'
    } catch (e) {
      nativeError = msg(e)
    }
    try {
      const image = await deps.dom()
      return {
        attemptId: id,
        // A DOM raster is a reconstruction, not what the webview drew.
        status: 'degraded',
        method: 'dom',
        api: 'snapdom',
        error: `native capture unavailable (${nativeError}); the DOM rasteriser drew this image`.slice(0, 500),
        image,
        width: image.width,
        height: image.height,
        scale: cssW > 0 ? image.width / cssW : 1,
        capturedUtc: iso(at)
      }
    } catch (e) {
      return failed(id, `no screenshot: native: ${nativeError}; DOM: ${msg(e)}`.slice(0, 500), at)
    }
  }

  return {
    get busy() {
      return inflight !== null
    },
    capture() {
      if (inflight) return inflight.promise
      const id = `cap-${Date.now().toString(36)}-${++seq}`
      const at = (deps.now ?? (() => new Date()))()
      let settle!: (f: Frozen) => void
      const promise = new Promise<Frozen>((r) => (settle = r))
      const mine = { id, promise, settle }
      inflight = mine
      const ms = deps.timeoutMs ?? CAPTURE_TIMEOUT_MS
      const timer = setTimeout(() => {
        if (inflight !== mine) return
        inflight = null
        settle(failed(id, `no screenshot: the capture took longer than ${Math.round(ms / 1000)} s`, at))
      }, ms)
      attempt(id, at).then((f) => {
        clearTimeout(timer)
        // Late (timed out or cancelled): dropped.
        if (inflight !== mine) return
        inflight = null
        settle(f)
      })
      return promise
    },
    cancel() {
      if (!inflight) return
      const c = inflight
      inflight = null
      c.settle(failed(c.id, 'cancelled', new Date()))
    }
  }
}
