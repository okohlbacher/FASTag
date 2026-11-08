#!/usr/bin/env python3
"""Build per-run SDRF ground truth (enzyme, label, alkylation) for the digest validation runs.

Sources in priority order: the submitter's SDRF on PRIDE (any *.sdrf.tsv / *SDRF.tsv except the
'community_annotated' mirror), then the community SDRF of bigbio/sdrf-annotated-datasets. A row
match on comment[data file] beats a value shared by every row of the file ('project-uniform').
File names are never used as truth.

Usage:
  sdrf_truth.py --runs results/digest_val_runs.tsv --sdrf-dir results/sdrf \
      --out results/sdrf_truth_runs.tsv
--sdrf-dir holds <PXD>/community/<file> and <PXD>/submitter/<file>, plus sources.tsv
(acc, kind, file, url) naming the public URL of every file.
"""
import argparse
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "src"))

import pandas as pd  # noqa: E402

from fastag_bench.sdrftruth import resolve  # noqa: E402
from fastag_bench.tsv import read_tsv, write_tsv  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    res = HERE.parent / "results"
    dflt = [str(p) for p in (res / "digest_val_runs.tsv", res / "digest_nontryptic_runs.tsv") if p.exists()]
    ap.add_argument("--runs", nargs="+", default=dflt, help="run tables (set, acc, run[, pseudo, enzyme_truth])")
    ap.add_argument("--sdrf-dir", default=str(HERE.parent / "results" / "sdrf"))
    ap.add_argument("--out", default=str(HERE.parent / "results" / "sdrf_truth_runs.tsv"))
    a = ap.parse_args()
    runs = pd.concat([read_tsv(p)[0] for p in a.runs], ignore_index=True)
    sd = Path(a.sdrf_dir)
    src, sprov = read_tsv(sd / "sources.tsv")
    rows = []
    for _, r in runs.iterrows():
        base = str(r["acc"]).split("-")[0]
        cand = []
        for kind in ("submitter", "community"):
            for _, s in src[(src["acc"] == base) & (src["kind"] == kind)].iterrows():
                cand.append((kind, str(sd / base / kind / s["file"]), s["url"]))
        t = resolve(str(r["run"]), cand)
        # second opinion: the community SDRF alone, for runs whose truth came from the submitter's SDRF
        tc = resolve(str(r["run"]), [c for c in cand if c[0] == "community"]) if t["sdrf_kind"] == "submitter" else {}
        old = r.get("enzyme_truth")
        old = "" if old is None or (isinstance(old, float) and pd.isna(old)) else str(old)
        rows.append({
            "set": r["set"], "acc": r["acc"], "run": r["run"], "pseudo": r.get("pseudo"),
            "sdrf_kind": t["sdrf_kind"], "match": t["match"], "sdrf_url": t["sdrf_url"],
            "enzyme_sdrf": t.get("enzyme_sdrf"), "enzyme_truth": t.get("enzyme_truth"),
            "label_sdrf": t.get("label_sdrf"), "label_truth": t.get("label_truth"),
            "alk_truth": t.get("alk_truth"), "alk_basis": t.get("alk_basis"), "mods_sdrf": t.get("mods_sdrf"),
            "annotation_tool": t.get("annotation_tool"),
            "community_enzyme_truth": tc.get("enzyme_truth"), "community_label_truth": tc.get("label_truth"),
            "community_alk_truth": tc.get("alk_truth"),
            "prior_enzyme_label": old, "prior_from_file_name": "(file name)" in old,
        })
    df = pd.DataFrame(rows)
    write_tsv(df, a.out, [
        f"source: SDRF files under {sd.name}/ (see sources.tsv: {'; '.join(sprov)})",
        "truth = SDRF comment[cleavage agent details] / comment[label] + label mods / fixed C mod or "
        "comment[alkylation reagent]; priority submitter > community, run row > project-uniform; never file names",
        "community_* = truth from the community SDRF alone, filled only where the submitter's SDRF was used",
        "prior_enzyme_label = prose-auto runs.json truth_enzyme used before (provenance undocumented); "
        "prior_from_file_name marks the labels taken from file names",
    ])
    print(a.out, len(df), df["match"].value_counts().to_dict())


if __name__ == "__main__":
    main()
