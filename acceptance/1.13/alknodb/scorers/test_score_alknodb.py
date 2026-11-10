#!/usr/bin/env python3
"""Synthetic test of score_alknodb.py: the verdict rule at its boundaries and one end-to-end scoring of made-up
reports. Run: python3 test_score_alknodb.py"""
import json, os, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import score_alknodb as S

# Wilson: 55/60 is the smallest count of 60 that passes (54/60 gives 0.7985; the draft's "54" was wrong)
assert S.wilson(55, 60)[0] >= 0.80 > S.wilson(54, 60)[0]
assert abs(S.wilson(51, 61)[0] - 0.724) < 5e-4 and abs(S.wilson(51, 61)[1] - 0.908) < 5e-4  # the DEV numbers
V = lambda *a: S.verdict(*a)[0]
assert V(120, 0, 60, 55) == "PASS"
assert V(120, 0, 60, 54) == "INCONCLUSIVE"       # 0.900, lower end 0.7985
assert V(120, 0, 60, 47) == "FAIL"               # 0.783
assert V(120, 0, 60, 48) == "INCONCLUSIVE"       # exactly 0.80
assert V(120, 0, 29, 29) == "FAIL"               # fewer than 30 calls, all right
assert V(120, 0, 30, 30) == "PASS"               # lower end 0.886
assert V(120, 0, 30, 29) == "PASS"               # lower end 0.833
assert V(120, 0, 30, 28) == "INCONCLUSIVE"       # 0.933, lower end 0.787
assert V(120, 13, 60, 60) == "INCONCLUSIVE"      # more than 10 % without a report
assert V(120, 12, 60, 60) == "PASS"              # exactly 10 %
assert V(120, 0, 0, 0) == "FAIL"


def rep(status, reagent="-", reason="-", section="alkylation_tags_call"):
    return (f"alkt_run\tspectra\t100\t-\tx\nalkt_form\tCarbamidomethyl\t80\t100\tx\nalkt_form\tunmodified\t5\t100\tx\n"
            f"{section}\tstatus\t{status}\t100\tx\n{section}\treagent\t{reagent}\t80\tx\n"
            f"{section}\tshare\t0.8\t100\tx\n{section}\treason\t{reason}\t-\tx\n")


with tempfile.TemporaryDirectory() as T:
    rows, plan = [], []
    # 40 CAM: 30 called CAM, 2 called Nethylmaleimide, 8 no call; 20 OTHER (NEM): 6 right, 1 CAM, 12 no call, 1 crash;
    # 20 NONE: 1 none, 1 CAM, 18 no call
    for i in range(40):
        plan.append(("CAM", "Carbamidomethyl", ("Carbamidomethyl" if i < 30 else "Nethylmaleimide" if i < 32 else None)))
    for i in range(20):
        plan.append(("OTHER", "Nethylmaleimide", ("Nethylmaleimide" if i < 6 else "Carbamidomethyl" if i < 7 else
                                                  "CRASH" if i == 19 else None)))
    for i in range(20):
        plan.append(("NONE", "none", ("none" if i < 1 else "Carbamidomethyl" if i < 2 else None)))
    for i, (s, t, c) in enumerate(plan):
        a = f"PXD9{i:05d}"
        db = "human" if i < 10 else "-"
        rows.append(f"{a}\trun{i}\t{s}\t{t}\t{db}")
        os.makedirs(f"{T}/runs/{a}")
        if c == "CRASH":
            json.dump({"rc": 6, "status": "ran"}, open(f"{T}/runs/{a}/status.json", "w")); continue
        json.dump({"rc": 0, "rc_db": 0 if db != "-" else None, "status": "ran"}, open(f"{T}/runs/{a}/status.json", "w"))
        open(f"{T}/runs/{a}/alkt.tsv", "w").write(rep("call", c) if c else rep("no_call", "-", "ambiguous"))
        if db != "-":
            open(f"{T}/runs/{a}/alkdb.tsv", "w").write(
                rep("call", "Carbamidomethyl", section="alkylation_call") if i < 8 else
                rep("no_call", "-", "few_cys_spectra", section="alkylation_call"))
    open(f"{T}/man.tsv", "w").write("# synthetic\npxd\trun\tstratum\ttruth\tdb_fasta\n" + "\n".join(rows) + "\n")
    out = subprocess.run([sys.executable, f"{HERE}/score_alknodb.py", f"{T}/man.tsv", f"{T}/runs", f"{T}/out"],
                         capture_output=True, text=True)
    assert out.returncode == 0, out.stderr
    s = json.load(open(f"{T}/out/summary.json"))
    # called 32 + 7 + 2 = 41, right 30 + 6 + 1 = 37 -> 0.902, Wilson lower end 0.774 -> INCONCLUSIVE
    assert (s["runs"], s["no_report"], s["called"], s["right"]) == (80, 1, 41, 37), s
    assert s["verdict"] == "INCONCLUSIVE" and abs(s["wilson_lo"] - 0.7745) < 1e-3, s
    v = open(f"{T}/out/verdict.txt").read()
    assert "recall of none on the not-alkylated stratum 1/20" in v
    assert "stratum OTHER: runs 20; call rate 7/20" in v and "accuracy among calls 6/7" in v
    assert "rows 10; called 8; no_report 0; right among its calls 8/8" in v and "both methods call: 8; same class 8" in v
    assert "Nethylmaleimide  -> no_call:ambiguous" in v and "no_report" in open(f"{T}/out/calls.tsv").read()
    # scoring twice is refused
    again = subprocess.run([sys.executable, f"{HERE}/score_alknodb.py", f"{T}/man.tsv", f"{T}/runs", f"{T}/out"],
                           capture_output=True, text=True)
    assert again.returncode != 0 and "scored once" in again.stderr
print("SYNTHETIC TEST PASS")
