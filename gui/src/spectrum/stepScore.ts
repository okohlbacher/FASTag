// How resolved tags are ranked: each step's log-odds of being right, from its
// peaks, minus a threshold. A chain grows by a tag only when the steps it adds
// are worth more than the threshold, so a doubtful extension lowers the score
// instead of raising it.
//
// The default (cstarWeight + noselfFirst, scheme X1 = CstarNS_t3, FASTag's
// -resolve_score cstar) won the preregistered held-out test of amendment 3
// (work/tag-score/PREREG-tag-scoring.md, its Result): the C* step model, whose
// features add to the peaks and the mass error the step's rivals, support and
// complements at any charge, with rank 1 the first resolved tag that holds no
// peak together with its own complement. On PXD020401 (Orbitrap HCD, 20 ppm)
// the first resolved tag was right in 84.9% of scans (2.706 correct residues)
// against 81.5% (2.509) for stepWeight; on PXD031975 (ion trap, 0.5 Da) 59.8%
// (2.016) against 48.0% (1.595).
//
// stepWeight, the 1.15 default, is kept: a logistic regression on the steps of
// tags with E <= 1 of PXD003531 (Q Exactive) and PXD000001 (Orbitrap Velos,
// TMT), against Sage identifications (work/tag-score: calib.ts, fitstep.py).
// Threshold 3 passed the preregistered held-out test on PXD076528 (Orbitrap
// Astral): the first resolved tag right in 58.7% of scans against 58.2% for
// the best single tag, with 11% more correct residues; summed E-value evidence
// was right in 40.3%.

import type { SpectrumPeaks } from './dump'
import { buildGraph, layerOf, placementsOf, type GPath, type Placement, type Step, type TagGraph, type TagIn } from './graph'
import { PROTON, complementOf, complementTol, type Residues } from './ladder'

interface Model {
  intercept: number
  coef: Record<string, number>
}
// stepmodel-PXD003531+PXD000001.json and its variant without the mass error.
const FULL: Model = {
  intercept: 1.06978,
  coef: { lE: 0.15432, abs_dppm: 0.20914, dppm2: -2.1797, rank_max: -2.43553, rank_min: -1.16783, comp_any: 0.88343, comp_both: 2.14052, gap: -2.97032, amb: 1.94454, log_np: -0.25137 }
}
const NO_MASS: Model = {
  intercept: 1.05162,
  coef: { lE: 0.15722, rank_max: -2.32288, rank_min: -1.02859, comp_any: 0.84074, comp_both: 2.08892, gap: -2.97643, amb: 1.69824, log_np: -0.21684 }
}
export const STEP_THRESHOLD = 3
// The model was fitted at 20 ppm. ponytail: wider tolerances (a Da run) use the
// variant without the mass error, which is not validated on such data.
const MAX_PPM = 25

/** The log-odds of each step of @p s being right (features as in fitstep.py). */
export function stepLogit(s: SpectrumPeaks): (st: Step, z: number) => number {
  const model = s.toleranceUnit === 'ppm' && s.tolerance <= MAX_PPM ? FULL : NO_MASS
  const order = s.int.map((_, i) => i).sort((a, b) => s.int[b] - s.int[a])
  const rank = new Array<number>(s.mz.length)
  order.forEach((p, r) => (rank[p] = r / Math.max(1, s.mz.length - 1)))
  const M = s.precursor != null && s.charge > 0 ? s.precursor * s.charge - s.charge * PROTON : null
  const tol = (x: number): number => (s.toleranceUnit === 'ppm' ? (x * s.tolerance) / 1e6 : s.tolerance)
  // Whether a 1+ peak lies at @p x (the complement of a fragment, read at 1+ as in the fit).
  const has = (x: number): boolean => {
    let lo = 0
    let hi = s.mz.length
    while (lo < hi) {
      const m = (lo + hi) >> 1
      if (s.mz[m] < x) lo = m + 1
      else hi = m
    }
    return [lo - 1, lo].some((k) => k >= 0 && k < s.mz.length && Math.abs(s.mz[k] - x) <= tol(x))
  }
  const comp = (p: number, z: number): number => (M == null ? 0 : has(M - (s.mz[p] * z - z * PROTON) + PROTON) ? 1 : 0)
  const cache = new Map<Step, number>()
  // A step lies in one layer (one fragment charge), so it is cached on its own.
  return (st: Step, z: number): number => {
    const hit = cache.get(st)
    if (hit !== undefined) return hit
    const r = st.readings[0]
    const ad = Math.abs(r.deltaPpm)
    const f: Record<string, number> = {
      lE: Math.min(12, -Math.log10(Math.max(r.evalue ?? 1e3, 1e-300))),
      abs_dppm: ad,
      dppm2: (ad / 10) ** 2,
      rank_max: Math.max(rank[st.u], rank[st.v]),
      rank_min: Math.min(rank[st.u], rank[st.v]),
      comp_any: Math.max(comp(st.u, z), comp(st.v, z)),
      comp_both: Math.min(comp(st.u, z), comp(st.v, z)),
      gap: r.gap ? 1 : 0,
      amb: st.readings.length > 1 ? 1 : 0,
      log_np: Math.log(s.mz.length)
    }
    const v = model.intercept + Object.entries(model.coef).reduce((a, [k, c]) => a + c * f[k], 0)
    cache.set(st, v)
    return v
  }
}

