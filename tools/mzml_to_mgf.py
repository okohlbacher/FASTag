#!/usr/bin/env python3
"""Write the MS2 spectra of an mzML as MGF, losslessly for what FASTag reads.

    mzml_to_mgf.py in.mzML out.mgf

FASTag on the result gives the same tags as FASTag on the mzML (README, MGF):
the tags, recon, delta, glyco and species TSVs are byte-identical once column 1
(the spectrum id, index=<k> for the k-th MS2 against the mzML native ID) is
removed; the digest, label and massgap reports differ only in the input's name
and the digest's metadata rows.

What is written per MS2, in file order:
  TITLE        the mzML native ID
  PEPMASS      the first precursor's selected ion m/z (as the mzML stores it)
  CHARGE       its `charge state` (MS:1000041), when present, as <z>+
  RTINSECONDS  `scan start time` converted BY ITS UNIT (minute x 60, second x 1)
  SCANS        n, when the native ID has scan=n
  peaks        m/z and intensity as Python repr() of the float64 value: the
               shortest text that parses back to the same double, so 64-bit
               arrays survive bit for bit, and 32-bit arrays (widened to
               float64 exactly) parse back to the same float32.

Lost: MS1, ion mobility, instrument, scan windows, activation and the
native-ID format (TITLE keeps the ID). An MS2 without a selected ion m/z
(diaTracer pseudo-spectra, say) is an error, not a silent difference.

Derived from the JPR harness writer fastag_bench.mgf.write_first_ms2, which
always multiplies the time by 60 (wrong for second-unit mzML) and holds every
spectrum in memory; this one streams. Needs pyteomics (5.0.2 tested) and numpy.
"""
from __future__ import annotations

import re
import sys

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


def convert(src: str, dest: str) -> int:
    n = 0
    with mzml.read(src) as reader, open(dest, "w", encoding="utf-8", newline="\n") as out:
        for s in reader:
            if s.get("ms level") != 2:
                continue
            try:
                prec = s["precursorList"]["precursor"][0]["selectedIonList"]["selectedIon"][0]
                mz = prec["selected ion m/z"]
            except (KeyError, IndexError):
                raise SystemExit(f"{src}: MS2 {s['id']!r} has no selected ion m/z; "
                                 "FASTag reads the precursor from it, so this file cannot be converted")
            lines = ["BEGIN IONS", f"TITLE={s['id']}", f"PEPMASS={float(mz)!r}"]
            if "charge state" in prec:
                lines.append(f"CHARGE={int(prec['charge state'])}+")
            rt = rt_seconds(s["scanList"]["scan"][0])
            if rt is not None:
                lines.append(f"RTINSECONDS={rt!r}")
            m = re.search(r"scan=(\d+)", s["id"])
            if m:
                lines.append(f"SCANS={m.group(1)}")
            mzs = s["m/z array"].astype("float64").tolist()
            its = s["intensity array"].astype("float64").tolist()
            lines.extend(f"{a!r} {b!r}" for a, b in zip(mzs, its))
            lines.append("END IONS")
            out.write("\n".join(lines) + "\n\n")
            n += 1
    return n


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__.split("\n\n")[1])
    print(f"{convert(sys.argv[1], sys.argv[2])} MS2 spectra written to {sys.argv[2]}", file=sys.stderr)
