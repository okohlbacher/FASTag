// The Setup screen as a wizard (doc/GUI-SETUP-WIZARD.md): the page header
// (the step's title, one line of context, Presets and Open earlier
// results…) with the four steps under it, Task -> Inputs -> Settings ->
// Outputs & run, one visible at a time (all four mounted, the others hidden,
// so every field keeps its id and state), and the sticky action bar with
// Back, Next or Continue and Run. The task decides which
// inputs step 2 shows; every other option stays under Advanced in step 3.
// While a run is in flight, a locked summary of what it uses.

import { useEffect, useRef, useState, type JSX, type KeyboardEvent, type RefObject } from 'react'
import { BRIEF_HINT, SECTIONS, SECTION_OF, PARAM_BY_NAME, type Dependency, type Section, UNIT_PARAMS, defaultText, dependsOf, forcedValue, humanName, inertDependency, masterSet, masters, recipeNote, unknownParams, unitOf, unplacedParams } from '../paramLayout'
import ParamField, { type ParamValue } from '../ParamField'
import { disclosure } from '../disclosure'
import { baseName } from '../digestReport'
import { IconChevron, IconError, IconFile, IconLock } from '../icons'
import HelpPopover from '../help/HelpPopover'
import PageHeader from '../shell/PageHeader'
import type { ActionNav } from '../run/RunBar'
import type { Session } from './useSession'
import type { RunState } from '../run/useRun'
import { proteomeHint } from './proteomeHint'
import type { SdrfState } from '../sdrf/useSdrf'
import { Leftovers } from '../Leftovers'
import { NotCheckedHelp } from '../inspector/NotCheckedHelp'
import { dirName, perJobOutputs } from '../app/paths'
import { shellLine } from '../app/format'
import TaskStep, { OriginRow, PresetMenu, StartRow, youNeed } from './TaskStep'
import { LANDING_TASK, taskById, type Task, type TaskId } from './tasks'
import {
  ALL_SECTION_PARAMS,
  INPUTS,
  STANDS_IN,
  STEPS,
  aboutParams,
  extensionWarning,
  hasValue,
  inputLabel,
  inputParams,
  missingInputs,
  requiredBy,
  satisfied,
  missingText,
  stepState,
  stepTwoDependents,
  taskInputs,
  type Step
} from './inputs'
import { IconCheck, IconUpload, TaskIcon } from '../icons'
import { INSTRUMENTS, presetText, shownInstrument } from './presets'
import { PRODUCT_OF, PRODUCTS, USI_PLACEHOLDER, fileName, hasDatabase, isOn, missingDatabase, neededBy, productLabel, alkylationExtension, alkylationRaise, alkylationShipped, alkylationShort, alkylationTagOnly, toggleProduct, type Product } from './products'

// A parameter that exists in the CLI but nowhere in the layout would silently
// be unreachable; surface it instead of hiding it.
const UNPLACED = unplacedParams()
const UNKNOWN = unknownParams()

/// The count of spectra to read: one control with the share
/// (subsample_fraction's "Custom count…"), never a field of its own.
const countSpec = PARAM_BY_NAME.get('subsample_spectra')
// The masters every one of @p deps names (none said in words).
function commonMasters(deps: Dependency[]): string[] {
  if (!deps.length) return []
  return masters(deps[0]).filter((m) => deps.every((d) => !d.say && masters(d).includes(m)))
}

/// A field brief of step 3, kept only when it states a default or a rule
/// (a number: "3 suits most runs", "0 keeps all"); the rest is in the
/// field's (?) popover.
export function ruleBrief(text: string | undefined): string | undefined {
  return text && /\d|default/i.test(text) ? text : undefined
}

export const FOLDED: ReadonlySet<string> = new Set(['subsample_spectra'])

/// The protein database fields: they never wait for the reports that need
/// them (database-1), or a form whose reports are off and that has no
/// database could choose neither. Only a database that replaces them (a
/// Protein database over the Shipped proteome) disables one.
const DATABASE_FIELDS: ReadonlySet<string> = new Set(['recon_fasta', 'recon_proteome'])

/// What a field waits for, as ParamField shows it (disabled, with the way
/// to turn it on); null when it is free.
export function fieldNeeds(name: string, values: Record<string, unknown>): Dependency | null {
  if (!DATABASE_FIELDS.has(name)) return inertDependency(name, values)
  return dependsOf(name).find((d) => d.replaced && masters(d).some((n) => masterSet(d, n, values))) ?? null
}

/// Switches a product checkbox drives (setup/products.ts): never a field.
export const WIRED: ReadonlySet<string> = new Set(
  PRODUCTS.flatMap((p) => [...(p.flag ? [p.flag] : []), ...Object.keys(p.also ?? {}).filter((k) => PARAM_BY_NAME.get(k)?.type === 'bool')])
)

/// The control that owns @p name when it has no field of its own (round 4,
/// 24): the count is the "Custom count…" of subsample_fraction (its input
/// p-subsample_spectra once revealed); a wired switch is the checkbox of
/// the product that sets it (census_score: Spectra ranked by
/// identifiability). Null for a parameter with a field.
export function ownerOf(name: string): { id: string; revealCount?: boolean } | null {
  if (name === 'subsample_spectra') return { id: 'p-subsample_fraction', revealCount: true }
  if (!WIRED.has(name)) return null
  const prod = PRODUCTS.find((p) => p.flag === name) ?? PRODUCTS.find((p) => p.also && name in p.also)
  return prod ? { id: `out-${prod.param}` } : null
}

/// The params Advanced shows for @p task: every group's, less what
/// Settings and Outputs already show and the switches products drive.
/// A Sage configuration names the input; Sage reads mzML, MGF and a
/// timsTOF .d folder, not .raw, mzPeak or a .d.zip archive.
function sageCantRead(values: Record<string, unknown>, input: string): boolean {
  const engine = String(values['search_engine'] ?? '').trim() || 'sage'
  return engine === 'sage' && /\.(raw|mzpeak|zip)$/i.test(input)
}

/// The tags output a batch job is shown with in Outputs: the naming rule.
const BATCH_OUT = '<input>.tags.tsv'

/// The params Advanced shows for @p task (its layout), less the controls
/// step 2 shows for @p owner (the task, or null for the FASTag defaults):
/// its inputs, its about fields and the settings that wait on an input only.
/// With @p values, an input step 2 requires for the reports that are on
/// (the Protein database of Characterize's placements) leaves Advanced.
export function advancedParams(task: Task, owner: Task | null = task, values?: Record<string, unknown>): string[] {
  const shown = new Set([
    ...task.basic,
    ...task.outputs,
    ...SECTIONS.filter((s) => s.home === 'common').flatMap((s) => s.params),
    ...inputParams(owner, values),
    ...aboutParams(owner)
  ])
  const base = SECTIONS.flatMap((s) => s.params).filter((n) => !shown.has(n) && !WIRED.has(n) && !UNIT_PARAMS.has(n) && !FOLDED.has(n))
  const deps = new Set([...stepTwoDependents(owner, base, values).values()].flat())
  return base.filter((n) => !deps.has(n))
}

/// The settings step 2 shows under an input of @p owner once it is set.
export function inputDependents(task: Task, owner: Task | null, values?: Record<string, unknown>): Map<string, string[]> {
  const shown = new Set([
    ...task.basic,
    ...task.outputs,
    ...SECTIONS.filter((s) => s.home === 'common').flatMap((s) => s.params),
    ...inputParams(owner, values),
    ...aboutParams(owner)
  ])
  return stepTwoDependents(
    owner,
    ALL_SECTION_PARAMS.filter((n) => !shown.has(n) && !WIRED.has(n) && !UNIT_PARAMS.has(n) && !FOLDED.has(n)),
    values
  )
}

