// Which instrument preset (setup/presets.ts) an instrument suggests, from
// what the CLI says about it: the probe's instrument record before a run
// (probe.ts), the digest report's `meta instrument` and `meta
// instrument_model` rows after one (DigestReport.cpp). The GUI reads no
// spectra file for this.
//
// The analyser of the MS2 decides where the CLI names it (the probe's
// ms2_analyzer). The rows of the digest report name only the instrument, so
// a hybrid whose MS2 may be read in either analyser (LTQ Orbitrap, Orbitrap
// Elite, the Tribrids) stays undecided unless the run's log says more
// (checks.ts).

import { value, type Report } from '../digestReport'

export type Family = 'ion-trap' | 'hybrid-ion-trap' | 'orbitrap' | 'astral' | 'timstof' | 'tof' | 'unknown'

export interface InstrumentFacts {
  name?: string | null
  model?: string | null
  ms2Analyzer?: string | null
  ionMobility?: string | null
}

// The CLI writes '-' for a row whose metadata are absent.
const named = (s: string | null | undefined): string => (s && s !== '-' ? s : '')

/// The family of an instrument, for its preset.
export function familyOf(f: InstrumentFacts): Family {
  const text = `${named(f.name)} ${named(f.model)}`
  const a = named(f.ms2Analyzer).toLowerCase()
  if (a) {
    if (/ion trap/.test(a)) return 'ion-trap'
    if (/astral/.test(a) || (/orbitrap/.test(a) && /astral/i.test(text))) return 'astral'
    if (/orbitrap|fourier transform/.test(a)) return 'orbitrap'
    if (/time-of-flight|\btof\b/.test(a)) return f.ionMobility === '1/K0' || /timstof/i.test(text) ? 'timstof' : 'tof'
  }
  if (!text.trim()) return 'unknown'
  if (/astral/i.test(text)) return 'astral'
  if (/tims\s*tof/i.test(text)) return 'timstof'
  const orbitrap = /orbitrap/i.test(text)
  // Hybrids with a linear ion trap: MS2 in either analyser.
  if (orbitrap && /\b(LTQ|Velos|Elite|Fusion|Lumos|Eclipse|Tribrid|Ascend)\b/i.test(text)) return 'hybrid-ion-trap'
  if (orbitrap || /exactive|exploris/i.test(text)) return 'orbitrap'
  if (/\b(LTQ|LCQ|Velos Pro|amaZon|HCT|esquire)\b|ion trap/i.test(text)) return 'ion-trap'
  if (/TOF|Synapt|impact|maXis|Xevo/i.test(text)) return 'tof'
  return 'unknown'
}

/// The preset a family proposes (setup/presets.ts ids), or null: a hybrid
/// or a plain TOF proposes none.
export function presetFor(f: Family): string | null {
  switch (f) {
    case 'ion-trap':
      return 'iontrap-cid'
    case 'orbitrap':
      return 'orbitrap-hcd'
    case 'astral':
      return 'astral'
    case 'timstof':
      return 'timstof'
    default:
      return null
  }
}

/// "LTQ Orbitrap XL", "Q Exactive (model …)", or null when nothing is named.
export function instrumentText(f: InstrumentFacts): string | null {
  const n = named(f.name)
  const m = named(f.model)
  if (n && m && n !== m) return `${n} (${m})`
  return n || m || null
}

/// The instrument the reports of a run name (the digest report's meta rows),
/// or null when no report names one.
export function instrumentFromReports(reports: Report[]): (InstrumentFacts & { family: Family; text: string; report: string }) | null {
  for (const r of reports) {
    const facts = { name: value(r, 'meta', 'instrument') ?? null, model: value(r, 'meta', 'instrument_model') ?? null }
    const text = instrumentText(facts)
    if (text) return { ...facts, family: familyOf(facts), text, report: r.path }
  }
  return null
}
