#!/usr/bin/env python3
"""Peak budget on PXD000001: rank-1 rate vs wall time for flat caps and the per-window quota
(default ppw 10 / cap 400). Source: results/peak_budget_pxd000001.tsv (v0.13 build; times not valid for 1.8.0); with
--suffix v180/v190 the harness sweep peak_budget_pxd000001_<suffix>.tsv (Mascot truth, min wall of 3 reps, 1 thread).
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

a = args("fig_peak_budget", versioned=True)
df, _ = read_tsv(Path(a.results) / f"peak_budget_pxd000001{'_' + a.suffix if a.suffix else ''}.tsv")
if "truth" in df:  # harness sweep: same columns as the v0.13 table
    df = df[df["truth"] == "mascot"].rename(columns={"wall_min_s": "wall_s"})
    df["setting"] = [f"cap {c}" if p == 0 else f"ppw {p} / cap {c}" + (" (default)" if (p, c) == (10, 400) else "")
                     for p, c in zip(df["peaks_per_window"], df["max_peaks"])]
flat = df[df["peaks_per_window"] == 0]
ppw = df[df["peaks_per_window"] > 0]
fig, ax = plt.subplots(figsize=(4.2, 3.0))
ax.plot(flat["wall_s"], flat["rank1_pct"], marker=MARKERS[0], color=PALETTE[0], label="flat cap")
ax.plot(ppw["wall_s"], ppw["rank1_pct"], marker=MARKERS[1], color=PALETTE[1], ls="none", ms=8, label="per-window quota")
OFFS = {"cap 50": (5, -2), "cap 100": (-14, 6), "cap 200": (-8, -12), "cap 400": (-10, -11), "cap 800": (-14, 6),
        "ppw 10 / cap 400 (default)": (-40, 7), "ppw 15 / cap 800": (-10, -12)}
if a.suffix:  # harness sweep: more settings, fewer collisions this way
    OFFS.update({"cap 25": (4, 4), "cap 100": (-14, -12), "cap 200": (-16, -12), "cap 400": (-14, 7),
                 "cap 800": (-4, -12), "ppw 5 / cap 400": (-30, 8), "ppw 15 / cap 800": (-30, -14),
                 "ppw 20 / cap 800": (-6, 8)})
for _, r in df.iterrows():
    ax.annotate(r["setting"].replace(" (default)", " (default)"), (r["wall_s"], r["rank1_pct"]), textcoords="offset points",
                xytext=OFFS.get(r["setting"], (4, 4)), fontsize=6.5, color=MUTED)
ax.set_xscale("log")
ax.xaxis.set_major_formatter(plt.FuncFormatter(lambda v, _: f"{v:g}"))
ax.xaxis.set_minor_formatter(plt.FuncFormatter(lambda v, _: f"{v:g}" if v in (2, 3, 5, 20, 30, 50) else ""))
ax.set_xlabel("Wall time (s)")
ax.set_ylabel("Rank-1 correct (%)")
ax.set_ylim(df["rank1_pct"].min() - 0.6, df["rank1_pct"].max() + 0.6)
ax.legend(loc="lower right", fontsize=8)
save(fig, a)
