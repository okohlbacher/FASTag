#!/usr/bin/env python3
"""compltol held-out 3: widened subset and verdict (PREREG-compltol-heldout3.md), from the frozen #2 scorer's output.

verdict_heldout3.py widened <runs root> <manifest> <out widened manifest> <truth root>
    Rows of the high-resolution sets (ft_old, timstof) whose candidate run.log reports one window in all six cells and
    that window in force is > 0.02 Da. Writes the derived manifest (name compltol-H3W) and the links
    <runs>/CFG-CT3-{base,cand}/compltol-H3W -> compltol-H3 and <truth>/compltol-H3W -> compltol-H3, so that the frozen
    scorer reads the same tags and truth under the derived manifest name.
verdict_heldout3.py verdict <score> <score_ii> <score_vi> <runs root> <manifest> <timing tsv>
    writes <score>/verdict.json and <score>/measured_windows.tsv
verdict_heldout3.py --selftest                                                    synthetic inputs, asserts

(i)   cells_i.tsv of the all-sets scorer run (Holm over the powered informative cells). FAIL: any cell 'fail'.
      PASS: no cell fails and every charge-2 and charge-3 cell of every set is 'pass'. Otherwise INCONCLUSIVE.
      A 4+ cell that is underpowered or uninformative is reported and does not block.
(ii)  'ii_cell' of the --sets ion_trap scorer run (L3_default, ion_trap, charge >= 2 pooled): point >= +1.0 and
      2.5th bootstrap percentile > 0: PASS, else FAIL.
(iii) timsTOF: the timstof cells of (i) under the rule of (i). No timstof cell: INCONCLUSIVE. Whether auto widened on
      each timsTOF file is reported (measured_windows.tsv).
(iv)  timing.tsv: median cand / median base <= 1.03 PASS. Above 1.03: INCONCLUSIVE when the base repeats spread
      (max / min) by more than 1.06, else FAIL. Any timing run with rc != 0: INCONCLUSIVE.
(v)   every cand run.log of a file reports the same 'Complement tolerance (auto)' measurement in its six cells and a
      window in force >= 0.02 Da; no base run.log has that line. PASS / FAIL.
(vi)  widening: no widened file -> NOT TESTED. Else cells_i.tsv of the scorer run on compltol-H3W under the rule of
      (i) (Holm within that family). Its per-cell differences (the gain where auto widened) are reported only.
Rule 5: any run of the all-sets runs.tsv (or of the compltol-H3W runs.tsv) not 'ok': verdict INCONCLUSIVE.
Verdict: rule 5, else FAIL if any of (i)-(vi) is FAIL, else PASS if (i)-(v) PASS and (vi) PASS or NOT TESTED, else
INCONCLUSIVE.
"""
import csv
import json
import os
import re
import statistics
import sys
from pathlib import Path

CELLS = ["L3_default", "L4_default", "L5_default", "L3_nodeiso", "L4_nodeiso", "L5_nodeiso"]
BASE, CAND = "CFG-CT3-base", "CFG-CT3-cand"
MAN, WMAN = "compltol-H3", "compltol-H3W"
HIGHRES = ("ft_old", "timstof")
LINE = re.compile(r"^Complement tolerance \(auto\): (.*?); probe (.*)$", re.M)
FLOOR_DA = 0.02


def tsv(p):
    with open(p) as f:
        return list(csv.DictReader((l for l in f if not l.startswith("# ")), delimiter="\t"))


def rule_i(cells):
    need = [c for c in cells if c["cell"].endswith((":z2", ":z3"))]
    if any(c["ni"] == "fail" for c in cells):
        return "FAIL"
    return "PASS" if need and all(c["ni"] == "pass" for c in need) else "INCONCLUSIVE"


def crit_iii(cells):
    return rule_i([c for c in cells if c["cell"].split(":")[1] == "timstof"])


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


