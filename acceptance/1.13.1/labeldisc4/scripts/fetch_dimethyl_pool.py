#!/usr/bin/env python3
"""Held-out test 4 of label discovery: widen the dimethyl stratum of the PRIDE pool (metadata only).
Keyword search of the PRIDE v3 project search without the quantification-method filter.
Usage: fetch_dimethyl_pool.py <cache dir>   -> <cache>/search/kw<n>_<page>.json, <cache>/pool_dimethyl_kw.json"""
import sys, os, json, time, urllib.request, urllib.parse
cache = sys.argv[1]; os.makedirs(cache + "/search", exist_ok=True)
KW = ["dimethyl labeling", "dimethyl labelling", "reductive dimethylation", "dimethyl", "dimethylation"]
API = "https://www.ebi.ac.uk/pride/ws/archive/v3/search/projects?keyword=%s&pageSize=100&page=%d"
pool = {}
for n, q in enumerate(KW):
    page = 0
    while True:
        f = "%s/search/kw%d_%04d.json" % (cache, n, page)
        if not os.path.exists(f):
            d = None
            for a in range(6):
                try:
                    d = urllib.request.urlopen(API % (urllib.parse.quote(q), page), timeout=120).read(); json.loads(d); break
                except Exception as e:
                    print("retry", q, page, e, file=sys.stderr); time.sleep(5 * (a + 1)); d = None
            if d is None: sys.exit("fetch failed %s page %d" % (q, page))
            open(f + ".part", "wb").write(d); os.rename(f + ".part", f)
        rows = json.load(open(f))
        if not rows: break
        for r in rows: pool[r["accession"]] = r
        page += 1
    print(q, page, len(pool), flush=True)
json.dump(pool, open(cache + "/pool_dimethyl_kw.json", "w"))
