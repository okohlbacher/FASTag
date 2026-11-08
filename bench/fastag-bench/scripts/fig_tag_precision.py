#!/usr/bin/env python3
"""Tag ranking against Sage 1% FDR PSMs from 'fastag-bench run/score': share of tagged PSM spectra
with a correct tag within the top k (tag or reverse is a substring of the peptide, I=L), one line per dataset and tool;
de novo reference curves (tags derived from Casanovo/InstaNovo/Novor/PepNovo+ peptides) from
results/denovo_rank_curves.tsv are added with the same correctness rule.
Source: results/benchmark/<dataset>/rank_curve_*.tsv. Exits quietly when no benchmark results exist.
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

a = args("fig_tag_precision")
files = sorted(Path(a.results).glob("benchmark/*/rank_curve_*.tsv"))
if not files:
    print("no results/benchmark/*/rank_curve_*.tsv yet; run 'fastag-bench run' and 'fastag-bench score' first")
    sys.exit(0)
fig, ax = plt.subplots(figsize=(4.2, 3.2))
TOOL = {"fastag": ("FASTag", PALETTE[0], "-"), "directag": ("DirecTag", PALETTE[1], "--")}  # colour follows the tool
datasets = sorted({f.parent.name for f in files})
rules = set()
for f in files:
    df, prov = read_tsv(f)
    rules.add("flank" if any("flank" in line for line in prov) else "sequence")
    name, color, ls = TOOL.get(f.stem.replace("rank_curve_", ""), (f.stem, MUTED, ":"))
    mk = MARKERS[datasets.index(f.parent.name) % len(MARKERS)]
    ax.plot(df["k"], 100 * df["rate"], color=color, ls=ls, marker=mk, markevery=[0, 4, 9, len(df) - 1],
            label=name if len(datasets) == 1 else f"{f.parent.name.split('_')[0]}, {name}")
# De novo reference points (results/denovo_rank_curves.tsv from 'python -m fastag_bench.denovo'): tags
# derived from the top de novo peptide, tag length 3, for the datasets plotted above, scored with the
# same rule as the curves above (read from their provenance lines; skipped if they mix rules).
dn_file = Path(a.results) / "denovo_rank_curves.tsv"
if dn_file.exists() and len(rules) == 1:
    dn, _ = read_tsv(dn_file)
    dn = dn[(dn["rule"] == next(iter(rules))) & (dn["tag_length"].astype(str) == "3") & dn["dataset"].isin(datasets)
            & (dn["tags_from"] != "native")]
    DN = {"Casanovo": PALETTE[2], "InstaNovo": PALETTE[3], "Novor": PALETTE[4], "PepNovo+": MUTED}
    for (ds_id, tool), g in dn.groupby(["dataset", "tool"], sort=False):
        mk = MARKERS[datasets.index(ds_id) % len(MARKERS)]
        ax.plot(g["k"], 100 * g["rate"], color=DN.get(tool, MUTED), ls="-.", lw=1.5, marker=mk, mfc="white",
                markevery=[0, 4, 9, len(g) - 1],
                label=f"{tool} (derived)" if len(datasets) == 1 else f"{ds_id.split('_')[0]}, {tool} (derived)")
ax.set_xscale("log")
ax.set_xticks([1, 5, 10, 50], ["1", "5", "10", "50"])
ax.set_xlabel("Tags considered per spectrum (top k)")
ax.set_ylabel("Tagged PSM spectra with a correct tag (%)")
ax.legend(fontsize=6, loc="lower right", title=datasets[0].split("_")[0] if len(datasets) == 1 else None, title_fontsize=7)
save(fig, a)
