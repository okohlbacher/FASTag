#!/usr/bin/env python3
"""compltol held-out 2: the verdict (PREREG-compltol-heldout2.md), from the output of the frozen #2 scorer.

verdict_heldout2.py <score dir> <score_ii dir> <runs root> <manifest tsv> <timing tsv>
                                                        writes <score dir>/verdict.json, measured_windows.tsv
<score dir>: score_item02.py over all sets; <score_ii dir>: score_item02.py --sets ion_trap.
verdict_heldout2.py --selftest                                              synthetic inputs, asserts

(i)   cells_i.tsv of score_item02.py (Holm over the powered informative cells, as the first test).
      FAIL: any cell 'fail'. PASS: no cell fails and every charge-2 and charge-3 cell of every set is 'pass'.
      Otherwise INCONCLUSIVE. A 4+ cell that is underpowered or uninformative is reported and does not block.
(ii)  'ii_cell' of the --sets ion_trap scorer run (L3_default, ion_trap set, charge >= 2, pooled):
      point >= +1.0 and 2.5th bootstrap percentile > 0: PASS, else FAIL. The all-sets pooled value is reported only.
(iii) timsTOF: NOT TESTED (no timsTOF run in this test).
(iv)  timing.tsv: median cand / median base <= 1.03 PASS. Above 1.03: INCONCLUSIVE when the base repeats spread
      (max / min) by more than 1.06 (shared node), else FAIL. Any timing run with rc != 0: INCONCLUSIVE.
(v)   every cand run.log of a file reports the same 'Complement tolerance (auto)' measurement in its six cells and a
      window in force >= 0.02 Da; no base run.log has that line. PASS / FAIL.
Rule 5: any run of the scorer's runs.tsv not 'ok' (FASTAG_RC != 0, missing, no truth): verdict INCONCLUSIVE.
Verdict: rule 5, else FAIL if any of (i), (ii), (iv), (v) is FAIL, else PASS if all four PASS, else INCONCLUSIVE.
"""
import csv
import json
import re
import statistics
import sys
from pathlib import Path

CELLS = ["L3_default", "L4_default", "L5_default", "L3_nodeiso", "L4_nodeiso", "L5_nodeiso"]
BASE, CAND = "CFG-CT2-base", "CFG-CT2-cand"
LINE = re.compile(r"^Complement tolerance \(auto\): (.*?); probe (.*)$", re.M)


def tsv(p):
    with open(p) as f:
        return list(csv.DictReader((l for l in f if not l.startswith("# ")), delimiter="\t"))


def crit_i(cells):
    need = [c for c in cells if c["cell"].endswith((":z2", ":z3"))]
    if any(c["ni"] == "fail" for c in cells):
        return "FAIL"
    return "PASS" if need and all(c["ni"] == "pass" for c in need) else "INCONCLUSIVE"


def crit_ii(res):
    c = res["ii_cell"]
    return "PASS" if res["sets"] == ["ion_trap"] and c["clusters"] and c["diff"] >= 1.0 and c["p2_5"] > 0 else "FAIL"


def crit_iv(rows):
    if not rows or any(r["rc"] != "0" for r in rows):
        return "INCONCLUSIVE", float("nan"), float("nan")
    b = [float(r["seconds"]) for r in rows if r["arm"] == BASE]
    c = [float(r["seconds"]) for r in rows if r["arm"] == CAND]
    if not b or not c:
        return "INCONCLUSIVE", float("nan"), float("nan")
    ratio, spread = statistics.median(c) / statistics.median(b), max(b) / min(b)
    return ("PASS" if ratio <= 1.03 else "INCONCLUSIVE" if spread > 1.06 else "FAIL"), ratio, spread


