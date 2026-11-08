#!/usr/bin/env python3
"""Cache the PRIDE Archive v3 file list (and project record) of each accession: <cache>/<PXD>.files.json,
<cache>/<PXD>.project.json. Read-only queries; existing cache files are kept.
Usage: pride_files.py <cache dir> PXD... """
import json, os, sys, time, urllib.request

API = "https://www.ebi.ac.uk/pride/ws/archive/v3"

def get(url, tries=4):
    for a in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                return json.load(r)
        except Exception as e:
            err = e; time.sleep(5 * (a + 1))
    raise err

cache = sys.argv[1]; os.makedirs(cache, exist_ok=True)
for acc in sys.argv[2:]:
    for kind, url in (("files", f"{API}/projects/{acc}/files/all"), ("project", f"{API}/projects/{acc}")):
        p = f"{cache}/{acc}.{kind}.json"
        if os.path.exists(p) and os.path.getsize(p) > 2:
            continue
        try:
            d = get(url)
            with open(p + ".tmp", "w") as f: json.dump(d, f)
            os.rename(p + ".tmp", p)
            print(acc, kind, "ok", len(d) if isinstance(d, list) else "")
        except Exception as e:
            print(acc, kind, "FAIL", e)
