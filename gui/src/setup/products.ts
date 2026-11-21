// The products of a run as the Outputs card lists them (doc/GUI-WORKFLOWS.md
// 2.3): one checkbox per report or tags-table column, with the file name it
// gets beside the tags table. A checkbox is the only control of its report:
// it sets the path, or the switch, and whatever else that report needs
// (the wiring rules of 2.3). Pure: the card renders what these say.

import type { ParamValue } from '../ParamField'
import { isActive, longestSeed, PARAM_BY_NAME } from '../paramLayout'
import { baseName } from '../digestReport'
import { outputKind, rebaseOutputs, stripExt } from '../app/paths'

type V = Record<string, ParamValue>

export interface Product {
  /// The option that names its file (or, for a column, its switch).
  param: string
  label: string
  /// What it holds, one line (the row's title).
  what: string
  /// A column of the tags table, not a file of its own.
  column?: true
  /// The switch that writes it; its own file name is then optional (the CLI
  /// puts it beside the tags table).
  flag?: string
  /// Values set with it (census_sorted_out needs census_score).
  also?: V
  /// Products it is made from: checking it checks them, and they cannot be
  /// unchecked while it is on.
  needs?: string[]
  /// Needs the protein database.
  db?: true
  experimental?: true
  /// Written with another product and not on its own: its row follows that one.
  follows?: string
}

export const PRODUCTS: readonly Product[] = [
  { param: 'out', label: 'Tags table', what: 'Every tag with its spectrum, masses and E-value.' },
  { param: 'proforma', label: 'ProForma column', what: 'Each tag as a ProForma 2.0 string, in the tags table.', column: true },
  { param: 'usi_collection', label: 'USI column', what: 'Each spectrum as a Universal Spectrum Identifier; needs the PRIDE accession.', column: true },
  { param: 'out_spectra', label: 'Spectra with tags', what: 'The spectra that carry a reported tag, as mzML.' },
  { param: 'qc_out', label: 'QC report', what: 'MS/MS counts, resolution, charges, labels, tag yield and instrument.' },
  { param: 'recon_out', label: 'Tag placements', what: 'Each tag placed on the database, with the mass left at each end.', db: true },
  { param: 'delta_out', label: 'Mass-shift table', what: 'How often each mass shift occurs, with UniMod names.', needs: ['recon_out'], db: true },
  { param: 'delta_spectra_out', label: 'Spectra per mass shift', what: 'The spectra behind each mass shift, with the site.', needs: ['delta_out'], db: true, experimental: true },
  { param: 'delta_counts_out', label: 'Mass-shift accounting', what: 'How many spectra reach each step of the survey.', needs: ['delta_out'], db: true, experimental: true },
  { param: 'massgap_out', label: 'Mass-gap report', what: 'Peaks of the mass gaps, explained as UniMod combinations.', needs: ['recon_out'], db: true },
  { param: 'recon_id_out', label: 'Placements as identifications', what: 'The placements as idXML, mzid or mzTab, for other tools: candidates, not FDR-controlled.', needs: ['recon_out'], db: true },
  { param: 'species_out', label: 'Species report', what: 'The taxa the tags point to, ranked.', flag: 'species' },
  { param: 'shortlist_out', label: 'Protein shortlist', what: 'Proteins ranked by the spectra placed on them.', db: true },
  { param: 'fasta_out', label: 'Reduced FASTA', what: 'The shortlisted proteins plus your background proteins.', db: true },
  { param: 'search_config_out', label: 'Search-engine configuration', what: 'Settings for Sage, Comet or MSFragger with the reduced FASTA.', db: true },
  { param: 'census_out', label: 'Identifiability table', what: 'One row per MS/MS spectrum, tagged or not.', flag: 'census' },
  { param: 'census_summary_out', label: 'Identifiability summary', what: 'The counts of the run, written with the table.', flag: 'census', follows: 'census_out' },
  // The CLI writes the ranking from the census rows: without -census it
  // ignores census_sorted_out, so the table is needed (and locked) with it.
  { param: 'census_sorted_out', label: 'Spectra ranked by identifiability', what: 'The table ordered by the identifiability score (experimental).', needs: ['census_out'], experimental: true, also: { census: true, census_score: true } },
  { param: 'digest_out', label: 'Digest report', what: 'Terminal residues and the protease they fit.' },
  { param: 'label_out', label: 'Label report', what: 'Isobaric and SILAC labels the tags carry.' },
  { param: 'alkylation_out', label: 'Alkylation report', what: 'The reagent that alkylated the cysteines, from a shipped proteome.' },
  { param: 'alkylation_tags_out', label: 'Alkylation from tags', what: 'The alkylation call without a database.', experimental: true },
  { param: 'glyco_out', label: 'Glycopeptide report', what: 'Spectra with oxonium ions.', flag: 'glyco' },
  { param: 'check_header_out', label: 'Precursor charge check', what: 'Each precursor charge of the file against the MS1 isotope spacing.', also: { check_header_charge: 'warn' }, experimental: true }
]

