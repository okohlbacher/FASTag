#!/usr/bin/env python3
"""Manifest of the digqual evaluation (backlog 23), run on node data.

    build_manifest.py <runs_v190 dir> <out manifest.tsv>

Selection rule (fixed before any FASTag -digest_quality run on these files):
every run directory of jpr-bench/species/runs_v190 that has sage/results.sage.tsv,
whose meta.json analyzer is FTMS (high-resolution MS2: the 0.008 Da tag-end
windows hold), and that is not a DEV file. DEV = the gate inputs; of the runs
here only PXD003531_QE_NO_03 is one (its mzML is the gate's dda_default
input), and it is the DEV run of this item. ITMS runs are excluded (Da
tolerance, tag-end windows do not hold). split = eval for the rest.
"""
import hashlib
import json
import os
import sys

DEV = {"PXD003531_QE_NO_03"}


def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as fh:
        for b in iter(lambda: fh.read(1 << 22), b""):
            h.update(b)
    return h.hexdigest()


def main():
    runs, out = sys.argv[1:3]
    rows = []
    for d in sorted(os.listdir(runs)):
        meta = os.path.join(runs, d, "meta.json")
        res = os.path.join(runs, d, "sage", "results.sage.tsv")
        cfg = os.path.join(runs, d, "sage", "sage.json")
        if not (os.path.exists(meta) and os.path.exists(res)):
            continue
        m = json.load(open(meta))
        an = m.get("analyzer", "")
        split = "dev" if d in DEV else ("eval" if an == "FTMS" else "excluded_itms")
        rows.append([d, d.split("_")[0], m["mzml"], sha(m["mzml"]), an, split, res, sha(res), cfg, sha(cfg)])
        print(d, split, flush=True)
    with open(out, "w") as fh:
        fh.write("run_id\tpxd\tmzml\tmzml_sha256\tanalyzer\tsplit\tsage_results\tsage_results_sha256\tsage_json\tsage_json_sha256\n")
        for r in rows:
            fh.write("\t".join(r) + "\n")


if __name__ == "__main__":
    main()
