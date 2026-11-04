import { useLayoutEffect, useRef, useState, type JSX } from 'react'
import { defaultText, humanName, invalidBecause, isChanged, masters, type Dependency, type ParamSpec } from './paramLayout'
import { IconError } from './icons'

export type ParamValue = string | boolean | string[]

interface Props {
  spec: ParamSpec
  value: ParamValue
  onChange: (v: ParamValue) => void
  onPickFile?: (spec: ParamSpec) => void
  /// Why this parameter currently does nothing, from inertBecause(). The field
  /// is still shown -- hiding it would make the option undiscoverable and the
  /// form jump around as switches flip -- but it is disabled and says why.
  inert?: string | null
  /// The unmet dependency behind `inert`, so the field can name what it needs.
  needs?: Dependency | null
  /// The unit of a value, drawn as one control with it (fragment_tolerance).
  unit?: { spec: ParamSpec; value: ParamValue; onChange: (v: ParamValue) => void }
}

// One widget per declared type. The tool's restrictions drive the control: a
// string with `choices` becomes a select. A number is a text field checked by
// invalidBecause() against the type, min and max the CLI declares; a value the
// CLI would refuse is marked invalid and says why (App keeps Run disabled).
export default function ParamField({ spec, value, onChange, onPickFile, inert, needs, unit }: Props): JSX.Element {
  const off = !!inert
  // An inert field is not sent, so its value cannot fail the run.
  const invalid = off ? null : invalidBecause(spec, value)
  const changed = !off && (isChanged(spec.name, value) || (!!unit && isChanged(unit.spec.name, unit.value)))
  // The name in words, then the CLI name, as the help texts, the docs and the
  // CLI's messages spell it.
  const label = (
    <label htmlFor={`p-${spec.name}`} title={spec.description}>
      <span className="pname">{humanName(spec.name)}</span> <code className="cli">{spec.name}</code>
    </label>
  )
  const helpId = `h-${spec.name}`
  // The help is clamped to two lines; a longer text gets a toggle instead of
  // being cut mid-word with the rest only in a tooltip.
  const helpRef = useRef<HTMLParagraphElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [clipped, setClipped] = useState(false)
  useLayoutEffect(() => {
    const el = helpRef.current
    if (!el || expanded) return
    const measure = (): void => setClipped(el.scrollHeight > el.clientHeight + 1)
    measure()
    // Re-measured when the paragraph's width changes: the aside is full
    // width below 720 px and 300-400 px above, so a text clipped at one
    // width may fit at another.
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [inert, invalid, changed, expanded])
  const deflt = `${defaultText(spec)}${unit ? ` ${defaultText(unit.spec)}` : ''}`
  // An invalid value says what is wrong with it in place of the description;
  // an inert field keeps its description and adds what would switch it on.
  const help = invalid ? (
    <p id={helpId} className="help invalid">
      <IconError />
      <span>{invalid}</span>
    </p>
  ) : (
    <>
      <p
        id={helpId}
        ref={helpRef}
        className={off ? 'help inert' : 'help'}
        style={expanded ? { maxHeight: 'none' } : undefined}
      >
        {sentence(spec.description)}
        {off && (
          <>
            {' '}
            <span className="needs">
              {needs && (
                <strong>
                  {needs.replaced ? 'Replaced by ' : 'Needs '}
                  {masters(needs).map((m, i) => (
                    <Cli key={m} name={m} sep={i > 0} />
                  ))}
                </strong>
              )}
              {needs ? ` (${inert}).` : `${inert}.`}
            </span>
          </>
        )}
        {changed && (
          <span className="changed">
            {' '}Default {deflt} · <span className="mark">changed</span>
          </span>
        )}
      </p>
      {(clipped || expanded) && (
        <button
          type="button"
          className="link help-more"
          aria-expanded={expanded}
          aria-controls={helpId}
          onClick={() => setExpanded((x) => !x)}
        >
          {expanded ? 'less' : 'more'}
        </button>
      )}
    </>
  )
  const cls = `field${off ? ' off' : ''}${invalid ? ' invalid' : ''}`

  if (spec.type === 'bool') {
    return (
      <div className={`${cls} check`}>
        <input
          id={`p-${spec.name}`}
          aria-describedby={helpId}
          type="checkbox"
          disabled={off}
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
        />
        {label}
        <div className="check-help">{help}</div>
      </div>
    )
  }

  if (spec.type === 'string-list') {
    const items = Array.isArray(value) ? value : []
    return (
      <div className={cls}>
        {label}
        <textarea
          id={`p-${spec.name}`}
          aria-describedby={helpId}
          aria-invalid={invalid ? true : undefined}
          rows={Math.max(2, items.length + 1)}
          disabled={off}
          value={items.join('\n')}
          placeholder="one per line"
          onChange={(e) => onChange(e.target.value.split('\n'))}
        />
        {help}
      </div>
    )
  }

  if (spec.type === 'input-file' || spec.type === 'output-file') {
    return (
      <div className={cls}>
        {label}
        <div className="row tight">
          <input
            id={`p-${spec.name}`}
            className="path-input"
            aria-describedby={helpId}
            type="text"
            disabled={off}
            value={String(value ?? '')}
            placeholder="(not set)"
            onChange={(e) => onChange(e.target.value)}
          />
          {/* Named per field: eight "Browse…" buttons would read alike. */}
          <button
            type="button"
            className="secondary"
            disabled={off}
            aria-label={`Browse for ${spec.name}`}
            onClick={() => onPickFile?.(spec)}
          >
            Browse…
          </button>
        </div>
        {help}
      </div>
    )
  }

  if (spec.choices?.length) {
    const v = String(value ?? '')
    // A stored value the list no longer offers (a preset's `reverse`) is shown
    // as what it is, not as the first option while it is still sent.
    const choices = v === '' || spec.choices.includes(v) ? spec.choices : [...spec.choices, v]
    return (
      <div className={cls}>
        {label}
        <select
          id={`p-${spec.name}`}
          aria-describedby={helpId}
          aria-invalid={invalid ? true : undefined}
          disabled={off}
          value={v}
          onChange={(e) => onChange(e.target.value)}
        >
          {choices.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        {help}
      </div>
    )
  }

  // Not <input type=number>: WebKit turns `0,02` into `002` under an English
  // locale and reports a half-typed `5e` as '', so the CLI default would run.
  // The text is kept as typed and checked by invalidBecause().
  const numeric = spec.type === 'int' || spec.type === 'double'
  const input = (
    <input
      id={`p-${spec.name}`}
      className={numeric ? 'num' : undefined}
      aria-describedby={helpId}
      aria-invalid={invalid ? true : undefined}
      type="text"
      inputMode={spec.type === 'int' ? 'numeric' : spec.type === 'double' ? 'decimal' : undefined}
      disabled={off}
      value={String(value ?? '')}
      onChange={(e) => onChange(e.target.value)}
    />
  )
  if (unit) {
    // The value and its unit are one control: the unit reads as part of the
    // number, not as a field of its own further down.
    const u = String(unit.value ?? '')
    const choices = unit.spec.choices ?? []
    return (
      <div className={cls}>
        {label}
        <div className="with-unit">
          {input}
          <select
            id={`p-${unit.spec.name}`}
            aria-label={`Unit (${unit.spec.name})`}
            disabled={off}
            value={u}
            onChange={(e) => unit.onChange(e.target.value)}
          >
            {(u === '' || choices.includes(u) ? choices : [...choices, u]).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        {help}
      </div>
    )
  }
  return (
    <div className={cls}>
      {label}
      {input}
      {help}
    </div>
  )
}

/// The help as a sentence, so what follows it does not run on: "Seed tag
/// length in residues" + "Default 3" must not read as one phrase.
function sentence(text: string): string {
  const t = text.trimEnd()
  return t === '' || /[.!?:)]$/.test(t) ? t : `${t}.`
}

/// A CLI option name, with " or " before all but the first.
function Cli({ name, sep }: { name: string; sep: boolean }): JSX.Element {
  return (
    <>
      {sep && ' or '}
      <code className="cli">{name}</code>
    </>
  )
}
