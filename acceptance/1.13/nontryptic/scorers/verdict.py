#!/usr/bin/env python3
"""verdict.py <scores.tsv>  -> verdict per criterion (stdout).   verdict.py --selftest
Criteria of PREREG-nontryptic.md (E0, P1, P2, G1, G2); thresholds are constants of the frozen protocol."""
import csv, random, statistics, sys
MIN_REF, MIN_EVAL, MIN_PROJ, MIN_PROT = 50, 6, 5, 3
P1_MEDIAN, G1_SHARE, NBOOT, SEED = 0.20, 0.60, 10000, 20261110
def verdict(rows):
    out = []
    ev = [r for r in rows if r["sage_rc_full"] == "0" and r["ref_proteins"] not in ("NA", "") and int(r["ref_proteins"]) >= MIN_REF
          and r["recall_auto"] != "NA" and r["recall_forced"] != "NA"]
    nproj, nprot = len({r["accession"] for r in ev}), len({r["protease"] for r in ev})
    e0 = len(ev) >= MIN_EVAL and nproj >= MIN_PROJ and nprot >= MIN_PROT
    out.append(("E0", "PASS" if e0 else "INCONCLUSIVE", f"evaluable runs {len(ev)} of {len(rows)} (need >= {MIN_EVAL}), projects {nproj} (>= {MIN_PROJ}), proteases {nprot} (>= {MIN_PROT})"))
    if e0:
        ra = [float(r["recall_auto"]) for r in ev]; med = statistics.median(ra)
        out.append(("P1", "PASS" if med >= P1_MEDIAN else "FAIL", f"median recall(auto) {med:.4f} (threshold {P1_MEDIAN}); mean {statistics.mean(ra):.4f}; n {len(ra)}"))
        by = {}
        for r in ev: by.setdefault(r["accession"], []).append(float(r["recall_auto"]) - float(r["recall_forced"]))
        d = [x for v in by.values() for x in v]; mean = statistics.mean(d)
        rng = random.Random(SEED); keys = sorted(by); bs = []
        for _ in range(NBOOT):
            s = [x for k in rng.choices(keys, k=len(keys)) for x in by[k]]
            bs.append(statistics.mean(s))
        bs.sort(); lo, hi = bs[int(0.025 * NBOOT)], bs[int(0.975 * NBOOT) - 1]
        p2 = "FAIL" if mean <= 0 else ("PASS" if lo > 0 else "INCONCLUSIVE")
        out.append(("P2", p2, f"mean paired difference recall(auto) - recall(trypsin shortlist) {mean:+.4f}, 95 % CI [{lo:+.4f}, {hi:+.4f}] (project bootstrap, {len(keys)} projects, {len(d)} runs)"))
    else:
        out += [("P1", "INCONCLUSIVE", "E0 not met"), ("P2", "INCONCLUSIVE", "E0 not met")]
    hit = sum(r["auto_rule_is_truth"] == "1" for r in rows); share = hit / len(rows) if rows else 0.0
    out.append(("G1", "PASS" if rows and share >= G1_SHARE else "FAIL", f"auto rule equals the true protease in {hit} of {len(rows)} runs ({share:.3f}; threshold {G1_SHARE})"))
    bad = [r["run"] for r in rows if not (r["rc_auto"] == "0" and r["rc_forced"] == "0" and r["rc_default"] in ("0", "6")
                                         and r["auto_exports"] == "1" and r["sage_rc_auto"] == "0")]
    out.append(("G2", "PASS" if rows and not bad else "FAIL", f"aborted runs: {len(bad)} of {len(rows)}" + (f" ({', '.join(bad)})" if bad else "")))
    vs = [v for k, v, _ in out if k != "E0"]
    out.append(("OVERALL", "FAIL" if "FAIL" in vs else ("INCONCLUSIVE" if "INCONCLUSIVE" in vs else "PASS"), "PASS only if P1, P2, G1 and G2 pass; any FAIL gives FAIL; otherwise INCONCLUSIVE"))
    return out
def selftest():
    def row(i, proj, prot, ra, rf, rule=None, ref=500, **kw):
        r = dict(run=f"S{i:02d}", accession=proj, protease=prot, recall_auto=f"{ra:.4f}", recall_forced=f"{rf:.4f}", ref_proteins=str(ref),
                 auto_rule_is_truth="1" if rule is None else rule, rc_auto="0", rc_forced="0", rc_default="6", auto_exports="1",
                 sage_rc_auto="0", sage_rc_full="0"); r.update(kw); return r
    prots = ["Asp-N", "Glu-C", "Lys-C", "Chymotrypsin"]
    good = [row(i, f"P{i % 6}", prots[i % 4], 0.30 + 0.01 * i, 0.05) for i in range(8)]
    v = dict((k, x) for k, x, _ in verdict(good)); assert v == dict(E0="PASS", P1="PASS", P2="PASS", G1="PASS", G2="PASS", OVERALL="PASS"), v
    low = [dict(r, recall_auto="0.1000") for r in good]
    v = dict((k, x) for k, x, _ in verdict(low)); assert v["P1"] == "FAIL" and v["OVERALL"] == "FAIL", v
    worse = [dict(r, recall_auto="0.2500", recall_forced="0.3000") for r in good]
    v = dict((k, x) for k, x, _ in verdict(worse)); assert v["P1"] == "PASS" and v["P2"] == "FAIL", v
    mixed = [dict(r, recall_forced=("0.9000" if r["accession"] == "P0" else "0.2500")) for r in good]
    v = dict((k, x) for k, x, _ in verdict(mixed)); assert v["P2"] in ("INCONCLUSIVE", "FAIL") and v["OVERALL"] != "PASS", v
    few = [dict(r, ref_proteins="10") if i > 2 else r for i, r in enumerate(good)]
    v = dict((k, x) for k, x, _ in verdict(few)); assert v["E0"] == v["P1"] == v["P2"] == v["OVERALL"] == "INCONCLUSIVE", v
    wrong = [dict(r, auto_rule_is_truth="0") if i > 3 else r for i, r in enumerate(good)]
    v = dict((k, x) for k, x, _ in verdict(wrong)); assert v["G1"] == "FAIL" and v["OVERALL"] == "FAIL", v
    ab = [dict(good[0], rc_auto="1")] + good[1:]
    v = dict((k, x) for k, x, _ in verdict(ab)); assert v["G2"] == "FAIL" and v["OVERALL"] == "FAIL", v
    nofull = [dict(good[0], sage_rc_full="1", ref_proteins="NA", recall_auto="NA", recall_forced="NA")] + good[1:]
    v = dict((k, x) for k, x, _ in verdict(nofull)); assert v["E0"] == "PASS" and v["G2"] == "PASS", v
    print("SELFTEST_OK")
if __name__ == "__main__":
    if sys.argv[1] == "--selftest": selftest()
    else:
        for k, v, t in verdict(list(csv.DictReader(open(sys.argv[1]), delimiter="\t"))): print(k, v, t, sep="\t")
