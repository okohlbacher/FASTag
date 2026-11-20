// The (?) of a parameter (doc/GUI-WORKFLOWS.md 3, help layer 2): a popover,
// opened by click or keyboard, with the full CLI description, the default
// and the command-line flag, and a link to the parameter's Help entry. The
// form itself names no CLI option; this is where the flag is shown.

import { useEffect, useId, useRef, useState, type JSX } from 'react'
import { HelpLink } from './HelpLink'

export interface HelpPopoverProps {
  /// The option, without its dash.
  name: string
  /// The option in words.
  label: string
  /// The CLI's description, option names without their dash.
  description: string
  /// The default as the form shows it ("20 ppm", "off").
  deflt: string
  /// A longer plain-language text (PARAM_UI help), when there is one.
  more?: string
  /// More flags the control sets (the Instrument sets three), each with its
  /// default.
  flags?: { name: string; deflt: string }[]
}

export default function HelpPopover({ name, label, description, deflt, more, flags }: HelpPopoverProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const id = useId()
  const box = useRef<HTMLSpanElement>(null)
  const btn = useRef<HTMLButtonElement>(null)
  // A click outside, or Escape, closes it; Escape gives focus back.
  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent): void => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', down)
    return () => document.removeEventListener('mousedown', down)
  }, [open])
  return (
    <span
      className="help-pop-wrap"
      ref={box}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation()
          setOpen(false)
          btn.current?.focus()
        }
      }}
    >
      <button
        ref={btn}
        type="button"
        className="help-q"
        aria-label={`About ${label}`}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        data-param-help={name}
        onClick={() => setOpen((o) => !o)}
      >
        ?
      </button>
      {open && (
        <span id={id} className="help-pop" role="dialog" aria-label={`About ${label}`}>
          <span className="help-pop-text">{description}</span>
          {more && more !== description && <span className="help-pop-more">{more}</span>}
          {/* The dash is written here, once: copied, the flag is what the
              CLI takes (-max_evalue, never --max_evalue). */}
          {flags ? (
            <span className="help-pop-facts">
              {flags.map((f) => (
                <span key={f.name}>
                  <code className="flag">-{f.name}</code> default <strong>{f.deflt}</strong>
                </span>
              ))}
            </span>
          ) : (
            <span className="help-pop-facts">
              <span>
                Default: <strong>{deflt}</strong>
              </span>
              <span>
                Command line: <code className="flag">-{name}</code>
              </span>
            </span>
          )}
          <HelpLink to={`param-${name}`}>More in Help</HelpLink>
        </span>
      )}
    </span>
  )
}
