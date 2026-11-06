#!/usr/bin/env python3
"""Wall time of FASTag and DirecTag on public runs (log scale). Emulated rows (x86-64 on Apple
silicon) are valid as ratios only; kim rows are native at 128 threads. All FASTag numbers are pre-port builds.
Source: results/directag_runtime_memory.tsv.
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
a = args("fig_directag_runtime")
df, _ = read_tsv(Path(a.results) / "directag_runtime_memory.tsv")
lab = [f"{p}, {t} thr{' (emul.)' if 'emul' in s else ''}" for p, t, s in zip(df["pxd"], df["threads"], df["setting"])]
y = np.arange(len(df))[::-1]
fig, ax = plt.subplots(figsize=(5.2, 3.6))
ax.barh(y + 0.2, df["fastag_wall_s"], height=0.38, color=PALETTE[0], label="FASTag")
ax.barh(y - 0.2, df["directag_wall_s"], height=0.38, color=PALETTE[1], label="DirecTag")
for yi, st in zip(y, df["directag_status"]):
    if st in ("failed", "0 spectra"):
        ax.text(df["directag_wall_s"].iloc[len(df) - 1 - int(yi)] * 1.15, yi - 0.2, "failed" if st == "failed" else "0 spectra",
                va="center", fontsize=7, color=MUTED)
ax.set_yticks(y, lab, fontsize=7)
ax.set_xscale("log")
ax.set_xlabel("Wall time (s)")
ax.grid(axis="y", visible=False)
ax.legend(loc="lower center", bbox_to_anchor=(0.5, 1.0), ncol=2, fontsize=8)
save(fig, a)
