// The inspector's checks on the Setup screen (GUI-DESIGN 3 S1, P2b) and,
// after a run, over the result tabs. Each check names its evidence and its
// Help entry; a red flag offers "Run anyway" (before a run) and its fix; a
// block names what to do instead.

import { useState, type JSX } from 'react'
import { IconError, IconFlag, IconWarning } from '../icons'
import { HelpLink } from '../help/HelpLink'
import { shellLine } from '../app/format'
import { INSTRUMENTS, presetText } from '../setup/presets'
import type { Check, Detected, Level } from './checks'

const LEVEL_WORD: Record<Level, string> = { block: 'Blocks the run', flag: 'Red flag', warn: 'Warning', info: 'Note' }

function LevelIcon({ level }: { level: Level }): JSX.Element {
  if (level === 'block') return <IconError />
  if (level === 'flag') return <IconFlag />
  return <IconWarning />
}

function CopyCommand({ argv, label }: { argv: string[]; label: string }): JSX.Element {
  const [copied, setCopied] = useState<'yes' | 'no' | null>(null)
  return (
    <div className="check-command">
      <code className="why">{shellLine(argv)}</code>
      <button
        type="button"
        className="secondary small"
        onClick={() =>
          navigator.clipboard.writeText(shellLine(argv)).then(
            () => setCopied('yes'),
            () => setCopied('no')
          )
        }
      >
        {copied === 'yes' ? 'Copied' : label}
      </button>
      {copied === 'no' && <span className="muted">The clipboard refused the command.</span>}
    </div>
  )
}

export function CheckItem(p: {
  check: Check
  answered?: boolean
  onRunAnyway?(): void
  onFix?(): void
  fixDisabled?: boolean
}): JSX.Element {
  const c = p.check
  return (
    <li className={`check check-${c.level}`} data-check={c.id}>
      <div className="check-head">
        <LevelIcon level={c.level} />
        <strong>
          {LEVEL_WORD[c.level]}: {c.title}
        </strong>
      </div>
      <p>{c.detail}</p>
      <p className="hint">From {c.source}.</p>
      {c.command && <CopyCommand argv={c.command} label={`Copy ${c.command[0]} command`} />}
      <div className="row tight check-actions">
        {c.fix && p.onFix && (
          <button type="button" className="small" onClick={p.onFix} disabled={p.fixDisabled}>
            {c.fix.label}
          </button>
        )}
        {c.level === 'flag' && p.onRunAnyway && !p.answered && (
          <button type="button" className="secondary small" onClick={p.onRunAnyway}>
            Run anyway
          </button>
        )}
        {c.level === 'flag' && p.answered && <span className="hint">Run anyway: chosen</span>}
        <HelpLink to={c.faq}>What this means</HelpLink>
      </div>
    </li>
  )
}

/// "Instrument: LTQ Orbitrap XL (detected from the probe): Ion trap CID 0.3 Da".
function DetectedLine(p: { detected: Detected; chosen: string; onUse?(id: string): void }): JSX.Element | null {
  const { detected } = p
  const preset = INSTRUMENTS.find((x) => x.id === detected.preset)
  if (!detected.text && !preset) return null
  return (
    <p className="detected">
      <span>
        Instrument: {detected.text ?? 'not named'}
        {preset ? (
          <>
            {' '}
            · <strong>{presetText(preset)}</strong> <span className="chip">detected</span>
          </>
        ) : (
          detected.family === 'hybrid-ion-trap' && ' · its MS2 may be read in the ion trap or the Orbitrap; the metadata do not say which'
        )}
        <span className="hint"> (from {detected.source})</span>
      </span>
      {preset && p.onUse && p.chosen !== preset.id && (
        <button type="button" className="secondary small" onClick={() => p.onUse!(preset.id)}>
          Use {presetText(preset)}
        </button>
      )}
    </p>
  )
}

