#!/usr/bin/env python3
"""Synthetic-input tests of verdict_census2.py (PREREG-census-2.md): PASS, FAIL on each point criterion,
INCONCLUSIVE (E0, CI), precedence, boundaries, and refused input.

    verdict_census2_test.py            (runs verdict_census2.py next to this file)
"""
import os
import subprocess
import sys
import tempfile
import unittest

V = os.path.join(os.path.dirname(os.path.abspath(__file__)), "verdict_census2.py")
DRAWN = [f"R{i}" for i in range(1, 9)]


def table(runs, pooled=None, drop=()):
    """runs: {label: (evaluable, t_u, rr or '')}; pooled overrides; drop: (scope, key) pairs left out."""
    p = {"n_runs": len(runs), "evaluable": sum(1 for e, _, _ in runs.values() if e == 1), "rr": 3.0, "rr_ci_lo": 1.8,
         "d_n_peaks": 0.04, "d_n_peaks_ci_lo": 0.01}
    p.update(pooled or {})
    rows = [("scope", "key", "value")]
    for r, (e, tu, rr) in runs.items():
        rows += [(r, "evaluable", e), (r, "t_u", tu), (r, "rr", rr), (r, "q_min", 0.002 if e == 1 else 0.03)]
    rows += [("pooled", k, v) for k, v in p.items()]
    return "".join("\t".join(map(str, r)) + "\n" for r in rows if (r[0], r[1]) not in drop)


def run(text, scored, drawn=DRAWN, need=None):
    with tempfile.NamedTemporaryFile("w", suffix=".tsv", delete=False) as f:
        f.write(text)
    a = [sys.executable, V, f.name, ",".join(scored), ",".join(drawn)] + ([str(need)] if need is not None else [])
    r = subprocess.run(a, capture_output=True, text=True)
    os.unlink(f.name)
    v = [l.split()[1] for l in r.stdout.splitlines() if l.startswith("VERDICT")]
    return r.returncode, (v[0] if v else None), r.stdout


def good(n=8, ne=0, rr=3.0):
    """n scored runs, the last ne of them not evaluable."""
    return {f"R{i}": ((1, 200, rr) if i <= n - ne else (0, 0, "")) for i in range(1, n + 1)}


