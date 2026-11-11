#!/usr/bin/env python3
"""Verdict script of PREREG-labeldisc-nocall.md. Paired comparison of two feat.py tables (same audited runs):
  score_nocall.py <baseline.feat.tsv> <candidate.feat.tsv> <out.md>      |      score_nocall.py --selftest
Outcome per run: right (call class = truth), no call, wrong. A run that failed with either binary (rc != 0) is
left out of all criteria and listed."""
import csv, sys, collections
N_MIN_E1, SHARE_E1, N_MIN_S2 = 8, 0.4, 5
def outcome(r): return "right" if r["ok"] == "True" else "no call" if r["cls"] == "no call" else "wrong"
def score(a, b):
    ids = [i for i in a if i in b]
    failed = [i for i in ids if a[i]["rc"] != "0" or b[i]["rc"] != "0"]
    ids = [i for i in ids if i not in failed]
    oa = {i: outcome(a[i]) for i in ids}; ob = {i: outcome(b[i]) for i in ids}
    new_wrong = [i for i in ids if ob[i] == "wrong" and oa[i] != "wrong"]
    lab_nr = [i for i in ids if b[i]["truth"] != "label-free" and b[i]["ld_reporter.region_recorded"] == "no"]
    lab_nr_lf = [i for i in lab_nr if b[i]["cls"] == "label-free"]
    lf0 = [i for i in ids if a[i]["truth"] == "label-free" and oa[i] == "no call"]
    lf0_fixed = [i for i in lf0 if ob[i] == "right"]
    called = [i for i in ids if a[i]["cls"] != "no call"]
    changed = [i for i in called if a[i]["cls"] != b[i]["cls"]]
    v = {}
    v["S1"] = ("PASS" if not new_wrong else "FAIL", f"{len(new_wrong)} new wrong calls on {len(ids)} runs")
    v["S2"] = ("FAIL" if lab_nr_lf else "PASS" if len(lab_nr) >= N_MIN_S2 else "INCONCLUSIVE",
               f"{len(lab_nr_lf)} of {len(lab_nr)} labelled runs with region_recorded = no called label-free")
    v["E1"] = ("INCONCLUSIVE" if len(lf0) < N_MIN_E1 else "PASS" if len(lf0_fixed) >= SHARE_E1 * len(lf0) else "FAIL",
               f"{len(lf0_fixed)} of {len(lf0)} label-free runs without a baseline call are called label-free")
    v["I1"] = ("PASS" if not changed else "FAIL", f"{len(changed)} of {len(called)} runs with a baseline call change class")
    vs = [x[0] for x in v.values()]
    v["overall"] = ("FAIL" if "FAIL" in vs else "INCONCLUSIVE" if "INCONCLUSIVE" in vs else "PASS", "")
    return v, dict(ids=ids, failed=failed, oa=oa, ob=ob, new_wrong=new_wrong, lab_nr_lf=lab_nr_lf, changed=changed)
def load(p): return {r["id"]: r for r in csv.DictReader(open(p), delimiter="\t")}
def selftest():
    def row(i, truth, cls, rec="yes", rc="0"): return dict(id=i, truth=truth, cls=cls, ok=str(truth == cls), rc=rc, **{"ld_reporter.region_recorded": rec})
    a = {f"l{i}": row(f"l{i}", "label-free", "no call") for i in range(10)}; a["s"] = row("s", "SILAC", "SILAC"); a["t"] = row("t", "TMT", "no call")
    b = {k: dict(r) for k, r in a.items()}
    for i in range(5): b[f"l{i}"] = row(f"l{i}", "label-free", "label-free", "no")
    v, _ = score(a, b); assert [v[k][0] for k in ("S1", "S2", "E1", "I1", "overall")] == ["PASS", "INCONCLUSIVE", "PASS", "PASS", "INCONCLUSIVE"], v
    b["t"] = row("t", "TMT", "label-free", "no"); v, _ = score(a, b); assert v["S1"][0] == "FAIL" and v["S2"][0] == "FAIL" and v["overall"][0] == "FAIL", v
    b["t"] = dict(a["t"]); b["s"] = row("s", "SILAC", "no call"); v, _ = score(a, b); assert v["I1"][0] == "FAIL", v
    b["s"] = dict(a["s"])
    for i in range(5): b[f"l{i}"] = dict(a[f"l{i}"])
    b["l0"] = row("l0", "label-free", "label-free", "no"); v, _ = score(a, b); assert v["E1"][0] == "FAIL", v
    a2 = {k: a[k] for k in ("l0", "s")}; b2 = {k: b[k] for k in ("l0", "s")}; v, _ = score(a2, b2); assert v["E1"][0] == "INCONCLUSIVE", v
    for i in range(5): b[f"x{i}"] = row(f"x{i}", "SILAC", "no call", "no"); a[f"x{i}"] = row(f"x{i}", "SILAC", "no call")
    for i in range(5): b[f"l{i}"] = row(f"l{i}", "label-free", "label-free", "no")
    v, _ = score(a, b); assert v["S2"][0] == "PASS" and v["overall"][0] == "PASS", v
    b["x0"] = row("x0", "SILAC", "no call", "no", rc="1"); v, d = score(a, b); assert d["failed"] == ["x0"] and v["S2"][0] == "INCONCLUSIVE", v
    print("selftest ok")
if __name__ == "__main__":
    if sys.argv[1] == "--selftest": selftest(); sys.exit()
    a, b = load(sys.argv[1]), load(sys.argv[2]); v, d = score(a, b)
    with open(sys.argv[3], "w") as o:
        o.write("| criterion | verdict | numbers |\n|---|---|---|\n")
        for k, (x, n) in v.items(): o.write(f"| {k} | {x} | {n} |\n")
        o.write(f"\nRuns scored: {len(d['ids'])}; failed technically and left out: {len(d['failed'])} {' '.join(d['failed'])}\n\n")
        o.write("| truth | runs | baseline right | no call | wrong | candidate right | no call | wrong |\n|---|---|---|---|---|---|---|---|\n")
        for t in sorted({a[i]["truth"] for i in d["ids"]}) + ["all"]:
            ii = [i for i in d["ids"] if t == "all" or a[i]["truth"] == t]
            ca = collections.Counter(d["oa"][i] for i in ii); cb = collections.Counter(d["ob"][i] for i in ii)
            o.write(f"| {t} | {len(ii)} | {ca['right']} | {ca['no call']} | {ca['wrong']} | {cb['right']} | {cb['no call']} | {cb['wrong']} |\n")
        o.write("\nPer run (changed outcome, or no call or wrong with the candidate):\n\n| run | truth | baseline | candidate | basis | reason | region_recorded |\n|---|---|---|---|---|---|---|\n")
        for i in d["ids"]:
            if d["oa"][i] != d["ob"][i] or a[i]["cls"] != b[i]["cls"] or d["ob"][i] != "right":
                o.write(f"| {i} | {a[i]['truth']} | {a[i]['cls']} | {b[i]['cls']} | {b[i].get('ld_call.basis')} | {b[i].get('ld_call.reason')} | {b[i].get('ld_reporter.region_recorded')} |\n")
    print(open(sys.argv[3]).read())
