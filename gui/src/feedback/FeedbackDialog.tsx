// The Feedback dialog (skill gui-feedback 3-5): describe the problem, mark
// up or remove the screenshot, choose what sharing would include, Save
// (local only). Sharing is a second step: the backend's public export shown
// field by field, a separate confirmation that it becomes a public GitHub
// issue, then Open issue draft (the issue form with title, id and kind),
// Copy diagnostics (the same export JSON) and Mark as submitted. The saved
// reports can be listed, revealed and deleted here and from About.

import { useEffect, useLayoutEffect, useRef, useState, type JSX, type ReactNode } from 'react'
import { useModal } from '../shell/useModal'
import { buildDraft, CONSENT_TEXT_VERSION, type ImageState } from './draft'
import { encodePng } from './image'
import MarkupEditor from './MarkupEditor'
import { SCRUB_TAGS } from './scrub'
import { nextNumber } from './shapes'
import type { FeedbackExported, FeedbackKind, FeedbackSaved, FeedbackSummary, Share } from './types'
import type { DraftText, Session } from './useFeedback'

const KINDS: readonly { id: FeedbackKind; label: string }[] = [
  { id: 'bug', label: 'Something does not work (bug)' },
  { id: 'ui', label: 'The interface is unclear' },
  { id: 'idea', label: 'An idea' },
  { id: 'question', label: 'A question' }
]

const SHARE_ITEMS: readonly { key: keyof Share; label: string; hint: string }[] = [
  { key: 'screenshot', label: 'Screenshot', hint: 'Screenshots of research data can identify people or samples. Redact first; never share patient-identifiable content.' },
  { key: 'diagnostics', label: 'Diagnostics', hint: 'App and engine version, system, the view, the settings as typed values (paths only as their role and extension), the run on screen with its command line redacted.' },
  { key: 'log', label: 'Log', hint: 'The last errors and warnings of this session, scrubbed of home folders, user names, e-mail addresses and tokens.' }
]

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e))
const kb = (n: number): string => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

/// A canvas drawn from @p image at most @p max px wide.
function Thumb({ image, max = 240, label }: { image: HTMLCanvasElement; max?: number; label: string }): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  const k = Math.min(1, max / image.width)
  const w = Math.max(1, Math.round(image.width * k))
  const h = Math.max(1, Math.round(image.height * k))
  useLayoutEffect(() => {
    const c = ref.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx) return
    const dpr = window.devicePixelRatio || 1
    c.width = Math.round(w * dpr)
    c.height = Math.round(h * dpr)
    ctx.drawImage(image, 0, 0, c.width, c.height)
  }, [image, w, h])
  return <canvas ref={ref} className="fb-thumb" style={{ width: w, height: h }} role="img" aria-label={label} />
}

/// Text with the scrubber's <tags> highlighted.
function Scrubbed({ text }: { text: string }): JSX.Element {
  const parts: ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(SCRUB_TAGS)) {
    if (m.index! > last) parts.push(text.slice(last, m.index))
    parts.push(
      <mark key={m.index} title="Replaced by the scrubber">
        {m[0]}
      </mark>
    )
    last = m.index! + m[0].length
  }
  parts.push(text.slice(last))
  return <>{parts}</>
}

