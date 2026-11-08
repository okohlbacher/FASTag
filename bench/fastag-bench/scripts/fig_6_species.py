#!/usr/bin/env python3
"""Figure 6: species identification with FASTag 1.8.0 -species (bundled k=7 index, 50 genera) on public runs
of known composition, against Unipept 4.2.2 pept2lca on Sage 0.14.7 1% FDR peptides.
A rank of each genus (IT = ion-trap MS2) in the FASTag report (rows runs, columns genera; dot = genus in the sample);
B rank of the true genus with gapped tags excluded (default) vs admitted (-species_use_gapped);
C detection along the PXD028735 mixing series (E. coli and yeast w/w fraction vs evidence share);
D sensitivity vs 1 - specificity over evidence-share thresholds, with the three stated decision rules.
Sources: results/species_genus_calls.tsv, species_runs.tsv, species_sweep.tsv, species_metrics.tsv,
species_agreement.tsv (fastag-bench species-run / species-score); --suffix v190 reads the species_*_v190.tsv tables.
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

import numpy as np  # noqa: E402
import matplotlib.ticker  # noqa: E402
from matplotlib.colors import ListedColormap, BoundaryNorm  # noqa: E402

a = args("fig6_species", versioned=True)
R = Path(a.results)
S = f"_{a.suffix}" if a.suffix else ""  # 1.8.0 tables have no suffix
g, _ = read_tsv(R / f"species_genus_calls{S}.tsv")
runs, _ = read_tsv(R / f"species_runs{S}.tsv")
sw, _ = read_tsv(R / f"species_sweep{S}.tsv")
met, _ = read_tsv(R / f"species_metrics{S}.tsv")
agr = read_tsv(R / f"species_agreement{S}.tsv")[0] if (R / f"species_agreement{S}.tsv").exists() else None
for c in ("in_index", "truth"):
    g[c] = g[c].astype(str).str.lower().eq("true")

fig = plt.figure(figsize=(7.2, 9.0))
gs = fig.add_gridspec(2, 3, height_ratios=[1.75, 1.0], hspace=0.32, wspace=0.55)

# ---- A: rank heatmap ---------------------------------------------------------------
axA = fig.add_subplot(gs[0, :])
order_set = {"series": 0, "mixture": 1, "single": 2}
runs["_o"] = runs["set"].map(order_set).fillna(3)
runs = runs.sort_values(["_o", "pxd", "run_id"]).reset_index(drop=True)
gi = g[g["in_index"]]
truth_genera = sorted(set(gi[gi["truth"]]["genus"]))
fp_top = (gi[(gi["status"] == "negative") & (gi["rank_default"] <= 3)]["genus"].value_counts().index.tolist())
cols = truth_genera + [x for x in fp_top if x not in truth_genera][:8]
M = np.full((len(runs), len(cols)), np.nan)
for i, rid in enumerate(runs["run_id"]):
    sub = gi[gi["run_id"] == rid].set_index("genus")
    for j, c in enumerate(cols):
        if c in sub.index and pd.notna(sub.loc[c, "rank_default"]):
            M[i, j] = sub.loc[c, "rank_default"]
bins = [0.5, 1.5, 2.5, 3.5, 5.5, 10.5, 1e9]
cmap = ListedColormap(["#08306b", "#2a78d6", "#6baed6", "#a6c8e8", "#dbe7f3", "#f7f7f5"])
norm = BoundaryNorm(bins, cmap.N)
im = axA.imshow(np.where(np.isnan(M), 1e8, M), aspect="auto", cmap=cmap, norm=norm, interpolation="nearest")
for i, rid in enumerate(runs["run_id"]):
    sub = gi[(gi["run_id"] == rid) & gi["truth"]]
    for c in sub["genus"]:
        if c in cols:
            axA.plot(cols.index(c), i, "o", ms=3.2, mfc="none", mec="#eb6834", mew=1.2)
axA.set_xticks(range(len(cols)), cols, rotation=60, ha="right", fontsize=7)
lab = [(r.replace("_", " ")[:26]) + (" (IT)" if an == "ITMS" else "")
       for r, an in zip(runs["run_id"], runs["analyzer"])]
axA.set_yticks(range(len(runs)), lab, fontsize=5.6)
axA.grid(False)
axA.axvline(len(truth_genera) - 0.5, color=INK, lw=0.8)
cb = fig.colorbar(im, ax=axA, ticks=[1, 2, 3, 4.5, 8, 11], fraction=0.025, pad=0.01)
cb.ax.set_yticklabels(["1", "2", "3", "4-5", "6-10", ">10"], fontsize=7)
cb.set_label("FASTag rank (default)", fontsize=8)
axA.set_title("A  Rank of each genus per run (circle: genus present in the sample)", loc="left", fontsize=9)

# ---- B: gapped vs ungapped rank ------------------------------------------------------
axB = fig.add_subplot(gs[1, 0])
pos = gi[gi["status"] == "positive"].copy()
x = pos["rank_default"].fillna(51)
y = pos["rank_gapped"].fillna(51)
jit = np.random.default_rng(1).uniform(-0.12, 0.12, size=(2, len(pos)))
axB.scatter(x * np.exp(jit[0]), y * np.exp(jit[1]), s=14, color=PALETTE[0], alpha=0.75, edgecolor="none")
axB.plot([1, 51], [1, 51], color=MUTED, lw=0.8, ls="--")
axB.set_xscale("log")
axB.set_yscale("log")
axB.set_xlim(0.8, 60)
axB.set_ylim(0.8, 60)
for ax_ in (axB.xaxis, axB.yaxis):
    ax_.set_major_formatter(matplotlib.ticker.FuncFormatter(lambda v, _: f"{v:g}"))
axB.set_xlabel("rank, gapped excluded (default)")
axB.set_ylabel("rank, gapped admitted")
better = int((x < y).sum())
worse = int((x > y).sum())
axB.set_title("B  Gapped tags", loc="left", fontsize=9)
axB.text(0.03, 0.97, f"n={len(pos)} true genera\nexcluded better: {better}\nadmitted better: {worse}",
         transform=axB.transAxes, va="top", fontsize=6.5, color=MUTED)

# ---- C: detection along the PXD028735 series -----------------------------------------
axC = fig.add_subplot(gs[1, 1])
ser = runs[runs["series"].astype(str) == "HYE"]
for k, (genus, frac_of) in enumerate((("Escherichia", {}), ("Saccharomyces", {}))):
    rows = []
    for rid in ser["run_id"]:
        sub = g[(g["run_id"] == rid) & (g["genus"] == genus)]
        if not len(sub):
            continue
        s = sub.iloc[0]
        f = s["truth_fraction"] if s["truth"] else 0.0
        rows.append((f, s.get("dec_share", np.nan), s.get("unipept_share", np.nan)))
    if not rows:
        continue
    rows.sort()
    f, d, u = map(np.array, zip(*rows))
    fx = np.where(f == 0, 0.01, f)
    axC.plot(fx, np.maximum(d, 1e-4), marker=MARKERS[0], color=PALETTE[k], lw=1.4, ms=5,
             label=f"{genus[:7]}. FASTag")
    axC.plot(fx, np.maximum(u, 1e-4), marker=MARKERS[1], color=PALETTE[k], lw=1.0, ls="--", ms=5,
             mfc="white", label=f"{genus[:7]}. Unipept")
axC.axhline(0.01, color=MUTED, lw=0.8, ls=":")
axC.set_xscale("log")
axC.set_yscale("log")
axC.set_xlabel("w/w fraction (0 shown at 0.01)")
axC.set_ylabel("evidence share")
axC.legend(fontsize=5.5, loc="upper left", handlelength=2.2)
axC.set_ylim(5e-5, 3)
axC.set_title("C  PXD028735 series", loc="left", fontsize=9)

# ---- D: sensitivity/specificity sweep with the stated decision rules -------------------
ax = fig.add_subplot(gs[1, 2])
sw_h = sw[sw["runs"] == "FTMS"] if "runs" in sw else sw
for k, (score, lab) in enumerate((("dec_share", "FASTag share"), ("unipept_share", "Unipept share"))):
    s_ = sw_h[sw_h["score"] == score].sort_values("threshold")
    if len(s_):
        ax.plot(1 - s_["specificity"], s_["sensitivity"], marker=MARKERS[k], color=PALETTE[k], ms=3.5, lw=1.2, label=lab)
rule_lab = {"call_fastag_q": "FASTag q", "call_fastag_dec": "FASTag 1%", "call_unipept": "Unipept 1%"}
m = met[met["subset"] == ("all_FTMS" if (met["subset"] == "all_FTMS").any() else "all")].reset_index(drop=True)
for k, r in enumerate(m.itertuples()):
    ax.plot(1 - r.specificity, r.sensitivity, marker=MARKERS[2 + k], color=PALETTE[2 + k], ms=6.5, ls="none",
            mec=INK, mew=0.5, label=f"{rule_lab.get(r.rule, r.rule)} ({r.sensitivity:.2f}/{r.specificity:.2f})")
ax.set_xlim(-0.02, 1.02)
ax.set_ylim(-0.02, 1.02)
ax.set_xlabel("1 - specificity")
ax.set_ylabel("sensitivity")
if agr is not None and len(agr):
    r0 = agr.iloc[0]
    ax.text(0.97, 0.03, f"agreement {r0['percent_agreement']:.2f}\nkappa {r0['cohen_kappa']:.2f}",
            transform=ax.transAxes, ha="right", va="bottom", fontsize=6.5, color=MUTED)
ax.legend(fontsize=5.5, loc="upper left", bbox_to_anchor=(0.0, 1.0))
ax.set_title("D  Calls (Orbitrap MS2)", loc="left", fontsize=9)
# the heatmap's run labels are wide: save with a tight bounding box instead of the shared tight_layout
out = Path(a.out)
out.mkdir(parents=True, exist_ok=True)
for ext in ("pdf", "png"):
    fig.savefig(out / f"{a.name}.{ext}", dpi=300 if ext == "png" else None, bbox_inches="tight")
plt.close(fig)
print(out / f"{a.name}.pdf")

