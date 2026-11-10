#!/usr/bin/env python3
"""Verdict of the hybrid arm from the scorer tables. Thresholds are the ones of PREREG-hybrid.md.

Usage: verdict_hybrid.py <score dir with spectra.tsv and runs.tsv> [--selftest]
Writes <score dir>/verdict.tsv (one row per criterion) and <score dir>/projects.tsv, prints both.

Unit of a difference: the project (all its valid runs pooled). A run is valid when both arms returned 0.
P  primary  macro mean over projects of (both - by) in the share of truth spectra with at least one correct tag,
            in percentage points; 95 % interval from 2,000 bootstrap draws of the peptide clusters within each
            project (seed 113). PASS: lower bound > MARGIN and no project below -PROJECT_LOSS.
G1 precision  correct tag rows / tag rows on the truth spectra, macro mean of (both - by) in percentage points.
            PASS: >= -PREC_DROP.
G2 runtime  CPU seconds (user + system) of both, summed over the valid runs, over the same sum of by.
            PASS: <= CPU_FACTOR.
Fewer than MIN_PROJECTS projects with a valid run: every verdict is INCONCLUSIVE."""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

MARGIN, PROJECT_LOSS, PREC_DROP, CPU_FACTOR, MIN_PROJECTS, NBOOT, SEED = 1.0, 1.0, 1.0, 2.0, 4, 2000, 113


def project_stats(d):
    n = len(d)
    by, both = 100 * (d.by_correct > 0).mean(), 100 * (d.both_correct > 0).mean()
    pby = 100 * d.by_correct.sum() / max(d.by_rows.sum(), 1)
    pboth = 100 * d.both_correct.sum() / max(d.both_rows.sum(), 1)
    return n, by, both, pby, pboth


def verdict(spectra, runs):
    ok = runs[(runs.by_rc == 0) & (runs.both_rc == 0)]
    sp = spectra.merge(ok[["project", "run"]], on=["project", "run"])
    rows, groups = [], {}
    for prj, d in sp.groupby("project"):
        n, by, both, pby, pboth = project_stats(d)
        r = ok[ok.project == prj]
        rows.append({"project": prj, "runs": len(r), "truth_spectra": n, "clusters": d.cluster.nunique(),
                     "by_pct": by, "both_pct": both, "diff_pp": both - by, "by_precision": pby,
                     "both_precision": pboth, "precision_diff_pp": pboth - pby,
                     "by_tags_per_spectrum": d.by_correct.mean(), "both_tags_per_spectrum": d.both_correct.mean(),
                     "by_rank1_pct": 100 * d.by_r1.mean(), "both_rank1_pct": 100 * d.both_r1.mean(),
                     "both_correct_rows_by": int(d.both_correct_by.sum()),
                     "both_correct_rows_cz": int(d.both_correct_cz.sum()),
                     "spectra_gained": int(((d.both_correct > 0) & (d.by_correct == 0)).sum()),
                     "spectra_lost": int(((d.both_correct == 0) & (d.by_correct > 0)).sum()),
                     "by_cpu_s": r.by_cpu_s.sum(), "both_cpu_s": r.both_cpu_s.sum(),
                     "by_wall_s": r.by_wall_s.sum(), "both_wall_s": r.both_wall_s.sum()})
        # per cluster: number of spectra, spectra with a correct tag in each arm
        g = d.assign(a=(d.by_correct > 0), b=(d.both_correct > 0)).groupby("cluster").agg(
            n=("a", "size"), a=("a", "sum"), b=("b", "sum"))
        groups[prj] = g.to_numpy(dtype=float)
    prj = pd.DataFrame(rows)
    k = len(prj)
    rng = np.random.default_rng(SEED)
    boot = np.zeros(NBOOT)
    for g in groups.values():
        idx = rng.integers(0, len(g), size=(NBOOT, len(g)))
        s = g[idx].sum(axis=1)                      # NBOOT x 3
        boot += 100 * (s[:, 2] - s[:, 1]) / s[:, 0]
    boot /= max(k, 1)
    diff = prj.diff_pp.mean() if k else float("nan")
    lo, hi = (np.percentile(boot, [2.5, 97.5]) if k else (float("nan"),) * 2)
    worst = prj.diff_pp.min() if k else float("nan")
    pdiff = prj.precision_diff_pp.mean() if k else float("nan")
    cpu = prj.both_cpu_s.sum() / prj.by_cpu_s.sum() if k and prj.by_cpu_s.sum() > 0 else float("nan")
    inc = k < MIN_PROJECTS

    def v(passed):
        return "INCONCLUSIVE" if inc else ("PASS" if passed else "FAIL")
    out = pd.DataFrame([
        {"criterion": "P", "value": f"{diff:+.2f} pp [{lo:+.2f}, {hi:+.2f}]; worst project {worst:+.2f} pp",
         "threshold": f"lower bound > +{MARGIN} pp and no project below -{PROJECT_LOSS} pp",
         "verdict": v(lo > MARGIN and worst >= -PROJECT_LOSS)},
        {"criterion": "G1", "value": f"{pdiff:+.2f} pp", "threshold": f">= -{PREC_DROP} pp",
         "verdict": v(pdiff >= -PREC_DROP)},
        {"criterion": "G2", "value": f"{cpu:.2f}", "threshold": f"<= {CPU_FACTOR}", "verdict": v(cpu <= CPU_FACTOR)},
        {"criterion": "projects", "value": str(k), "threshold": f">= {MIN_PROJECTS}",
         "verdict": "INCONCLUSIVE" if inc else "ok"}])
    return prj, out


