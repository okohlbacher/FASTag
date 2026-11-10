#!/usr/bin/env python3
"""Synthetic tests of score_item14r.py and verdict_item14r.py: PASS, each FAIL, each INCONCLUSIVE.
Usage: test_item14r.py   (exit 0 when all hold)"""
import json
import os
import subprocess
import sys
import tempfile

H = os.path.dirname(os.path.abspath(__file__))
PY = sys.executable
HC = ("index\tnative_id\tprecursor_mz\theader_charge\tcall_charge\tcall_src\tbasis\trunner_up\theader_excess\t"
      "call_excess\theader_ruled_out\theader_peaks_above\tms1_charge\tms1_peaks\tflag_basis\tflag_charge\tverdict\t"
      "tagged_charge\n")
T = tempfile.mkdtemp()
fails = 0


def check(name, cond):
    global fails
    print("ok  " if cond else "FAIL", name)
    fails += not cond


def table(name, runs):
    """runs: (run, class, truth, wrong, flagged, tp[, status]) -> asgiven-style table"""
    p = f"{T}/{name}.tsv"
    cols = ["run", "class", "status", "truth", "wrong", "right", "flagged", "tp", "fp", "tp_charge", "decoy_other",
            "flags_ms1", "tp_ms1", "flags_compl", "tp_compl", "wrong_agree", "wrong_nocall", "wrong_ambiguous"]
    with open(p, "w") as f:
        f.write("\t".join(cols) + "\n")
        for r in runs:
            run, cls, truth, wrong, fl, tp = r[:6]
            st = r[6] if len(r) > 6 else "ok"
            v = [run, cls, st, truth, wrong, truth - wrong, fl, tp, fl - tp, tp, 0, fl, tp, 0, 0, wrong - tp, 0, 0]
            f.write("\t".join(map(str, v)) + "\n")
    return p


def verdict(p, *extra):
    return json.loads(subprocess.run([PY, "-I", f"{H}/verdict_item14r.py", p, *extra], check=True,
                                     capture_output=True, text=True).stdout)


def met(v):
    return v["verdict"], [v[h]["met"] for h in ("H0", "H1", "H2", "H3")]


base = [("A", "qe", 10000, 100, 50, 40), ("B", "qe", 8000, 100, 50, 40), ("C", "qe", 9000, 100, 50, 40),
        ("D", "astral", 3000, 60, 30, 25), ("E", "astral", 30000, 1000, 400, 300)]