def crit_v(runs, manifest):
    out, ok = [], True
    for r in manifest:
        rel = r["fastag_input"].rsplit(".", 1)[0]
        suf = "-it05" if r["ms2_analyser"] == "ion_trap" else ""
        seen = set()
        for cell in CELLS:
            row = {"pxd": r["pxd"], "run": rel, "cell": cell}
            for arm in (BASE, CAND):
                p = Path(runs) / (arm + suf) / "compltol-H2" / rel / cell / "run.log"
                m = LINE.search(p.read_text(errors="replace")) if p.exists() else None
                row[arm] = m.group(1) if m else "-"
                if arm == CAND:
                    row["probe"] = m.group(2) if m else "-"
            f = re.search(r"in force ([0-9.eE+-]+) Da|using -complement_tolerance ([0-9.eE+-]+) Da", row[CAND])
            row["in_force"] = (f.group(1) or f.group(2)) if f else "-"
            row["ok"] = bool(f) and float(row["in_force"]) >= 0.02 and row[BASE] == "-"
            seen.add(row[CAND])
            out.append(row)
        same = len(seen) == 1
        for row in out[-len(CELLS):]:
            row["same_in_file"] = same
            ok = ok and same and row["ok"]
    return ("PASS" if out and ok else "FAIL"), out


def verdict(res_ii, cells, timing, win, runs_tsv):
    v = {"i": crit_i(cells), "ii": crit_ii(res_ii), "iii": "NOT TESTED", "v": win}
    v["iv"], v["iv_ratio"], v["iv_base_spread"] = timing
    v["runs_not_ok"] = [(r["run"], r["status"]) for r in runs_tsv if r["status"] != "ok"]
    c = [v["i"], v["ii"], v["iv"], v["v"]]
    v["verdict"] = ("INCONCLUSIVE" if v["runs_not_ok"] else "FAIL" if "FAIL" in c else
                    "PASS" if all(x == "PASS" for x in c) else "INCONCLUSIVE")
    return v


