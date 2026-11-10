#!/usr/bin/env python3
"""Stage-2 pool from the PRIDE keyword search (metadata only).
pool_search.py <searchdir> <excl_pxd.txt> > pool_search.tsv
Keeps a project when: organisms is exactly Homo sapiens; every instrument is an
Orbitrap-family FTMS instrument; accession not excluded; the sample processing
protocol names one of the six proteases; experiment type is not cross-linking,
DIA/SWATH, top-down or SRM; at least one .raw file name carries a protease token.
One row per (project, protease named in a .raw file name)."""
import glob, json, re, sys
excl = set(open(sys.argv[2]).read().split())
PROT = {
 "Lys-C": r"lys[-_ ]?c(?![a-z])", "Glu-C": r"glu[-_ ]?c(?![a-z])|\bv8\b",
 "Asp-N": r"asp[-_ ]?n(?![a-z])", "Chymotrypsin": r"chym|(?<![a-z])ct(?![a-z])",
 "Arg-C": r"arg[-_ ]?c(?![a-z])", "Lys-N": r"lys[-_ ]?n(?![a-z])"}
OKINS = re.compile(r"q exactive|orbitrap|exploris|lumos|fusion|eclipse", re.I)
BADINS = re.compile(r"astral|tims|tof|ltq orbitrap|velos|elite|xl", re.I)
BADEXP = re.compile(r"cross|dia|swath|top-down|srm|mrm|imaging", re.I)
def L(s):
    return s if isinstance(s, list) else []
seen = {}
for f in sorted(glob.glob(sys.argv[1] + "/*.json")):
    for d in json.load(open(f)): seen.setdefault(d["accession"], d)
print("accession\tprotease\tn_raw_named\tn_raw\tinstruments\texperiment\ttitle")
for a in sorted(seen):
    d = seen[a]
    if a in excl: continue
    org = L(d["organisms"]); ins = L(d["instruments"])
    if len(org) != 1 or not org[0].lower().startswith("homo sapiens"): continue
    if not ins or any(BADINS.search(i) or not OKINS.search(i) for i in ins): continue
    if any(BADEXP.search(e) for e in L(d["experimentTypes"])): continue
    raws = [n for n in L(d["projectFileNames"]) if n.lower().endswith(".raw")]
    spp = d.get("sampleProcessingProtocol") or ""
    for p, rx in PROT.items():
        if not re.search(rx.split("|(?<")[0], spp, re.I): continue
        named = [n for n in raws if re.search(rx, n, re.I)]
        if named:
            print(a, p, len(named), len(raws), ";".join(ins), ";".join(L(d["experimentTypes"])), d["title"][:90], sep="\t")