def windows(runs, manifest):
    """One row per (file, cell): base and cand log lines, window in force; same_in_file per file."""
    out = []
    for r in manifest:
        rel = r["fastag_input"].rsplit(".", 1)[0]
        suf = "-it05" if r["ms2_analyser"] == "ion_trap" else ""
        seen, rows = set(), []
        for cell in CELLS:
            row = {"set": r["stratum"], "pxd": r["pxd"], "run": rel, "cell": cell}
            for arm in (BASE, CAND):
                p = Path(runs) / (arm + suf) / MAN / rel / cell / "run.log"
                m = LINE.search(p.read_text(errors="replace")) if p.exists() else None
                row[arm] = m.group(1) if m else "-"
                if arm == CAND:
                    row["probe"] = m.group(2) if m else "-"
            f = re.search(r"in force ([0-9.eE+-]+) Da|using -complement_tolerance ([0-9.eE+-]+) Da", row[CAND])
            row["in_force"] = (f.group(1) or f.group(2)) if f else "-"
            row["ok"] = bool(f) and float(row["in_force"]) >= FLOOR_DA and row[BASE] == "-"
            seen.add(row[CAND])
            rows.append(row)
        for row in rows:
            row["same_in_file"] = len(seen) == 1
            row["widened"] = (row["same_in_file"] and row["in_force"] != "-" and float(row["in_force"]) > FLOOR_DA)
        out += rows
    return out


def crit_v(rows):
    return "PASS" if rows and all(r["ok"] and r["same_in_file"] for r in rows) else "FAIL"


def widened(runs, man_path, out_path, truth):
    with open(man_path) as f:
        lines = f.read().splitlines()
    head = [l for l in lines if l.startswith("# ")]
    body = [l for l in lines if not l.startswith("# ")]
    cols = body[0].split("\t")
    man = [dict(zip(cols, l.split("\t"))) for l in body[1:]]
    rows = windows(runs, man)
    keep = []
    for i, r in enumerate(man):
        rr = [x for x in rows if x["run"] == r["fastag_input"].rsplit(".", 1)[0]]
        if r["stratum"] in HIGHRES and rr and all(x["widened"] for x in rr):
            keep.append(body[1 + i])
    with open(out_path, "w") as f:
        f.write("# compltol-H3W: rows of compltol-H3 (sets ft_old, timstof) whose candidate window in force was > 0.02 Da "
                "in all six cells; written by verdict_heldout3.py widened after the FASTag runs\n")
        f.write(body[0] + "\n" + "".join(l + "\n" for l in keep))
    for d in [Path(runs) / BASE, Path(runs) / CAND, Path(truth)]:
        if (d / MAN).exists() and not (d / WMAN).exists():
            os.symlink(MAN, d / WMAN)
    print(f"widened files: {len(keep)}")
    return len(keep)


def verdict(cells, res_ii, timing, rows, runs_tsv, cells_vi=None, runs_vi=()):
    v = {"i": rule_i(cells), "ii": crit_ii(res_ii), "iii": crit_iii(cells), "v": crit_v(rows)}
    v["iv"], v["iv_ratio"], v["iv_base_spread"] = timing
    v["vi"] = "NOT TESTED" if cells_vi is None else rule_i(cells_vi)
    v["runs_not_ok"] = [(r["run"], r["status"]) for r in list(runs_tsv) + list(runs_vi) if r["status"] != "ok"]
    c = [v[k] for k in ("i", "ii", "iii", "iv", "v", "vi")]
    v["verdict"] = ("INCONCLUSIVE" if v["runs_not_ok"] else "FAIL" if "FAIL" in c else
                    "PASS" if all(x == "PASS" for x in c[:5]) and v["vi"] in ("PASS", "NOT TESTED") else "INCONCLUSIVE")
    return v


