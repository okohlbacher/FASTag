#!/usr/bin/env python3
"""Verdict of the msfragger held-out test (backlog item 18) from the per-run table of score_msfragger.py.

Thresholds (PREREG-msfragger.md):
  C1  every run of the manifest: FASTag exit 0, MSFragger exit 0 on the exported files, the exported files
      unchanged by the search, at least one accepted target PSM in arm a. Any run failing -> FAIL.
  A run is evaluable when arm b exited 0 and accepted >= 1000 spectra. Fewer than 6 evaluable runs -> C2, G1 and
  G2 are INCONCLUSIVE. Over the evaluable runs (a missing arm-a value counts as recall 0):
  C2  recall >= 0.80 in every run.
  G1  median speed-up wall(b) / (wall(fastag) + wall(a)) > 1.0 (runs without all three times: no speed-up value;
      fewer than 6 values -> INCONCLUSIVE).
  G2  pooled entrapment FDP of arm aE, 2 sum(E) / sum(T + E), <= 0.015 and every run's FDP <= 0.020
      (runs without an aE result: no value; fewer than 6 values -> INCONCLUSIVE).
  Overall: FAIL if any criterion is FAIL; else INCONCLUSIVE if any is INCONCLUSIVE; else PASS.
Usage: verdict_msfragger.py <runs.tsv> [n_manifest_runs=8]"""
import csv, os, statistics, sys

N_RUNS, MIN_EVAL, MIN_B = 8, 6, 1000
RECALL_MIN, SPEED_MIN, FDP_POOLED_MAX, FDP_RUN_MAX = 0.80, 1.0, 0.015, 0.020

def num(x):
    return None if x in ("NA", "", None) else float(x)

def verdict(rows, n_runs=N_RUNS):
    out = {}
    ok1 = [r["run"] for r in rows if r["fastag_rc"] == "0" and r["a_rc"] == "0" and r["export_unchanged"] == "1"
           and (num(r["a_psm"]) or 0) >= 1]
    out["C1"] = ("PASS" if len(ok1) == n_runs and len(rows) == n_runs else "FAIL", f"{len(ok1)} of {n_runs} runs")
    ev = [r for r in rows if r["b_rc"] == "0" and (num(r["b_psm"]) or 0) >= MIN_B]
    out["evaluable"] = (len(ev), ",".join(r["run"] for r in ev))
    if len(ev) < MIN_EVAL:
        for c in ("C2", "G1", "G2"):
            out[c] = ("INCONCLUSIVE", f"{len(ev)} evaluable runs < {MIN_EVAL}")
    else:
        rec = [num(r["recall"]) or 0.0 for r in ev]
        pooled = sum(num(r["b_in_a_same_peptide"]) or 0 for r in ev) / sum(num(r["b_psm"]) for r in ev)
        out["C2"] = ("PASS" if min(rec) >= RECALL_MIN else "FAIL",
                     f"min {min(rec):.4f} median {statistics.median(rec):.4f} pooled {pooled:.4f} (n {len(rec)})")
        sp = [num(r["speedup"]) for r in ev if num(r["speedup"]) is not None]
        if len(sp) < MIN_EVAL:
            out["G1"] = ("INCONCLUSIVE", f"{len(sp)} speed-up values < {MIN_EVAL}")
        else:
            out["G1"] = ("PASS" if statistics.median(sp) > SPEED_MIN else "FAIL",
                         f"median {statistics.median(sp):.3f} min {min(sp):.3f} max {max(sp):.3f} (n {len(sp)})")
        fd = [(num(r["aE_t"]), num(r["aE_e"])) for r in ev if r["aE_rc"] == "0" and num(r["aE_t"]) is not None
              and num(r["aE_t"]) + num(r["aE_e"]) > 0]
        if len(fd) < MIN_EVAL:
            out["G2"] = ("INCONCLUSIVE", f"{len(fd)} aE results < {MIN_EVAL}")
        else:
            pooled = 2 * sum(e for _, e in fd) / sum(t + e for t, e in fd)
            worst = max(2 * e / (t + e) for t, e in fd)
            out["G2"] = ("PASS" if pooled <= FDP_POOLED_MAX and worst <= FDP_RUN_MAX else "FAIL",
                         f"pooled {pooled:.4f} max run {worst:.4f} (n {len(fd)})")
    v = [out[c][0] for c in ("C1", "C2", "G1", "G2")]
    out["OVERALL"] = ("FAIL" if "FAIL" in v else "INCONCLUSIVE" if "INCONCLUSIVE" in v else "PASS", "")
    return out

if __name__ == "__main__":
    if sys.argv[1:2] == ["--selftest"]:   # 1.14: synthetic checks of scorer and verdict (verdict_msfragger_test.py)
        import runpy; runpy.run_path(os.path.join(os.path.dirname(os.path.abspath(__file__)), "verdict_msfragger_test.py"), run_name="__main__"); sys.exit(0)
    rows = list(csv.DictReader(open(sys.argv[1]), delimiter="\t"))
    res = verdict(rows, int(sys.argv[2]) if len(sys.argv) > 2 else N_RUNS)
    print("criterion\tverdict\tdetail")
    for k in ("evaluable", "C1", "C2", "G1", "G2", "OVERALL"):
        print(k, *res[k], sep="\t")
