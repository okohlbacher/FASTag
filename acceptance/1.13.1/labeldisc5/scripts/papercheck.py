#!/usr/bin/env python3
"""Label discovery held-out test 5 (the test-4 script plus the probe pool): label sentences of the PRIDE record and of the paper of every selected project (rank 0).
Paper: PubMed id of the PRIDE record -> Europe PMC (open-access full text if there is one, else the abstract). No FASTag, no data file.
Usage: papercheck.py <pride cache dir> <selected.tsv> [class ...]   -> text on stdout; cache in <cache>/paper/"""
import json, csv, re, sys, os, time, urllib.request, html
CACHE, SEL = sys.argv[1:3]; want = set(sys.argv[3:]); os.makedirs(CACHE + "/paper", exist_ok=True)
pool = json.load(open(CACHE + "/pool.json")); pool.update({k: v for k, v in json.load(open(CACHE + "/pool_dimethyl_kw.json")).items() if k not in pool})
pool.update({k: v for k, v in json.load(open(CACHE + "/pool_probe_kw.json")).items() if k not in pool})
R = re.compile(r"probe|isoTOP|isoDTB|pChem|isotope-coded|TMT|tandem mass tag|iTRAQ|SILAC|dimethyl|formaldehyde|label|isotop|\bheavy\b|\blight\b|Lys[- ]?\d|Arg[- ]?\d|13C|15N|plex|isobaric|LFQ|iBAQ|spectral count|SPS|MS3|CID|HCD|ion trap|\bDIA\b|PRM", re.I)
def get(url, path):
    if os.path.exists(path): return open(path, "rb").read()
    for a in range(4):
        try:
            d = urllib.request.urlopen(url, timeout=90).read(); open(path, "wb").write(d); return d
        except Exception as e:
            if getattr(e, "code", 0) == 404: open(path, "wb").write(b""); return b""
            time.sleep(2 * (a + 1))
    return b""
def snips(t, n, w=(60, 90)):
    hits = []
    for m in R.finditer(t):
        if not hits or m.start() > hits[-1][0] + w[0] + w[1]: hits.append((m.start(), t[max(0, m.start() - w[0]):m.end() + w[1]].replace("\n", " ")))
    return [s for _, s in hits[:n]]
for r in csv.DictReader((l for l in open(SEL) if not l.startswith("# ")), delimiter="\t"):
    if r["rank"] != "0" or (want and r["truth"] not in want): continue
    p = pool[r["pxd"]]
    t = " ".join(str(p.get(k) or "") for k in ("title", "projectDescription", "sampleProcessingProtocol", "dataProcessingProtocol"))
    print("###", r["pxd"], r["truth"], "probe=" + r["probe"], r["silac_sub"], r["cell"], r["file"], "|", ";".join(p.get("quantificationMethods") or []), "|", ";".join(p.get("instruments") or []), "| sdrf", r["sdrf"])
    print("  T:", (p.get("title") or "")[:140])
    for s in snips(t, 6): print("   pride ..." + s)
    pm = re.findall(r"pubMed:(\d+)", " ".join(p.get("references") or []))
    if not pm: print("   paper: none listed"); continue
    for pmid in pm[:1]:
        d = get(f"https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=EXT_ID:{pmid}%20AND%20SRC:MED&resultType=core&format=json", f"{CACHE}/paper/{pmid}.json")
        try: res = json.loads(d)["resultList"]["result"][0]
        except Exception: print("   paper: PMID", pmid, "not found at Europe PMC"); continue
        src, txt = "abstract", res.get("abstractText") or ""
        if res.get("pmcid") and res.get("isOpenAccess") == "Y":
            x = get(f"https://www.ebi.ac.uk/europepmc/webservices/rest/{res['pmcid']}/fullTextXML", f"{CACHE}/paper/{res['pmcid']}.xml").decode("utf-8", "replace")
            x = re.sub(r"<ref-list.*?</ref-list>", " ", x, flags=re.S)
            if len(x) > 2000: src, txt = "fulltext", x
        txt = html.unescape(re.sub(r"<[^>]+>", " ", txt)); txt = re.sub(r"\s+", " ", txt)
        RL = re.compile(r"probe|isoTOP|isoDTB|pChem|isotope-coded|TMT|tandem mass tag|iTRAQ|SILAC|dimethyl|formaldehyde|isotop\w* label|label[- ]free|\bLFQ\b|13C6|15N|plex|isobaric|SPS|ion trap|\bCID\b", re.I)
        hits = []
        for m in RL.finditer(txt):
            if not hits or m.start() > hits[-1][0] + 220: hits.append((m.start(), txt[max(0, m.start() - 70):m.end() + 110]))
        print(f"   paper PMID {pmid} ({src}, {res.get('pubYear')}): {(res.get('title') or '')[:110]}")
        for _, s in hits[:7]: print("   paper ..." + s)
