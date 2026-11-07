#!/usr/bin/env python3
"""Check which complement rule reproduces DirecTag's ComplementaryPeakCount (S line) on spectra of a run:
FASTag 1.9.0 rule (partner at the same fragment charge z) or DirecTag source rule (partner at c - z).
usage: lt_dtcompl_check.py MZML DIRECTAG_TAGS TOL MAX_SPECTRA"""
import bisect, sys
from pyteomics import mzml
mzp, tagp, tol, nmax = sys.argv[1], sys.argv[2], float(sys.argv[3]), int(sys.argv[4])
P = 1.007276
dt = {}
with open(tagp) as fh:
    for line in fh:
        if line.startswith("S\t"):
            p = line.split("\t"); dt[p[1]] = (int(p[4]), float(p[5]), int(p[8]), int(p[15]))
def count(mz, M, c, rule):
    n = 0
    for m in mz:
        hit = False
        for z in range(1, max(1, c - 1) + 1):
            if rule == "same": t = M / z + 2 * P - m
            else:
                if c <= z: continue
                t = (M + c * P - m * z) / (c - z)
            i = bisect.bisect_left(mz, t - tol)
            if i < len(mz) and mz[i] <= t + tol and abs(mz[i] - m) > 1e-9: hit = True
        n += hit
    return n
res = {}
seen = 0
with mzml.read(mzp) as rd:
    for s in rd:
        if s.get("ms level") != 2 or s["id"] not in dt: continue
        c, M, comp, filt = dt[s["id"]]
        if c < 2: continue
        prec = s["precursorList"]["precursor"][0]["selectedIonList"]["selectedIon"][0]["selected ion m/z"]
        Mp = prec * c - c * P
        pk = sorted(zip(s["intensity array"], s["m/z array"]), key=lambda x: (-x[0], -x[1]))
        pk = [x for x in pk if x[1] <= Mp + P + 1.5][:100]
        mz = sorted(float(x[1]) for x in pk)
        if len(mz) != filt: continue
        for rule in ("same", "directag"):
            r = res.setdefault((c if c < 4 else 4, rule), [0, 0])
            r[0] += 1; r[1] += (count(mz, Mp, c, rule) == comp)
        seen += 1
        if seen >= nmax: break
for k in sorted(res): print(f"precursor charge {k[0]} rule {k[1]}: spectra {res[k][0]}, ComplementaryPeakCount reproduced {res[k][1]}")
