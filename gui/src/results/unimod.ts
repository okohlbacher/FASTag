// The deltas the mass-gap chart marks (GUI-DESIGN S7: "a bundled subset of
// about 60 common deltas"). Unimod names and monoisotopic masses, each with
// its elemental composition so a test recomputes the mass (unimod.test.ts).
// `cli` marks the 38 modifications the CLI combines for -massgap_out
// (data/digest/massgap_mods.tsv); the others are common deltas the chart
// names but the CLI does not combine. Two marks are not modifications: the
// 13C isotope errors and the residues of a missed cleavage, which appear in
// delta histograms where chemistry predicts them (README "Reconciliation").
// A mark is a hypothesis for the reader, never an identification.

export type MarkKind = 'unimod' | 'isotope' | 'residue'

export interface Mark {
  name: string
  /// The usual site, as Unimod names it.
  site: string
  /// Elemental composition, Unimod style: `H(-2) O(-1)`, `13C(6) C(-6)`.
  composition: string
  /// Monoisotopic delta (Da).
  mass: number
  kind: MarkKind
  /// One of the modifications the CLI combines for -massgap_out.
  cli: boolean
}

// Monoisotopic element and isotope masses (Unimod / IUPAC).
const ELEMENT: Record<string, number> = {
  H: 1.00782503207,
  '2H': 2.0141017778,
  C: 12,
  '13C': 13.0033548378,
  N: 14.0030740048,
  '15N': 15.0001088982,
  O: 15.99491461956,
  '18O': 17.9991610,
  S: 31.97207100,
  P: 30.97376163,
  Na: 22.9897692809,
  K: 38.96370668,
  Ca: 39.96259098,
  Fe: 55.9349375,
  Cu: 62.9295975,
  Zn: 63.9291422
}

/// The monoisotopic mass of a Unimod-style composition. Throws on an
/// element it does not know.
export function compositionMass(comp: string): number {
  let m = 0
  for (const tok of comp.trim().split(/\s+/)) {
    const x = /^(\d*[A-Z][a-z]?)(?:\((-?\d+)\))?$/.exec(tok)
    if (!x || !(x[1] in ELEMENT)) throw new Error(`unknown element in ${JSON.stringify(comp)}: ${tok}`)
    m += ELEMENT[x[1]] * (x[2] == null ? 1 : Number(x[2]))
  }
  return m
}

type Row = [name: string, site: string, composition: string, mass: number, kind?: MarkKind]

// The CLI's 38, in massgap_mods.tsv order.
const CLI_ROWS: Row[] = [
  ['Oxidation', 'M', 'O', 15.994915],
  ['Dioxidation', 'M', 'O(2)', 31.989829],
  ['Deamidated', 'N, Q', 'H(-1) N(-1) O', 0.984016],
  ['Gln->pyro-Glu', 'N-term Q', 'H(-3) N(-1)', -17.026549],
  ['Glu->pyro-Glu', 'N-term E', 'H(-2) O(-1)', -18.010565],
  ['Carbamidomethyl', 'C', 'H(3) C(2) N O', 57.021464],
  ['Cation:Na', 'D, E', 'H(-1) Na', 21.981943],
  ['Cation:K', 'D, E', 'H(-1) K', 37.955882],
  ['Carbamyl', 'N-term', 'H C N O', 43.005814],
  ['Formyl', 'N-term', 'C O', 27.994915],
  ['Acetyl', 'K, N-term', 'H(2) C(2) O', 42.010565],
  ['Methyl', 'K, R', 'H(2) C', 14.01565],
  ['Dimethyl', 'K, R', 'H(4) C(2)', 28.0313],
  ['Trimethyl', 'K', 'H(6) C(3)', 42.04695],
  ['Propionyl', 'K', 'H(4) C(3) O', 56.026215],
  ['Butyryl', 'K', 'H(6) C(4) O', 70.041865],
  ['Crotonyl', 'K', 'H(4) C(4) O', 68.026215],
  ['Succinyl', 'K', 'H(4) C(4) O(3)', 100.016044],
  ['Malonyl', 'K', 'H(2) C(3) O(3)', 86.000394],
  ['GG', 'K', 'H(6) C(4) N(2) O(2)', 114.042927],
  ['Phospho', 'S, T, Y', 'H O(3) P', 79.966331],
  ['Sulfo', 'Y', 'O(3) S', 79.956815],
  ['Nitro', 'Y', 'H(-1) N O(2)', 44.985078],
  ['HexNAc', 'S, T, N', 'H(13) C(8) N O(5)', 203.079373],
  ['Hex', 'K', 'H(10) C(6) O(5)', 162.052824],
  ['Cysteinyl', 'C', 'H(5) C(3) N O(2) S', 119.004099],
  ['Methylthio', 'C', 'H(2) C S', 45.987721],
  ['Propionamide', 'C', 'H(5) C(3) N O', 71.037114],
  ['Nethylmaleimide', 'C', 'H(7) C(6) N O(2)', 125.047679],
  ['TMT6plex', 'K, N-term', 'H(20) C(8) 13C(4) N 15N O(2)', 229.162932],
  ['TMTpro', 'K, N-term', 'H(25) C(8) 13C(7) N 15N(2) O(3)', 304.207146],
  ['iTRAQ4plex', 'K, N-term', 'H(12) C(4) 13C(3) N 15N O', 144.102063],
  ['Label:13C(6)15N(2)', 'K', 'C(-6) 13C(6) N(-2) 15N(2)', 8.014199],
  ['Label:13C(6)15N(4)', 'R', 'C(-6) 13C(6) N(-4) 15N(4)', 10.008269],
  ['Label:2H(4)', 'K', 'H(-4) 2H(4)', 4.025107],
  ['Label:13C(6)', 'R', 'C(-6) 13C(6)', 6.020129],
  ['Met-loss', 'Protein N-term M', 'H(-9) C(-5) N(-1) O(-1) S(-1)', -131.040485],
  ['Met-loss+Acetyl', 'Protein N-term M', 'H(-7) C(-3) N(-1) S(-1)', -89.02992]
]

