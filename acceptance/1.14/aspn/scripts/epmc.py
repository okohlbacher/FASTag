#!/usr/bin/env python3
"""epmc.py <outdir>: Europe PMC articles mentioning Asp-N with a text-mined PXD accession; PXDs per article (metadata only)."""
import json, os, sys, time, urllib.request, urllib.parse
out = sys.argv[1]
Q = '("AspN" OR "Asp-N" OR "endoproteinase Asp-N") AND ACCESSION_TYPE:pxd'
arts, cur = [], "*"
while True:
    u = "https://www.ebi.ac.uk/europepmc/webservices/rest/search?" + urllib.parse.urlencode(dict(query=Q, format="json", pageSize=1000, cursorMark=cur, resultType="lite"))
    d = json.load(urllib.request.urlopen(u, timeout=120))
    arts += d["resultList"]["result"]
    if d.get("nextCursorMark") in (None, cur) or not d["resultList"]["result"]: break
    cur = d["nextCursorMark"]
rows = []
for a in arts:
    src, i = a.get("source"), a.get("id")
    u = "https://www.ebi.ac.uk/europepmc/annotations_api/annotationsByArticleIds?" + urllib.parse.urlencode(dict(articleIds=f"{src}:{i}", type="Accession Numbers", format="JSON"))
    try: d = json.load(urllib.request.urlopen(u, timeout=120))
    except Exception: d = []
    px = set()
    for art in d:
        for an in art.get("annotations", []):
            e = an.get("exact", "")
            if e.upper().startswith("PXD"): px.add(e.upper())
    rows.append((src, i, a.get("pmcid", "-"), a.get("pubYear", ""), ";".join(sorted(px)), a.get("title", "")[:100]))
    time.sleep(0.1)
with open(f"{out}/epmc_aspn.tsv", "w") as f:
    for r in rows: f.write("\t".join(map(str, r)) + "\n")
print(len(rows), "articles")
