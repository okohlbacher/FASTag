// The workflows of the Setup screen (doc/GUI-WORKFLOWS.md section 1): named,
// read-only presets a session starts from. Each is a diff over FASTag's own
// defaults; a user preset is a diff over one of them or over the defaults
// (presetDiff.ts). "Export tags" is where the app lands.
//
// A workflow shows only the fields a typical user changes for its question
// (`basic`, Settings) and its products (`outputs`, the Outputs checklist).
// Every other option stays reachable under Advanced.

import type { ParamValue } from '../ParamField'
import { initialValues } from './useSession'
import { rebaseOutputs } from '../app/paths'

export type TaskId = 'export-tags' | 'run-qc' | 'mass-shift' | 'species' | 'db-reduction' | 'triage' | 'characterize'

export interface Task {
  id: TaskId
  label: string
  /// One line under the chooser: what the workflow answers.
  blurb: string
  /// The products, as the chooser card lists them: a word or two that fit
  /// beside the label (the outputs are listed in full under Outputs).
  products: string
  /// What the workflow changes from FASTag's defaults. A report is switched
  /// on by its output name (qc.tsv), which goes beside the tags output once
  /// there is one (rebaseOutputs).
  values: Record<string, ParamValue>
  /// The fields Settings shows, in order: the workflow's own inputs first.
  basic: string[]
  /// Inputs of `basic` the run cannot do without.
  required?: string[]
  /// One gray line under each basic field, for this workflow.
  help: Record<string, string>
  /// Its products in the Outputs checklist (setup/products.ts), in order.
  outputs: string[]
  /// A line beside a product of this workflow that is off by default: what
  /// it needs here.
  productNotes?: Record<string, string>
  /// Groups of Advanced with another home (paramLayout SECTIONS) that lead
  /// with the workflow's own, by title: the settings of a report it writes
  /// by default (Characterize: species).
  leadGroups?: string[]
  /// A caveat of the workflow's defaults, shown at the end of Settings.
  settingsNote?: string
  /// The Help section its "Learn more" link opens, and its name.
  docs: { to: string; label: string }
}

/// What every run workflow sets: threads 0 (FASTag uses half the logical
/// cores; the manifest lists 1).
const ALL: Record<string, ParamValue> = { threads: '0' }

