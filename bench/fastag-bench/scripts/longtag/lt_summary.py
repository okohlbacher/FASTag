#!/usr/bin/env python3
"""Summaries of the per-spectrum discordance tables written by lt_discordant.py.
usage: lt_summary.py OUT_PREFIX disc_A.tsv.gz [disc_B.tsv.gz ...]
Writes OUT_PREFIX_overview.tsv, OUT_PREFIX_components.tsv, OUT_PREFIX_strata.tsv."""
import sys

import numpy as np
import pandas as pd

prefix, files = sys.argv[1], sys.argv[2:]
ov, comp, strata = [], [], []


def lg(x):
    return np.log10(np.clip(x.astype(float), 1e-300, None))


for f in files:
    d = pd.read_csv(f, sep="\t")
    ds = d["dataset"].iloc[0]
    n = len(d)
    b = (d.ft_top1 == 1) & (d.dt_top1 == 0)
    c = (d.ft_top1 == 0) & (d.dt_top1 == 1)
    dto, fto = d[c], d[b]
    ov.append({
        "dataset": ds, "spectra": n, "fastag_top1_pct": round(100 * d.ft_top1.mean(), 2),
        "directag_top1_pct": round(100 * d.dt_top1.mean(), 2), "only_fastag": int(b.sum()), "only_directag": int(c.sum()),
        # DirecTag-only spectra: does FASTag have a correct tag lower in its list?
        "dtonly_ft_correct_rank2": int((dto.ft_first_correct == 2).sum()),
        "dtonly_ft_correct_rank3_10": int(dto.ft_first_correct.between(3, 10).sum()),
        "dtonly_ft_correct_gt10": int((dto.ft_first_correct > 10).sum()),
        "dtonly_ft_no_correct": int((dto.ft_first_correct < 0).sum()),
        "dtonly_dt1_in_ft": int((dto.dt1_in_ft_rank > 0).sum()),
        "dtonly_dt1_in_ft_median_rank": float(dto.loc[dto.dt1_in_ft_rank > 0, "dt1_in_ft_rank"].median()),
        "dtonly_ft1_in_dt": int((dto.ft1_in_dt_rank > 0).sum()),
        "ftonly_dt_correct_rank2": int((fto.dt_first_correct == 2).sum()),
        "ftonly_ft1_in_dt": int((fto.ft1_in_dt_rank > 0).sum()),
        # DirecTag rank-1 tie (equal printed Total at ranks 1 and 2), and Total printed as 0
        "dt_top1_tied_pct_all": round(100 * (d.dt_ntags_tie1 > 1).mean(), 2),
        "dt_top1_tied_pct_dtonly": round(100 * (dto.dt_ntags_tie1 > 1).mean(), 2),
        "dt_top1_tied_pct_ftonly": round(100 * (fto.dt_ntags_tie1 > 1).mean(), 2),
        "dt_total0_pct_all": round(100 * (d.dt1_total == 0).mean(), 2),
    })
    # Which DirecTag p-value separates DirecTag's correct rank-1 tag from FASTag's incorrect rank-1 tag?
    x = dto[dto.ft1_in_dt_rank > 0]
    for comp_name, a, bb in (("intensity", "dt1_pI", "ft1_dt_pI"), ("mz_fidelity", "dt1_pM", "ft1_dt_pM"),
                             ("complement", "dt1_pC", "ft1_dt_pC")):
        r = lg(x[a]) - lg(x[bb])   # negative: DirecTag's correct tag scores better on this component
        comp.append({"dataset": ds, "subset": "directag_only, FASTag rank-1 tag in DirecTag list", "n": len(x),
                     "component": comp_name, "median_log10_ratio": round(float(r.median()), 3),
                     "pct_correct_better": round(100 * float((r < 0).mean()), 1),
                     "pct_correct_worse": round(100 * float((r > 0).mean()), 1)})
    # spectrum strata
    d = d.assign(disc=np.where(b, "only_fastag", np.where(c, "only_directag", "concordant")))
    d["compl_bin"] = pd.cut(d.dt_compl_peaks, [-1, 0, 5, 10, 20, 40, 1000],
                            labels=["0", "1-5", "6-10", "11-20", "21-40", ">40"])
    d["peaks_bin"] = pd.cut(d.orig_peaks, [0, 100, 200, 400, 800, 1600, 100000],
                            labels=["<=100", "101-200", "201-400", "401-800", "801-1600", ">1600"])
    d["len_bin"] = pd.cut(d.peptide_len, [0, 8, 10, 12, 15, 20, 100], labels=["<=8", "9-10", "11-12", "13-15", "16-20", ">20"])
    for col in ("prec_charge", "compl_bin", "peaks_bin", "len_bin", "dt1_charge"):
        for k, g in d.groupby(col, observed=True):
            nb, nc = int((g.disc == "only_fastag").sum()), int((g.disc == "only_directag").sum())
            strata.append({"dataset": ds, "stratum": col, "level": str(k), "spectra": len(g),
                           "fastag_top1_pct": round(100 * g.ft_top1.mean(), 2),
                           "directag_top1_pct": round(100 * g.dt_top1.mean(), 2),
                           "diff_points": round(100 * (g.ft_top1.mean() - g.dt_top1.mean()), 2),
                           "only_fastag": nb, "only_directag": nc,
                           "share_of_net_deficit_pct": None, "_net": nc - nb})
    tot = sum(s["_net"] for s in strata if s["dataset"] == ds and s["stratum"] == "prec_charge")
    for s in strata:
        if s["dataset"] == ds and tot:
            s["share_of_net_deficit_pct"] = round(100 * s["_net"] / tot, 1)

pd.DataFrame(ov).to_csv(prefix + "_overview.tsv", sep="\t", index=False)
pd.DataFrame(comp).to_csv(prefix + "_components.tsv", sep="\t", index=False)
st = pd.DataFrame(strata).drop(columns="_net")
st.to_csv(prefix + "_strata.tsv", sep="\t", index=False)
pd.set_option("display.width", 250)
pd.set_option("display.max_columns", 40)
print(pd.DataFrame(ov).T.to_string())
print(pd.DataFrame(comp).to_string())
print(st.to_string())
