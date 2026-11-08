#!/usr/bin/env python3
"""Species report on PXD003531 (human) with the bundled k=7 index: spectra with evidence for the
top genera. Source: results/species_pxd003531_gate.tsv (1.6.1 refs, byte-identical in 1.8.0);
--suffix v190: species_pxd003531_gate_v190.tsv.
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
import matplotlib.ticker  # noqa: E402
a = args("fig_species_gate", versioned=True)
df, _ = read_tsv(Path(a.results) / f"species_pxd003531_gate{'_' + a.suffix if a.suffix else ''}.tsv")
top = df.head(12)
y = np.arange(len(top))[::-1]
fig, ax = plt.subplots(figsize=(4.2, 3.4))
ax.barh(y, top["observed"], color=[PALETTE[0]] + [MUTED] * (len(top) - 1), height=0.7)
ax.set_yticks(y, top["name"], fontsize=8)
for yi, v in zip(y, top["observed"]):
    ax.text(v, yi, f" {v:,}", va="center", fontsize=7, color=INK)
ax.set_xlabel("Spectra with taxon evidence")
ax.grid(axis="y", visible=False)
ax.set_xlim(0, top["observed"].max() * 1.18)
ax.xaxis.set_major_locator(matplotlib.ticker.MaxNLocator(4))
ax.xaxis.set_major_formatter(matplotlib.ticker.StrMethodFormatter("{x:,.0f}"))
save(fig, a)
