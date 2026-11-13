#!/usr/bin/env python3
"""verdict.py <scores.tsv> -> verdict per criterion (stdout).   verdict.py --selftest
Criteria of PREREG-aspn.md (E0, C1, C2, R1, R2, T1, G1, S1); thresholds are constants of the frozen protocol."""
import csv, random, statistics, sys
MIN_REF = 50                       # evaluable run: reference search rc 0 (first repeat) and >= 50 reference proteins
MIN_A_RUNS, MIN_A_PROJ = 6, 3      # E0: evaluable Asp-N runs and projects
MIN_C_RUNS, MIN_C_PROJ = 6, 3      # E0: control runs (auto arm rc 0) and projects
MIN_R_RUNS, MIN_R_PROJ = 3, 2      # R1/R2/T1: evaluable Asp-N runs called Asp-N, and their projects
C1_SHARE, T1_MAX, NBOOT, SEED = 0.50, 1.25, 10000, 20261113

def boot(rows, key):
    by = {}
    for r in rows: by.setdefault(r["accession"], []).append(key(r))
    d = [x for v in by.values() for x in v]; mean = statistics.mean(d)
    rng = random.Random(SEED); keys = sorted(by); bs = []
    for _ in range(NBOOT):
        bs.append(statistics.mean([x for k in rng.choices(keys, k=len(keys)) for x in by[k]]))
    bs.sort()
    return mean, bs[int(0.025 * NBOOT)], bs[int(0.975 * NBOOT) - 1], len(keys), len(d)

def paired(name, rows, a, b, label):
    mean, lo, hi, np_, n = boot(rows, lambda r: float(r[a]) - float(r[b]))
    v = "FAIL" if mean <= 0 else ("PASS" if lo > 0 else "INCONCLUSIVE")
    return (name, v, f"mean paired difference {label} {mean:+.4f}, 95 % CI [{lo:+.4f}, {hi:+.4f}] (project bootstrap, {np_} projects, {n} runs)")