export const TASKS: readonly Task[] = [
  {
    id: 'export-tags',
    label: 'Export tags',
    blurb: 'Sequence tags from every spectrum, with per-residue confidence, for de novo assembly and export.',
    products: 'tags table',
    // Extension 3 (round 11): a seed of 3 can grow to 9 residues, so the
    // assembly reads (8 residues and more by default) are not empty.
    values: { ...ALL, res_conf: true, extension: '3' },
    basic: ['tag_length', 'extension', 'max_evalue', 'max_tags', 'res_conf'],
    help: {
      tag_length: 'Residues in a seed tag; 3 suits most runs.',
      extension: 'For assembly; 3 lets a seed of 3 grow to 9.',
      max_evalue: 'Keeps tags at or below this E-value; 0 keeps all.',
      max_tags: 'Most tags per spectrum; 0 sets no limit.',
      res_conf: 'Adds a confidence per residue for assembly.'
    },
    outputs: ['out', 'proforma', 'usi_collection', 'out_spectra'],
    docs: { to: 'results-export', label: 'Assembly export' }
  },
  {
    id: 'run-qc',
    label: 'Run QC',
    blurb: 'QC of one run: MS/MS counts and resolution by analyzer, charges, isobaric kit, tag yield and instrument.',
    products: 'QC report',
    values: { ...ALL, qc_out: 'qc.tsv' },
    // The DIA check is a safety switch, not a QC setting: under Advanced.
    basic: ['subsample_fraction'],
    help: {
      subsample_fraction: 'The counts cover only the spectra read.'
    },
    outputs: ['out', 'qc_out'],
    docs: { to: 'workflow-run-qc', label: 'Run QC report' }
  },
  {
    id: 'mass-shift',
    label: 'Mass-shift survey',
    blurb: 'Blind modification search: mass shifts between tags and the database, with sites and UniMod names.',
    products: 'shift table',
    values: {
      ...ALL,
      recon_out: 'recon.tsv',
      delta_out: 'delta.tsv',
      delta_spectra_out: 'delta_spectra.tsv',
      delta_counts_out: 'delta_counts.tsv',
      extension: '3'
    },
    basic: ['recon_fasta', 'extension', 'recon_missed_cleavages'],
    required: ['recon_fasta'],
    help: {
      recon_fasta: 'The FASTA the tags are placed on (tryptic peptides); shifts are measured against it.',
      extension: 'Longer tags place more uniquely.',
      recon_missed_cleavages: 'Missed trypsin cleavages per placement, 0 to 10.'
    },
    outputs: ['out', 'recon_out', 'delta_out', 'delta_spectra_out', 'delta_counts_out', 'massgap_out', 'recon_id_out'],
    docs: { to: 'workflow-reconciliation', label: 'Reconciliation and mass shifts' }
  },
  {
    id: 'species',
    label: 'Species',
    blurb: 'Which taxa the sample contains, from the bundled taxonomy index. No FASTA needed.',
    products: 'species report',
    // Extension 2 is the paper-validated setting (Q1): seed 3 plus 2 x 2
    // reaches the bundled index's k = 7.
    values: { ...ALL, species: true, extension: '2' },
    // The presence call is experimental: under Advanced (Species).
    basic: ['species_rank', 'subsample_fraction'],
    help: {
      species_rank: 'The taxonomic level of the report.',
      subsample_fraction: 'All spectra; 10% ranks the main taxa 10× faster.'
    },
    outputs: ['out', 'species_out'],
    docs: { to: 'species-howto', label: 'Species detection' }
  },
  {
    id: 'db-reduction',
    label: 'Database reduction',
    blurb: 'A protein shortlist, a reduced FASTA and a Sage, Comet or MSFragger configuration for your search.',
    products: 'shortlist',
    // The shortlist recipe of doc/SHORTLIST.md. It is not validated: it
    // passed its second held-out test and failed the third. From 1.15.4 the
    // CLI applies it by default only with -search_engine msfragger and the
    // tryptic shortlist; the GUI sets it for every engine and protease, as
    // its default recipe, and says so (help/workflows.tsx).
    values: {
      ...ALL,
      shortlist_out: 'shortlist.tsv',
      fasta_out: 'reduced.fasta',
      search_config_out: 'search.json',
      extension: '3',
      shortlist_gapped: true,
      recon_min_length: '6',
      shortlist_max_evalue: '10',
      recon_missed_cleavages: '2'
    },
    // The protease is a search setting as in any search tool (round 11);
    // the Comet template shows only with Comet (it waits on Search engine).
    basic: ['recon_fasta', 'shortlist_background', 'search_config_template', 'shortlist_protease', 'search_engine', 'variable_modifications'],
    required: ['recon_fasta'],
    help: {
      recon_fasta: 'The FASTA to shortlist from.',
      shortlist_background: 'Host and contaminant proteins, always kept in the reduced FASTA.',
      search_config_template: 'Your comet.params (from comet -p); without it a fragment to merge by hand.',
      shortlist_protease: 'Trypsin; Auto for another or unknown digest.',
      search_engine: 'The engine the configuration is for.',
      variable_modifications: 'Tagged as alternatives and written for the engine.'
    },
    outputs: ['out', 'shortlist_out', 'fasta_out', 'search_config_out'],
    settingsNote:
      'The shortlist recipe this workflow sets (gapped placements, E-value 10, shortest placed tag 6, 2 missed cleavages) is not validated: it failed its third held-out test with MSFragger and has no held-out test with Sage, Comet or another protease. Its values are under Advanced › Shortlist, advanced.',
    docs: { to: 'workflow-db-reduction', label: 'Database reduction' }
  },
  {
    id: 'triage',
    label: 'Identifiability triage',
    blurb: 'Rank MS/MS spectra by how identifiable they are (experimental score), and mark those your search identified.',
    products: 'ranking',
    values: { ...ALL, census: true, census_score: true, census_sorted_out: 'census_sorted.tsv' },
    basic: ['census_ids', 'census_ids_fdr', 'census_triage_evalue'],
    help: {
      census_ids: 'Optional: this run\'s idXML or mzIdentML, with q-values; it adds ID q-value and Triage E-value.',
      census_ids_fdr: 'The q-value a hit needs to count as identified.',
      census_triage_evalue: 'An unidentified spectrum this good is a candidate.'
    },
    outputs: ['out', 'census_out', 'census_summary_out', 'census_sorted_out'],
    docs: { to: 'workflow-triage', label: 'Identifiability triage' }
  },
  {
    id: 'characterize',
    label: 'Characterize a run',
    blurb: 'Protease, labels, glycopeptides and species from 10% of the spectra; alkylation on request.',
    products: '4 reports',
    // No alkylation report by default: it places tags on a shipped proteome,
    // which needs tags of 8 residues (human), and extension 2 (validated
    // for the species call) reaches 7 with seed 3: every run would end with
    // tags_too_short.
    values: {
      ...ALL,
      digest_out: 'digest.tsv',
      label_out: 'label.tsv',
      glyco: true,
      species: true,
      extension: '2',
      subsample_fraction: '0.1'
    },
    basic: ['subsample_fraction'],
    help: {
      subsample_fraction: '10% gives stable calls in a tenth of the time.'
    },
    outputs: ['out', 'digest_out', 'label_out', 'alkylation_out', 'glyco_out', 'species_out'],
    productNotes: {
      alkylation_out:
        'Without a protein database the alkylation report places its tags on a shipped proteome, which needs tags of 8 residues (human, mouse) or 7 (yeast, E. coli) (or Shortest tag placed, when set above 0). Turning it on raises Extension so that tag length + 2 × Extension reaches that length; this changes every tag of the run. The species and digest calls are validated at Extension 2. A FASTA of your own (as the proteome or as Protein database) needs a length that grows with its size (8 for a human-sized one): Extension is not raised, and the note says what a human-sized one needs. With another report that places tags, Extension is left as it is.'
    },
    leadGroups: ['Species', 'Species, advanced', 'Taxonomy'],
    docs: { to: 'digest', label: 'Digest, label and mass-gap reports' }
  }
]

