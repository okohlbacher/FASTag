// What floats over the window (P2a PR s): the drop target while files are
// dragged over it, what a drop did not take, and the toast when a run or a
// batch finished.

import { useEffect, useRef, type JSX, type RefObject } from 'react'

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

/// The visible view's action bar (sticky at the bottom of Setup and Batch),
/// or null where the view has none.
function visibleActionbar(): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>('.actionbar')) {
    if (el.getClientRects().length > 0) return el
  }
  return null
}

/// Keeps `--actionbar-h` on the notices at the height of the visible action
/// bar, so a toast or a drop note floats above Back, Run and Next instead of
/// covering them (the bar grows when the plan wraps or a hint shows).
function useAboveActionbar(ref: RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    const box = ref.current
    if (!box) return
    let bar: HTMLElement | null = null
    const set = (): void => {
      const h = bar ? Math.ceil(bar.getBoundingClientRect().height) : 0
      box.style.setProperty('--actionbar-h', `${h}px`)
    }
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(set)
    const rebind = (): void => {
      const next = visibleActionbar()
      if (next !== bar) {
        if (bar) resize?.unobserve(bar)
        bar = next
        if (bar) resize?.observe(bar)
      }
      set()
    }
    rebind()
    // A view switch (hidden) or a step that mounts another bar; once a frame.
    let frame = 0
    const later = (): void => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        rebind()
      })
    }
    const mut = typeof MutationObserver === 'undefined' ? null : new MutationObserver(later)
    mut?.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden'] })
    window.addEventListener('resize', rebind)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      mut?.disconnect()
      resize?.disconnect()
      window.removeEventListener('resize', rebind)
    }
  }, [ref])
}

export default function Notices({ dragOver, dropNote, toast, onDismissNote, onDismissToast, onOpen }: NoticesProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useAboveActionbar(ref)
  return (
    <>
    {dragOver && (
      <div className="drop-overlay" aria-hidden="true">
        <p>Drop spectra, a FASTA, a taxonomy, a tags table or a report</p>
      </div>
    )}
    <div className="notices" ref={ref}>
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
