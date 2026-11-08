#!/usr/bin/env python3
"""Per-run change of the digest, label, alkylation and mass-gap calls between two FASTag releases.

Inputs (results/): digest_calls_<a>.tsv + digest_calls_nontryptic_<a>.tsv and the same for <b>
(scripts/extract_digest_calls.py). Output: one row per run with the old and new value of each call field
and the list of fields that changed (numeric fields: changed when they differ at all).

Usage: compare_digest_calls.py --a v180 --b v190 --out results/digest_calls_v180_vs_v190.tsv
"""
import argparse
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "src"))

import pandas as pd  # noqa: E402

from fastag_bench.tsv import read_tsv, write_tsv  # noqa: E402

KEY = ["set", "acc", "run"]
FIELDS = ["prose_status", "prose_call", "prose_would", "prose_nocall_reasons", "shipped_status", "shipped_call",
          "shipped_would", "shipped_nocall_reasons", "label_call", "alk_call", "silac_massgap",
          "prose_margin", "shipped_margin", "tags_filtered", "alk_ratio", "alk_best_count", "cys_spectra"]


def norm(x):
    return None if x is None or (isinstance(x, float) and pd.isna(x)) or x == "" else x


def load(res, tag):
    files = [res / f"digest_calls_{tag}.tsv", res / f"digest_calls_nontryptic_{tag}.tsv"]
    return pd.concat([read_tsv(p)[0] for p in files if p.exists()], ignore_index=True), [p.name for p in files if p.exists()]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--results", default=str(HERE.parent / "results"))
    ap.add_argument("--a", default="v180")
    ap.add_argument("--b", default="v190")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    res = Path(a.results)
    A, fa = load(res, a.a)
    B, fb = load(res, a.b)
    m = A.merge(B, on=KEY, how="outer", suffixes=(f"_{a.a}", f"_{a.b}"), indicator=True)
    rows = []
    for _, r in m.iterrows():
        o = {k: r[k] for k in KEY}
        o["present"] = {"both": "both", "left_only": f"{a.a} only", "right_only": f"{a.b} only"}[r["_merge"]]
        ch = []
        for f in FIELDS:
            x, y = norm(r.get(f"{f}_{a.a}")), norm(r.get(f"{f}_{a.b}"))
            o[f"{f}_{a.a}"], o[f"{f}_{a.b}"] = x, y
            if x != y:
                ch.append(f)
        o["changed"] = ",".join(ch)
        o["call_changed"] = any(f in ch for f in ("prose_status", "prose_call", "shipped_status", "shipped_call",
                                                  "label_call", "alk_call", "silac_massgap"))
        rows.append(o)
    df = pd.DataFrame(rows)
    write_tsv(df, a.out, [f"source: {' + '.join(fa)} vs {' + '.join(fb)} ({len(df)} runs; script compare_digest_calls.py)",
                          "call_changed = a protease status/call (A prose-auto models or B shipped), label, alkylation or "
                          "mass-gap SILAC call differs; 'changed' lists every differing field incl. numeric ones"])
    print(a.out, len(df), "call_changed", int(df["call_changed"].sum()))
    for f in ("prose_status", "prose_call", "shipped_status", "shipped_call", "label_call", "alk_call", "silac_massgap"):
        print(f, int(df["changed"].str.split(",").apply(lambda l: f in l).sum()))


if __name__ == "__main__":
    main()
