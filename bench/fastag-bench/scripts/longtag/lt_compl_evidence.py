#!/usr/bin/env python3
"""Complement evidence of correct and incorrect tags by precursor charge and fragment charge, from diagnostic runs
with FASTAG_DIAG_PVALS=1 (columns nc = complemented tag peaks, K = complemented peaks in the spectrum at that
fragment charge, N = kept peaks).
usage: lt_compl_evidence.py HARNESS_SRC DISC_TSV SAGE_TSV OUT_TSV name=pvals_tags.tsv ..."""
import sys

import pandas as pd

sys.path.insert(0, sys.argv[1])
from fastag_bench import parsers as P  # noqa: E402
from fastag_bench import score as S  # noqa: E402

discp, sagep, outp = sys.argv[2:5]
disc = pd.read_csv(discp, sep="\t").set_index("key")
psms = P.read_sage_psms(sagep, 0.01)
rows = []
for name, path in (a.split("=", 1) for a in sys.argv[5:]):
    t = P.read_fastag_tags(path)
    t = t[t["key"].isin(disc.index)].reset_index(drop=True)
    parsed = pd.DataFrame([dict(x.split("=") for x in v.split(";")) for v in t["fasta_hit"]]).astype(float)
    t = pd.concat([t, parsed], axis=1)
    m = S._mark(t, psms, "flank")
    m["prec_charge"] = m["key"].map(disc["prec_charge"]).clip(upper=4)
    m["k"] = 4  # tag length 3 = 4 peaks
    for (zc, z, ok), g in m.groupby(["prec_charge", "charge", "correct"]):
        if z > 2 or len(g) < 50:
            continue
        rows.append({"run": name, "prec_charge": ("4+" if zc == 4 else int(zc)), "fragment_charge": int(z),
                     "tag_correct": bool(ok), "tags": len(g),
                     "complemented_tag_peaks_mean": round(float(g["nc"].mean()), 3),
                     "share_tags_with_complement_pct": round(100 * float((g["nc"] > 0).mean()), 1),
                     "complemented_peak_share_spectrum_pct": round(100 * float((g["K"] / g["N"]).mean()), 2)})
out = pd.DataFrame(rows)
out.to_csv(outp, sep="\t", index=False)
pd.set_option("display.width", 220)
print(out.to_string())
