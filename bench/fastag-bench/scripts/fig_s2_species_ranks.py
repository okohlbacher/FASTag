#!/usr/bin/env python3
"""Figure S2: ranked genus lists of FASTag -species per run, without and with -species_deconvolve, for the 48
runs of the species benchmark. Rows are runs, grouped into high-resolution single-organism runs, high-resolution
mixtures and ion-trap runs (IT). Middle: rank of every true genus that is in the index (open circle = FASTag
default, filled circle = deconvolved, cross = Unipept pept2lca on the Sage peptides; ranks above 50 or genera
without evidence are drawn at the right edge; "+n not in index" counts true genera outside the 50-genus index).
Right: the three top-ranked genera of each list; true genera are set in capitals. Source: results/species_genus_calls_v190.tsv, species_runs_v190.tsv (--suffix '' = the
FASTag 1.8.0 tables species_genus_calls.tsv, species_runs.tsv).
"""
# --- shared block (identical in every figure script; scripts stay standalone) ---
import argparse
import io
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import pandas as pd  # noqa: E402

# Colour-blind-safe categorical order (validated: CVD dE >= 9.1 adjacent pairs); fixed, never cycled.
PALETTE = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"]
MARKERS = ["o", "s", "^", "D", "v"]
INK, MUTED, GRID = "#1f1f1e", "#6b6a63", "#e4e3dd"
plt.rcParams.update({
    "font.size": 9, "axes.titlesize": 10, "axes.labelsize": 9, "axes.edgecolor": MUTED,
    "axes.labelcolor": INK, "xtick.color": MUTED, "ytick.color": MUTED, "text.color": INK,
    "axes.spines.top": False, "axes.spines.right": False, "axes.grid": True, "grid.color": GRID,
    "grid.linewidth": 0.6, "lines.linewidth": 2, "lines.markersize": 6, "legend.frameon": False,
    "pdf.fonttype": 42, "svg.fonttype": "none", "figure.dpi": 100,
})


def read_tsv(path):
    """Read a result TSV, skipping the leading '# provenance' lines; return (df, provenance)."""
    lines = Path(path).read_text().splitlines(keepends=True)
    prov = [l[1:].strip() for l in lines if l.startswith("#")]
    body = "".join(l for l in lines if not l.startswith("#"))
    return pd.read_csv(io.StringIO(body), sep="\t"), prov


def args(default_name, versioned=False):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--results", default=str(Path(__file__).resolve().parent.parent / "results"))
    ap.add_argument("--out", default=str(Path(__file__).resolve().parent.parent / "figures"))
    ap.add_argument("--name")
    if versioned:  # scripts whose tables exist per FASTag release
        ap.add_argument("--suffix", default="v190", help="tables of one FASTag release: v190 (default, the "
                        "paper release), v180, or '' for the unsuffixed 1.8.0 or older tables; writes <name>_<suffix>")
    a = ap.parse_args()
    a.suffix = getattr(a, "suffix", "")
    a.name = a.name or (f"{default_name}_{a.suffix}" if a.suffix else default_name)
    return a


def save(fig, a):
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    fig.tight_layout()
    for ext in ("pdf", "png"):
        fig.savefig(out / f"{a.name}.{ext}", dpi=300 if ext == "png" else None)
    plt.close(fig)
    print(out / f"{a.name}.pdf")
# --- end shared block ---

import numpy as np

a = args("fig_s2_species_ranks", versioned=True)
sfx = f"_{a.suffix}" if a.suffix else ""
runs, _ = read_tsv(Path(a.results) / f"species_runs{sfx}.tsv")
gen, _ = read_tsv(Path(a.results) / f"species_genus_calls{sfx}.tsv")


def truth_genera(t):
    return [x.split("=")[0].strip() for x in str(t).split(";") if x.strip()]


runs["genera"] = runs["truth"].map(truth_genera)
runs["n_truth"] = runs["genera"].map(len)
runs["group"] = [("IT" if an == "ITMS" else ("single" if n == 1 else "mixture"))
                 for an, n in zip(runs["analyzer"], runs["n_truth"])]
groups = [("single", "High-resolution MS2, single organism"), ("mixture", "High-resolution MS2, two or more genera"),
          ("IT", "Ion-trap MS2")]
in_index = set(gen.loc[gen["in_index"].astype(str) == "True", "genus"])


def top3(rid, col):
    g = gen[(gen["run_id"] == rid) & gen[col].notna()].sort_values(col)
    tr = set(runs.loc[runs["run_id"] == rid, "genera"].iloc[0])
    return ", ".join(x.upper() if x in tr else x for x in g["genus"].head(3))


