#!/usr/bin/env python3
"""Write the MS2 spectra of an mzML as MGF, losslessly for what FASTag reads.

    mzml_to_mgf.py [--skip-empty] in.mzML out.mgf

FASTag on the result gives the same tags as FASTag on the mzML (README, MGF):
the tags, recon, delta, glyco and species TSVs are byte-identical once column 1
(the spectrum id, index=<k> for the k-th block against the mzML native ID) is
removed; the digest, label and massgap reports differ only in the input's name
and the digest's metadata rows.

What is written per MS2, in file order:
  TITLE        the mzML native ID
  PEPMASS      the precursor m/z as OpenMS reads it: the first precursor's
               selected ion m/z, else its isolation window target m/z
               (diaTracer writes only the latter); left out when there is
               neither, as FASTag then reads m/z 0 from the mzML too
  CHARGE       its `charge state` (MS:1000041), when present, as <z>+
  RTINSECONDS  `scan start time` converted BY ITS UNIT (minute x 60, second x 1)
  SCANS        n, when the native ID has scan=n
  peaks        m/z and intensity as Python repr() of the float64 value: the
               shortest text that parses back to the same double, so 64-bit
               arrays survive bit for bit, and 32-bit arrays (widened to
               float64 exactly) parse back to the same float32.

An MS2 without peaks (ddaPASEF precursors whose fragments were all filtered
out, for one) is written as a block without peak lines, which FASTag skips as
it skips the empty spectrum in the mzML; so block k stays the k-th MS2 of the
mzML. --skip-empty leaves such spectra out instead, for readers that refuse
empty blocks; the tags stay the same, but the block numbers (column 1) then
count only the spectra with peaks. An MS2 without any precursor is left out,
as FASTag ignores it in the mzML. Both are counted on stderr.

Lost: MS1, ion mobility, instrument, scan windows, activation and the
native-ID format (TITLE keeps the ID).

The mzML is read as a stream, without its index, so a missing or stale index
(diaTracer files patched after writing, say) does not matter. Derived from
the JPR harness writer fastag_bench.mgf.write_first_ms2, which always
multiplies the time by 60 (wrong for second-unit mzML) and holds every
spectrum in memory. Needs pyteomics (5.0.2 tested) and numpy.
"""
from __future__ import annotations

import re
import sys
from dataclasses import dataclass

from pyteomics import mzml


def rt_seconds(scan: dict) -> float | None:
    t = scan.get("scan start time")
    if t is None:
        return None
    unit = getattr(t, "unit_info", None)
    if unit in (None, "second", "s", "UO:0000010"):
        return float(t)
    if unit in ("minute", "min", "UO:0000031"):
        return float(t) * 60.0
    raise SystemExit(f"scan start time in an unknown unit: {unit!r}")


def precursor_fields(prec: dict) -> tuple[float | None, int | None]:
    """The precursor m/z and charge OpenMS's MzMLHandler reads: the first
    selected ion's m/z overrides the isolation window target m/z; the charge
    is the first selected ion's `charge state`."""
    ions = prec.get("selectedIonList", {}).get("selectedIon", [])
    ion = ions[0] if ions else {}
    mz = ion.get("selected ion m/z")
    if mz is None:
        mz = prec.get("isolationWindow", {}).get("isolation window target m/z")
    z = ion.get("charge state")
    return (None if mz is None else float(mz)), (None if z is None else int(z))


def peak_arrays(s: dict) -> tuple[list[float], list[float]]:
    """m/z and intensity as float64 lists; empty when the spectrum has no
    peaks, however the mzML says so (no binaryDataArrayList, arrays of length
    0, or arrays left out)."""
    mz, it = s.get("m/z array"), s.get("intensity array")
    n_mz = 0 if mz is None else len(mz)
    n_it = 0 if it is None else len(it)
    if n_mz != n_it:
        raise SystemExit(f"MS2 {s['id']!r} has {n_mz} m/z and {n_it} intensity values; "
                         "they must pair up")
    if n_mz == 0:
        return [], []
    return mz.astype("float64").tolist(), it.astype("float64").tolist()


@dataclass
class Counts:
    written: int = 0
    empty: int = 0          # MS2 without peaks (written as empty blocks, or skipped)
    no_precursor: int = 0   # MS2 without any precursor (skipped)
    no_mz: int = 0          # MS2 whose precursor has no m/z (written without PEPMASS)


def convert(src: str, dest: str, skip_empty: bool = False) -> Counts:
    c = Counts()
    with mzml.read(src, use_index=False, huge_tree=True) as reader, \
            open(dest, "w", encoding="utf-8", newline="\n") as out:
        for s in reader:
            if s.get("ms level") != 2:
                continue
            precs = s.get("precursorList", {}).get("precursor", [])
            if not precs:
                c.no_precursor += 1
                continue
            mzs, its = peak_arrays(s)
            if not mzs:
                c.empty += 1
                if skip_empty:
                    continue
            mz, z = precursor_fields(precs[0])
            lines = ["BEGIN IONS", f"TITLE={s['id']}"]
            if mz is None:
                c.no_mz += 1
            else:
                lines.append(f"PEPMASS={mz!r}")
            if z is not None:
                lines.append(f"CHARGE={z}+")
            scans = s.get("scanList", {}).get("scan", [])
            rt = rt_seconds(scans[0]) if scans else None
            if rt is not None:
                lines.append(f"RTINSECONDS={rt!r}")
            m = re.search(r"scan=(\d+)", s["id"])
            if m:
                lines.append(f"SCANS={m.group(1)}")
            lines.extend(f"{a!r} {b!r}" for a, b in zip(mzs, its))
            lines.append("END IONS")
            out.write("\n".join(lines) + "\n\n")
            c.written += 1
    return c


def main(argv: list[str]) -> int:
    args = [a for a in argv if a != "--skip-empty"]
    if len(args) != 2 or any(a.startswith("-") for a in args):
        sys.exit(__doc__.split("\n\n")[1])
    src, dest = args
    skip = len(args) != len(argv)
    c = convert(src, dest, skip)
    print(f"{c.written} MS2 spectra written to {dest}", file=sys.stderr)
    if c.empty:
        what = "left out (--skip-empty)" if skip else "written as blocks without peaks"
        print(f"warning: {c.empty} MS2 spectra have no peaks: {what}", file=sys.stderr)
    if c.no_precursor:
        print(f"warning: {c.no_precursor} MS2 spectra have no precursor: left out, as FASTag "
              "ignores them in the mzML", file=sys.stderr)
    if c.no_mz:
        print(f"warning: {c.no_mz} MS2 spectra have neither a selected ion m/z nor an isolation "
              "window target m/z: written without PEPMASS", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
