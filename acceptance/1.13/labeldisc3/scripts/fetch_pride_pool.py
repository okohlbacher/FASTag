#!/usr/bin/env python3
"""Held-out test 3 of label discovery: fetch the PRIDE project pool (metadata only).
Pages through the PRIDE v3 project search once per quantification-method value and caches every page.
Usage: fetch_pride_pool.py <cache dir> [query index]   (with an index: fetch only that query, for parallel fetching; writes <cache>/search/<n>_<page>.json and <cache>/pool.json)"""
import sys, os, json, time, urllib.request, urllib.parse
cache = sys.argv[1]; os.makedirs(cache + "/search", exist_ok=True)
QM = ["TMT", "iTRAQ", "SILAC", "Dimethyl Labeling", "Label free", "MS1 intensity based label-free quantification method",
      "label-free quantification", "label free sample"]
API = "https://www.ebi.ac.uk/pride/ws/archive/v3/search/projects?keyword=&filter=quantificationMethods==%s&pageSize=100&page=%d"
pool = {}
only = int(sys.argv[2]) if len(sys.argv) > 2 else None
for n, q in enumerate(QM):
    if only is not None and n != only: continue
    page = 0
    while True:
        f = "%s/search/%d_%04d.json" % (cache, n, page)
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
if only is None: json.dump(pool, open(cache + "/pool.json", "w"))
