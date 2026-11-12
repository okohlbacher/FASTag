#!/usr/bin/env python3
"""Held-out test 5 of label discovery: keyword pool of the PRIDE v3 project search (metadata only; the dimethyl
fetcher of test 4 with the keywords as arguments).
Usage: fetch_kw_pool.py <cache dir> <name> <keyword> [<keyword> ...]  -> <cache>/search_<name>/kw<n>_<page>.json, <cache>/pool_<name>_kw.json"""
import sys, os, json, time, urllib.request, urllib.parse
cache, name, KW = sys.argv[1], sys.argv[2], sys.argv[3:]
sd = f"{cache}/search_{name}"; os.makedirs(sd, exist_ok=True)
API = "https://www.ebi.ac.uk/pride/ws/archive/v3/search/projects?keyword=%s&pageSize=100&page=%d"
pool = {}
for n, q in enumerate(KW):
    page = 0
    while True:
        f = "%s/kw%d_%04d.json" % (sd, n, page)
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
        if not rows or page >= 50: break
        for r in rows: pool[r["accession"]] = r
        page += 1
    print(q, page, len(pool), flush=True)
json.dump(pool, open(f"{cache}/pool_{name}_kw.json", "w"))
