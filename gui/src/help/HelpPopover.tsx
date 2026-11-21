// The (?) of a parameter (doc/GUI-WORKFLOWS.md 3, help layer 2): a popover,
// opened by click or keyboard, with the full CLI description, the default
// and the command-line flag, and a link to the parameter's Help entry. The
// form itself names no CLI option; this is where the flag is shown.

import { useEffect, useId, useLayoutEffect, useRef, useState, type JSX } from 'react'
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
  /// A tip below it (PARAM_UI help.tip), when there is one.
  tip?: string
  /// The plain text says all the CLI description does (PARAM_UI
  /// help.cliCovered): the description is not shown.
  covered?: boolean
  /// More flags the control sets (the Instrument sets three), each with its
  /// default.
  flags?: { name: string; deflt: string }[]
}

/// The pane a popover must stay inside: the nearest ancestor that scrolls
/// or clips (the Setup form's pane), else the window.
function clipBox(el: HTMLElement): { left: number; right: number } {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p)
    if (/(auto|scroll|hidden|clip)/.test(`${o.overflowX}${o.overflow}`)) {
      const r = p.getBoundingClientRect()
      return { left: r.left, right: r.right }
    }
  }
  return { left: 0, right: document.documentElement.clientWidth || window.innerWidth }
}

/// The popover's texts without what its facts row says: a sentence that
/// only states the default ("20 is the default.") goes, as does the value
/// that turns the option off ("0 turns the cutoff off"), which the row
/// names once. The plain text (PARAM_UI help), when there is one, comes
/// first; the CLI's description follows in smaller type (@p cli) unless it
/// says nothing the plain text does not: marked so (@p covered, PARAM_UI
/// help.cliCovered), or every word of it is in the plain text. Pure, for
/// vitest.
export function popoverTexts(
  description: string,
  more?: string,
  tip?: string,
  covered?: boolean
): { text: string; cli?: string; tip?: string; off?: string } {
  let off: string | undefined
  const clean = (t: string | undefined): string | undefined => {
    if (!t) return t
    const kept: string[] = []
    for (const s of t.split(/(?<=[.!?])\s+/)) {
      if (/^\S+ is the default\.?$/i.test(s.trim())) continue
      // Clauses of a sentence (";"): the one that names the off value goes.
      const parts = s.replace(/[.!?]$/, '').split(/;\s*/)
      const rest = parts.filter((c) => {
        const m = /^(-?[\d.]+) (?:turns (?:the |it )?[\w -]+ off|disables(?: it)?)$/i.exec(c.trim())
        if (m) off = m[1]
        return !m
      })
      if (rest.length === 0) continue
      const joined = rest.join('; ')
      kept.push(`${joined.charAt(0).toUpperCase()}${joined.slice(1)}${/[.!?]$/.test(s) ? s.slice(-1) : ''}`)
    }
    const out = kept.join(' ').trim()
    return out === '' ? undefined : out
  }
  const m = clean(more)
  const t = clean(tip)
  const d = clean(description) ?? ''
  // Against the text as written: its off sentence goes to the facts row,
  // and still says what the CLI line does.
  const cli = m && d && !covered && !saysNothingNew(d, `${more ?? ''} ${tip ?? ''}`) ? d : undefined
  return { text: m ?? d, ...(cli ? { cli } : {}), ...(t ? { tip: t } : {}), ...(off ? { off } : {}) }
}

/// Every word of @p cli (4 letters or more, numbers too) is in @p plain:
/// the CLI line repeats it.
function saysNothingNew(cli: string, plain: string): boolean {
  const words = (x: string): string[] => x.toLowerCase().match(/[a-z0-9][a-z0-9+-]*/g) ?? []
  const have = new Set(words(plain))
  return words(cli).every((w) => (w.length < 4 && !/\d/.test(w)) || have.has(w))
}

export default function HelpPopover({ name, label, description, deflt, more, tip, covered, flags }: HelpPopoverProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const id = useId()
  const box = useRef<HTMLSpanElement>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const pop = useRef<HTMLSpanElement>(null)
  // Opened at the left of its (?), or at its right when the popover would
  // run past the pane's right edge (a field of the third column): never
  // cut off mid-word by the scrolling pane.
  const [align, setAlign] = useState<'left' | 'right'>('left')
  useLayoutEffect(() => {
    if (!open || !box.current || !pop.current) return
    const pane = clipBox(box.current)
    const at = box.current.getBoundingClientRect()
    const w = pop.current.getBoundingClientRect().width
    setAlign(at.left + w > pane.right - 8 && at.right - w >= pane.left ? 'right' : 'left')
  }, [open])
  const shown = popoverTexts(description, more, tip, covered)
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
        <span id={id} ref={pop} className={`help-pop${align === 'right' ? ' right' : ''}`} role="dialog" aria-label={`About ${label}`}>
          <span className="help-pop-text">{shown.text}</span>
          {shown.cli && <span className="help-pop-more help-pop-cli">{shown.cli}</span>}
          {shown.tip && <span className="help-pop-more help-pop-tip">{shown.tip}</span>}
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
              {shown.off && (
                <span>
                  <strong>{shown.off}</strong> turns it off
                </span>
              )}
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
