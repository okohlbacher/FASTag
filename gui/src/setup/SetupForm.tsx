// The Setup screen (doc/GUI-WORKFLOWS.md section 3): five numbered cards that
// read top to bottom, Input -> Workflow -> Settings -> Outputs -> Advanced,
// then the run bar. A workflow shows only the fields a typical user changes
// for its question; every other option is under Advanced, in its group.
// While a run is in flight, a locked summary of what it uses.

import { useState, type JSX, type RefObject } from 'react'
import { SECTIONS, PARAM_BY_NAME, type Dependency, type Section, UNIT_PARAMS, defaultText, dependsOf, forcedValue, humanName, inertDependency, masters, recipeNote, unknownParams, unitOf, unplacedParams } from '../paramLayout'
import ParamField from '../ParamField'
import { disclosure } from '../disclosure'
import { baseName } from '../digestReport'
import { IconChevron, IconError, IconFile, IconLock, JobIcon } from '../icons'
import { HelpButton, HelpLink } from '../help/HelpLink'
import HelpPopover from '../help/HelpPopover'
import { isMac, keyText } from './shortcuts'
import type { Session } from './useSession'
import type { RunState } from '../run/useRun'
import type { SdrfState } from '../sdrf/useSdrf'
import { Leftovers } from '../Leftovers'
import { dirName, revealLabel } from '../app/paths'
import { clock, duration } from '../app/format'
import TaskChooser, { PresetRow } from './TaskChooser'
import { LANDING_TASK, taskById, type Task } from './tasks'
import { INSTRUMENTS, presetText, shownInstrument } from './presets'
import { PRODUCT_OF, PRODUCTS, USI_PLACEHOLDER, fileName, isOn, missingDatabase, neededBy, productLabel, setProduct, type Product } from './products'

// A parameter that exists in the CLI but nowhere in the layout would silently
// be unreachable; surface it instead of hiding it.
const UNPLACED = unplacedParams()
const UNKNOWN = unknownParams()

/// The count of spectra to read: one control with the share
/// (subsample_fraction's "Custom count…"), never a field of its own.
const countSpec = PARAM_BY_NAME.get('subsample_spectra')
export const FOLDED: ReadonlySet<string> = new Set(['subsample_spectra'])

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
export function advancedParams(task: Task): string[] {
  const shown = new Set([...task.basic, ...task.outputs, ...SECTIONS.filter((s) => s.home === 'common').flatMap((s) => s.params)])
  return SECTIONS.flatMap((s) => s.params).filter((n) => !shown.has(n) && !WIRED.has(n) && !UNIT_PARAMS.has(n) && !FOLDED.has(n))
}

export interface SetupFormProps {
  session: Session
  run: RunState
  onPickInput(): void
  onSearch(): void
  searchBtnRef: RefObject<HTMLButtonElement | null>
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
}