def selftest():
    import tempfile

    def cell(s, n, z, ni):
        return {"cell": f"{MAN}:{s}:{n}:z{z}", "ni": ni}
    good = [cell(s, c, z, "pass") for s in ("ion_trap", "ft_old", "timstof") for c in CELLS for z in ("2", "3")]
    assert rule_i(good + [cell("timstof", "L5_default", "4+", "inconclusive")]) == "PASS"
    assert rule_i(good + [cell("ft_old", "L5_default", "4+", "uninformative")]) == "PASS"
    assert rule_i(good + [cell("ft_old", "L5_default", "4+", "fail")]) == "FAIL"
    assert rule_i(good[:-1] + [cell("timstof", "L5_nodeiso", "3", "uninformative")]) == "INCONCLUSIVE"
    assert rule_i([]) == "INCONCLUSIVE"
    assert crit_iii(good) == "PASS" and crit_iii([c for c in good if ":timstof:" not in c["cell"]]) == "INCONCLUSIVE"
    it_bad = [c if ":ion_trap:L5_default:z3" not in c["cell"] else dict(c, ni="uninformative") for c in good]
    assert rule_i(it_bad) == "INCONCLUSIVE" and crit_iii(it_bad) == "PASS"
    assert crit_iii(good + [cell("timstof", "L3_default", "4+", "fail")]) == "FAIL"

    def t(b, c, rc="0"):
        return ([{"arm": BASE, "seconds": str(x), "rc": rc} for x in b] + [{"arm": CAND, "seconds": str(x), "rc": "0"} for x in c])
    assert crit_iv(t([20, 20.2, 19.9], [20.3, 20.4, 20.1]))[0] == "PASS"
    assert crit_iv(t([20, 20.2, 19.9], [21, 21.2, 20.9]))[0] == "FAIL"
    assert crit_iv(t([20, 23, 19.9], [21, 21.2, 20.9]))[0] == "INCONCLUSIVE"
    assert crit_iv(t([20, 20.2, 19.9], [20.3, 20.4, 20.1], rc="1"))[0] == "INCONCLUSIVE"
    assert crit_iv([])[0] == "INCONCLUSIVE"

    a = "measured 0.22422414115406886 Da, in force 0.22422414115406886 Da"
    b = "measured 0.0139 Da, in force 0.02 Da (not below -complement_tolerance)"
    w = "measured 0.0311 Da, in force 0.0311 Da"
    n = "not measured, using -complement_tolerance 0.02 Da"
    with tempfile.TemporaryDirectory() as d:
        runs, truth = Path(d) / "runs", Path(d) / "truth"
        (truth / MAN).mkdir(parents=True)
        man = [{"stratum": "ion_trap", "pxd": "PXD1", "fastag_input": "compltol/H3/PXD1/a.mzML", "ms2_analyser": "ion_trap"},
               {"stratum": "ft_old", "pxd": "PXD2", "fastag_input": "compltol/H3/PXD2/b.mzML", "ms2_analyser": "orbitrap"},
               {"stratum": "timstof", "pxd": "PXD3", "fastag_input": "compltol/H3/PXD3/c.mzML", "ms2_analyser": "tof"}]
        mp = Path(d) / "m.tsv"
        mp.write_text("# x\n" + "\t".join(man[0]) + "\n" + "".join("\t".join(r.values()) + "\n" for r in man))

        def write(vals, base_line=False):
            for r, v in zip(man, vals):
                suf = "-it05" if r["ms2_analyser"] == "ion_trap" else ""
                for i, cn in enumerate(CELLS):
                    for arm in (BASE, CAND):
                        p = runs / (arm + suf) / MAN / r["fastag_input"][:-5] / cn
                        p.mkdir(parents=True, exist_ok=True)
                        x = v[i] if isinstance(v, list) else v
                        txt = "start\n"
                        if arm == CAND or base_line:
                            txt += f"Complement tolerance (auto): {x}; probe 500 MS2, 1 confident tags\n"
                        (p / "run.log").write_text(txt + "FASTAG_RC=0\n")
        write([a, b, n]); assert crit_v(windows(runs, man)) == "PASS"
        write([a, [b] * 5 + [w], n]); assert crit_v(windows(runs, man)) == "FAIL"           # two windows in one file
        write([a, "measured 0.01 Da, in force 0.01 Da", n]); assert crit_v(windows(runs, man)) == "FAIL"
        write([a, b, n], base_line=True); assert crit_v(windows(runs, man)) == "FAIL"     # base arm measured
        write([a, b, n]); assert widened(runs, mp, Path(d) / "w0.tsv", truth) == 0           # ion trap never counts
        write([a, w, n]); assert widened(runs, mp, Path(d) / "w1.tsv", truth) == 1
        assert "PXD2" in (Path(d) / "w1.tsv").read_text() and (runs / BASE / WMAN).is_symlink() and (truth / WMAN).is_symlink()
        write([a, w, w]); assert widened(runs, mp, Path(d) / "w2.tsv", truth) == 2
        write([a, [w] * 5 + [b], w]); assert widened(runs, mp, Path(d) / "w3.tsv", truth) == 1   # not one window: not widened
    ok = [{"run": "a", "status": "ok"}]
    rows = [{"ok": True, "same_in_file": True}]

    def r2(diff, p, sets=("ion_trap",), k=500):
        return {"sets": list(sets), "ii_cell": {"clusters": k, "diff": diff, "p2_5": p}}
    assert crit_ii(r2(1.0, 0.2)) == "PASS" and crit_ii(r2(0.9, 0.5)) == "FAIL" and crit_ii(r2(2.0, -0.1)) == "FAIL"
    assert crit_ii(r2(2.0, 1.0, sets=("ft_old", "ion_trap"))) == "FAIL" and crit_ii(r2(2.0, 1.0, k=0)) == "FAIL"
    T = ("PASS", 1.0, 1.0)
    assert verdict(good, r2(2.0, 1.0), T, rows, ok)["verdict"] == "PASS"
    assert verdict(good, r2(2.0, 1.0), T, rows, ok, cells_vi=[cell("ft_old", c, z, "pass") for c in CELLS for z in "23"])["verdict"] == "PASS"
    assert verdict(good, r2(2.0, 1.0), T, rows, ok, cells_vi=[cell("ft_old", "L3_default", "2", "inconclusive")])["verdict"] == "INCONCLUSIVE"
    assert verdict(good, r2(2.0, 1.0), T, rows, ok, cells_vi=[cell("ft_old", "L3_default", "2", "fail")])["verdict"] == "FAIL"
    assert verdict(good, r2(0.1, -1.0), T, rows, ok)["verdict"] == "FAIL"
    assert verdict(good, r2(2.0, 1.0), ("INCONCLUSIVE", 1.1, 1.2), rows, ok)["verdict"] == "INCONCLUSIVE"
    assert verdict(it_bad, r2(2.0, 1.0), T, rows, ok)["verdict"] == "INCONCLUSIVE"
    assert verdict(good, r2(2.0, 1.0), T, [{"ok": False, "same_in_file": True}], ok)["verdict"] == "FAIL"
    assert verdict(good, r2(2.0, 1.0), T, rows, [{"run": "a", "status": "RUN_FAILED"}])["verdict"] == "INCONCLUSIVE"
    assert verdict(good, r2(2.0, 1.0), T, rows, ok, cells_vi=[], runs_vi=[{"run": "b", "status": "NO_TRUTH"}])["verdict"] == "INCONCLUSIVE"
    print("SELFTEST OK")


