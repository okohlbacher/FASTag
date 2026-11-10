#!/usr/bin/env python3
"""Reading aid: view.py <protease> [from] [to] [width] -- prints the PRIDE record parts needed for the eligibility reading."""
import csv, json, re, sys
PROT = {"Lys-C": r"lys[-_ ]?c(?![a-z])", "Glu-C": r"glu[-_ ]?c(?![a-z])|(?<![a-z0-9])v8(?![a-z0-9])", "Asp-N": r"asp[-_ ]?n(?![a-z])",
 "Chymotrypsin": r"chym|(?<![a-z])ct(?![a-z])", "Arg-C": r"arg[-_ ]?c(?![a-z])", "Lys-N": r"lys[-_ ]?n(?![a-z])"}
p = sys.argv[1]; lo = int(sys.argv[2]) if len(sys.argv) > 2 else 1; hi = int(sys.argv[3]) if len(sys.argv) > 3 else 999
W = int(sys.argv[4]) if len(sys.argv) > 4 else 900
for r in csv.DictReader(open("draw_order.tsv"), delimiter="\t"):
    if r["protease"] != p or not lo <= int(r["order"]) <= hi: continue
    a = r["accession"]; d = json.load(open(f"proj/{a}.project.json")); fl = json.load(open(f"proj/{a}.files.json"))
    if not d: print(f"### {p} {r['order']} {a}: no PRIDE v3 record"); continue
    nm = lambda k: ";".join(x.get("name", "") for x in d.get(k, []))
    raws = [(f["fileName"], f["fileSizeBytes"]) for f in fl if f["fileName"].lower().endswith(".raw")]
    named = [x for x in raws if re.search(PROT[p], x[0], re.I)]
    print(f"### {p} {r['order']} {a} [{r['pool']}] {d['title']}\n  ins={nm('instruments')} exp={nm('experimentTypes')} quant={nm('quantificationMethods')} org={nm('organisms')} raw={len(raws)} named={len(named)}")
    s = d.get("sampleProcessingProtocol", ""); print("  SPP:", s[:W].replace("\n", " "))
    for m in list(re.finditer(PROT[p].split("|")[0] + "|" + p, s, re.I))[:2]:
        if m.start() > W: print("  ...", s[max(0, m.start() - 250):m.start() + 250].replace("\n", " "))
    print("  DESC:", d.get("projectDescription", "")[:350].replace("\n", " "))
    print("  FILES:", "; ".join(f"{n} {b/1e6:.0f}M" for n, b in (named or raws)[:8]))
