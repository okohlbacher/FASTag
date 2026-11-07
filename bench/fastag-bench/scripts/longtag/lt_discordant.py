#!/usr/bin/env python3
"""Per-spectrum anatomy of the rank-1 discordance between FASTag 1.9.0 and DirecTag 1.4.21142 at
matched settings, tag length 3, Sage 1% FDR truth (flank rule of the harness).

For every Sage-identified spectrum tagged by both tools it records: rank-1 correctness of each tool,
the rank of each tool's first correct tag, whether the other tool's rank-1 tag is in this tool's list
(and at which rank), DirecTag's per-tag p-values, and spectrum features (charge, precursor mass,
peak counts from DirecTag's S line, peptide length).

usage: lt_discordant.py HARNESS_SRC DS_ID FASTAG_TAGS DIRECTAG_TAGS SAGE_TSV OUT_TSV.gz [MATCH_TOL]
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, sys.argv[1])
from fastag_bench import parsers as P  # noqa: E402
from fastag_bench import score as S  # noqa: E402

ds, ftp, dtp, sagep, outp = sys.argv[2:7]
match_tol = float(sys.argv[7]) if len(sys.argv) > 7 else 0.05

psms = P.read_sage_psms(sagep, 0.01)
sage_raw = pd.read_csv(sagep, sep="\t", usecols=["scannr", "charge", "expmass", "peptide_len"])
sage_raw["key"] = sage_raw["scannr"].map(P.spectrum_key)
sage_raw = sage_raw.drop_duplicates("key")

ft = P.read_fastag_tags(ftp)
dt = P.read_directag_tags(dtp)

# DirecTag S lines: spectrum-level features
srows, cols = [], None
with open(dtp) as fh:
    for line in fh:
        if line.startswith("H(S)"):
            cols = line.rstrip("\n").split("\t")[1:]
        elif line.startswith("S\t"):
            srows.append(line.rstrip("\n").split("\t")[1:])
sdf = pd.DataFrame(srows, columns=cols)
sdf["key"] = sdf["ID"].map(P.spectrum_key)
for c in ("Charge", "PrecursorNeutralMass", "OriginalPeakCount", "FilteredPeakCount", "ComplementaryPeakCount",
          "TagGraphPeakCount", "GeneratedTagCount", "FinalTagCount"):
    sdf[c] = pd.to_numeric(sdf[c], errors="coerce")
sdf = sdf.drop_duplicates("key").set_index("key")

fm = S._mark(ft, psms, "flank")
dm = S._mark(dt, psms, "flank")
for c in ("Total", "Complement", "Intensity", "MzFidelity", "TagChargeState", "WorstPeakRank", "LowPeakMz"):
    dm[c] = pd.to_numeric(dm[c], errors="coerce")
fm["charge"] = pd.to_numeric(fm["charge"], errors="coerce")
fm["evalue"] = pd.to_numeric(fm["evalue"], errors="coerce")

keys = sorted(set(fm["key"]) & set(dm["key"]))
fg = {k: g for k, g in fm.groupby("key", sort=False)}
dg = {k: g for k, g in dm.groupby("key", sort=False)}
pep = psms.drop_duplicates("key").set_index("key")["peptide"]


def find(g, tag, charge, cterm, tol):
    """rank of the first row of g with the same tag, fragment charge and C-terminal flank (or -1)."""
    ch = g["charge"] if "charge" in g.columns and "TagChargeState" not in g.columns else g["TagChargeState"]
    hit = g[(g["tag"].str.replace("I", "L") == tag.replace("I", "L")) & (ch == charge)
            & ((g["cterm_mass"] - cterm).abs() <= tol)]
    return int(hit["rank"].iloc[0]) if len(hit) else -1


rows = []
for k in keys:
    f, d = fg[k].sort_values("rank"), dg[k].sort_values("rank")
    f1, d1 = f.iloc[0], d.iloc[0]
    fc = f[f["correct"]]
    dc = d[d["correct"]]
    r = {
        "dataset": ds, "key": k, "peptide": pep.get(k, ""),
        "ft_top1": int(bool(f1["correct"])), "dt_top1": int(bool(d1["correct"])),
        "ft_first_correct": int(fc["rank"].iloc[0]) if len(fc) else -1,
        "dt_first_correct": int(dc["rank"].iloc[0]) if len(dc) else -1,
        "ft_ntags": len(f), "dt_ntags": len(d),
        "ft1_tag": f1["tag"], "ft1_charge": int(f1["charge"]), "ft1_evalue": float(f1["evalue"]),
        "dt1_tag": d1["tag"], "dt1_charge": int(d1["TagChargeState"]), "dt1_total": float(d1["Total"]),
        "dt1_pI": float(d1["Intensity"]), "dt1_pM": float(d1["MzFidelity"]), "dt1_pC": float(d1["Complement"]),
        "dt1_worst_rank": float(d1["WorstPeakRank"]),
        "dt2_total": float(d.iloc[1]["Total"]) if len(d) > 1 else float("nan"),
        "ft2_evalue": float(f.iloc[1]["evalue"]) if len(f) > 1 else float("nan"),
        "ft_ntags_e0": int((f["evalue"] == f1["evalue"]).sum()),
        "dt_ntags_tie1": int((d["Total"] == d1["Total"]).sum()), "dt1_lowmz": float(d1["LowPeakMz"]),
        # where is the other tool's rank-1 tag in this tool's list?
        "dt1_in_ft_rank": find(f, d1["tag"], int(d1["TagChargeState"]), float(d1["cterm_mass"]), match_tol),
        "ft1_in_dt_rank": find(d, f1["tag"], int(f1["charge"]), float(f1["cterm_mass"]), match_tol),
    }
    # DirecTag p-values of FASTag's rank-1 tag, when DirecTag also reports it
    if r["ft1_in_dt_rank"] > 0:
        x = d[d["rank"] == r["ft1_in_dt_rank"]].iloc[0]
        r.update({"ft1_dt_pI": float(x["Intensity"]), "ft1_dt_pM": float(x["MzFidelity"]),
                  "ft1_dt_pC": float(x["Complement"]), "ft1_dt_total": float(x["Total"])})
    if k in sdf.index:
        s = sdf.loc[k]
        r.update({"prec_charge": int(s["Charge"]), "prec_mass": float(s["PrecursorNeutralMass"]),
                  "orig_peaks": int(s["OriginalPeakCount"]), "filt_peaks": int(s["FilteredPeakCount"]),
                  "dt_compl_peaks": int(s["ComplementaryPeakCount"]), "dt_graph_peaks": int(s["TagGraphPeakCount"]),
                  "dt_generated": int(s["GeneratedTagCount"])})
    rows.append(r)

out = pd.DataFrame(rows)
sr = sage_raw.set_index("key")
out["sage_charge"] = out["key"].map(sr["charge"])
out["peptide_len"] = out["key"].map(sr["peptide_len"])
out.to_csv(outp, sep="\t", index=False)

# summary
n = len(out)
b = int(((out.ft_top1 == 1) & (out.dt_top1 == 0)).sum())
c = int(((out.ft_top1 == 0) & (out.dt_top1 == 1)).sum())
print(f"{ds}: both-tagged {n}; FT {out.ft_top1.mean()*100:.2f}% DT {out.dt_top1.mean()*100:.2f}%; "
      f"FT-only {b} DT-only {c}")
dto = out[(out.ft_top1 == 0) & (out.dt_top1 == 1)]
print("DT-only: DT rank-1 tag found in FT list:", (dto.dt1_in_ft_rank > 0).mean().round(3),
      "median FT rank", dto.loc[dto.dt1_in_ft_rank > 0, "dt1_in_ft_rank"].median())
print("DT-only: FT first correct rank distribution:",
      dto.ft_first_correct.value_counts().sort_index().head(10).to_dict())
fto = out[(out.ft_top1 == 1) & (out.dt_top1 == 0)]
print("FT-only: FT rank-1 tag found in DT list:", (fto.ft1_in_dt_rank > 0).mean().round(3),
      "median DT rank", fto.loc[fto.ft1_in_dt_rank > 0, "ft1_in_dt_rank"].median())
