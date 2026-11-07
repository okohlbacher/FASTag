#!/usr/bin/env python3
"""Peak RSS of FASTag 1.7.0 (same reader as 1.8.0) on PXD003531 by input format and thread count.
Source: results/regression_pxd003531_v161_vs_v170.tsv.
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

a = args("fig_memory_threads")
df, _ = read_tsv(Path(a.results) / "regression_pxd003531_v161_vs_v170.tsv")
df = df[df["case"].isin(["mzml", "point", "chunked"]) & (df["bin"] == "new")]
m = (df.groupby(["case", "threads"])["maxrss_kb"].max() / 1024).reset_index()
names = {"mzml": "mzML", "point": "mzPeak (point)", "chunked": "mzPeak (chunked)"}
fig, ax = plt.subplots(figsize=(4.2, 3.2))
for i, case in enumerate(["mzml", "point", "chunked"]):
    s = m[m["case"] == case].sort_values("threads")
    ax.plot(s["threads"], s["maxrss_kb"], marker=MARKERS[i], color=PALETTE[i], label=names[case])
ax.set_xscale("log", base=2)
ax.set_xticks([1, 16, 64], ["1", "16", "64"])
ax.set_ylim(0, None)
ax.set_xlabel("Threads")
ax.set_ylabel("Peak RSS (MB, max of 4)")
ax.legend(fontsize=8)
save(fig, a)
