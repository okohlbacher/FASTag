// The draft a Save sends (feedback_save): the frozen session, the user's
// text and the mark-up, as typed fields only.

import type { Frozen } from './capture'
import type { Shape } from './shapes'
import { toAnnotation } from './shapes'
import { allowParams, appInfo, engineInfo, platformInfo, viewInfo, windowInfo } from './snapshot'
import type { CaptureInfo, FeedbackDraft } from './types'
import type { DraftText, Session } from './useFeedback'

/// The privacy notice the dialog shows; a new wording gets a new version.
export const CONSENT_TEXT_VERSION = 'fastag-feedback-privacy-1'

const cut = (s: string, n: number): string => [...s].slice(0, n).join('')

export interface ImageState {
  // The screenshot as it will be saved (flattened), or null.
  image: HTMLCanvasElement | null
  // Why there is none: the capture failed, or the user removed it.
  removed: boolean
  removedReason?: string | null
  shapes: Shape[]
}

export function captureInfo(f: Frozen, img: ImageState): CaptureInfo {
  const base = {
    method: f.method,
    api: f.api,
    scale: Math.round(f.scale * 1000) / 1000,
    attempt_id: f.attemptId.slice(0, 64),
    captured_utc: f.capturedUtc
  }
  if (img.image) return { ...base, status: f.status, error: f.error ? cut(f.error, 500) : null, width: img.image.width, height: img.image.height }
  if (img.removed) return { ...base, status: 'removed', error: img.removedReason ? cut(img.removedReason, 500) : null, width: 0, height: 0 }
  return { ...base, status: f.status === 'ok' || f.status === 'degraded' ? 'none' : f.status, error: f.error ? cut(f.error, 500) : null, width: 0, height: 0 }
}

export function buildDraft(s: Session, t: DraftText, img: ImageState, w: Window = window): FeedbackDraft {
  const bug = t.kind === 'bug'
  return {
    kind: t.kind,
    title: cut(t.title.trim(), 120),
    description: cut(t.description, 4000),
    steps: bug ? cut(t.steps, 2000) : '',
    expected: bug ? cut(t.expected, 2000) : '',
    actual: bug ? cut(t.actual, 2000) : '',
    app: appInfo(),
    engine: engineInfo(s.bin, s.platform),
    platform: platformInfo(s.platform, w),
    window: windowInfo(s.state, w),
    view: viewInfo(s.state),
    params: allowParams(s.state.values, s.state.input, s.state.out),
    run: s.run,
    log: s.log.slice(-50),
    capture: captureInfo(s.frozen, img),
    annotations: img.image ? img.shapes.slice(0, 100).map(toAnnotation) : [],
    // A report without a screenshot cannot share one.
    share: { ...t.share, screenshot: t.share.screenshot && !!img.image },
    consent_text_version: CONSENT_TEXT_VERSION
  }
}
