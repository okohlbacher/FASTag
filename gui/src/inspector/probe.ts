// The output of the CLI metadata probe, `FASTag -probe_input <file>`
// (GUI-DESIGN 3 S1 and 6.7, P2b), as the GUI reads it. The GUI has no
// spectra reader of its own: everything the inspector knows about a file
// before a run comes from these lines, which FASTag prints through its own
// mzML, mzPeak and MGF readers.
//
// The flag does not exist in FASTag 1.12 (src/AcquisitionProbe.h has
// probeFile(), but no option prints it). This file is the contract the CLI
// is asked to implement; the GUI offers the probe only when `--helphelp`
// lists -probe_input (capabilities.ts), so with a CLI that lacks it nothing
// here runs and the inspector says "not checked".
//
// Contract, format 1 (see gui/README.md, "Inspector"):
//   FASTag -probe_input <file> [-acquisition_probe_spectra <n>] [-fasta <file>]
//   - reads metadata only, writes no file, needs no -in or -out;
//   - exit 0 whenever the file could be read, whatever it holds (raw DIA
//     too: the probe never refuses); a file that cannot be read exits as a
//     run would (3, 4 or 5) with the reason on stderr;
//   - stdout holds JSON lines only, one object per line, each with a
//     "record" key. The first is {"record":"probe","format":1,...}, the last
//     {"record":"end"}. Records:
//       probe        format, version, input, file_format (mzML|mzPeak|MGF)
//       instrument   name, model (CV names or null), ms2_analyzer (the CV
//                    name of the mass analyzer of the instrument
//                    configuration most MS2 spectra reference, or null),
//                    ion_mobility ("1/K0" | "drift" | "FAIMS" | null)
//       spectra      ms1, ms2 (whole file), ms2_probed, ms2_centroid,
//                    ms2_profile, ms2_type_unknown (of the probed MS2)
//       activation   of, collisional, electron, hybrid, unknown (of the
//                    probed MS2; the classes of the RunMeta activation rows)
//       index        state: ok | stale | absent | not_applicable
//       acquisition  mode (Acquisition::modeName), why (the reason of the
//                    "Acquisition check:" line), warn, refuse (true exactly
//                    when -acquisition_check refuse would exit 11), windows,
//                    median_width (as in the FASTAG_REFUSED sentinel)
//       fasta        (with -fasta only) path, proteins, decoys, decoy_affix
//   - unknown records and fields are ignored; a missing record leaves its
//     checks "not checked". A probe whose format is above PROBE_FORMAT, or
//     whose stream has no "end" record, is not used at all.

export const PROBE_FORMAT = 1

export type IndexState = 'ok' | 'stale' | 'absent' | 'not_applicable'

export interface ProbeInstrument {
  name: string | null
  model: string | null
  ms2Analyzer: string | null
  ionMobility: string | null
}

export interface ProbeSpectra {
  ms1: number | null
  ms2: number | null
  probed: number | null
  centroid: number | null
  profile: number | null
  typeUnknown: number | null
}

export interface ProbeActivation {
  of: number
  collisional: number
  electron: number
  hybrid: number
  unknown: number
}

export interface ProbeAcquisition {
  mode: string
  why: string
  warn: boolean
  refuse: boolean
  windows: number | null
  medianWidth: number | null
}

export interface ProbeFasta {
  path: string
  proteins: number | null
  decoys: number | null
  decoyAffix: string | null
}

export interface ProbeReport {
  // ok: usable. newer: a format this GUI does not read. incomplete: no end
  // record (the probe was killed, or its output cut). unreadable: no probe
  // record at all.
  status: 'ok' | 'newer' | 'incomplete' | 'unreadable'
  format: number | null
  version: string | null
  input: string | null
  fileFormat: string | null
  instrument?: ProbeInstrument
  spectra?: ProbeSpectra
  activation?: ProbeActivation
  index?: { state: IndexState }
  acquisition?: ProbeAcquisition
  fasta?: ProbeFasta
}

type Obj = Record<string, unknown>

const str = (o: Obj, k: string): string | null => (typeof o[k] === 'string' && o[k] !== '' ? (o[k] as string) : null)
const int = (o: Obj, k: string): number | null =>
  typeof o[k] === 'number' && Number.isFinite(o[k]) && (o[k] as number) >= 0 ? (o[k] as number) : null
const bool = (o: Obj, k: string): boolean => o[k] === true
const INDEX: readonly IndexState[] = ['ok', 'stale', 'absent', 'not_applicable']

/// Parse the probe's stdout. Never throws: a line that is not a JSON object
/// is skipped, as is a record this format does not know.
export function parseProbe(stdout: string): ProbeReport {
  const r: ProbeReport = { status: 'unreadable', format: null, version: null, input: null, fileFormat: null }
  let ended = false
  for (const line of stdout.split(/\r?\n/)) {
    const t = line.trim()
    if (!t.startsWith('{')) continue
    let o: Obj
    try {
      const v: unknown = JSON.parse(t)
      if (!v || typeof v !== 'object' || Array.isArray(v)) continue
      o = v as Obj
    } catch {
      continue
    }
    switch (o.record) {
      case 'probe':
        r.format = int(o, 'format')
        r.version = str(o, 'version')
        r.input = str(o, 'input')
        r.fileFormat = str(o, 'file_format')
        break
      case 'instrument':
        r.instrument = { name: str(o, 'name'), model: str(o, 'model'), ms2Analyzer: str(o, 'ms2_analyzer'), ionMobility: str(o, 'ion_mobility') }
        break
      case 'spectra':
        r.spectra = {
          ms1: int(o, 'ms1'),
          ms2: int(o, 'ms2'),
          probed: int(o, 'ms2_probed'),
          centroid: int(o, 'ms2_centroid'),
          profile: int(o, 'ms2_profile'),
          typeUnknown: int(o, 'ms2_type_unknown')
        }
        break
      case 'activation': {
        const of = int(o, 'of')
        if (of != null)
          r.activation = {
            of,
            collisional: int(o, 'collisional') ?? 0,
            electron: int(o, 'electron') ?? 0,
            hybrid: int(o, 'hybrid') ?? 0,
            unknown: int(o, 'unknown') ?? 0
          }
        break
      }
      case 'index': {
        const s = str(o, 'state') as IndexState | null
        if (s && INDEX.includes(s)) r.index = { state: s }
        break
      }
      case 'acquisition': {
        const mode = str(o, 'mode')
        if (mode)
          r.acquisition = {
            mode,
            why: str(o, 'why') ?? '',
            warn: bool(o, 'warn'),
            refuse: bool(o, 'refuse'),
            windows: int(o, 'windows'),
            medianWidth: typeof o.median_width === 'number' ? o.median_width : null
          }
        break
      }
      case 'fasta':
        r.fasta = { path: str(o, 'path') ?? '', proteins: int(o, 'proteins'), decoys: int(o, 'decoys'), decoyAffix: str(o, 'decoy_affix') }
        break
      case 'end':
        ended = true
        break
    }
  }
  if (r.format == null) return { ...r, status: 'unreadable' }
  if (r.format > PROBE_FORMAT) return { ...r, status: 'newer' }
  return { ...r, status: ended ? 'ok' : 'incomplete' }
}
