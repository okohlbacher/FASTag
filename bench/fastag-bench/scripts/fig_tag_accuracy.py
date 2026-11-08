#!/usr/bin/env python3
"""Figure 3: tag accuracy of FASTag 1.8.0 (--suffix v190: 1.9.0) and DirecTag 1.4.21142 against Sage 1% FDR PSMs.

A  share of tagged PSM spectra with a correct tag within the top k (k = 1..50), one panel per dataset
B  per-tag precision by tag length at matched settings on PXD003531 (FASTag 3-8, DirecTag 3-6: DirecTag's
   rank-sum table took 155 s at length 6 and did not finish at 7), with the chance level (same tags scored
   against peptides permuted between spectra)
C  density of log10 E-value for correct and incorrect FASTag tags (defaults, all tags on PSM spectra)
D  -gap_penalty and peak-budget sweeps on PXD000001: rank-1 accuracy vs single-thread wall time
Correct = tag or reverse is a substring of the PSM peptide (I=L) and one flanking mass agrees within 0.05 Da.
Sources: results/tag_accuracy_{topk,by_length,evalue_density}_v180.tsv, results/{gap_penalty,peak_budget}_pxd000001_v180.tsv
(_v190 with --suffix v190).
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

a = args("fig_tag_accuracy", versioned=True)
R = Path(a.results)
V = a.suffix or "v180"
need = R / f"tag_accuracy_topk_{V}.tsv"
if not need.exists():
    print(f"no results/tag_accuracy_topk_{V}.tsv yet; run 'fastag-bench accuracy --steps ...,collect' first")
    sys.exit(0)

TRUTH = "sage"
PROF = {  # colour follows the tool, line style the settings
    "fastag_default": ("FASTag, defaults", PALETTE[0], "-"),
    "fastag_matched": ("FASTag, matched", PALETTE[0], "--"),
    "directag_default": ("DirecTag, defaults", PALETTE[1], "-"),
    "directag_matched": ("DirecTag, matched", PALETTE[1], "--"),
}
ORDER = ["PXD003531", "PXD000001", "PXD076528", "PXD054073", "PXD001819"]
LABEL = {"PXD003531": "PXD003531\nQ Exactive HCD", "PXD000001": "PXD000001\nVelos HCD, TMT",
         "PXD076528": "PXD076528\nOrbitrap Astral", "PXD054073": "PXD054073\ntimsTOF ddaPASEF",
         "PXD001819": "PXD001819\nLTQ ion trap CID"}

topk, _ = read_tsv(need)
topk = topk[(topk.truth == TRUTH) & (topk.rule == "flank") & topk.profile.isin(PROF)]
pxds = [p for p in ORDER if p in set(topk.pxd)] + sorted(set(topk.pxd) - set(ORDER))

fig = plt.figure(figsize=(7.2, 6.6), layout="constrained")
top, bottom = fig.subfigures(2, 1, height_ratios=[1, 1.05])
gsA = top.add_gridspec(1, max(len(pxds), 1))

# A: top-k curves per dataset
axA = []
for i, pxd in enumerate(pxds):
    ax = top.add_subplot(gsA[0, i], sharey=axA[0] if axA else None)
    axA.append(ax)
    d = topk[topk.pxd == pxd]
    for prof, (lab, col, ls) in PROF.items():
        s = d[d.profile == prof].sort_values("k")
        if len(s):
            ax.plot(s["k"], 100 * s["rate"], color=col, ls=ls, lw=1.6, label=lab)
    ax.set_xscale("log")
    ax.set_xticks([1, 5, 50], ["1", "5", "50"])
    ax.set_title(LABEL.get(pxd, pxd), fontsize=7.5)
    ax.set_xlabel("top k", fontsize=8)
    if i:
        plt.setp(ax.get_yticklabels(), visible=False)
    else:
        ax.set_ylabel("Tagged PSM spectra with\na correct tag in top k (%)", fontsize=8)
axA[0].text(-0.55, 1.18, "A", transform=axA[0].transAxes, fontsize=11, fontweight="bold")
h, l = axA[0].get_legend_handles_labels()
top.legend(h, l, loc="outside upper center", ncol=4, fontsize=7)
axB, axC, axD = bottom.subplots(1, 3)
# B: precision by tag length (matched settings, pooled over datasets) with chance
f = R / f"tag_accuracy_by_length_{V}.tsv"
if f.exists():
    bl, _ = read_tsv(f)
    bl = bl[(bl.truth == TRUTH) & (bl.rule == "flank") & (bl.pxd == "PXD003531")]
    bl = bl[bl.profile.str.match(r"^(fastag|directag)_matched(_tl\d+)?$")].copy()
    bl["tool"] = bl.profile.str.split("_").str[0]
    bl["length"] = pd.to_numeric(bl["length"], errors="coerce")
    g = bl.groupby(["tool", "control", "length"], as_index=False)[["tags", "correct"]].sum()
    g["precision"] = 100 * g["correct"] / g["tags"]
    w = 0.38
    for j, (tool, col) in enumerate((("fastag", PALETTE[0]), ("directag", PALETTE[1]))):
        s = g[(g.tool == tool) & (g.control == "none")].sort_values("length")
        c = g[(g.tool == tool) & (g.control != "none")].sort_values("length")
        x = s["length"] + (j - 0.5) * w
        axB.bar(x, s["precision"], width=w, color=col, label="FASTag" if tool == "fastag" else "DirecTag")
        if len(c):
            axB.scatter(c["length"] + (j - 0.5) * w, c["precision"], marker="_", s=60, color=INK, zorder=3,
                        label="chance (shuffled)" if j == 0 else None)
    axB.set_xticks(sorted(g["length"].unique()))
    axB.set_xlabel("Tag length, PXD003531")
    axB.set_ylabel("Per-tag precision (%)")
    axB.legend(fontsize=6.5, loc="upper right")
axB.text(-0.32, 1.04, "B", transform=axB.transAxes, fontsize=11, fontweight="bold")

# C: E-value densities, FASTag defaults
f = R / f"tag_accuracy_evalue_density_{V}.tsv"
if f.exists():
    ed, _ = read_tsv(f)
    ed = ed[(ed.truth == TRUTH) & (ed.profile == "fastag_default") & (ed.subset == "all tags")]
    for cls, ls in (("correct", "-"), ("incorrect", "--")):
        s = ed[ed["class"] == cls].groupby(["log10e_lo", "log10e_hi"], as_index=False)["tags"].sum()
        tot = s["tags"].sum()
        if tot:
            mid = (s.log10e_lo + s.log10e_hi) / 2
            axC.plot(mid, s["tags"] / tot / (s.log10e_hi - s.log10e_lo), color=PALETTE[0] if cls == "correct" else MUTED,
                     ls=ls, lw=1.6, label=f"{cls} ({tot:,} tags)")
    axC.set_xlabel("log10 E-value (FASTag)")
    axC.set_ylabel("Density")
    axC.legend(fontsize=7)
axC.text(-0.32, 1.04, "C", transform=axC.transAxes, fontsize=11, fontweight="bold")

# D: sweeps, rank-1 vs wall time
for kind, col, mk, key in (("gap_penalty", PALETTE[2], "o", "gap_penalty"), ("peak_budget", PALETTE[3], "s", None)):
    f = R / f"{kind}_pxd000001_{V}.tsv"
    if not f.exists():
        continue
    sw, _ = read_tsv(f)
    sw = sw[sw.truth == TRUTH]
    axD.plot(sw["wall_min_s"], sw["rank1_pct"], marker=mk, color=col, ls="none",
             label="-gap_penalty" if kind == "gap_penalty" else "peak budget")
    if key:  # gap penalties share one wall time: label to the left; 100 to 10,000 lie within 0.3 points
        hi = sw[sw.gap_penalty >= 100]
        for _, r in sw[sw.gap_penalty < 100].iterrows():
            axD.annotate(f"{r['gap_penalty']:g}", (r["wall_min_s"], r["rank1_pct"]), xytext=(-6, 0),
                         textcoords="offset points", fontsize=6.5, color="#0f7a53", ha="right", va="center")
        if len(hi):
            axD.annotate(f"{hi.gap_penalty.min():g}–{hi.gap_penalty.max():,.0f}", (hi.wall_min_s.min(), hi.rank1_pct.mean()),
                         xytext=(0, 9), textcoords="offset points", fontsize=6.5, color="#0f7a53", ha="center",
                         va="bottom")
    else:    # peak budgets: flat budget in peaks, per-window quota as n/w; 10/w is the default (= gap penalty 100)
        place = {"10/w": ((-8, 5), "right"), "400": ((3, -9), "right"), "800": ((-3, -9), "left"), "5/w": ((-6, 0), "right"), "50": ((-6, 0), "right"),
                 "100": ((5, -7), "left"), "20/w": ((0, 9), "center"), "200": ((0, 9), "center")}
        for _, r in sw.iterrows():
            ppw = int(r["peaks_per_window"])
            lab = f"{int(r['max_peaks'])}" if ppw == 0 else f"{ppw}/w"
            off, ha = place.get(lab, ((0, -9), "center"))
            axD.annotate(lab, (r["wall_min_s"], r["rank1_pct"]), fontsize=6.5, color="#9a6a00", xytext=off,
                         textcoords="offset points", ha=ha, va="center")
axD.set_xlabel("Wall time, 1 thread (s)")
axD.set_xlim(0.6, 8.8); axD.set_ylim(67.5, 85.6); axD.set_xticks([2, 4, 6, 8]); axD.set_yticks(range(68, 86, 2))
axD.set_ylabel("Rank-1 correct (%)")
if axD.lines:
    axD.legend(fontsize=7, loc="lower right")
axD.text(-0.32, 1.04, "D", transform=axD.transAxes, fontsize=11, fontweight="bold")

out = Path(a.out)
out.mkdir(parents=True, exist_ok=True)
for ext in ("pdf", "png"):
    fig.savefig(out / f"{a.name}.{ext}", dpi=300 if ext == "png" else None)
plt.close(fig)
print(out / f"{a.name}.pdf")
