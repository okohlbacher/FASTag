#!/usr/bin/env python3
"""hdrcharge second held-out round (PREREG-item14r.md): the verdict from score_item14r.py's as-given table.

A run is evaluable when its status is ok, its name is not in --failed (FASTag or Sage exit code not 0) and it has
at least 500 truth spectra. All criteria are pooled over the evaluable runs.
  H0  at least 4 of the 5 runs evaluable and at least 200 wrong headers pooled; else INCONCLUSIVE
  H1  precision tp / flagged: Wilson 95 % lower bound >= 0.60 (no flag: not met)
  H2  sensitivity tp / wrong >= 0.20
  H3  fp / right <= 0.005 pooled and <= 0.010 in every evaluable run
PASS: H0 and H1 and H2 and H3. FAIL: H0 holds and one of H1-H3 does not. INCONCLUSIVE: H0 does not hold.
Usage: verdict_item14r.py <asgiven.tsv> [--failed run1,run2] [--runs 5]     (JSON on stdout)"""
import csv
import json
import math
import sys

MIN_TRUTH, MIN_RUNS, MIN_WRONG = 500, 4, 200
H1_LO, H2_MIN, H3_POOL, H3_RUN = 0.60, 0.20, 0.005, 0.010
SUM = ["truth", "wrong", "right", "flagged", "tp", "fp", "tp_charge", "decoy_other"]


def wilson(k, n, z=1.959963984540054):
    if n == 0:
        return (None, None)
    p = k / n
    d = 1 + z * z / n
    c = p + z * z / (2 * n)
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return ((c - h) / d, (c + h) / d)


def ratio(a, b):
    return a / b if b else None


def stats(c):
    lo, hi = wilson(c["tp"], c["flagged"])
    return dict(c, precision=ratio(c["tp"], c["flagged"]), precision_wilson95_lo=lo, precision_wilson95_hi=hi,
                sensitivity=ratio(c["tp"], c["wrong"]), right_flagged=ratio(c["fp"], c["right"]),
                precision_charge=ratio(c["tp_charge"], c["flagged"]))


def main():
    a = sys.argv[1:]
    failed = set()
    nruns = 5
    if "--failed" in a:
        i = a.index("--failed")
        failed = {x for x in a[i + 1].split(",") if x}
        del a[i:i + 2]
    if "--runs" in a:
        i = a.index("--runs")
        nruns = int(a[i + 1])
        del a[i:i + 2]
    rows = list(csv.DictReader(open(a[0]), delimiter="\t"))
    runs, ev = [], []
    for r in rows:
        c = {k: int(r[k]) for k in SUM}
        why = ("technical failure" if r["run"] in failed else "no table" if r["status"] != "ok"
               else f"truth spectra < {MIN_TRUTH}" if c["truth"] < MIN_TRUTH else "")
        s = dict(stats(c), run=r["run"], instrument_class=r["class"], evaluable=not why, not_evaluable_because=why)
        runs.append(s)
        if not why:
            ev.append(s)

    def pool(sel):
        return stats({k: sum(s[k] for s in sel) for k in SUM})

    p = pool(ev)
    h0 = len(rows) == nruns and len(ev) >= MIN_RUNS and p["wrong"] >= MIN_WRONG
    h1 = p["precision_wilson95_lo"] is not None and p["precision_wilson95_lo"] >= H1_LO
    h2 = p["sensitivity"] is not None and p["sensitivity"] >= H2_MIN
    worst = max((s["right_flagged"] for s in ev if s["right_flagged"] is not None), default=None)
    h3 = (p["right_flagged"] is not None and p["right_flagged"] <= H3_POOL and worst is not None and worst <= H3_RUN
          and all(s["right_flagged"] is not None for s in ev))
    verdict = "INCONCLUSIVE" if not h0 else ("PASS" if h1 and h2 and h3 else "FAIL")
    out = {"verdict": verdict,
           "H0": {"met": h0, "runs_listed": len(rows), "runs_expected": nruns, "runs_evaluable": len(ev),
                  "wrong_headers_pooled": p["wrong"], "need": f">= {MIN_RUNS} runs evaluable, >= {MIN_WRONG} wrong headers"},
           "H1": {"met": h1, "precision": p["precision"], "wilson95_lo": p["precision_wilson95_lo"], "need_lo": H1_LO},
           "H2": {"met": h2, "sensitivity": p["sensitivity"], "need": H2_MIN},
           "H3": {"met": h3, "right_flagged_pooled": p["right_flagged"], "right_flagged_worst_run": worst,
                  "need_pooled": H3_POOL, "need_run": H3_RUN},
           "pooled_evaluable": p,
           "by_class": {c: pool([s for s in ev if s["instrument_class"] == c])
                        for c in sorted({s["instrument_class"] for s in ev})},
           "runs": runs}
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
