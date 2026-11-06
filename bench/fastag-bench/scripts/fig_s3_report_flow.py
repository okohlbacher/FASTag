#!/usr/bin/env python3
"""Figure S3: flow of the public runs through the evaluation of the protease, label and alkylation reports
(Table S4). Exclusions are applied in the order shown; the last box of each column gives the evaluable runs and,
for the protease (FASTag's shipped models) and alkylation, the runs with a call. The evaluability rules are those
of scripts/score_digest_truth.py. Source: results/table_s3_digest_truth_v190.tsv (--suffix '' =
table_s3_digest_truth.tsv, FASTag 1.8.0 calls); results/massgap_absent_v190.tsv (why a run has no
alkylation report) is checked against it when present.
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

from matplotlib.patches import FancyArrowPatch, FancyBboxPatch

a = args("fig_s3_report_flow", versioned=True)
sfx = f"_{a.suffix}" if a.suffix else ""
df, _ = read_tsv(Path(a.results) / f"table_s3_digest_truth{sfx}.tsv")
ENZ_MODELLED = {"Trypsin", "Lys-C", "Arg-C", "Asp-N", "Glu-C", "Chymotrypsin", "Lys-N", "unspecific"}
LAB_EVAL = {"label-free", "TMT", "TMTpro/iTRAQ8", "iTRAQ4", "SILAC"}
LAB_CLASS = {"TMTpro": "TMTpro/iTRAQ8", "iTRAQ8": "TMTpro/iTRAQ8"}

n_all = len(df)
n_new = int((df["set"] == "nontryptic_new").sum())
has = df[df["sdrf_kind"] != "none"]
kinds = has["sdrf_kind"].value_counts()


def chain(d, steps, evaluable_col):
    """steps: (label, mask-of-excluded on the remaining runs); returns [(label, n)], remaining."""
    out, rem = [], d
    for lab, fn in steps:
        m = fn(rem)
        out.append((lab, int(m.sum())))
        rem = rem[~m]
    assert len(rem) == int(d[evaluable_col].astype(str).eq("True").sum()), (evaluable_col, len(rem))
    return out, rem


lab_cls = lambda r: r["label_truth"].map(lambda x: LAB_CLASS.get(x, x))  # noqa: E731
prot, p_ev = chain(has, [
    ("no enzyme annotation", lambda r: r["enzyme_truth"].isna()),
    ("enzyme without model\n(" + ", ".join(sorted(set(has["enzyme_truth"].dropna()) - ENZ_MODELLED)) + ")",
     lambda r: ~r["enzyme_truth"].isin(ENZ_MODELLED)),
    ("no protease report\n(no test in prose-auto's record)", lambda r: r["prose_status"].isna()),
], "enzyme_evaluable")
labl, l_ev = chain(has, [
    ("no label annotation", lambda r: r["label_truth"].isna()),
    ("label without detector\n(" + ", ".join(sorted(set(lab_cls(has).dropna()) - LAB_EVAL)) + ")",
     lambda r: ~lab_cls(r).isin(LAB_EVAL)),
    ("no label report", lambda r: r["label_call"].isna()),
], "label_evaluable")
assert (has.loc[has["alk_truth"].isna(), "alk_basis"] == "no mod columns").all()
alk, a_ev = chain(has, [
    ("no modification columns\nin the SDRF file", lambda r: r["alk_truth"].isna()),
    ("mixed alkylation", lambda r: r["alk_truth"].astype(str).str.startswith("mixed")),
    ("no alkylation report\n(no mass-gap test for the run\nin prose-auto's record)", lambda r: r["alk_call"].isna()),
], "alk_evaluable")
# the runs without an alkylation report are exactly those of massgap_absent (no stored mass-gap command)
gap = read_tsv(Path(a.results) / f"massgap_absent{sfx}.tsv")[0] if (Path(a.results) / f"massgap_absent{sfx}.tsv").exists() else None
if gap is not None:
    k = ["set", "acc", "run"]
    assert set(map(tuple, df[df["alk_call"].isna()][k].values)) == set(map(tuple, gap[k].values))
p_call = int((p_ev["shipped_status"] == "call").sum())
a_call = int((a_ev["alk_call"] != "unknown").sum())

fig, ax = plt.subplots(figsize=(7.0, 5.6))
ax.set_xlim(0, 100)
ax.set_ylim(0, 100)
ax.axis("off")


def box(x, y, w, h, text, fc="white", ec=MUTED, bold=False, fs=7.5):
    ax.add_patch(FancyBboxPatch((x - w / 2, y - h / 2), w, h, boxstyle="round,pad=0.4,rounding_size=1.2",
                                fc=fc, ec=ec, lw=0.9))
    ax.text(x, y, text, ha="center", va="center", fontsize=fs, fontweight="bold" if bold else "normal",
            linespacing=1.25)


def arrow(x0, y0, x1, y1):
    ax.add_patch(FancyArrowPatch((x0, y0), (x1, y1), arrowstyle="-|>", mutation_scale=8, color=MUTED, lw=0.9))


box(50, 94, 76, 7, f"{n_all} public runs\n({n_all - n_new} from prose-auto's validation sets, {n_new} added non-tryptic runs)",
    bold=False)
arrow(50, 90.2, 50, 82.8)
box(84, 86.5, 26, 4.5, f"{n_all - len(has)} without public SDRF file", fc="#f4f3ef", fs=7)
arrow(50, 86.5, 70.6, 86.5)
box(50, 79, 52, 6.5, f"{len(has)} runs with an SDRF file\n({kinds.get('community', 0)} community, "
    f"{kinds.get('submitter', 0)} submitter)")
cols = [(17, "Protease", prot, len(p_ev), f"{p_call} called, {len(p_ev) - p_call} no call"),
        (50, "Label", labl, len(l_ev), "every run called"),
        (83, "Alkylation", alk, len(a_ev), f"{a_call} called, {len(a_ev) - a_call} 'unknown'")]
for x, title, steps, nev, sub in cols:
    steps = [st for st in steps if st[1]]  # an exclusion that removed no run is not drawn
    arrow(50, 75.5, x, 69.5)
    ax.text(x, 67, title, ha="center", va="center", fontsize=8.5, fontweight="bold")
    y = 58
    for lab, n in steps:
        box(x, y, 29, 8, f"− {n}  {lab}", fc="#f4f3ef", fs=6.8)
        y -= 12.5
    arrow(x, 64.5, x, 62.4)
    for k in range(len(steps) - 1):
        arrow(x, 58 - 12.5 * k - 4.4, x, 58 - 12.5 * (k + 1) + 4.4)
    arrow(x, 58 - 12.5 * (len(steps) - 1) - 4.4, x, y + 4.6)
    box(x, y, 29, 8, f"{nev} evaluable runs\n{sub}", fc="#e9f1fb", ec=PALETTE[0], bold=False, fs=7.3)
out = Path(a.out)
out.mkdir(parents=True, exist_ok=True)
for ext in ("pdf", "png"):
    fig.savefig(out / f"{a.name}.{ext}", dpi=300 if ext == "png" else None, bbox_inches="tight")
plt.close(fig)
print(out / f"{a.name}.pdf", "protease", prot, len(p_ev), "label", labl, len(l_ev), "alk", alk, len(a_ev))
