#!/usr/bin/env python3
"""Cut the small v1.9.0 regression fixture for tests/test_v190_regression.py.

Takes one dataset, truth and tag length from the stored v1.9.0 accuracy runs (Sage results, FASTag and
DirecTag tags at matched settings) and the stored pair table, keeps a fixed-seed sample of PSM spectra
plus every Sage row of the same scans (decoys, q > 1% and lower ranks included, so the reader's filter
is exercised), and writes them to tests/data/v190/. The expected rows are copied from
accuracy_pairs_v190.tsv.gz, never recomputed.

Run where the run directories are (node data):
    python scripts/make_v190_fixture.py --fastag-work /ceph/ibmi/abi/oliver/jpr-bench/accuracy/work-v190 \
        --directag-work /ceph/ibmi/abi/oliver/jpr-bench/accuracy/work \
        --pairs /ceph/ibmi/abi/oliver/jpr-bench/stats/accuracy_pairs_v190.tsv.gz --out tests/data/v190
"""
from __future__ import annotations

import argparse
import gzip
import io
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "src"))

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

from fastag_bench import parsers as P  # noqa: E402


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--fastag-work", required=True)
    ap.add_argument("--directag-work", required=True)
    ap.add_argument("--pairs", required=True)
    ap.add_argument("--dataset", default="PXD003531_QE_NO_03")
    ap.add_argument("--truth", default="sage")
    ap.add_argument("--tag-length", type=int, default=3)
    ap.add_argument("--n", type=int, default=240)
    ap.add_argument("--seed", type=int, default=20261106)
    ap.add_argument("--out", required=True)
    a = ap.parse_args(argv)
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)

    with gzip.open(a.pairs, "rt") as fh:
        text = "".join(line for line in fh if not line.startswith("#"))
    pairs = pd.read_csv(io.StringIO(text), sep="\t", keep_default_na=False, na_values=[""])
    sel = pairs[(pairs["dataset"] == a.dataset) & (pairs["truth"] == a.truth) & (pairs["tag_length"] == a.tag_length)]
    rng = np.random.default_rng(a.seed)
    # stratify on the outcome pattern so discordant and untagged spectra are in the sample
    pat = sel[["ft_tagged", "ft_top1", "ft_top10", "dt_tagged", "dt_top1", "dt_top10"]].astype(str).agg("".join, axis=1)
    keep = []
    for _, idx in sel.groupby(pat).groups.items():
        idx = sorted(idx)
        k = max(2, int(round(a.n * len(idx) / len(sel))))
        keep += list(rng.choice(idx, size=min(k, len(idx)), replace=False))
    exp = sel.loc[sorted(keep)]
    keys = set(exp["key"])

    sfx = "" if a.tag_length == 3 else f"_tl{a.tag_length}"
    sage = Path(a.directag_work) / "runs" / a.dataset / "sage" / "default" / "results.sage.tsv"
    sdf = pd.read_csv(sage, sep="\t", dtype=str, keep_default_na=False)
    sdf = sdf[sdf["scannr"].map(P.spectrum_key).isin(keys)]
    # a few rows of other scans that the filter must drop: decoys and q > 1%
    full = pd.read_csv(sage, sep="\t", dtype=str, keep_default_na=False)
    extra = pd.concat([full[full["label"] == "-1"].head(5),
                       full[pd.to_numeric(full["spectrum_q"]) > 0.01].head(5)])
    sdf = pd.concat([sdf, extra]).drop_duplicates()
    sdf.to_csv(out / "results.sage.tsv", sep="\t", index=False)

    ft_path = Path(a.fastag_work) / "runs" / a.dataset / "fastag" / f"fastag_matched{sfx}" / "tags.tsv"
    ft = pd.read_csv(ft_path, sep="\t", dtype=str, keep_default_na=False)
    ft[ft["spectrum"].map(P.spectrum_key).isin(keys)].to_csv(out / "fastag_tags.tsv", sep="\t", index=False)

    dt_dir = Path(a.directag_work) / "runs" / a.dataset / "directag" / f"directag_matched{sfx}"
    dt_path = sorted(dt_dir.glob("*.tags"))[0]
    lines, cur = [], False
    with open(dt_path) as fh:
        for line in fh:
            if line.startswith("H"):
                lines.append(line)
                continue
            if line.startswith("S\t"):
                cur = P.spectrum_key(line.split("\t")[1]) in keys
            if cur:
                lines.append(line)
    (out / "directag.tags").write_text("".join(lines))

    with open(out / "expected_pairs.tsv", "w") as fh:
        fh.write(f"# expected rows copied from {a.pairs} ({a.dataset}, truth {a.truth}, tag length {a.tag_length}, "
                 f"{len(exp)} of {len(sel)} spectra, outcome-stratified sample, seed {a.seed})\n")
        fh.write(f"# sources: {sage}; {ft_path}; {dt_path}\n")
        exp.to_csv(fh, sep="\t", index=False)
    print(f"{len(exp)} spectra; sage rows {len(sdf)}; out {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
