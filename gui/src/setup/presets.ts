// Built-in, read-only instrument presets (GUI-DESIGN 3 S1, Q5 provisional,
// P0b; doc/GUI-WORKFLOWS.md 2.1). A preset sets the fragment tolerance, its
// unit and the ion series, nothing else.
// timsTOF and Astral are not validated against the paper's benchmark and say
// so wherever they are offered.

import type { ParamValue } from '../ParamField'
import { PARAM_BY_NAME } from '../paramLayout'

export interface InstrumentPreset {
  id: string
  label: string
  tolerance: string
  unit: 'ppm' | 'Da'
  /// The ion series the spectra are read as (by unless said).
  ions?: 'by' | 'auto'
  validated: boolean
}

// The first preset whose values the form holds is the one Settings shows
// (Astral HCD at 20 ppm reads as Orbitrap/TOF HCD: the same values).
export const INSTRUMENTS: readonly InstrumentPreset[] = [
  { id: 'orbitrap-hcd', label: 'Orbitrap/TOF HCD', tolerance: '20', unit: 'ppm', validated: true },
  { id: 'orbitrap-etd', label: 'Orbitrap ETD or EThcD', tolerance: '20', unit: 'ppm', ions: 'auto', validated: true },
  { id: 'iontrap-cid', label: 'Ion trap CID', tolerance: '0.3', unit: 'Da', validated: true },
  { id: 'timstof', label: 'timsTOF', tolerance: '30', unit: 'ppm', validated: false },
  { id: 'astral', label: 'Astral', tolerance: '20', unit: 'ppm', validated: false }
]

/// "Orbitrap HCD 20 ppm", "timsTOF 30 ppm (unvalidated)".
export function presetText(p: InstrumentPreset): string {
  return `${p.label} ${p.tolerance} ${p.unit}${p.validated ? '' : ' (unvalidated)'}`
}

/// The values @p p changes: fragment_tolerance, its unit and the ion series.
export function applyInstrument(values: Record<string, ParamValue>, p: InstrumentPreset): Record<string, ParamValue> {
  return { ...values, fragment_tolerance: p.tolerance, fragment_tolerance_unit: p.unit, ion_series: p.ions ?? 'by' }
}

const num = (v: unknown, fallback: unknown): number => Number(String(v === '' || v == null ? fallback : v).trim())

/// @p values hold what preset @p p sets (an empty field is the CLI default).
export function matchesInstrument(values: Record<string, unknown>, p: InstrumentPreset): boolean {
  const tol = num(values['fragment_tolerance'], PARAM_BY_NAME.get('fragment_tolerance')?.default)
  const unit = String(values['fragment_tolerance_unit'] || PARAM_BY_NAME.get('fragment_tolerance_unit')?.default)
  const ions = String(values['ion_series'] || PARAM_BY_NAME.get('ion_series')?.default || 'by')
  return tol === Number(p.tolerance) && unit === p.unit && ions === (p.ions ?? 'by')
}

/// The preset Settings shows for @p values: the one last chosen while the
/// values are still its own, else the first whose values they are; null
/// for a custom tolerance.
export function shownInstrument(values: Record<string, unknown>, chosen?: string): InstrumentPreset | null {
  const c = INSTRUMENTS.find((x) => x.id === chosen)
  if (c && matchesInstrument(values, c)) return c
  return INSTRUMENTS.find((x) => matchesInstrument(values, x)) ?? null
}

export interface SpeciesFix {
  label: string
  values: Record<string, ParamValue>
  note?: string
}

/// One-click fixes for the species reach preflight (speciesReach): first
/// "Use extension 2" (the paper-validated setting, Q1; more only if 2 cannot
/// reach k), then raising the seed length, which changes every tag.
export function speciesFixes(r: { reach: number; k: number; option: string; seed: number; ext: number } | null): SpeciesFix[] {
  if (!r) return []
  const ext = Math.max(2, Math.ceil((r.k - r.seed) / 2))
  const fixes: SpeciesFix[] = [{ label: `Use extension ${ext}`, values: { extension: String(ext) } }]
  if (r.option === 'tag_length') {
    fixes.push({ label: `Set seed length to ${r.k}`, values: { tag_length: String(r.k) }, note: 'changes every tag' })
  }
  return fixes
}
