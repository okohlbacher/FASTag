import type { JSX, ReactNode } from 'react'
import { openHelp } from './link'

/// A link into Help: a button, since the window has no URL to point at.
/// @p to is a section id of the Help pages (help.test.tsx checks each exists).
export function HelpLink({ to, children }: { to: string; children: ReactNode }): JSX.Element {
  return (
    <button type="button" className="link help-link" data-help={to} onClick={() => openHelp(to)}>
      {children}
    </button>
  )
}

/// The small "?" beside a field or a heading. @p what names the thing it
/// explains, for screen readers and the tooltip.
export function HelpButton({ to, what }: { to: string; what: string }): JSX.Element {
  return (
    <button
      type="button"
      className="help-q"
      data-help={to}
      aria-label={`Help on ${what}`}
      title={`Help on ${what}`}
      onClick={() => openHelp(to)}
    >
      ?
    </button>
  )
}
