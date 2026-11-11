#!/usr/bin/env python3
"""Verdict script of PREREG-labeldisc4.md (label discovery, held-out test 4).
  verdict_labeldisc4.py <arm1 score dir> <arm2 score dir> <arm2 runs root> <out.md>     |     verdict_labeldisc4.py --selftest
Score dirs are outputs of score_labeldisc3.py (summary.json, per_run.tsv) on the same audited manifest.
Arm 1 (main rule with A and B): criteria S1, A1, A2, R, F of test 3 with the minimum numbers of the PREREG.
Arm 2 (arm 1 plus PR #66): P-S1 and P-S2 decide the merge; P-E1 and P-I1 are reported.
A criterion is FAIL when its threshold is missed, else INCONCLUSIVE when a minimum number is not reached, else PASS.
Overall: FAIL if any criterion is FAIL, else INCONCLUSIVE if any is INCONCLUSIVE, else PASS."""
import csv, json, sys, os
MIN_LF, MIN_LF_IT, MIN_LAB, MIN_FAM, MIN_PRO_MS3, MIN_S2, MIN_E1, SHARE_E1 = 30, 10, 40, 10, 5, 5, 8, 0.4
def overall(vs): return "FAIL" if "FAIL" in vs else "INCONCLUSIVE" if "INCONCLUSIVE" in vs else "PASS"
def v3(ok, enough): return "FAIL" if not ok else "PASS" if enough else "INCONCLUSIVE"
def arm1(S, per):
    lf_it = sum(p["truth"] == "label-free" and p["ms2_analyzer"] == "IT" for p in per)
    pro3 = sum(p["truth"] == "TMTpro" and p["acquisition"] == "MS3" for p in per)
    v = {}
    v["S1"] = (v3(S["S1"]["wrong_calls"] == 0, S["S1"]["label_free_runs"] >= MIN_LF and lf_it >= MIN_LF_IT),
               f"{S['S1']['wrong_calls']} wrong calls on {S['S1']['label_free_runs']} label-free runs ({lf_it} with ion-trap MS2)")
    v["A1"] = (v3(S["A1"]["weighted"] > 0.80, True), f"weighted accuracy {S['A1']['weighted']} (label-free {S['A1']['accuracy_label_free']}, labelled {S['A1']['accuracy_labelled']})")
    a2 = S["A2"]
    v["A2"] = ("INCONCLUSIVE", "no Param-Medic table") if a2.get("pass") is None else \
        (v3(a2["pass"], True), f"family-correct FASTag {a2['fastag_family_correct']} against Param-Medic {a2['param_medic_family_correct_generous']} of {S['n']}")
    for k, r in S["R"].items():
        if k == "pass": continue
        enough = r["n"] >= MIN_FAM and (k != "TMTpro" or pro3 >= MIN_PRO_MS3)
        ok = r["n"] == 0 or r["recall"] >= r["threshold"]
        v["R " + k] = (v3(ok, enough), f"{r['correct']} of {r['n']} (threshold {r['threshold']}; no call {r['no_call']}, wrong {r['wrong']})" + (f"; {pro3} with MS3" if k == "TMTpro" else ""))
    f = S["F"]
    v["F"] = (v3(f["labelled_runs"] == 0 or f["rate"] <= 0.05, f["labelled_runs"] >= MIN_LAB), f"{f['called_label_free']} of {f['labelled_runs']} labelled runs called label-free")
    v["arm 1 overall"] = (overall([x[0] for x in v.values()]), "")
    return v
def arm2(a, b, rec):
    """a, b: id -> per_run row of arm 1 and arm 2; rec: id -> region_recorded of arm 2."""
    bad = ("run_failed", "run_missing")
    failed = sorted(i for i in a if i not in b or a[i]["reason"] in bad or b[i]["reason"] in bad)
    ids = [i for i in a if i not in failed]
    new_wrong = [i for i in ids if b[i]["outcome"] == "wrong" and a[i]["outcome"] != "wrong"]
    nr = [i for i in ids if b[i]["truth"] != "label-free" and rec.get(i) == "no"]
    nr_lf = [i for i in nr if b[i]["call"] == "label-free"]
    lf0 = [i for i in ids if a[i]["truth"] == "label-free" and a[i]["outcome"] == "no_call"]
    fixed = [i for i in lf0 if b[i]["outcome"] == "correct"]
    called = [i for i in ids if a[i]["call"] != "no call"]; changed = [i for i in called if a[i]["call"] != b[i]["call"]]
    v = {}
    v["P-S1"] = (v3(not new_wrong, True), f"{len(new_wrong)} runs wrong with arm 2 and not with arm 1, of {len(ids)}: {' '.join(new_wrong)}")
    v["P-S2"] = (v3(not nr_lf, len(nr) >= MIN_S2), f"{len(nr_lf)} of {len(nr)} labelled runs with region_recorded = no called label-free "
                 f"({sum(a[i]['call'] == 'label-free' for i in nr_lf)} of them also with arm 1): {' '.join(nr_lf)}")
    v["PR #66 verdict (P-S1, P-S2)"] = (overall([v["P-S1"][0], v["P-S2"][0]]), "")
    v["P-E1 (reported)"] = ("INCONCLUSIVE" if len(lf0) < MIN_E1 else "PASS" if len(fixed) >= SHARE_E1 * len(lf0) else "FAIL",
                            f"{len(fixed)} of {len(lf0)} label-free runs without an arm-1 call are called label-free")
    v["P-I1 (reported)"] = (v3(not changed, True), f"{len(changed)} of {len(called)} runs with an arm-1 call change class: {' '.join(changed)}")
    return v, failed