class T(unittest.TestCase):
    def v(self, runs, want, pooled=None, need=None, drop=()):
        rc, verdict, out = run(table(runs, pooled, drop), list(runs), need=need)
        self.assertEqual((rc, verdict), (0, want), out)
        return out

    def refused(self, text, scored, drawn=DRAWN, need=None):
        rc, verdict, out = run(text, scored, drawn, need)
        self.assertEqual((rc, verdict), (2, None), out)

    def test_pass(self):
        self.v(good(), "PASS")
        out = self.v(good(8, 2), "PASS")                      # 6 of 8 evaluable, 2 scored but not evaluable
        self.assertIn("E0 evaluable 6 of 8 drawn (>= 6: True)", out)
        self.assertIn("R7 (q_min 0.03)", out)
        self.v(good(6), "PASS")                               # 2 runs excluded, 6 scored and evaluable
        self.v(good(7, 1), "PASS")                            # 1 excluded, 1 not evaluable

    def test_pass_boundaries_and_inf(self):
        self.v(good(), "PASS", {"rr": 2.0, "rr_ci_lo": 1.5, "d_n_peaks": 1e-9, "d_n_peaks_ci_lo": 1e-10})
        r = good(); r["R3"] = (1, 5, "inf")
        self.v(r, "PASS", {"rr": "inf", "rr_ci_lo": "inf"})
        self.v(good(rr=1.0000001), "PASS")

    def test_fail_e1(self):
        self.v(good(), "FAIL", {"rr": 1.9999999})
        self.v(good(), "FAIL", {"rr": ""})                    # pooled rr undefined
        self.v(good(), "FAIL", {"rr": 1.2, "rr_ci_lo": 1.0})   # point and CI fail: FAIL, not INCONCLUSIVE

    def test_fail_e2(self):
        for bad in (0.9, 1.0, 0.0, ""):                       # rr <= 1 or undefined in an evaluable run
            r = good(); r["R4"] = (1, 150, bad)
            out = self.v(r, "FAIL")
            self.assertIn("(all > 1: False)", out)
        r = good(8, 2); r["R1"] = (1, 3, "")                  # 6 evaluable, one of them with no triage candidate
        self.v(r, "FAIL")

    def test_fail_e3(self):
        for d in (0.0, -0.01, ""):
            self.v(good(), "FAIL", {"d_n_peaks": d, "d_n_peaks_ci_lo": -0.02})
        self.v(good(), "FAIL", {"d_n_peaks": -0.01, "d_n_peaks_ci_lo": 0.01})

    def test_inconclusive_e0(self):
        out = self.v(good(8, 3), "INCONCLUSIVE")              # 5 evaluable, everything else passes
        self.assertIn("(>= 6: False)", out)
        self.v(good(5), "INCONCLUSIVE")                       # 3 excluded
        self.v(good(7, 2), "INCONCLUSIVE")                    # 1 excluded, 2 not evaluable
        self.v(good(8, 8), "INCONCLUSIVE", {"rr": "", "d_n_peaks": 0.0})
        # E0 comes first: a failing point criterion does not turn too few evaluable runs into FAIL
        self.v(good(8, 3), "INCONCLUSIVE", {"rr": 1.1})
        r = good(8, 3); r["R1"] = (1, 100, 0.5)
        self.v(r, "INCONCLUSIVE")
        self.v(good(8, 3), "INCONCLUSIVE", {"d_n_peaks": -0.1})
        self.v(good(1), "INCONCLUSIVE", drop={("pooled", "rr_ci_lo"), ("pooled", "d_n_peaks_ci_lo")})

    def test_inconclusive_ci(self):
        self.v(good(), "INCONCLUSIVE", {"rr_ci_lo": 1.4999})
        self.v(good(), "INCONCLUSIVE", {"d_n_peaks_ci_lo": 0.0})
        self.v(good(), "INCONCLUSIVE", {"d_n_peaks_ci_lo": -0.001})
        self.v(good(), "INCONCLUSIVE", {"rr_ci_lo": ""})
        self.v(good(), "INCONCLUSIVE", {"d_n_peaks_ci_lo": ""})

    def test_min_argument(self):
        self.v(good(8, 3), "PASS", need=5)
        self.v(good(8, 1), "INCONCLUSIVE", need=8)

    def test_refused(self):
        g = good()
        self.refused(table(g, {"n_runs": 7}), list(g))
        self.refused(table(g, {"evaluable": 7}), list(g))
        self.refused(table(g, drop={("R2", "evaluable")}), list(g))
        self.refused(table(g, drop={("R2", "t_u")}), list(g))
        self.refused(table(g, drop={("R2", "rr")}), list(g))
        self.refused(table(g, drop={("pooled", "rr")}), list(g))
        self.refused(table(g, drop={("pooled", "d_n_peaks_ci_lo")}), list(g))
        b = dict(g); b["R2"] = (1, 0, 3.0)
        self.refused(table(b), list(b))                       # evaluable 1 with t_u 0
        b = dict(g); b["R2"] = (0, 10, "")
        self.refused(table(b), list(b))                       # evaluable 0 with t_u > 0
        b = dict(g); b["R2"] = (2, 10, 3.0)
        self.refused(table(b), list(b))
        self.refused(table(g, {"rr": "nan"}), list(g))
        self.refused(table(g, {"rr": "abc"}), list(g))
        self.refused(table(g), list(g)[:7])                   # the table has a run that is not in the scored list
        self.refused(table(good(7)), list(g))                 # a scored run is not in the table
        self.refused(table(g), list(g), drawn=DRAWN[:7])      # scored run not drawn
        self.refused(table(g), list(g) + ["R1"])              # label twice
        self.refused(table(g) + "pooled\trr\t5\n", list(g))   # key twice
        self.refused(table(g), list(g), need=9)
        self.refused(table(g), list(g), need=0)


if __name__ == "__main__":
    unittest.main()
