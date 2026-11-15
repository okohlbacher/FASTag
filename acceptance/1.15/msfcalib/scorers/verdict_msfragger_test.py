#!/usr/bin/env python3
"""Synthetic checks of verdict_msfragger.py and score_msfragger.py (no real data). Run: python3 verdict_msfragger_test.py"""
import os, sys, tempfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from verdict_msfragger import verdict
import score_msfragger as S

def row(i, **k):
    r = dict(run=f"R{i}", fastag_rc="0", a_rc="0", b_rc="0", aE_rc="0", bE_rc="0", export_unchanged="1", a_psm="9000",
             b_psm="10000", b_in_a_same_peptide="9000", recall="0.9000", aE_t="8950", aE_e="50", speedup="1.5")
    r.update(k); return r

def v(rows):
    return {k: x[0] for k, x in verdict(rows).items()}

base = [row(i) for i in range(8)]
assert v(base) == dict(evaluable=8, C1="PASS", C2="PASS", G1="PASS", G2="PASS", OVERALL="PASS"), v(base)
# C1: one rejected parameter file, one edited export, one missing run
assert v(base[:7] + [row(7, a_rc="1", a_psm="NA", recall="NA", b_in_a_same_peptide="NA")])["C1"] == "FAIL"
assert v(base[:7] + [row(7, export_unchanged="0")])["OVERALL"] == "FAIL"
assert v(base[:7])["C1"] == "FAIL"
# C2: boundary and one low run; a failed arm a counts as recall 0
assert v(base[:7] + [row(7, recall="0.8000", b_in_a_same_peptide="8000")])["C2"] == "PASS"
assert v(base[:7] + [row(7, recall="0.7999", b_in_a_same_peptide="7999")])["C2"] == "FAIL"
assert v(base[:7] + [row(7, a_rc="1", a_psm="NA", recall="NA", b_in_a_same_peptide="NA")])["C2"] == "FAIL"
# G1: median exactly 1.0 fails, above passes
assert v([row(i, speedup="1.0") for i in range(8)])["G1"] == "FAIL"
assert v([row(i, speedup="0.5") for i in range(3)] + [row(i, speedup="1.2") for i in range(3, 8)])["G1"] == "PASS"
# G2: pooled bound, per-run bound
assert v([row(i, aE_t="9925", aE_e="75") for i in range(8)])["G2"] == "PASS"      # 1.50 %
assert v([row(i, aE_t="9924", aE_e="76") for i in range(8)])["G2"] == "FAIL"      # 1.52 %
assert v(base[:7] + [row(7, aE_t="9890", aE_e="110")])["G2"] == "FAIL"            # one run 2.2 %
# evaluability: three runs with too few b spectra -> INCONCLUSIVE, C1 still judged
low = base[:5] + [row(i, b_psm="999", b_in_a_same_peptide="900") for i in range(5, 8)]
assert v(low) == dict(evaluable=5, C1="PASS", C2="INCONCLUSIVE", G1="INCONCLUSIVE", G2="INCONCLUSIVE", OVERALL="INCONCLUSIVE"), v(low)
assert v(base[:6] + [row(i, b_rc="1", b_psm="NA") for i in range(6, 8)])["evaluable"] == 6
assert v(base[:6] + [row(i, aE_rc="1", aE_t="NA", aE_e="NA") for i in range(6, 8)])["G2"] == "PASS"
assert v(base[:5] + [row(i, aE_rc="1", aE_t="NA", aE_e="NA") for i in range(5, 8)])["G2"] == "INCONCLUSIVE"
# a FAIL beats INCONCLUSIVE
assert v(low[:7] + [row(7, fastag_rc="3", a_rc="NA", b_psm="999")])["OVERALL"] == "FAIL"

# scorer: peptide stripping, classes, FDR walk
assert S.strip("K.DKGDEEEEGEEK2.L") == "DKGDEEEEGEEK"
assert S.strip("R.GAEEPRQAEAGEM[15.9949]R3.A") == "GAEEPRQAEAGEMR"
assert S.strip("-.n[42.0106]MIDIK2.L") == "MLDLK"
assert S.kind(["rev_sp|A|B", "rev_ENTRAP_sp|C|D"]) == "d" and S.kind(["ENTRAP_sp|A|B", "rev_sp|C|D"]) == "e"
assert S.kind(["ENTRAP_sp|A|B", "sp|C|D"]) == "t"
with tempfile.TemporaryDirectory() as d:
    p = f"{d}/x.pin"
    with open(p, "w") as f:
        f.write("SpecId\tLabel\tScanNr\trank\tlog10_evalue\thyperscore\tPeptide\tProteins\n")
        for i in range(200):                       # 200 targets, scores 300..101
            f.write(f"s\t1\t{i}\t1\t{-(300 - i) / 10}\t{300 - i}\tK.PEPTIDEK2.A\tsp|T{i}|X;\n")
        f.write("s\t-1\t500\t1\t-10.05\t100.5\tK.PEPTIDEK2.A\trev_sp|D|X;\n")   # decoy 1: q = 1/200 <= 0.01
        f.write("s\t1\t501\t1\t-10\t100\tK.AAAK2.A\tENTRAP_sp|E|X;\trev_sp|Q|X\n")
        f.write("s\t-1\t502\t1\t-9.9\t99\tK.PEPTIDEK2.A\trev_sp|D2|X;\n")       # decoys 2, 3: q = 3/202 > 0.01
        f.write("s\t-1\t503\t1\t-9.8\t98\tK.PEPTIDEK2.A\trev_sp|D3|X;\n")
        f.write("s\t1\t504\t1\t-9.7\t97\tK.PEPTIDEK2.A\tsp|T|X;\n")             # 3/202 > 0.01: rejected
        f.write("s\t1\t0\t2\t-1\t999\tK.WRONGK2.A\trev_sp|Z|X;\n")              # rank 2 ignored
    a = S.accepted(p)
    assert len(a) == 201 and a[501] == ("AAAK", "e") and 504 not in a and a[0][0] == "PEPTLDEK", len(a)
    assert len(S.accepted(p, "log10_evalue", -1.0)) == 201
    assert S.accepted(f"{d}/missing.pin") is None
    open(f"{d}/t", "w").write("\tElapsed (wall clock) time (h:mm:ss or m:ss): 1:02:03\n")
    assert S.wall(f"{d}/t") == 3723.0
    open(f"{d}/t", "w").write("\tElapsed (wall clock) time (h:mm:ss or m:ss): 0:57.23\n")
    assert abs(S.wall(f"{d}/t") - 57.23) < 1e-9
print("verdict_msfragger_test: all checks passed")
