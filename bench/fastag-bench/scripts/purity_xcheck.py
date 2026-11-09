#!/usr/bin/env python3
"""Cross-check of realchimera.precursor_purity against pyopenms (1.13 item 12).

Two modes, so that each half runs in the environment that has its library:

    python purity_xcheck.py openms <run.mzML> <out.tsv> [tol_ppm]
        pyopenms: PrecursorPurity.computePrecursorPurity on every MS2 spectrum's preceding MS1 spectrum
        (as PrecursorPurity::computePrecursorPurities picks it); columns key, openms_purity, openms_total,
        openms_target, openms_version.
    python purity_xcheck.py compare <purity.tsv> <openms.tsv> <out.tsv>
        joins a realchimera purity table (center as computed there) with the openms table and writes the
        agreement summary: n, n_equal (|diff| <= 1e-9), max_abs_diff, share_equal; prints it.
"""
from __future__ import annotations

import sys
from pathlib import Path


def run_openms(mzml: str, out: str, tol_ppm: float = 10.0) -> None:
    import re

    import pyopenms as oms

    exp = oms.MSExperiment()
    oms.MzMLFile().load(mzml, exp)
    rows = []
    last_ms1 = None
    for s in exp:
        if s.getMSLevel() == 1:
            last_ms1 = s
            continue
        if s.getMSLevel() != 2 or last_ms1 is None or not s.getPrecursors():
            continue
        m = re.search(r"scan=(\d+)", s.getNativeID())
        key = f"scan={m.group(1)}" if m else s.getNativeID()
        sc = oms.PrecursorPurity().computePrecursorPurity(last_ms1, s.getPrecursors()[0], tol_ppm, True)
        rows.append(f"{key}\t{sc.signal_proportion!r}\t{sc.total_intensity!r}\t{sc.target_intensity!r}\t{oms.__version__}")
    Path(out).write_text("key\topenms_purity\topenms_total\topenms_target\topenms_version\n" + "\n".join(rows) + "\n")


def compare(purity: str, openms: str, out: str) -> None:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
    import numpy as np
    import pandas as pd

    from fastag_bench.tsv import read_tsv, write_tsv

    a, prov = read_tsv(purity)
    b = pd.read_csv(openms, sep="\t")
    m = a.merge(b, on="key", how="inner")
    m = m[m["purity"].notna()]
    d = (m["purity"] - m["openms_purity"]).abs()
    dt = (m["purity_total"] - m["openms_total"]).abs() / m["openms_total"].clip(lower=1e-12)
    s = pd.DataFrame([{"n_ms2_purity": int(a["purity"].notna().sum()), "n_joined": len(m),
                       "n_equal": int((d <= 1e-9).sum()), "share_equal": float((d <= 1e-9).mean()) if len(m) else np.nan,
                       "max_abs_diff": float(d.max()) if len(m) else np.nan,
                       "n_total_rel_diff_gt_1e-6": int((dt > 1e-6).sum()),
                       "openms_version": str(b["openms_version"].iloc[0]) if len(b) else ""}])
    write_tsv(s, out, [f"purity: {purity} ({'; '.join(prov)})", f"openms: {openms}"])
    print(s.to_string(index=False))


if __name__ == "__main__":
    if len(sys.argv) >= 4 and sys.argv[1] == "openms":
        run_openms(sys.argv[2], sys.argv[3], float(sys.argv[4]) if len(sys.argv) > 4 else 10.0)
    elif len(sys.argv) == 5 and sys.argv[1] == "compare":
        compare(sys.argv[2], sys.argv[3], sys.argv[4])
    else:
        sys.exit(__doc__)
