#!/usr/bin/env python3
"""Score the FASTag 1.13 #17r held-out test (PREREG-item17r.md): -search_shifts vs the closed search, second test.

PSM counting, entrapment FDP, the open-search peak finder and the "new masses" of the candidate configuration are
the functions of score_item17.py (same directory, unchanged, sha256 8ecd686c...); see its docstring. Only the
criteria P2 and P4 and the verdict rule differ.

Input: sage_expressible.tsv (name, site, mono_mass) and one or more searches.tsv (run_item17r.sh), columns
run arm(base|cand) engine(sage|comet) result config shifts open.
Output dir: cells.tsv (one row per run x engine), peaks.tsv (open-search top-10 peaks per run x engine),
verdict.tsv (criteria per engine and the item verdict).

Criteria per engine (N = runs scored; planned 4):
  P1 gain: psm_t(cand) >= 1.02 psm_t(base) on >= 3 runs.
  P2 fdp:  fdp(cand) <= fdp(base) + 0.003 and fdp(cand) <= 0.020, on every run.
  P3 loss: psm_t(cand) >= 0.99 psm_t(base) on every run.
  P4 open-search recovery: on >= 3 runs, recovered >= ceil(0.6 n) of the n admissible peaks.
     Admissible = one of the (<= 10) top open-search peaks (score_item17.peaks) whose centroid c
       (a) is not within 0.02 Da of k x 1.0033548 for k = -1..3 (k = 0: the unshifted peak), and
       (b) for Sage only: c > 0 and |c - m| <= 0.02 for one mono_mass m of sage_expressible.tsv.
     Recovered as in score_item17.py: |c - m| <= 0.02 Da for a NEW mass m of the cand configuration.
     A run with n < 3 is not evaluable for P4. P4 = PASS if >= 3 runs pass; else INCONCLUSIVE if fewer than 3
     runs are evaluable; else FAIL.
  N < 3 (runs lost for technical reasons, PREREG): P1-P4 INCONCLUSIVE.
  Engine verdict: FAIL if any of P1-P4 is FAIL; else INCONCLUSIVE if any is INCONCLUSIVE; else PASS.
  Item verdict: PASS if both engines PASS; FAIL if any engine FAILs; else INCONCLUSIVE.
Reported without threshold, per run x engine, over the admissible peaks: detected = FASTag lists a gap peak
(row of -search_shifts_out) with |delta - c| <= 0.02 or |exported - c| <= 0.02; exported = such a row has action
'variable' or 'offset'.
Usage: score_item17r.py <out dir> <sage_expressible.tsv> <searches.tsv> [<searches.tsv> ...]
       score_item17r.py --selftest"""
import csv, math, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import score_item17 as s17

ISO, TOL = 1.0033548, 0.02


def admissible(c, engine, table):
    if any(abs(c - k * ISO) <= TOL for k in range(-1, 4)): return False
    if engine == "sage": return c > 0 and any(abs(c - m) <= TOL for m in table)
    return True


def read_table(path):
    return [float(l.split("\t")[2]) for l in open(path) if l.strip() and l[0] != "#" and not l.startswith("name\t")]


def read_shifts(path):
    """rows of -search_shifts_out: (delta, exported or None, action)"""
    rows, cols = [], None
    for l in open(path):
        if l.startswith("#") or not l.strip(): continue
        f = l.rstrip("\n").split("\t")
        if cols is None: cols = f; continue
        r = dict(zip(cols, f))
        try: ex = float(r["exported"])
        except ValueError: ex = None
        rows.append((float(r["delta"]), ex, r["action"]))
    return rows


def detect(c, rows):
    hit = [r for r in rows if abs(r[0] - c) <= TOL or (r[1] is not None and abs(r[1] - c) <= TOL)]
    return bool(hit), any(r[2] in ("variable", "offset") for r in hit)


def cell_calls(psm_b, psm_c, fdp_b, fdp_c, n_adm, rec):
    need = math.ceil(0.6 * n_adm)
    return dict(P1="pass" if psm_b and psm_c >= 1.02 * psm_b else "fail",
                P2="pass" if fdp_c <= fdp_b + 0.003 and fdp_c <= 0.020 else "fail",
                P3="pass" if psm_c >= 0.99 * psm_b else "fail",
                P4="na" if n_adm < 3 else ("pass" if rec >= need else "fail"),
                p4_need=need if n_adm >= 3 else "-")


