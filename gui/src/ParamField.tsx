import type { JSX } from 'react'
import type { ParamSpec } from './paramLayout'

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
}

// One widget per declared type. The tool's restrictions drive the control:
// a string with `choices` becomes a select, a number carries its own min/max,
// so the UI cannot offer a value the CLI would reject.
export default function ParamField({ spec, value, onChange, onPickFile, inert }: Props): JSX.Element {
  const off = !!inert
  const label = (
    <label htmlFor={`p-${spec.name}`} title={spec.description}>
      {spec.name.replace(/_/g, ' ')}
    </label>
  )
  // The reason replaces the description rather than joining it: a disabled
  // field's one useful piece of information is what would switch it on.
  const help = <p className={off ? 'help inert' : 'help'}>{inert ?? spec.description}</p>
  const cls = `field${off ? ' off' : ''}`

  if (spec.type === 'bool') {
    return (
      <div className={`${cls} check`}>
        <input
          id={`p-${spec.name}`}
          type="checkbox"
          disabled={off}
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
        />
        {label}
        {help}
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
            type="text"
            disabled={off}
            value={String(value ?? '')}
            placeholder="(not set)"
            onChange={(e) => onChange(e.target.value)}
          />
          <button type="button" className="secondary slim" disabled={off} onClick={() => onPickFile?.(spec)}>
            Browse…
          </button>
        </div>
        {help}
      </div>
    )
  }

  if (spec.choices?.length) {
    return (
      <div className={cls}>
        {label}
        <select
          id={`p-${spec.name}`}
          disabled={off}
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
        >
          {spec.choices.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        {help}
      </div>
    )
  }

  const numeric = spec.type === 'int' || spec.type === 'double'
  return (
    <div className={cls}>
      {label}
      <input
        id={`p-${spec.name}`}
        type={numeric ? 'number' : 'text'}
        step={spec.type === 'double' ? 'any' : 1}
        min={spec.min}
        max={spec.max}
        disabled={off}
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value)}
      />
      {help}
    </div>
  )
}
