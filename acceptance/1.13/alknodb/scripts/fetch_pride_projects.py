#!/usr/bin/env python3
"""Fetch the PRIDE v3 project record of every accession of the draw order into a cache dir (8 parallel requests).
Usage: fetch_pride_projects.py <draw_order.tsv> <cache dir>"""
import json, os, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor

API = "https://www.ebi.ac.uk/pride/ws/archive/v3/projects/"
accs = [l.split("\t")[1].strip() for l in open(sys.argv[1])][1:]
C = sys.argv[2]
os.makedirs(C, exist_ok=True)


def get(a):
    f = f"{C}/{a}.project.json"
    if os.path.exists(f) and os.path.getsize(f) > 0:
        return "have"
    for t in range(6):
        try:
            with urllib.request.urlopen(API + a, timeout=120) as r:
                d = r.read()
            json.loads(d)
            with open(f + ".tmp", "wb") as o:
                o.write(d)
            os.replace(f + ".tmp", f)
            return "ok"
        except Exception as e:  # noqa
            err = str(e)
            time.sleep(3 * (t + 1))
    with open(f"{C}/FAILED.txt", "a") as o:
        o.write(f"{a}\t{err}\n")
    return "fail"


with ThreadPoolExecutor(8) as ex:
    res = list(ex.map(get, accs))
print({k: res.count(k) for k in set(res)}, flush=True)
print("FETCH_DONE", flush=True)