# pooled: flagged 580, tp 455 (0.784, lo 0.749), sens 455/1360 = 0.335, fp 125 / 58640 = 0.0021
check("PASS", met(verdict(table("pass", base))) == ("PASS", [True, True, True, True]))
# H1: precision 0.62, lower bound below 0.60
h1 = [(r, c, t, w, w // 2, round(0.62 * (w // 2))) for r, c, t, w, _, _ in base]
v = verdict(table("h1", h1))
check("FAIL H1 only (point 0.62 >= 0.60 but lower bound < 0.60)",
      met(v) == ("FAIL", [True, False, True, True]) and v["H1"]["precision"] > 0.60 > v["H1"]["wilson95_lo"])
# H2: sensitivity 0.1
h2 = [(r, c, t, w, w // 10, w // 10) for r, c, t, w, _, _ in base]
check("FAIL H2 only", met(verdict(table("h2", h2))) == ("FAIL", [True, True, False, True]))
# H3 pooled: many false flags but precision kept high is impossible with few wrong headers, so raise both
h3 = [("A", "qe", 10000, 1000, 800, 740), ("B", "qe", 8000, 1000, 800, 745), ("C", "qe", 9000, 1000, 800, 745),
      ("D", "astral", 3000, 600, 400, 380), ("E", "astral", 30000, 3000, 2400, 2250)]
v = verdict(table("h3p", h3))
check("FAIL H3 only (pooled > 0.005, every run <= 0.010)", met(v) == ("FAIL", [True, True, True, False])
      and v["H3"]["right_flagged_pooled"] > 0.005 and v["H3"]["right_flagged_worst_run"] <= 0.010)
h3r = list(base)
h3r[3] = ("D", "astral", 3000, 600, 400, 365)   # 35 / 2400 = 0.0146 in one run; pooled stays below 0.005
v = verdict(table("h3r", h3r))
check("FAIL H3 only (one run > 0.010, pooled <= 0.005)", met(v) == ("FAIL", [True, True, True, False])
      and v["H3"]["right_flagged_pooled"] <= 0.005 and v["H3"]["right_flagged_worst_run"] > 0.010)
check("FAIL all of H1-H3", met(verdict(table("all", [(r, c, t, w, 500, 5) for r, c, t, w, _, _ in base])))
      == ("FAIL", [True, False, False, False]))
# H0
two = list(base)
two[0] = ("A", "qe", 499, 10, 5, 4)
two[1] = ("B", "qe", 300, 10, 5, 4)
v = verdict(table("inc_runs", two))
check("INCONCLUSIVE: 3 of 5 runs evaluable", v["verdict"] == "INCONCLUSIVE" and v["H0"]["runs_evaluable"] == 3)
one = list(base)
one[0] = ("A", "qe", 499, 10, 5, 4)
v = verdict(table("one_out", one))
check("4 of 5 evaluable is enough; the fifth run is not pooled",
      v["verdict"] == "PASS" and v["H0"]["runs_evaluable"] == 4 and v["pooled_evaluable"]["truth"] == 50000)
few = [(r, c, t, 39, 20, 18) for r, c, t, _, _, _ in base]
v = verdict(table("inc_wrong", few))
check("INCONCLUSIVE: 195 wrong headers", v["verdict"] == "INCONCLUSIVE" and v["H0"]["wrong_headers_pooled"] == 195)
v = verdict(table("pass", base), "--failed", "A,B")
check("INCONCLUSIVE: two technical failures", v["verdict"] == "INCONCLUSIVE" and v["H0"]["runs_evaluable"] == 3)
v = verdict(table("pass", base), "--failed", "A")
check("one technical failure: 4 evaluable, verdict from the rest", v["verdict"] == "PASS"
      and v["runs"][0]["not_evaluable_because"] == "technical failure")
miss = list(base)
miss[4] = ("E", "astral", 0, 0, 0, 0, "missing")
miss[3] = ("D", "astral", 0, 0, 0, 0, "missing")
check("INCONCLUSIVE: tables missing", verdict(table("miss", miss))["verdict"] == "INCONCLUSIVE")
check("INCONCLUSIVE: a run row absent", verdict(table("four", base[:4]))["verdict"] == "INCONCLUSIVE")
noflag = [(r, c, t, w, 0, 0) for r, c, t, w, _, _ in base]
check("no flag at all: FAIL H1 and H2, H3 met", met(verdict(table("noflag", noflag))) == ("FAIL", [True, False, False, True]))
# boundary values
b = [("A", "qe", 20000, 100, 20, 20), ("B", "qe", 20000, 100, 20, 20), ("C", "qe", 20000, 100, 20, 20),
     ("D", "astral", 20000, 100, 20, 20), ("E", "astral", 20000, 100, 20, 20)]
check("H2 boundary 0.20 is met", met(verdict(table("b2", b))) == ("PASS", [True, True, True, True]))

# end to end: scorer on synthetic check tables and Sage tables
def mk(run, n_right, n_wrong, fl_right, fl_wrong, fl_wrong_badcharge=0, decoys=3, extra_lowq=50):
    hc, sg = f"{T}/{run}.hc.tsv", f"{T}/{run}.sage.tsv"
    with open(hc, "w") as f, open(sg, "w") as s:
        f.write(HC)
        s.write("psm_id\tscannr\tcharge\tlabel\trank\tspectrum_q\n")
        scan = 0

        def row(h, t, verdict, fc, label=1, q=0.0005, basis="ms1_isotope"):
            nonlocal scan
            scan += 1
            nid = f"controllerType=0 controllerNumber=1 scan={scan}"
            f.write(f"{scan}\t{nid}\t500.0\t{h}\t{h}\tinferred\tcomplement\t0\t1\t1\t0\t0\t{fc}\t2\t{basis}\t{fc}\t{verdict}\t{h}\n")
            if t:
                s.write(f"{scan}\t{nid}\t{t}\t{label}\t1\t{q}\n")
        for i in range(n_right):
            row(2, 2, "disagree" if i < fl_right else "agree", 3 if i < fl_right else 2)
        for i in range(n_wrong):
            fl = i < fl_wrong
            row(3, 2, "disagree" if fl else ("nocall", "agree", "ambiguous")[i % 3],
                (4 if i < fl_wrong_badcharge else 2) if fl else 3, basis="complement" if i % 2 else "ms1_isotope")
        for i in range(decoys):
            row(2, 3, "disagree", 3, label=-1)          # decoy with another charge: counted in decoy_other only
        for i in range(extra_lowq):
            row(2, 3, "disagree", 3, q=0.002)           # above the truth threshold: ignored
        row(5, 2, "disagree", 2)                        # header outside 1..4: ignored
        row(2, 0, "disagree", 3)                        # no Sage PSM: ignored
        s.write(f"x\tcontrollerType=0 controllerNumber=1 scan=1\t4\t1\t2\t0.0001\n")   # rank 2: ignored
    return f"{run}:qe={hc},{sg}"


out = f"{T}/e2e.tsv"
subprocess.run([PY, "-I", f"{H}/score_item14r.py", out, mk("R1", 1000, 100, 2, 40, 5), mk("R2", 600, 50, 1, 20),
                f"R3:astral={T}/none.tsv,{T}/none2.tsv"], check=True, capture_output=True)
rows = [l.rstrip("\n").split("\t") for l in open(out)]
d = [dict(zip(rows[0], r)) for r in rows[1:]]
check("scorer counts R1", [d[0][k] for k in ("truth", "wrong", "right", "flagged", "tp", "fp", "tp_charge", "decoy_other")]
      == ["1100", "100", "1000", "42", "40", "2", "35", "3"])
check("scorer evidence split", (d[0]["flags_ms1"], d[0]["tp_ms1"], d[0]["flags_compl"], d[0]["tp_compl"]) == ("22", "20", "20", "20"))
check("scorer missed wrong headers", int(d[0]["wrong_agree"]) + int(d[0]["wrong_nocall"]) + int(d[0]["wrong_ambiguous"]) == 60)
check("scorer missing run", d[2]["status"] == "missing" and d[2]["truth"] == "0")
v = verdict(out, "--runs", "3")
check("verdict on scorer output", v["verdict"] == "INCONCLUSIVE" and v["H0"]["runs_evaluable"] == 2
      and abs(v["pooled_evaluable"]["precision_charge"] - 55 / 63) < 1e-12)
# perturbed arm: spectra whose original header the truth does not confirm are left out
hc, sg, pt = f"{T}/p.hc.tsv", f"{T}/p.sage.tsv", f"{T}/p.pert.tsv"
with open(hc, "w") as f, open(sg, "w") as s, open(pt, "w") as p:
    f.write(HC); s.write("psm_id\tscannr\tcharge\tlabel\trank\tspectrum_q\n"); p.write("key\theader_original\theader_given\n")
    for scan, (h, orig, t, vd) in enumerate([(3, 2, 2, "disagree"), (3, 2, 2, "agree"), (3, 2, 4, "disagree"),
                                             (2, 2, 2, "agree"), (2, 2, 3, "disagree")], 1):
        f.write(f"{scan}\tscan={scan}\t500.0\t{h}\t{h}\tinferred\tcomplement\t0\t1\t1\t0\t0\t2\t2\tms1_isotope\t2\t{vd}\t{h}\n")
        s.write(f"{scan}\tscan={scan}\t{t}\t1\t1\t0.0\n")
        if h != orig:
            p.write(f"scan={scan}\t{orig}\t{h}\n")
subprocess.run([PY, "-I", f"{H}/score_item14r.py", f"{T}/p.tsv", f"P:qe={hc},{sg},{pt}"], check=True, capture_output=True)
r = dict(zip(*[l.rstrip("\n").split("\t") for l in open(f"{T}/p.tsv")]))
check("perturbed arm", (r["truth"], r["wrong"], r["flagged"], r["tp"], r["fp"]) == ("3", "2", "1", "1", "0"))
print("ALL OK" if not fails else f"{fails} FAILED")
sys.exit(1 if fails else 0)
