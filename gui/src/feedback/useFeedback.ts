// The feedback session of the window: one capture path for the top bar's
// Feedback button, Help > Send Feedback… and Cmd/Ctrl+Shift+F (capture.ts),
// the state frozen at that moment (snapshot.ts) and the dialog's text,
// kept until a report is saved (so closing the dialog loses nothing).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BinaryInfo } from '../types'
import { createCapturer, type Frozen } from './capture'
import { recent } from './consoleRing'
import { domCapture, holdsAcceleratedContent } from './domCapture'
import { decodePng } from './image'
import type { AppState } from './snapshot'
import { runInfo, scrubbedLog } from './snapshot'
import type { FeedbackKind, FeedbackPlatform, LogEntry, RunInfo, Share } from './types'

export interface DraftText {
  kind: FeedbackKind
  title: string
  description: string
  steps: string
  expected: string
  actual: string
  share: Share
}

/// Sharing defaults: screenshot off, diagnostics on, log off.
export const DEFAULT_SHARE: Share = { screenshot: false, diagnostics: true, log: false }

export const emptyText = (): DraftText => ({
  kind: 'bug',
  title: '',
  description: '',
  steps: '',
  expected: '',
  actual: '',
  share: { ...DEFAULT_SHARE }
})

/// What the dialog shows: everything frozen when the report was asked for.
export interface Session {
  frozen: Frozen
  state: AppState
  log: LogEntry[]
  platform: FeedbackPlatform | null
  run: RunInfo | null
  bin: BinaryInfo | null
}

export interface Feedback {
  session: Session | null
  capturing: boolean
  text: DraftText
  setText: (f: (t: DraftText) => DraftText) => void
  trigger: () => void
  close: () => void
  // A report was saved: the next one starts with empty text.
  saved: () => void
  // The reports list without a new report (About > Feedback reports…).
  openReports: () => void
  reportsOnly: boolean
}

export function useFeedback(getState: () => AppState, bin: BinaryInfo | null): Feedback {
  const [session, setSession] = useState<Session | null>(null)
  const [reportsOnly, setReportsOnly] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [text, setTextState] = useState<DraftText>(emptyText)
  const stateRef = useRef(getState)
  stateRef.current = getState
  const binRef = useRef(bin)
  binRef.current = bin
  const openRef = useRef(false)
  openRef.current = session !== null || reportsOnly
  const capturer = useMemo(
    () =>
      createCapturer({
        native: () => window.fastag.feedbackCapture(),
        decode: decodePng,
        dom: () => domCapture(),
        degraded: () => holdsAcceleratedContent()
      }),
    []
  )
  const cancelled = useRef(false)

  // Esc while the screenshot is taken: no dialog, the result is dropped.
  useEffect(() => {
    if (!capturing) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      cancelled.current = true
      capturer.cancel()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [capturing, capturer])

  const trigger = useCallback(() => {
    if (openRef.current || capturer.busy) return
    // Frozen now, before the capture is awaited: the view, the parameters
    // and the log as they are at this moment.
    const state = stateRef.current()
    const raw = recent()
    cancelled.current = false
    setCapturing(true)
    const platform = window.fastag.feedbackPlatform().catch(() => null)
    const record = state.running ? Promise.resolve(null) : window.fastag.feedbackRun(state.shownOut).catch(() => null)
    void capturer.capture().then(async (frozen) => {
      const [p, r] = await Promise.all([platform, record])
      setCapturing(false)
      if (cancelled.current) return
      setSession({
        frozen,
        state,
        log: scrubbedLog(raw, { home: p?.home, user: p?.user }),
        platform: p,
        run: runInfo(state, r),
        bin: binRef.current
      })
    })
  }, [capturer])

  return {
    session,
    capturing,
    text,
    setText: (f) => setTextState(f),
    trigger,
    close: () => {
      setSession(null)
      setReportsOnly(false)
    },
    saved: () => setTextState(emptyText()),
    openReports: () => {
      if (!openRef.current) setReportsOnly(true)
    },
    reportsOnly
  }
}
