#!/usr/bin/env python3
"""#2 held-out scorer (PREREG-item02.md): CFG-02-cand (-complement_rule both) against CFG-02-base (same_charge).

Per run of the manifest and per cell run (L3/L4/L5 = -tag_length 3/4/5, 'default' = CLI default profile,
'nodeiso' = matched -no_deisotope, both added to the frozen option string of each arm): rank-1 flank-correct
against the run's Sage truth (acclib conventions). Set = the manifest stratum, except that a run whose recorded MS2
analyser (manifest column ms2_analyser) is ion_trap is scored in the ion_trap set (PXD001540, 'qe' in the plan).
Charge stratum = the Sage PSM charge (2, 3, 4+; charge-1 PSMs are reported apart, never in a cell).
Round 3 (DECISIONS-2026-11-08 #2, PREREG-item02.md amendment 1): runs of the ion_trap set are read from the 0.5 Da
twins <CFG>-it05 of both arms (acclib.arm_dir), every other run from the 20 ppm configs; manifest item02-H1-r2
(PXD001540 is stratum ion_trap there, PXD069528 is the qe run). The informativeness floor acclib.INFO_FLOOR_PCT on
the baseline arm's rank-1 correct rate applies to every cell of (i): a cell below it is 'uninformative', is not in
the Holm family and never counts as a pass.

Endpoints (PLAN-data-types #2, Acceptance; all must hold):
  (i)  non-inferiority in every cell set x profile x length x charge (acclib.holm_ni: >= 200 peptide clusters,
       point > -0.5, Holm-adjusted bound > -1.0; an underpowered or empty cell is inconclusive and blocks);
  (ii) pooled gain at length 3, CLI default profile, sets astral + ion_trap, charges >= 2: point >= +0.3 and the
       2.5th bootstrap percentile > 0;
  (iii) timsTOF 4+ in the CLI default profile, at each length: point >= -0.5 and the unadjusted 95% bound
       (point - 1.96 SE) > -1.0;
  (iv) time: --timing <tsv> (arm, repeat, seconds; PXD003531 DEV, 1 thread, 3 interleaved repeats): median ratio
       cand/base <= 1.03; without it (iv) is NOT MEASURED and the item cannot pass.
Usage: score_item02.py <acceptance dir> <manifest name> <runs root> <truth root> <out dir> [--timing tsv]
       [--base CFG-02-base] [--cand CFG-02-cand]"""
import argparse
import json
import statistics
from pathlib import Path

import acclib as A

CELLS = [f"L{n}_{p}" for p in ("default", "nodeiso") for n in (3, 4, 5)]


def set_of(row):
    return "ion_trap" if row.get("ms2_analyser", "").strip(";") == "ion_trap" else row["stratum"]


def collect(acc, manifest, runs, truth, base, cand, cells, set_fn=set_of, truth_name="results.sage.tsv", only=None):
    """One record per (run, cell, truth spectrum): set, cell, charge, cluster, base_ok, cand_ok. only: run
    directories (acclib.run_rel) to keep; None = every manifest row."""
    rows = A.read_tsv(Path(acc) / "manifests" / f"{manifest}.tsv")
    if only is not None:
        rows = [r for r in rows if A.run_rel(r["fastag_input"]) in only]
    recs, runinfo = [], []
    for r in rows:
        rel = A.run_rel(r["fastag_input"])
        tp = Path(truth) / manifest / rel / truth_name
        info = {"pxd": r["pxd"], "run": rel, "set": set_fn(r), "truth": str(tp), "truth_present": tp.exists()}
        if not tp.exists():
            info["status"] = "NO_TRUTH"
            runinfo.append(info)
            continue
        psms = A.sage_truth(tp)
        info["truth_psms"] = len(psms)
        ch = dict(zip(psms["key"], psms["charge"]))
        cl = dict(zip(psms["key"], psms["cluster"]))
        info["arm_dirs"] = f"{A.arm_dir(base, info['set'])},{A.arm_dir(cand, info['set'])}"
        for cell in cells:
            d = {}
            for arm in (base, cand):
                rd = Path(runs) / A.arm_dir(arm, info["set"]) / manifest / rel / cell
                rc = A.run_rc(rd)
                info[f"{arm}:{cell}:rc"] = rc
                info[f"{arm}:{cell}:tagged"] = A.tagged_spectra(rd / "tags.tsv")
                d[arm] = A.rank1_correct(rd / "tags.tsv" if rc == 0 else None, psms)
            for k in psms["key"]:
                recs.append((info["set"], cell, int(ch[k]), cl[k], d[base][k], d[cand][k]))
        info["status"] = "ok" if all(info.get(f"{a}:{c}:rc") == 0 for a in (base, cand) for c in cells) else "RUN_FAILED"
        runinfo.append(info)
    return recs, runinfo


