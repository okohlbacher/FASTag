#!/usr/bin/env python3
"""PRIDE v3 project record and file list (metadata only). fetch_proj.py draw_order.tsv outdir"""
import json, os, sys, time, urllib.request, urllib.error
def get(u):
    for t in range(5):
        try: return urllib.request.urlopen(u, timeout=120).read()
        except urllib.error.HTTPError as e:
            if e.code == 404: return b"[]"   # record not in PRIDE Archive v3: not eligible
            err = e; time.sleep(5)
        except Exception as e: err = e; time.sleep(5)
    raise SystemExit(f"failed {u}: {err}")
os.makedirs(sys.argv[2], exist_ok=True)
for a in sorted({l.split("\t")[2] for l in open(sys.argv[1]).read().splitlines()[1:]}):
    f = f"{sys.argv[2]}/{a}.project.json"
    if not os.path.exists(f): open(f, "wb").write(get(f"https://www.ebi.ac.uk/pride/ws/archive/v3/projects/{a}")); time.sleep(0.3)
    f = f"{sys.argv[2]}/{a}.files.json"
    if not os.path.exists(f):
        out, p = [], 0
        while True:
            d = json.loads(get(f"https://www.ebi.ac.uk/pride/ws/archive/v3/projects/{a}/files?pageSize=100&page={p}")); out += d
            if len(d) < 100: break
            p += 1; time.sleep(0.3)
        json.dump(out, open(f, "w"))
print("PROJ_DONE")