def engine_verdict(C):
    """C: cells of one engine with P1..P4 calls -> (counts, criteria, verdict)"""
    n = len(C)
    p = {k: sum(c[k] == "pass" for c in C) for k in ("P1", "P2", "P3", "P4")}
    ev = sum(c["P4"] != "na" for c in C)
    if n < 3:
        r = dict.fromkeys(("P1", "P2", "P3", "P4"), "INCONCLUSIVE")
    else:
        r = dict(P1="PASS" if p["P1"] >= 3 else "FAIL", P2="PASS" if p["P2"] == n else "FAIL",
                 P3="PASS" if p["P3"] == n else "FAIL",
                 P4="PASS" if p["P4"] >= 3 else ("INCONCLUSIVE" if ev < 3 else "FAIL"))
    v = "FAIL" if "FAIL" in r.values() else ("INCONCLUSIVE" if "INCONCLUSIVE" in r.values() else "PASS")
    return n, p, ev, r, v


def item_verdict(V):
    return "PASS" if len(V) == 2 and all(v == "PASS" for v in V.values()) else (
        "FAIL" if "FAIL" in V.values() else "INCONCLUSIVE")


def selftest():
    s17.selftest()
    T = [15.994915, 79.966331, -17.026549]
    assert not admissible(1.0049, "comet", T) and not admissible(-1.003, "comet", T)       # isotope k = 1, -1
    assert not admissible(3.012, "comet", T) and admissible(4.013, "comet", T)             # k = 3 out, k = 4 in
    assert admissible(-17.027, "comet", T) and not admissible(-17.027, "sage", T)          # negative: Comet only
    assert admissible(79.97, "sage", T) and not admissible(17.027, "sage", T)              # table mass only
    assert detect(80.0, [(79.9738, 79.9663, "dropped_cap")]) == (False, False)
    assert detect(79.97, [(79.9738, 79.9663, "dropped_cap")]) == (True, False)
    assert detect(79.97, [(79.9738, 79.9663, "variable")]) == (True, True)
    c = cell_calls(1000, 1020, 0.010, 0.013, 5, 3)
    assert (c["P1"], c["P2"], c["P3"], c["P4"], c["p4_need"]) == ("pass", "pass", "pass", "pass", 3), c
    c = cell_calls(1000, 1019, 0.010, 0.0131, 5, 2)
    assert (c["P1"], c["P2"], c["P3"], c["P4"]) == ("fail", "fail", "pass", "fail"), c
    assert cell_calls(1000, 989, 0.019, 0.0201, 2, 2)["P2"] == "fail"                      # absolute limit 2.0 %
    c = cell_calls(1000, 989, 0.0, 0.0, 2, 2)
    assert (c["P3"], c["P4"]) == ("fail", "na"), c
    ok = dict(P1="pass", P2="pass", P3="pass", P4="pass")
    mk = lambda **k: dict(ok, **k)
    assert engine_verdict([ok] * 4)[4] == "PASS"
    assert engine_verdict([ok] * 3 + [mk(P1="fail", P4="fail")])[4] == "PASS"              # 3 of 4
    assert engine_verdict([ok] * 2 + [mk(P1="fail")] * 2)[4] == "FAIL"
    assert engine_verdict([ok] * 3 + [mk(P2="fail")])[4] == "FAIL"                         # every run
    assert engine_verdict([ok] * 3 + [mk(P3="fail")])[4] == "FAIL"
    assert engine_verdict([ok] * 2 + [mk(P4="fail")] * 2)[3]["P4"] == "FAIL"
    assert engine_verdict([ok] * 2 + [mk(P4="na")] * 2)[4] == "INCONCLUSIVE"               # < 3 evaluable
    assert engine_verdict([ok] * 2 + [mk(P4="na"), mk(P4="fail")])[3]["P4"] == "FAIL"      # 3 evaluable, 2 pass
    assert engine_verdict([ok] * 3)[4] == "PASS" and engine_verdict([ok] * 2)[4] == "INCONCLUSIVE"
    assert engine_verdict([ok] * 2 + [mk(P1="fail")])[4] == "FAIL"                         # 3 runs: all 3 needed
    assert item_verdict(dict(comet="PASS", sage="PASS")) == "PASS"
    assert item_verdict(dict(comet="PASS", sage="FAIL")) == "FAIL"
    assert item_verdict(dict(comet="PASS", sage="INCONCLUSIVE")) == "INCONCLUSIVE"
    assert item_verdict(dict(comet="PASS")) == "INCONCLUSIVE"
    print("selftest 17r OK")


