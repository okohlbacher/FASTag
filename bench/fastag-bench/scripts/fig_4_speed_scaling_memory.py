#!/usr/bin/env python3
"""Figure 4: speed, thread scaling and memory of FASTag and DirecTag 1.4.21142 on node kim.
A speed-up vs threads (FASTag defaults on mzML, DirecTag matched settings); B spectra/s; C peak RSS vs mzML size;
D phase times at 64 threads. Sources: results/ladder_summary_<suffix>.tsv, ladder_directag_status_<suffix>.tsv
(scripts/ladder/ladder_run.sh, load-gated) and ladder_inputs_v180.tsv (the same inputs for both ladders).
--suffix v190 (default): FASTag 1.9.0 ladder (DirecTag rows reused from the 1.8.0 ladder); --suffix '' or v180:
the FASTag 1.8.0 ladder ('' writes the unsuffixed figure name). Peak RSS is ru_maxrss, a lower bound on Linux >= 6.2.
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

a = args("fig4_speed_scaling_memory", versioned=True)
V = a.suffix or "v180"  # unsuffixed figure = 1.8.0 ladder
R = Path(a.results)
s, _ = read_tsv(R / f"ladder_summary_{V}.tsv")
inp, _ = read_tsv(R / "ladder_inputs_v180.tsv")
inp = inp[inp["format"] == "mzML"].set_index("dataset")
s["base"] = s["dataset"].str.replace(r"_(cvpatch|countpatch)$", "", regex=True)
order = [d for d in inp.sort_values("bytes").index if d in set(s["dataset"])]
col = {d: PALETTE[i % len(PALETTE)] for i, d in enumerate(order)}
mk = {d: MARKERS[i % len(MARKERS)] for i, d in enumerate(order)}
lab = {d: f"{d} ({inp.loc[d, 'label']})" for d in order}
# DirecTag: rows of the input it could read (the original mzML or its header-patched copy, see
# ladder_inputs_v180.tsv); a base dataset without such rows is shown with its failure
status = {}
fpath = R / f"ladder_directag_status_{V}.tsv"
if fpath.exists():
    st, _ = read_tsv(fpath)
    status = dict(zip(st["dataset"], st["status"]))
ok_ids = {k for k, v in status.items() if v == "ok"}
DT = s[(s.tool == "directag") & s.dataset.isin(ok_ids)]
patched = {b for b, i in zip(DT.base, DT.dataset) if b != i}
fail = {}
for d in order:
    if d not in set(DT.base):
        fail[d] = status.get(d, "not run").replace(" MS2 written", " written")
    elif d in patched:
        fail[d] = "original mzML refused; header-patched copy shown"
fd0 = s[(s.tool == "fastag") & (s.profile == "default") & (s.format == "mzML")]
ms2 = {d: fd0[fd0.dataset == d].spectra.max() for d in order}   # input MS2 spectra (FASTag count)

fig, axs = plt.subplots(2, 2, figsize=(7.2, 7.4))
# A: speed-up vs threads, FASTag defaults on mzML (solid), DirecTag matched (dashed)
ax = axs[0, 0]
fd = s[(s.tool == "fastag") & (s.profile == "default") & (s.format == "mzML") & s.dataset.isin(order)]
for d in order:
    g = fd[fd.dataset == d].sort_values("threads")
    ax.plot(g.threads, g.speedup, marker=mk[d], color=col[d], label=lab[d], ms=4)
    g = DT[DT.base == d].sort_values("threads")
    if len(g) > 1 and g.threads.min() == 1:   # speed-up needs a 1-thread DirecTag run
        ax.plot(g.threads, g.speedup, ls="--", marker=mk[d], color=col[d], ms=4, mfc="white", lw=1.4)
tmax = fd.threads.max()
ax.plot([1, tmax], [1, tmax], color=MUTED, lw=1, ls=":", label="ideal")
ax.set_xscale("log", base=2); ax.set_yscale("log", base=2)
tk = [t for t in (1, 4, 16, 64, 256) if t <= tmax]
ax.set_xticks(tk, [str(t) for t in tk]); ax.set_yticks(tk, [str(t) for t in tk])
ax.set_xlabel("Threads"); ax.set_ylabel("Speed-up over 1 thread")
ax.set_title("A  Thread scaling (solid FASTag, dashed DirecTag)", loc="left", fontsize=9)
ax.legend(fontsize=6, loc="upper center", bbox_to_anchor=(0.5, -0.2), ncol=2, columnspacing=1.0)

# B: spectra/s per tool and dataset
ax = axs[0, 1]
y = np.arange(len(order))[::-1]
series = [("FASTag defaults, best", lambda d: fd[fd.dataset == d].spectra_per_s.max(), PALETTE[0], "o"),
          ("FASTag matched, 64 thr", lambda d: s[(s.tool == "fastag") & (s.profile == "matched") & (s.dataset == d) & (s.threads == 64)].spectra_per_s.max(), PALETTE[2], "s"),
          ("DirecTag matched, 64 thr", lambda d: (ms2[d] / DT[(DT.base == d) & (DT.threads == 64)].wall_min_s.min()), PALETTE[1], "D")]
for name, f, c, m in series:
    v = [f(d) for d in order]
    ax.scatter(v, y, color=c, marker=m, label=name, zorder=3, s=22)
for yi, d in zip(y, order):
    if d in fail:
        ax.text(0.02, yi + 0.18, f"DirecTag: {fail[d]}", transform=ax.get_yaxis_transform(), ha="left", va="bottom", fontsize=6, color=MUTED)
ax.set_xscale("log"); ax.set_yticks(y, order, fontsize=7)
ax.set_xlabel("Input MS2 spectra per second (wall)")
ax.set_title("B  Throughput", loc="left", fontsize=9)
ax.set_ylim(-1.9, len(order) - 0.5)
ax.legend(fontsize=6, loc="lower left", ncol=1, handletextpad=0.2)
ax.grid(axis="y", visible=False)

# C: peak RSS vs mzML size, FASTag defaults (1 and 64 threads) and DirecTag matched (64 threads)
ax = axs[1, 0]
# colour = data set (as in A); marker = tool and thread count
for name, sel, m in (("FASTag defaults, 1 thread", (fd.threads == 1), "o"),
                     ("FASTag defaults, 64 threads", (fd.threads == 64), "^")):
    g = fd[sel]
    cs = [col[d] for d in g.dataset]
    ax.scatter([inp.loc[d, "bytes"] / 1e9 for d in g.dataset], g.rss_mb_max / 1024, marker=m, s=26, zorder=3,
               facecolors="white" if m == "o" else cs, edgecolors=cs, linewidths=1.2)
    ax.scatter([], [], marker=m, s=26, facecolors="white" if m == "o" else MUTED, edgecolors=MUTED, label=name)
g = DT[DT.threads == 64]
ax.scatter([inp.loc[d, "bytes"] / 1e9 for d in g.base], g.rss_mb_max / 1024, color=[col[d] for d in g.base], marker="D",
           s=26, zorder=3)
ax.scatter([], [], color=MUTED, marker="D", s=26, label="DirecTag matched, 64 threads")
ax.set_xscale("log"); ax.set_yscale("log")
from matplotlib.ticker import FuncFormatter, NullFormatter
ax.yaxis.set_major_formatter(FuncFormatter(lambda v, _: f"{v:g}")); ax.yaxis.set_minor_formatter(NullFormatter())
ax.xaxis.set_major_formatter(FuncFormatter(lambda v, _: f"{v:g}"))
ax.set_xlabel("mzML size (GB)"); ax.set_ylabel("Peak RSS, ru_maxrss (GB, lower bound)")
ax.set_title("C  Memory vs file size", loc="left", fontsize=9)
ax.legend(fontsize=6, loc="upper left")
ax.text(0.99, 0.02, "colours: data sets as in A", transform=ax.transAxes, ha="right", va="bottom", fontsize=6, color=MUTED)

# D: phase breakdown at 64 threads, mzML (FASTag: open+index, read+tag, write, teardown; DirecTag: read, tag)
ax = axs[1, 1]
g = fd[fd.threads == 64].set_index("dataset")
dt = DT[DT.threads == 64].set_index("base")
x = np.arange(len(order))
w = 0.38
parts = [("t_open_median", "t_pre_loop_median", "open + index"), ("t_parallel_median", None, "read + tag (parallel)"),
         ("t_write_median", None, "final write"), ("t_teardown_median", None, "teardown")]
bottom = np.zeros(len(order))
for i, (c1, c2, name) in enumerate(parts):
    v = np.array([(g.loc[d, c1] if d in g.index else 0) + (g.loc[d, c2] if c2 and d in g.index else 0) for d in order], float)
    ax.bar(x - w / 2, v, w, bottom=bottom, color=PALETTE[i], label=f"FASTag {name}")
    bottom += v
bd = np.zeros(len(order))
for i, (c1, name) in enumerate((("t_pre_loop_median", "read (serial)"), ("t_parallel_median", "tag"))):
    v = np.array([dt.loc[d, c1] if d in dt.index and c1 in dt else 0 for d in order], float)
    ax.bar(x + w / 2, v, w, bottom=bd, color=PALETTE[i], hatch="///", edgecolor="white", lw=0, label=f"DirecTag {name}")
    bd += v
ax.set_yscale("symlog", linthresh=1)
ax.set_xticks(x, order, rotation=30, ha="right", fontsize=7)
ax.set_ylabel("Seconds (median, 64 threads)")
ax.set_title("D  Phases (left FASTag, right DirecTag)", loc="left", fontsize=9)
ax.legend(fontsize=6, ncol=2, loc="upper center", bbox_to_anchor=(0.5, -0.3), columnspacing=1.0)
ax.grid(axis="x", visible=False)
save(fig, a)
