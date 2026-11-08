#!/usr/bin/env python3
"""#7 release-test scorer (PREREG-item07.md): CFG-07 (RC defaults, -acquisition_check refuse) on E7-03.

Units: one FASTag run per staged input of acceptance/1.12/manifests/item07-E7-03.tsv: the conversion
(fastag_input) of every file, and the pseudo-DDA file (pseudo_input) of every DIA file that has one. Run
directory: <runs>/CFG-07/item07-E7-03/<dir>/<stem>/ (jobs/example-fastag.slurm layout, no cell level), with run.log
holding the FASTag log and the FASTAG_RC=<rc> line.
Truth (fixed before any run): the manifest class of the drawn stratum. class nonDIA (DDA, PRM, SureQuant/inclusion,
WWA strata) and every pseudo-DDA file must pass; class DIA conversions must be refused. No relabelling: a file
whose stratum label is wrong counts as drawn; the window listing of each disagreement is reported, not used.
Outcome per unit: refused = FASTAG_RC 11 and a 'FASTAG_REFUSED reason=raw_dia' line; passed = FASTAG_RC 0; any
other state (other exit code, no log) = RUN_FAILED. A file whose conversion is missing (not convertible on Linux)
is NOT_STAGED and is reported, never scored as a pass or a refusal.
Acceptance (PLAN-data-types #7 Release test):
  (a) 0 refusals among the must-pass units; the one-sided exact 95% upper bound of the false-refusal rate is
      reported (1 - 0.05^(1/n) at 0 refusals);
  (b) >= 90% refused in each DIA stratum (DIA_orbitrap, DIA_astral, DIA_diapasef, DIA_swath) with >= 5 scored
      files; a stratum with < 5 scored files is reported separately and does not gate.
  Design check (reported with the verdict, not a scoring rule): >= 150 must-pass units and >= 40 scored DIA files
  covering the four DIA strata. When it is not met, the verdict is prefixed SAMPLE_SHORTFALL.
  Any RUN_FAILED unit makes the verdict INCONCLUSIVE.
Dev mode (--dev-sweep <e7-02-sweep.tsv>): the same rules on the E7-02 development sweep's frozen calls (columns
adjudicated, call_frozen_exit, FASTAG_REFUSED_frozen); used only to test this script.
Usage: score_item07.py <out dir> --acc <acceptance dir> --runs <runs root> [--cfg CFG-07]
       score_item07.py <out dir> --dev-sweep <e7-02-sweep.tsv>"""
import argparse
import collections
import json
from pathlib import Path

import acclib as A

DIA_STRATA = ("DIA_orbitrap", "DIA_astral", "DIA_diapasef", "DIA_swath")


def outcome(run_dir: Path):
    log = run_dir / "run.log"
    if not log.exists():
        return "RUN_FAILED", "no run.log"
    rc = A.run_rc(run_dir)
    txt = log.read_text(errors="replace")
    ref = next((l for l in txt.splitlines() if l.startswith("FASTAG_REFUSED")), "")
    acq = next((l for l in txt.splitlines() if l.startswith("Acquisition check:")), "")
    if rc == 11 and "reason=raw_dia" in ref:
        return "refused", ref
    if rc == 0:
        return "passed", acq
    return "RUN_FAILED", f"FASTAG_RC={rc} {ref}"


def units_heldout(acc, runs, cfg):
    man = "item07-E7-03"
    out = []
    for r in A.read_tsv(Path(acc) / "manifests" / f"{man}.tsv"):
        base = {"id": r["id"], "stratum": r["stratum"], "class": r["class"], "pxd": r["pxd"]}
        if not r["fastag_input_sha256"]:
            out.append({**base, "unit": "conv", "must": "pass" if r["class"] == "nonDIA" else "refuse",
                        "outcome": "NOT_STAGED", "detail": r.get("convertible_here", "")})
        else:
            o, d = outcome(Path(runs) / cfg / man / A.run_rel(r["fastag_input"]))
            out.append({**base, "unit": "conv", "must": "pass" if r["class"] == "nonDIA" else "refuse",
                        "outcome": o, "detail": d})
        if r["class"] == "DIA" and r.get("pseudo_sha256"):
            o, d = outcome(Path(runs) / cfg / man / A.run_rel(r["pseudo_input"]))
            out.append({**base, "stratum": "pseudo_DDA", "unit": "pseudo", "must": "pass", "outcome": o, "detail": d})
    return out


