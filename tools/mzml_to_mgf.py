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
  PEPMASS      the precursor m/z as FASTag's mzML reader reads it, from the
               first <precursor> that counts as one (see below): its first
               selected ion's m/z, else its isolation window target m/z when
               that is > 0 (diaTracer writes only the target); left out when
               there is neither, as FASTag then reads m/z 0 from the mzML too
  CHARGE       its `charge state` (MS:1000041), when present, as <z>+, or as
               <|z|>- for a negative charge (FASTag's MGF reader then reads
               charge |z| in negative mode, while its mzML reader keeps -z,
               which it counts as no charge: for negative-mode spectra the
               tags and that count can differ between the two runs)
  RTINSECONDS  `scan start time` converted BY ITS UNIT (minute x 60, second x 1)
  SCANS        n, when the native ID has scan=n
  peaks        m/z and intensity as Python repr() of the float64 value: the
               shortest text that parses back to the same double, so 64-bit
               arrays survive bit for bit, and 32-bit arrays (widened to
               float64 exactly) parse back to the same float32.

A <precursor> counts as a precursor as FASTag's mzML reader decides: when it
holds a <selectedIon> (with or without m/z), or else an isolation window
target m/z > 0. An MS2 none of whose precursors counts (no precursorList, or
only a window given by its offsets, or a target of 0) has no precursor in
FASTag, which ignores it in the mzML; the converter leaves it out.

An MS2 without peaks (ddaPASEF precursors whose fragments were all filtered
out, for one) is written as a block without peak lines, which FASTag skips as
it skips the empty spectrum in the mzML. --skip-empty leaves such spectra out
instead, for readers that refuse empty blocks; the tags stay the same.

Block k (column 1, index=<k>) is the k-th block WRITTEN: it is the k-th MS2
of the mzML only when no MS2 was left out, for want of a precursor or by
--skip-empty. TITLE, the mzML native ID, is the stable key back to the mzML.
Both kinds of left-out spectra are counted on stderr.

The MGF is written to a temporary file next to the destination and renamed
onto it only when the whole mzML was converted, so a conversion that fails
partway leaves no truncated MGF behind (an older file of that name stays as
it was).

Lost: MS1, ion mobility, instrument, scan windows, activation and the
native-ID format (TITLE keeps the ID).

The mzML is read as a stream, without its index, so a missing or stale index
(diaTracer files patched after writing, say) does not matter. Derived from
the JPR harness writer fastag_bench.mgf.write_first_ms2, which always
multiplies the time by 60 (wrong for second-unit mzML) and holds every
spectrum in memory. Needs pyteomics (5.0.2 tested) and numpy.
"""
from __future__ import annotations

import os
import re
import sys
import tempfile
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


def _positive(v) -> float | None:
    """@p v as a float when it is a number > 0, else None."""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f > 0 else None


def counted_precursor(precs: list) -> dict | None:
    """The precursor FASTag's mzML reader (IndexedMzMLReader) puts first:
    it adds one Precursor per <selectedIon> of a <precursor>, and one for a
    <precursor> without a selectedIon only when its isolation window target
    m/z is > 0. So the first <precursor> with a selected ion or such a target;
    None when there is none, and FASTag then sees no precursor at all."""
    for prec in precs:
        if prec.get("selectedIonList", {}).get("selectedIon"):
            return prec
        if _positive(prec.get("isolationWindow", {}).get("isolation window target m/z")) is not None:
            return prec
    return None


def precursor_fields(prec: dict) -> tuple[float | None, int | None]:
    """The precursor m/z and charge FASTag's mzML reader reads: the first
    selected ion's m/z, else the isolation window target m/z when it is > 0;
    the charge is the first selected ion's `charge state`."""
    ions = prec.get("selectedIonList", {}).get("selectedIon", [])
    ion = ions[0] if ions else {}
    mz = ion.get("selected ion m/z")
    if mz is None:
        mz = _positive(prec.get("isolationWindow", {}).get("isolation window target m/z"))
    z = ion.get("charge state")
    return (None if mz is None else float(mz)), (None if z is None else int(z))


def charge_text(z: int) -> str:
    """MGF CHARGE value: the sign as a suffix, as MGF readers expect."""
    return f"{abs(z)}{'-' if z < 0 else '+'}"


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
    no_mz: int = 0          # MS2 whose precursor has no m/z > 0 (written without PEPMASS)


def convert(src: str, dest: str, skip_empty: bool = False) -> Counts:
    c = Counts()
    # Into a temporary file in the destination's directory, renamed onto dest
    # only once every spectrum is written: a failure partway (inconsistent
    # arrays, an unknown time unit, a damaged mzML) must not leave a truncated
    # MGF that looks valid. Only this temporary file is ever removed.
    folder = os.path.dirname(os.path.abspath(dest))
    fd, part = tempfile.mkstemp(prefix=os.path.basename(dest) + ".", suffix=".part", dir=folder)
    try:
        with mzml.read(src, use_index=False, huge_tree=True) as reader, \
                os.fdopen(fd, "w", encoding="utf-8", newline="\n") as out:
            for s in reader:
                if s.get("ms level") != 2:
                    continue
                prec = counted_precursor(s.get("precursorList", {}).get("precursor", []))
                if prec is None:
                    c.no_precursor += 1
                    continue
                mzs, its = peak_arrays(s)
                if not mzs:
                    c.empty += 1
                    if skip_empty:
                        continue
                mz, z = precursor_fields(prec)
                lines = ["BEGIN IONS", f"TITLE={s['id']}"]
                if mz is None:
                    c.no_mz += 1
                else:
                    lines.append(f"PEPMASS={mz!r}")
                if z is not None:
                    lines.append(f"CHARGE={charge_text(z)}")
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
        # mkstemp creates the file 0600; give it the mode a plain open() would.
        umask = os.umask(0)
        os.umask(umask)
        os.chmod(part, 0o666 & ~umask)
        os.replace(part, dest)
    except BaseException:
        try:
            os.unlink(part)
        except OSError:
            pass
        raise
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
              "ignores them in the mzML; index=<k> counts the blocks written", file=sys.stderr)
    if c.no_mz:
        print(f"warning: {c.no_mz} MS2 spectra have neither a selected ion m/z nor an isolation "
              "window target m/z > 0: written without PEPMASS", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
