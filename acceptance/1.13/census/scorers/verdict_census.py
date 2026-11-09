#!/usr/bin/env python3
"""FASTag 1.13 item 7 (#11 triage): the preregistered verdict (PREREG-census.md) from the primary scorer output.

    verdict_census.py <primary eval.tsv> <run labels, comma-separated>
E1: pooled rr >= 2.0 and rr_ci_lo >= 1.5. E2: rr > 1 in every run (inf counts as > 1; an undefined rr fails).
E3: pooled d_n_peaks > 0 and d_n_peaks_ci_lo > 0.
PASS: all hold. FAIL: a point criterion fails (pooled rr < 2.0, a run rr <= 1 or undefined, pooled d <= 0).
INCONCLUSIVE: the point criteria hold and a CI criterion does not.
"""
import csv, math, sys

kv = {}
for r in csv.DictReader(open(sys.argv[1]), delimiter="\t"):
    kv[(r["scope"], r["key"])] = r["value"]
runs = sys.argv[2].split(",")


def num(scope, key):
    v = kv.get((scope, key), "")
    return None if v == "" else float(v)


rr, lo = num("pooled", "rr"), num("pooled", "rr_ci_lo")
d, dlo = num("pooled", "d_n_peaks"), num("pooled", "d_n_peaks_ci_lo")
run_rr = {r: num(r, "rr") for r in runs}
if num("pooled", "n_runs") != len(runs):
    sys.exit("run count mismatch")
p1 = rr is not None and rr >= 2.0
p2 = all(v is not None and v > 1 for v in run_rr.values())
p3 = d is not None and d > 0
c1 = lo is not None and lo >= 1.5
c3 = dlo is not None and dlo > 0
verdict = "PASS" if p1 and p2 and p3 and c1 and c3 else ("FAIL" if not (p1 and p2 and p3) else "INCONCLUSIVE")
print(f"E1 rr {rr} (>= 2.0: {p1}), ci_lo {lo} (>= 1.5: {c1})")
print("E2 run rr " + ", ".join(f"{r} {v}" for r, v in run_rr.items()) + f" (all > 1: {p2})")
print(f"E3 d_n_peaks {d} (> 0: {p3}), ci_lo {dlo} (> 0: {c3})")
print(f"VERDICT {verdict}")
