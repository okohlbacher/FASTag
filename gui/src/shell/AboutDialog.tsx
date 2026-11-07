// Help > About (GUI-DESIGN 2 "Native menus"): the version, the licence and
// where FASTag comes from. macOS has its own About panel in the app menu
// too; this one is the same on every platform.

import type { JSX } from 'react'
import type { BinaryInfo } from '../types'

export default function AboutDialog({ bin, onClose }: { bin: BinaryInfo | null; onClose(): void }): JSX.Element {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-h"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onClose()
          }
        }}
      >
        <h2 id="about-h">About FASTag</h2>
        <p>
          FASTag {bin?.version ?? ''}: de novo sequence tags from MS2 spectra, with species, digest and label calls.
        </p>
        <p className="muted">
          An OpenMS TOPP tool. MIT licence. By Oliver Kohlbacher and contributors.
          {bin && !bin.ok ? ` The FASTag command-line tool cannot start: ${bin.detail}.` : ''}
        </p>
        <div className="row actions">
          <button type="button" className="secondary" autoFocus onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
