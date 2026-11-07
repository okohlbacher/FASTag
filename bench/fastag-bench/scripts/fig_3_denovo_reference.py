#!/usr/bin/env python3
"""Figure 3 (de novo reference points): top-1 tag precision of FASTag tags and of tags derived from
full-peptide de novo predictions (Casanovo, InstaNovo, Novor, PepNovo+), against Sage 1% FDR PSMs,
one panel per dataset. Bar = flank rule (tag or reverse is a substring of the PSM peptide, I=L, and
one flanking mass agrees within 0.05 Da); open circle = sequence-only rule; tick = shuffled-peptide
chance level (flank rule; near 0). Lower row: share of PSM spectra whose top de novo peptide equals the
Sage peptide (residues, I=L). Source: results/denovo_tag_accuracy.tsv, denovo_peptide_accuracy.tsv
(python -m fastag_bench.denovo). Exits quietly when the tables do not exist.
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

a = args("fig_3_denovo_reference", versioned=True)
S = f"_{a.suffix}" if a.suffix else ""  # 1.8.0 tables have no suffix
tag_f, pep_f = Path(a.results) / f"denovo_tag_accuracy{S}.tsv", Path(a.results) / f"denovo_peptide_accuracy{S}.tsv"
if not tag_f.exists():
    print(f"no results/denovo_tag_accuracy{S}.tsv yet; run 'python -m fastag_bench.denovo config/denovo-data.yaml'")
    sys.exit(0)
K = 3  # FASTag default tag length
t, _ = read_tsv(tag_f)
pep = read_tsv(pep_f)[0] if pep_f.exists() else pd.DataFrame(columns=["pxd", "tool", "peptide_exact_recall"])
ORDER = ["FASTag", "Casanovo", "InstaNovo", "Novor", "PepNovo+", "PepNovo+ tags"]
# colour follows the tool (FASTag and DirecTag keep their Figure 3 colours; PepNovo+ is recessive grey,
# its native tag mode is the same colour, hatched)
COLOR = {"FASTag": PALETTE[0], "Casanovo": PALETTE[2], "InstaNovo": PALETTE[3], "Novor": PALETTE[4],
         "PepNovo+": MUTED, "PepNovo+ tags": MUTED}
LABEL = {"FASTag": "FASTag tags", "Casanovo": "Casanovo", "InstaNovo": "InstaNovo", "Novor": "Novor",
         "PepNovo+": "PepNovo+", "PepNovo+ tags": "PepNovo+ tag mode"}
t = t[(t["tag_length"].astype(str) == str(K))]
pxds = list(dict.fromkeys(t["pxd"]))
fig, axes = plt.subplots(2, len(pxds), figsize=(3.4 * len(pxds), 5.0), squeeze=False,
                         gridspec_kw={"height_ratios": [3, 2]})
for j, pxd in enumerate(pxds):
    ax, bx = axes[0, j], axes[1, j]
    d = t[t["pxd"] == pxd]
    tools = [x for x in ORDER if x in set(d["tool"])]
    y = list(range(len(tools)))[::-1]
    for yi, tool in zip(y, tools):
        g = d[d["tool"] == tool]
        fl = g[(g["rule"] == "flank") & (g["control"] == "none")]["top1_precision"].iloc[0]
        sq = g[(g["rule"] == "sequence") & (g["control"] == "none")]["top1_precision"].iloc[0]
        ch = g[(g["rule"] == "flank") & (g["control"] != "none")]["top1_precision"].iloc[0]
        ax.barh(yi, 100 * fl, height=0.62, color=COLOR[tool], edgecolor="white", linewidth=2,
                hatch="///" if tool.endswith("tags") else None)
        ax.plot(100 * sq, yi, "o", mfc="white", mec=INK, mew=1.2, ms=6, zorder=3)
        ax.plot([100 * ch] * 2, [yi - 0.36, yi + 0.36], color=INK, lw=1.5, zorder=3)
        ax.text(100 * fl - 1.5, yi, f"{100 * fl:.1f}", va="center", ha="right", fontsize=7, color="white",
                bbox={"boxstyle": "square,pad=0.1", "fc": COLOR[tool], "ec": "none"} if tool.endswith("tags") else None)
    ax.set_yticks(y, [LABEL[x] for x in tools])
    ax.set_xlim(0, 100)
    ax.set_title(f"{pxd}, tag length {K}")
    ax.set_xlabel("Top-1 tag precision (%)")
    ax.grid(axis="y", visible=False)
    ax.set_axisbelow(True)
    p = pep[pep["pxd"] == pxd]
    ptools = [x for x in ORDER if x in set(p["tool"])]
    py = list(range(len(ptools)))[::-1]
    for yi, tool in zip(py, ptools):
        v = 100 * p[p["tool"] == tool]["peptide_exact_recall"].iloc[0]
        bx.barh(yi, v, height=0.62, color=COLOR[tool], edgecolor="white", linewidth=2)
        bx.text(v + 1.5, yi, f"{v:.1f}", va="center", ha="left", fontsize=7, color=INK)
    bx.set_yticks(py, [LABEL[x] for x in ptools])
    bx.set_xlim(0, 100)
    bx.set_xlabel("Exact top peptide (% of PSM spectra)")
    bx.grid(axis="y", visible=False)
    bx.set_axisbelow(True)
h = [plt.Line2D([], [], color=MUTED, lw=6, label="flank rule"),
     plt.Line2D([], [], ls="", marker="o", mfc="white", mec=INK, label="sequence rule"),
     plt.Line2D([], [], color=INK, lw=1.5, label="chance (shuffled, flank)")]
axes[1, min(1, len(pxds) - 1)].legend(handles=h, fontsize=7, loc="upper right", handlelength=1.4, title="upper panels", title_fontsize=7)
save(fig, a)
