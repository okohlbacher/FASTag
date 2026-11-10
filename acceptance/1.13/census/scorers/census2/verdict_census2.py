#!/usr/bin/env python3
"""FASTag 1.13 item 7 (#11 triage), second held-out test: the preregistered verdict (PREREG-census-2.md).

    verdict_census2.py <primary eval.tsv> <scored run labels, comma-separated> <drawn run labels, comma-separated> [min evaluable runs, default 6]

The primary eval.tsv is the output of census_triage_eval.py (--fdr subset) over the scored runs. A drawn run that is
not scored (excluded under the PREREG's technical-failure rule) counts as not evaluable.
A run is evaluable when the scorer writes evaluable = 1 (its unidentified spectra have a hit; t_u > 0).
E0: at least <min> of the drawn runs are evaluable.
E1: pooled rr >= 2.0 and rr_ci_lo >= 1.5 (all scored runs pooled).
E2: rr > 1 in every evaluable run (inf counts as > 1; an undefined rr in an evaluable run fails).
E3: pooled d_n_peaks > 0 and d_n_peaks_ci_lo > 0 (all scored runs pooled).
Verdict, in this order:
  1. E0 fails                                   -> INCONCLUSIVE (whatever E1 to E3 say)
  2. a point criterion fails (pooled rr < 2.0 or undefined, an evaluable run with rr <= 1 or undefined,
     pooled d <= 0 or undefined)                -> FAIL
  3. a CI criterion fails (bound below the limit or undefined) -> INCONCLUSIVE
  4. otherwise                                  -> PASS
Malformed input (missing or duplicate keys, run lists that do not match the table, evaluable inconsistent with t_u,
NaN) is refused with exit status 2 and no verdict line.
"""
import csv
import math
import sys


def die(msg):
    sys.stderr.write(f"verdict_census2: {msg}\n")
    sys.exit(2)


def main(argv):
    if len(argv) not in (4, 5):
        die("usage: verdict_census2.py <primary eval.tsv> <scored runs> <drawn runs> [min evaluable]")
    kv = {}
    with open(argv[1], newline="") as f:
        for r in csv.DictReader(f, delimiter="\t"):
            k = (r["scope"], r["key"])
            if k in kv:
                die(f"key twice: {k}")
            kv[k] = r["value"]
    scored = [x for x in argv[2].split(",") if x != ""]
    drawn = [x for x in argv[3].split(",") if x != ""]
    try:
        need = int(argv[4]) if len(argv) == 5 else 6
    except ValueError:
        die("min evaluable runs is not an integer")
    if need < 1 or need > len(drawn):
        die("min evaluable runs outside 1..number of drawn runs")
    if len(set(scored)) != len(scored) or len(set(drawn)) != len(drawn):
        die("a run label twice")
    if "pooled" in drawn:
        die("a run is labelled 'pooled'")
    if not set(scored) <= set(drawn):
        die("a scored run is not a drawn run")
    if not scored:
        die("no scored run")

    def num(scope, key, required=False):
        if (scope, key) not in kv:
            if required:
                die(f"missing {scope} {key}")
            return None
        v = kv[(scope, key)]
        if v == "":
            if required:
                die(f"empty {scope} {key}")
            return None
        try:
            x = float(v)
        except ValueError:
            die(f"not a number: {scope} {key} = {v!r}")
        if math.isnan(x):
            die(f"NaN: {scope} {key}")
        return x

    scopes = {s for s, _ in kv} - {"pooled"}
    if scopes != set(scored):
        die(f"runs in the table {sorted(scopes)} != scored runs {sorted(scored)}")
    if num("pooled", "n_runs", True) != len(scored):
        die("pooled n_runs != number of scored runs")
    ev = []
    for r in scored:
        e, tu = num(r, "evaluable", True), num(r, "t_u", True)
        if e not in (0.0, 1.0) or (e == 1.0) != (tu > 0):
            die(f"evaluable inconsistent with t_u in {r}")
        if e == 1.0:
            ev.append(r)
    if num("pooled", "evaluable", True) != len(ev):
        die("pooled evaluable != number of evaluable runs")
    for k in ("rr", "rr_ci_lo", "d_n_peaks", "d_n_peaks_ci_lo"):
        if ("pooled", k) not in kv and not (k.endswith("_ci_lo") and len(scored) < 2):
            die(f"missing pooled {k}")

    rr, lo = num("pooled", "rr"), num("pooled", "rr_ci_lo")
    d, dlo = num("pooled", "d_n_peaks"), num("pooled", "d_n_peaks_ci_lo")
    run_rr = {}
    for r in ev:
        if (r, "rr") not in kv:
            die(f"missing {r} rr")
        run_rr[r] = num(r, "rr")
    e0 = len(ev) >= need
    p1 = rr is not None and rr >= 2.0
    p2 = all(v is not None and v > 1 for v in run_rr.values())
    p3 = d is not None and d > 0
    c1 = lo is not None and lo >= 1.5
    c3 = dlo is not None and dlo > 0
    if not e0:
        verdict = "INCONCLUSIVE"
    elif not (p1 and p2 and p3):
        verdict = "FAIL"
    elif not (c1 and c3):
        verdict = "INCONCLUSIVE"
    else:
        verdict = "PASS"
    not_ev = [f"{r} (q_min {kv.get((r, 'q_min'), '')})" for r in scored if r not in ev]
    not_scored = [r for r in drawn if r not in scored]
    print(f"E0 evaluable {len(ev)} of {len(drawn)} drawn (>= {need}: {e0}); scored {len(scored)}; "
          f"not evaluable: {', '.join(not_ev) or 'none'}; not scored: {', '.join(not_scored) or 'none'}")
    print(f"E1 rr {rr} (>= 2.0: {p1}), ci_lo {lo} (>= 1.5: {c1})")
    print("E2 run rr " + (", ".join(f"{r} {v}" for r, v in run_rr.items()) or "none") + f" (all > 1: {p2})")
    print(f"E3 d_n_peaks {d} (> 0: {p3}), ci_lo {dlo} (> 0: {c3})")
    print(f"VERDICT {verdict}")


if __name__ == "__main__":
    main(sys.argv)
