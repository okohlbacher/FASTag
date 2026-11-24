// The feedback session of the window: one capture path for the top bar's
// Feedback button, Help > Send Feedback… and Cmd/Ctrl+Shift+F (capture.ts),
// the state frozen at that moment (snapshot.ts) and the dialog's text,
// kept until a report is saved (so closing the dialog loses nothing). The
// dialog is a floating, non-modal panel: Retake screenshot hides it, takes
// a new capture of the window as it is now and shows it again; where the
// panel sat is kept for the session (floating.ts).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BinaryInfo } from '../types'
import { createCapturer, type Frozen } from './capture'
import { recent } from './consoleRing'
import { domCapture, holdsAcceleratedContent } from './domCapture'
import type { Layout, Rect, Remembered } from './floating'
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
  // Retake screenshot: the panel hides, the window is captured again (with
  // the view, settings and log of now), the panel comes back. False when
  // the new capture was cancelled (Esc) and the old one stays.
  retake: () => Promise<boolean>
  // The panel is hidden while a retake captures the window.
  retaking: boolean
  // Counts the triggers that came while the panel was open: the panel then
  // expands and takes focus instead of a second report starting.
  raised: number
  // Where the panel sat, per layout, for the session.
  layouts: Remembered
  setLayout: (layout: Layout, r: Rect) => void
}

/// After the next paint: the panel hidden for a retake is gone from the
/// window before the native snapshot is taken.
const nextPaint = (): Promise<void> =>
  new Promise((r) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => requestAnimationFrame(() => r())) : setTimeout(r)))

export function useFeedback(getState: () => AppState, bin: BinaryInfo | null): Feedback {
  const [session, setSession] = useState<Session | null>(null)
  const [reportsOnly, setReportsOnly] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [retaking, setRetaking] = useState(false)
  const [raised, setRaised] = useState(0)
  const [layouts, setLayouts] = useState<Remembered>({})
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
  // Where focus goes back to: the control that had it, else the top bar's
  // Feedback button (WebKit does not focus a clicked button; the menu and
  // the shortcut have no control of their own).
  const returnTo = useRef<HTMLElement | null>(null)
  const remember = (): void => {
    const a = document.activeElement
    returnTo.current = a instanceof HTMLElement && a !== document.body ? a : document.querySelector<HTMLElement>('.feedback-btn')
  }
  const restore = (): void => {
    const el = returnTo.current
    setTimeout(() => {
      // The control is gone (About's Feedback reports… closed About): the
      // Feedback button.
      const to = el?.isConnected ? el : document.querySelector<HTMLElement>('.feedback-btn')
      if (to && !to.closest('[hidden], [inert]')) to.focus()
    })
  }

  // Esc while the screenshot is taken: no dialog, the result is dropped (a
  // retake keeps the screenshot it had).
  useEffect(() => {
    if (!capturing && !retaking) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      cancelled.current = true
      capturer.cancel()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [capturing, retaking, capturer])

  // One capture with the state frozen now, before it is awaited: the view,
  // the parameters and the log as they are at this moment. Null when it
  // was cancelled (the caller clears cancelled first).
  const freeze = useCallback(async (): Promise<Session | null> => {
    const state = stateRef.current()
    const raw = recent()
    const platform = window.fastag.feedbackPlatform().catch(() => null)
    const record = state.running ? Promise.resolve(null) : window.fastag.feedbackRun(state.shownOut).catch(() => null)
    const frozen = await capturer.capture()
    const [p, r] = await Promise.all([platform, record])
    if (cancelled.current) return null
    return { frozen, state, log: scrubbedLog(raw, { home: p?.home, user: p?.user }), platform: p, run: runInfo(state, r), bin: binRef.current }
  }, [capturer])

  const trigger = useCallback(() => {
    if (openRef.current) {
      setRaised((n) => n + 1)
      return
    }
    if (capturer.busy) return
    remember()
    cancelled.current = false
    setCapturing(true)
    void freeze().then((s) => {
      setCapturing(false)
      if (s) setSession(s)
    })
  }, [capturer, freeze])

  const retake = useCallback(async (): Promise<boolean> => {
    if (capturer.busy) return false
    cancelled.current = false
    setRetaking(true)
    try {
      await nextPaint()
      // Esc before the capture started.
      if (cancelled.current) return false
      const s = await freeze()
      if (!s) return false
      setSession((old) => (old ? s : old))
      return true
    } finally {
      setRetaking(false)
    }
  }, [capturer, freeze])

  return {
    session,
    capturing,
    text,
    setText: (f) => setTextState(f),
    trigger,
    close: () => {
      setSession(null)
      setReportsOnly(false)
      restore()
    },
    saved: () => setTextState(emptyText()),
    openReports: () => {
      if (openRef.current) return
      remember()
      setReportsOnly(true)
    },
    reportsOnly,
    retake,
    retaking,
    raised,
    layouts,
    setLayout: (layout, r) => setLayouts((l) => ({ ...l, [layout]: r }))
  }
}