def verdict(rows):
    out = []
    A = [r for r in rows if r["group"] == "aspn"]; C = [r for r in rows if r["group"] == "control"]
    ev = [r for r in A if r["sage_rc_full"].split(",")[0] == "0" and r["ref_proteins"] not in ("NA", "")
          and int(r["ref_proteins"]) >= MIN_REF and "NA" not in (r["recall_auto"], r["recall_autofull"], r["recall_tryp"])]
    cok = [r for r in C if r["rc_auto"] == "0"]
    na, pa = len(ev), len({r["accession"] for r in ev}); nc, pc = len(cok), len({r["accession"] for r in cok})
    e0 = na >= MIN_A_RUNS and pa >= MIN_A_PROJ and nc >= MIN_C_RUNS and pc >= MIN_C_PROJ
    out.append(("E0", "PASS" if e0 else "INCONCLUSIVE",
                f"evaluable Asp-N runs {na} of {len(A)} from {pa} projects (need >= {MIN_A_RUNS} from >= {MIN_A_PROJ}); "
                f"control runs {nc} of {len(C)} from {pc} projects (need >= {MIN_C_RUNS} from >= {MIN_C_PROJ})"))
    # C1: Asp-N call on Asp-N runs (all Asp-N runs in the test)
    hit = sum(r["auto_rule"] == "Asp-N" for r in A); share = hit / len(A) if A else 0.0
    out.append(("C1", ("PASS" if share >= C1_SHARE else "FAIL") if e0 else "INCONCLUSIVE",
                f"auto placement Asp-N in {hit} of {len(A)} Asp-N runs ({share:.3f}; threshold {C1_SHARE})"))
    # C2: no Asp-N call on control runs
    fp = [r["run"] for r in C if r["auto_rule"] == "Asp-N"]
    out.append(("C2", ("PASS" if not fp else "FAIL") if e0 else "INCONCLUSIVE",
                f"auto placement Asp-N in {len(fp)} of {len(C)} control runs (threshold 0)" + (f" ({', '.join(fp)})" if fp else "")))
    called = [r for r in ev if r["auto_rule"] == "Asp-N"]
    enough = e0 and len(called) >= MIN_R_RUNS and len({r["accession"] for r in called}) >= MIN_R_PROJ
    why = f"needs E0 and >= {MIN_R_RUNS} evaluable Asp-N runs called Asp-N from >= {MIN_R_PROJ} projects; have {len(called)}"
    if enough:
        out.append(paired("R1", called, "recall_auto", "recall_tryp", "recall(auto, semi export) - recall(trypsin shortlist)"))
        out.append(paired("R2", called, "recall_auto", "recall_autofull", "recall(auto, semi export) - recall(Asp-N full export)"))
        tr = [float(r["time_ratio_auto"]) for r in called if r["time_ratio_auto"] != "NA"]
        if len(tr) == len(called):
            m = statistics.median(tr)
            out.append(("T1", "PASS" if m <= T1_MAX else "FAIL", f"median Sage time(auto export) / time(full search) {m:.3f} over {len(tr)} runs (threshold <= {T1_MAX}); range {min(tr):.3f}-{max(tr):.3f}"))
        else:
            out.append(("T1", "FAIL", f"time missing for {len(called) - len(tr)} of {len(called)} runs (a failed search counts against T1)"))
    else:
        out += [(k, "INCONCLUSIVE", why) for k in ("R1", "R2", "T1")]
    bad = []
    for r in rows:
        ok = r["rc_auto"] == "0" and r["rc_tryp"] == "0" and r["exports_auto"] == "1" and r["exports_tryp"] == "1" \
             and set(r["sage_rc_auto"].split(",")) == {"0"}
        if r["group"] == "aspn": ok = ok and r["rc_autofull"] == "0" and r["exports_autofull"] == "1" and r["sage_rc_autofull"] == "0"
        if not ok: bad.append(r["run"])
    out.append(("G1", "PASS" if rows and not bad else "FAIL", f"aborted runs (FASTag arm rc != 0, export missing, or Sage on the auto export rc != 0): {len(bad)} of {len(rows)}" + (f" ({', '.join(bad)})" if bad else "")))
    s = [r["run"] for r in rows if r["auto_rule"] == "Asp-N" and not (r["auto_spec"] == "semi" and r["auto_semi_cfg"] == "1")]
    sf = [r["run"] for r in A if r["auto_rule"] == "Asp-N" and r["autofull_spec"] != "full"]
    out.append(("S1", "PASS" if not s and not sf else "FAIL", f"Asp-N calls not exported semi-specific under auto: {len(s)}; autofull not full: {len(sf)}" + (f" ({', '.join(s + sf)})" if s or sf else "")))
    vs = [v for k, v, _ in out if k != "E0"]
    out.append(("OVERALL", "FAIL" if "FAIL" in vs else ("INCONCLUSIVE" if "INCONCLUSIVE" in vs or not e0 else "PASS"),
                "PASS only if E0 and C1, C2, R1, R2, T1, G1, S1 pass; any FAIL gives FAIL; otherwise INCONCLUSIVE"))
    return out