order = []
for key, _ in groups:
    sub = runs[runs["group"] == key]
    order += [(key, r) for r in sub["run_id"]]
n = len(order) + 2 * len(groups)
fig = plt.figure(figsize=(9.6, 0.165 * n + 1.3))
gs = fig.add_gridspec(1, 4, width_ratios=[2.5, 1.55, 2.3, 2.3], wspace=0.04,
                      left=0.01, right=0.995, top=1 - 0.55 / (0.165 * n + 1.3), bottom=0.75 / (0.165 * n + 1.3))
axl, axd, axa, axb = (fig.add_subplot(gs[0, i]) for i in range(4))
CAP = 60
for ax in (axl, axa, axb):
    ax.axis("off")
for ax in (axl, axd, axa, axb):
    ax.set_ylim(n - 0.5, -0.5)
axd.set_xscale("log")
axd.set_xlim(0.8, CAP * 1.1)
axd.set_xticks([1, 2, 5, 10, 20, 50], ["1", "2", "5", "10", "20", "50"], fontsize=7)
axd.set_yticks([])
axd.grid(axis="y", visible=False)
axd.set_xlabel("Rank of true genus", fontsize=7.5)
axd.tick_params(axis="x", top=True, labeltop=True, labelsize=6.5)
for ax in (axl, axa, axb):
    ax.set_xlim(0, 1)

y = 0
for key, title in groups:
    axl.text(0.0, y + 0.3, title, fontsize=7.5, fontweight="bold", va="center")
    axd.axhspan(y - 0.5, y + 0.5, color="white", zorder=0)
    y += 1
    for _, rid in [o for o in order if o[0] == key]:
        r = runs[runs["run_id"] == rid].iloc[0]
        tr = r["genera"]
        out = [g for g in tr if g not in in_index]
        lab = rid.replace("_", " ")
        if len(lab) > 27:
            lab = lab[:26] + "…"
        if out:
            lab += f"  (+{len(out)} not in index)"
        axl.text(0.02, y, lab, fontsize=6.3, va="center")
        if y % 2:
            axd.axhspan(y - 0.5, y + 0.5, color=GRID, alpha=0.35, lw=0, zorder=0)
        g = gen[(gen["run_id"] == rid) & gen["genus"].isin(tr)]
        for _, gr in g.iterrows():
            rd = gr["rank_default"] if pd.notna(gr["rank_default"]) else CAP
            rv = gr["rank_deconv"] if pd.notna(gr["rank_deconv"]) else CAP
            ru = gr["unipept_rank"] if pd.notna(gr["unipept_rank"]) and gr["unipept_rank"] <= CAP else CAP
            rd, rv = min(rd, CAP), min(rv, CAP)
            axd.plot([rd, rv], [y, y], color=MUTED, lw=0.7, zorder=1)
            axd.plot(rd, y, "o", ms=3.6, mfc="white", mec=PALETTE[0], mew=0.9, zorder=3)
            axd.plot(rv, y, "o", ms=3.0, color=PALETTE[1], zorder=4)
            axd.plot(ru, y, "x", ms=3.0, color=INK, mew=0.7, zorder=5)
        axa.text(0.02, y, top3(rid, "rank_default"), fontsize=6.0, va="center")
        axb.text(0.02, y, top3(rid, "rank_deconv"), fontsize=6.0, va="center")
        y += 1
    y += 1
top = -0.5
axa.text(0.02, top - 0.9, "Top 3, FASTag default", fontsize=7.5, va="bottom")
axb.text(0.02, top - 0.9, "Top 3, deconvolved", fontsize=7.5, va="bottom")
axl.text(0.02, top - 0.9, "Run", fontsize=7.5, va="bottom")
for ax in (axl, axa, axb):
    ax.set_clip_on(False)
from matplotlib.lines import Line2D  # noqa: E402
h = [Line2D([], [], ls="none", marker="o", mfc="white", mec=PALETTE[0], label="FASTag default"),
     Line2D([], [], ls="none", marker="o", color=PALETTE[1], label="FASTag deconvolved"),
     Line2D([], [], ls="none", marker="x", color=INK, label="Unipept (right edge: no evidence or rank > 50)")]
fig.legend(handles=h, loc="lower center", ncol=4, fontsize=7, bbox_to_anchor=(0.5, 0.0))
out = Path(a.out)
out.mkdir(parents=True, exist_ok=True)
for ext in ("pdf", "png"):
    fig.savefig(out / f"{a.name}.{ext}", dpi=300 if ext == "png" else None)
plt.close(fig)
print(out / f"{a.name}.pdf")