def units_dev(sweep):
    out = []
    for r in A.read_tsv(sweep):
        adj = r["adjudicated"]
        must = "pass" if adj == "must pass" else "refuse"
        st = "nonDIA" if must == "pass" else "DIA_" + adj.split("(", 1)[1].rstrip(")")
        rc = r["call_frozen_exit"]
        o = ("refused" if rc == "11" and "reason=raw_dia" in r["FASTAG_REFUSED_frozen"] else
             "passed" if rc == "0" else "RUN_FAILED")
        out.append({"id": r["id"], "stratum": st, "class": "DIA" if must == "refuse" else "nonDIA", "pxd": r["pxd"],
                    "unit": "dev", "must": must, "outcome": o, "detail": r["FASTAG_REFUSED_frozen"] or r["call_frozen"][:80]})
    return out


def score(units, dia_strata):
    must = [u for u in units if u["must"] == "pass" and u["outcome"] in ("passed", "refused")]
    fr = [u for u in must if u["outcome"] == "refused"]
    res = {"must_pass_scored": len(must), "false_refusals": len(fr), "false_refusal_ids": [u["id"] for u in fr],
           "false_refusal_upper95": A.cp_upper(len(fr), len(must))}
    res["a"] = "PASS" if must and not fr else "FAIL"
    per, gating = {}, []
    for s in dia_strata:
        us = [u for u in units if u["stratum"] == s and u["must"] == "refuse" and u["outcome"] in ("passed", "refused")]
        k = sum(u["outcome"] == "refused" for u in us)
        per[s] = {"scored": len(us), "refused": k, "share": k / len(us) if us else float("nan"),
                  "gates": len(us) >= 5, "not_refused_ids": [u["id"] for u in us if u["outcome"] != "refused"]}
        if len(us) >= 5:
            gating.append(k / len(us) >= 0.90)
    res["per_dia_stratum"] = per
    res["b"] = "PASS" if gating and all(gating) else "FAIL"
    dia_scored = sum(p["scored"] for p in per.values())
    res["design"] = {"must_pass_units": len(must), "dia_scored": dia_scored,
                     "dia_strata_gating": [s for s, p in per.items() if p["gates"]],
                     "met": len(must) >= 150 and dia_scored >= 40 and all(p["gates"] for p in per.values())}
    res["not_staged"] = [u["id"] for u in units if u["outcome"] == "NOT_STAGED"]
    res["run_failed"] = [u["id"] + ":" + u["unit"] for u in units if u["outcome"] == "RUN_FAILED"]
    v = "INCONCLUSIVE" if res["run_failed"] else ("PASS" if res["a"] == res["b"] == "PASS" else "FAIL")
    res["verdict"] = ("SAMPLE_SHORTFALL; " if not res["design"]["met"] else "") + v
    res["by_stratum"] = {s: dict(collections.Counter(u["outcome"] for u in units if u["stratum"] == s))
                         for s in sorted({u["stratum"] for u in units})}
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--acc")
    ap.add_argument("--runs")
    ap.add_argument("--cfg", default="CFG-07")
    ap.add_argument("--dev-sweep")
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    if a.dev_sweep:
        units = units_dev(a.dev_sweep)
        strata = sorted({u["stratum"] for u in units if u["must"] == "refuse"})
    else:
        units = units_heldout(a.acc, a.runs, a.cfg)
        strata = DIA_STRATA
    res = score(units, strata)
    res["provenance"] = A.provenance()
    A.write_rows(out / "units.tsv", units, ["id", "stratum", "class", "pxd", "unit", "must", "outcome", "detail"])
    (out / "result.json").write_text(json.dumps(res, indent=1, default=str) + "\n")
    print(json.dumps({k: res[k] for k in ("must_pass_scored", "false_refusals", "false_refusal_upper95", "a", "b",
                                          "per_dia_stratum", "design", "verdict")}, default=str))


if __name__ == "__main__":
    main()
