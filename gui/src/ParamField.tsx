import { useEffect, useRef, useState, type JSX } from 'react'
import { briefHint, choiceText, defaultText, hintText, humanName, invalidBecause, isChanged, masters, PARAM_BY_NAME, uiOf, type Dependency, type ParamSpec } from './paramLayout'
import { IconError } from './icons'
import HelpPopover from './help/HelpPopover'
import { productLabel } from './setup/products'

export type ParamValue = string | boolean | string[]

interface Props {
  spec: ParamSpec
  value: ParamValue
  onChange: (v: ParamValue) => void
  onPickFile?: (spec: ParamSpec) => void
  /// The unmet dependency that makes this parameter do nothing right now (from
  /// inertDependency()), or null if it is live. The field is still shown --
  /// hiding it would make the option undiscoverable and the form jump around
  /// as switches flip -- but it is disabled and names what it needs.
  needs?: Dependency | null
  /// A section switch that is off: how many settings it turns on, which
  /// stay hidden until it is (GUI-DESIGN 3 S1). Said once, here.
  turnsOn?: number
  /// The unit of a value, drawn as one control with it (fragment_tolerance).
  unit?: { spec: ParamSpec; value: ParamValue; onChange: (v: ParamValue) => void }
  /// The one line under a basic field (the workflow's own help, tasks.ts);
  /// without it the CLI description is shown, clamped to one line.
  brief?: string
  /// The curated one-line hint (BRIEF_HINT, the workflow's own): shown in
  /// place of the clamped CLI description, wherever the field is.
  hint?: string
  /// The label, when the workflow names the field its own way.
  label?: string
  /// The run cannot do without it (a workflow's protein database).
  required?: boolean
  /// Not usable here, and why (census_ids in Batch mode): disabled, with
  /// the reason in place of its help.
  blocked?: string
  /// A steps select's count option (subsample_fraction with
  /// subsample_spectra): "Custom count…" sets the count, a share clears it.
  count?: { spec: ParamSpec; value: ParamValue; onChange: (v: ParamValue) => void }
  /// The value is the one the workflow or preset set (not changed since):
  /// a value off the CLI default reads "set by <it>", not "changed", as
  /// Advanced counts changes against where the form started.
  setBy?: string
}

