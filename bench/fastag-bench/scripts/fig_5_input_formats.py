#!/usr/bin/env python3
"""Figure 5: mzML vs point and chunked mzPeak input, FASTag on node kim.
A sha256 identity of tags.tsv across formats and thread counts; B mzPeak wall time relative to mzML; C peak RSS by format;
D -out_spectra to .mzML and .mzpeak on the largest public archive. Sources: results/ladder_raw_<suffix>.tsv,
ladder_summary_<suffix>.tsv, ladder_outspectra_<suffix>.tsv and ladder_inputs_v180.tsv (the same inputs for both ladders).
--suffix v190 (default): FASTag 1.9.0 ladder; --suffix '' or v180: the FASTag 1.8.0 ladder ('' writes the unsuffixed
figure name). Peak RSS is ru_maxrss, a lower bound on Linux >= 6.2.
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

a = args("fig5_input_formats", versioned=True)
V = a.suffix or "v180"  # unsuffixed figure = 1.8.0 ladder
R = Path(a.results)
s, _ = read_tsv(R / f"ladder_summary_{V}.tsv")
raw, _ = read_tsv(R / f"ladder_raw_{V}.tsv")
inp, _ = read_tsv(R / "ladder_inputs_v180.tsv")
osp, _ = read_tsv(R / f"ladder_outspectra_{V}.tsv")
mz = inp[inp["format"] == "mzML"].set_index("dataset")
order = [d for d in mz.sort_values("bytes").index if d in set(s.dataset)]
fd = s[(s.tool == "fastag") & (s.profile == "default") & s.dataset.isin(order)]
FMT = ["mzML", "point", "chunked"]
FNAME = {"mzML": "mzML", "point": "mzPeak point", "chunked": "mzPeak chunked"}
LS = ["-", "--", ":", "-.", (0, (5, 1, 1, 1, 1, 1))]

fig = plt.figure(figsize=(7.2, 7.4))
gs = fig.add_gridspec(2, 2, height_ratios=[1, 1.08])
# A: identity table: per dataset and format, distinct sha256 over all thread counts and repetitions
ax = fig.add_subplot(gs[0, 0]); ax.axis("off")
r = raw[(raw.tool == "fastag") & (raw.profile == "default") & (raw["exit"] == 0)]
cells, colours = [], []
for d in order:
    row, crow = [], []
    for f in FMT:
        g = r[(r.dataset == d) & (r.format == f)]
        if g.empty:
            row.append("n/a"); crow.append("#f4f3ef"); continue
        sh = g.sha256.dropna().unique()
        row.append(f"{sh[0][:8]} ({len(g)})" if len(sh) == 1 else f"{len(sh)} hashes ({len(g)})")
        crow.append("#d6f0e4" if len(sh) == 1 else "#f8d9cc")
    alld = r[r.dataset == d].sha256.dropna().unique()
    row.append("yes" if len(alld) == 1 else f"no ({len(alld)})")
    crow.append("#d6f0e4" if len(alld) == 1 else "#f8d9cc")
    cells.append(row); colours.append(crow)
t = ax.table(cellText=[[c.replace(" (", "\n(") for c in row] for row in cells], cellColours=colours, rowLabels=order,
             colLabels=["mzML", "point", "chunked", "equal"], colWidths=[0.25, 0.25, 0.25, 0.14],
             bbox=[0.24, 0.0, 0.76, 0.92], cellLoc="center")
t.auto_set_font_size(False); t.set_fontsize(6.5)
for c in t.get_celld().values():
    c.set_edgecolor("white")
ax.set_title("A  Tag-table SHA-256 (runs), all thread counts", loc="left", fontsize=9)

# B: wall time of mzPeak relative to mzML, per dataset (line style) and layout (colour)
ax = fig.add_subplot(gs[0, 1])
for i, d in enumerate(order):
    m = fd[(fd.dataset == d) & (fd.format == "mzML")].set_index("threads").wall_min_s
    for j, f in enumerate(("point", "chunked")):
        g = fd[(fd.dataset == d) & (fd.format == f)].set_index("threads").wall_min_s
        k = g.index.intersection(m.index)
        if len(k):
            ax.plot(k, g[k] / m[k], color=PALETTE[j + 1], ls=LS[i % len(LS)], marker=MARKERS[i % len(MARKERS)], ms=3, lw=1.3,
                    label=f"{FNAME[f]}, {d}")
ax.axhline(1, color=MUTED, lw=1)
ax.set_xscale("log", base=2); ax.set_yscale("log", base=2)
tk = [1, 4, 16, 64, 256]
ax.set_xticks(tk, [str(t) for t in tk])
ax.set_xlabel("Threads"); ax.set_ylabel("Wall time / mzML wall time")
ax.set_title("B  Speed of mzPeak relative to mzML", loc="left", fontsize=9)
from matplotlib.ticker import FuncFormatter, NullFormatter
PLAIN = FuncFormatter(lambda v, _: f"{v:g}")
ax.yaxis.set_major_formatter(PLAIN); ax.yaxis.set_minor_formatter(NullFormatter())
ax.legend(fontsize=6, ncol=2, loc="upper center", bbox_to_anchor=(0.5, -0.2), handlelength=3.6, columnspacing=1.0)

# C: peak RSS vs threads per format (largest and smallest dataset)
ax = fig.add_subplot(gs[1, 0])
for i, d in enumerate([order[0], order[-1]] if len(order) > 1 else order):
    for j, f in enumerate(FMT):
        g = fd[(fd.dataset == d) & (fd.format == f)].sort_values("threads")
        if len(g):
            ax.plot(g.threads, g.rss_mb_max / 1024, color=PALETTE[j], ls=LS[i], marker=MARKERS[j], ms=3, lw=1.3,
                    label=f"{FNAME[f]}, {d}")
ax.set_xscale("log", base=2); ax.set_yscale("log")
ax.set_xticks(tk, [str(t) for t in tk])
ax.set_xlabel("Threads"); ax.set_ylabel("Peak RSS, ru_maxrss (GB, lower bound)")
ax.set_title("C  Memory by input format", loc="left", fontsize=9)
ax.set_yticks([0.25, 0.5, 1, 2, 4, 8], ["0.25", "0.5", "1", "2", "4", "8"]); ax.yaxis.set_minor_formatter(NullFormatter())
ax.legend(fontsize=6, ncol=2, loc="upper center", bbox_to_anchor=(0.5, -0.2), handlelength=3.6, columnspacing=1.0)

# D: -out_spectra memory and time on the largest archive
ax = fig.add_subplot(gs[1, 1])
o = osp.sort_values("order")
x = np.arange(len(o))
ax.bar(x, o.rss_mb_max / 1024, color=[PALETTE[i % len(PALETTE)] for i in range(len(o))])
for xi, (rss, w) in enumerate(zip(o.rss_mb_max, o.wall_min_s)):
    ax.text(xi, rss / 1024, f"{rss / 1024:.1f} GB\n{w:.0f} s", ha="center", va="bottom", fontsize=6)
ax.set_xticks(x, [c.replace("-out_spectra ", "+ ") for c in o.case], fontsize=7)
ax.set_ylabel("Peak RSS, ru_maxrss (GB, lower bound)")
ds = o.dataset.iloc[0] if len(o) else ""
th = int(o.threads.iloc[0]) if len(o) else 0
ax.set_title(f"D  -out_spectra, {ds}, {th} threads", loc="left", fontsize=9)
ax.margins(y=0.25)
ax.grid(axis="x", visible=False)
save(fig, a)
