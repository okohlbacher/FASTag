#!/usr/bin/env python3
"""acqcheck4 scorer and verdict (frozen with PREREG-acqcheck4.md).

usage: score.py <audited.tsv> <decide.tsv> <probe.tsv> <units.tsv> <summary.txt>
       score.py --selftest

audited.tsv (freeze 2): header row; columns used: id, stratum, selected, staged, route, truth, kind, per, recur,
astral, model. decide.tsv: id, how, rc, n_sentinel, check line (decide.sh). probe.tsv: id, rc, mode, refuse, why
(reported only).

Unit: a row with selected == yes and staged == yes and truth DIA or NONDIA.
refused  = the default run exited (how == exited) with code 11 and printed FASTAG_REFUSED reason=raw_dia.
           Anything else, including a missing decide line, is not refused.
Astral DDA unit    truth NONDIA, kind dependent, route thermo, model names Astral, astral (ASTMS share) >= 0.5
closed-window DIA  truth DIA, route thermo, per < 0.5 (no single cycle through all windows)

Rows (criterion; minimum n), thresholds as acqcheck3:
  K1  NONDIA refused == 0                       n >= 50   (one-sided exact 95 % upper bound reported)
  K2  DIA refused share >= 0.90                 n >= 40
  K3  Astral DDA refused == 0                   n >= 8
  K4  closed-window DIA refused share >= 0.90   n >= 5
Row verdict: FAIL if the criterion is violated and either n >= minimum or the row is a zero-refusal row (one
refusal violates it at any n); PASS if it holds with n >= minimum; INCONCLUSIVE otherwise.
Overall: FAIL if any row is FAIL; PASS if all four rows are PASS; INCONCLUSIVE otherwise.
Reported only: Astral DIA, recurring/targeted NONDIA, probe concordance, counts by truth and stratum.
"""
import sys

MIN = {"K1": 50, "K2": 40, "K3": 8, "K4": 5}

def upper0(n):
    return 1.0 - 0.05 ** (1.0 / n) if n else 1.0

def read(path, header=True):
    rows = [l.rstrip("\n").split("\t") for l in open(path) if l.strip() and not l.startswith("#")]
    if not header: return rows
    h = rows[0]
    return [dict(zip(h, r)) for r in rows[1:]]

def fl(x):
    try: return float(x)
    except (TypeError, ValueError): return float("nan")

def is_astral(r):
    return r.get("route") == "thermo" and "astral" in (r.get("model") or "").lower() and fl(r.get("astral")) >= 0.5

def row(name, units, kind, minimum):
    n = len(units); k = sum(1 for u in units if u["refused"])
    if kind == "zero":
        ok = k == 0
        v = "FAIL" if not ok else ("PASS" if n >= minimum else "INCONCLUSIVE")
        stat = "%d of %d refused (upper 95%% bound %.1f%%)" % (k, n, 100 * upper0(n)) if k == 0 else "%d of %d refused" % (k, n)
    else:
        share = k / float(n) if n else float("nan")
        ok = n > 0 and share >= 0.90
        v = "PASS" if ok and n >= minimum else ("FAIL" if (not ok and n >= minimum) else "INCONCLUSIVE")
        stat = "%d of %d refused (%.1f%%)" % (k, n, 100 * share) if n else "0 of 0"
    return (name, n, k, stat, minimum, v)

def score(aud, dec, probe):
    d = {r[0]: r for r in dec}
    p = {r[0]: r for r in probe}
    units = []
    for r in aud:
        if r.get("selected") != "yes" or r.get("staged") != "yes" or r.get("truth") not in ("DIA", "NONDIA"): continue
        x = d.get(r["id"])
        refused = bool(x) and x[1] == "exited" and x[2] == "11" and int(x[3] or 0) >= 1
        u = dict(r)
        u.update(refused=refused, how=x[1] if x else "NO_RUN", rc=x[2] if x else "NA",
                 check=x[4] if x and len(x) > 4 else "NA",
                 probe_refuse=p[r["id"]][3] if r["id"] in p else "NA", probe_mode=p[r["id"]][2] if r["id"] in p else "NA")
        u["astral_unit"] = is_astral(r)
        u["astral_dda"] = r["truth"] == "NONDIA" and r.get("kind") == "dependent" and u["astral_unit"]
        u["closed"] = r["truth"] == "DIA" and r.get("route") == "thermo" and fl(r.get("per")) < 0.5
        u["recurring"] = r["truth"] == "NONDIA" and (r.get("kind", "").startswith("targeted") or fl(r.get("recur")) >= 0.5)
        units.append(u)
    dia = [u for u in units if u["truth"] == "DIA"]
    non = [u for u in units if u["truth"] == "NONDIA"]
    rows = [row("K1 refused among NONDIA", non, "zero", MIN["K1"]),
            row("K2 refused among DIA", dia, "share", MIN["K2"]),
            row("K3 Astral DDA", [u for u in non if u["astral_dda"]], "zero", MIN["K3"]),
            row("K4 closed-window DIA", [u for u in dia if u["closed"]], "share", MIN["K4"])]
    if any(r[5] == "FAIL" for r in rows): overall = "FAIL"
    elif all(r[5] == "PASS" for r in rows): overall = "PASS"
    else: overall = "INCONCLUSIVE"
    info = [row("(report) Astral DIA", [u for u in dia if u["astral_unit"]], "share", 0),
            row("(report) recurring/targeted NONDIA", [u for u in non if u["recurring"]], "zero", 0)]
    return units, rows, overall, info

