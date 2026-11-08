#!/usr/bin/env python3
"""item09-H1 held-out task table (PREREG-item09.md + amendment 1). Usage: make_tasks.py <acceptance dir> <out tsv>"""
import csv, sys
A, OUT = sys.argv[1], sys.argv[2]
rows = list(csv.DictReader((l for l in open(f"{A}/manifests/item09-H1.tsv") if not l.startswith("# ")), delimiter="\t"))
use = [r for r in rows if r["pxd"] in ("PXD009049", "PXD016519", "PXD018024")]   # PXD035981 not evaluable; reserve replaces it
assert len(use) == 3
TOL = "-fragment_tolerance 0.5 -fragment_tolerance_unit Da"
ARMS = {"ion_trap": [("CFG-09-base-it05", TOL), ("CFG-09-cand-it05", "-pick_profile auto " + TOL)],
        "orbitrap_tof": [("CFG-09-base", ""), ("CFG-09-cand", "-pick_profile auto")]}
with open(OUT, "w") as f:
    n = 0
    for r in use:
        rel = r["fastag_input"].rsplit(".", 1)[0]
        for cfg, opts in ARMS[r["stratum"]]:
            for L in (3, 4, 5):
                n += 1
                f.write("\t".join([str(n), cfg, r["fastag_input"], r["fastag_input_sha256"], rel, f"L{L}_default",
                                   (opts + f" -tag_length {L}").strip()]) + "\n")
print(n, "tasks")
