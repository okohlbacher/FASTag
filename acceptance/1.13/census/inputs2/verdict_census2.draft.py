#!/usr/bin/env python3
"""Draft verdict for the second census triage held-out test (PREREG-draft.md). Not frozen.

    verdict_census2.py <primary eval.tsv> <run labels, comma-separated> [min evaluable runs, default 6]
A run is evaluable when the scorer writes evaluable = 1 (U has a hit at the primary truth; judged from U as a whole).
E1: pooled rr >= 2.0 and rr_ci_lo >= 1.5 (all runs pooled). E2: rr > 1 in every evaluable run (inf counts as > 1; an
undefined rr in an evaluable run fails). E3: pooled d_n_peaks > 0 and d_n_peaks_ci_lo > 0 (all runs pooled).
PASS: all hold and at least the minimum number of runs is evaluable. FAIL: a point criterion fails.
INCONCLUSIVE: the point criteria hold and a CI criterion does not, or too few runs are evaluable.
"""
import csv, sys

kv = {(r["scope"], r["key"]): r["value"] for r in csv.DictReader(open(sys.argv[1]), delimiter="\t")}
runs = sys.argv[2].split(",")
need = int(sys.argv[3]) if len(sys.argv) > 3 else 6


def num(scope, key):
    v = kv.get((scope, key), "")
    return None if v == "" else float(v)


if num("pooled", "n_runs") != len(runs):
    sys.exit("run count mismatch")
rr, lo = num("pooled", "rr"), num("pooled", "rr_ci_lo")
d, dlo = num("pooled", "d_n_peaks"), num("pooled", "d_n_peaks_ci_lo")
ev = [r for r in runs if num(r, "evaluable") == 1]
run_rr = {r: num(r, "rr") for r in ev}
p1 = rr is not None and rr >= 2.0
p2 = all(v is not None and v > 1 for v in run_rr.values())
p3 = d is not None and d > 0
c1 = lo is not None and lo >= 1.5
c3 = dlo is not None and dlo > 0
enough = len(ev) >= need
verdict = "FAIL" if not (p1 and p2 and p3) else ("PASS" if c1 and c3 and enough else "INCONCLUSIVE")
print(f"E1 rr {rr} (>= 2.0: {p1}), ci_lo {lo} (>= 1.5: {c1})")
print("E2 run rr " + ", ".join(f"{r} {v}" for r, v in run_rr.items()) + f" (all > 1: {p2}); evaluable {len(ev)} of "
      f"{len(runs)} (>= {need}: {enough}); not evaluable: " +
      (", ".join(f"{r} (q_min {kv.get((r, "q_min"), "")})" for r in runs if r not in ev) or "none"))
print(f"E3 d_n_peaks {d} (> 0: {p3}), ci_lo {dlo} (> 0: {c3})")
print(f"VERDICT {verdict}")