def write(units, rows, overall, info, aud, ufile, sfile):
    cols = ["id", "stratum", "truth", "kind", "model", "astral", "refused", "how", "rc", "probe_mode", "probe_refuse",
            "astral_dda", "closed", "recurring", "per", "recur", "check"]
    with open(ufile, "w") as o:
        o.write("\t".join(cols) + "\n")
        for u in sorted(units, key=lambda u: u["id"]): o.write("\t".join(str(u.get(c, "NA")) for c in cols) + "\n")
    L = ["OVERALL\t" + overall]
    for r in rows: L.append("%s\t%s\tn=%d\tmin=%d\t%s" % (r[5], r[0], r[1], r[4], r[3]))
    for r in info: L.append("#%s\tn=%d\t%s" % (r[0], r[1], r[3]))
    sel = [r for r in aud if r.get("selected") == "yes"]
    excl = [r for r in sel if not (r.get("staged") == "yes" and r.get("truth") in ("DIA", "NONDIA"))]
    L.append("#selected_not_unit\t%d (not staged or truth UNCLEAR): %s" % (len(excl), " ".join(
        "%s(%s,%s)" % (r["id"], r.get("staged"), r.get("truth")) for r in excl)))
    by = {}
    for u in units:
        k = (u["truth"], u["stratum"]); a = by.setdefault(k, [0, 0]); a[0] += 1; a[1] += u["refused"]
    for k in sorted(by): L.append("#by_truth_stratum\t%s\t%s\tn=%d\trefused=%d" % (k + tuple(by[k])))
    disc = [u["id"] for u in units if (u["probe_refuse"] == "true") != u["refused"]]
    L.append("#probe_vs_run_discordant\t%d\t%s" % (len(disc), " ".join(disc)))
    L.append("#run_not_exited_or_no_check\t" + " ".join("%s:%s" % (u["id"], u["how"]) for u in units
                                                        if u["how"] not in ("exited", "stopped_after_check")))
    open(sfile, "w").write("\n".join(L) + "\n")
    print("\n".join(L[:8]))

def selftest():
    def a(i, st, truth, kind="dependent", per="1", model="Orbitrap_Exploris_480", astral="0", sel="yes", staged="yes"):
        return dict(id=i, stratum=st, selected=sel, staged=staged, route="thermo", truth=truth, kind=kind, per=per,
                    recur="0", model=model, astral=astral)
    aud, dec = [], []
    for j in range(45):
        i = "D%d" % j; aud.append(a(i, "DIA_closed", "DIA", kind="tiling_nondependent", per="0.2" if j < 6 else "1"))
        dec.append([i, "exited", "11", "1", "Acquisition check: DIA"])
    for j in range(55):
        i = "N%d" % j
        aud.append(a(i, "DDA_astral" if j < 10 else "DDA_orbitrap", "NONDIA",
                     model="Orbitrap_Astral" if j < 10 else "Orbitrap_Exploris_480", astral="1" if j < 10 else "0"))
        dec.append([i, "stopped_after_check", "143", "0", "Acquisition check: DDA"])
    aud.append(a("U1", "PRM", "UNCLEAR")); aud.append(a("S1", "PRM", "NONDIA", staged="no"))
    aud.append(a("X1", "DDA_astral", "NONDIA", sel="no"))
    u, rows, ov, info = score(aud, dec, [])
    assert ov == "PASS", (ov, rows)
    assert len(u) == 100 and rows[0][1] == 55 and rows[1][1] == 45 and rows[2][1] == 10 and rows[3][1] == 6
    dec2 = [list(x) for x in dec]; dec2[45] = ["N0", "exited", "11", "1", "x"]          # one Astral DDA refused
    r2 = score(aud, dec2, [])
    assert r2[2] == "FAIL" and r2[1][2][5] == "FAIL" and r2[1][0][5] == "FAIL"
    aud3 = [dict(x, model="Orbitrap_Exploris_480") if x["id"] in ("N0", "N1", "N2") else x for x in aud]
    r3 = score(aud3, dec, [])                                                         # Astral DDA n = 7 < 8
    assert r3[2] == "INCONCLUSIVE" and r3[1][2][5] == "INCONCLUSIVE"
    dec4 = [x if x[0] not in ("D0", "D1") else [x[0], "exited", "0", "0", "x"] for x in dec]   # K4 4/6
    r4 = score(aud, dec4, [])
    assert r4[1][3][5] == "FAIL" and r4[1][1][5] == "PASS" and r4[2] == "FAIL"
    dec5 = [x if x[0] != "D10" else [x[0], "exited", "11", "0", "x"] for x in dec]     # rc 11 without sentinel
    assert score(aud, dec5, [])[1][1][2] == 44
    aud6 = [x for x in aud if not (x["id"].startswith("D") and int(x["id"][1:]) >= 39)]  # DIA n = 39 < 40
    assert score(aud6, dec, [])[2] == "INCONCLUSIVE"
    print("score selftest ok")

if __name__ == "__main__":
    if sys.argv[1] == "--selftest": selftest(); sys.exit(0)
    A, D, P, U, S = sys.argv[1:6]
    aud = read(A)
    dec = read(D, header=False)
    probe = read(P, header=False) if P != "-" else []
    units, rows, overall, info = score(aud, dec, probe)
    write(units, rows, overall, info, aud, U, S)
