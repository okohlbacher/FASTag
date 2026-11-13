#!/usr/bin/env python3
"""acqcheck3 scorer and verdict (frozen with PREREG-acqcheck3.md).

usage: score.py <audited.tsv> <decide.tsv> <probe.tsv> <units.tsv> <summary.txt>
       score.py --selftest

audited.tsv (freeze 2): header row; columns used: id, stratum, route, staged, truth, kind, per, recur, astral.
decide.tsv: id, how, rc, n_sentinel, check line (decide.sh). probe.tsv: id, rc, mode, refuse, why (reported only).

Unit: a staged file (staged == yes) with truth DIA or NONDIA.
refused  = the default run exited (how == exited) with code 11 and printed FASTAG_REFUSED reason=raw_dia.
           Anything else, including a missing decide line, is not refused.
vendor   = timstof (route bruker), sciex (route sciex), astral (route thermo, astral >= 0.5), orbitrap (other thermo).
closed   = truth DIA, route thermo or sciex, per < 0.5 (no single cycle through all windows).
recurring/targeted = truth NONDIA and (kind starts with "targeted" or recur >= 0.5).

Rows (criterion; minimum n):
  K1  NONDIA refused == 0                      n >= 50   (one-sided exact 95 % upper bound reported)
  K2  DIA refused share >= 0.90                n >= 40
  K3  per vendor v in astral, timstof, sciex:
      K3v-DIA  refused share >= 0.90           n >= 8
      K3v-NON  refused == 0                    n >= 8
  K4  closed-window DIA refused share >= 0.90  n >= 5
  K5  recurring/targeted NONDIA refused == 0   n >= 10
Row verdict: FAIL if the criterion is violated and either n >= minimum or the row is a zero-refusal row
(one refusal violates it at any n); PASS if it holds with n >= minimum; INCONCLUSIVE otherwise.
Overall: FAIL if any row is FAIL; PASS if K1, K2 and all six K3 rows are PASS (K4 and K5 then reported with
their own verdicts); INCONCLUSIVE otherwise.
"""
import sys

MIN = {"K1": 50, "K2": 40, "K3-DIA": 8, "K3-NON": 8, "K4": 5, "K5": 10}

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

def vendor(r):
    if r["route"] == "bruker": return "timstof"
    if r["route"] == "sciex": return "sciex"
    return "astral" if fl(r.get("astral")) >= 0.5 else "orbitrap"

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
        if r.get("staged") != "yes" or r.get("truth") not in ("DIA", "NONDIA"): continue
        x = d.get(r["id"])
        refused = bool(x) and x[1] == "exited" and x[2] == "11" and int(x[3] or 0) >= 1
        u = dict(r)
        u.update(vendor=vendor(r), refused=refused, how=x[1] if x else "NO_RUN", rc=x[2] if x else "NA",
                 check=x[4] if x and len(x) > 4 else "NA",
                 probe_refuse=p[r["id"]][3] if r["id"] in p else "NA", probe_mode=p[r["id"]][2] if r["id"] in p else "NA")
        u["closed"] = r["truth"] == "DIA" and r["route"] in ("thermo", "sciex") and fl(r.get("per")) < 0.5
        u["recurring"] = r["truth"] == "NONDIA" and (r.get("kind", "").startswith("targeted") or fl(r.get("recur")) >= 0.5)
        units.append(u)
    dia = [u for u in units if u["truth"] == "DIA"]
    non = [u for u in units if u["truth"] == "NONDIA"]
    rows = [row("K1 refused among NONDIA", non, "zero", MIN["K1"]),
            row("K2 refused among DIA", dia, "share", MIN["K2"])]
    for v in ("astral", "timstof", "sciex"):
        rows.append(row("K3 %s DIA" % v, [u for u in dia if u["vendor"] == v], "share", MIN["K3-DIA"]))
        rows.append(row("K3 %s NONDIA" % v, [u for u in non if u["vendor"] == v], "zero", MIN["K3-NON"]))
    rows.append(row("K4 closed-window DIA", [u for u in dia if u["closed"]], "share", MIN["K4"]))
    rows.append(row("K5 recurring/targeted NONDIA", [u for u in non if u["recurring"]], "zero", MIN["K5"]))
    gate = [r for r in rows if r[0].startswith(("K1", "K2", "K3"))]
    if any(r[5] == "FAIL" for r in rows): overall = "FAIL"
    elif all(r[5] == "PASS" for r in gate): overall = "PASS"
    else: overall = "INCONCLUSIVE"
    return units, rows, overall

