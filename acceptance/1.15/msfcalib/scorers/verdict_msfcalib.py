#!/usr/bin/env python3
"""Verdict of the msfcalib held-out test from the per-run table of score_msfcalib.py (PREREG-msfcalib.md).

C1, C2, G1, G2 on arm 2: verdict() of verdict_msfragger.py (the earlier tests' verdict, imported unchanged) on arm 2's
values; C1 additionally needs, in every run, the candidate's log line, both repetitions of a2 and of a0 returning 0.
Arm 0 is passed through the same verdict() for information (no verdict of its own).
A run is evaluable when arm b returned 0 and accepted >= 1000 spectra. Fewer than 6 evaluable runs: C2, G1, G2 and
P1 to P3 are INCONCLUSIVE. Otherwise:
  P1  median over the evaluable runs of recall_2 - recall_0 > 0 (a missing recall counts as 0).
  P2  no evaluable run whose aE0 FDP is <= 0.020 has an aE2 FDP > 0.020 (an aE2 value that cannot be computed in
      such a run fails). Fewer than 6 evaluable runs with an aE0 FDP: INCONCLUSIVE.
  P3  speedup_2 > 1.0 in every evaluable run (a value that cannot be computed fails).
Overall: FAIL if any of C1, C2, G1, G2, P1, P2, P3 fails; else INCONCLUSIVE if any is inconclusive; else PASS.
Usage: verdict_msfcalib.py <runs.tsv> <n_staged_runs>"""
import csv, os, statistics, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from verdict_msfragger import verdict, num, MIN_EVAL, MIN_B, SPEED_MIN, FDP_RUN_MAX

def arm_rows(rows, X):
    """rows in the column layout of score_msfragger.py for arm X (the keys verdict() reads)."""
    out = []
    for r in rows:
        out.append({"run": r["run"], "fastag_rc": r["fastag_rc"], "a_rc": r[f"a{X}_rc"],
                    "export_unchanged": r["export_unchanged"], "a_psm": r[f"a{X}_psm"], "b_rc": r["b_rc"],
                    "b_psm": r["b_psm"], "recall": r[f"recall_{X}"], "b_in_a_same_peptide": r[f"kept_{X}"],
                    "speedup": r[f"speedup_{X}"], "aE_rc": r[f"aE{X}_rc"], "aE_t": r[f"aE{X}_t"], "aE_e": r[f"aE{X}_e"]})
    return out

def full_verdict(rows, n_runs):
    v2, v0 = verdict(arm_rows(rows, "2"), n_runs), verdict(arm_rows(rows, "0"), n_runs)
    out = {k: v2[k] for k in ("evaluable", "C1", "C2", "G1", "G2")}
    extra = [r["run"] for r in rows if not ((num(r["calib_logline"]) or 0) >= 1 and r["a0_rc"] == "0")]
    if extra or len(rows) != n_runs:
        out["C1"] = ("FAIL", f"{v2['C1'][1]}; log line or a0 failed in: {','.join(extra) or '-'}")
    ev = [r for r in rows if r["b_rc"] == "0" and (num(r["b_psm"]) or 0) >= MIN_B]
    if len(ev) < MIN_EVAL:
        for c in ("P1", "P2", "P3"):
            out[c] = ("INCONCLUSIVE", f"{len(ev)} evaluable runs < {MIN_EVAL}")
    else:
        d = [(num(r["recall_2"]) or 0.0) - (num(r["recall_0"]) or 0.0) for r in ev]
        out["P1"] = ("PASS" if statistics.median(d) > 0 else "FAIL",
                     f"median {statistics.median(d):+.4f} min {min(d):+.4f} max {max(d):+.4f} higher in "
                     f"{sum(x > 0 for x in d)} lower in {sum(x < 0 for x in d)} of {len(d)}")
        base = [r for r in ev if num(r["aE0_fdp"]) is not None]
        if len(base) < MIN_EVAL:
            out["P2"] = ("INCONCLUSIVE", f"{len(base)} aE0 values < {MIN_EVAL}")
        else:
            bad = [r["run"] for r in base if num(r["aE0_fdp"]) <= FDP_RUN_MAX
                   and (num(r["aE2_fdp"]) is None or num(r["aE2_fdp"]) > FDP_RUN_MAX)]
            out["P2"] = ("PASS" if not bad else "FAIL", f"runs crossing {FDP_RUN_MAX}: {','.join(bad) or 'none'} "
                         f"(n {len(base)}; above under aE0 already: "
                         f"{','.join(r['run'] for r in base if num(r['aE0_fdp']) > FDP_RUN_MAX) or 'none'})")
        sp = [num(r["speedup_2"]) for r in ev]
        low = [r["run"] for r, s in zip(ev, sp) if s is None or s <= SPEED_MIN]
        vals = [s for s in sp if s is not None]
        out["P3"] = ("PASS" if not low else "FAIL",
                     f"min {min(vals):.3f} (n {len(vals)} of {len(ev)}); at or below {SPEED_MIN} or missing: "
                     f"{','.join(low) or 'none'}" if vals else "no speed-up value")
    v = [out[c][0] for c in ("C1", "C2", "G1", "G2", "P1", "P2", "P3")]
    out["OVERALL"] = ("FAIL" if "FAIL" in v else "INCONCLUSIVE" if "INCONCLUSIVE" in v else "PASS", "")
    for c in ("C2", "G1", "G2"):
        out[f"arm0_{c}"] = ("info", f"{v0[c][0]}: {v0[c][1]}")
    return out

if __name__ == "__main__":
    rows = list(csv.DictReader(open(sys.argv[1]), delimiter="\t"))
    res = full_verdict(rows, int(sys.argv[2]))
    print("criterion\tverdict\tdetail")
    for k in ("evaluable", "C1", "C2", "G1", "G2", "P1", "P2", "P3", "OVERALL", "arm0_C2", "arm0_G1", "arm0_G2"):
        print(k, *res[k], sep="\t")
