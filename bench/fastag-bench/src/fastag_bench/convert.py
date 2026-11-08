"""raw -> mzML (ThermoRawFileParser) and mzML -> mzPeak (mzpeak-convert).

Thermo .raw: `ThermoRawFileParser -i <raw> -o <dir> -f 2 -L 1-2` (indexed mzML, vendor
centroiding, MS1 and MS2), the call used for the mzML files of this study (TRFP 2.0.0 on node
data). A re-conversion with another TRFP version can differ in bytes; the harness reports a
sha256 mismatch as a warning, not an error.

Bruker .d (PXD054073, PXD028735, PXD047793) is not converted automatically: the archives are
large (3-22 GB) and the mzML files of this study came from different routes (see each file's
'conversion' note in datasets.yaml).
"""
from __future__ import annotations

import shutil
from pathlib import Path

from .config import Dataset
from .fetch import file_digest
from .timing import run_timed


def trfp_command(exe: str, raw: Path, out_dir: Path) -> list[str]:
    return [exe, "-i", str(raw), "-o", str(out_dir), "-f", "2", "-L", "1-2"]


def mzpeak_command(exe: str, mzml: Path, out: Path, layout: str) -> list[str]:
    return [exe, "--layout", layout, "-f", "-o", str(out), str(mzml)]


def convert_dataset(ds: Dataset, data_dir: str | Path, tools: dict, dry_run: bool = False, log=print) -> list[dict]:
    rows = []
    base = Path(data_dir) / ds.pxd
    for f in ds.files:
        if not f.derived_from:
            continue
        dest = base / f.name
        src = base / f.derived_from
        row = {"dataset": ds.id, "file": f.name, "from": f.derived_from, "conversion": f.conversion or ""}
        if dest.exists():
            row["status"] = "present"
            rows.append(row)
            continue
        conv = (f.conversion or "").split()[0] if f.conversion else ""
        if conv == "trfp":
            exe = shutil.which(tools.get("thermorawfileparser", "ThermoRawFileParser"))
            cmd = trfp_command(exe or "ThermoRawFileParser", src, base)
        elif conv.startswith("mzpeak-convert"):
            exe = shutil.which(tools.get("mzpeak_convert", "mzpeak-convert"))
            layout = "point" if ".point." in f.name else "chunked"
            src = base / f.derived_from
            cmd = mzpeak_command(exe or "mzpeak-convert", src, dest, layout)
        else:
            row["status"] = f"manual: {f.conversion or 'no conversion recipe'}"
            rows.append(row)
            log(f"{ds.pxd} {f.name}: {row['status']}")
            continue
        if not src.exists():
            row["status"] = f"missing input {src.name} (run fetch first)"
        elif exe is None:
            row["status"] = f"skipped: {cmd[0]} not found on PATH"
        elif dry_run:
            row["status"] = "would run: " + " ".join(cmd)
        else:
            t = run_timed(cmd, log=base / f"{f.name}.convert.log")
            row.update(t)
            if t["returncode"] != 0 or not dest.exists():
                row["status"] = "FAILED (see log)"
            elif f.sha256 and file_digest(dest, "sha256") != f.sha256:
                row["status"] = "converted; sha256 differs from the study file (converter version?)"
            else:
                row["status"] = "converted"
        rows.append(row)
        log(f"{ds.pxd} {f.name}: {row['status']}")
    return rows


def filter_mgf_precursors(src: str | Path, dst: str | Path) -> tuple[int, int]:
    """Copy an MGF, dropping spectra without a usable precursor (PEPMASS nan/missing or CHARGE 0).

    AlphaTims' ddaPASEF MGF export writes 'PEPMASS=nan' and 'CHARGE=0' for precursors whose
    monoisotopic peak Bruker's precursor detection did not assign; Sage aborts on such spectra
    ('missing MS1 precursor') and no database search can use them, so every tool gets the same
    filtered set. Returns (kept, dropped)."""
    kept = dropped = 0
    block: list[str] = []
    with open(src) as fi, open(dst, "w") as fo:
        for line in fi:
            if line.startswith("BEGIN IONS"):
                block = [line]
                continue
            if block:
                block.append(line)
                if line.startswith("END IONS"):
                    head = {l.split("=", 1)[0]: l.split("=", 1)[1].strip() for l in block if "=" in l}
                    pm = head.get("PEPMASS", "nan").split()[0].lower()
                    ok = pm not in ("nan", "") and head.get("CHARGE", "0").rstrip("+-") not in ("0", "")
                    if ok:
                        fo.writelines(block)
                        kept += 1
                    else:
                        dropped += 1
                    block = []
            else:
                fo.write(line)
    return kept, dropped