def write(units, rows, overall, aud, ufile, sfile):
    cols = ["id", "stratum", "vendor", "truth", "kind", "refused", "how", "rc", "probe_mode", "probe_refuse", "closed",
            "recurring", "per", "recur", "check"]
    with open(ufile, "w") as o:
        o.write("\t".join(cols) + "\n")
        for u in sorted(units, key=lambda u: u["id"]): o.write("\t".join(str(u.get(c, "NA")) for c in cols) + "\n")
    L = ["OVERALL\t" + overall]
    for r in rows: L.append("%s\t%s\tn=%d\tmin=%d\t%s" % (r[5], r[0], r[1], r[4], r[3]))
    excl = [r for r in aud if not (r.get("staged") == "yes" and r.get("truth") in ("DIA", "NONDIA"))]
    L.append("#excluded\t%d (not staged or truth UNCLEAR): %s" % (len(excl), " ".join(
        "%s(%s,%s)" % (r["id"], r.get("staged"), r.get("truth")) for r in excl)))
    by = {}
    for u in units:
        k = (u["truth"], u["vendor"], u["stratum"]); a = by.setdefault(k, [0, 0]); a[0] += 1; a[1] += u["refused"]
    for k in sorted(by): L.append("#by_truth_vendor_stratum\t%s\t%s\t%s\tn=%d\trefused=%d" % (k + tuple(by[k])))
    disc = [u["id"] for u in units if (u["probe_refuse"] == "true") != u["refused"]]
    L.append("#probe_vs_run_discordant\t%d\t%s" % (len(disc), " ".join(disc)))
    L.append("#run_not_exited_or_no_check\t" + " ".join("%s:%s" % (u["id"], u["how"]) for u in units
                                                        if u["how"] not in ("exited", "stopped_after_check")))
    open(sfile, "w").write("\n".join(L) + "\n")
    print("\n".join(L[:12]))

def selftest():
    def a(i, st, route, truth, kind="x", per="1", recur="0", astral="0", staged="yes"):
        return dict(id=i, stratum=st, route=route, staged=staged, truth=truth, kind=kind, per=per, recur=recur, astral=astral)
    aud, dec = [], []
    n = 0
    for v, route, ast in (("astral", "thermo", "1"), ("timstof", "bruker", "0"), ("sciex", "sciex", "0")):
        for j in range(15):
            n += 1; i = "D%d" % n; aud.append(a(i, "DIA_" + v, route, "DIA", per="0.2" if j < 2 and route != "bruker" else "1", astral=ast))
            dec.append([i, "exited", "11", "1", "Acquisition check: DIA"])
        for j in range(20):
            n += 1; i = "N%d" % n; aud.append(a(i, "DDA_" + v, route, "NONDIA", kind="targeted" if j < 4 else "dependent", astral=ast))
            dec.append([i, "stopped_after_check", "143", "0", "Acquisition check: DDA"])
    aud.append(a("U1", "PRM", "thermo", "UNCLEAR")); aud.append(a("S1", "PRM", "thermo", "NONDIA", staged="no"))
    u, rows, ov = score(aud, dec, [])
    assert ov == "PASS", (ov, rows)
    assert len(u) == 105 and rows[0][1] == 60 and rows[1][1] == 45
    assert [r for r in rows if r[0].startswith("K4")][0][1] == 4 and [r for r in rows if r[0].startswith("K4")][0][5] == "INCONCLUSIVE"
    assert [r for r in rows if r[0].startswith("K5")][0][5] == "PASS"
    dec2 = [list(x) for x in dec]; dec2[20] = [dec2[20][0], "exited", "11", "1", "x"]   # one NONDIA refused
    assert score(aud, dec2, [])[2] == "FAIL"
    dec3 = [x for x in dec if x[0] not in ("D1", "D2")]                                  # 2 astral DIA misses (13/15)
    u3, r3, o3 = score(aud, dec3, [])
    assert o3 == "FAIL" and [r for r in r3 if r[0] == "K3 astral DIA"][0][5] == "FAIL"
    dec4 = [x if x[0] != "D1" else [x[0], "exited", "0", "0", "x"] for x in dec]        # 1 miss: 14/15 = 93 %
    assert score(aud, dec4, [])[2] == "PASS"
    dec5 = [x if x[0] != "D1" else [x[0], "exited", "11", "0", "x"] for x in dec]       # rc 11 without sentinel
    assert [r for r in score(aud, dec5, [])[1] if r[0] == "K3 astral DIA"][0][2] == 14
    aud6 = [r for r in aud if not (r["stratum"] == "DIA_sciex" and int(r["id"][1:]) > 77)]
    assert score(aud6, dec, [])[2] == "INCONCLUSIVE"                                    # sciex DIA n < 8
    print("score selftest ok")

if __name__ == "__main__":
    if sys.argv[1] == "--selftest": selftest(); sys.exit(0)
    A, D, P, U, S = sys.argv[1:6]
    aud = read(A)
    dec = read(D, header=False)
    probe = read(P, header=False) if P != "-" else []
    units, rows, overall = score(aud, dec, probe)
    write(units, rows, overall, aud, U, S)