export interface SetupFormProps {
  session: Session
  run: RunState
  onPickInput(): void
  /// The action bar of steps 2-4 and of a run (App.tsx: the run bar, or
  /// the wizard's buttons alone while the Batch view holds the queue).
  actionBar?(nav?: ActionNav): JSX.Element | null
  // Show the Batch view, where the queue is.
  onOpenBatch(): void
  // Add the spectra files of a folder to the batch (P2b).
  onAddFolder?(): void
  // What Add folder… found here (App.tsx): its live region.
  folderNote?: JSX.Element
  // The Batch input's "Add files…" button, where focus goes when the queue
  // is cleared.
  addBatchRef: RefObject<HTMLButtonElement | null>
  // "Open earlier results…" under the chooser.
  onOpenResults(): void
  // The inspector's checks of the input (inspector/InspectorPanel.tsx).
  inspector?: JSX.Element | null
  // The SDRF of a batch (optional).
  sdrf?: SdrfState
  // The instrument preset the input checks propose.
  detectedInstrument?: string | null
  // The step-2 input files not found on disk (pathStatus).
  notFound?: readonly string[]
  // Why the input was not checked before the run, when that is no problem
  // to act on (no -probe_input): behind a (?) by the Instrument brief.
  notCheckedNote?: string | null
  // The engine reads Alkylation proteome auto as the shipped human proteome
  // (from before 1.16; Inspector.legacyAuto).
  legacyAuto?: boolean
}