def main():
    if sys.argv[1] == "--selftest":
        return selftest()
    if sys.argv[1] == "widened":
        widened(*sys.argv[2:6])
        return
    score, score_ii, score_vi, runs, man, timing = sys.argv[2:8]
    res = json.loads((Path(score) / "result.json").read_text())
    res_ii = json.loads((Path(score_ii) / "result.json").read_text())
    rows = windows(runs, tsv(man))
    cols = ["set", "pxd", "run", "cell", BASE, CAND, "probe", "in_force", "ok", "same_in_file", "widened"]
    with open(Path(score) / "measured_windows.tsv", "w") as f:
        f.write("\t".join(cols) + "\n")
        for r in rows:
            f.write("\t".join(str(r[c]) for c in cols) + "\n")
    vi = Path(score_vi) / "result.json"
    cells_vi = tsv(Path(score_vi) / "cells_i.tsv") if vi.exists() else None
    runs_vi = tsv(Path(score_vi) / "runs.tsv") if vi.exists() else []
    v = verdict(tsv(Path(score) / "cells_i.tsv"), res_ii, crit_iv(tsv(timing) if Path(timing).exists() else []), rows,
                tsv(Path(score) / "runs.tsv"), cells_vi, runs_vi)
    v["scorer_i_strict"] = res["i"]
    v["ii_cell"] = res_ii["ii_cell"]
    v["iii_4plus_first_test_reported_only"] = res.get("iii_cells")
    v["widened_files"] = sorted({(r["set"], r["pxd"]) for r in rows if r["widened"]})
    if vi.exists():
        rv = json.loads(vi.read_text())
        v["vi_sets"] = rv["sets"]
    (Path(score) / "verdict.json").write_text(json.dumps(v, indent=1, default=str) + "\n")
    print(json.dumps(v, default=str))


if __name__ == "__main__":
    main()
