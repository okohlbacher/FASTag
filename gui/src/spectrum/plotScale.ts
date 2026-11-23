// The stick plot's frame (SVG user units; the element scales to its box);
// the merge graph is as wide (its axis is residues, not m/z).
export const W = 1000
export const PAD = { l: 48, r: 12, t: 56, b: 28 }

/** The m/z range of the whole spectrum @p mz, with a margin. */
export function fullRange(mz: number[]): [number, number] {
  if (mz.length === 0) return [0, 1]
  const pad = Math.max(1, (mz[mz.length - 1] - mz[0]) * 0.03)
  return [Math.max(0, mz[0] - pad), mz[mz.length - 1] + pad]
}
