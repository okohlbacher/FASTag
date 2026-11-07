#!/usr/bin/env python3
"""Protease call of FASTag 1.8.0 (-digest_out, prose-auto models) vs the annotated enzyme over the
digest validation runs with a call and an annotation. Source: results/digest_val_runs.tsv (label provenance undocumented).
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
from matplotlib.colors import LinearSegmentedColormap
a = args("fig_digest_confusion")
df, _ = read_tsv(Path(a.results) / "digest_val_runs.tsv")
df = df[(df["in_termini_199"] == True) & (df["native_status"] == "call") & df["enzyme_truth"].notna()].copy()
norm = lambda s: str(s).replace(" (file name)", "").replace("unspecific cleavage", "unspecific")
df["truth"] = df["enzyme_truth"].map(norm)
df["called"] = df["native_call"].map(lambda c: "HLA-I/II" if str(c).startswith("HLA") else str(c))
order_t = [x for x in ["Trypsin", "Lys-C", "Arg-C", "Chymotrypsin", "Glu-C", "Asp-N", "unspecific", "LysargiNase"] if x in set(df["truth"])]
order_c = [x for x in ["Trypsin", "Lys-C", "Arg-C", "Chymotrypsin", "Glu-C", "Asp-N", "unspecific", "HLA-I/II"] if x in set(df["called"])]
mat = pd.crosstab(df["truth"], df["called"]).reindex(index=order_t, columns=order_c, fill_value=0)
cmap = LinearSegmentedColormap.from_list("blue", ["#f4f8fd", "#86b6ef", "#2a78d6", "#104281"])
fig, ax = plt.subplots(figsize=(4.8, 3.6))
ax.imshow(np.log1p(mat.values), cmap=cmap, aspect="auto")
for i in range(mat.shape[0]):
    for j in range(mat.shape[1]):
        v = mat.values[i, j]
        if v:
            ax.text(j, i, str(v), ha="center", va="center", fontsize=7,
                    color="white" if np.log1p(v) > 0.6 * np.log1p(mat.values.max()) else INK)
ax.set_xticks(range(len(order_c)), order_c, rotation=40, ha="right", fontsize=7)
ax.set_yticks(range(len(order_t)), order_t, fontsize=7)
ax.set_xlabel("FASTag call")
ax.set_ylabel("Annotated enzyme")
ax.grid(False)
n = int(mat.values.sum())
ax.set_title(f"{n} runs with a call and an annotation", fontsize=8, color=MUTED)
save(fig, a)
