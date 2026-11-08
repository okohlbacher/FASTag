#!/usr/bin/env python3
"""Rank-1 difference FASTag rerun minus DirecTag by precursor charge, on the spectra of a discordance table
(lt_discordant.py; both tagged in the paper runs).
usage: lt_score_strata.py HARNESS_SRC DISC_TSV SAGE_TSV OUT_TSV name=tags.tsv ..."""
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
    m = S._mark(P.read_fastag_tags(path), psms, "flank")
    t = m[m["rank"] == 1].drop_duplicates("key").set_index("key")["correct"]
    ft = t.reindex(disc.index).fillna(False).astype(bool)
    dt = disc["dt_top1"].astype(bool)
    z = disc["prec_charge"].clip(upper=4)
    for lvl in sorted(z.unique()):
        s = z == lvl
        rows.append({"run": name, "prec_charge": ("4+" if lvl == 4 else str(int(lvl))), "spectra": int(s.sum()),
                     "fastag_top1_pct": round(100 * ft[s].mean(), 2), "directag_top1_pct": round(100 * dt[s].mean(), 2),
                     "diff_points": round(100 * (ft[s].mean() - dt[s].mean()), 2),
                     "only_fastag": int((ft & ~dt & s).sum()), "only_directag": int((~ft & dt & s).sum())})
out = pd.DataFrame(rows)
out.to_csv(outp, sep="\t", index=False)
print(out.to_string())