export default function SetupForm({
  session,
  run,
  onPickInput,
  onSearch,
  searchBtnRef,
  onOpenBatch,
  onAddFolder,
  folderNote,
  addBatchRef,
  onOpenResults,
  inspector,
  sdrf,
  detectedInstrument
}: SetupFormProps): JSX.Element {
  const { input, out, values, setValue, openGroups, setOpenGroups, writingFiles, changedParams } = session
  const { busy, jobs, lastRun, evidence, revealErr, reveal } = run
  const task = taskById(session.task ?? LANDING_TASK)!
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
        key={name}
        spec={spec}
        value={forced ? forced.value : values[name]}
        needs={inertDependency(name, values)}
        onChange={(v) => setValue(name, v)}
        onPickFile={session.pickFor}
        brief={recipeNote(name, values) ?? opts.brief}
        required={opts.required}
        blocked={batchBlocked(name) ?? forced?.note}
        unit={unitSpec && unitName ? { spec: unitSpec, value: values[unitName], onChange: (v) => setValue(unitName, v) } : undefined}
        count={name === 'subsample_fraction' && countSpec ? { spec: countSpec, value: values['subsample_spectra'], onChange: (v) => setValue('subsample_spectra', v) } : undefined}
      />
    )
  }

  const toggle = (p: Product, on: boolean): void => session.setValues((v) => setProduct(p, on, v, out))

  // One product row: checkbox, label, the file it writes, and why it is
  // locked or what it still needs.
  const productRow = (param: string): JSX.Element | null => {
    const p = PRODUCT_OF.get(param)
    if (!p) return null
    const on = isOn(p, values) || (p.param === 'usi_collection' && usiEditing)
    const needed = neededBy(p, values)
    const follows = p.follows ? PRODUCT_OF.get(p.follows) : undefined
    const locked = p.param === 'out' || (on && needed.length > 0) || !!follows
    const name = fileName(p, values, out)
    // A report driven by a switch (species, glyco, census) is that switch's
    // control, so it carries the switch's field id.
    const id = p.flag && !p.follows ? `p-${p.flag}` : `out-${p.param}`
    const why =
      p.param === 'out'
        ? 'always written'
        : on && needed.length > 0
          ? `needed by ${needed.join(', ')}`
          : follows
            ? `written with the ${follows.label.toLowerCase()}`
            : !on
              ? (task.productNotes?.[p.param] ?? null)
              : null
    const spec = PARAM_BY_NAME.get(p.param)
    return (
      <li key={p.param} className={`product${on ? ' on' : ''}${locked ? ' fixed' : ''}`}>
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
        <label htmlFor={id} title={p.what}>
          {p.label}
        </label>
        {p.experimental && <span className="badge">experimental</span>}
        {name && <span className="product-file mono">→ {name}</span>}
        <span id={`${id}-d`} className="product-note">
          {why}
        </span>
        {on && !!out && !p.column && p.param !== 'out' && spec?.type === 'output-file' && (
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
  const ADV = new Set(advancedParams(task))
  const renderGroup = (sec: Section, defaultOpen: boolean): JSX.Element | null => {
    const names = sec.params.filter((n) => ADV.has(n))
    if (names.length === 0) return null
    const open = openGroups[sec.title] ?? defaultOpen
    const changed = names.filter((n) => session.diff.includes(n)).length
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
      const d = inertDependency(n, values)
      if (!d || d.replaced || session.diff.includes(n)) continue
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
      const m = cands.find((x) => task.outputs.includes(productOf(x)!.param)) ?? cands[0]
      return { w, what, prod: m ? productOf(m) : undefined }
    })
    const targets = [...new Map(parts.flatMap((x) => (x.prod ? [[x.prod.param, x.prod] as [string, Product]] : []))).values()]
    const waitingNames = sets.flatMap((w) => w.names)
    const needs =
      parts.length === 0 ? null : (
        <div className="group-needs" role="note">
          <span>
            {parts.length === 1
              ? `${waitingNames.length === 1 ? 'One more setting needs' : `${waitingNames.length} more settings need`} ${parts[0].what}.`
              : `${waitingNames.length} more settings need: ${parts.map((x) => x.what).join('; ')}.`}
          </span>
          <HelpPopover
            name={waitingNames[0]}
            label={`the settings of ${sec.title} not used yet`}
            description={parts
              .map((x) => `${x.w.names.map(humanName).join(', ')}: not used yet (${x.w.dep.note}); ${x.w.names.length === 1 ? 'it shows' : 'they show'} once ${x.what} is on.`)
              .join(' ')}
            deflt=""
          />
          {targets.map((prod) => (
            <button type="button" key={prod.param} className="secondary small" onClick={() => toggle(prod, true)}>
              Turn on {prod.label}
            </button>
          ))}
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

  const ownGroups = SECTIONS.filter((s) => s.home === task.id)
  const globalGroups = SECTIONS.filter((s) => s.home === 'global')
  const otherGroups = SECTIONS.filter((s) => s.home !== task.id && s.home !== 'global' && s.home !== 'common')
  const advChanged = session.diff.filter((n) => ADV.has(n)).length
  const advD = disclosure(session.advancedOpen, session.setAdvancedOpen)
  const otherOpen = openGroups['Other analyses'] ?? false
  const otherD = disclosure(otherOpen, (o) => setOpenGroups((st) => ({ ...st, 'Other analyses': o })))
  const otherChanged = otherGroups.flatMap((s) => s.params).filter((n) => ADV.has(n) && session.diff.includes(n)).length

  const instrument = shownInstrument(values, session.instrument)
  const custom = session.instrument === 'custom' || !instrument

  const card = (n: number, id: string, title: string, body: JSX.Element, extra?: JSX.Element): JSX.Element => (
    <section className="block step-card" role="region" aria-label={`${n} ${title}`} id={`card-${id}`}>
      <div className="card-head">
        <span className="card-n" aria-hidden="true">
          {n}
        </span>
        <h2>{title}</h2>
        {extra}
      </div>
      {body}
    </section>
  )

  const isInputField = (n: string): boolean => !!task.required?.includes(n) || PARAM_BY_NAME.get(n)?.type === 'input-file'
  // A setting of an optional file that Settings itself shows (Triage's ID
  // q-value and E-value, waiting for Identifications): hidden until the file
  // is chosen, not a disabled field with a note (round 4, 18).
  const waitsOnShownFile = (n: string): boolean => {
    const d = inertDependency(n, values)
    return !!d && !d.replaced && masters(d).some((m) => task.basic.includes(m) && PARAM_BY_NAME.get(m)?.type === 'input-file')
  }

  const inputCard = card(
    1,
    'input',
    'Input',
    <>
      <div className={batch ? 'input-row batch' : 'input-row'}>
      <div className="seg" role="radiogroup" aria-label="Input mode">
        {(['one', 'batch'] as const).map((m) => (
          <label key={m} className={`seg-opt${(m === 'batch') === batch ? ' on' : ''}`}>
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
          <div className="input-card empty-input">
            <IconFile />
            <span className="muted">Spectra as mzML, mzPeak or MGF</span>
            <button onClick={onPickInput}>Choose file…</button>
          </div>
        ))}
      </div>
      {batch ? (
        <div className="batch-input">
          {jobs.length > 0 ? (
            <div className="input-card">
              <IconFile />
              <span className="grow">
                {jobs.length} {jobs.length === 1 ? 'file' : 'files'} in the batch; each runs with these settings.
              </span>
              <button type="button" className="secondary small" onClick={onOpenBatch}>
                Open the batch
              </button>
            </div>
          ) : (
            <div className="input-card empty-input">
              <IconFile />
              <span className="muted">Spectra files as mzML, mzPeak or MGF, run in turn</span>
            </div>
          )}
          <div className="row tight">
            <button type="button" ref={addBatchRef} className={jobs.length ? 'secondary' : undefined} onClick={run.addBatchFiles}>
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
            <div className="out-row sdrf-row">
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
          {sdrf && <p className="hint">The Batch view compares each file's results with the sample metadata of the SDRF.</p>}
          {sdrf?.error && <p className="warn">{sdrf.error}</p>}
        </div>
      ) : (
        input && inspector
      )}
    </>,
    <>
      {!batch && (
        <button type="button" className="link small" onClick={onOpenResults}>
          Open earlier results…
        </button>
      )}
      <HelpButton to="files-inputs" what="input files" />
    </>
  )

  const workflowCard = card(2, 'workflow', 'Workflow', <TaskChooser session={session} rowInHead />, <PresetRow session={session} />)

  const settingsCard = card(
    3,
    'settings',
    'Settings',
    <div className="settings">
      {task.basic.filter(isInputField).map((n) => field(n, { brief: task.help[n], required: task.required?.includes(n) }))}
      <div className="field instrument-field">
        <span className="label-row">
          <label htmlFor="instrument">
            <span className="pname">Instrument</span>
          </label>
          <HelpPopover
            name="fragment_tolerance"
            label="Instrument"
            description="A preset sets four options at once: the fragment tolerance, its unit, the ion series the MS/MS spectra are read as, and how hybrid (EThcD) spectra are read. Orbitrap and TOF HCD: 20 ppm, b/y ions. Orbitrap ETD: 20 ppm, c/z ions for electron-activated spectra (ion series auto). Orbitrap EThcD: as ETD, and hybrid spectra read as both b/y and c/z. Ion trap CID: 0.3 Da. timsTOF: 30 ppm. Astral: 20 ppm. Custom shows the tolerance and its unit."
            deflt=""
            more="The tolerance is the largest m/z error accepted between a fragment peak and a residue mass step. Too tight loses tags; too loose admits wrong ones. Species calls are unreliable at Da tolerances."
            flags={['fragment_tolerance', 'fragment_tolerance_unit', 'ion_series', 'ion_series_hybrid'].map((n) => ({ name: n, deflt: PARAM_BY_NAME.get(n) ? defaultText(PARAM_BY_NAME.get(n)!) : '' }))}
          />
        </span>
        <select id="instrument" value={custom ? 'custom' : instrument.id} onChange={(e) => session.chooseInstrument(e.target.value)} aria-describedby="instrument-h">
          {INSTRUMENTS.map((x) => (
            <option key={x.id} value={x.id}>
              {presetText(x)}
              {detectedInstrument === x.id ? ' (detected)' : ''}
            </option>
          ))}
          <option value="custom">Custom</option>
        </select>
        <p id="instrument-h" className="help brief">
          Sets the fragment tolerance and ion series.
          {instrument && !instrument.validated && !custom ? ` ${instrument.label} is not validated against the paper's benchmark.` : ''}
        </p>
        {custom && <div className="custom-tol">{field('fragment_tolerance', { brief: 'The tolerance and its unit, for a custom analyzer.' })}</div>}
      </div>
      {field('fixed_modifications', {
        brief: 'Drop Carbamidomethyl (C) without alkylation.'
      })}
      {task.basic.filter((n) => !isInputField(n) && !waitsOnShownFile(n)).map((n) => field(n, { brief: task.help[n] }))}
    </div>,
    <button
      type="button"
      className="secondary small"
      ref={searchBtnRef}
      aria-keyshortcuts={isMac() ? 'Meta+K /' : 'Control+K /'}
      title={`Search all settings (${keyText('K')} or /)`}
      onClick={onSearch}
    >
      Search settings… <kbd>{keyText('K')}</kbd>
    </button>
  )

  const outputsCard = card(
    4,
    'outputs',
    'Outputs',
    <>
      {batch ? (
        <p className="hint">Each file's outputs are named after it, in the output folder of the Input card.</p>
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
      {missingDatabase(values) && <p className="hint">Some of these need the protein database: choose it in Settings.</p>}
      <ul className="products" aria-label="Products">
        {task.outputs.map(productRow)}
      </ul>
    </>,
    <HelpButton to="files-outputs" what="output files" />
  )

  const advancedCard = (
    <details className="block step-card advanced" data-card="advanced" {...advD.details}>
      <summary className="disclosure card-head" {...advD.summary}>
        <span className="card-n" aria-hidden="true">
          5
        </span>
        {/* The chevron before the title, as in the groups inside. */}
        <span className={`chev big ${session.advancedOpen ? 'open' : ''}`} aria-hidden="true">
          <IconChevron size={14} />
        </span>
        <h2>Advanced ({advChanged} changed)</h2>
      </summary>
      <div className="adv-body">
        <p className="hint">
          Every other option of FASTag, by topic; the groups of {task.label} first. <HelpLink to={task.docs.to}>Learn more</HelpLink>
        </p>
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
  )

  return (
    <div className="controls-body">
      {busy ? (
        <>
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
            {changedParams.length ? changedParams.map((c) => <code key={c}>{c}</code>) : <span className="muted">nothing: all parameters at their defaults</span>}
          </section>
        </>
      ) : (
        <>
          <Leftovers />
          {lastRun && jobs.length === 0 && (
            <section className="block last-run" aria-labelledby="last-run-h">
              <h2 id="last-run-h">Last run</h2>
              <div className={`last-run-name ${lastRun.ok ? 'ok' : lastRun.cancelled ? 'cancelled' : 'bad'}`}>
                <JobIcon status={lastRun.ok ? 'done' : lastRun.cancelled ? 'cancelled' : 'failed'} />
                <span>{baseName(lastRun.input)}</span>
              </div>
              <div className="muted">
                {lastRun.ok ? 'Finished' : lastRun.cancelled ? 'Cancelled' : 'Failed'}{' '}
                {lastRun.earlier ? `in an earlier session, ${new Date(lastRun.at).toLocaleString()}` : clock(lastRun.at)} · {duration(lastRun.ms)}
                {lastRun.cleaned > 0 && ' · partial outputs removed'}
                {lastRun.ok && evidence.ms2 != null && ` · ${evidence.ms2.toLocaleString('en-US')} MS2 spectra`}
              </div>
              {/* The form may be edited since: what this run was given. */}
              {lastRun.changed && <code className="last-run-params">{lastRun.changed.length ? lastRun.changed.join(' ') : 'all defaults'}</code>}
              {lastRun.ok && lastRun.out && (
                <div className="row reveal">
                  <button type="button" className="secondary small" onClick={() => reveal(false)} title={lastRun.out}>
                    {revealLabel()}
                  </button>
                  <button type="button" className="secondary small" onClick={() => reveal(true)}>
                    Open folder
                  </button>
                </div>
              )}
              {revealErr && (
                <p className="warn" role="alert">
                  <IconError />
                  <span>{revealErr}</span>
                </p>
              )}
            </section>
          )}
          {inputCard}
          {workflowCard}
          {settingsCard}
          {outputsCard}
          {advancedCard}
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
        </>
      )}
    </div>
  )
}
