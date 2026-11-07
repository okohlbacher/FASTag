// Whether the CLI can dump spectra (P4): asked once per CLI through the
// backend's --helphelp probe (spectrum.rs spectrum_support), never read off
// the version string. Without -dump_spectrum the Spectrum tab is hidden and
// the Tags table's row action says SPECTRUM_NEEDS (GUI-DESIGN S5).

import { useEffect, useState } from 'react'
import type { BinaryInfo, SpectrumSupport } from '../types'

export const SPECTRUM_NEEDS = 'Spectrum view needs FASTag 1.17 or later'

/** The answer for the CLI @p bin describes; null while asking (or before
 *  the CLI is known). A CLI that cannot run cannot dump either. */
export function useSpectrumSupport(bin: BinaryInfo | null): SpectrumSupport | null {
  const [s, setS] = useState<SpectrumSupport | null>(null)
  const key = bin ? `${bin.ok}\u0000${bin.bin}\u0000${bin.version ?? ''}` : null
  useEffect(() => {
    setS(null)
    if (!bin) return
    if (!bin.ok) {
      setS({ supported: false, probed: false, detail: bin.detail })
      return
    }
    let live = true
    window.fastag
      .spectrumSupport()
      .then((r) => live && setS(r))
      .catch((e: unknown) => live && setS({ supported: false, probed: false, detail: e instanceof Error ? e.message : String(e) }))
    return () => {
      live = false
    }
    // By the CLI's identity: a new probe of the same CLI asks nothing.
  }, [key])
  return s
}
