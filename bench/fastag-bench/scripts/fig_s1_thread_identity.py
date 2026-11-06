#!/usr/bin/env python3
"""Figure S1: thread-count independence of FASTag's tag table across the thread ladder. One row per data set,
settings profile and input format, one column per thread count; a cell is filled when the cell ran, its colour
names the distinct tag-table SHA-256 within the data set, its number is the count of runs; the letter of each digest
(A = digest of default settings on mzML) and its first eight hexadecimal digits are given at right. Source: results/ladder_raw_v190.tsv (FASTag rows, exit 0; --suffix '' = ladder_raw_v180.tsv,
the FASTag 1.8.0 ladder). Control runs on patched inputs and the -out_spectra rows are not shown.
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
from matplotlib.patches import Rectangle

a = args("fig_s1_thread_identity", versioned=True)
raw, _ = read_tsv(Path(a.results) / f"ladder_raw_{a.suffix or 'v180'}.tsv")
f = raw[(raw["tool"] == "fastag") & (raw["exit"] == 0) & raw["sha256"].notna()
        & raw["profile"].isin(["default", "matched"]) & ~raw["dataset"].str.contains("_")].copy()
f["threads"] = f["threads"].astype(int)
datasets = sorted(f["dataset"].unique())
formats = ["mzML", "point", "chunked"]
fmt_lab = {"mzML": "mzML", "point": "point mzPeak", "chunked": "chunked mzPeak"}
threads = sorted(f["threads"].unique())
rows = []  # (dataset, profile, format)
for d in datasets:
    for p in ("default", "matched"):
        for fm in formats:
            if len(f[(f["dataset"] == d) & (f["profile"] == p) & (f["format"] == fm)]):
                rows.append((d, p, fm))

fig_h = 0.9 + 0.22 * len(rows)
fig, ax = plt.subplots(figsize=(7.0, fig_h))
ax.grid(False)
for s in ax.spines.values():
    s.set_visible(False)
letters = "ABCDEFGH"
right = []
y = 0
prev = None
for d, p, fm in rows:
    grp = f[f["dataset"] == d].copy()  # letters per data set over both profiles: default mzML first
    grp["_o"] = grp["profile"].map({"default": 0, "matched": 1}) * 10 + grp["format"].map(
        {"mzML": 0, "point": 1, "chunked": 2})
    order = list(dict.fromkeys(grp.sort_values(["_o", "threads"])["sha256"]))
    cell = grp[(grp["profile"] == p) & (grp["format"] == fm)]
    if prev is not None and prev != d:
        y += 0.5  # gap between data sets
    prev = d
    for j, t in enumerate(threads):
        c = cell[cell["threads"] == t]
        if not len(c):
            ax.add_patch(Rectangle((j, y), 0.92, 0.84, facecolor="white", edgecolor=GRID, lw=0.6))
            continue
        shas = list(dict.fromkeys(c["sha256"]))
        k = order.index(shas[0])
        ax.add_patch(Rectangle((j, y), 0.92, 0.84, facecolor=PALETTE[k % len(PALETTE)], alpha=0.85,
                               edgecolor="white", lw=0.6))
        lab = str(len(c)) if len(shas) == 1 else f"{len(c)}!"
        ax.text(j + 0.46, y + 0.45, lab, ha="center", va="center", fontsize=6.5, color="white")
    shas = list(dict.fromkeys(cell["sha256"]))
    tags = cell["tags"].dropna()
    ax.text(-0.25, y + 0.42, f"{d}  {p}  {fmt_lab[fm]}", ha="right", va="center", fontsize=7)
    ax.text(len(threads) + 0.15, y + 0.42,
            ", ".join(f"{letters[order.index(s)]} {s[:8]}" for s in shas)
            + (f"  ({int(tags.iloc[0]):,} tags)" if len(tags) and tags.nunique() == 1 else ""),
            ha="left", va="center", fontsize=6.5, family="monospace")
    y += 1
ax.set_xlim(-0.1, len(threads) + 0.1)
ax.set_ylim(y + 0.1, -0.6)
ax.set_yticks([])
ax.set_xticks([j + 0.46 for j in range(len(threads))], [str(t) for t in threads], fontsize=7)
ax.xaxis.set_ticks_position("top")
ax.tick_params(length=0)
ax.xaxis.set_label_position("top")
ax.set_xlabel("Threads", fontsize=8, labelpad=6)
ax.text(len(threads) + 0.15, -0.3, "Tag-table SHA-256", ha="left", va="bottom", fontsize=7)
fig.subplots_adjust(left=0.30, right=0.72, top=1 - 0.75 / fig_h, bottom=0.12 / fig_h)
out = Path(a.out)
out.mkdir(parents=True, exist_ok=True)
for ext in ("pdf", "png"):
    fig.savefig(out / f"{a.name}.{ext}", dpi=300 if ext == "png" else None, bbox_inches="tight")
plt.close(fig)
print(out / f"{a.name}.pdf")
