// The binary frame of feedback_capture's reply and feedback_save's request
// (src-tauri/src/feedback.rs frame): [u32 LE length of the JSON][JSON][PNG].
// The PNG crosses the IPC as raw bytes, not as a JSON number array or base64.

export function frame(json: unknown, png: Uint8Array | null): Uint8Array {
  const j = new TextEncoder().encode(JSON.stringify(json))
  const out = new Uint8Array(4 + j.length + (png?.length ?? 0))
  new DataView(out.buffer).setUint32(0, j.length, true)
  out.set(j, 4)
  if (png) out.set(png, 4 + j.length)
  return out
}

export function unframe<T>(buf: ArrayBuffer | Uint8Array): { json: T; png: Uint8Array | null } {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  if (b.length < 4) throw new Error('empty frame')
  const n = new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(0, true)
  if (4 + n > b.length) throw new Error('truncated frame')
  const json = JSON.parse(new TextDecoder().decode(b.subarray(4, 4 + n))) as T
  const rest = b.subarray(4 + n)
  return { json, png: rest.length ? rest.slice() : null }
}
