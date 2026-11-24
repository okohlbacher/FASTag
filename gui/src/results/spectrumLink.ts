// A scan cell that opens the Spectrum tab (feedback 20261124T125757Z_882babf9):
// every results table with a spectrum column (Glyco, Triage, Recon, the
// spectra per mass shift) links its scan as the Tags table does, through
// the Results page's own open path. The page gives the link; a table
// outside the page (no provider) shows the scan as plain text.

import { createContext, useContext } from 'react'

export type SpectrumLink =
  // Open @p spectrum (its native ID) in the Spectrum tab.
  | { open(spectrum: string): void }
  // No spectrum to show, and why (the tooltip of the plain scan).
  | { off: string }

export const SpectrumLinkContext = createContext<SpectrumLink | null>(null)

export function useSpectrumLink(): SpectrumLink | null {
  return useContext(SpectrumLinkContext)
}

/// Why a scan is plain text when nothing beside it opens spectra.
export const NO_SPECTRA_FILE = 'No spectra to show: open the tags table of this run to see its spectra'