def load(d): return {r["id"]: r for r in csv.DictReader(open(d + "/per_run.tsv"), delimiter="\t")}
def region(runs, ids):
    rec = {}
    for i in ids:
        try:
            for l in open(f"{runs}/{i}/ld.tsv"):
                c = l.rstrip("\n").split("\t")
                if c[:2] == ["ld_reporter", "region_recorded"]: rec[i] = c[2]
        except OSError: pass
    return rec
def selftest():
    def row(t, call, ms2="FT", acq="MS2", reason="-"):
        return dict(truth=t, call=call, outcome="correct" if call == t else "no_call" if call == "no call" else "wrong", ms2_analyzer=ms2, acquisition=acq, reason=reason)
    R = lambda n, c, th: dict(n=n, correct=c, no_call=n - c, wrong=0, recall=c / n if n else None, threshold=th)
    S = dict(n=120, S1=dict(wrong_calls=0, label_free_runs=40), A1=dict(weighted=0.95, accuracy_label_free=1, accuracy_labelled=0.8),
             A2={"pass": True, "fastag_family_correct": 100, "param_medic_family_correct_generous": 60},
             R={"TMT": R(15, 15, 0.8), "TMTpro": R(15, 14, 0.8), "iTRAQ4+iTRAQ8": R(12, 12, 0.8), "SILAC": R(15, 10, 0.6), "dimethyl": R(15, 9, 0.5), "pass": True},
             F=dict(labelled_runs=80, called_label_free=1, rate=0.0125))
    per = [row("label-free", "label-free", "IT")] * 12 + [row("TMTpro", "TMTpro", acq="MS3")] * 6
    assert arm1(S, per)["arm 1 overall"][0] == "PASS"
    assert arm1(S, per[:5] + per[12:])["S1"][0] == "INCONCLUSIVE" and arm1(S, per[:13])["R TMTpro"][0] == "INCONCLUSIVE"
    S2 = json.loads(json.dumps(S)); S2["R"]["dimethyl"] = R(8, 2, 0.5); S2["R"]["SILAC"] = R(8, 8, 0.6); S2["F"]["rate"] = 0.06
    v = arm1(S2, per); assert v["R dimethyl"][0] == "FAIL" and v["R SILAC"][0] == "INCONCLUSIVE" and v["F"][0] == "FAIL" and v["arm 1 overall"][0] == "FAIL"
    S2 = json.loads(json.dumps(S)); S2["S1"]["wrong_calls"] = 1; assert arm1(S2, per)["S1"][0] == "FAIL"
    a = {f"l{i}": row("label-free", "no call") for i in range(10)}; a["s"] = row("SILAC", "SILAC"); a["d"] = row("dimethyl", "no call")
    for i in range(5): a[f"x{i}"] = row("SILAC", "no call")
    b = {k: dict(r) for k, r in a.items()}
    for i in range(5): b[f"l{i}"] = row("label-free", "label-free")
    rec = {f"x{i}": "no" for i in range(5)}
    v, f = arm2(a, b, rec); assert [v[k][0] for k in v] == ["PASS", "PASS", "PASS", "PASS", "PASS"] and not f, v
    v, _ = arm2(a, b, {"x0": "no"}); assert v["P-S2"][0] == "INCONCLUSIVE" and v["PR #66 verdict (P-S1, P-S2)"][0] == "INCONCLUSIVE"
    b["d"] = row("dimethyl", "label-free"); rec["d"] = "no"; v, _ = arm2(a, b, rec)
    assert v["P-S1"][0] == "FAIL" and v["P-S2"][0] == "FAIL" and v["PR #66 verdict (P-S1, P-S2)"][0] == "FAIL"
    a["d"] = row("dimethyl", "label-free"); v, _ = arm2(a, b, rec); assert v["P-S1"][0] == "PASS" and v["P-S2"][0] == "FAIL" and "(1 of them also with arm 1)" in v["P-S2"][1]
    b["d"] = dict(a["d"], reason="run_failed"); v, f = arm2(a, b, rec); assert f == ["d"] and v["P-S2"][0] == "PASS"
    b["s"] = row("SILAC", "no call"); v, _ = arm2(a, b, rec); assert v["P-I1 (reported)"][0] == "FAIL" and v["P-S1"][0] == "PASS"
    b = {k: dict(r) for k, r in a.items()}; b["l0"] = row("label-free", "label-free"); v, _ = arm2(a, b, rec); assert v["P-E1 (reported)"][0] == "FAIL"
    print("selftest ok")
if __name__ == "__main__":
    if sys.argv[1] == "--selftest": selftest(); sys.exit()
    d1, d2, runs2, out = sys.argv[1:5]
    a, b = load(d1), load(d2)
    v = arm1(json.load(open(d1 + "/summary.json")), list(a.values()))
    w, failed = arm2(a, b, region(runs2, b))
    with open(out, "w") as o:
        o.write("| criterion | verdict | numbers |\n|---|---|---|\n")
        for k, (x, n) in list(v.items()) + list(w.items()): o.write(f"| {k} | {x} | {n} |\n")
        o.write(f"\nRuns: {len(a)}; technical failures (counted as no call in arm 1, left out of the arm-2 criteria): {len(failed)} {' '.join(failed)}\n")
    print(open(out).read())
