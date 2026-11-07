#!/usr/bin/env python3
"""Per-run digest, label and alkylation calls from a directory of FASTag reports.

Layout: <reports>/<set>__<acc>__<run>/{A.digest.tsv, A.label.tsv, B.digest.tsv, B.label.tsv, C.massgap.tsv}
(A: -digest_models with prose-auto 0.1.3's model table, B: shipped models, C: mass-gap pass), as written by
the digest validation (fastag-digest-val/run_one.py) and its FASTag 1.8.0 release re-run (rerun180.py).

Usage: extract_digest_calls.py --reports DIR --out results/digest_calls_v180.tsv --provenance "..."
"""
import argparse
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "src"))

import pandas as pd  # noqa: E402

from fastag_bench import digestcalls as DC  # noqa: E402
from fastag_bench.parsers import read_long_report  # noqa: E402
from fastag_bench.tsv import write_tsv  # noqa: E402


def load(p: Path):
    return read_long_report(p) if p.exists() else None


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--reports", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--provenance", action="append", default=[])
    a = ap.parse_args()
    rows = []
    for d in sorted(Path(a.reports).iterdir()):
        if not d.is_dir() or d.name.count("__") < 2:
            continue
        s, acc, run = d.name.split("__", 2)
        r = {"set": s, "acc": acc, "run": run}
        for p in ("A", "B"):
            dig = load(d / f"{p}.digest.tsv")
            if dig is None:
                continue
            c = DC.digest(dig)
            tag = "prose" if p == "A" else "shipped"
            r.update({f"{tag}_{k}": v for k, v in c.items() if k != "models"})
            r[f"{tag}_version"] = dig.get(("run", "version"))
            if p == "A":
                lab = load(d / "A.label.tsv")
                if lab is not None:
                    r.update(DC.label(lab, dig))
                    r["tags_filtered"] = lab.get(("count", "tags_filtered"))
        mg = load(d / "C.massgap.tsv")
        if mg is not None:
            r.update(DC.alkylation(mg))
            r["silac_massgap"] = DC.silac_massgap(mg)
            r["massgap_version"] = mg.get(("run", "version"))
            r["massgap_tolerance"] = f"{mg.get(('run', 'fragment_tolerance'))} {mg.get(('run', 'fragment_tolerance_unit'))}"
        rows.append(r)
    df = pd.DataFrame(rows)
    write_tsv(df, a.out, a.provenance or [f"source: FASTag reports under {a.reports}"])
    print(a.out, len(df))


if __name__ == "__main__":
    main()