export const LANDING_TASK: TaskId = 'export-tags'

/// The key of the last-used values that names the workflow they ran in
/// (not a parameter: the form renders no such field).
export const LAST_WORKFLOW = 'workflow'

/// Workflow ids of earlier versions, as saved presets name them: Batch QC is
/// Characterize in Batch mode, Open results is navigation now.
const RENAMED: Record<string, { id: TaskId; batch?: true }> = {
  'batch-qc': { id: 'characterize', batch: true },
  'open-results': { id: 'export-tags' }
}

/// The workflow @p id names, an old id read as its successor.
export function migrateTaskId(id: string): { id: TaskId; batch?: true } | undefined {
  if (TASKS.some((t) => t.id === id)) return { id: id as TaskId }
  return Object.prototype.hasOwnProperty.call(RENAMED, id) ? RENAMED[id] : undefined
}

export const taskById = (id: string): Task | undefined => {
  const m = migrateTaskId(id)
  return m ? TASKS.find((t) => t.id === m.id) : undefined
}

/// What a preset is a diff over: FASTag's defaults or a built-in workflow.
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

/// The values of @p base: the defaults, or a workflow's values over them.
export function baseValues(base: PresetBase): Record<string, ParamValue> {
  const task = base.startsWith('builtin:') ? taskById(base.slice('builtin:'.length)) : undefined
  return { ...initialValues(), ...(task?.values ?? {}) }
}

/// The workflow an origin belongs to (a preset: the one it was saved over).
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