function value(v: unknown): string {
  if (v === null) return 'none'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/// The export, field by field.
function Preview({ json, image, exported }: { json: Record<string, unknown>; image: HTMLCanvasElement | null; exported: FeedbackExported }): JSX.Element {
  return (
    <dl className="fb-preview" aria-label="What sharing sends">
      {Object.entries(json).map(([k, v]) => (
        <div key={k} className="fb-field" data-field={k}>
          <dt>{k}</dt>
          <dd>
            {k === 'log' && Array.isArray(v) ? (
              <ol className="fb-log">
                {v.map((l, i) => (
                  <li key={i}>
                    <Scrubbed text={String(l)} />
                  </li>
                ))}
              </ol>
            ) : v && typeof v === 'object' && !Array.isArray(v) ? (
              <ul className="fb-kv">
                {Object.entries(v as Record<string, unknown>).map(([a, b]) => (
                  <li key={a}>
                    <span className="muted">{a}</span> {value(b)}
                  </li>
                ))}
              </ul>
            ) : Array.isArray(v) ? (
              <code>{v.map(String).join(' ')}</code>
            ) : (
              value(v)
            )}
          </dd>
        </div>
      ))}
      {exported.image && (
        <div className="fb-field" data-field="screenshot.png">
          <dt>screenshot.png</dt>
          <dd>
            {image && <Thumb image={image} max={180} label="The screenshot that is attached" />}
            <span className="muted">
              {' '}
              {exported.image.width}×{exported.image.height} px, {kb(exported.image.bytes)}
            </span>
          </dd>
        </div>
      )}
    </dl>
  )
}

function Privacy(): JSX.Element {
  return (
    <details className="fb-privacy">
      <summary>Privacy notice</summary>
      <p>
        <b>What:</b> your text, and, as you choose, the screenshot (with your mark-up and redactions), diagnostics and the log.{' '}
        <b>Why:</b> so the FASTag developers can reproduce and fix what you saw. <b>Where:</b> Save keeps the report on this computer
        only, in the app's data folder under <code>feedback</code>; nothing is sent. Sharing opens a GitHub issue form in your browser:
        what you attach becomes a <b>public</b> issue, visible to anyone and hard to delete. <b>Retention:</b> local reports are kept
        for 180 days or until you delete them. <b>Contact:</b> the FASTag maintainers through the repository's security policy
        (SECURITY.md) for anything that must not be public.
      </p>
      <p className="muted">Notice {CONSENT_TEXT_VERSION}</p>
    </details>
  )
}

/// The saved reports: open the folder, delete one, delete all.
function Reports({ onBack, backLabel }: { onBack(): void; backLabel: string }): JSX.Element {
  const [list, setList] = useState<FeedbackSummary[] | null>(null)
  const [ask, setAsk] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const load = (): void => {
    window.fastag.feedbackList().then(setList, (e) => setNote(`Cannot list the reports: ${msg(e)}`))
  }
  useEffect(load, [])
  const act = async (f: () => Promise<unknown>, done: string): Promise<void> => {
    try {
      await f()
      setNote(done)
    } catch (e) {
      setNote(msg(e))
    }
    setAsk(null)
    load()
  }
  return (
    <div className="fb-reports">
      <h3 id="fb-reports-h" tabIndex={-1}>
        Feedback reports on this computer
      </h3>
      <p className="hint">Kept for 180 days or until deleted. Deleting removes the report, its screenshot and its zip.</p>
      {list && list.length === 0 && <p className="muted">No reports.</p>}
      {list && list.length > 0 && (
        <ul className="fb-report-list">
          {list.map((r) => (
            <li key={r.id} data-report={r.id}>
              <span>
                <b>{r.title}</b> <span className="muted">({r.kind}, {r.created_utc.replace('T', ' ').replace('Z', ' UTC')}, {r.status.replace('_', ' ')})</span>
              </span>
              <span className="row">
                <button type="button" className="secondary small" onClick={() => void act(() => window.fastag.feedbackReveal(r.id), 'Shown in the file manager.')}>
                  Open folder
                </button>
                {ask === r.id ? (
                  <button type="button" className="danger small" onClick={() => void act(() => window.fastag.feedbackDelete(r.id), `Deleted “${r.title}”.`)}>
                    Delete for good
                  </button>
                ) : (
                  <button type="button" className="secondary small" onClick={() => setAsk(r.id)} aria-label={`Delete ${r.title}`}>
                    Delete
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p role="status" className="hint" aria-live="polite">
        {note}
      </p>
      <div className="row actions">
        {list && list.length > 0 &&
          (ask === '*' ? (
            <button type="button" className="danger" onClick={() => void act(() => window.fastag.feedbackDeleteAll(), 'Every report deleted.')}>
              Delete all {list.length} for good
            </button>
          ) : (
            <button type="button" className="secondary" onClick={() => setAsk('*')}>
              Delete all…
            </button>
          ))}
        <button type="button" className="secondary" onClick={onBack}>
          {backLabel}
        </button>
      </div>
    </div>
  )
}

type Step = 'compose' | 'markup' | 'share' | 'reports'

interface Props {
  // null: the reports list alone (About > Feedback reports…).
  session: Session | null
  text: DraftText
  setText(f: (t: DraftText) => DraftText): void
  onSaved(): void
  onClose(): void
}

export default function FeedbackDialog({ session, text, setText, onSaved, onClose }: Props): JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  const [step, setStep] = useState<Step>(session ? 'compose' : 'reports')
  const [prev, setPrev] = useState<Step>('compose')
  const frozen = session?.frozen
  const [img, setImg] = useState<ImageState>(() => ({ image: frozen?.image ?? null, removed: false, shapes: [] }))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState<FeedbackSaved | null>(null)
  const [savedText, setSavedText] = useState<DraftText | null>(null)
  const [exported, setExported] = useState<FeedbackExported | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [issueUrl, setIssueUrl] = useState('')
  const [note, setNote] = useState('')
  const [submitted, setSubmitted] = useState(false)

  const onKeyDown = useModal(box, () => {
    if (step === 'markup') setStep('compose')
    else if (step === 'reports' && session) setStep(prev)
    else onClose()
  })

  // A new step gets focus on its heading (the compose step on its title field).
  const firstStep = useRef(true)
  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false
      if (step === 'compose') return
    }
    const sel = step === 'compose' ? '#fb-title' : step === 'share' ? '#fb-share-h' : step === 'reports' ? '#fb-reports-h' : '#fb-markup-h'
    setTimeout(() => box.current?.querySelector<HTMLElement>(sel)?.focus())
  }, [step])

  const share = savedText?.share ?? text.share
  const exportNow = async (id: string, inc: Share): Promise<void> => {
    try {
      setExported(await window.fastag.feedbackExport(id, inc))
    } catch (e) {
      setError(`Cannot build the export: ${msg(e)}`)
    }
  }

  async function save(): Promise<void> {
    if (!session || busy) return
    setError('')
    if (!text.title.trim()) {
      setError('Give the report a title.')
      box.current?.querySelector<HTMLElement>('#fb-title')?.focus()
      return
    }
    setBusy(true)
    try {
      let png: Uint8Array | null = null
      let state = img
      if (img.image) {
        try {
          png = await encodePng(img.image)
        } catch (e) {
          state = { image: null, removed: true, removedReason: `the screenshot could not be encoded: ${msg(e)}`, shapes: [] }
          setImg(state)
        }
      }
      const draft = buildDraft(session, text, state)
      const r = await window.fastag.feedbackSave(draft, png)
      setSaved(r)
      setSavedText(text)
      onSaved()
      await exportNow(r.id, text.share)
      setStep('share')
    } catch (e) {
      setError(`Not saved: ${msg(e)}`)
    } finally {
      setBusy(false)
    }
  }

  async function toggleShare(key: keyof Share, on: boolean): Promise<void> {
    if (savedText && saved) {
      const next = { ...savedText, share: { ...savedText.share, [key]: on } }
      setSavedText(next)
      await exportNow(saved.id, next.share)
    } else setText((t) => ({ ...t, share: { ...t.share, [key]: on } }))
  }

  async function openDraft(): Promise<void> {
    if (!saved || !savedText || !confirmed) return
    setError('')
    try {
      const ok = await window.fastag.openFeedbackIssue({ title: savedText.title, reportId: saved.id, kind: savedText.kind })
      if (!ok) throw new Error('the issue address could not be built')
      await window.fastag.feedbackSetStatus(saved.id, 'handoff_opened')
      await window.fastag.feedbackReveal(saved.id).catch(() => {})
      setNote('The issue form is open in your browser, and the zip is shown in the file manager: drop it into the form’s upload field, paste the diagnostics, and submit. Offline? The report stays saved; share it later from here.')
    } catch (e) {
      setError(`Cannot open the issue draft: ${msg(e)}. The report stays saved; the zip is at ${exported?.zip ?? 'its folder'}.`)
    }
  }

  async function copyDiagnostics(): Promise<void> {
    if (!exported) return
    try {
      await navigator.clipboard.writeText(exported.json)
      setNote('The diagnostics (export.json) are on the clipboard: paste them into the form’s Diagnostics field.')
    } catch {
      setError('The clipboard refused the diagnostics.')
    }
  }

  async function markSubmitted(): Promise<void> {
    if (!saved) return
    setError('')
    try {
      await window.fastag.feedbackSetStatus(saved.id, 'submitted', issueUrl.trim())
      setSubmitted(true)
      setNote('Marked as submitted. Thank you.')
    } catch (e) {
      setError(msg(e))
    }
  }

  const exportJson = exported ? (JSON.parse(exported.json) as Record<string, unknown>) : null
  const shapes = img.shapes
  const set = (k: keyof DraftText) => (e: { target: { value: string } }) => setText((t) => ({ ...t, [k]: e.target.value }))
  const f = frozen
  const captureLine = !f
    ? ''
    : img.image
      ? f.status === 'degraded'
        ? `Screenshot (${f.method === 'dom' ? 'drawn from the page' : 'webview'}): ${f.error ?? 'may differ from the window'}`
        : null
      : img.removed
        ? `No screenshot: ${img.removedReason ?? 'removed'}.`
        : `No screenshot: ${f.error ?? 'the capture failed'}. The report is saved as text only.`

  return (
    <div className="modal-backdrop fb-backdrop">
      <div className="modal fb-dialog" role="dialog" aria-modal="true" aria-labelledby="fb-h" ref={box} onKeyDown={onKeyDown}>
        <h2 id="fb-h">{session ? 'Feedback' : 'Feedback reports'}</h2>
        <p className="fb-error" role="alert" aria-live="assertive">
          {error}
        </p>

        {step === 'markup' && img.image && (
          <MarkupEditor
            image={img.image}
            numberBase={nextNumber(shapes) - 1}
            onCancel={() => setStep('compose')}
            onDone={(r) => {
              if ('error' in r) {
                setImg({ image: null, removed: true, removedReason: `the mark-up could not be applied (${r.error}); the screenshot was dropped`, shapes: [] })
                setError('The mark-up could not be applied, so the screenshot was dropped.')
              } else setImg({ image: r.image, removed: false, shapes: [...shapes, ...r.shapes] })
              setStep('compose')
            }}
          />
        )}

        {step === 'compose' && session && (
          <form
            className="fb-compose"
            onSubmit={(e) => {
              e.preventDefault()
              void save()
            }}
          >
            <div className="fb-cols">
              <div className="fb-text">
                <label>
                  Kind
                  <select value={text.kind} onChange={(e) => setText((t) => ({ ...t, kind: e.target.value as FeedbackKind }))}>
                    {KINDS.map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Title
                  <input id="fb-title" type="text" autoFocus maxLength={120} aria-required="true" value={text.title} onChange={set('title')} placeholder="In a few words" />
                </label>
                <label>
                  Description
                  <textarea rows={4} maxLength={4000} value={text.description} onChange={set('description')} placeholder="What happened? Refer to the numbered marks (“see 2”)." />
                </label>
                {text.kind === 'bug' && (
                  <>
                    <label>
                      Steps to reproduce
                      <textarea rows={3} maxLength={2000} value={text.steps} onChange={set('steps')} />
                    </label>
                    <label>
                      Expected
                      <textarea rows={2} maxLength={2000} value={text.expected} onChange={set('expected')} />
                    </label>
                    <label>
                      Actual
                      <textarea rows={2} maxLength={2000} value={text.actual} onChange={set('actual')} />
                    </label>
                  </>
                )}
              </div>
              <div className="fb-shot">
                {img.image && <Thumb image={img.image} label={`Screenshot of the window, ${img.image.width} by ${img.image.height} pixels, ${shapes.length} marks`} />}
                {captureLine && (
                  <p className="hint fb-capture-note" role="status">
                    {captureLine}
                  </p>
                )}
                {img.image && (
                  <div className="row">
                    <button type="button" className="secondary small" onClick={() => setStep('markup')}>
                      Mark up…
                    </button>
                    <button
                      type="button"
                      className="secondary small"
                      onClick={() => setImg({ image: null, removed: true, removedReason: 'removed by the user', shapes: [] })}
                    >
                      Remove screenshot
                    </button>
                  </div>
                )}
                <fieldset className="fb-include">
                  <legend>What is included when you share</legend>
                  {SHARE_ITEMS.map((s) => (
                    <label key={s.key} className="fb-check">
                      <input
                        type="checkbox"
                        name={`share-${s.key}`}
                        checked={share[s.key] && (s.key !== 'screenshot' || !!img.image)}
                        disabled={s.key === 'screenshot' && !img.image}
                        onChange={(e) => void toggleShare(s.key, e.target.checked)}
                      />
                      <span>
                        {s.label}
                        <span className="hint"> {s.hint}</span>
                      </span>
                    </label>
                  ))}
                </fieldset>
                <Privacy />
              </div>
            </div>
            <p className="hint">Save keeps the report on this computer only. Nothing is sent.</p>
            <div className="row actions">
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setPrev('compose')
                  setStep('reports')
                }}
              >
                Saved reports…
              </button>
              <span className="spacer" />
              <button type="button" className="secondary" onClick={onClose}>
                Close
              </button>
              <button type="submit" disabled={busy}>
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        )}

        {step === 'share' && saved && savedText && (
          <div className="fb-share">
            <h3 id="fb-share-h" tabIndex={-1}>
              Saved. Share it?
            </h3>
            <p className="hint">
              The report is saved on this computer ({saved.folder}). To share it, review exactly what would be sent: this is the
              file <code>export.json</code> in <code>{exported?.zip ?? '…'}</code>.
            </p>
            <fieldset className="fb-include">
              <legend>Included</legend>
              {SHARE_ITEMS.map((s) => (
                <label key={s.key} className="fb-check">
                  <input
                    type="checkbox"
                    name={`share-${s.key}`}
                    checked={savedText.share[s.key] && (s.key !== 'screenshot' || !!img.image)}
                    disabled={s.key === 'screenshot' && !img.image}
                    onChange={(e) => void toggleShare(s.key, e.target.checked)}
                  />
                  <span>{s.label}</span>
                </label>
              ))}
            </fieldset>
            {exportJson && exported && <Preview json={exportJson} image={img.image} exported={exported} />}
            <label className="fb-check fb-confirm">
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              <span>
                This becomes a public GitHub issue, visible to anyone and hard to delete. I reviewed it and it holds no personal or
                patient data.
              </span>
            </label>
            <div className="row">
              <button type="button" onClick={() => void openDraft()} disabled={!confirmed || !exported}>
                Open issue draft
              </button>
              <button type="button" className="secondary" onClick={() => void copyDiagnostics()} disabled={!exported}>
                Copy diagnostics
              </button>
            </div>
            <div className="row fb-submitted">
              <label>
                Issue address
                <input type="url" value={issueUrl} placeholder="https://github.com/okohlbacher/FASTag/issues/123" onChange={(e) => setIssueUrl(e.target.value)} disabled={submitted} />
              </label>
              <button type="button" className="secondary" onClick={() => void markSubmitted()} disabled={!issueUrl.trim() || submitted}>
                Mark as submitted
              </button>
            </div>
            <p className="hint" role="status" aria-live="polite">
              {note}
            </p>
            <div className="row actions">
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setPrev('share')
                  setStep('reports')
                }}
              >
                Saved reports…
              </button>
              <span className="spacer" />
              <button type="button" onClick={onClose}>
                Done
              </button>
            </div>
          </div>
        )}

        {step === 'reports' && <Reports onBack={session ? () => setStep(prev) : onClose} backLabel={session ? 'Back' : 'Close'} />}
      </div>
    </div>
  )
}
