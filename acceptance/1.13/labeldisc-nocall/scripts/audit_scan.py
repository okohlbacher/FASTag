#!/usr/bin/env python3
"""Held-out test 3 truth audit scan (explore/repscan.py plus the MS2 isolation width and the MS1 analyzer; no FASTag).
Reporter-ion / acquisition scan of an mzML (pure stdlib). Usage: audit_scan.py <id> <mzML> <out.json> [stride]
Per MS level >= 2: analyzer (FTMS/ITMS from the Thermo filter string, else 'other'), activation, lowest m/z, and
for each isobaric reporter set the spectra with >= k channels above 1 % of the base peak, at the true m/z and at
decoy m/z (each channel +0.0170 and -0.0170 Da for FT; +-0.5 for IT is meaningless, IT spectra use 0.3 Da and no decoy)."""
import sys, re, base64, zlib, struct, json, bisect, collections
ident, path, out = sys.argv[1:4]
stride = int(sys.argv[4]) if len(sys.argv) > 4 else 4
SETS = {
 "TMT": [126.127726,127.124761,127.131081,128.128116,128.134436,129.131471,129.137790,130.134825,130.141145,131.138180,131.144500],
 "TMTproX": [132.141535,132.147855,133.144890,133.151210,134.148245,134.154565,135.151600],
 "iTRAQ4": [114.110680,115.107715,116.111069,117.114424],
 "iTRAQ8X": [113.107325,118.111459,119.114814,121.121524],
}
DEC = 0.0170
acc_re = re.compile(rb'accession="(MS:\d+)"(?:[^>]*?value="([^"]*)")?')
val_re = re.compile(rb'value="([^"]*)"')
res = collections.defaultdict(lambda: dict(n=0, dec=0, minmz=[], hits=collections.Counter(), dhits=collections.Counter(), chan=collections.Counter(), relint=collections.defaultdict(list)))
levels = collections.Counter(); ms1an = collections.Counter(); isow = []
state = None; nseen = collections.Counter(); undec = 0
def decode(b64, prec, comp):
    raw = base64.b64decode(b64)
    if comp: raw = zlib.decompress(raw)
    n = len(raw) // prec
    return struct.unpack("<%d%s" % (n, "d" if prec == 8 else "f"), raw[:n * prec])
def count(mz, it, masses, tol, thr):
    k = 0; s = 0.0; ch = []
    for i, m in enumerate(masses):
        lo = bisect.bisect_left(mz, m - tol); hi = bisect.bisect_right(mz, m + tol)
        if hi > lo:
            mx = max(it[lo:hi])
            if mx >= thr: k += 1; s += mx; ch.append(i)
    return k, s, ch
with open(path, "rb") as fh:
    for line in fh:
        if b"<spectrum " in line:
            state = dict(ms=0, filt=b"", act=set(), arr=None, mz=None, it=None, prec=8, comp=False, kind=None, numpress=False, lowlim=None, iso=0.0)
            continue
        if state is None: continue
        if b"<cvParam" in line:
            m = acc_re.search(line)
            if not m: continue
            a = m.group(1); v = m.group(2)
            if a == b"MS:1000511": state["ms"] = int(v)
            elif a == b"MS:1000512": state["filt"] = v or b""
            elif a == b"MS:1000501": state["lowlim"] = float(v)
            elif a in (b"MS:1000828", b"MS:1000829"): state["iso"] += float(v or 0)
            elif a in (b"MS:1000422", b"MS:1002481"): state["act"].add("HCD")
            elif a in (b"MS:1000133", b"MS:1002472"): state["act"].add("CID")
            elif a in (b"MS:1000598", b"MS:1000250"): state["act"].add("ETD")
            elif a == b"MS:1000523": state["prec"] = 8
            elif a == b"MS:1000521": state["prec"] = 4
            elif a == b"MS:1000574": state["comp"] = True
            elif a == b"MS:1000576": state["comp"] = False
            elif a in (b"MS:1002312", b"MS:1002313", b"MS:1002314", b"MS:1002746", b"MS:1002747", b"MS:1002748"): state["numpress"] = True
            elif a == b"MS:1000514": state["kind"] = "mz"
            elif a == b"MS:1000515": state["kind"] = "it"
        elif b"<binaryDataArray " in line:
            state["kind"] = None; state["comp"] = False; state["numpress"] = False
        elif b"<binary>" in line:
            if state["ms"] >= 2 and state["kind"] and (nseen[state["ms"]] % stride == 0):
                if state["numpress"]: undec += 1
                else:
                    i = line.find(b"<binary>") + 8; j = line.rfind(b"</binary>")
                    try: state[state["kind"]] = decode(line[i:j], state["prec"], state["comp"])
                    except Exception: undec += 1
        elif b"</spectrum>" in line:
            ms = state["ms"]; levels[ms] += 1
            if ms == 1: ms1an["FTMS" if state["filt"].startswith(b"FTMS") else "ITMS" if state["filt"].startswith(b"ITMS") else "other"] += 1
            if ms == 2 and len(isow) < 20000: isow.append(round(state["iso"], 2))
            if ms >= 2:
                take = nseen[ms] % stride == 0; nseen[ms] += 1
                f = state["filt"]
                an = "FTMS" if f.startswith(b"FTMS") else "ITMS" if f.startswith(b"ITMS") else "other"
                key = "ms%d|%s|%s" % (ms, an, "+".join(sorted(state["act"])) or "-")
                r = res[key]; r["n"] += 1
                if take and state["mz"] is not None and state["it"] is not None and len(state["mz"]) == len(state["it"]) and len(state["mz"]) > 0:
                    mz, it = state["mz"], state["it"]
                    if any(mz[i] > mz[i + 1] for i in range(min(len(mz) - 1, 50))):
                        o = sorted(range(len(mz)), key=mz.__getitem__); mz = [mz[i] for i in o]; it = [it[i] for i in o]
                    r["dec"] += 1; r["minmz"].append(round(mz[0], 1))
                    bp = max(it); thr = 0.01 * bp
                    tol = 0.3 if an == "ITMS" else 0.003
                    for name, masses in SETS.items():
                        k, s, ch = count(mz, it, masses, tol, thr)
                        r["hits"][name + ":" + str(min(k, 4))] += 1
                        for c in ch: r["chan"][name + ":" + str(c)] += 1
                        if k: r["relint"][name].append(round(s / bp, 3))
                        if an != "ITMS":
                            for sign in (1, -1):
                                k2, _, _ = count(mz, it, [m + sign * DEC for m in masses], tol, thr)
                                r["dhits"][name + ":" + str(min(k2, 4))] += 1
            state = None
o = {"id": ident, "path": path, "levels": dict(levels), "undecodable": undec, "stride": stride, "groups": {}, "ms1_analyzer": dict(ms1an),
     "ms2_isolation_width_median": (sorted(isow)[len(isow) // 2] if isow else None)}
for k, r in res.items():
    mm = sorted(r["minmz"])
    q = lambda p: mm[int(p * (len(mm) - 1))] if mm else None
    o["groups"][k] = dict(n=r["n"], decoded=r["dec"], minmz_q10=q(.1), minmz_q50=q(.5), minmz_q90=q(.9), hits=dict(r["hits"]), decoy_hits=dict(r["dhits"]), chan=dict(r["chan"]),
                          relint_median={n: sorted(v)[len(v) // 2] for n, v in r["relint"].items()})
json.dump(o, open(out, "w"), indent=1, sort_keys=True)