def selftest():
    def cell(n, ni):
        return {"cell": n, "ni": ni}
    good = [cell(f"m:{s}:{c}:z{z}", "pass") for s in ("astral", "qe") for c in CELLS for z in ("2", "3")]
    assert crit_i(good + [cell("m:qe:L5_default:z4+", "inconclusive")]) == "PASS"
    assert crit_i(good + [cell("m:qe:L5_default:z4+", "uninformative")]) == "PASS"
    assert crit_i(good + [cell("m:qe:L5_default:z4+", "fail")]) == "FAIL"
    assert crit_i(good + [cell("m:astral:L5_default:z3", "inconclusive")]) == "INCONCLUSIVE"
    assert crit_i(good + [cell("m:astral:L5_default:z2", "uninformative")]) == "INCONCLUSIVE"
    assert crit_i([]) == "INCONCLUSIVE"

    def t(b, c, rc="0"):
        return ([{"arm": BASE, "seconds": str(x), "rc": rc} for x in b] +
                [{"arm": CAND, "seconds": str(x), "rc": "0"} for x in c])
    assert crit_iv(t([20, 20.2, 19.9], [20.3, 20.4, 20.1]))[0] == "PASS"
    assert crit_iv(t([20, 20.2, 19.9], [21, 21.2, 20.9]))[0] == "FAIL"
    assert crit_iv(t([20, 23, 19.9], [21, 21.2, 20.9]))[0] == "INCONCLUSIVE"
    assert crit_iv(t([20, 20.2, 19.9], [20.3, 20.4, 20.1], rc="1"))[0] == "INCONCLUSIVE"
    assert crit_iv([])[0] == "INCONCLUSIVE"

    import tempfile
    with tempfile.TemporaryDirectory() as d:
        man = [{"pxd": "PXD1", "fastag_input": "compltol/H2/PXD1/a.mzML", "ms2_analyser": "ion_trap"},
               {"pxd": "PXD2", "fastag_input": "compltol/H2/PXD2/b.mzML", "ms2_analyser": "orbitrap"}]

        def write(vals, base_line=False):
            for r, suf, v in ((man[0], "-it05", vals[0]), (man[1], "", vals[1])):
                for i, cellname in enumerate(CELLS):
                    for arm in (BASE, CAND):
                        p = Path(d) / (arm + suf) / "compltol-H2" / r["fastag_input"][:-5] / cellname
                        p.mkdir(parents=True, exist_ok=True)
                        x = v[i] if isinstance(v, list) else v
                        txt = "start\n"
                        if arm == CAND or base_line:
                            txt += f"Complement tolerance (auto): {x}; probe 500 MS2, 1 confident tags\n"
                        (p / "run.log").write_text(txt + "FASTAG_RC=0\n")
        a = "measured 0.22422414115406886 Da, in force 0.22422414115406886 Da"
        b = "measured 0.0139 Da, in force 0.02 Da (not below -complement_tolerance)"
        n = "not measured, using -complement_tolerance 0.02 Da"
        write([a, b]); assert crit_v(d, man)[0] == "PASS"
        write([a, n]); assert crit_v(d, man)[0] == "PASS"
        write([a, [b] * 5 + [a]]); assert crit_v(d, man)[0] == "FAIL"                    # two windows in one file
        write([a, "measured 0.01 Da, in force 0.01 Da"]); assert crit_v(d, man)[0] == "FAIL"   # below the floor
        write([a, b], base_line=True); assert crit_v(d, man)[0] == "FAIL"                # base arm measured
    ok = [{"run": "a", "status": "ok"}]

    def r2(diff, p, sets=("ion_trap",), n=500):
        return {"sets": list(sets), "ii_cell": {"clusters": n, "diff": diff, "p2_5": p}}
    assert crit_ii(r2(1.0, 0.2)) == "PASS" and crit_ii(r2(0.9, 0.5)) == "FAIL" and crit_ii(r2(2.0, -0.1)) == "FAIL"
    assert crit_ii(r2(2.0, 1.0, sets=("astral", "ion_trap"))) == "FAIL" and crit_ii(r2(2.0, 1.0, n=0)) == "FAIL"
    assert verdict(r2(2.0, 1.0), good, ("PASS", 1.0, 1.0), "PASS", ok)["verdict"] == "PASS"
    assert verdict(r2(0.1, -1.0), good, ("PASS", 1.0, 1.0), "PASS", ok)["verdict"] == "FAIL"
    assert verdict(r2(2.0, 1.0), good, ("INCONCLUSIVE", 1.1, 1.2), "PASS", ok)["verdict"] == "INCONCLUSIVE"
    assert verdict(r2(2.0, 1.0), good[:-1] + [cell("m:qe:L5_nodeiso:z3", "fail")], ("PASS", 1.0, 1.0), "PASS",
                   ok)["verdict"] == "FAIL"
    assert verdict(r2(0.1, -1.0), good, ("PASS", 1.0, 1.0), "PASS",
                   [{"run": "a", "status": "RUN_FAILED"}])["verdict"] == "INCONCLUSIVE"
    assert verdict(r2(2.0, 1.0), good, ("PASS", 1.0, 1.0), "FAIL", ok)["verdict"] == "FAIL"
    print("SELFTEST OK")


def main():
    if sys.argv[1] == "--selftest":
        return selftest()
    score, score_ii, runs, man, timing = sys.argv[1:6]
    res = json.loads((Path(score) / "result.json").read_text())
    res_ii = json.loads((Path(score_ii) / "result.json").read_text())
    win, rows = crit_v(runs, tsv(man))
    cols = ["pxd", "run", "cell", BASE, CAND, "probe", "in_force", "ok", "same_in_file"]
    with open(Path(score) / "measured_windows.tsv", "w") as f:
        f.write("\t".join(cols) + "\n")
        for r in rows:
            f.write("\t".join(str(r[c]) for c in cols) + "\n")
    v = verdict(res_ii, tsv(Path(score) / "cells_i.tsv"), crit_iv(tsv(timing) if Path(timing).exists() else []), win,
                tsv(Path(score) / "runs.tsv"))
    v["scorer_i_strict"] = res["i"]
    v["ii_cell"] = res_ii["ii_cell"]
    v["pooled_astral_ion_trap_reported_only"] = res["ii_cell"]
    (Path(score) / "verdict.json").write_text(json.dumps(v, indent=1, default=str) + "\n")
    print(json.dumps(v, default=str))


if __name__ == "__main__":
    main()
