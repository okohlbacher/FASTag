import csv, re, sys
S = re.compile(r"scan=(\d+)")
k = lambda s: "scan=" + S.search(s).group(1) if S.search(s) else s
def truth(p):
    t = {}
    for r in csv.DictReader(open(p), delimiter="\t"):
        if r["label"] == "1" and float(r["spectrum_q"]) <= 0.01: t.setdefault(k(r["scannr"]), int(r["charge"]))
    return t
def load(hc, tr, pert=None):
    t = truth(tr); orig = {}
    if pert:
        for r in csv.DictReader(open(pert), delimiter="\t"): orig[r["key"]] = int(r["header_original"])
    rows = []
    for r in csv.DictReader(open(hc), delimiter="\t"):
        kk = k(r["native_id"])
        if kk not in t: continue
        h = int(r["header_charge"]); tt = t[kk]
        if pert:
            o = orig.get(kk, h)
            if o != tt: continue
            tt = o
        if not 1 <= h <= 4: continue
        rows.append(dict(h=h, t=tt, call=int(r["call_charge"]), src=r["call_src"], basis=r["basis"], he=float(r["header_excess"]), ce=float(r["call_excess"]), ro=r["header_ruled_out"] == "1", pa=int(r["header_peaks_above"])))
    return rows
def dis(r, m, kmin):
    if r["src"] != "inferred" or r["call"] == r["h"]: return False
    ra = r["ro"] and r["pa"] >= kmin
    if r["basis"] == "complement": return ra or (r["ce"] > 0 and r["ce"] - r["he"] >= m)
    if r["basis"] == "range": return ra
    return r["basis"] == "one_plus"
sets = [s.split(",") for s in sys.argv[1:]]
data = [(s[0].split("/")[0] + "/" + s[0].split("/")[1], load(*s)) for s in sets]
for kmin in (1, 2, 3, 5, 8, 999):
    for m in (3, 4, 5, 6, 8):
        out = []
        for name, rows in data:
            n = len(rows); w = sum(r["h"] != r["t"] for r in rows)
            f = [r for r in rows if dis(r, m, kmin)]
            tp = sum(r["h"] != r["t"] for r in f); fix = sum(r["h"] != r["t"] and r["call"] == r["t"] for r in f); fp = len(f) - tp
            out.append(f"{name}: fl {len(f):4d} tp {tp:4d} fp {fp:3d} FA {fp/max(1,n-w):.4f} net {1000*(fix-fp)/n:7.2f}")
        print(f"k={kmin:3d} m={m}  " + " | ".join(out))
