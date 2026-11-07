"""Write the first N MS2 spectra of an mzML as MGF (needs the optional pyteomics)."""
from __future__ import annotations

import re
from pathlib import Path

from pyteomics import mgf, mzml

# Seconds per unit of 'scan start time' (MS:1000016), by unitName or unitAccession as pyteomics reports it.
_RT_UNIT_SECONDS = {"second": 1.0, "UO:0000010": 1.0, "minute": 60.0, "UO:0000031": 60.0}


def rt_seconds(scan: dict) -> float:
    """Scan start time of one mzML <scan> in seconds, converted by its declared unit.

    A missing scan start time gives 0 (as before). A value without a unit, or with a unit other than
    second (UO:0000010) or minute (UO:0000031), raises ValueError instead of being guessed."""
    rt = scan.get("scan start time")
    if rt is None:
        return 0.0
    unit = getattr(rt, "unit_info", None)
    if unit not in _RT_UNIT_SECONDS:
        raise ValueError(f"scan start time {float(rt)!r} has unit {unit!r}; expected second or minute")
    return float(rt) * _RT_UNIT_SECONDS[unit]


def _mgf_entry(s: dict) -> dict:
    prec = s["precursorList"]["precursor"][0]["selectedIonList"]["selectedIon"][0]
    params = {"title": s["id"], "pepmass": prec["selected ion m/z"],
              "rtinseconds": rt_seconds(s["scanList"]["scan"][0])}
    m = re.search(r"scan=(\d+)", s["id"])
    if m:
        params["scans"] = m.group(1)
    if "charge state" in prec:
        params["charge"] = f"{int(prec['charge state'])}+"
    return {"m/z array": s["m/z array"], "intensity array": s["intensity array"], "params": params}


def write_first_ms2(src: Path, dest: Path, n: int) -> Path:
    out = []
    with mzml.read(str(src)) as reader:
        for s in reader:
            if s.get("ms level") != 2:
                continue
            out.append(_mgf_entry(s))
            if len(out) >= n:
                break
    mgf.write(out, str(dest))
    return dest


def write_ms2_subsample(src: Path, dest: Path, n: int, seed: int) -> Path:
    """Write a fixed-seed random subsample of n MS2 spectra (file order kept) as MGF.

    Two passes: count MS2 spectra, draw n indices with numpy.random.default_rng(seed), then write
    those spectra. With n >= the MS2 count every spectrum is written."""
    import numpy as np

    with mzml.read(str(src)) as reader:
        total = sum(1 for s in reader if s.get("ms level") == 2)
    keep = set(range(total)) if n >= total else set(np.random.default_rng(seed).choice(total, n, replace=False).tolist())
    out, i = [], -1
    with mzml.read(str(src)) as reader:
        for s in reader:
            if s.get("ms level") != 2:
                continue
            i += 1
            if i in keep:
                out.append(_mgf_entry(s))
    mgf.write(out, str(dest))
    return dest
