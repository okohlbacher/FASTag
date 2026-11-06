#!/usr/bin/env python3
"""FASTag's own p-values (diagnostic build, FASTAG_DIAG_PVALS=1) for the DirecTag-only spectra: FASTag's incorrect
rank-1 tag against FASTag's highest-ranked correct tag in the same spectrum.
usage: lt_pvals.py HARNESS_SRC DISC_TSV SAGE_TSV PVALS_TAGS OUT_TSV LABEL"""
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, sys.argv[1])
from fastag_bench import parsers as P  # noqa: E402
from fastag_bench import score as S  # noqa: E402

discp, sagep, tagp, outp, label = sys.argv[2:7]
disc = pd.read_csv(discp, sep="\t")
psms = P.read_sage_psms(sagep, 0.01)
t = P.read_fastag_tags(tagp)
kv = t["fasta_hit"].str.split(";", expand=False)
parsed = pd.DataFrame([dict(x.split("=") for x in v) for v in kv]).astype(float)
t = pd.concat([t.reset_index(drop=True), parsed], axis=1)
m = S._mark(t, psms, "flank")

rows = []
for subset, sel in (("directag_only", (disc.ft_top1 == 0) & (disc.dt_top1 == 1)),
                    ("fastag_only", (disc.ft_top1 == 1) & (disc.dt_top1 == 0)),
                    ("both_correct", (disc.ft_top1 == 1) & (disc.dt_top1 == 1))):
    keys = set(disc.loc[sel, "key"])
    g = m[m["key"].isin(keys)]
    top = g[g["rank"] == 1].set_index("key")
    cor = g[g["correct"]].sort_values("rank").drop_duplicates("key").set_index("key")
    if subset == "both_correct":
        # second-ranked incorrect tag as the comparison partner
        wrong = g[~g["correct"]].sort_values("rank").drop_duplicates("key").set_index("key")
        a, b = cor, wrong
    else:
        a, b = cor, top
    k = a.index.intersection(b.index)
    a, b = a.loc[k], b.loc[k]
    rec = {"label": label, "subset": subset, "n": len(k)}
    for comp in ("pI", "pM", "pC"):
        r = np.log10(a[comp].clip(lower=1e-300)) - np.log10(b[comp].clip(lower=1e-300))
        rec[f"{comp}_median_log10_correct_minus_other"] = round(float(r.median()), 3)
        rec[f"{comp}_pct_correct_better"] = round(100 * float((r < 0).mean()), 1)
        rec[f"{comp}_pct_correct_worse"] = round(100 * float((r > 0).mean()), 1)
    rec["nc_correct_mean"] = round(float(a["nc"].mean()), 2)
    rec["nc_other_mean"] = round(float(b["nc"].mean()), 2)
    rec["K_over_N_mean"] = round(float((a["K"] / a["N"]).mean()), 3)
    rec["cq_correct_median"] = round(float(a["cq"].median()), 5)
    rec["cq_other_median"] = round(float(b["cq"].median()), 5)
    rows.append(rec)
out = pd.DataFrame(rows)
out.to_csv(outp, sep="\t", index=False)
pd.set_option("display.width", 250)
print(out.T.to_string())