// One widget per declared type. The tool's restrictions drive the control: a
// string with `choices` becomes a select. A number is a text field checked by
// invalidBecause() against the type, min and max the CLI declares; a value the
// CLI would refuse is marked invalid and says why (App keeps Run disabled).
export default function ParamField({ spec, value, onChange, onPickFile, needs, unit, turnsOn, brief, hint, label: name, required, blocked, count, setBy }: Props): JSX.Element {
  const off = !!needs || !!blocked
  // An inert field is not sent, so its value cannot fail the run.
  const invalid = off ? null : invalidBecause(spec, value)
  const changed = !off && (isChanged(spec.name, value) || (!!unit && isChanged(unit.spec.name, unit.value)))
  // The name in words; the CLI name is in the (?) popover only.
  const title = name ?? humanName(spec.name)
  const missing = !!required && !off && String(value ?? '').trim() === ''
  const label = (
    <span className="label-row">
      <label htmlFor={`p-${spec.name}`}>
        <span className="pname">{title}</span>
      </label>
      {/* Neutral: a field not filled in yet is no error. */}
      {required && <span className={`badge${missing ? ' todo' : ''}`}>required</span>}
      {uiOf(spec.name).experimental && <span className="badge">experimental</span>}
      <HelpPopover
        name={spec.name}
        label={title}
        description={sentence(plainOptions(spec.description))}
        deflt={`${defaultText(spec)}${unit ? ` ${defaultText(unit.spec)}` : ''}`}
        more={uiOf(spec.name).help?.text}
        tip={uiOf(spec.name).help?.tip}
        covered={uiOf(spec.name).help?.cliCovered}
      />
    </span>
  )
  const helpId = `h-${spec.name}`
  // The help is one line in words (hintText); the full CLI description is
  // in the (?) popover and the line's tooltip, so no field needs a 'more'.
  const helpRef = useRef<HTMLParagraphElement>(null)
  // Custom chosen in a steps select, before a value of its own is typed.
  const [customStep, setCustomStep] = useState(false)
  // "Custom count…" chosen, before a count is typed.
  const [countPicked, setCountPicked] = useState(false)
  // The parameter search reveals the count (App chooseParam): an event on
  // the select, as the choice lives here.
  const selectRef = useRef<HTMLSelectElement>(null)
  useEffect(() => {
    const el = selectRef.current
    if (!el || !count) return
    const reveal = (): void => setCountPicked(true)
    el.addEventListener('fastag:reveal-count', reveal)
    return () => el.removeEventListener('fastag:reveal-count', reveal)
  }, [count])
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
        className={`${off ? 'help inert' : 'help'}${brief ? ' brief' : ''}`}
        title={off ? undefined : (brief ?? sentence(hintText(spec.name, plainOptions(spec.description))))}
      >
        {blocked ? (
          <span className="needs">{blocked}</span>
        ) : needs ? (
          <span className="needs">
            <strong>
              {needs.replaced ? 'Replaced by ' : 'Needs '}
              {needs.say ?? masters(needs).map((m, i) => <Cli key={m} name={m} sep={i > 0} />)}
            </strong>
            {` (${needs.note}).`}
          </span>
        ) : (
          brief ?? hint ?? briefHint(sentence(hintText(spec.name, plainOptions(spec.description))))
        )}
        {!!turnsOn && (
          <span className="turns-on">
            {' '}Turns on {turnsOn} {turnsOn === 1 ? 'setting' : 'settings'}.
          </span>
        )}
      </p>
      {/* On a line of its own, not run on from the hint (which the grid
          clamps to two lines). */}
      {/* A Settings field (brief) shows it too when the workflow set a value
          off the CLI's default (Export tags: Extension 3, FASTag's 0), so a
          run compared with a plain CLI run holds no surprise. */}
      {changed && (!brief || !!setBy) && (
        <p id={`${helpId}-c`} className="help changed">
          {brief ? 'FASTag default' : 'Default'} {deflt} · {setBy ? <>set by {setBy}</> : <span className="mark">changed</span>}
        </p>
      )}
    </>
  )
  // The hint, and the changed line when it shows.
  const describedBy = !invalid && changed && (!brief || !!setBy) ? `${helpId} ${helpId}-c` : helpId
  const cls = `field${off ? ' off' : ''}${invalid ? ' invalid' : ''}`

  if (spec.type === 'bool') {
    return (
      <div className={`${cls} check`}>
        <input
          id={`p-${spec.name}`}
          aria-describedby={describedBy}
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
          aria-describedby={describedBy}
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
            aria-describedby={describedBy}
            type="text"
            disabled={off}
            value={String(value ?? '')}
            placeholder="not set"
            onChange={(e) => onChange(e.target.value)}
          />
          {/* Named per field: eight "Browse…" buttons would read alike. */}
          <button
            type="button"
            className="secondary"
            disabled={off}
            aria-label={`Browse for ${humanName(spec.name)}`}
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
          aria-describedby={describedBy}
          aria-invalid={invalid ? true : undefined}
          disabled={off}
          value={v}
          onChange={(e) => onChange(e.target.value)}
        >
          {choices.map((c) => (
            <option key={c} value={c}>
              {choiceText(spec.name, c)}
            </option>
          ))}
        </select>
        {help}
      </div>
    )
  }

  const steps = uiOf(spec.name).steps
  if (steps) {
    // Named values, and Custom for any other (shown as a field beside).
    const v = String(value ?? '').trim()
    const hit = steps.find((x) => v !== '' && Number(x.value) === Number(v)) ?? (v === '' ? steps.find((x) => Number(x.value) === Number(spec.default)) : undefined)
    // A count set (not 0) wins over the share, as in the CLI.
    const cv = count ? String(count.value ?? '').trim() : ''
    const counting = !!count && (countPicked || (cv !== '' && Number(cv) !== 0))
    const custom = !counting && (!hit || customStep)
    const countBad = counting && count ? invalidBecause(count.spec, count.value) : null
    return (
      <div className={cls}>
        {label}
        <div className="row tight">
          <select
            id={`p-${spec.name}`}
            ref={selectRef}
            aria-describedby={describedBy}
            disabled={off}
            value={counting ? '__count' : custom ? '__custom' : hit!.value}
            onChange={(e) => {
              const x = e.target.value
              setCustomStep(x === '__custom')
              setCountPicked(x === '__count')
              // A share clears the count; the count leaves the share alone
              // (the CLI reads the count first).
              if (x !== '__count' && count && cv !== '' && Number(cv) !== 0) count.onChange('0')
              if (x !== '__custom' && x !== '__count') onChange(x)
            }}
          >
            {steps.map((x) => (
              <option key={x.value} value={x.value}>
                {x.label}
              </option>
            ))}
            <option value="__custom">Custom share</option>
            {count && <option value="__count">Custom count…</option>}
          </select>
          {counting && count && (
            <input
              id={`p-${count.spec.name}`}
              className="num"
              aria-label={`${title}, number of spectra`}
              aria-invalid={countBad ? true : undefined}
              type="text"
              inputMode="numeric"
              placeholder="spectra"
              disabled={off}
              value={cv === '0' ? '' : String(count.value ?? '')}
              onChange={(e) => count.onChange(e.target.value)}
            />
          )}
          {custom && (
            <input
              className="num"
              aria-label={`${title}, custom value`}
              aria-invalid={invalid ? true : undefined}
              type="text"
              inputMode="decimal"
              disabled={off}
              value={String(value ?? '')}
              onChange={(e) => onChange(e.target.value)}
            />
          )}
        </div>
        {help}
      </div>
    )
  }

  // Not <input type=number>: WebKit turns `0,02` into `002` under an English
  // locale and reports a half-typed `5e` as '', so the CLI default would run.
  // The text is kept as typed and checked by invalidBecause().
  const numeric = spec.type === 'int' || spec.type === 'double'
  // A "not set" value (-1: by engine) reads as an empty field with its
  // placeholder; emptied, the field goes back to that value (not sent).
  const unset = uiOf(spec.name).unset
  const raw = String(value ?? '')
  const isUnset = !!unset && (raw.trim() === '' || Number(raw) === Number(unset.value))
  const input = (
    <input
      id={`p-${spec.name}`}
      className={numeric ? 'num' : undefined}
      aria-describedby={describedBy}
      aria-invalid={invalid ? true : undefined}
      type="text"
      inputMode={spec.type === 'int' ? 'numeric' : spec.type === 'double' ? 'decimal' : undefined}
      disabled={off}
      value={isUnset ? '' : raw}
      placeholder={unset?.placeholder}
      onChange={(e) => onChange(unset && e.target.value.trim() === '' ? String(spec.default ?? unset.value) : e.target.value)}
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
            aria-label={humanName(unit.spec.name)}
            disabled={off}
            value={u}
            onChange={(e) => unit.onChange(e.target.value)}
          >
            {(u === '' || choices.includes(u) ? choices : [...choices, u]).map((c) => (
              <option key={c} value={c}>
                {choiceText(unit.spec.name, c)}
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

/// Option names in the CLI help are written -name; the form shows them as
/// name. Only real option names lose the dash, so words like N-terminal and
/// k-mers stay as they are.
const OPTION_REF = new RegExp(`(^|[\\s('"])-(${[...PARAM_BY_NAME.keys()].sort((a, b) => b.length - a.length).join('|')})\\b`, 'g')
function plainOptions(text: string): string {
  return text.replace(OPTION_REF, '$1$2')
}

/// The help as a sentence, so what follows it does not run on: "Seed tag
/// length in residues" + "Default 3" must not read as one phrase.
function sentence(text: string): string {
  const t = text.trimEnd()
  return t === '' || /[.!?:)]$/.test(t) ? t : `${t}.`
}

/// What a dependency names, in words: the report it is (Mass-shift table),
/// or the option's name; " or " before all but the first.
function Cli({ name, sep }: { name: string; sep: boolean }): JSX.Element {
  return (
    <>
      {sep && ' or '}
      {productLabel(name) ?? humanName(name)}
    </>
  )
}
