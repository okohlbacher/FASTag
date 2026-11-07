#!/usr/bin/env python3
"""Rank-1 accuracy of FASTag reruns against DirecTag at matched settings, tag length 3, Sage 1% FDR, flank rule,
on the spectra both tools tagged in the paper runs (fixed denominator; a spectrum a rerun leaves untagged counts
as not correct).
usage: lt_score.py HARNESS_SRC DATASET SAGE_TSV DIRECTAG_TAGS RELEASE_FASTAG_TAGS OUT_TSV name=tags.tsv ..."""
import math
import sys

import pandas as pd

sys.path.insert(0, sys.argv[1])
from fastag_bench import parsers as P  # noqa: E402
from fastag_bench import score as S  # noqa: E402

ds, sagep, dtp, relp, outp = sys.argv[2:7]
runs = [a.split("=", 1) for a in sys.argv[7:]]
psms = P.read_sage_psms(sagep, 0.01)


def top1(tags, k=1):
    m = S._mark(tags, psms, "flank")
    t = m[m["rank"] <= k].groupby("key")["correct"].any()
    return t, set(m["key"])


dtt = P.read_directag_tags(dtp)
dt1, dtk = top1(dtt)
dt10, _ = top1(dtt, 10)
relt = P.read_fastag_tags(relp)
rel1, relk = top1(relt)
keys = sorted(dtk & relk)
dtv = dt1.reindex(keys).fillna(False).astype(bool)
dtv10 = dt10.reindex(keys).fillna(False).astype(bool)


def mcnemar(b, c):
    n = b + c
    if n == 0:
        return 1.0
    k = min(b, c)
    p = sum(math.comb(n, i) for i in range(k + 1)) / 2 ** n
    return min(1.0, 2 * p)


rows = []
for name, path in [("release", relp)] + runs:
    tg = P.read_fastag_tags(path) if name != "release" else relt
    t, _ = top1(tg)
    t10, _ = top1(tg, 10)
    fv = t.reindex(keys).fillna(False).astype(bool)
    fv10 = t10.reindex(keys).fillna(False).astype(bool)
    b = int((fv & ~dtv).sum())
    c = int((~fv & dtv).sum())
    rows.append({"dataset": ds, "run": name, "spectra": len(keys), "fastag_top1_pct": round(100 * fv.mean(), 2),
                 "directag_top1_pct": round(100 * dtv.mean(), 2), "diff_points": round(100 * (fv.mean() - dtv.mean()), 2),
                 "only_fastag": b, "only_directag": c, "p_mcnemar": f"{mcnemar(b, c):.2g}",
                 "fastag_top10_pct": round(100 * fv10.mean(), 2), "directag_top10_pct": round(100 * dtv10.mean(), 2),
                 "diff_top10_points": round(100 * (fv10.mean() - dtv10.mean()), 2),
                 "vs_release_gain": int((fv & ~rel1.reindex(keys).fillna(False).astype(bool)).sum()),
                 "vs_release_loss": int((~fv & rel1.reindex(keys).fillna(False).astype(bool)).sum())})
out = pd.DataFrame(rows)
out.to_csv(outp, sep="\t", index=False)
print(out.to_string())
