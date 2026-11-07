// The one parser of `FASTag -dump_spectrum <nativeId>` output (GUI-DESIGN
// 6.7, P4). The backend (spectrum.rs spectrum_peaks) only runs the CLI and
// hands its stdout over; every field is read here, so a change of the CLI's
// JSON is a change of this file.
//
// The contract (README "Probe and spectrum dump", feat/g1-gui-cli-additions
// InputProbe.cpp spectrumRecord): JSON lines, each an object with a `record`
// key; one `spectrum` record (format 1) and `{"record":"end"}` last, so a cut
// stream is detectable. Readers ignore records and fields they do not know.
// The spectrum record carries `mz` and `int`, the peaks after the reader's
// centroiding, the precursor cut, the m/z collapse, deisotoping and the peak
// budget, exactly as the tagger prepares them under the options given; and
// native_id, index, ms_level, rt, precursor (null without one), charge (as
// tagged: 2 for an uncharged precursor), charge_given, tolerance,
// tolerance_unit (ppm or Da), picked, deisotoped, tagged, n_read and n.

export interface SpectrumPeaks {
  nativeId: string
  index: number
  msLevel: number
  rt: number | null
  precursor: number | null
  // As tagged (an uncharged precursor is tagged as 2+).
  charge: number
  // 0: the file gave none.
  chargeGiven: number
  tolerance: number
  toleranceUnit: 'ppm' | 'Da'
  picked: boolean
  deisotoped: boolean
  tagged: boolean
  // Peaks read before preprocessing.
  nRead: number
  // Strictly ascending.
  mz: number[]
  int: number[]
}

export type DumpResult = { ok: true; spectrum: SpectrumPeaks } | { ok: false; error: string }

const DUMP_FORMAT = 1

type Obj = Record<string, unknown>

class Bad extends Error {}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function field<T>(o: Obj, key: string, ok: (v: unknown) => v is T, what: string): T {
  const v = o[key]
  if (!ok(v)) throw new Bad(`the spectrum record's ${key} is not ${what}`)
  return v
}
const count = (v: unknown): v is number => isNum(v) && Number.isInteger(v) && v >= 0
const bool = (v: unknown): v is boolean => typeof v === 'boolean'
const str = (v: unknown): v is string => typeof v === 'string'

function numbers(o: Obj, key: string): number[] {
  const v = o[key]
  if (!Array.isArray(v)) throw new Bad(`the spectrum record's ${key} is not a list`)
  for (const x of v) if (!isNum(x)) throw new Bad(`a peak in ${key} is not a finite number`)
  return v as number[]
}

/** The JSON lines of one dump in @p text, the spectrum record read. */
export function parseDump(text: string): DumpResult {
  try {
    const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '')
    if (lines.length === 0) throw new Bad('the dump is empty')
    const recs: Obj[] = lines.map((l, i) => {
      let o: unknown
      try {
        o = JSON.parse(l)
      } catch {
        throw new Bad(`line ${i + 1} of the dump is not JSON`)
      }
      if (o === null || typeof o !== 'object' || Array.isArray(o) || typeof (o as Obj).record !== 'string') {
        throw new Bad(`line ${i + 1} of the dump is not a record`)
      }
      return o as Obj
    })
    if (recs[recs.length - 1].record !== 'end') throw new Bad('the dump has no end record: it was cut')
    const specs = recs.filter((r) => r.record === 'spectrum')
    if (specs.length === 0) throw new Bad('the dump has no spectrum record')
    if (specs.length > 1) throw new Bad(`the dump has ${specs.length} spectrum records`)
    const s = specs[0]
    if (s.format !== DUMP_FORMAT) throw new Bad(`the dump is format ${String(s.format)}; this FASTag reads format ${DUMP_FORMAT}`)
    const tolerance = field(s, 'tolerance', isNum, 'a number')
    if (!(tolerance > 0)) throw new Bad("the spectrum record's tolerance is not above 0")
    const unit = s.tolerance_unit
    if (unit !== 'ppm' && unit !== 'Da') throw new Bad(`the spectrum record's tolerance_unit is ${JSON.stringify(unit)}`)
    const mz = numbers(s, 'mz')
    const int = numbers(s, 'int')
    const n = field(s, 'n', count, 'a count')
    if (mz.length !== int.length || mz.length !== n) throw new Bad('mz and int do not hold n peaks each')
    for (let i = 1; i < mz.length; i++) if (!(mz[i] > mz[i - 1])) throw new Bad('the peaks are not in ascending m/z')
    const prec = s.precursor
    if (prec !== null && !isNum(prec)) throw new Bad("the spectrum record's precursor is not a number")
    const rt = s.rt
    return {
      ok: true,
      spectrum: {
        nativeId: field(s, 'native_id', str, 'text'),
        index: field(s, 'index', count, 'a count'),
        msLevel: field(s, 'ms_level', count, 'a count'),
        rt: isNum(rt) ? rt : null,
        precursor: prec,
        charge: field(s, 'charge', count, 'a count'),
        chargeGiven: field(s, 'charge_given', count, 'a count'),
        tolerance,
        toleranceUnit: unit,
        picked: field(s, 'picked', bool, 'true or false'),
        deisotoped: field(s, 'deisotoped', bool, 'true or false'),
        tagged: field(s, 'tagged', bool, 'true or false'),
        nRead: field(s, 'n_read', count, 'a count'),
        mz,
        int
      }
    }
  } catch (e) {
    if (e instanceof Bad) return { ok: false, error: e.message }
    throw e
  }
}

/** Several dumps written one after another (the fixtures): one text each. */
export function splitDumps(text: string): string[] {
  const out: string[] = []
  let cur = ''
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    cur += line + '\n'
    if (/^\s*\{\s*"record"\s*:\s*"end"/.test(line)) {
      out.push(cur)
      cur = ''
    }
  }
  if (cur) out.push(cur)
  return out
}
