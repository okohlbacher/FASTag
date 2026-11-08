#!/usr/bin/env python3
"""#3 held-out scorer (PREREG-chem.md, section 'Held-out scoring protocol'): CFG-03-cand against the manifest
truth columns (enzyme_truth, alk_truth, label_truth of item03-heldout), CFG-03-base and the majority / always-CAM
baselines alongside. The protease endpoint is endpoint() of dev/scripts/fit_chem.py, applied unchanged.

Reports per run: <runs>/<CFG>/item03-heldout/<run dir>/termini/{digest.tsv,label.tsv} (both configs) and
<runs>/CFG-03-cand/item03-heldout/<run dir>/alkylation/alkylation.tsv. A call is the report's call.class (protease),
label_call.label (label) or alkylation_call.reagent (alkylation) when its status is 'call', else no call.
Pieces (each passes or fails on its own; PLAN-organism-chemistry #3):
  protease (3c-3f): runs of the strata tryptic, nontryptic:Lys-C, :Chymotrypsin, :Glu-C, :Asp-N, :unspecific and
    alkylation_noncam whose enzyme_truth is one of Trypsin, Lys-C, Chymotrypsin, Glu-C, Asp-N, unspecific (the
    ddapasef stratum goes to the timsTOF piece; Arg-C and LysargiNase are descriptive only: < 15 runs or < 3 PXDs).
    endpoint(): balanced accuracy over Trypsin, Lys-C and the pooled non-tryptic classes (no call = wrong)
    >= 0.75; called accuracy >= 0.95 with Wilson lower bound >= 0.90; accuracy with no call wrong >= the majority
    baseline (share of the most frequent truth class among the same runs).
  timsTOF: the ddapasef stratum, truth Trypsin: called accuracy >= 0.90 on >= 10 scored runs; with fewer than 10
    scored runs the piece is WITHHELD (the timsTOF call stays withheld), not failed.
  alkylation (3g): runs with alk_truth Carbamidomethyl, Propionamide, Methylthio or none and an alkylation report;
    accuracy (no call wrong) >= always-CAM; called accuracy >= 0.97; 'none' recall >= 0.70. A run whose organism has
    no panel FASTA has no alkylation run (NOT_EVALUABLE, listed).
  label (3a): runs with label_truth label-free, TMT, TMTpro, iTRAQ4, iTRAQ8 or SILAC (TMTpro and iTRAQ8 one class,
    as dev/scripts/label_parity.py); accuracy (no call wrong) >= majority baseline + 0.05.
Usage: score_item03.py <acceptance dir> <runs root> <out dir> [--base CFG-03-base --cand CFG-03-cand]
       [--manifest-tsv <tsv> --run-col <col>]  (DEV tests: a run table with the truth columns)"""
import argparse
import collections
import json
import sys
from pathlib import Path

import acclib as A

sys.path.insert(0, str(A.HERE.parent / "dev/scripts"))
import chemport as CP  # noqa: E402
from fit_chem import CLASSES, endpoint  # noqa: E402

MANIFEST = "item03-heldout"
PROT_STRATA = {"tryptic", "nontryptic:Lys-C", "nontryptic:Chymotrypsin", "nontryptic:Glu-C", "nontryptic:Asp-N",
               "nontryptic:unspecific", "alkylation_noncam"}
GATING = {"Trypsin", "Lys-C", "Chymotrypsin", "Glu-C", "Asp-N", "unspecific"}
DESCRIPTIVE = {"Arg-C", "LysargiNase"}
ALK = {"Carbamidomethyl", "Propionamide", "Methylthio", "none"}
LAB = {"label-free", "TMT", "TMTpro", "iTRAQ4", "iTRAQ8", "SILAC"}


def lab_class(x):
    return {"TMTpro": "TMTpro/iTRAQ8", "iTRAQ8": "TMTpro/iTRAQ8"}.get(x, x)


def call_of(path, section, key):
    if not Path(path).exists():
        return "NO_REPORT"
    rep = CP.read_report(path)
    return CP.val(rep, section, key) if CP.val(rep, section, "status") == "call" else None


def protease_piece(rows, cfg):
    ev = [(CLASSES[r["truth"]], r[cfg]) for r in rows if r[cfg] != "NO_REPORT"]
    e = endpoint(ev)
    maj = collections.Counter(t for t, _ in ev).most_common(1)
    e["majority_baseline"] = maj[0][1] / len(ev) if ev else float("nan")
    lb = e["called_accuracy_wilson"][0]
    e["criteria"] = {"balanced_accuracy>=0.75": e["balanced_accuracy"] >= 0.75,
                     "called_accuracy>=0.95_LB>=0.90": e["called_accuracy"] >= 0.95 and lb >= 0.90,
                     "nocall_wrong>=majority": e["accuracy_nocall_wrong"] >= e["majority_baseline"]}
    e["piece"] = "PASS" if ev and all(e["criteria"].values()) else "FAIL"
    return e


