#!/usr/bin/env python3
"""tasks.tsv for fastag.slurm: one line per (arm dir, run, cell) of PREREG-compltol.md.
usage: mktasks.py <acceptance/1.13 dir> > tasks.tsv"""
import sys
from pathlib import Path
acc = Path(sys.argv[1])
lines = [l for l in (acc / "manifests" / "compltol-H1.tsv").read_text().splitlines() if not l.startswith("# ")]
cols = lines[0].split("\t")
ARMS = {"CFG-CT-base": "", "CFG-CT-cand": "-complement_tolerance_unit auto"}
IT05 = "-fragment_tolerance 0.5 -fragment_tolerance_unit Da"
for l in lines[1:]:
    r = dict(zip(cols, l.split("\t")))
    it = r["ms2_analyser"].strip(";") == "ion_trap"
    for arm, opt in ARMS.items():
        d = arm + ("-it05" if it else "")
        o = (opt + " " + IT05).strip() if it else opt
        for prof in ("default", "nodeiso"):
            for L in (3, 4, 5):
                cell = f"L{L}_{prof}"
                co = f"-tag_length {L}" + (" -no_deisotope" if prof == "nodeiso" else "")
                print("\t".join([d, r["fastag_input"], cell, r["fastag_input_sha256"], (co + " " + o).strip()]))
