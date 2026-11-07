#!/usr/bin/env python3
"""Extra wall time of the 1.8.0 reports (-digest_out, -label_out, -massgap_out): paired
differences with and without the option, 8 threads, three public runs. Source: results/digest_runtime_v180.tsv
(--suffix v190: digest_runtime_v190.tsv, ibminode05; compare deltas only, absolute times are from other nodes).
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
a = args("fig_digest_overhead", versioned=True)
df, _ = read_tsv(Path(a.results) / f"digest_runtime_{a.suffix or 'v180'}.tsv")
opts = ["digest_out", "label_out", "digest_out+label_out", "massgap_out"]
runs = list(dict.fromkeys(df["run"]))
short = dict(zip(df["run"], df["pxd"]))
fig, ax = plt.subplots(figsize=(4.4, 3.0))
ax.axhline(0, color=MUTED, lw=1)
for k, r in enumerate(runs):
    s = df[df["run"] == r]
    x = [opts.index(o) + (k - 1) * 0.18 for o in s["option"]]
    ax.plot(x, s["delta_s"], ls="none", marker=MARKERS[k], color=PALETTE[k], label=short[r])
ax.set_xticks(range(len(opts)), ["-digest_out", "-label_out", "both", "-massgap_out"], fontsize=8)
ax.set_ylabel("With minus without (s)")
ax.legend(fontsize=7)
save(fig, a)
