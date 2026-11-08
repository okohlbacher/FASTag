#!/usr/bin/env python3
"""#9 held-out scorer (PREREG-item09.md): CFG-09-cand (-pick_profile auto) against CFG-09-base (legacy) on the
profile-MS2 runs of item09-H1.

Runs: the H1 runs of the manifest that have a truth database; PXD035981 ('gut metagenome', no truth database can
be named) is not evaluable and the reserve run (split 'reserve', PXD018024) takes its place, as fixed in
PREREG-item09.md before any run. Truth: Sage on the run's centroided corpus mzML (manifest column truth_input;
stored under the fastag_input's run directory as results.sage.tsv). Cells: analyser stratum (manifest stratum:
ion_trap, orbitrap_tof) x length L3/L4/L5 (-tag_length added to both arms; CLI default profile) x Sage charge 2, 3,
4+. Charge-1 PSMs are reported apart.
Endpoints (PLAN-data-types #9 Validation (B); all must hold):
  (B1) non-inferiority of auto against legacy in every cell (#2 margins, acclib.holm_ni; underpowered blocks);
  (B2) no fewer tagged spectra: for every run and length, spectra with >= 1 tag row under auto >= under legacy;
  (C)  picking cost per spectrum: reported from the Slurm accounting of the runs (not by this script).
If the ion_trap stratum fails (B1 or B2), the verdict says ANALYSER_RESTRICTION_NEEDED: the restriction is not in
the RC (a new RC and a new config), and no ion-trap reserve exists.
Usage: score_item09.py <acceptance dir> <runs root> <truth root> <out dir> [--base CFG-09-base --cand CFG-09-cand]
       [--manifest <name>] (DEV tests only)"""
import argparse
import json
from pathlib import Path

import acclib as A
from score_item02 import collect

MANIFEST = "item09-H1"
CELLS = ["L3_default", "L4_default", "L5_default"]
NOT_EVALUABLE = {"PXD035981": "no truth database: SDRF organism 'gut metagenome' has no panel FASTA"}


def runs_used(acc, manifest=MANIFEST):
    rows = A.read_tsv(Path(acc) / "manifests" / f"{manifest}.tsv")
    h1 = [r for r in rows if r["split"] == "H1" and r["pxd"] not in NOT_EVALUABLE]
    res = [r for r in rows if r["split"] != "H1"]
    if any(r["pxd"] in NOT_EVALUABLE for r in rows if r["split"] == "H1"):
        h1 += res          # the reserve replaces the run without a truth database (PREREG-item09.md)
    return h1


def main():
    ap = argparse.ArgumentParser()
    for a in ("acc", "runs", "truth", "out"):
        ap.add_argument(a)
    ap.add_argument("--base", default="CFG-09-base")
    ap.add_argument("--cand", default="CFG-09-cand")
    ap.add_argument("--manifest", default=MANIFEST, help="DEV tests only")
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    use = {A.run_rel(r["fastag_input"]) for r in runs_used(a.acc, a.manifest)}
    recs, runinfo = collect(a.acc, a.manifest, a.runs, a.truth, a.base, a.cand, CELLS, set_fn=lambda r: r["stratum"],
                            only=use)
    sets = sorted({x["set"] for x in runinfo})
    grid = []
    for s in sets:
        for cell in CELLS:
            for z in ("2", "3", "4+"):
                rr = [(c, b, k) for (st, ce, ch, c, b, k) in recs if st == s and ce == cell and A.charge_stratum(ch) == z]
                grid.append(A.paired_diff(f"{a.manifest}:{s}:{cell}:z{z}", rr))
    b1 = A.holm_ni(grid)
    b2 = []
    for x in runinfo:
        for cell in CELLS:
            nb, nc = x.get(f"{a.base}:{cell}:tagged", 0), x.get(f"{a.cand}:{cell}:tagged", 0)
            b2.append({"run": x["run"], "set": x["set"], "cell": cell, "tagged_base": nb, "tagged_cand": nc,
                       "ok": nc >= nb})
    b2v = "PASS" if b2 and all(r["ok"] for r in b2) else "FAIL"
    it_fail = (any(c["ni"] == "fail" for c in grid if ":ion_trap:" in c["cell"]) or
               any(not r["ok"] for r in b2 if r["set"] == "ion_trap"))
    failed = [x for x in runinfo if x["status"] != "ok"]
    verdict = ("INCONCLUSIVE" if failed else "PASS" if (b1 == "PASS" and b2v == "PASS") else
               "FAIL" if "FAIL" in (b1, b2v) else "INCONCLUSIVE")
    res = {"manifest": a.manifest, "runs": sorted(use), "not_evaluable": NOT_EVALUABLE, "B1": b1, "B2": b2v,
           "ion_trap_failed": it_fail, "verdict": verdict + ("; ANALYSER_RESTRICTION_NEEDED" if it_fail else ""),
           "runs_not_ok": [(x["run"], x["status"]) for x in failed], "provenance": A.provenance()}
    A.write_rows(out / "cells_B1.tsv", grid)
    A.write_rows(out / "tagged_B2.tsv", b2)
    A.write_rows(out / "runs.tsv", runinfo, sorted({k for x in runinfo for k in x}))
    (out / "result.json").write_text(json.dumps(res, indent=1, default=str) + "\n")
    print(json.dumps({k: res[k] for k in ("runs", "B1", "B2", "verdict", "runs_not_ok")}, default=str))


if __name__ == "__main__":
    main()