/// The tag length the shipped human and mouse proteomes need (alkylation
/// report); yeast and E. coli need one less.
export const ALKYLATION_TAG = 8

/// The accession the CLI takes until a data set has one (usi_collection):
/// checking USI column writes the column at once, never an empty option.
export const USI_PLACEHOLDER = 'USI000000'

/// The extension of a search-engine configuration: Sage reads JSON, Comet
/// and MSFragger a .params file.
export const searchConfigExt = (engine: unknown): string => (engine === 'comet' || engine === 'msfragger' ? 'params' : 'json')

/// After the engine changed to @p engine: an unedited default configuration
/// name (<stem>.search.json) gets the engine's extension; a name the user
/// chose stays.
export function renameSearchConfig(values: V, engine: unknown): V {
  const cur = text(values['search_config_out'])
  const m = /^(.*(?:^|[\\/.])search)\.(json|params)$/.exec(cur)
  if (!m) return values
  return { ...values, search_config_out: `${m[1]}.${searchConfigExt(engine)}` }
}

export const PRODUCT_OF: ReadonlyMap<string, Product> = new Map(PRODUCTS.map((p) => [p.param, p]))

/// The report an option writes or switches on, in words (species: Species
/// report); undefined for an option that is no product.
export function productLabel(name: string): string | undefined {
  return (PRODUCT_OF.get(name) ?? PRODUCTS.find((p) => p.flag === name || (p.also && name in p.also)))?.label
}

const text = (v: unknown): string => (Array.isArray(v) ? '' : typeof v === 'boolean' ? '' : String(v ?? '').trim())

/// The product is on in @p values.
export function isOn(p: Product, values: V): boolean {
  if (p.param === 'out') return true
  if (p.flag) return values[p.flag] === true
  if (p.column && PARAM_BY_NAME.get(p.param)?.type === 'bool') return values[p.param] === true
  return text(values[p.param]) !== ''
}

/// The checked products that need @p p, by label; empty when it is free.
export function neededBy(p: Product, values: V, among: readonly Product[] = PRODUCTS): string[] {
  return among.filter((q) => q.needs?.includes(p.param) && isOn(q, values)).map((q) => q.label)
}

/// The file name a product gets beside @p tagsOut ('' while there is none).
export function fileName(p: Product, values: V, tagsOut: string): string {
  if (p.column) return ''
  if (p.param === 'out') return tagsOut ? baseName(tagsOut) : ''
  const set = text(values[p.param])
  if (set && /[\\/]/.test(set)) return baseName(set)
  const stem = tagsOut ? baseName(tagsOut.endsWith('.tags.tsv') ? tagsOut.slice(0, -'.tags.tsv'.length) : stripExt(tagsOut)) : ''
  // A report the CLI derives from -out: <out> with its extension replaced.
  if (p.flag && !set) return tagsOut ? `${baseName(stripExt(tagsOut))}.${outputKind(p.param)}.tsv` : ''
  const ext = set ? set.slice(stripExt(set).length) : `.${PARAM_BY_NAME.get(p.param)?.formats?.[0] ?? (p.param === 'out_spectra' ? 'mzML' : 'tsv')}`
  return stem ? `${stem}.${outputKind(p.param)}${ext || '.tsv'}` : ''
}

