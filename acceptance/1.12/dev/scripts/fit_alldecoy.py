#!/usr/bin/env python3
"""#1 DEV all-decoy go/no-go statistic (PLAN-organism-chemistry #1: "an all-decoy run (decoys treated as targets)
must give empirical p roughly uniform (KS test, p > 0.01) before any held-out run"), on the outputs of
species_alldecoy.py. Fixed in this file before any all-decoy output was read. Stdlib only.

Primary statistic (the go/no-go; decision rule of PREREG-species-call.md unchanged: GO iff KS p > 0.01):
  - rows: every rank 'genus' row of species.tsv, arm ad_g_0.01_0_10_off, over the high-resolution (FTMS) DEV runs
    (meta.json analyzer); ion-trap runs are a run-level low_resolution no_call and are reported apart, as in
    fit_species.py. Every genus is false by construction (decoy index).
  - the call's p-value of a row is p = P(X >= o), X ~ Poisson(lambda), o = observed, lambda = decoy_expected (the
    reported lambda_g = spill_g + r_g * N_trials). The report lists only genera with o >= 1 and p is discrete, so
    the KS input is its randomised, truncation-corrected form
        u = [P(X > o) + V * P(X = o)] / P(X >= 1),  V ~ U(0,1) from random.Random(112) in row order
    (runs sorted by run_id, rows in file order), which is exactly U(0,1) when the reported null is right.
  - two-sided one-sample KS of the u against U(0,1), asymptotic Kolmogorov p (the ks_uniform of fit_species.py).
Reported, not part of the decision: KS of the raw p over the same rows and over the tested rows (o >= 5); the share
of rows with u <= 0.01 and <= 0.05; per-run presents (every present is a false present) for both arms, the run-level
false-present rate (runs with >= 1 present / FTMS runs) and false presents per run; the plan's negative test "an
all-decoy run must give no present genus".
Usage: fit_alldecoy.py <runs dir> <out dir>"""
import csv, json, math, random, sys
from pathlib import Path

RUNS, OUT = Path(sys.argv[1]), Path(sys.argv[2])
PRIMARY, CAND = "ad_g_0.01_0_10_off", "ad_cand"


def logpmf(k, lam):
    return -lam + k * math.log(lam) - math.lgamma(k + 1)


def cdf_le(k, lam):  # P(X <= k), summed downward from k (terms decrease below the mode when k < lam)
    if k < 0:
        return 0.0
    if k > lam:
        return 1.0 - sf_gt(k, lam)
    s, i = 0.0, k
    while i >= 0:
        t = math.exp(logpmf(i, lam))
        s += t
        if t < s * 1e-17:
            break
        i -= 1
    return min(1.0, s)


def sf_gt(k, lam):  # P(X > k), summed upward from k + 1 when k >= lam
    if k < lam:
        return 1.0 - cdf_le(k, lam)
    s, i = 0.0, k + 1
    while True:
        t = math.exp(logpmf(i, lam))
        s += t
        if t < s * 1e-17 or (t == 0.0 and i > lam):
            break
        i += 1
    return min(1.0, s)


def ks_uniform(xs):
    xs = sorted(xs)
    n = len(xs)
    d = max(max((i + 1) / n - x, x - i / n) for i, x in enumerate(xs))
    en = math.sqrt(n)
    lam = (en + 0.12 + 0.11 / en) * d
    p = 0.0
    for j in range(1, 101):
        p += 2 * (-1) ** (j - 1) * math.exp(-2 * j * j * lam * lam)
    return d, min(1.0, max(0.0, p))


def rows(f):
    with open(f) as fh:
        return [r for r in csv.DictReader(fh, delimiter="\t") if r["rank"] == "genus"]


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    rng = random.Random(112)
    us, raw, raw_tested, per_run = [], [], [], []
    for rd in sorted(p for p in RUNS.iterdir() if (p / "meta.json").exists()):
        an = json.loads((rd / "meta.json").read_text())["analyzer"]
        rec = {"run_id": rd.name, "analyzer": an}
        for arm in (PRIMARY, CAND):
            f = rd / arm / "species.tsv"
            if not f.exists():
                sys.exit(f"missing {f}")
            rr = rows(f)
            rec[f"{arm}_genus_rows"] = len(rr)
            rec[f"{arm}_present"] = sum(r["call"] == "present" for r in rr)
            rec[f"{arm}_present_genera"] = ",".join(r["name"] for r in rr if r["call"] == "present") or "-"
            if arm == PRIMARY:
                rec["calls"] = ",".join(f"{c}:{sum(r['call'] == c for r in rr)}"
                                        for c in ("present", "no_call", "not_detected"))
                rec["reasons"] = ",".join(sorted({r["call_reason"] for r in rr}))
                if an == "FTMS":
                    for r in rr:
                        o, lam = int(r["observed"]), float(r["decoy_expected"])
                        p_ge = 1.0 if o == 0 else sf_gt(o - 1, lam)
                        p_gt = sf_gt(o, lam)
                        p_eq = max(0.0, p_ge - p_gt)
                        p_ge1 = -math.expm1(-lam)
                        u = (p_gt + rng.random() * p_eq) / p_ge1
                        us.append(min(1.0, max(0.0, u)))
                        raw.append(p_ge)
                        if o >= 5:
                            raw_tested.append(p_ge)
        per_run.append(rec)
    ftms = [r for r in per_run if r["analyzer"] == "FTMS"]
    d, p = ks_uniform(us)
    rd_, rp = ks_uniform(raw)
    td, tp = ks_uniform(raw_tested) if raw_tested else (float("nan"), float("nan"))

    def runlevel(arm):
        n = len(ftms)
        k = sum(r[f"{arm}_present"] > 0 for r in ftms)
        tot = sum(r[f"{arm}_present"] for r in ftms)
        return {"runs": n, "runs_with_false_present": k, "rate": round(k / n, 4) if n else None,
                "false_present_per_run": round(tot / n, 3) if n else None, "false_present_total": tot}

    res = {
        "primary_arm": PRIMARY, "ftms_runs": len(ftms), "iontrap_runs": len(per_run) - len(ftms),
        "ks": {"n": len(us), "D": round(d, 4), "p": p, "pass": p > 0.01},
        "share_u_le_0.01": round(sum(u <= 0.01 for u in us) / len(us), 4) if us else None,
        "share_u_le_0.05": round(sum(u <= 0.05 for u in us) / len(us), 4) if us else None,
        "ks_raw_p_all_rows": {"n": len(raw), "D": round(rd_, 4), "p": rp},
        "ks_raw_p_tested_rows": {"n": len(raw_tested), "D": round(td, 4) if raw_tested else None, "p": tp},
        "false_present": {PRIMARY: runlevel(PRIMARY), CAND: runlevel(CAND)},
        "negative_test_no_present": all(r[f"{a}_present"] == 0 for r in per_run for a in (PRIMARY, CAND)),
        "decision": "GO" if p > 0.01 else "NO-GO",
    }
    (OUT / "alldecoy.json").write_text(json.dumps(res, indent=1) + "\n")
    keys = list(per_run[0].keys())
    with open(OUT / "alldecoy_runs.tsv", "w") as o:
        o.write("\t".join(keys) + "\n")
        for r in per_run:
            o.write("\t".join(str(r[k]) for k in keys) + "\n")
    print(json.dumps(res, indent=1))


if __name__ == "__main__":
    main()
