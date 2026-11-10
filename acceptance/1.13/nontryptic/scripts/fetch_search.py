#!/usr/bin/env python3
"""PRIDE v3 keyword search, all pages, metadata only. fetch_search.py <outdir>"""
import json, os, sys, time, urllib.request
out = sys.argv[1]
for kw in ("Glu-C", "GluC", "Asp-N", "AspN", "chymotrypsin", "Arg-C", "ArgC", "Lys-N", "LysN"):
    p = 0
    while True:
        f = f"{out}/{kw}.{p}.json"
        if not os.path.exists(f):
            u = f"https://www.ebi.ac.uk/pride/ws/archive/v3/search/projects?keyword={kw}&pageSize=100&page={p}"
            for t in range(4):
                try:
                    d = urllib.request.urlopen(u, timeout=120).read(); json.loads(d); break
                except Exception as e:
                    d = None; time.sleep(5)
            if d is None: sys.exit(f"failed {u}")
            open(f, "wb").write(d); time.sleep(0.5)
        n = len(json.load(open(f)))
        print(kw, p, n, flush=True)
        if n < 100 or p >= 30: break
        p += 1
print("SEARCH_DONE")