/// The default file of a product before it has a folder: its kind and
/// extension (qc.tsv), moved beside the tags table by rebaseOutputs.
function bareName(p: Product, engine?: unknown): string {
  const fmt = PARAM_BY_NAME.get(p.param)?.formats?.[0]
  const ext = p.param === 'out_spectra' ? 'mzML' : p.param === 'search_config_out' ? searchConfigExt(engine) : p.param === 'recon_id_out' ? 'idXML' : fmt ?? 'tsv'
  return `${outputKind(p.param)}.${ext}`
}

/// The shipped proteomes of -alkylation_proteome (auto is human).
const SHIPPED_PROTEOMES = new Set(['auto', 'human', 'mouse', 'yeast', 'ecoli'])

/// The proteome the alkylation report is sent, lower case (its default
/// when cleared).
const proteomeOf = (values: V): string =>
  (text(values['alkylation_proteome']) || String(PARAM_BY_NAME.get('alkylation_proteome')?.default ?? 'auto')).toLowerCase()

/// The tag length the alkylation report's database needs (FASTag.cpp: the
/// placement index's minimum, -recon_min_length when it is above 0, else
/// derived from the database): 8 residues on the shipped human or mouse
/// proteome (auto is human), 7 on yeast or E. coli. A FASTA of the user's
/// (an -alkylation_proteome file or -recon_fasta) is indexed with a minimum
/// that grows with its size: 8 for a human-sized one, the length used for
/// the note, never for a raise (alkylationShipped).
export function alkylationTarget(values: V): number {
  const min = Number(text(values['recon_min_length']))
  if (Number.isInteger(min) && min > 0) return min
  if (alkylationShipped(values)) {
    const prot = proteomeOf(values)
    if (prot === 'yeast' || prot === 'ecoli') return ALKYLATION_TAG - 1
  }
  return ALKYLATION_TAG
}

/// The alkylation report places its tags on a shipped proteome: no protein
/// database is given and -alkylation_proteome names one (not a FASTA). Only
/// then is its length known before the run (and only then does the CLI
/// give tags_too_short), so only then does the report raise Extension.
export function alkylationShipped(values: V): boolean {
  return !isActive('recon_fasta', values) && SHIPPED_PROTEOMES.has(proteomeOf(values))
}

/// The extension the alkylation report needs in @p values, whatever
/// Extension holds now; null when it needs none. The CLI places the
/// alkylation report's tags on its own database (the shipped proteome or
/// the FASTA of -alkylation_proteome, or -recon_fasta when given) only when
/// no other report places tags (placements, shortlist, reduced FASTA,
/// search configuration); those set the index up themselves. The extension
/// rises so that the longest seed plus both ends reach the tag length.
export function alkylationNeed(values: V): number | null {
  if (['recon_out', 'shortlist_out', 'fasta_out', 'search_config_out'].some((n) => isActive(n, values))) return null
  const target = alkylationTarget(values)
  const seed = longestSeed(values)
  if (seed == null) return null
  const need = Math.ceil((target - seed) / 2)
  return need > 0 ? need : null
}

/// The extension the alkylation report would need when Extension is short
/// of it, on any database; null when Extension reaches it.
export function alkylationShort(values: V): string | null {
  const need = alkylationNeed(values)
  const ext = Number(text(values['extension']) || PARAM_BY_NAME.get('extension')?.default || 0)
  return need != null && Number.isFinite(ext) && ext < need ? String(need) : null
}

/// The extension the alkylation report raises @p values to, when it must
/// rise; null when it need not (Extension already reaches it) or may not
/// (a FASTA of the user's: its length depends on its size, alkylationShort
/// says it in a note instead).
export function alkylationExtension(values: V): string | null {
  return alkylationShipped(values) ? alkylationShort(values) : null
}

