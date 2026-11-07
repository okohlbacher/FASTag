#!/usr/bin/env python3
"""Public gate cases at 32 threads: wall time of FASTag 1.6.1 (reference) and 1.8.0. Smoke
figures on a shared node, not benchmarks. Source: results/gate_smoke_times.tsv.
--suffix v190: paired medians of gate_smoke_times_v190.tsv (6 order-alternating rounds, 1.8.0 build 0a502c77 vs
1.9.0); * marks the cases whose mzML reader path differs between the versions (speedup = reader, not tagging).
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
a = args("fig_gate_times", versioned=True)
fig, ax = plt.subplots(figsize=(4.6, 3.4))
if a.suffix:  # paired rounds: old = 1.8.0, new = the suffix's release
    df, _ = read_tsv(Path(a.results) / f"gate_smoke_times_{a.suffix}.tsv")
    y = np.arange(len(df))[::-1]
    new = ".".join(a.suffix.lstrip("v"))
    ax.barh(y + 0.2, df["paired_median_wall_s_v180"], height=0.38, color=PALETTE[1], label="1.8.0")
    ax.barh(y - 0.2, df[f"paired_median_wall_s_{a.suffix}"], height=0.38, color=PALETTE[0], label=new)
    star = df["reader_path_v180"] != df[f"reader_path_{a.suffix}"]
    ax.set_yticks(y, [f"{c} ({p}){' *' if s else ''}" for c, p, s in zip(df["case"], df["pxd"], star)], fontsize=7)
    ax.set_xlabel("Paired median wall time, 6 rounds (s)")
    ax.text(0.99, 1.01, "* different mzML reader path", transform=ax.transAxes, ha="right", va="bottom",
            fontsize=6.5, color=MUTED)
else:
    df, _ = read_tsv(Path(a.results) / "gate_smoke_times.tsv")
    y = np.arange(len(df))[::-1]
    ax.barh(y + 0.2, df["wall_s_v161"], height=0.38, color=PALETTE[1], label="1.6.1")
    ax.barh(y - 0.2, df["wall_s_v180"], height=0.38, color=PALETTE[0], label="1.8.0")
    ax.set_yticks(y, [f"{c} ({p})" for c, p in zip(df["case"], df["pxd"])], fontsize=7)
    ax.set_xlabel("Wall time (s)")
ax.grid(axis="y", visible=False)
ax.legend(fontsize=8, loc="lower right")
save(fig, a)
