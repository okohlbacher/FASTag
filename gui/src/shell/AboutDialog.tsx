// Help > About (GUI-DESIGN 2 "Native menus"): the version, the licence and
// where FASTag comes from. macOS has its own About panel in the app menu
// too; this one is the same on every platform.

import { useRef, type JSX } from 'react'
import { useModal } from './useModal'
import type { BinaryInfo } from '../types'

// RawFileReader distribution licence, section 3.2: shown verbatim in the About
// box of software that distributes it (the CLI prints it in --version/--help).
export const THERMO_NOTICE =
  'RawFileReader reading tool. Copyright \u00a9 2016 by Thermo Fisher Scientific, Inc. All rights reserved.'

export default function AboutDialog({ bin, onClose, onFeedbackReports }: { bin: BinaryInfo | null; onClose(): void; onFeedbackReports?(): void }): JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  const onKeyDown = useModal(box, onClose)
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-h"
        ref={box}
        onKeyDown={onKeyDown}
      >
        <h2 id="about-h">About FASTag</h2>
        <p>
          FASTag {bin?.version ?? ''}: de novo sequence tags from MS2 spectra, with species, digest and label calls.
        </p>
        <p className="muted">
          An OpenMS TOPP tool. MIT licence. By Oliver Kohlbacher and contributors.
          {bin && !bin.ok ? ` The FASTag command-line tool cannot start: ${bin.detail}.` : ''}
        </p>
        <p className="muted">
          Thermo .raw input, in the builds that include it: {THERMO_NOTICE}
        </p>
        <div className="row actions">
          {onFeedbackReports && (
            <button type="button" className="secondary" onClick={onFeedbackReports}>
              Feedback reports…
            </button>
          )}
          <button type="button" className="secondary" autoFocus onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
