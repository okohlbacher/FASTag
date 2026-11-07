#!/usr/bin/env python3
"""Figure 7: FASTag 1.8.0 digest, label and alkylation calls against public SDRF ground truth.
A protease confusion (shipped models; 'no call' column), B call margin of correct and wrong protease calls
(shipped and prose-auto models), C label confusion (prose-auto rule on -label_out plus FASTag's -massgap_out
SILAC call), D alkylation confusion (prose-auto rule on -massgap_out cysteine counts; 'unknown' = no call).
Source: results/fig7_confusion.tsv and results/table_s3_digest_truth.tsv (scripts/score_digest_truth.py);
--suffix v190 reads fig7_confusion_v190.tsv and table_s3_digest_truth_v190.tsv.
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

a = args("fig_digest_sdrf", versioned=True)
S = f"_{a.suffix}" if a.suffix else ""  # 1.8.0 tables have no suffix
conf, _ = read_tsv(Path(a.results) / f"fig7_confusion{S}.tsv")
runs, _ = read_tsv(Path(a.results) / f"table_s3_digest_truth{S}.tsv")
CMAP = LinearSegmentedColormap.from_list("blue", ["#f4f8fd", "#86b6ef", "#2a78d6", "#104281"])
ENZ = ["Trypsin", "Lys-C", "Arg-C", "Asp-N", "Glu-C", "Chymotrypsin", "Lys-N", "unspecific", "LysargiNase", "mixed"]
LAB = ["label-free", "TMT", "TMTpro/iTRAQ8", "iTRAQ4", "SILAC", "dimethyl", "isotope (unspecified)"]
ALK = ["Carbamidomethyl", "Methylthio", "Propionamide", "Nethylmaleimide", "Carboxymethyl", "none", "unknown"]
SHOW = {"Nethylmaleimide": "N-ethylmaleimide"}  # display names of the table values


def order(vals, pref, last=()):
    vals = list(dict.fromkeys(vals))
    out = [v for v in pref if v in vals and v not in last] + sorted(v for v in vals if v not in pref and v not in last)
    return out + [v for v in last if v in vals]


def heat(ax, panel, rows_pref, cols_pref, xlabel, ylabel, title, last=("no call",)):
    m = conf[conf["panel"] == panel]
    rows = order(m["truth"], rows_pref)
    cols = order(m["call"], rows_pref + cols_pref, last)
    mat = m.pivot_table(index="truth", columns="call", values="n", aggfunc="sum", fill_value=0)
    mat = mat.reindex(index=rows, columns=cols, fill_value=0)
    v = mat.values
    ax.imshow(np.log1p(v), cmap=CMAP, aspect="auto")
    for i in range(v.shape[0]):
        for j in range(v.shape[1]):
            if v[i, j]:
                ax.text(j, i, str(v[i, j]), ha="center", va="center", fontsize=6.5,
                        color="white" if np.log1p(v[i, j]) > 0.6 * np.log1p(v.max()) else INK,
                        fontweight="bold" if mat.index[i] == mat.columns[j] else "normal")
    ax.set_xticks(range(len(cols)), [SHOW.get(c, c) for c in cols], rotation=40, ha="right", fontsize=6.5)
    ax.set_yticks(range(len(rows)), [f"{SHOW.get(r, r)} ({int(v[i].sum())})" for i, r in enumerate(rows)], fontsize=6.5)
    ax.set_xlabel(xlabel)
    ax.set_ylabel(ylabel)
    ax.grid(False)
    ax.set_title(title, fontsize=8, color=MUTED, loc="left")


fig, axs = plt.subplots(2, 2, figsize=(7.2, 6.4))
heat(axs[0, 0], "A_protease_shipped", ENZ, [], "FASTag call (shipped models)", "SDRF cleavage agent",
     "A  protease")
# B: margins
ax = axs[0, 1]
for k, (m, lab) in enumerate((("shipped", "shipped"), ("prose", "prose-auto"))):
    d = runs[runs["enzyme_evaluable"].astype(str) == "True"]
    d = d[d[f"{m}_correct"].astype(str).isin(["True", "False"])]
    for j, (ok, col) in enumerate((("True", PALETTE[0]), ("False", PALETTE[1]))):
        y = d.loc[d[f"{m}_correct"].astype(str) == ok, f"{m}_margin"].astype(float).values
        x = np.full(len(y), 2 * k + j) + np.random.default_rng(1).uniform(-0.18, 0.18, len(y))
        ax.scatter(x, y, s=9, color=col, alpha=0.75, linewidths=0,
                   label=("correct" if ok == "True" else "wrong") if k == 0 else None)
        if len(y):
            ax.plot([2 * k + j - 0.3, 2 * k + j + 0.3], [np.median(y)] * 2, color=INK, lw=1.2)
            ax.text(2 * k + j, 0.98, f"n={len(y)}", ha="center", va="top", fontsize=6.5, color=MUTED,
                    transform=ax.get_xaxis_transform())
ax.set_xticks([0.5, 2.5], ["shipped", "prose-auto"])
ax.set_xlabel("protease models")
ax.set_ylabel("call margin (log-likelihood per tag)")
ax.legend(fontsize=7, loc="center right", markerscale=2.5, handletextpad=0.2)
ax.set_title("B  call margin (bar = median)", fontsize=8, color=MUTED, loc="left")
heat(axs[1, 0], "C_label_combined", LAB, [], "FASTag label call", "SDRF label", "C  label")
heat(axs[1, 1], "D_alkylation", ALK, [], "call from FASTag Cys counts", "SDRF Cys modification", "D  alkylation",
     last=("unknown",))
save(fig, a)
