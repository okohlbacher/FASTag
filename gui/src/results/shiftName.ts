// The best name of a mass-shift row (-delta_out), in one place: the
// Mass-shift table, Mass shifts › By residue (one table, pooled rows and
// their export) and the Overview's Top mass shift tile all show this name.
//
// The CLI's unimod column lists the Unimod entries within its naming
// tolerance, by the localized spectra on their sites, then by mass error.
// Its first entry is often an odd reading of a common shift: Label:15N(1)
// for a +1 Da precursor isotope error, Label:18O(1) for +2 Da, HN2_mustard
// for +101.07. The GUI names a row (CLI 1.16.4 unchanged):
//   1. an isotope error: the CLI's isotope_error column says 13C+k (within
//      its naming tolerance, on precursor-derived gaps, no better
//      residue-specific name); or the gap is within ISOTOPE_TOL_DA of
//      k x 1.00336 Da (k = 1..3), the row lists no common modification,
//      and either it lists only isotope labels (Label:15N(1), Label:18O(1))
//      or no common modification (with or without isotopes) lies nearer
//      (0.9845 Da is Deamidated's 0.9840, not 13C's 1.0034); or a common
//      modification plus k isotopes (Deamidated + 13C: 1.9874 Da) within
//      MOD_ISOTOPE_TOL_DA, when the row lists no common modification
//      itself. The closest reading wins;
//   2. else the first common modification (COMMON_MODS) the unimod column
//      lists, with its sites;
//   3. else the first unimod entry, else the first PSI-MOD entry; '' when
//      the row has none.

/// One C13-C12 spacing (Da), as the CLI's isotope_error column uses it.
export const C13_DA = 1.00336

/// A gap this close to k x C13_DA is an isotope error without the CLI's word
/// for it: about the CLI's -delta_name_tolerance default (10 ppm of a
/// 2,000 Da peptide). Its isotope_error column covers k = 1, 2 only, and
/// leaves rows out whose gaps are mostly not precursor-derived.
export const ISOTOPE_TOL_DA = 0.02

/// A common modification plus k isotopes: tighter, as every mass has some
/// Unimod entry near it.
export const MOD_ISOTOPE_TOL_DA = 0.005

/// Common modifications (Unimod names, monoisotopic Da), preferred over
/// exotic entries of the same mass.
export const COMMON_MODS: ReadonlyMap<string, number> = new Map([
  ['Oxidation', 15.994915],
  ['Deamidated', 0.984016],
  ['Carbamidomethyl', 57.021464],
  ['Acetyl', 42.010565],
  ['Methyl', 14.01565],
  ['Phospho', 79.966331],
  ['Carbamyl', 43.005814],
  ['Formyl', 27.994915],
  ['Amidated', -0.984016],
  ['Dehydrated', -18.010565],
  ['Cation:Na', 21.981943],
  ['Cation:K', 37.955882],
  ['Ammonia-loss', -17.026549],
  ['Gln->pyro-Glu', -17.026549],
  ['Glu->pyro-Glu', -18.010565]
])

/// Not read as a modification plus isotopes: Amidated + 2 x 13C (1.0227 Da)
/// would rename the +1 isotope error.
const NO_ISOTOPE_SUM = new Set(['Amidated'])

/// The entries of a unimod or psimod cell, without their mass errors:
/// "TMT6plex@N-term/K(-0.5ppm);Gly@K(+1ppm)" gives TMT6plex@N-term/K, Gly@K.
export function cellNames(cell: string | undefined): string[] {
  const c = (cell ?? '').trim()
  if (c === '' || c === '-') return []
  return c
    .split(';')
    .map((x) => x.replace(/\((?:[+-]?[\d.]+(?:ppm|mDa))\)$/, '').trim())
    .filter((x) => x !== '')
}

/// The first entry of a unimod or psimod cell, without its mass error.
export function firstName(cell: string | undefined): string {
  return cellNames(cell)[0] ?? ''
}

/// The entry of a name, before its '@'.
const entryOf = (name: string): string => {
  const at = name.indexOf('@')
  return (at < 0 ? name : name.slice(0, at)).trim()
}

/// A name is common when each modification of it (Oxidation+Acetyl: both)
/// is in COMMON_MODS.
function isCommon(name: string): boolean {
  const entry = entryOf(name)
  return entry !== '' && entry.split('+').every((m) => COMMON_MODS.has(m.trim()))
}

/// The readings of common modifications with 0 to 3 isotopes (Da).
const COMMON_READINGS: readonly number[] = [...COMMON_MODS].flatMap(([mod, m]) =>
  [0, 1, 2, 3].filter((j) => j === 0 || !NO_ISOTOPE_SUM.has(mod)).map((j) => m + j * C13_DA)
)

const isotopeName = (k: number): string => `isotope error +${k}`

/// The cells of one mass-shift row the best name reads.
export interface ShiftCells {
  delta: number
  unimod?: string
  psimod?: string
  isotope?: string
}

/// The best name of a mass-shift row, without mass errors; '' when none.
export function bestShiftName(r: ShiftCells): string {
  const unimod = cellNames(r.unimod)
  const common = unimod.find(isCommon)
  const onlyLabels = unimod.length > 0 && unimod.every((n) => entryOf(n).startsWith('Label:'))
  const d = r.delta
  if (Number.isFinite(d)) {
    let best: { name: string; err: number } | null = null
    const offer = (name: string, err: number): void => {
      if (!best || err < best.err) best = { name, err }
    }
    const cli = /^13C\+(\d)/.exec((r.isotope ?? '').trim())
    for (let k = 1; k <= 3; k++) {
      const err = Math.abs(d - k * C13_DA)
      const byGap = !common && err <= ISOTOPE_TOL_DA && (onlyLabels || COMMON_READINGS.every((m) => Math.abs(d - m) >= err))
      if ((cli && Number(cli[1]) === k) || byGap) offer(isotopeName(k), err)
      if (common) continue
      for (const [mod, mass] of COMMON_MODS) {
        if (NO_ISOTOPE_SUM.has(mod)) continue
        const e = Math.abs(d - (mass + k * C13_DA))
        if (e <= MOD_ISOTOPE_TOL_DA) offer(`${mod} + ${isotopeName(k)}`, e)
      }
    }
    if (best) return (best as { name: string }).name
  }
  return common ?? unimod[0] ?? firstName(r.psimod)
}