def main():
    ap = argparse.ArgumentParser()
    for a in ("acc", "runs", "out"):
        ap.add_argument(a)
    ap.add_argument("--base", default="CFG-03-base")
    ap.add_argument("--cand", default="CFG-03-cand")
    ap.add_argument("--manifest-tsv")
    ap.add_argument("--run-col")
    ap.add_argument("--manifest", default=MANIFEST)
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    mt = a.manifest_tsv or Path(a.acc) / "manifests" / f"{a.manifest}.tsv"
    runs = []
    for r in A.read_tsv(mt):
        rel = r[a.run_col] if a.run_col else A.run_rel(r["fastag_input"]) if r.get("fastag_input_sha256") else None
        x = {"run": rel or f"{r['pxd']}:{r.get('run', '')}", "pxd": r["pxd"], "stratum": r["stratum"],
             "truth": r["enzyme_truth"], "alk_truth": r["alk_truth"], "label_truth": r["label_truth"]}
        if rel is None:
            x["status"] = "NOT_STAGED"
            runs.append(x)
            continue
        for cfg in (a.base, a.cand):
            d = Path(a.runs) / cfg / a.manifest / rel / "termini"
            x[cfg] = call_of(d / "digest.tsv", "call", "class")
            x[cfg + ":label"] = call_of(d / "label.tsv", "label_call", "label")
        x["alk"] = call_of(Path(a.runs) / a.cand / a.manifest / rel / "alkylation" / "alkylation.tsv",
                           "alkylation_call", "reagent")
        x["status"] = "ok"
        runs.append(x)
    ok = [x for x in runs if x["status"] == "ok"]
    res = {"manifest": a.manifest, "provenance": A.provenance(), "not_staged": [x["run"] for x in runs if x["status"] != "ok"]}
    prot = [x for x in ok if x["stratum"] in PROT_STRATA and x["truth"] in GATING]
    res["protease"] = {c: protease_piece(prot, c) for c in (a.base, a.cand)}
    desc = [x for x in ok if x["truth"] in DESCRIPTIVE]
    res["protease_descriptive"] = {c: dict(collections.Counter(f"{x['truth']}->{x[c]}" for x in desc))
                                   for c in (a.base, a.cand)}
    tims = [x for x in ok if x["stratum"] == "ddapasef" and x["truth"] == "Trypsin" and x[a.cand] != "NO_REPORT"]
    called = [x for x in tims if x[a.cand] is not None]
    k = sum(1 for x in called if x[a.cand] == "Trypsin")
    res["timstof"] = {"scored": len(tims), "called": len(called), "called_correct": k,
                      "called_accuracy": k / len(called) if called else float("nan"),
                      "piece": ("WITHHELD (fewer than 10 scored runs)" if len(tims) < 10 else
                                "PASS" if called and k / len(called) >= 0.90 else "FAIL")}
    alk = [x for x in ok if x["alk_truth"] in ALK]
    ne = [x["run"] for x in alk if x["alk"] == "NO_REPORT"]
    alk = [x for x in alk if x["alk"] != "NO_REPORT"]
    n = len(alk)
    corr = sum(1 for x in alk if x["alk"] == x["alk_truth"])
    cal = [x for x in alk if x["alk"] is not None]
    kc = sum(1 for x in cal if x["alk"] == x["alk_truth"])
    none = [x for x in alk if x["alk_truth"] == "none"]
    kn = sum(1 for x in none if x["alk"] == "none")
    cam = sum(1 for x in alk if x["alk_truth"] == "Carbamidomethyl")
    al = {"evaluable": n, "not_evaluable": ne, "accuracy_nocall_wrong": corr / n if n else float("nan"),
          "always_cam": cam / n if n else float("nan"), "called": len(cal),
          "called_accuracy": kc / len(cal) if cal else float("nan"), "called_wilson": A.wilson(kc, len(cal)),
          "none_runs": len(none), "none_recall": kn / len(none) if none else float("nan")}
    al["piece"] = ("PASS" if n and al["accuracy_nocall_wrong"] >= al["always_cam"] and al["called_accuracy"] >= 0.97
                   and al["none_recall"] >= 0.70 else "FAIL")
    res["alkylation"] = al
    lab = [(lab_class(x["label_truth"]), lab_class(x[a.cand + ":label"]) if x[a.cand + ":label"] else None)
           for x in ok if x["label_truth"] in LAB and x[a.cand + ":label"] != "NO_REPORT"]
    maj = collections.Counter(t for t, _ in lab).most_common(1)
    lacc = sum(1 for t, c in lab if t == c) / len(lab) if lab else float("nan")
    res["label"] = {"evaluable": len(lab), "accuracy_nocall_wrong": lacc,
                    "majority": maj[0][0] if maj else None, "majority_baseline": maj[0][1] / len(lab) if lab else float("nan")}
    res["label"]["piece"] = "PASS" if lab and lacc >= res["label"]["majority_baseline"] + 0.05 else "FAIL"
    A.write_rows(out / "runs.tsv", runs, sorted({k for x in runs for k in x}))
    (out / "result.json").write_text(json.dumps(res, indent=1, default=str) + "\n")
    print(json.dumps({"protease": {c: (round(e["balanced_accuracy"], 4), e["called"], e["n"],
                                       round(e["called_accuracy"], 4), e["piece"]) for c, e in res["protease"].items()},
                      "timstof": res["timstof"]["piece"], "alkylation": {k: al[k] for k in ("evaluable", "accuracy_nocall_wrong", "always_cam", "called_accuracy", "none_recall", "piece")},
                      "label": res["label"]}, default=str))


if __name__ == "__main__":
    main()