export default function SetupForm({
  session,
  run,
  onPickInput,
  actionBar,
  onOpenBatch,
  onAddFolder,
  folderNote,
  addBatchRef,
  onOpenResults,
  inspector,
  sdrf,
  detectedInstrument,
  notFound = [],
  notCheckedNote = null,
  legacyAuto = false
}: SetupFormProps): JSX.Element {
  const { input, out, values, setValue, openGroups, setOpenGroups, writingFiles, changedParams } = session
  const { busy, jobs, revealErr } = run
  // The layout of steps 3 and 4: the task's, the landing task's for the
  // FASTag defaults (5.5). @p owner: the task step 2 is for (null: none).
  const task = taskById(session.task ?? LANDING_TASK)!
  const owner = session.task ? task : null
  const taskLabel = owner ? owner.label : 'FASTag defaults (no workflow)'
  const batch = jobs.length > 0 || session.mode === 'batch'
  // The USI accession is being typed: its row stays checked while empty.
  const [usiEditing, setUsiEditing] = useState(false)

  // Fields a batch cannot use, and why: one run's identifications are no
  // identifications of another (useRun sends none in a batch).
  const batchBlocked = (name: string): string | undefined =>
    !batch
      ? undefined
      : name === 'census_ids'
        ? 'Not in Batch mode: one file of identifications cannot belong to every input, so a batch marks no spectrum identified. Run each file on its own to use its identifications.'
        : dependsOf(name).some((d) => masters(d).includes('census_ids'))
          ? 'Not in Batch mode: only used with an identification file, which a batch does not use.'
          : undefined

  const field = (name: string, opts: { brief?: string; required?: boolean } = {}): JSX.Element | null => {
    const spec = PARAM_BY_NAME.get(name)
    // A unit is drawn inside the field of its value.
    if (!spec || UNIT_PARAMS.has(name)) return null
    const unitName = unitOf(name)
    const unitSpec = unitName ? PARAM_BY_NAME.get(unitName) : undefined
    // A value the CLI cannot be told (shortlist_gapped under the MSFragger
    // recipe): shown as it runs, disabled, with the reason.
    const forced = forcedValue(name, values)
    return (
      <ParamField
        key={`${name}:${session.formGen}`}
        spec={spec}
        value={forced ? forced.value : values[name]}
        needs={fieldNeeds(name, values)}
        onChange={(v) => setValue(name, v)}
        onPickFile={session.pickFor}
        brief={recipeNote(name, values) ?? opts.brief}
        hint={task.help[name] ?? BRIEF_HINT[name]}
        required={opts.required}
        setBy={session.edits.includes(name) || (!!unitName && session.edits.includes(unitName)) ? undefined : session.originText}
        blocked={batchBlocked(name) ?? forced?.note}
        unit={
          unitSpec && unitName
            ? {
                spec: unitSpec,
                value: values[unitName],
                onChange: (v) => setValue(unitName, v)
              }
            : undefined
        }
        count={
          name === 'subsample_fraction' && countSpec
            ? {
                spec: countSpec,
                value: values['subsample_spectra'],
                onChange: (v) => setValue('subsample_spectra', v)
              }
            : undefined
        }
      />
    )
  }

  // The extension the alkylation report raised ({from, to}), restored when
  // it is unticked while Extension still holds the raised value. It belongs
  // to the values it was raised in: a workflow, preset, reset or undo that
  // replaces them forgets it (gen), or a later workflow's own Extension
  // would read as the raise and be put back.
  const raisedExt = useRef<{
    from: ParamValue
    to: ParamValue
    gen: number
  } | null>(null)
  const raisedNow = (): { from: ParamValue; to: ParamValue } | null =>
    raisedExt.current && raisedExt.current.gen === session.formGen ? raisedExt.current : null
  const keepRaised = (r: { from: ParamValue; to: ParamValue } | null): void => {
    raisedExt.current = r ? { ...r, gen: session.formGen } : null
  }
  // The proteome as committed: a name typed letter by letter ("m" on the
  // way to "mouse") would read as a FASTA path. A value set by the form
  // itself (a workflow, a preset) counts at once.
  const [proteome, setProteome] = useState(values['alkylation_proteome'])
  useEffect(() => {
    if (document.activeElement?.id !== 'p-alkylation_proteome') setProteome(values['alkylation_proteome'])
  }, [values['alkylation_proteome']])
  // While the alkylation report is on, Extension follows what its proteome
  // and the tag length need (alkylationRaise): raised, lowered or put back;
  // a protein database or a report that places tags makes it unneeded.
  // Only on the user's own edits: values that replace the form (History's
  // Settings, a preset, a workflow, reset, undo) are taken as they are, so
  // the form still sends the recorded call; a short Extension then shows
  // the note and its one-click raise (alkylationWhy).
  const alkOn = isOn(PRODUCT_OF.get('alkylation_out')!, values)
  const placing = ['recon_fasta', 'recon_out', 'shortlist_out', 'fasta_out', 'search_config_out'].map((n) => String(values[n] ?? '')).join('|')
  const seeds = JSON.stringify([values['tag_length'] ?? '', values['tag_lengths'] ?? '', values['recon_min_length'] ?? ''])
  const raiseKey = (prot: ParamValue): string => JSON.stringify([placing, prot ?? '', seeds, alkOn])
  // The inputs of the raise as the last replacement left them (its own
  // proteome, not the state that lags a render behind): until one of them
  // changes, nothing is raised. -1: the values the form opens with count
  // as a replacement too.
  const raiseBase = useRef<{ gen: number; key: string }>({ gen: -1, key: '' })
  useEffect(() => {
    if (raiseBase.current.gen !== session.formGen) {
      raiseBase.current = {
        gen: session.formGen,
        key: raiseKey(values['alkylation_proteome'])
      }
      keepRaised(null)
      return
    }
    if (raiseKey(proteome) === raiseBase.current.key) return
    raiseBase.current.key = ''
    const r = alkylationRaise({ ...values, alkylation_proteome: proteome }, raisedNow())
    keepRaised(r.raised)
    if (r.values['extension'] !== values['extension']) session.setValues((v) => ({ ...v, extension: r.values['extension'] }))
  }, [placing, proteome, seeds, alkOn, session.formGen])
  // The note of a group's settings that wait on other reports. With Turn
  // on buttons it names exactly the reports they turn on (@p targets);
  // else one report that every setting needs, in a plain sentence, or each
  // report that would show some of them, once. Up to three are named; the
  // per-setting detail is the popover's.
  const listOr = (xs: string[]): string =>
    xs.length <= 1 ? xs.join('') : xs.length <= 3 ? `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}` : `${xs.slice(0, 3).join(', ')} or ${xs.length - 3} more`
  const needsSentence = (n: number, parts: { dep: Dependency; prod?: Product }[], one?: Product): string => {
    const lead = n === 1 ? 'One more setting' : `${n} more settings`
    const need = n === 1 ? 'needs' : 'need'
    const name = (m: string): string => productLabel(m) ?? humanName(m)
    if (one) return `${lead} ${need} ${one.label}.`
    const deps = parts.map((x) => x.dep)
    if (parts.some((x) => x.prod)) {
      // A set with a Turn on is named by the report it turns on (or its
      // condition in words); one without, by its reports.
      const items = [...new Set(parts.flatMap((x) => (x.dep.say ? [x.dep.say] : x.prod ? [`${x.prod.label} on`] : masters(x.dep).map((m) => `${name(m)} on`))))]
      if (items.length === 1 && parts.length === 1) return `${lead} ${need} ${parts[0].dep.say ?? parts[0].prod!.label}.`
      return `${lead} appear with ${listOr(items)}.`
    }
    if (deps.length === 1) return `${lead} ${need} ${deps[0].say ?? listOr(masters(deps[0]).map(name))}.`
    const common = commonMasters(deps)
    if (common.length === 1) return `${lead} need ${name(common[0])}.`
    // A report or switch is "on"; a condition in words (say) is said as it is.
    const items = [...new Set(deps.flatMap((d) => (d.say ? [d.say] : masters(d).map((m) => `${name(m)} on`))))]
    return `${lead} appear with ${listOr(items)}.`
  }
  // The Extension field is under Advanced: the note's link opens its group
  // and focuses it, as the parameter search does.
  const extGroup = SECTION_OF.get('extension')?.title ?? 'Tagging'
  // Generate tags and Mass-shift survey show Extension in Settings.
  const extInSettings = task.basic.includes('extension')
  const extWhere = extInSettings ? 'Settings' : `Advanced › ${extGroup}`
  const goToExtension = (): void => {
    session.setStep(3)
    if (!extInSettings) {
      session.setAdvancedOpen(true)
      setOpenGroups((g) => ({
        ...g,
        [extGroup]: true,
        'Other analyses': true
      }))
    }
    setTimeout(() => {
      const el = document.getElementById('p-extension')
      el?.scrollIntoView?.({ block: 'center' })
      el?.focus()
    }, 0)
  }
  // The raise, said where the field is and what it changes (tasks.ts
  // productNotes has the detail).
  // `pending`: the report is off, so nothing is raised yet; say what turning
  // it on would do, not a change the call does not make.
  const raiseNote = (from: ParamValue, to: ParamValue, pending = false): JSX.Element => (
    <>
      {pending ? 'Turning it on raises ' : ''}
      <button type="button" className="link small" onClick={goToExtension}>
        Extension
      </button>{' '}
      {String(from ?? '') || '0'} → {String(to)} ({extWhere}); {pending ? 'that changes' : 'changes'} every tag
      {validatedAt2()}.
    </>
  )
  // The species and digest calls are validated at Extension 2: said only
  // when one of those reports is on.
  const validatedAt2 = (): string => {
    const on = (['species_out', 'digest_out'] as const).filter((n) => { const q = PRODUCT_OF.get(n); return !!q && isOn(q, values) })
    if (!on.length) return ''
    return `; ${on.length === 2 ? 'species and digest are' : on[0] === 'species_out' ? 'species is' : 'digest is'} validated at 2`
  }
  // feedback 202dbcf4: without a database the report needs no length; its
  // votes need a C inside a tag, so longer tags give more.
  // An engine from before 1.16 places such a run on the human proteome.
  const tagOnlyNote = (): JSX.Element => legacyAuto ? (
    <>This FASTag program is older than the app: with Proteome auto it places the tags on the shipped human proteome, not the call from the tags alone.</>
  ) : (
    <>
      No database needed: the call is read off the tags; a longer{' '}
      <button type="button" className="link small" onClick={goToExtension}>
        Extension
      </button>{' '}
      ({extWhere}) gives more votes.
    </>
  )
  const alkylationWhy = (on: boolean): JSX.Element | string | null => {
    if (alkylationTagOnly(values)) return tagOnlyNote()
    const need = alkylationExtension(values)
    const short = alkylationShort(values)
    const custom = !alkylationShipped(values)
    const min = Number(String(values['recon_min_length'] ?? '')) > 0
    if (!on) return need ? raiseNote(values['extension'], need, true) : short && custom ? `Needs Extension ${short}${min ? '' : ' for a human-sized database'}.` : null
    const r = raisedNow()
    if (r && String(values['extension'] ?? '') === String(r.to)) return raiseNote(r.from, r.to)
    if (!short) return null
    if (custom && !min) return `Needs Extension ${short} for a human-sized database: shorter tags may not place on it.`
    return `Needs Extension ${short}: shorter tags do not place on the ${custom ? 'database' : 'proteome'}.`
  }
  // The one-click raise beside that note. On a shipped proteome it is
  // remembered as the report's raise (it follows the tag length and is put
  // back with the report); on a FASTA it is the user's value.
  const raiseExtension = (): void => {
    const to = alkylationShort(values)
    if (!to) return
    keepRaised(alkylationShipped(values) ? { from: values['extension'] ?? '', to } : null)
    session.setValues((v) => ({ ...v, extension: to }))
  }
  const toggle = (p: Product, on: boolean): void => {
    const r = toggleProduct(p, on, values, out, raisedNow())
    keepRaised(r.raised)
    session.setValues(r.values)
  }

  // One product row: checkbox, label, the file it writes, and why it is
  // locked or what it still needs.
  const productRow = (param: string): JSX.Element | null => {
    const p = PRODUCT_OF.get(param)
    if (!p) return null
    // Mass-shift survey (tasks.ts dbOptional): a report that needs a protein
    // database is off, not a block, while none is chosen.
    const noDb = !!owner?.dbOptional && !!p.db && !hasDatabase(p, values)
    const on = !noDb && (isOn(p, values) || (p.param === 'usi_collection' && usiEditing))
    const needed = neededBy(p, values)
    const follows = p.follows ? PRODUCT_OF.get(p.follows) : undefined
    const locked = p.param === 'out' || noDb || (on && needed.length > 0) || !!follows
    // A batch names each output after its input (jobOut, rebaseOutputs):
    // the rule, not one run's file.
    // Each job's names by the job's own rule (perJobOutputs over
    // <input>.tags.tsv), so CLI-derived ones read <input>.tags.glyco.tsv.
    const name = batch ? fileName(p, perJobOutputs(values, BATCH_OUT), BATCH_OUT) : fileName(p, values, out)
    // A report driven by a switch (species, glyco, census) is that switch's
    // control, so it carries the switch's field id.
    const id = p.flag && !p.follows ? `p-${p.flag}` : `out-${p.param}`
    const why =
      p.param === 'out'
        ? 'always written'
        : noDb
          ? 'needs a protein database'
        : on && needed.length > 0
          ? // One line: two or more are counted, and named in the row's tooltip.
            needed.length > 1
            ? `needed by ${needed.length} reports`
            : `needed by ${needed.join(', ')}`
          : follows
            ? `written with the ${follows.label.toLowerCase()}`
            : p.param === 'alkylation_out'
              ? alkylationWhy(on)
              : p.param === 'search_config_out' && on && String(values['search_engine'] ?? '') === 'comet' && !String(values['search_config_template'] ?? '').trim()
                ? 'a Comet fragment: merge it into your comet.params, or give your template in Inputs'
                : p.param === 'search_config_out' && on && (batch ? jobs.some((j) => sageCantRead(values, j.input)) : sageCantRead(values, input))
                  ? batch
                    ? 'each names its input, and Sage cannot read .raw, mzPeak or .d.zip: convert those to mzML and give that on the Sage command line'
                    : 'it names this input, which Sage cannot read: convert it to mzML and give that on the Sage command line'
                  : null
    // The detail of a workflow's note (tasks.ts productNotes): its (?).
    const detail = !on ? task.productNotes?.[p.param] : undefined
    const spec = PARAM_BY_NAME.get(p.param)
    // A sentence of a note (the alkylation raise) takes a line of its own
    // across the card, so it neither squeezes the row nor pushes the (?)
    // under it.
    const wide = p.param === 'alkylation_out' && why != null
    return (
      <li key={p.param} className={`product${on ? ' on' : ''}${locked ? ' fixed' : ''}${wide ? ' wide' : ''}`}>
        <input
          id={id}
          type="checkbox"
          checked={on}
          disabled={locked}
          onChange={(e) => toggle(p, e.target.checked)}
          aria-describedby={`${id}-d`}
          data-param={p.param}
          data-value={typeof values[p.param] === 'string' ? String(values[p.param]) : undefined}
        />
        <label htmlFor={id} title={on && needed.length > 1 ? `${p.what} Needed by ${needed.join(', ')}.` : p.what}>
          {p.label}
        </label>
        {detail && <HelpPopover name={p.param} label={p.label} description={detail} deflt="not written" />}
        {p.experimental && <span className="badge">experimental</span>}
        {name && <span className="product-file mono">→ {name}</span>}
        <span id={`${id}-d`} className="product-note">
          {why}
        </span>
        {p.param === 'alkylation_out' && on && !!alkylationShort(values) && (
          <button type="button" className="link small" onClick={raiseExtension}>
            Set Extension to {alkylationShort(values)}
          </button>
        )}
        {on && !!out && !batch && !p.column && p.param !== 'out' && spec?.type === 'output-file' && (
          <button type="button" className="link small" aria-label={`Change the file of ${p.label}`} onClick={() => void session.pickFor(spec)}>
            Change…
          </button>
        )}
        {p.param === 'usi_collection' && on && (
          <>
            <input
              className="usi-acc"
              aria-label="PRIDE accession for the USI column"
              aria-describedby="usi-h"
              value={String(values['usi_collection'] ?? '')}
              onChange={(e) => setValue('usi_collection', e.target.value)}
              onFocus={() => setUsiEditing(true)}
              // Left empty, the placeholder again: the CLI writes the column
              // only with an accession, and the row is checked.
              onBlur={(e) => {
                setUsiEditing(false)
                if (!e.target.value.trim()) setValue('usi_collection', USI_PLACEHOLDER)
              }}
            />
            <span id="usi-h" className="product-note">
              {String(values['usi_collection']).trim() === USI_PLACEHOLDER ? 'the placeholder until the data set has a PXD accession' : 'the data set accession'}
            </span>
          </>
        )}
      </li>
    )
  }

  // A group of Advanced: its products as checkboxes, then its fields.
  const ADV = new Set(advancedParams(task, owner, values))
  // The controls among @p names edited off where the form started: a
  // switch a product checkbox drives (species, glyco, census) counts as
  // that checkbox (tags-2), once.
  const changedAmong = (names: Iterable<string>): number => {
    const among = new Set(names)
    const controls = session.edits.map((n) => {
      const o = WIRED.has(n) ? ownerOf(n) : null
      return o && o.id.startsWith('out-') ? o.id.slice('out-'.length) : n
    })
    return new Set(controls.filter((c) => among.has(c))).size
  }
  const renderGroup = (sec: Section, defaultOpen: boolean): JSX.Element | null => {
    const names = sec.params.filter((n) => ADV.has(n))
    if (names.length === 0) return null
    const open = openGroups[sec.title] ?? defaultOpen
    const changed = changedAmong(names)
    const d = disclosure(open, (o) => setOpenGroups((st) => ({ ...st, [sec.title]: o })))
    const products = names.filter((n) => PRODUCT_OF.has(n))
    const fields = names.filter((n) => !PRODUCT_OF.has(n))
    // Fields waiting for the same reports or switches, one or several:
    // folded into ONE note per group, after its fields, with the reason
    // in its (?) (doc/GUI-WORKFLOWS.md 2.4). A field holding a value of
    // its own stays in view (a dropped taxonomy), as does one replaced by
    // another option (Turn on would not help).
    const waiting = new Map<string, { dep: Dependency; names: string[] }>()
    for (const n of fields) {
      const d = fieldNeeds(n, values)
      if (!d || d.replaced || session.edits.includes(n)) continue
      const key = masters(d).join(',')
      const w = waiting.get(key)
      if (w) w.names.push(n)
      else waiting.set(key, { dep: d, names: [n] })
    }
    const sets = [...waiting.values()]
    const folded = new Set(sets.flatMap((w) => w.names))
    const shown = fields.filter((n) => !folded.has(n))
    const isProduct = (x: string): boolean => PRODUCT_OF.has(x) || PRODUCTS.some((q) => q.flag === x)
    const productOf = (x: string): Product | undefined => PRODUCT_OF.get(x) ?? PRODUCTS.find((q) => q.flag === x)
    const parts = sets.map((w) => {
      const ms = masters(w.dep)
      const what = w.dep.say ?? ms.map((m) => productLabel(m) ?? humanName(m)).join(' or ')
      // A Turn on only where it is the way to go: never when a report of
      // the set is a checkbox of this group (it is right above), and
      // naming its target, the workflow's own report first.
      const here = ms.some((x) => sec.params.includes(x) && isProduct(x))
      const cands = here ? [] : ms.filter((x) => !sec.params.includes(x) && isProduct(x))
      // A target without side effects first: the alkylation report raises
      // Extension (alkylationExtension), so Tag placements unlocks the same
      // settings without changing the tags.
      const quiet = (x: string): boolean => !(productOf(x)!.param === 'alkylation_out' && alkylationExtension(values) != null)
      const m =
        cands.find((x) => quiet(x) && task.outputs.includes(productOf(x)!.param)) ??
        cands.find(quiet) ??
        cands.find((x) => task.outputs.includes(productOf(x)!.param)) ??
        cands[0]
      return { w, what, prod: m ? productOf(m) : undefined, cands }
    })
    // One report every waiting setting needs: its Turn on is the only one,
    // so the note and the button name the same report.
    const common = commonMasters(parts.map((x) => x.w.dep))
    const one = common.length === 1 && parts.every((x) => x.cands.includes(common[0])) ? productOf(common[0]) : undefined
    const targets = one ? [one] : [...new Map(parts.flatMap((x) => (x.prod ? [[x.prod.param, x.prod] as [string, Product]] : []))).values()]
    const waitingNames = sets.flatMap((w) => w.names)
    const needs =
      parts.length === 0 ? null : (
        <div className="group-needs" role="note">
          {/* The (?) inline at the end of the note, never on a line of its own. */}
          <span className="needs-text">
            {needsSentence(waitingNames.length, parts.map((x) => ({ dep: x.w.dep, prod: x.prod })), one)}{' '}
            <HelpPopover
            name={waitingNames[0]}
            label={`the settings of ${sec.title} not used yet`}
            description={parts
              .map((x) => `${x.w.names.map(humanName).join(', ')}: not used yet (${x.w.dep.note}); ${x.w.names.length === 1 ? 'it shows' : 'they show'} once ${x.what} is on.`)
              .join(' ')}
            deflt=""
            />
          </span>
          {targets.map((prod) => (
            <button
              type="button"
              key={prod.param}
              className="secondary small"
              onClick={() => {
                toggle(prod, true)
                // Its settings are what the click was for: show them.
                setOpenGroups((st) => ({ ...st, [sec.title]: true }))
              }}
            >
              Turn on {prod.label}
              {prod.param === 'alkylation_out' && alkylationExtension(values) ? ` (sets Extension ${alkylationExtension(values)})` : ''}
            </button>
          ))}
        </div>
      )
    // A group with nothing to set until a report is on: one line, its
    // note and Turn on beside the title, not a group to open (Other
    // analyses lists many of them).
    if (needs && products.length === 0 && shown.length === 0)
      return (
        <div className="sec waiting-line" key={sec.title} data-group={sec.title} title={sec.blurb}>
          <span className="sec-title">{sec.title}</span>
          {sec.experimental && <span className="badge">experimental</span>}
          {needs}
        </div>
      )
    return (
      <details className={`sec${open ? ' open' : ''}${changed ? ' active' : ''}`} key={sec.title} data-group={sec.title} {...d.details}>
        <summary className="disclosure" {...d.summary}>
          <span className={`chev ${open ? 'open' : ''}`} aria-hidden="true">
            <IconChevron />
          </span>
          <span className="sec-title">{sec.title}</span>{' '}
          {sec.experimental && <span className="badge">experimental</span>}
          {changed > 0 && <span className="chip accent">{changed} changed</span>}
        </summary>
        {/* Built only while open: Advanced holds every option of FASTag.
            The parameter search opens a group before it focuses a field. */}
        {open && (
          <div className="sec-body">
            <p className="blurb">{sec.blurb}</p>
            {products.length > 0 && <ul className="products">{products.map(productRow)}</ul>}
            {shown.length > 0 && <div className="adv-fields">{shown.map((n) => field(n))}</div>}
            {needs}
          </div>
        )}
      </details>
    )
  }

  // The workflow's own groups, then those of another home it writes a
  // report of by default (Characterize: the species groups).
  const leads = new Set(task.leadGroups ?? [])
  const ownGroups = [...SECTIONS.filter((s) => s.home === task.id), ...SECTIONS.filter((s) => leads.has(s.title))]
  const globalGroups = SECTIONS.filter((s) => s.home === 'global')
  // A group of its own with something to show in Advanced (Generate tags'
  // one lives in Outputs).
  const ownShown = ownGroups.some((s) => s.params.some((n) => ADV.has(n)))
  const otherGroups = SECTIONS.filter((s) => s.home !== task.id && s.home !== 'global' && s.home !== 'common' && !leads.has(s.title))
  const advChanged = changedAmong(ADV)
  const advD = disclosure(session.advancedOpen, session.setAdvancedOpen)
  const otherOpen = openGroups['Other analyses'] ?? false
  const otherD = disclosure(otherOpen, (o) => setOpenGroups((st) => ({ ...st, 'Other analyses': o })))
  const otherChanged = changedAmong(otherGroups.flatMap((s) => s.params).filter((n) => ADV.has(n)))

  const instrument = shownInstrument(values, session.instrument)
  const custom = session.instrument === 'custom' || !instrument
  const step = session.step

  // A setting waiting for a control of steps 2 or 3 (Triage's ID q-value
  // and E-value, waiting for Identifications; the Comet template, until
  // Search engine is Comet): hidden until it is set, not a disabled field
  // with a note (round 4, 18).
  const ownInputs = inputParams(owner, values)
  const shownHere = new Set([...task.basic, ...aboutParams(owner), ...ownInputs])
  const waitsOnShownFile = (n: string): boolean => {
    const d = inertDependency(n, values)
    return !!d && !d.replaced && masters(d).some((m) => shownHere.has(m))
  }

  // Step 2: the inputs of the task (setup/inputs.ts).
  const ti = taskInputs(owner, values, batch ? 'batch' : 'one', session.revealed, ADV)
  const missing = missingInputs(owner, values, {
    input,
    jobs: jobs.length,
    mode: batch ? 'batch' : 'one'
  })
  const deps = inputDependents(task, owner, values)
  // Errors are shown once the user tried to move on or run, never on an
  // untouched step.
  const [tried, setTried] = useState(false)
  const notFoundOf = (n: string): string[] => [n, ...(INPUTS[n]?.also ?? [])].map((m) => String(values[m] ?? '')).filter((p) => p && notFound.includes(p))
  const inputErrors = missing.filter((n) => n !== 'in').length + (missing.includes('in') ? 1 : 0) + ti.extraneous.length + notFound.length
  const states = stepState({
    confirmed: session.taskConfirmed,
    step,
    inputErrors,
    settingErrors: Object.keys(session.invalid).length,
    outputErrors: !batch && !!input && !out ? 1 : 0
  })

  // Moving between steps: focus goes to the step's heading, and a live
  // region says where the user is.
  // One path for every caller (session.goStep): Back, Next, Alt+arrows,
  // the stepper, and the run bar's Go to Inputs from another view. Pending
  // until the step's heading is shown.
  const [said, setSaid] = useState('')
  const go = (n: Step): void => {
    if (n > 1 && !session.taskConfirmed) return
    if (step === 2 && n > 2) setTried(true)
    session.goStep(n)
  }
  const stepFocus = session.stepFocus
  useEffect(() => {
    if (!stepFocus.current) return
    const h = document.getElementById(`step-h-${step}`)
    if (!h || h.closest('[hidden]')) return
    stepFocus.current = false
    setSaid(`Step ${step} of 4: ${STEPS[step - 1].name}`)
    h.focus()
  })
  // Continue with @p id (step 1): the task is confirmed, the form replaced
  // when it is another task, and the wizard moves on to Inputs when one is
  // missing, else back to the step the task was changed from.
  const confirm = (id: TaskId): void => {
    const t = taskById(id) ?? null
    const back = session.cameFrom()
    session.chooseTask(id)
    session.setTaskConfirmed(true)
    const miss = missingInputs(t, values, {
      input,
      jobs: jobs.length,
      mode: batch ? 'batch' : 'one'
    })
    const n: Step = miss.length || back === 1 || !session.taskConfirmed ? 2 : back
    session.goStep(n)
  }
  // Alt+Left/Right: the previous and next step, not while typing.
  const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return
    const t = e.target as HTMLElement
    if (t.closest('input, textarea, select, [contenteditable="true"]')) return
    const n = step + (e.key === 'ArrowRight' ? 1 : -1)
    if (n < 1 || n > 4) return
    e.preventDefault()
    go(n as Step)
  }

  const spectraName = batch ? (jobs.length ? `${jobs.length} ${jobs.length === 1 ? 'file' : 'files'}` : '') : input ? baseName(input) : ''
  // The local navigation under the title: the four steps, underlined; a
  // done step says what it holds (the task, the spectra) after its name.
  const stepper = (
    <div className="localnav stepper-row">
      <nav aria-label="Setup steps" className="stepper">
        <ol>
          {STEPS.map(({ n, name }) => {
            const st = states[n]
            const locked = st === 'locked'
            const why = locked
              ? 'Choose a task first'
              : st === 'blocked' && n === 2
                ? missing.length
                  ? `${missingText(missing)} missing`
                  : 'An input needs attention'
                : st === 'blocked'
                  ? 'A value needs attention'
                  : ''
            const ctx = n === 1 && session.taskConfirmed ? taskLabel : n === 2 && spectraName && session.taskConfirmed ? spectraName : ''
            return (
              <li key={n} className={`step-item ${st}`}>
                <button
                  type="button"
                  data-step-btn={n}
                  aria-current={step === n ? 'step' : undefined}
                  aria-disabled={locked || undefined}
                  aria-describedby={why ? `step-why-${n}` : undefined}
                  title={ctx ? `${name}: ${ctx}` : undefined}
                  onClick={() => go(n)}
                >
                  <span className="step-n" aria-hidden="true">
                    {st === 'done' ? <IconCheck /> : st === 'blocked' ? '!' : n}
                  </span>
                  <span className="step-name">{name}</span>
                  {ctx && (
                    <>
                      <span className="sr-only">: </span>
                      <span className="step-ctx">{ctx}</span>
                    </>
                  )}
                </button>
                {why && (
                  <span id={`step-why-${n}`} className="sr-only">
                    {why}
                  </span>
                )}
              </li>
            )
          })}
        </ol>
      </nav>
      {/* Files an unfinished run left: a compact notice on the stepper's
          line, not a block that pushes the tiles down. */}
      <Leftovers />
      {!batch && !!input && session.taskConfirmed && step !== 2 && (
        <button type="button" className="link small change-spectra" onClick={onPickInput}>
          Change spectra…
        </button>
      )}
    </div>
  )

  const body = (n: Step, content: JSX.Element): JSX.Element => (
    <section className="wizard-step" id={`step-${n}`} data-step={n} hidden={step !== n} aria-labelledby={`step-h-${n}`}>
      {content}
    </section>
  )

  // An input's errors, under its field: missing, wrong extension, not found.
  const inputNotes = (n: string, required = false): JSX.Element | null => {
    const notes: { warn: boolean; text: string }[] = []
    if (required && tried && !satisfied(values, n))
      notes.push({
        warn: true,
        text: `Required for ${requiredBy(owner, values, n)}: choose a protein FASTA.`
      })
    for (const m of [n, ...(INPUTS[n]?.also ?? [])]) {
      const w = extensionWarning(m, String(values[m] ?? ''))
      if (w) notes.push({ warn: false, text: w })
    }
    for (const p of notFoundOf(n)) notes.push({ warn: true, text: `Not found: ${p}` })
    if (!notes.length) return null
    return (
      <div className="input-notes" id={`p-${n}-notes`}>
        {notes.map((x) => (
          <p key={x.text} className={x.warn ? 'warn' : 'hint note-flag'}>
            {x.warn && <IconError />}
            <span>{x.text}</span>
          </p>
        ))}
      </div>
    )
  }
  // The settings that wait on nothing but this input, under it once set.
  const dependentsOf = (n: string): JSX.Element | null => {
    const d = deps.get(n)
    if (!d?.length || !hasValue(values, n)) return null
    return <div className="input-deps">{d.map((x) => field(x))}</div>
  }
  // The Filter database stands in (the CLI's own rule): said, not empty.
  // Not while a shipped proteome is chosen: the CLI places on that first.
  const standIn = (n: string): JSX.Element | null => {
    const alt = STANDS_IN[n]
    const spec = PARAM_BY_NAME.get(n)
    if (alt && !hasValue(values, n) && hasValue(values, alt) && !hasValue(values, 'recon_proteome'))
      return (
        <div className="field standin" key={n}>
          <span className="label-row">
            <span className="pname">{humanName(n)}</span>
          </span>
          <p className="help">
            Using your Filter database: <span className="mono">{baseName(String(values[alt]))}</span>{' '}
            {spec && (
              <button type="button" className="link small" onClick={() => void session.pickFor(spec)}>
                Choose another
              </button>
            )}
          </p>
        </div>
      )
    return null
  }
  const requiredInput = (n: string): JSX.Element =>
    standIn(n) ?? (
      <div key={n} className="input-block">
        {field(n, { brief: task.help[n] ?? INPUTS[n]?.why, required: true })}
        {inputNotes(n, true)}
      </div>
    )
  // An input the task shows open (tasks.ts openInputs: Mass-shift survey's
  // Protein database) has its stand-in said, and Remove only once it is set.
  const optionalInput = (n: string): JSX.Element => {
    const open = !!owner?.openInputs?.includes(n)
    const alt = open ? standIn(n) : null
    if (alt) return alt
    return (
      <div key={n} className="input-block optional">
        {[n, ...(INPUTS[n]?.also ?? [])].map((m) =>
          field(m, {
            brief: m === n ? (open ? (task.help[n] ?? INPUTS[n]?.why) : (INPUTS[n]?.why ?? task.help[n])) : undefined
          })
        )}
        {inputNotes(n)}
        {dependentsOf(n)}
        {(!open || hasValue(values, n)) && (
          <button type="button" className="link small" aria-label={`Remove ${inputLabel(n)}`} onClick={() => session.removeInput(n)}>
            Remove
          </button>
        )}
      </div>
    )
  }

  const spectraBlock = (
    <div className="spectra-block">
      <h3 className="section-label">Spectra</h3>
      <div className={batch ? 'input-row batch' : 'input-row'}>
        <div className="seg" role="radiogroup" aria-label="Input mode">
          {(['one', 'batch'] as const).map((m) => (
            <label
              key={m}
              className={`seg-opt${(m === 'batch') === batch ? ' on' : ''}`}
              title={m === 'one' && jobs.length > 0 ? 'Clear the batch (Open the batch, then Clear) to use one file' : undefined}
            >
              <input
                type="radio"
                name="input-mode"
                value={m}
                checked={(m === 'batch') === batch}
                disabled={m === 'one' && jobs.length > 0}
                onChange={() => session.setMode(m)}
              />
              {m === 'one' ? 'One file' : 'Batch'}
            </label>
          ))}
        </div>
        {!batch &&
          (input ? (
            <div className="input-card">
              <IconFile />
              <div className="path" title={input}>
                <span className="fname">{baseName(input)}</span>
                <span className="dir">{dirName(input)}</span>
              </div>
              <button className="secondary" onClick={onPickInput}>
                Change…
              </button>
            </div>
          ) : (
            <div className="drop-zone">
              <IconUpload />
              <div className="drop-text">
                <span className="drop-title">Drop a spectra file here</span>
                <span>mzML, mzPeak, MGF, Thermo .raw or timsTOF .d.zip (drop a .d folder)</span>
              </div>
              <button type="button" onClick={onPickInput}>
                Choose file…
              </button>
            </div>
          ))}
      </div>
      {tried && missing.includes('in') && (
        <p className="warn">
          <IconError />
          <span>{batch ? 'Add the spectra files of the batch.' : `Required for ${taskLabel}: choose a spectra file.`}</span>
        </p>
      )}
      {/* One file: why a picked file was not taken (a .zip that is no .d.zip). */}
      {!batch && folderNote}
      {batch ? (
        <div className="batch-input">
          {jobs.length > 0 ? (
            <div className="input-card">
              <IconFile />
              <span className="grow">
                {jobs.length} {jobs.length === 1 ? 'file' : 'files'} in the batch; each runs with these settings. To use one file, clear the
                batch.
              </span>
              <button type="button" className="secondary small" onClick={onOpenBatch}>
                Open the batch
              </button>
            </div>
          ) : null}
          <div className={jobs.length > 0 ? 'row tight' : 'drop-zone'}>
            {jobs.length === 0 && (
              <>
                <IconUpload />
                <div className="drop-text">
                  <span className="drop-title">Drop spectra files here</span>
                  <span>mzML, mzPeak, MGF, .raw or timsTOF .d; each runs in turn with these settings</span>
                </div>
              </>
            )}
            <button type="button" ref={addBatchRef} className="secondary" onClick={run.addBatchFiles}>
              Add files…
            </button>
            {onAddFolder && (
              <button type="button" className="secondary" onClick={onAddFolder}>
                Add folder…
              </button>
            )}
          </div>
          {folderNote}
          <div className="out-row">
            <span className="sublabel">Output folder</span>
            <span className={run.outDir ? 'mono grow' : 'muted grow'}>{run.outDir ?? 'beside each input file'}</span>
            <button type="button" className="secondary small" aria-label="Change the output folder" onClick={() => void run.chooseOutDir()}>
              Change…
            </button>
            {run.outDir && (
              <button type="button" className="link small" onClick={() => run.setOutDir(null)}>
                Beside inputs
              </button>
            )}
          </div>
          {sdrf && (
            <div className="out-row sdrf-row" title="The Batch view compares each file's results with the sample metadata of the SDRF.">
              <span className="sublabel">SDRF file (optional)</span>
              <span className={sdrf.file ? 'mono' : 'muted'}>{sdrf.file ? baseName(sdrf.file.path) : 'none'}</span>
              <button type="button" className="secondary small" onClick={() => void sdrf.pick()} disabled={sdrf.loading}>
                {sdrf.file ? 'Replace…' : 'Choose…'}
              </button>
              {sdrf.file && (
                <button type="button" className="link small" onClick={sdrf.clear}>
                  Remove
                </button>
              )}
            </div>
          )}
          {sdrf?.error && <p className="warn">{sdrf.error}</p>}
        </div>
      ) : (
        <>
          {input && inspector}
          {sdrf?.file && <p className="hint">SDRF {baseName(sdrf.file.path)}: used only in Batch mode.</p>}
        </>
      )}
    </div>
  )

  const ionTrap = (instrument?.id === 'iontrap-cid' || detectedInstrument === 'iontrap-cid') && (owner?.id === 'species' || owner?.id === 'characterize')
  const aboutBlock = (
    <section className="about-spectra" aria-labelledby="about-spectra-h">
      <h3 id="about-spectra-h">About these spectra</h3>
      <div className="about-fields">
        <div className="field instrument-field">
          <span className="label-row">
            <label htmlFor="instrument">
              <span className="pname">Instrument</span>
            </label>
            <HelpPopover
              name="fragment_tolerance"
              label="Instrument"
              description="A preset sets four options at once: the fragment tolerance, its unit, the ion series the MS/MS spectra are read as, and how hybrid (EThcD) spectra are read. Orbitrap and TOF HCD: 20 ppm, b/y ions. Orbitrap ETD: 20 ppm, c/z ions for electron-activated spectra (ion series auto). Orbitrap EThcD: as ETD, and hybrid spectra read as both b/y and c/z. Ion trap CID: 0.5 Da. timsTOF: 30 ppm. Astral: 20 ppm. Custom shows the tolerance and its unit."
              deflt=""
              more="The tolerance is the largest m/z error accepted between a fragment peak and a residue mass step. Too tight loses tags; too loose admits wrong ones. Species calls are unreliable at Da tolerances. Ion-trap MS2 spectra the file marks as such are tagged at the ion-trap tolerance (0.5 Da, Advanced › Fragment tolerance by analyzer), whatever the preset; the reports use this tolerance."
              flags={['fragment_tolerance', 'fragment_tolerance_unit', 'ion_series', 'ion_series_hybrid'].map((n) => ({
                name: n,
                deflt: PARAM_BY_NAME.get(n) ? defaultText(PARAM_BY_NAME.get(n)!) : ''
              }))}
            />
          </span>
          <select
            id="instrument"
            value={custom ? 'custom' : instrument.id}
            onChange={(e) => session.chooseInstrument(e.target.value)}
            aria-describedby="instrument-h"
          >
            {INSTRUMENTS.map((x) => (
              <option key={x.id} value={x.id}>
                {presetText(x)}
                {detectedInstrument === x.id ? ' (detected)' : ''}
              </option>
            ))}
            <option value="custom">Custom</option>
          </select>
          <div className="brief-row">
            <p id="instrument-h" className="help brief">
              {input && !batch && !detectedInstrument ? 'Not detected from the file.' : ''}
              {instrument && !instrument.validated && !custom ? ` ${instrument.label} is not validated against the paper's benchmark.` : ''}
            </p>
            {notCheckedNote && input && !batch && <NotCheckedHelp text={notCheckedNote} />}
          </div>
          {custom && (
            <div className="custom-tol">
              {field('fragment_tolerance', {
                brief: 'The tolerance and its unit, for a custom analyzer.'
              })}
            </div>
          )}
          {ionTrap && (
            <p className="warn" role="note">
              <IconError />
              <span>Species calls are unreliable on ion-trap spectra at Da tolerances: treat them as a hint.</span>
            </p>
          )}
        </div>
        {field('fixed_modifications', {
          brief: 'Remove if the sample was not alkylated.'
        })}
        {aboutParams(owner)
          .filter((n) => !waitsOnShownFile(n))
          .map((n) =>
            field(n, {
              // Shipped proteome: which one fits, from a species report of this file.
              brief: n === 'recon_proteome' ? proteomeHint(!batch && run.speciesRun?.input === input ? run.species : null, String(values['recon_proteome'] ?? '')) : task.help[n]
            })
          )}
      </div>
    </section>
  )

  const inputsStep = body(
    2,
    <>
      {session.carried && (
        <p className="hint carried" role="status">
          {session.carried}{' '}
          {session.canUndo && (
            <button type="button" className="link small" onClick={session.undo}>
              Undo
            </button>
          )}
        </p>
      )}
      {spectraBlock}
      {(ti.required.length > 0 || ti.shown.length > 0 || ti.addable.length > 0) && (
        <section className="task-inputs" aria-label="Files of the task">
          {ti.required.map(requiredInput)}
          {ti.shown.map(optionalInput)}
          {ti.addable.length > 0 && (
            <label className="add-input">
              <span className="sublabel">Add optional input</span>
              <select
                className="small"
                value=""
                aria-label="Add optional input"
                onChange={(e) => {
                  const n = e.target.value
                  if (!n) return
                  session.revealInput(n)
                  setTimeout(() => document.getElementById(`p-${n}`)?.focus())
                }}
              >
                <option value="">Choose…</option>
                {ti.addable.map((n) => (
                  <option key={n} value={n} title={INPUTS[n]?.why}>
                    {inputLabel(n, owner)}: {INPUTS[n]?.why ?? task.help[n] ?? ''}
                  </option>
                ))}
              </select>
            </label>
          )}
        </section>
      )}
      {ti.extraneous.length > 0 && (
        <section className="also-set" aria-labelledby="also-set-h">
          <h3 id="also-set-h">Also set</h3>
          <ul>
            {ti.extraneous.map((x) => (
              <li key={x.name}>
                <strong>{inputLabel(x.name)}</strong> <span className="mono">{baseName(String(values[x.name] ?? ''))}</span>
                <span className="muted"> {x.why}</span>{' '}
                <button type="button" className="link small" aria-label={`Remove ${inputLabel(x.name)}`} onClick={() => session.removeInput(x.name)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {aboutBlock}
    </>
  )

  const settingsStep = body(
    3,
    <>
      <OriginRow session={session} />
      {session.presetError && (
        <p className="warn" role="alert">
          {session.presetError}
        </p>
      )}
      <div className="settings">
        {task.basic.filter((n) => !waitsOnShownFile(n)).map((n) => field(n, { brief: ruleBrief(task.help[n]) }))}
        {task.settingsNote && (
          <p className="hint settings-note" role="note">
            {task.settingsNote}
          </p>
        )}
      </div>
      <details className="block advanced" data-card="advanced" {...advD.details}>
        <summary className="disclosure card-head" {...advD.summary}>
          <span className={`chev big ${session.advancedOpen ? 'open' : ''}`} aria-hidden="true">
            <IconChevron size={14} />
          </span>
          <h3>Advanced ({advChanged} changed)</h3>
        </summary>
        <div className="adv-body">
          {ownGroups.map((s) => renderGroup(s, true))}
          <h3 className="adv-h">For every workflow</h3>
          {globalGroups.map((s) => renderGroup(s, false))}
          <details className={`sec other${otherOpen ? ' open' : ''}`} {...otherD.details}>
            <summary className="disclosure" {...otherD.summary}>
              <span className={`chev ${otherOpen ? 'open' : ''}`} aria-hidden="true">
                <IconChevron />
              </span>
              <span className="sec-title">Other analyses</span>{' '}
              {otherChanged > 0 ? <span className="chip accent">{otherChanged} changed</span> : <span className="defaults">add a report to this run</span>}
            </summary>
            <div className="sec-body">{otherGroups.map((s) => renderGroup(s, false))}</div>
          </details>
        </div>
      </details>
    </>
  )

  const idsSet = hasValue(values, 'census_ids')
  const outputsStep = body(
    4,
    <>
      {batch ? (
        <p className="hint">
          Each file's outputs are named after it, in {run.outDir ? <span className="mono">{run.outDir}</span> : 'the folder of each input file'}.{' '}
          <button type="button" className="link small" onClick={() => go(2)}>
            Change in Inputs
          </button>
        </p>
      ) : (
        <div className="out-rows">
          <div className="out-row">
            <span className="sublabel">Output folder</span>
            <span className={session.outDir ? 'mono grow' : 'muted grow'} title={session.outDir}>
              {session.outDir || 'beside the input file'}
            </span>
            <button
              type="button"
              className="secondary small"
              disabled={!out}
              aria-label="Change the output folder"
              onClick={async () => {
                const dir = await window.fastag.pickFolder()
                if (dir) session.moveOut(`${dir.replace(/[\\/]$/, '')}/${session.runName}.tags.tsv`)
              }}
            >
              Change…
            </button>
          </div>
          <div className="out-row">
            <label htmlFor="out-name" className="sublabel">
              Run name
            </label>
            <input
              id="out-name"
              className="path-input grow"
              value={session.runName}
              disabled={!input}
              placeholder="set from the input file"
              aria-invalid={!!input && !out}
              aria-describedby={input && !out ? 'out-help' : undefined}
              title="Each file of the run is named after the run, in the output folder"
              onChange={(e) => {
                const v = e.target.value.replace(/[\\/]/g, '')
                session.moveOut(v ? `${session.outDir || dirName(input)}${v}.tags.tsv` : '')
              }}
            />
          </div>
          {input && !out && (
            <p id="out-help" className="warn">
              Choose a run name before running.
            </p>
          )}
        </div>
      )}
      {missingDatabase(values) &&
        (owner?.dbOptional ? (
          <p className="hint" role="note">
            No protein database: only the tags table is written. The shift reports need your FASTA or a shipped proteome:{' '}
            <button type="button" className="link small" onClick={() => go(2)}>
              choose one in Inputs
            </button>
            .
          </p>
        ) : (
          <p className="hint">
            Some of these need the protein database:{' '}
            <button type="button" className="link small" onClick={() => go(2)}>
              choose it in Inputs
            </button>
            .
          </p>
        ))}
      <ul className="products" aria-label="Products">
        {task.outputs.map(productRow)}
      </ul>
      {step === 4 && <CommandPreview session={session} run={run} batch={batch} />}
      {!batch && (
        <div className="row tight add-batch">
          <button
            type="button"
            className="secondary small"
            disabled={!input || idsSet}
            title={idsSet ? 'Not used in Batch mode: one ID file cannot belong to every input. Remove Identifications in Inputs first.' : 'Queue this file and add more, with the same settings'}
            onClick={() => {
              run.addBatchPaths([input])
              session.setMode('batch')
            }}
          >
            Add to batch
          </button>
          {idsSet && <span className="hint">Not used in Batch mode: one ID file cannot belong to every input.</span>}
        </div>
      )}
    </>
  )

  const tile = taskById(session.tile)
  const stillMissing = missing.length > 0 ? <span className="still-missing">Still missing: {missingText(missing)}</span> : undefined
  // The page header: the step's title (focused on a step change), one line
  // of context, and the page's actions: Presets and Open earlier results…
  // on every step (Continue last run on step 1).
  const title = step === 1 ? 'What do you want to do?' : step === 2 ? `Inputs for ${taskLabel}` : step === 3 ? `Settings for ${taskLabel}` : 'Outputs and run'
  const context =
    step === 1 ? (
      'FASTag reads sequence tags from MS/MS spectra. It is not a search engine.'
    ) : step === 2 ? (
      <span className="lead">
        Needs {youNeed(owner)}.
        {ti.required
          .filter((n) => !(owner?.required ?? []).includes(n))
          .map((n) => (
            <span key={n}> Also required for {requiredBy(owner, values, n)}: a protein FASTA.</span>
          ))}
      </span>
    ) : step === 3 ? (
      'The main settings of the task; every other option is under Advanced.'
    ) : (
      'Where the outputs go and which files the run writes.'
    )
  const header = (
    <PageHeader
      title={title}
      titleId={`step-h-${step}`}
      focusable
      context={context}
      contextId={step === 1 ? 'not-search-engine' : undefined}
      actions={
        step === 1 ? (
          <StartRow session={session} onOpenResults={onOpenResults} />
        ) : (
          <div className="row tight start-row">
            <PresetMenu session={session} withSave={step === 3} />
            <button type="button" onClick={onOpenResults}>
              Open earlier results…
            </button>
          </div>
        )
      }
      nav={stepper}
    />
  )
  // The action bar: step 1 confirms the task; steps 2-4 are the run bar
  // with Back and Next (App.tsx).
  const bar = busy ? (
    (actionBar?.() ?? null)
  ) : step === 1 ? (
    <div className="actionbar">
      <div className="actionbar-col page-col">
        <div className="actionbar-row">
          <div className="actionbar-lead">
            <span className="actionbar-status">
              <b>{tile?.label ?? 'FASTag'}</b>
              {tile ? ` · ${tile.time === 'short' ? 'Short' : 'Longer'}: ${tile.timeNote}` : ''}
            </span>
          </div>
          <div className="actionbar-nav">
            <button type="button" className="primary continue" onClick={() => confirm(session.tile)}>
              Continue with {tile?.label ?? 'this task'} ›
            </button>
          </div>
        </div>
      </div>
    </div>
  ) : (
    (actionBar?.({
      status: stillMissing,
      back: () => go((step - 1) as Step),
      next:
        step < 4
          ? {
              label: `Next: ${STEPS[step].name} ›`,
              onClick: () => go((step + 1) as Step)
            }
          : undefined
    }) ?? null)
  )

  // Alt+arrows reach the handler from the action bar too (Back, Next).
  return (
    <div className="setup-view" onKeyDown={busy ? undefined : onKey}>
      <div
        className="controls-body"
        onBlur={(e) => {
          if (e.target.id === 'p-alkylation_proteome') setProteome(values['alkylation_proteome'])
        }}
      >
        {busy ? (
          <div className="setup-busy page-col">
            <PageHeader title="Setup" context="FASTag is running: the form shows what the run uses." />
            {/* The form is not editable mid-run: a changed value would not
              be what the run is using. */}
            <p className="locked">
              <IconLock />
              <span>Input, output and parameters are locked while FASTag runs.</span>
            </p>
            <section className="block">
              <h2>Input</h2>
              {jobs.length > 0 ? (
                <p>
                  A batch of {jobs.length} {jobs.length === 1 ? 'file' : 'files'}: each runs with the parameters below.
                </p>
              ) : (
                <div className="path" title={input}>
                  <span className="fname">{baseName(input)}</span>
                  <span className="dir">{dirName(input)}</span>
                </div>
              )}
            </section>
            {jobs.length === 0 && (
              <section className="block">
                <h2>Writing</h2>
                {writingFiles.map((f) => (
                  <code key={f}>{f}</code>
                ))}
              </section>
            )}
            <section className="block">
              <h2>Changed from defaults</h2>
              {changedParams.length ? (
                changedParams.map((c) => <code key={c}>{c}</code>)
              ) : (
                <span className="muted">nothing: all parameters at their defaults</span>
              )}
            </section>
          </div>
        ) : (
          <div className="wizard page-col">
            {header}
            <p className="sr-only" role="status">
              {said}
            </p>
            {/* The menu's Reveal output refused: say so, not swallow it. */}
            {revealErr && (
              <p className="warn" role="alert">
                <IconError />
                <span>{revealErr}</span>
              </p>
            )}
            {body(1, <TaskStep session={session} onContinue={confirm} />)}
            {inputsStep}
            {settingsStep}
            {outputsStep}
            {(UNPLACED.length > 0 || UNKNOWN.length > 0) && (
              <p className="warn">
                {UNPLACED.length > 0 && (
                  <>
                    {UNPLACED.length} {UNPLACED.length === 1 ? 'parameter of FASTag is' : 'parameters of FASTag are'} missing from the form:{' '}
                    {UNPLACED.join(', ')}.{' '}
                  </>
                )}
                {UNKNOWN.length > 0 && (
                  <>
                    {UNKNOWN.length} {UNKNOWN.length === 1 ? 'form entry names' : 'form entries name'} no such parameter: {UNKNOWN.join(', ')}.
                  </>
                )}
              </p>
            )}
          </div>
        )}
      </div>
      {bar}
    </div>
  )
}

/// Step 4's command preview: the command line Run would start, as text,
/// refreshed (debounced) while the form changes, behind a disclosure (Copy
/// command line and Export INI… are in the action bar).
function CommandPreview({ session, run, batch }: { session: Session; run: RunState; batch: boolean }): JSX.Element | null {
  const [line, setLine] = useState<string | null>(null)
  const { values, input, out } = session
  const paramsFor = useRef(run.paramsFor)
  paramsFor.current = run.paramsFor
  // A batch shows the command line of its first file (shell-2): each file
  // runs it with its own input and outputs (useRun runBatch).
  const first = batch ? run.jobs[0] : undefined
  useEffect(() => {
    if (batch ? !first : !input) {
      setLine(null)
      return
    }
    let gone = false
    const t = setTimeout(() => {
      const call = paramsFor.current()
      let sent = call
      if (first) {
        const per = perJobOutputs(values, first.out)
        const params: Record<string, unknown> = { ...((call['params'] ?? {}) as Record<string, unknown>) }
        for (const k of Object.keys(params)) if (k in per) {
          if (String(per[k] ?? '') === '') delete params[k]
          else params[k] = per[k]
        }
        sent = { ...call, in: first.input, out: first.out, params }
      }
      window.fastag
        .commandLine(sent)
        .then((argv) => !gone && setLine(shellLine(argv)))
        .catch(() => !gone && setLine(null))
    }, 250)
    return () => {
      gone = true
      clearTimeout(t)
    }
  }, [values, input, out, batch, first?.input, first?.out])
  if (batch && !first) return <p className="hint">Each file of the batch runs the same settings with its own input and outputs; add files in Inputs to see the command line.</p>
  if (!batch && !input) return null
  return (
    <>
      {batch && <p className="hint">Each file of the batch runs this command line with its own input and outputs; the Batch view logs each one.</p>}
      <details className="command-preview">
        <summary>
          <span className="chev" aria-hidden="true">
            <IconChevron />
          </span>
          {first ? `Command line of the first file, ${baseName(first.input)}` : 'Command line'}
        </summary>
        <pre className="mono cmd" tabIndex={0} aria-label="The command line Run starts">
          {line ?? '…'}
        </pre>
      </details>
    </>
  )
}
