#!/usr/bin/env python3
"""acqcheck2 held-out scorer and verdict.

usage: score.py <manifest.tsv> <truth.tsv> <probe.candidate.tsv> <probe.base.tsv> <units.tsv> <summary.txt>
       score.py --selftest
manifest: id stratum class pxd ... (header line);  truth: truth.py lines;  probe: id rc mode refuse why
Scored units: manifest files with truth DIA or NONDIA. A scored file without a usable candidate probe record
(rc != 0 or no acquisition record) counts as not refused. Files without truth line or with truth UNCLEAR are
excluded and listed.
  K1  refused among truth NONDIA == 0            (needs >= 40 files)
  K2  refused among truth DIA    >= 90 %         (needs >= 25 files)
  verdict FAIL if K1 is violated (any n) or K2 is violated with >= 25 DIA files;
          PASS if both hold with both minimum n; otherwise INCONCLUSIVE.
The base binary (origin/integration/1.13) is reported next to it and does not enter the verdict.
"""
import sys

def rd(path, header=False):
    rows = [l.rstrip("\n").split("\t") for l in open(path) if l.strip()]
    return rows[1:] if header else rows

def verdict(n_non, ref_non, n_dia, ref_dia):
    k1 = ref_non == 0
    k2 = n_dia > 0 and ref_dia >= 0.9 * n_dia
    if not k1: return "FAIL"
    if n_dia >= 25 and not k2: return "FAIL"
    if n_non >= 40 and n_dia >= 25 and k1 and k2: return "PASS"
    return "INCONCLUSIVE"

def score(man, truth, cand, base):
    T = {r[0]: r for r in truth}
    C = {r[0]: r for r in cand}
    B = {r[0]: r for r in base}
    units, cnt = [], {}
    for m in man:
        id_, stratum = m[0], m[1]
        t = T.get(id_)
        tr = t[1] if t else "NO_TRUTH"
        def ref(P):
            p = P.get(id_)
            return "true" if p and p[1] == "0" and p[3] == "true" else ("false" if p and p[1] == "0" and p[3] == "false" else "noprobe")
        c, b = ref(C), ref(B)
        units.append([id_, stratum, m[3], tr, t[2] if t else "-", C.get(id_, ["", "", "NA"])[2], c, B.get(id_, ["", "", "NA"])[2], b])
        if tr in ("DIA", "NONDIA"):
            for key in (tr, tr + "|" + stratum):
                d = cnt.setdefault(key, [0, 0, 0])
                d[0] += 1; d[1] += c == "true"; d[2] += b == "true"
    return units, cnt

def main():
    if sys.argv[1] == "--selftest":
        assert verdict(60, 0, 30, 27) == "PASS"
        assert verdict(60, 1, 30, 30) == "FAIL"
        assert verdict(10, 1, 3, 3) == "FAIL"
        assert verdict(60, 0, 30, 26) == "FAIL"
        assert verdict(60, 0, 24, 20) == "INCONCLUSIVE"
        assert verdict(39, 0, 30, 30) == "INCONCLUSIVE"
        assert verdict(60, 0, 0, 0) == "INCONCLUSIVE"
        man = [["a", "DIA_orbitrap", "DIA", "PXD1"], ["b", "DDA_x", "nonDIA", "PXD2"], ["c", "DDA_x", "nonDIA", "PXD3"],
               ["d", "DIA_orbitrap", "DIA", "PXD4"], ["e", "DIA_orbitrap", "DIA", "PXD5"]]
        truth = [["a", "DIA", "t"], ["b", "NONDIA", "dependent"], ["c", "UNCLEAR", "mixed"], ["d", "DIA", "t"]]
        cand = [["a", "0", "DIA", "true", ""], ["b", "0", "DDA", "false", ""], ["c", "0", "DIA", "true", ""], ["d", "1", "NA", "NA", ""]]
        base = [["a", "0", "DIA-like", "false", ""], ["b", "0", "DDA", "false", ""]]
        u, c = score(man, truth, cand, base)
        assert c["DIA"] == [2, 1, 0] and c["NONDIA"] == [1, 0, 0], c
        assert [x[6] for x in u] == ["true", "false", "true", "noprobe", "noprobe"] and u[4][3] == "NO_TRUTH"
        print("score selftest ok"); return
    man, truth, cand, base = rd(sys.argv[1], True), rd(sys.argv[2]), rd(sys.argv[3]), rd(sys.argv[4])
    units, cnt = score(man, truth, cand, base)
    with open(sys.argv[5], "w") as o:
        o.write("id\tstratum\tpxd\ttruth\ttruth_kind\tcand_mode\tcand_refused\tbase_mode\tbase_refused\n")
        for u in units: o.write("\t".join(u) + "\n")
    non, dia = cnt.get("NONDIA", [0, 0, 0]), cnt.get("DIA", [0, 0, 0])
    v = verdict(non[0], non[1], dia[0], dia[1])
    out = ["files in manifest: %d; scored: %d; excluded: %d" % (len(units), non[0] + dia[0], len(units) - non[0] - dia[0]),
           "K1 refused among truth NONDIA: candidate %d of %d (criterion 0, n >= 40); base %d of %d" % (non[1], non[0], non[2], non[0]),
           "K2 refused among truth DIA: candidate %d of %d (criterion >= 90%%, n >= 25); base %d of %d" % (dia[1], dia[0], dia[2], dia[0]),
           "by truth|stratum (n, candidate refused, base refused):"]
    out += ["  %s\t%d\t%d\t%d" % (k, v_[0], v_[1], v_[2]) for k, v_ in sorted(cnt.items()) if "|" in k]
    out += ["excluded:"] + ["  %s\t%s\t%s\t%s" % (u[0], u[3], u[4], u[5]) for u in units if u[3] not in ("DIA", "NONDIA")]
    out += ["VERDICT: " + v]
    open(sys.argv[6], "w").write("\n".join(out) + "\n")
    print("\n".join(out))

main()
