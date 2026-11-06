import { useEffect, useId, useMemo, useRef, useState, type JSX, type KeyboardEvent } from 'react'
import { humanName } from '../paramLayout'
import { searchParams, type ParamHit } from './searchRank'

interface Props {
  onChoose: (hit: ParamHit) => void
  onClose: () => void
}

// The parameter search dialog (Cmd+K or "/"): a combobox over the form's
// parameters by name, flag and help text, with arrow keys, Enter and Esc.
export default function ParamSearch({ onChoose, onClose }: Props): JSX.Element {
  const id = useId()
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const hits = useMemo(() => searchParams(q), [q])
  useEffect(() => inputRef.current?.focus(), [])
  useEffect(() => setActive(0), [q])

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(hits.length - 1, a + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(0, a - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (hits[active]) onChoose(hits[active])
    }
  }

  return (
    <div className="psearch-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="psearch" role="dialog" aria-modal="true" aria-labelledby={`${id}-t`}>
        <h2 id={`${id}-t`} className="sr-only">
          Search parameters
        </h2>
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded={hits.length > 0}
          aria-controls={`${id}-l`}
          aria-activedescendant={hits[active] ? `${id}-o-${hits[active].name}` : undefined}
          aria-label="Search parameters by name, flag or help text"
          placeholder="Search parameters: name, flag or help text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
        />
        <ul id={`${id}-l`} role="listbox" aria-label="Matching parameters">
          {hits.map((h, i) => (
            <li
              key={h.name}
              id={`${id}-o-${h.name}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : undefined}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault()
                onChoose(h)
              }}
            >
              <span className="pname">{humanName(h.name)}</span> <code className="cli">{h.name}</code>
              <span className="where">
                {h.section}
                {h.where === 'help' ? ' · in help text' : ''}
              </span>
            </li>
          ))}
        </ul>
        {q.trim() !== '' && hits.length === 0 && (
          <p className="muted" role="status">
            No parameter matches “{q}”.
          </p>
        )}
      </div>
    </div>
  )
}