def selftest():
    rng = np.random.default_rng(1)

    def make(n_prj, p_by, p_both, cpu):
        sp, rn = [], []
        for p in range(n_prj):
            n = 600
            by = rng.random(n) < p_by
            both = by | (rng.random(n) < (p_both - p_by) / (1 - p_by))
            sp.append(pd.DataFrame({"project": f"P{p}", "run": "r", "key": [f"scan={i}" for i in range(n)],
                                    "cluster": [f"c{i // 2}" for i in range(n)], "charge": 3,
                                    "by_rows": 40, "by_correct": by * 4, "by_r1": by * 1,
                                    "both_rows": 40, "both_correct": both * 5, "both_r1": both * 1,
                                    "both_rows_by": 20, "both_correct_by": both * 2,
                                    "both_rows_cz": 20, "both_correct_cz": both * 3}))
            rn.append({"project": f"P{p}", "run": "r", "by_rc": 0, "both_rc": 0, "by_cpu_s": 10.0,
                       "both_cpu_s": 10.0 * cpu, "by_wall_s": 2.0, "both_wall_s": 3.0})
        return pd.concat(sp), pd.DataFrame(rn)
    want = [((5, 0.80, 0.90, 1.5), ["PASS", "PASS", "PASS"]), ((5, 0.80, 0.80, 1.5), ["FAIL", "PASS", "PASS"]),
            ((5, 0.80, 0.90, 2.5), ["PASS", "PASS", "FAIL"]), ((3, 0.80, 0.90, 1.5), ["INCONCLUSIVE"] * 3)]
    for args, exp in want:
        _, out = verdict(*make(*args))
        assert list(out.verdict[:3]) == exp, (args, out)
    sp, rn = make(5, 0.80, 0.90, 1.5)
    sp["both_rows"] = 80                                    # precision halves
    assert list(verdict(sp, rn)[1].verdict[:3]) == ["PASS", "FAIL", "PASS"]
    rn.loc[rn.project.isin(["P0", "P1"]), "both_rc"] = 1    # two projects lose their only run
    assert list(verdict(sp, rn)[1].verdict[:3]) == ["INCONCLUSIVE"] * 3
    print("selftest ok")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
        sys.exit(0)
    d = Path(sys.argv[1])
    prj, out = verdict(pd.read_csv(d / "spectra.tsv", sep="\t"), pd.read_csv(d / "runs.tsv", sep="\t"))
    prj.to_csv(d / "projects.tsv", sep="\t", index=False, float_format="%.3f")
    out.to_csv(d / "verdict.tsv", sep="\t", index=False)
    print(prj.to_string(index=False, float_format="%.3f"))
    print(out.to_string(index=False))