/** The chain weight of the tag graph: the steps a placement adds, each worth its log-odds less @p t. */
export function stepWeight(s: SpectrumPeaks, t = STEP_THRESHOLD): (p: Placement, prev: Placement | null) => number {
  const logit = stepLogit(s)
  return (p, prev) => {
    const shared = prev ? prev.peaks.length - prev.peaks.indexOf(p.peaks[0]) - 1 : 0
    return p.steps.slice(shared).reduce((a, st) => a + logit(st, p.charge) - t, 0)
  }
}

// ---------- cstar: scheme X1 = CstarNS_t3 ----------
// The definition is work/tag-score/heldout3/defs.md; this follows the frozen
// reference, heldout3/bench3.ts (massErr, cstarLogits, s2weight, noself), in
// its operation order, as FASTag's src/TagGraph.cpp does.

// heldout3/models/M2-ion+pos+null_rall-E1.json
// (sha256 3e6bf4332accaba38c222539a14fe314261fdb31f518fa59358feaf2db395706):
// the final C* step model, a logistic regression on the steps of tags with
// E <= 1 of PXD003531, PXD000001 and PXD076528 against Sage (n = 542562).
// Coefficients verbatim, in the model's feature order; r_X is the one-hot of
// the first reading's residue.
const CSTAR = {
  intercept: 2.624971630586346,
  features: ['lE', 'abs_dppm', 'dppm2', 'rank_max', 'rank_min', 'comp_any', 'comp_both', 'gap', 'amb', 'log_np', 'compz_any', 'compz_both', 'lrank_max', 'lrank_min', 'amb_margin', 'rival_n', 'rival_margin', 'sup_n', 'sup_rows', 'rel_dppm', 'rel_dppm2', 'lE_gap', 'in_best', 'r_A', 'r_C', 'r_D', 'r_E', 'r_F', 'r_G', 'r_H', 'r_K', 'r_L', 'r_M', 'r_N', 'r_P', 'r_Q', 'r_R', 'r_S', 'r_T', 'r_V', 'r_W', 'r_Y'],
  coef: [
    0.29314535526904445, 0.255380932702539, -2.6530101991215, -0.7334382823740151, -0.8663784249333464, -0.0760433001260223, -0.5121913582724096,
    -4.0929839693475, 3.872419687178933, -0.7248894057781843, 1.3698254813148254, 1.7517145952673776, -0.9492200398515636, -1.0860957725554623,
    -1.6576078886914931, -1.7482378187560106, 0.5647160598218061, 0.0918835754862662, 0.36985287641826486, 0.033797717560883137, 0.5004740239225409,
    0.14384158683831655, 0.36146696035713544, 0.1950523857590289, -0.1104590443727135, 0.07877687696480704, 0.2873957611772344, -0.05149089626793415,
    0.6334022489205966, -0.20306296579046457, -1.472225211656916, 0.06256551062616417, -0.07214764437941619, -0.13361209475690652, 0.3199279891348483,
    -0.291629339181768, -2.3168136955216543, 0.263460527811237, 0.15761272187231753, -0.07961890822310448, -1.3111811122063246, -0.15678063142555532
  ]
}
export const CSTAR_THRESHOLD = 3

/** The signed mass error of a step as cstar reads it: the first reading's
 *  deltaPpm at a ppm tolerance <= 25 ppm (as the model was fitted), else the
 *  error in tolerance units scaled to 20: 20 deltaMz / tol(x), x = mz[v] - deltaMz. */
