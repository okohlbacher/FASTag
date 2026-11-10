#!/usr/bin/env python3
"""Synthetic check of score_species_explain.py (no held-out data). Run: python3 test_score_species_explain.py"""
import tempfile
from pathlib import Path

import score_species_explain as S


def runs(n):
    return [{"pxd": f"PXD{i:06d}", "run": "r", "organisms": "homo sapiens"} for i in range(n)]


def truth(rs):  # Homo SDRF, in index; run 0: Sus supported (5), Macaca 40 genus-unique; run 1: Zea SDRF outside the index
    t = {(r["pxd"], r["run"]): {"Homo": (True, True, 500)} for r in rs}
    t[("PXD000000", "r")].update({"Sus": (True, False, 5), "Macaca": (True, False, 40)})
    t[("PXD000001", "r")]["Zea"] = (False, True, 0)
    return t


def demo():
    rs = runs(60)
    k = [(r["pxd"], r["run"]) for r in rs]
    # explain: Homo everywhere, one false genus in 6 runs -> 0.10 false/run; decoy: Homo + 4 other genera per run
    ex = {x: {"Homo"} | ({"Mus"} if i < 6 else set()) for i, x in enumerate(k)}
    de = {x: {"Homo", "Sus", "Mus", "Macaca", "Pan"} for x in k}
    per, s = S.score(rs, truth(rs), {"CFG-explain": ex, "CFG-decoy": de})
    assert s["runs_scored"] == 60 and s["true_in_index"] == 61 and s["sdrf_in_index"] == 60 and s["true_in_index_literal"] == 62, s
    m, lo, hi = s["CFG-explain:false_per_run"]
    assert abs(m - 0.1) < 1e-12 and lo < m < hi < 0.25, (m, lo, hi)
    assert s["CFG-explain:recovered"] == 60 and s["CFG-decoy:recovered"] == 61 and s["CFG-decoy:sdrf_recovered"] == 60
    # Sus: supported in run 0 only (positive there, false elsewhere); Macaca stays false whatever Sage reports
    assert s["CFG-decoy:false_total"] == 240 - 1 and s["CFG-decoy:runs_any_false"] == 60
    assert per[0]["CFG-decoy:n_false"] == 3 and per[0]["CFG-decoy:n_false_literal"] == 2 and per[0]["CFG-decoy:n_false_sdrfonly"] == 4
    assert s["CFG-decoy:recovered_literal"] == 62 and s["CFG-explain:recovered_literal"] == 60
    assert (s["primary"], s["guard"], s["overall"]) == ("PASS", "PASS", "PASS"), s
    assert S.score(rs, truth(rs), {"CFG-explain": ex, "CFG-decoy": de})[1] == s  # seeded: reproducible

    # primary FAIL: one false genus in every run (mean 1.0 > 0.75)
    ex2 = {x: {"Homo", "Mus"} for x in k}
    s2 = S.score(rs, truth(rs), {"CFG-explain": ex2, "CFG-decoy": de})[1]
    assert (s2["primary"], s2["guard"], s2["overall"]) == ("FAIL", "PASS", "FAIL"), s2
    # boundary: mean 0.5 with upper bound above / below the limit is decided by the bound, not the mean
    ex3 = {x: {"Homo"} | ({"Mus", "Pan", "Macaca"} if i < 10 else set()) for i, x in enumerate(k)}
    s3 = S.score(rs, truth(rs), {"CFG-explain": ex3, "CFG-decoy": de})[1]
    assert s3["CFG-explain:false_per_run"][0] == 0.5 and s3["CFG-explain:false_per_run"][2] > 0.75 and s3["primary"] == "FAIL"

    # guard FAIL: explain misses Homo in 10 of 60 runs (recovery 50/61 = 0.82 < 1.0 - 0.05)
    ex4 = {x: (set() if i < 10 else {"Homo"}) for i, x in enumerate(k)}
    s4 = S.score(rs, truth(rs), {"CFG-explain": ex4, "CFG-decoy": de})[1]
    assert (s4["primary"], s4["guard"], s4["overall"]) == ("PASS", "FAIL", "FAIL"), s4
    assert s4["CFG-explain:no_present"] == 10 and s4["CFG-explain:relative_instead"] == 0
    # guard at the margin (Sus of run 0 is never called by explain): 58/61 = 0.951 passes, 57/61 = 0.934 fails
    for miss, want in ((2, "PASS"), (3, "FAIL")):
        e = {x: (set() if i < miss else {"Homo"}) for i, x in enumerate(k)}
        assert S.score(rs, truth(rs), {"CFG-explain": e, "CFG-decoy": de})[1]["guard"] == want

    # exclusions: failed run in one arm and missing truth drop the run from both arms; < 50 scored -> INCONCLUSIVE
    ex5 = dict(ex)
    ex5[k[5]] = None
    t5 = truth(rs)
    del t5[k[7]]
    per5, s5 = S.score(rs, t5, {"CFG-explain": ex5, "CFG-decoy": de})
    assert s5["runs_scored"] == 58 and len(s5["excluded"]) == 2 and s5["overall"] == "PASS"
    for x in k[:11]:
        ex5[x] = None
    s6 = S.score(rs, t5, {"CFG-explain": ex5, "CFG-decoy": de})[1]
    assert s6["runs_scored"] == 49 and s6["primary"] == s6["guard"] == s6["overall"] == "INCONCLUSIVE"

    # non-human run calling Homo, Equus (excluded), Bos (unsupported: false) and Rattus instead of Mus (SDRF, unconfirmed: excluded)
    r1 = [{"pxd": "PXD9", "run": "m", "organisms": "Mus musculus"}]
    p1, _ = S.score(r1, {("PXD9", "m"): {"Mus": (True, True, 0), "Bos": (True, False, 2)}},
                    {"CFG-explain": {("PXD9", "m"): {"Homo", "Equus", "Bos", "Rattus"}}, "CFG-decoy": {("PXD9", "m"): {"Mus"}}})
    assert p1[0]["CFG-explain:false"] == "Bos;Rattus" and p1[0]["CFG-explain:n_false_sdrfonly"] == 4
    assert p1[0]["CFG-explain:relative_instead"] == 1 and p1[0]["CFG-decoy:n_false"] == 0
    assert S.status("Homo", True, 3, True) == "positive" and S.status("Homo", True, 2, True) == "excluded" and S.status("Homo", False, 99, False) == "excluded"
    assert S.status("Sus", False, 3, True) == "positive" and S.status("Sus", False, 2, True) == "negative"
    assert S.status("Xenopus", False, 99, True) == "negative"

    # truth derivation and report parsing on files
    with tempfile.TemporaryDirectory() as d:
        d = Path(d)
        (d / "nodes.dmp").write_text("1\t|\t1\t|\tno rank\t|\n9605\t|\t1\t|\tgenus\t|\n9606\t|\t9605\t|\tspecies\t|\n"
                                     "9822\t|\t1\t|\tgenus\t|\n9823\t|\t9822\t|\tspecies\t|\n")
        (d / "names.dmp").write_text("9605\t|\tHomo\t|\t\t|\tscientific name\t|\n9822\t|\tSus\t|\t\t|\tscientific name\t|\n")
        (d / "f.fasta").write_text(">sp|H1|A OS=x OX=9606 GN=a\nAAA\n>sp|S1|B OS=y OX=9823\nAAA\n>sp|U1|C OS=z\nAAA\n")
        a2g = S.acc_genus(d / "f.fasta", d)
        assert a2g == {"sp|H1|A": "Homo", "sp|S1|B": "Sus", "sp|U1|C": None}
        rows = ["peptide\tproteins\tlabel\tspectrum_q\tpeptide_q"]
        rows += [f"PEPTID{c}K\tsp|S1|B\t1\t0.001\t0.001" for c in "ACD"]          # 3 Sus-unique
        rows += ["PEPTIDEK\tsp|S1|B\t1\t0.001\t0.001"] * 2                          # same peptide twice: counted once
        rows += ["SHAREDK\tsp|S1|B;sp|H1|A\t1\t0.001\t0.001", "DECOYYK\tsp|S1|B\t-1\t0.001\t0.001",
                 "BADQQQK\tsp|S1|B\t1\t0.02\t0.001", "UNKWNK\tsp|U1|C\t1\t0.001\t0.001",
                 "HUM[+15.99]ANK\tsp|H1|A\t1\t0.001\t0.001"]
        (d / "s.tsv").write_text("\n".join(rows) + "\n")
        gu = S.genus_unique(d / "s.tsv", a2g)
        assert gu == {"Sus": 4, "Homo": 1}, gu
        tr = S.truth_rows({"pxd": "P", "run": "r", "organisms": "zea mays"}, gu, {"Homo", "Sus"})
        assert tr == [["P", "r", "Homo", 1, 0, 1, "excluded"], ["P", "r", "Sus", 1, 0, 4, "positive"],
                      ["P", "r", "Zea", 0, 1, 0, "excluded"]], tr
        assert S.truth_rows({"pxd": "P", "run": "r", "organisms": "x y"}, None, set())[0][-1] == "no_truth"
        (d / "species.tsv").write_text("rank\tname\tcall\ngenus\tHomo\tpresent\ngenus\tSus\tno_call\nspecies\tX\tpresent\n")
        assert S.called(d) is None                       # no rc file
        (d / "rc").write_text("0\n")
        assert S.called(d) == {"Homo"}
        (d / "rc").write_text("1\n")
        assert S.called(d) is None
    assert abs(S.percentile([1, 2, 3, 4], 50) - 2.5) < 1e-12 and S.percentile([5], 97.5) == 5
    print("synthetic checks passed")


if __name__ == "__main__":
    demo()
