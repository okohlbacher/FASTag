// The one capture path: single attempt in flight, native first, the DOM
// fallback, the 5 s timeout, and a late result dropped.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCapturer, type CaptureDeps } from './capture'
import type { NativeCapture } from './types'

const canvas = (w: number, h: number): HTMLCanvasElement => ({ width: w, height: h }) as HTMLCanvasElement
const okNative: NativeCapture = { status: 'ok', method: 'native', api: 'WKWebView.takeSnapshot', width: 2400, height: 1600, scale: 2, error: null, png: new Uint8Array([1]) }
const noNative: NativeCapture = { status: 'failed', method: 'none', api: null, width: 0, height: 0, scale: 0, error: 'no webview', png: null }

function deps(over: Partial<CaptureDeps> = {}): CaptureDeps {
  return {
    native: () => Promise.resolve(okNative),
    decode: () => Promise.resolve(canvas(2400, 1600)),
    dom: () => Promise.resolve(canvas(1200, 800)),
    cssWidth: () => 1200,
    now: () => new Date('2026-11-21T10:00:00.123Z'),
    ...over
  }
}

afterEach(() => vi.useRealTimers())

describe('capture', () => {
  it('takes the native snapshot first', async () => {
    const dom = vi.fn(() => Promise.resolve(canvas(1, 1)))
    const f = await createCapturer(deps({ dom })).capture()
    expect(f).toMatchObject({ status: 'ok', method: 'native', api: 'WKWebView.takeSnapshot', width: 2400, height: 1600, scale: 2, error: null, capturedUtc: '2026-11-21T10:00:00Z' })
    expect(dom).not.toHaveBeenCalled()
  })

  it('marks a view with WebGL or video degraded', async () => {
    const f = await createCapturer(deps({ degraded: () => true })).capture()
    expect(f.status).toBe('degraded')
    expect(f.error).toMatch(/WebGL or video/)
  })

  it('falls back to the DOM rasteriser with the native reason', async () => {
    const f = await createCapturer(deps({ native: () => Promise.resolve(noNative) })).capture()
    expect(f).toMatchObject({ status: 'degraded', method: 'dom', width: 1200, scale: 1 })
    expect(f.error).toContain('no webview')
    const g = await createCapturer(deps({ native: () => Promise.reject(new Error('IPC down')) })).capture()
    expect(g.method).toBe('dom')
    expect(g.error).toContain('IPC down')
  })

  it('reports both reasons when neither method works', async () => {
    const f = await createCapturer(deps({ native: () => Promise.resolve(noNative), dom: () => Promise.reject(new Error('tainted')) })).capture()
    expect(f).toMatchObject({ status: 'failed', method: 'none', image: null })
    expect(f.error).toContain('no webview')
    expect(f.error).toContain('tainted')
  })

  it('runs one capture at a time: a second call gets the same attempt', async () => {
    let release!: (n: NativeCapture) => void
    const native = vi.fn(() => new Promise<NativeCapture>((r) => (release = r)))
    const c = createCapturer(deps({ native }))
    const a = c.capture()
    const b = c.capture()
    expect(a).toBe(b)
    expect(c.busy).toBe(true)
    release(okNative)
    const [x, y] = await Promise.all([a, b])
    expect(x).toBe(y)
    expect(native).toHaveBeenCalledTimes(1)
    expect(c.busy).toBe(false)
    // The next one is a new attempt.
    const zp = c.capture()
    release(okNative)
    const z = await zp
    expect(z.attemptId).not.toBe(x.attemptId)
  })

  it('times out after 5 s with a text-only result and drops the late one', async () => {
    vi.useFakeTimers()
    let release!: (n: NativeCapture) => void
    const decode = vi.fn(() => Promise.resolve(canvas(2400, 1600)))
    const c = createCapturer(deps({ native: () => new Promise<NativeCapture>((r) => (release = r)), decode }))
    const p = c.capture()
    await vi.advanceTimersByTimeAsync(5000)
    const f = await p
    expect(f).toMatchObject({ status: 'failed', method: 'none', image: null })
    expect(f.error).toMatch(/longer than 5 s/)
    expect(c.busy).toBe(false)
    release(okNative)
    await vi.advanceTimersByTimeAsync(10)
    // The late snapshot changed nothing: the next capture is a new attempt.
    const next = c.capture()
    release(okNative)
    expect((await next).attemptId).not.toBe(f.attemptId)
  })

  it('a cancel drops the result', async () => {
    let release!: (n: NativeCapture) => void
    const c = createCapturer(deps({ native: () => new Promise<NativeCapture>((r) => (release = r)) }))
    const p = c.capture()
    c.cancel()
    expect((await p).error).toBe('cancelled')
    release(okNative)
    expect(c.busy).toBe(false)
  })
})