def selftest():
    def row(i, grp, proj, rule="Asp-N", ra=0.30, rf=0.20, rt=0.01, tr=1.0, **kw):
        r = dict(run=f"S{i:02d}", group=grp, protease="Asp-N" if grp == "aspn" else "Trypsin", accession=proj,
                 rc_auto="0", rc_autofull="0" if grp == "aspn" else "-", rc_tryp="0", exports_auto="1",
                 exports_autofull="1" if grp == "aspn" else "-", exports_tryp="1", sage_rc_full="0,0,0", sage_rc_auto="0,0,0",
                 sage_rc_autofull="0" if grp == "aspn" else "-", sage_rc_tryp="0", auto_rule=rule,
                 auto_spec="semi" if rule == "Asp-N" else "full", auto_semi_cfg="1" if rule == "Asp-N" else "0",
                 autofull_rule=rule if grp == "aspn" else "-", autofull_spec="full" if grp == "aspn" else "-",
                 ref_proteins="500", recall_auto=f"{ra:.4f}", recall_autofull=f"{rf:.4f}", recall_tryp=f"{rt:.4f}",
                 time_ratio_auto=f"{tr:.4f}")
        r.update(kw); return r
    good = [row(i, "aspn", f"A{i % 3}", ra=0.30 + 0.01 * i) for i in range(7)] + \
           [row(10 + i, "control", f"C{i % 4}", rule="Trypsin") for i in range(8)]
    V = lambda rows: dict((k, x) for k, x, _ in verdict(rows))
    v = V(good); assert all(x == "PASS" for x in v.values()), v
    # C1 fail: Asp-N called in 3 of 7
    v = V([dict(r, auto_rule="unspecific", auto_spec="full", auto_semi_cfg="0") if r["group"] == "aspn" and i > 2 else r for i, r in enumerate(good)])
    assert v["C1"] == "FAIL" and v["OVERALL"] == "FAIL", v
    # C2 fail: a control called Asp-N
    v = V(good[:-1] + [dict(good[-1], auto_rule="Asp-N", auto_spec="semi", auto_semi_cfg="1")]); assert v["C2"] == "FAIL" and v["OVERALL"] == "FAIL", v
    # R2 fail: semi export keeps fewer than the full export
    v = V([dict(r, recall_autofull="0.9000") if r["group"] == "aspn" else r for r in good]); assert v["R2"] == "FAIL" and v["R1"] == "PASS", v
    # R1 fail: no gain over the trypsin shortlist
    v = V([dict(r, recall_tryp="0.9500") if r["group"] == "aspn" else r for r in good]); assert v["R1"] == "FAIL", v
    # R2 inconclusive: positive mean, CI includes 0 (one project much worse)
    v = V([dict(r, recall_autofull=("0.9000" if r["accession"] == "A0" else "0.2500")) if r["group"] == "aspn" else r for r in good])
    assert v["R2"] in ("INCONCLUSIVE", "FAIL") and v["OVERALL"] != "PASS", v
    # T1 fail: export slower
    v = V([dict(r, time_ratio_auto="2.0000") for r in good]); assert v["T1"] == "FAIL" and v["OVERALL"] == "FAIL", v
    # T1 missing time counts as FAIL
    v = V([dict(good[0], time_ratio_auto="NA")] + good[1:]); assert v["T1"] == "FAIL", v
    # E0: too few evaluable Asp-N runs -> INCONCLUSIVE
    v = V([dict(r, ref_proteins="10") if r["group"] == "aspn" and i > 2 else r for i, r in enumerate(good)])
    assert v["E0"] == "INCONCLUSIVE" and v["OVERALL"] == "INCONCLUSIVE", v
    # E0: too few control projects
    v = V([dict(r, accession="C0") if r["group"] == "control" else r for r in good]); assert v["E0"] == "INCONCLUSIVE", v
    # G1: an aborted autofull arm
    v = V([dict(good[0], rc_autofull="1")] + good[1:]); assert v["G1"] == "FAIL" and v["OVERALL"] == "FAIL", v
    # G1: failed Sage on an auto export repeat
    v = V([dict(good[0], sage_rc_auto="0,1,0")] + good[1:]); assert v["G1"] == "FAIL", v
    # S1: an Asp-N call exported full-specific
    v = V([dict(good[0], auto_spec="full")] + good[1:]); assert v["S1"] == "FAIL" and v["OVERALL"] == "FAIL", v
    # failed reference search: run not evaluable, no G1 failure
    v = V([dict(good[0], sage_rc_full="1,0,0", ref_proteins="NA", recall_auto="NA")] + good[1:]); assert v["E0"] == "PASS" and v["G1"] == "PASS", v
    # few runs called Asp-N: R1, R2, T1 INCONCLUSIVE (and C1 FAIL)
    v = V([dict(r, auto_rule="Trypsin", auto_spec="full", auto_semi_cfg="0") if r["group"] == "aspn" and i > 1 else r for i, r in enumerate(good)])
    assert v["R1"] == v["R2"] == v["T1"] == "INCONCLUSIVE" and v["C1"] == "FAIL" and v["OVERALL"] == "FAIL", v
    print("SELFTEST_OK")

if __name__ == "__main__":
    if sys.argv[1] == "--selftest": selftest()
    else:
        for k, v, t in verdict(list(csv.DictReader(open(sys.argv[1]), delimiter="\t"))): print(k, v, t, sep="\t")