export function stepMassError(s: SpectrumPeaks): (st: Step) => number {
  const raw = s.toleranceUnit === 'ppm' && s.tolerance <= MAX_PPM
  const tol = (x: number): number => (s.toleranceUnit === 'ppm' ? (x * s.tolerance) / 1e6 : s.tolerance)
  return (st) => {
    const r = st.readings[0]
    if (raw) return r.deltaPpm
    const x = s.mz[st.v] - r.deltaMz
    return (20 * r.deltaMz) / tol(x)
  }
}

/** The C* features of one step (featC.ts, those of the final model); lab: the residue of its first reading, I as L, or gap. */
export type CstarFeatures = Record<string, number | string> & { lab: string }

const lEof = (e: number | null): number => Math.min(12, -Math.log10(Math.max(e ?? 1e3, 1e-300)))

/** The C* features of every step of @p placements (graph.ts placementsOf), keyed layer|peaks|k. */
export function cstarFeatures(s: SpectrumPeaks, placements: Placement[]): Map<string, CstarFeatures> {
  const signed = stepMassError(s)
  const n = s.mz.length
  const order = s.int.map((_, i) => i).sort((a, b) => s.int[b] - s.int[a])
  const rank = new Array<number>(n)
  order.forEach((p, r) => (rank[p] = r / Math.max(1, n - 1)))
  // Local rank: the fraction of the peaks within +-50 Th that are more intense.
  const lrank = new Array<number>(n)
  for (let i = 0; i < n; i++) {
    let more = 0
    let cnt = 0
    for (let j = i; j >= 0 && s.mz[i] - s.mz[j] <= 50; j--) {
      cnt++
      if (s.int[j] > s.int[i]) more++
    }
    for (let j = i + 1; j < n && s.mz[j] - s.mz[i] <= 50; j++) {
      cnt++
      if (s.int[j] > s.int[i]) more++
    }
    lrank[i] = cnt > 1 ? more / (cnt - 1) : 0
  }
  const tol = (x: number): number => (s.toleranceUnit === 'ppm' ? (x * s.tolerance) / 1e6 : s.tolerance)
  const has = (x: number): number => {
    if (!(x > 0)) return 0
    let lo = 0
    let hi = n
    while (lo < hi) {
      const m = (lo + hi) >> 1
      if (s.mz[m] < x) lo = m + 1
      else hi = m
    }
    return [lo - 1, lo].some((k) => k >= 0 && k < n && Math.abs(s.mz[k] - x) <= tol(x)) ? 1 : 0
  }
  const M = s.precursor != null ? s.precursor * s.charge - s.charge * PROTON : null
  const comp1 = (p: number, z: number): number => (M == null ? 0 : has(M - (s.mz[p] * z - z * PROTON) + PROTON))
  const cmax = Math.max(1, s.charge - 1)
  const compz = (p: number, z: number): number => {
    if (M == null) return 0
    const m = M - (s.mz[p] * z - z * PROTON)
    for (let c = 1; c <= cmax; c++) if (has((m + c * PROTON) / c)) return 1
    return 0
  }
  // The unique steps of each layer (layer|u|v): support, rivals, first-seen mass error.
  type U = { lE: number; nplac: number; nrows: number; d: number }
  const uniq = new Map<string, U>()
  const byU = new Map<string, string[]>()
  const byV = new Map<string, string[]>()
  for (const p of placements) {
    const L = layerOf(p)
    for (const st of p.steps) {
      const key = `${L}|${st.u}|${st.v}`
      let e = uniq.get(key)
      if (!e) {
        e = { lE: -Infinity, nplac: 0, nrows: 0, d: signed(st) }
        uniq.set(key, e)
        const ku = `${L}|${st.u}`
        const kv = `${L}|${st.v}`
        if (!byU.has(ku)) byU.set(ku, [])
        byU.get(ku)!.push(key)
        if (!byV.has(kv)) byV.set(kv, [])
        byV.get(kv)!.push(key)
      }
      e.lE = Math.max(e.lE, lEof(st.readings[0].evalue))
      e.nplac++
      e.nrows += p.rows.length
    }
  }
  // The best placement by E-value (the first on a tie).
  let bestP: Placement | null = null
  for (const p of placements) if (!bestP || (p.evalue ?? Infinity) < (bestP.evalue ?? Infinity)) bestP = p
  const best = bestP
  const inBest = new Set(best ? best.steps.map((st) => `${layerOf(best)}|${st.u}|${st.v}`) : [])
  const maxLE = Math.max(...[...uniq.values()].map((e) => e.lE))
  const dp = [...uniq.values()].map((e) => e.d).sort((a, b) => a - b)
  const med = dp.length >= 3 ? dp[dp.length >> 1] : 0
  const out = new Map<string, CstarFeatures>()
  for (const p of placements) {
    const z = p.charge
    const L = layerOf(p)
    p.steps.forEach((st, k) => {
      const r = st.readings[0]
      const lE = lEof(r.evalue)
      const d = signed(st)
      const ad = Math.abs(d)
      const key = `${L}|${st.u}|${st.v}`
      const u = uniq.get(key)!
      let rivals = 0
      let rivalBest = -Infinity
      for (const kk of [...(byU.get(`${L}|${st.u}`) ?? []), ...(byV.get(`${L}|${st.v}`) ?? [])]) {
        if (kk === key) continue
        rivals++
        rivalBest = Math.max(rivalBest, uniq.get(kk)!.lE)
      }
      const r1 = st.readings[1]
      const cu = comp1(st.u, z)
      const cv = comp1(st.v, z)
      const zu = compz(st.u, z)
      const zv = compz(st.v, z)
      const rel = Math.abs(d - med)
      // A later placement with the same key wins (as bench3's table).
      out.set(`${L}|${p.peaks.join(',')}|${k}`, {
        lE,
        abs_dppm: ad,
        dppm2: (ad / 10) ** 2,
        rank_max: Math.max(rank[st.u], rank[st.v]),
        rank_min: Math.min(rank[st.u], rank[st.v]),
        comp_any: Math.max(cu, cv),
        comp_both: Math.min(cu, cv),
        gap: r.gap ? 1 : 0,
        amb: st.readings.length > 1 ? 1 : 0,
        log_np: Math.log(n),
        compz_any: Math.max(zu, zv),
        compz_both: Math.min(zu, zv),
        lrank_max: Math.max(lrank[st.u], lrank[st.v]),
        lrank_min: Math.min(lrank[st.u], lrank[st.v]),
        amb_margin: r1 ? Math.min(3, lE - lEof(r1.evalue)) : 0,
        rival_n: Math.log1p(rivals),
        rival_margin: rivals ? Math.max(-6, Math.min(6, lE - rivalBest)) : 0,
        sup_n: Math.log(u.nplac),
        sup_rows: Math.log(u.nrows),
        rel_dppm: rel,
        rel_dppm2: (rel / 10) ** 2,
        lE_gap: Math.min(12, maxLE - lE),
        in_best: inBest.has(key) ? 1 : 0,
        lab: r.gap ? 'gap' : r.label.replace(/I/g, 'L').charAt(0)
      })
    })
  }
  return out
}

