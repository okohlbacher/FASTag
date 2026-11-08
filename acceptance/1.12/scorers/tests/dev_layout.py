#!/usr/bin/env python3
"""DEV test helper only: lay out the DEV regeneration outputs of #1 and #3 (fastag112-dev) in the held-out scorer
layout (<runs>/<CFG>/<manifest>/<run>/<cell>/...) with symbolic links, and write the DEV run tables.
  species: CFG-01-base = arm base, CFG-01-cand = g_0.01_0.01_5_on, CFG-10-cand = both_g_0.01_0.01_5_on (the frozen
           points); truth = the paper harness's Sage search on ref50 (jpr-bench/species/runs/<run>/sage); organisms =
           the genera of species_runs.tsv 'truth'; primary = FTMS (meta.json).
  chem:    CFG-03-base termini = pass B, CFG-03-cand termini = pass V2b (label from B: label_call does not depend on
           the digest options, PREREG-chem.md), alkylation = pass C; truth columns = inputs/sdrf_truth_runs.tsv;
           stratum from the enzyme truth ('tryptic' or 'nontryptic:<class>').
Usage: dev_layout.py species|chem <repo> <fastag112-dev> <jpr-bench> <work dir>"""
import csv
import json
import os
import sys
from pathlib import Path

mode, REPO, DEV, JB, W = sys.argv[1], Path(sys.argv[2]), Path(sys.argv[3]), Path(sys.argv[4]), Path(sys.argv[5])
A = REPO / "acceptance/1.12"


def rd(p):
    with open(p) as f:
        return list(csv.DictReader((l for l in f if not l.startswith("# ")), delimiter="\t"))


def link(src, dst):
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.is_symlink() or dst.exists():
        dst.unlink()
    os.symlink(src, dst)


if mode == "species":
    sys.path.insert(0, str(REPO / "bench/fastag-bench/src"))
    from fastag_bench import species as SP
    truth = {r["run_id"]: r["truth"] for r in SP.load_manifest(REPO / "bench/fastag-bench/config/species_runs.tsv").to_dict("records")}
    rows = []
    for r in rd(A / "dev/species/training_runs.tsv"):
        k = r["run_id"]
        meta = json.loads((DEV / "species/runs" / k / "meta.json").read_text())
        g = list(SP.parse_truth(truth[k]))
        for cfg, arm in (("CFG-01-base", "base"), ("CFG-01-cand", "g_0.01_0.01_5_on"), ("CFG-10-cand", "both_g_0.01_0.01_5_on")):
            link(DEV / "species/runs" / k / arm, W / "runs" / cfg / "dev01" / k / "RC")
        link(JB / "species/runs" / k / "sage/results.sage.tsv", W / "truth/dev01" / k / "results.sage.tsv")
        rows.append({"run": k, "run_dir": k, "organisms": ";".join(g), "stratum": "single" if len(g) == 1 else "multi",
                     "primary": "yes" if meta["analyzer"] == "FTMS" else "no", "analyzer": meta["analyzer"]})
    out = W / "species_runtable.tsv"
elif mode == "chem":
    tr = {f"{r['set']}__{r['acc']}__{r['run']}": r for r in rd(A / "inputs/sdrf_truth_runs.tsv")}
    rows = []
    for r in rd(A / "dev/chem/training_runs.tsv"):
        k = r["run_id"]
        d = DEV / "chem/runs" / k
        t = tr[k]
        for cfg, p in (("CFG-03-base", "B"), ("CFG-03-cand", "V2b")):
            if (d / f"{p}.digest.tsv").exists():
                link(d / f"{p}.digest.tsv", W / "runs" / cfg / "dev03" / k / "termini/digest.tsv")
            if (d / "B.label.tsv").exists():
                link(d / "B.label.tsv", W / "runs" / cfg / "dev03" / k / "termini/label.tsv")
        if (d / "C.alkylation.tsv").exists():
            link(d / "C.alkylation.tsv", W / "runs/CFG-03-cand/dev03" / k / "alkylation/alkylation.tsv")
        e = t["enzyme_truth"]
        rows.append({"run_dir": k, "pxd": r["pxd"], "stratum": "tryptic" if e == "Trypsin" else f"nontryptic:{e}" if e else "",
                     "enzyme_truth": e, "alk_truth": t["alk_truth"], "label_truth": t["label_truth"]})
    out = W / "chem_runtable.tsv"
else:
    sys.exit("mode species|chem")
with open(out, "w") as o:
    cols = list(rows[0])
    o.write("\t".join(cols) + "\n")
    for x in rows:
        o.write("\t".join(x[c] for c in cols) + "\n")
print(mode, len(rows), "runs ->", out)