// Further common deltas the chart names (not combined by the CLI).
const MORE_ROWS: Row[] = [
  ['Carboxymethyl', 'C', 'H(2) C(2) O(2)', 58.005479],
  ['Trioxidation', 'C', 'O(3)', 47.984744],
  ['Amidated', 'C-term', 'H N O(-1)', -0.984016],
  ['Dehydrated', 'S, T', 'H(-2) O(-1)', -18.010565],
  ['Pyro-carbamidomethyl', 'N-term C', 'C(2) O', 39.994915],
  ['Delta:H(2)C(2)', 'K, N-term', 'H(2) C(2)', 26.01565],
  ['Dimethyl:2H(4)', 'K, N-term', '2H(4) C(2)', 32.056407],
  ['Dimethyl:2H(6)13C(2)', 'K, N-term', 'H(-2) 2H(6) 13C(2)', 36.07567],
  ['TMT', 'K, N-term', 'H(20) C(12) N(2) O(2)', 224.152478],
  ['iTRAQ8plex', 'K, N-term', 'H(24) C(7) 13C(7) N(3) 15N O(3)', 304.20536],
  ['Label:18O(2)', 'C-term', 'O(-2) 18O(2)', 4.008491],
  ['Biotin', 'K', 'H(14) C(10) N(2) O(2) S', 226.077598],
  ['Cation:Ca[II]', 'D, E', 'H(-2) Ca', 37.946941],
  ['Cation:Fe[II]', 'D, E', 'H(-2) Fe', 53.919289],
  ['Cation:Cu[I]', 'D, E', 'H(-1) Cu', 61.921774],
  ['Cation:Zn[II]', 'D, E', 'H(-2) Zn', 61.913495],
  ['Hex(1)HexNAc(1)', 'S, T', 'H(23) C(14) N O(10)', 365.132196],
  ['NeuAc', 'S, T', 'H(17) C(11) N O(8)', 291.095417],
  ['Myristoyl', 'G, K', 'H(26) C(14) O', 210.198366],
  ['Palmitoyl', 'C', 'H(30) C(16) O', 238.229666],
  ['Farnesyl', 'C', 'H(24) C(15)', 204.187801],
  ['HNE', 'C, H, K', 'H(16) C(9) O(2)', 156.11503],
  ['Carboxy', 'E, D', 'C O(2)', 43.989829],
  ['Didehydro', 'C-term', 'H(-2)', -2.01565],
  ['Guanidinyl', 'K', 'H(2) C N(2)', 42.021798],
  ['Trp->Kynurenin', 'W', 'C(-1) O', 3.994915],
  ['Isotope error +1', '13C', '13C C(-1)', 1.003355, 'isotope'],
  ['Isotope error +2', '13C', '13C(2) C(-2)', 2.00671, 'isotope'],
  ['Missed cleavage K', 'K residue', 'H(12) C(6) N(2) O', 128.094963, 'residue'],
  ['Missed cleavage R', 'R residue', 'H(12) C(6) N(4) O', 156.101111, 'residue']
]

const mark = (cli: boolean) => ([name, site, composition, mass, kind = 'unimod']: Row): Mark => ({ name, site, composition, mass, kind, cli })

/// In mass order.
export const UNIMOD_MARKS: readonly Mark[] = [...CLI_ROWS.map(mark(true)), ...MORE_ROWS.map(mark(false))].sort(
  (a, b) => a.mass - b.mass
)

/// The mark closest to @p delta within @p window Da (inclusive); null when
/// none lies that close. A tie goes to the mark the CLI combines.
export function nearestMark(delta: number, window: number): Mark | null {
  let best: Mark | null = null
  let bestD = Infinity
  for (const m of UNIMOD_MARKS) {
    const d = Math.abs(m.mass - delta)
    if (d > window + 1e-12) continue
    if (d < bestD - 1e-12 || (Math.abs(d - bestD) <= 1e-12 && m.cli && !best?.cli)) {
      best = m
      bestD = d
    }
  }
  return best
}

/// The marks with @p lo <= mass <= @p hi, in mass order.
export function marksIn(lo: number, hi: number): Mark[] {
  return UNIMOD_MARKS.filter((m) => m.mass >= lo && m.mass <= hi)
}