/** The C* log-odds of a step being right, from its features. */
export function cstarLogit(f: CstarFeatures): number {
  let v = CSTAR.intercept
  CSTAR.features.forEach((q, i) => {
    v += CSTAR.coef[i] * (q.startsWith('r_') ? (f.lab === q.slice(2) ? 1 : 0) : (f[q] as number))
  })
  return v
}

/** The C* logit of every step of @p placements, keyed layer|peaks|k. */
export function cstarLogits(s: SpectrumPeaks, placements: Placement[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const [k, f] of cstarFeatures(s, placements)) out.set(k, cstarLogit(f))
  return out
}

/** The cstar chain weight: the steps a placement adds, each worth its C* log-odds less @p t.
 *  @p placements are the graph's (placementsOf of the same tags). */
export function cstarWeight(s: SpectrumPeaks, placements: Placement[], t = CSTAR_THRESHOLD): (p: Placement, prev: Placement | null) => number {
  const tab = cstarLogits(s, placements)
  const L = (p: Placement, k: number): number => {
    const v = tab.get(`${layerOf(p)}|${p.peaks.join(',')}|${k}`)
    if (v === undefined) throw new Error('cstarWeight: a placement that is not among its placements')
    return v
  }
  return (p, prev) => {
    let a = 0
    for (let k = prev ? prev.peaks.length - prev.peaks.indexOf(p.peaks[0]) - 1 : 0; k < p.steps.length; k++) a += L(p, k) - t
    return a
  }
}

/** noself: the rank of the first resolved tag of @p g none of whose peaks has
 *  its own complement among its other peaks (0 when every one has; -1 without tags). */
export function noselfPick(s: SpectrumPeaks, g: TagGraph): number {
  if (g.paths.length === 0) return -1
  const selfAnti = (P: GPath): boolean =>
    P.peaks.some((a) => {
      const m = complementOf(s, a, P.charge)
      return m != null && P.peaks.some((b) => b !== a && Math.abs(s.mz[b] * P.charge - P.charge * PROTON - m) <= complementTol(s, s.mz[b]) * P.charge)
    })
  const i = g.paths.findIndex((P) => !selfAnti(P))
  return i >= 0 ? i : 0
}

