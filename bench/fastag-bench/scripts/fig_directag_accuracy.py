#!/usr/bin/env python3
"""Share of the 2,254 identified PXD000001 spectra with a valid tag within the top k, FASTag vs
DirecTag 1.4.21142 at DirecTag's settings. Source: results/directag_accuracy_pxd000001.tsv (pre-port FASTag 1.2.x);
--suffix v190: directag_accuracy_pxd000001_v190.tsv (FASTag 1.9.0, both tools scored by the harness flank rule).
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

a = args("fig_directag_accuracy", versioned=True)
df, _ = read_tsv(Path(a.results) / f"directag_accuracy_pxd000001{'_' + a.suffix if a.suffix else ''}.tsv")
fig, ax = plt.subplots(figsize=(4.0, 3.0))
ax.plot(df["top_k"], df["fastag_pct"], marker=MARKERS[0], color=PALETTE[0], label="FASTag")
ax.plot(df["top_k"], df["directag_pct"], marker=MARKERS[1], color=PALETTE[1], ls="--", label="DirecTag")
ax.set_xscale("log")
ax.set_xticks(df["top_k"], [str(k) for k in df["top_k"]])
ax.set_xlabel("Tags considered per spectrum (top k)")
ax.set_ylabel("Spectra with a valid tag (%)")
ax.annotate(f"{df['fastag_pct'].iloc[0]:.1f}%", (1, df["fastag_pct"].iloc[0]), textcoords="offset points", xytext=(8, 3), va="center", fontsize=8)
ax.annotate(f"{df['directag_pct'].iloc[0]:.1f}%", (1, df["directag_pct"].iloc[0]), textcoords="offset points", xytext=(8, -3), va="center", fontsize=8)
ax.legend()
save(fig, a)