def main():
    ap = argparse.ArgumentParser()
    for a in ("acc", "manifest", "runs", "truth", "out"):
        ap.add_argument(a)
    ap.add_argument("--timing")
    ap.add_argument("--base", default="CFG-02-base")
    ap.add_argument("--cand", default="CFG-02-cand")
    ap.add_argument("--cells", default=",".join(CELLS))
    a = ap.parse_args()
    cells = a.cells.split(",")
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    recs, runinfo = collect(a.acc, a.manifest, a.runs, a.truth, a.base, a.cand, cells)
    sets = sorted({x["set"] for x in runinfo})
    res = {"manifest": a.manifest, "base": a.base, "cand": a.cand, "sets": sets, "provenance": A.provenance()}
    # (i)
    grid = []
    for s in sets:
        for cell in cells:
            for z in ("2", "3", "4+"):
                rr = [(c, b, k) for (st, ce, ch, c, b, k) in recs if st == s and ce == cell and A.charge_stratum(ch) == z]
                grid.append(A.paired_diff(f"{a.manifest}:{s}:{cell}:z{z}", rr))
    res["i"] = A.holm_ni(grid, floor=A.INFO_FLOOR_PCT)
    res["info_floor_pct"] = A.INFO_FLOOR_PCT
    # charge 1, reported apart
    one = [A.paired_diff(f"{a.manifest}:{s}:{cell}:z1", [(c, b, k) for (st, ce, ch, c, b, k) in recs
                                                           if st == s and ce == cell and ch == 1])
           for s in sets for cell in cells]
    # (ii)
    pool = [(c, b, k) for (st, ce, ch, c, b, k) in recs if st in ("astral", "ion_trap") and ce == "L3_default" and ch >= 2]
    p2 = A.paired_diff(f"{a.manifest}:ii:astral+ion_trap:L3_default", pool)
    res["ii"] = "PASS" if p2["clusters"] and p2["diff"] >= 0.3 and p2["p2_5"] > 0 else "FAIL"
    res["ii_cell"] = p2
    # (iii)
    t3 = []
    for cell in [c for c in cells if c.endswith("_default")]:
        d = A.paired_diff(f"{a.manifest}:iii:timstof:{cell}:z4+",
                          [(c, b, k) for (st, ce, ch, c, b, k) in recs if st == "timstof" and ce == cell and ch >= 4])
        d["lb95"] = d["diff"] - 1.959963984540054 * d["se"] if d["se"] == d["se"] else float("nan")
        d["ok"] = bool(d["clusters"] >= A.MIN_CLUSTERS and d["diff"] >= -0.5 and d["lb95"] > -1.0)
        t3.append(d)
    res["iii"] = ("PASS" if t3 and all(d["ok"] for d in t3) else
                  "INCONCLUSIVE" if any(d["clusters"] < A.MIN_CLUSTERS for d in t3) else "FAIL")
    res["iii_cells"] = t3
    # (iv)
    if a.timing:
        t = A.read_tsv(a.timing)
        med = {arm: statistics.median(float(x["seconds"]) for x in t if x["arm"] == arm) for arm in (a.base, a.cand)}
        res["iv_ratio"] = med[a.cand] / med[a.base]
        res["iv"] = "PASS" if res["iv_ratio"] <= 1.03 else "FAIL"
    else:
        res["iv"] = "NOT MEASURED"
    failed = [x for x in runinfo if x["status"] != "ok"]
    res["runs_not_ok"] = [(x["run"], x["status"]) for x in failed]
    v = [res["i"], res["ii"], res["iii"], res["iv"]]
    res["verdict"] = ("INCONCLUSIVE" if failed else
                      "PASS" if all(x == "PASS" for x in v) else
                      "FAIL" if "FAIL" in v else "INCONCLUSIVE")
    A.write_rows(out / "cells_i.tsv", grid)
    A.write_rows(out / "cells_charge1.tsv", one)
    A.write_rows(out / "runs.tsv", runinfo, sorted({k for x in runinfo for k in x}))
    (out / "result.json").write_text(json.dumps(res, indent=1, default=str) + "\n")
    print(json.dumps({k: res[k] for k in ("manifest", "sets", "i", "ii", "iii", "iv", "verdict", "runs_not_ok")},
                     default=str))


if __name__ == "__main__":
    main()
