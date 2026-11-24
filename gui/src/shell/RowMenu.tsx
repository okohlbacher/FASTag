// A row's secondary actions behind one More button (WAI-ARIA menu button):
// History keeps Open beside it and puts Reveal, Copy command, Settings into
// form, Re-run and Delete record here, so a record is one row of buttons,
// not five, and its file names keep their room.
//
// Keyboard: Enter, Space or ArrowDown on More opens the menu on its first
// item (ArrowUp: on its last); ArrowUp/ArrowDown/Home/End move between the
// items; Escape or Tab closes it and returns focus to More. A click outside
// closes it. Choosing an item closes the menu, puts focus back on More and
// then runs the item (which may move focus on, as Delete record does).

import { Fragment, useEffect, useId, useRef, useState, type JSX, type KeyboardEvent } from 'react'

export interface RowMenuItem {
  label: string
  onSelect(): void
  disabled?: boolean
  /// A hook for focus code and tests (data-action).
  action?: string
  /// A rule above the item (before a destructive one).
  separatorBefore?: boolean
  title?: string
}

export interface RowMenuProps {
  /// The accessible name of More, e.g. "More actions for run01.mzML".
  label: string
  items: RowMenuItem[]
}

/// More is marked data-action="more", for focus code that returns to it.
export default function RowMenu({ label, items }: RowMenuProps): JSX.Element {
  const [open, setOpen] = useState<null | 'first' | 'last'>(null)
  const boxRef = useRef<HTMLSpanElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  const enabled = (): HTMLButtonElement[] =>
    [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])].filter((b) => !b.disabled)

  useEffect(() => {
    if (!open) return
    const list = enabled()
    ;(open === 'last' ? list[list.length - 1] : list[0])?.focus()
    const away = (e: MouseEvent): void => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(null)
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])

  const close = (): void => {
    setOpen(null)
    buttonRef.current?.focus()
  }

  function onButtonKey(e: KeyboardEvent<HTMLButtonElement>): void {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setOpen(e.key === 'ArrowUp' ? 'last' : 'first')
    }
  }

  function onMenuKey(e: KeyboardEvent<HTMLDivElement>): void {
    const list = enabled()
    const i = list.indexOf(document.activeElement as HTMLButtonElement)
    const to = (n: number): void => {
      e.preventDefault()
      list[(n + list.length) % list.length]?.focus()
    }
    if (e.key === 'ArrowDown') to(i + 1)
    else if (e.key === 'ArrowUp') to(i < 0 ? list.length - 1 : i - 1)
    else if (e.key === 'Home') to(0)
    else if (e.key === 'End') to(list.length - 1)
    else if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault()
      e.stopPropagation()
      close()
    }
  }

  return (
    <span className="row-menu" ref={boxRef}>
      <button
        type="button"
        className="secondary small row-menu-btn"
        data-action="more"
        ref={buttonRef}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open ? 'true' : 'false'}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => (o ? null : 'first'))}
        onKeyDown={onButtonKey}
      >
        More
      </button>
      {open && (
        <div className="row-menu-list" role="menu" id={menuId} aria-label={label} ref={menuRef} onKeyDown={onMenuKey}>
          {items.map((it) => (
            <Fragment key={it.label}>
              {it.separatorBefore && <div className="row-menu-sep" role="separator" />}
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                data-action={it.action}
                disabled={it.disabled}
                title={it.title}
                onClick={() => {
                  close()
                  it.onSelect()
                }}
              >
                {it.label}
              </button>
            </Fragment>
          ))}
        </div>
      )}
    </span>
  )
}
