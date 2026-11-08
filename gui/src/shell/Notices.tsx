// What floats over the window (P2a PR s): the drop target while files are
// dragged over it, what a drop did not take, and the toast when a run or a
// batch finished.

import type { JSX } from 'react'

export interface Toast {
  text: string
  to: 'results' | 'batch'
}

export interface NoticesProps {
  dragOver: boolean
  dropNote: string | null
  toast: Toast | null
  onDismissNote(): void
  onDismissToast(): void
  onOpen(to: Toast['to']): void
}

export default function Notices({ dragOver, dropNote, toast, onDismissNote, onDismissToast, onOpen }: NoticesProps): JSX.Element {
  return (
    <>
    {dragOver && (
      <div className="drop-overlay" aria-hidden="true">
        <p>Drop spectra, a FASTA, a taxonomy, a tags table or a report</p>
      </div>
    )}
    <div className="notices">
      {dropNote && (
        <div className="notice" role="alert">
          <span>{dropNote}</span>
          <button type="button" className="link" onClick={() => onDismissNote()}>
            Dismiss
          </button>
        </div>
      )}
      {toast && (
        <div className="toast" role="status" aria-label="Run finished">
          <span>{toast.text}</span>
          <button
            type="button"
            className="secondary small"
            onClick={() => {
              onOpen(toast.to)
            }}
          >
            {toast.to === 'batch' ? 'Open batch' : 'Open results'}
          </button>
          <button type="button" className="link" onClick={onDismissToast}>
            Dismiss
          </button>
        </div>
      )}
    </div>
    </>
  )
}