def main():
    if sys.argv[1:] == ["--selftest"]:
        return selftest()
    out, table = sys.argv[1], read_table(sys.argv[2])
    os.makedirs(out, exist_ok=True)
    S = []
    for p in sys.argv[3:]:
        S += list(csv.DictReader(open(p), delimiter="\t"))
    by = {(s["run"], s["engine"], s["arm"]): s for s in S}
    open_cache, cells, peakrows = {}, [], []
    for (run, eng, arm), s in sorted(by.items()):
        if arm != "cand": continue
        b = by[(run, eng, "base")]
        res = {}
        for a, x in (("base", b), ("cand", s)):
            ps = s17.sage(x["result"]) if eng == "sage" else s17.comet(x["result"])
            T = sum(1 for p in ps if p[3] == "t"); E = sum(1 for p in ps if p[3] == "e")
            n = T + E
            res[a] = dict(T=T, E=E, fdp=2 * E / n if n else 0.0, ub=2 * s17.cp_upper(E, n) if n else 1.0,
                          pep=len({p[1] for p in ps if p[3] == "t"}), scans={p[0] for p in ps if p[3] == "t"})
        if s["open"] not in open_cache:
            open_cache[s["open"]] = s17.peaks(s17.msfragger(s["open"]))
        P = open_cache[s["open"]]
        M = s17.new_masses(eng, b["config"], s["config"])
        rows = read_shifts(s["shifts"])
        n_adm = rec = det = exp = rec_all = 0
        for i, (n, c) in enumerate(P, 1):
            hit = [m for m in M if abs(c - m) <= TOL]
            adm = admissible(c, eng, table)
            d, e = detect(c, rows)
            rec_all += bool(hit)
            if adm: n_adm += 1; rec += bool(hit); det += d; exp += e
            peakrows.append([run, eng, i, f"{c:.4f}", n, "yes" if adm else "no", "yes" if hit else "no",
                             ",".join(f"{m:.4f}" for m in hit) or "-", "yes" if d else "no", "yes" if e else "no"])
        Bc, Cc = res["base"], res["cand"]
        lost = len(Bc["scans"] - Cc["scans"]) / len(Bc["scans"]) if Bc["scans"] else 0.0
        cell = dict(run=run, engine=eng, psm_base=Bc["T"], psm_cand=Cc["T"],
                    gain=Cc["T"] / Bc["T"] - 1 if Bc["T"] else float("nan"),
                    pep_base=Bc["pep"], pep_cand=Cc["pep"],
                    pep_gain=Cc["pep"] / Bc["pep"] - 1 if Bc["pep"] else float("nan"),
                    ent_base=Bc["E"], ent_cand=Cc["E"], fdp_base=Bc["fdp"], fdp_cand=Cc["fdp"],
                    fdp_ub_cand=Cc["ub"], base_scans_lost=lost, new_masses=len(M), open_peaks=len(P),
                    recovered_top10=rec_all, admissible=n_adm, recovered=rec, detected=det, exported=exp,
                    gap_peaks=len(rows))
        cell.update(cell_calls(Bc["T"], Cc["T"], Bc["fdp"], Cc["fdp"], n_adm, rec))
        cells.append(cell)
    cols = ["run", "engine", "psm_base", "psm_cand", "gain", "pep_base", "pep_cand", "pep_gain", "ent_base",
            "ent_cand", "fdp_base", "fdp_cand", "fdp_ub_cand", "base_scans_lost", "new_masses", "gap_peaks",
            "open_peaks", "recovered_top10", "admissible", "recovered", "p4_need", "detected", "exported",
            "P1", "P2", "P3", "P4"]
    fmt = lambda v: f"{v:.4f}" if isinstance(v, float) else str(v)
    with open(os.path.join(out, "cells.tsv"), "w") as o:
        o.write("\t".join(cols) + "\n")
        for c in cells: o.write("\t".join(fmt(c[k]) for k in cols) + "\n")
    with open(os.path.join(out, "peaks.tsv"), "w") as o:
        o.write("run\tengine\trank\tcentroid\tpsms\tadmissible\trecovered\tmatched_masses\tdetected\texported\n")
        for r in peakrows: o.write("\t".join(map(str, r)) + "\n")
    V = {}
    with open(os.path.join(out, "verdict.tsv"), "w") as o:
        o.write("engine\truns\tP1_pass\tP2_pass\tP3_pass\tP4_pass\tP4_evaluable\tP1\tP2\tP3\tP4\tverdict\n")
        for eng in sorted({c["engine"] for c in cells}):
            n, p, ev, r, v = engine_verdict([c for c in cells if c["engine"] == eng])
            V[eng] = v
            o.write("\t".join(map(str, [eng, n, p["P1"], p["P2"], p["P3"], p["P4"], ev,
                                        r["P1"], r["P2"], r["P3"], r["P4"], v])) + "\n")
        o.write(f"# item verdict\t{item_verdict(V)}\n")
    print(open(os.path.join(out, "verdict.tsv")).read())


if __name__ == "__main__":
    main()
