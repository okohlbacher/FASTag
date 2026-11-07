// The built-in tasks of the Setup screen (GUI-DESIGN 3 S1, D1): read-only
// presets a session starts from. Each is a diff over FASTag's own defaults;
// a user preset is a diff over one of them or over the defaults
// (presetDiff.ts). "Characterize a run" is where the app lands (D1).

import type { ParamValue } from '../ParamField'
import { initialValues } from './useSession'
import { rebaseOutputs } from '../app/paths'

export type TaskId = 'characterize' | 'batch-qc' | 'export-tags' | 'open-results'

export interface Task {
  id: TaskId
  label: string
  /// One line under the chooser: what the task runs.
  blurb: string
  /// False for "Open results": no run, the cards collapse to Open….
  runs: boolean
  /// Batch QC: the input is a queue of files; Setup's input card offers
  /// "Add files for a batch…" first (SetupForm).
  batch: boolean
  /// What the task changes from FASTag's defaults. A report is switched on
  /// by its output name (digest.tsv), which goes beside the tags output once
  /// there is one (rebaseOutputs).
  values: Record<string, ParamValue>
}

// Species with extension 2 is the paper-validated setting (Q1): seed 3 plus
// 2 x 2 reaches the bundled index's k = 7.
const CHARACTERIZE: Record<string, ParamValue> = {
  species: true,
  extension: '2',
  digest_out: 'digest.tsv',
  label_out: 'label.tsv',
  glyco: true,
  subsample_fraction: '0.1'
}

export const TASKS: readonly Task[] = [
  {
    id: 'characterize',
    label: 'Characterize a run',
    blurb: 'Species (extension 2, paper-validated), digest, label and glyco reports on a tenth of the spectra.',
    runs: true,
    batch: false,
    values: CHARACTERIZE
  },
  {
    id: 'batch-qc',
    label: 'Batch QC vs SDRF',
    // Only the input differs from Characterize in P2a: Setup asks for the
    // files of a batch first. The output folder and the cross-run summary
    // are the Batch view's (GUI-DESIGN 10 P2b), the SDRF comparison P4's.
    blurb: 'The Characterize reports for every file of a batch, each beside its own input.',
    runs: true,
    batch: true,
    values: CHARACTERIZE
  },
  {
    id: 'export-tags',
    label: 'Export tags',
    // The best-tag-per-spectrum thinning is the Export menu's, with the
    // results browser rewrite (GUI-DESIGN S8, 10 P3); the run writes every tag.
    blurb: 'Every tag with a per-residue confidence column (res_conf), for de novo assembly and export.',
    runs: true,
    batch: false,
    values: { res_conf: true }
  },
  {
    id: 'open-results',
    label: 'Open results / inspect spectra',
    blurb: 'No run: open a tags table or a report FASTag wrote earlier.',
    runs: false,
    batch: false,
    values: {}
  }
]

export const LANDING_TASK: TaskId = 'characterize'

export const taskById = (id: string): Task | undefined => TASKS.find((t) => t.id === id)

/// What a preset is a diff over: FASTag's defaults or a built-in task.
export type PresetBase = 'defaults' | `builtin:${TaskId}`

/// Where the form's values came from (GUI-DESIGN 5 sessionStore.origin).
export type Origin =
  | { kind: 'defaults' }
  | { kind: 'builtin'; id: TaskId }
  | { kind: 'preset'; name: string; base: PresetBase }

export const DEFAULTS: Origin = { kind: 'defaults' }
export const LANDING: Origin = { kind: 'builtin', id: LANDING_TASK }

/// The base a preset saved from @p o is a diff over.
export function baseOf(o: Origin): PresetBase {
  if (o.kind === 'builtin') return `builtin:${o.id}`
  if (o.kind === 'preset') return o.base
  return 'defaults'
}

/// The values of @p base: the defaults, or a task's values over them.
export function baseValues(base: PresetBase): Record<string, ParamValue> {
  const task = base.startsWith('builtin:') ? taskById(base.slice('builtin:'.length)) : undefined
  return { ...initialValues(), ...(task?.values ?? {}) }
}

/// The task an origin belongs to (a preset: the task it was saved over).
export function taskOf(o: Origin): Task | undefined {
  const b = baseOf(o)
  return b.startsWith('builtin:') ? taskById(b.slice('builtin:'.length)) : undefined
}

/// "FASTag defaults", "Characterize a run", "preset Lab default".
export function originText(o: Origin): string {
  if (o.kind === 'builtin') return taskById(o.id)?.label ?? o.id
  if (o.kind === 'preset') return `preset ${o.name}`
  return 'FASTag defaults'
}

/// The values a session starting from @p base has, its reports beside
/// @p tagsOut when there is one.
export function startValues(base: PresetBase, tagsOut: string): Record<string, ParamValue> {
  const v = baseValues(base)
  return tagsOut ? { ...v, ...rebaseOutputs(v, tagsOut) } : v
}