/// Extension for the alkylation report, worked out again from the value
/// before any raise: while the report is on, raised to what the proteome
/// and the tag length need now (human to yeast lowers a raise of 3 to 2; a
/// lower tag length raises it further); put back once no raise is needed
/// (another report places the tags, a protein database is set, the report
/// is off). @p raised is the raise in force; an Extension edited since
/// (it no longer holds raised.to) is the user's, and the base of any new
/// raise.
export function alkylationRaise(
  values: V,
  raised: { from: ParamValue; to: ParamValue } | null
): { values: V; raised: { from: ParamValue; to: ParamValue } | null } {
  const kept = raised && text(values['extension']) === text(raised.to) ? raised : null
  const base: ParamValue = kept ? kept.from : (values['extension'] ?? '')
  const before: V = { ...values, extension: base }
  const alk = PRODUCT_OF.get('alkylation_out')
  const to = alk && isOn(alk, values) ? alkylationExtension(before) : null
  if (to) return { values: text(values['extension']) === to ? values : { ...values, extension: to }, raised: { from: base, to } }
  if (kept) return { values: text(values['extension']) === text(base) ? values : before, raised: null }
  return { values, raised: null }
}

/// What turning product @p p on or off does beyond itself: on, the
/// extension the alkylation report raises (@p raised remembers it); off,
/// the extension restored when it is still the raised one (not edited
/// since). Another product that places tags makes the raise unneeded, and
/// restores it too. Used by the Outputs card's toggle.
export function toggleProduct(
  p: Product,
  on: boolean,
  values: V,
  tagsOut: string,
  raised: { from: ParamValue; to: ParamValue } | null
): { values: V; raised: { from: ParamValue; to: ParamValue } | null } {
  const next = setProduct(p, on, values, tagsOut)
  if (p.param !== 'alkylation_out') return alkylationRaise(next, raised)
  if (on) return { values: next, raised: next['extension'] !== values['extension'] ? { from: values['extension'] ?? '', to: next['extension'] } : null }
  if (raised && text(values['extension']) === text(raised.to)) next['extension'] = raised.from
  return { values: next, raised: null }
}

/// The values after checking (@p on) or unchecking product @p p: its path or
/// switch, what it needs, and, when it is turned off, nothing it needs
/// (a needed product stays as it was).
export function setProduct(p: Product, on: boolean, values: V, tagsOut: string): V {
  const next: V = { ...values }
  const turnOn = (q: Product): void => {
    for (const n of q.needs ?? []) {
      const need = PRODUCT_OF.get(n)
      if (need && !isOn(need, next)) turnOn(need)
    }
    // A value set with it fills an option still at its default only: the
    // charge check in mode both stays both (warn would drop the tagging
    // at the alternative charge).
    for (const [k, v] of Object.entries(q.also ?? {})) {
      const cur = text(next[k])
      const d = PARAM_BY_NAME.get(k)?.default
      if (typeof v === 'string' && cur !== '' && cur !== (typeof d === 'string' ? d : '')) continue
      next[k] = v
    }
    const raised = q.param === 'alkylation_out' ? alkylationExtension(next) : null
    if (raised) next['extension'] = raised
    if (q.flag) next[q.flag] = true
    else if (PARAM_BY_NAME.get(q.param)?.type === 'bool') next[q.param] = true
    else if (q.param === 'usi_collection' && !text(next[q.param])) next[q.param] = USI_PLACEHOLDER
    else if (!q.column && !text(next[q.param])) {
      const bare = bareName(q, next['search_engine'])
      next[q.param] = tagsOut ? rebaseOutputs({ [q.param]: bare }, tagsOut)[q.param] ?? bare : bare
    }
  }
  if (on) turnOn(p)
  else if (p.flag) {
    next[p.flag] = false
    // Its file goes with it, or a stale path would still be sent.
    next[p.param] = ''
  } else if (PARAM_BY_NAME.get(p.param)?.type === 'bool') next[p.param] = false
  else next[p.param] = ''
  return next
}

/// The products checked in @p values among @p params, excluding the tags table.
export function productsOn(params: readonly string[], values: V): Product[] {
  return params.map((n) => PRODUCT_OF.get(n)).filter((p): p is Product => !!p && p.param !== 'out' && !p.column && isOn(p, values))
}

/// A product is on and its report needs the protein database, which is not set.
export function missingDatabase(values: V): boolean {
  return PRODUCTS.some((p) => p.db && isOn(p, values)) && !isActive('recon_fasta', values) && !isActive('fasta', values)
}
