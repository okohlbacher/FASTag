#!/usr/bin/env python3
"""fetch_records.py <pool.tsv> <outdir> [files]: PRIDE v3 project records (and file lists with 'files'); metadata only."""
import json, os, sys, time, urllib.request, urllib.error
def get(u):
    err = None
    for t in range(5):
        try: return urllib.request.urlopen(u, timeout=120).read()
        except urllib.error.HTTPError as e:
            if e.code == 404: return b"[]"
            err = e; time.sleep(5)
        except Exception as e: err = e; time.sleep(5)
    raise SystemExit(f"failed {u}: {err}")
os.makedirs(sys.argv[2], exist_ok=True)
files = len(sys.argv) > 3
for a in [l.split("\t")[0] for l in open(sys.argv[1]).read().splitlines()[1:]]:
    f = f"{sys.argv[2]}/{a}.project.json"
    if not os.path.exists(f): open(f, "wb").write(get(f"https://www.ebi.ac.uk/pride/ws/archive/v3/projects/{a}")); time.sleep(0.2)
    f = f"{sys.argv[2]}/{a}.files.json"
    if files and not os.path.exists(f):
        out, p = [], 0
        while True:
            d = json.loads(get(f"https://www.ebi.ac.uk/pride/ws/archive/v3/projects/{a}/files?pageSize=100&page={p}")); out += d
            if len(d) < 100: break
            p += 1; time.sleep(0.2)
        json.dump(out, open(f, "w"))
print("FETCH_DONE")
