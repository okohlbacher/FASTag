#!/usr/bin/env python3
"""E7-03 step 1: the PRIDE project catalog (v3 /projects, all pages) as JSON lines."""
import json, sys, urllib.request, concurrent.futures as cf, time
OUT = sys.argv[1]
B = "https://www.ebi.ac.uk/pride/ws/archive/v3/projects?pageSize=100&page=%d"
KEEP = ("accession", "title", "projectDescription", "sampleProcessingProtocol", "dataProcessingProtocol",
        "keywords", "projectTags", "submissionType", "publicationDate", "instruments", "experimentTypes")
def get(p):
    for a in range(6):
        try:
            with urllib.request.urlopen(B % p, timeout=180) as r:
                return p, json.load(r)
        except Exception as e:
            time.sleep(5 * (a + 1))
    return p, None
with urllib.request.urlopen("https://www.ebi.ac.uk/pride/ws/archive/v3/projects/count", timeout=60) as r:
    n = int(r.read())
pages = (n + 99) // 100
res = {}
with cf.ThreadPoolExecutor(6) as ex:
    for p, d in ex.map(get, range(pages)):
        res[p] = d
bad = [p for p, d in res.items() if d is None]
with open(OUT, "w") as o:
    seen = set()
    for p in sorted(res):
        for x in res[p] or []:
            if x["accession"] in seen: continue
            seen.add(x["accession"])
            o.write(json.dumps({k: x.get(k) for k in KEEP}) + "\n")
print("projects", n, "pages", pages, "written", len(seen), "failed_pages", bad)