export interface PreStartPanelProps {
  checks: Check[]
  detected: Detected | null
  notChecked: string | null
  pending: boolean
  // The instrument preset whose values the form holds ('' when none).
  chosenInstrument: string
  isAnswered(id: string): boolean
  onRunAnyway(id: string): void
  onInstrument(id: string): void
  onRecheck(): void
}

/// The pre-start checks of the Spectra card.
export function PreStartPanel(p: PreStartPanelProps): JSX.Element {
  // The fix of a check names the preset; the detected line offers it only
  // when no check does.
  const fixed = new Set(p.checks.map((c) => c.fix?.instrument).filter(Boolean))
  return (
    <section className="inspector" aria-labelledby="inspector-h">
      <div className="block-head">
        <h3 id="inspector-h">Checks before the run</h3>
        {!p.pending && !p.notChecked && (
          <button type="button" className="link" onClick={p.onRecheck}>
            Check again
          </button>
        )}
      </div>
      {p.pending && (
        <p className="hint" role="status">
          Checking the file with FASTag…
        </p>
      )}
      {p.notChecked && <p className="hint not-checked">{p.notChecked}</p>}
      {p.detected && (
        <DetectedLine detected={p.detected} chosen={p.chosenInstrument} onUse={fixed.has(p.detected.preset ?? '') ? undefined : p.onInstrument} />
      )}
      {p.checks.length > 0 ? (
        <ul className="checks" aria-label="Checks before the run">
          {p.checks.map((c) => (
            <CheckItem
              key={c.id}
              check={c}
              answered={p.isAnswered(c.id)}
              onRunAnyway={() => p.onRunAnyway(c.id)}
              onFix={c.fix?.instrument ? () => p.onInstrument(c.fix!.instrument!) : undefined}
            />
          ))}
        </ul>
      ) : (
        !p.pending && !p.notChecked && <p className="hint">No problem found in the file's metadata.</p>
      )}
    </section>
  )
}

export interface AfterRunPanelProps {
  checks: Check[]
  detected: Detected | null
  // The input of the run the checks are about.
  input: string
  // Re-run that input with this instrument preset; null: not possible now.
  onRerun: ((instrument: string) => void) | null
}

/// The checks after a run (over the result tabs): from its reports and log.
export function AfterRunPanel(p: AfterRunPanelProps): JSX.Element | null {
  if (p.checks.length === 0) return null
  return (
    <section className="inspector after-run" aria-labelledby="after-run-h">
      <h3 id="after-run-h">Checks after the run</h3>
      {p.detected && <DetectedLine detected={p.detected} chosen="" />}
      <ul className="checks" aria-label="Checks after the run">
        {p.checks.map((c) => (
          <CheckItem
            key={c.id}
            check={c}
            onFix={c.fix?.instrument && c.fix.rerun ? () => p.onRerun?.(c.fix!.instrument!) : undefined}
            fixDisabled={!p.onRerun}
          />
        ))}
      </ul>
    </section>
  )
}

export interface RefusalProps {
  windows: number | null
  medianWidth: number | null
  command: string[] | null
}

/// FASTag refused a raw-DIA input (exit 11): what it is and what to run
/// first, inside the failure banner.
export function RefusalBlock(p: RefusalProps): JSX.Element {
  const scheme =
    p.windows != null ? ` (${p.windows} isolation windows${p.medianWidth != null ? `, median width ${p.medianWidth} Th` : ''})` : ''
  return (
    <div className="refusal" data-refusal="raw_dia">
      <p>
        FASTag did not tag this file: it is raw DIA{scheme}. Each MS2 spectrum mixes several peptides and its precursor
        is an isolation window, so tags would get wrong flanking masses. FASTag wrote no output.
      </p>
      <p>
        Generate pseudo-DDA spectra with <strong>DIAspeXtract</strong> first (diaTracer also works for .d), then run FASTag
        on the .pseudo.mzML file it writes.
      </p>
      {p.command && <CopyCommand argv={p.command} label="Copy DIAspeXtract command" />}
    </div>
  )
}
