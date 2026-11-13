#!/usr/bin/env python3
"""PRIDE v3 keyword search, all pages, metadata only. fetch_search.py <outdir>"""
import json, os, sys, time, urllib.request, urllib.parse
out = sys.argv[1]
KW = ("Asp-N", "AspN", "Asp N", "endoproteinase Asp-N", "endoproteinase AspN", "Asp-N digestion", "AspN digestion",
      "peptidyl-Asp metalloendopeptidase", "aspartate N", "Asp-N protease")
for kw in KW:
    p = 0
    while True:
        f = f"{out}/{kw.replace(' ', '_')}.{p}.json"
        if not os.path.exists(f):
            u = "https://www.ebi.ac.uk/pride/ws/archive/v3/search/projects?" + urllib.parse.urlencode(dict(keyword=kw, pageSize=100, page=p))
            d = None
            for t in range(4):
                try:
                    d = urllib.request.urlopen(u, timeout=120).read(); json.loads(d); break
                except Exception as e:
                    d = None; time.sleep(5)
            if d is None: sys.exit(f"failed {u}")
            open(f, "wb").write(d); time.sleep(0.3)
        n = len(json.load(open(f)))
        print(kw, p, n, flush=True)
        if n < 100 or p >= 40: break
        p += 1
print("SEARCH_DONE")