/** Move resolved tag @p r of @p g to rank 1, the others after it in their order; relations and sameAs follow. */
export function promote(g: TagGraph, r: number): void {
  if (r <= 0 || r >= g.paths.length) return
  const to = (i: number): number => (i === r ? 0 : i < r ? i + 1 : i)
  for (const p of g.paths) {
    for (const x of p.relations) x.path = to(x.path)
    for (const x of p.sameAs) x.path = to(x.path)
  }
  const [p] = g.paths.splice(r, 1)
  g.paths.unshift(p)
}

/** cstar's ranking of a graph built with cstarWeight: rank 1 by noself. */
export function noselfFirst(s: SpectrumPeaks, g: TagGraph): TagGraph {
  promote(g, noselfPick(s, g))
  return g
}

/** The tag graph of @p tags ranked as FASTag's default (-resolve_score cstar,
 *  -resolve_threshold @p t): cstarWeight, then rank 1 by noself. */
export function cstarGraph(tags: TagIn[], s: SpectrumPeaks, residues: Residues, join: boolean, t = CSTAR_THRESHOLD): TagGraph {
  const weight = cstarWeight(s, placementsOf(tags, s, residues), t)
  return noselfFirst(s, buildGraph(tags, s, residues, { join, weight }))
}

/** The rankings of resolved tags (-resolve_score) the GUI implements: all of FASTag's. */
export const SCHEMES = ['cstar', 'steplogodds', 'evidence', 'anchor'] as const
export type Scheme = (typeof SCHEMES)[number]

export interface SchemeGraph {
  graph: TagGraph
  scheme: Scheme
  // The step threshold (-resolve_threshold); null under evidence, which takes none.
  threshold: number | null
  // Why the run's -resolve_score or -resolve_threshold was not taken (null: they were).
  note: string | null
}

/** The tag graph of @p tags ranked as the run ranked them, @p scheme and @p threshold
 *  being its -resolve_score and -resolve_threshold (undefined: not in the run's
 *  parameters; FASTag's defaults cstar and 3 then). As src/TagGraph.cpp weightOf:
 *  cstar is cstarGraph; steplogodds sums each added step's 1.15 log-odds less the
 *  threshold (stepWeight); evidence sums the E-value evidence; anchor is steplogodds
 *  with the placement of the lowest E-value (the first on a tie) worth 1e6 more,
 *  so the resolved tag of the best single tag comes first. */
export function schemeGraph(tags: TagIn[], s: SpectrumPeaks, residues: Residues, join: boolean, scheme?: string, threshold?: string | number): SchemeGraph {
  const notes: string[] = []
  const asked = scheme == null ? '' : String(scheme).trim()
  let sc: Scheme = 'cstar'
  if ((SCHEMES as readonly string[]).includes(asked)) sc = asked as Scheme
  else if (asked !== '') notes.push(`-resolve_score ${asked} is not a ranking the GUI knows`)
  const tRaw = threshold == null ? '' : String(threshold).trim()
  let t = CSTAR_THRESHOLD
  if (tRaw !== '') {
    if (Number.isFinite(Number(tRaw))) t = Number(tRaw)
    else notes.push(`-resolve_threshold ${tRaw} is not a number`)
  }
  const note = notes.length ? notes.join('; ') : null
  if (sc === 'cstar') return { graph: cstarGraph(tags, s, residues, join, t), scheme: sc, threshold: t, note }
  if (sc === 'evidence') return { graph: buildGraph(tags, s, residues, { join }), scheme: sc, threshold: null, note }
  const steps = stepWeight(s, t)
  if (sc === 'steplogodds') return { graph: buildGraph(tags, s, residues, { join, weight: steps }), scheme: sc, threshold: t, note }
  let anchor: Placement | null = null
  for (const p of placementsOf(tags, s, residues)) if (!anchor || (p.evalue ?? Infinity) < (anchor.evalue ?? Infinity)) anchor = p
  const at = anchor ? anchor.peaks.join(',') : null
  const weight = (p: Placement, prev: Placement | null): number => (at != null && p.peaks.join(',') === at ? 1e6 : 0) + steps(p, prev)
  return { graph: buildGraph(tags, s, residues, { join, weight }), scheme: sc, threshold: t, note }
}
