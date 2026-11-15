#!/usr/bin/env python3
"""Synthetic checks of verdict_msfcalib.full_verdict (no held-out data). Usage: verdict_msfcalib_test.py"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from verdict_msfcalib import full_verdict

def row(i, r0=0.90, r2=0.92, f0=0.010, f2=0.011, s2=1.5, **kw):
    r = {"run": f"R{i}", "fastag_rc": "0", "calib_logline": "1", "export_unchanged": "1", "b_rc": "0", "b_psm": "5000",
         "a0_rc": "0", "a2_rc": "0", "a0_psm": "4800", "a2_psm": "4900",
         "recall_0": str(r0), "recall_2": str(r2), "kept_0": str(int(r0 * 5000)), "kept_2": str(int(r2 * 5000)),
         "aE0_rc": "0", "aE2_rc": "0", "aE0_t": "5000", "aE2_t": "5000",
         "aE0_e": str(round(f0 * 5000 / (2 - f0))), "aE2_e": str(round(f2 * 5000 / (2 - f2))),
         "aE0_fdp": str(f0), "aE2_fdp": str(f2), "speedup_0": "2.5", "speedup_2": str(s2)}
    r.update(kw)
    return r

def check(name, rows, n, want):
    v = full_verdict(rows, n)
    got = {k: v[k][0] for k in want}
    assert got == want, f"{name}: {got} != {want}\n{v}"

base = [row(i) for i in range(10)]
check("all pass", base, 10, {"C1": "PASS", "C2": "PASS", "G1": "PASS", "G2": "PASS", "P1": "PASS", "P2": "PASS",
                             "P3": "PASS", "OVERALL": "PASS"})
check("a0 rc", base[:9] + [row(9, a0_rc="1,0")], 10, {"C1": "FAIL", "OVERALL": "FAIL"})
check("log line", base[:9] + [row(9, calib_logline="0")], 10, {"C1": "FAIL"})
check("missing run", base[:9], 10, {"C1": "FAIL"})
check("P1 median", [row(i, r2=0.89) for i in range(10)], 10, {"P1": "FAIL", "C2": "PASS"})
check("P1 tie", [row(i, r2=0.90) for i in range(10)], 10, {"P1": "FAIL"})
check("C2 one low", base[:9] + [row(9, r2=0.79)], 10, {"C2": "FAIL", "P1": "PASS"})
check("P2 cross", base[:9] + [row(9, f0=0.019, f2=0.021)], 10, {"P2": "FAIL", "G2": "FAIL"})
check("P2 above already", base[:9] + [row(9, f0=0.022, f2=0.021)], 10, {"P2": "PASS", "G2": "FAIL"})
check("P2 aE2 missing", base[:9] + [row(9, aE2_fdp="NA", aE2_t="NA", aE2_e="NA", aE2_rc="1")], 10, {"P2": "FAIL"})
check("P3 one slow", base[:9] + [row(9, s2=0.99)], 10, {"P3": "FAIL", "G1": "PASS"})
check("P3 equal 1", base[:9] + [row(9, s2=1.0)], 10, {"P3": "FAIL"})
check("P3 missing", base[:9] + [row(9, speedup_2="NA")], 10, {"P3": "FAIL", "G1": "PASS"})
few = [row(i) for i in range(5)] + [row(i, b_psm="900") for i in range(5, 10)]
check("5 evaluable", few, 10, {"C1": "PASS", "C2": "INCONCLUSIVE", "P1": "INCONCLUSIVE", "P2": "INCONCLUSIVE",
                               "P3": "INCONCLUSIVE", "OVERALL": "INCONCLUSIVE"})
check("6 evaluable", [row(i) for i in range(6)] + [row(i, b_rc="1") for i in range(6, 9)], 9, {"P1": "PASS", "OVERALL": "PASS"})
print("verdict_msfcalib_test: all checks passed")
