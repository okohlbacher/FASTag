// The failure banner (moved out of ResultTabs.tsx, P2a PR s, unchanged): what
// failed, FASTag's own reason per job, Show full log and Copy command. Over
// the result tabs after a single run; on the Batch view beside the queue
// while there is one.

import type { JSX } from 'react'
import { baseName } from '../digestReport'
import { IconClose, IconError } from '../icons'
import { HelpLink } from '../help/HelpLink'
import { faqForMessage } from '../help/faq'
import { shellLine } from '../app/format'
import { focusLater } from '../app/focus'
import type { Failure } from '../run/useRun'
import { RefusalBlock } from '../inspector/InspectorPanel'

export interface FailureBannerProps {
  failure: Failure
  copied: 'yes' | 'no' | null
  setFailure(f: Failure | null): void
  setCopied(c: 'yes' | 'no' | null): void
  openLog(job: string | null | undefined): void
  // Where focus goes when the banner is dismissed.
  focusAfter(): HTMLElement | null
}

export default function FailureBanner(p: FailureBannerProps): JSX.Element {
  const { failure, copied } = p
  return (
    <div className="failure" role="alert">
      <div className="failure-head">
        <IconError size={18} />
        <strong>{failure.title}</strong>
        <button
          className="icon-btn"
          onClick={() => {
            p.setFailure(null)
            focusLater(p.focusAfter)
          }}
          aria-label="Dismiss"
        >
          <IconClose />
        </button>
      </div>
      {failure.reasons.length === 0 && <HelpLink to="faq-run-failed">What to do</HelpLink>}
      {failure.reasons.map((r, i) => (
        <div className="failure-reason" key={i}>
          {r.what && <div className="what">{r.what}</div>}
          {/* FASTag refused the input (exit 11): what to run first. */}
          {r.refusal && <RefusalBlock windows={r.refusal.windows} medianWidth={r.refusal.medianWidth} command={r.refusal.command} />}
          {r.text && (
            <>
              <div className="why-label">FASTag&apos;s reason:</div>
              <code className="why">{r.text}</code>
            </>
          )}
          <HelpLink to={faqForMessage(r.text)}>What to do</HelpLink>
          {r.input && failure.reasons.length > 1 && (
            <>
              {' '}
              <button type="button" className="link" onClick={() => p.openLog(r.input)}>
                Log of {baseName(r.input)}
              </button>
            </>
          )}
        </div>
      ))}
      <div className="failure-actions">
        <button className="secondary" onClick={() => p.openLog(failure.logOf)}>
          Show full log
        </button>
        {failure.command && (
          <button
            className="secondary"
            onClick={() =>
              navigator.clipboard
                .writeText(shellLine(failure.command!))
                .then(() => p.setCopied('yes'), () => p.setCopied('no'))
            }
          >
            {copied === 'yes' ? 'Copied' : 'Copy command'}
          </button>
        )}
        {copied === 'no' && <span className="muted">The clipboard refused the command.</span>}
      </div>
    </div>
  )
}
