#!/usr/bin/env python3
"""draw.py order <list of accessions> <name>          -> draw order (seeded shuffle of the sorted accessions)
   draw.py files <picks.tsv> <proj dir> [k]           -> stage.tsv: per pick, its candidate files in drawn order
PREREG-aspn.md. Seeds: "aspn-heldout-1.14:<name>" for project orders, "aspn-heldout-1.14:<group>:<protease>:<accession>"
for file orders. A file is a candidate if it is a Thermo .raw of 50 MB to 4 GB whose name carries the protease token
(Asp-N, Glu-C, Lys-C, chymotrypsin, Arg-C, trypsin; column 'files' = 'token', or a further regex the name must match) or, for picks with column 'files' = 'sdrf', is a trypsin file of the
project's SDRF (pool_sdrf_tryp.tsv), and whose name has no exclusion token. Per pick, the first k files in the drawn
order are listed (role 1..k; staging takes them in that order, one slot per pick and slot)."""
import csv, json, random, re, sys
SEED = "aspn-heldout-1.14"
TOK = {"Asp-N": r"asp[-_ ]?n(?![a-z])", "Glu-C": r"glu[-_ ]?c(?![a-z])", "Lys-C": r"lys[-_ ]?c(?![a-z])",
       "Chymotrypsin": r"chym|chemotryp", "Arg-C": r"arg[-_ ]?c(?![a-z])", "Trypsin": r"tr?ypsin|_tr_"}
EXCL = r"blank|wash|negative|tma|rectex|(?<![a-z])qc(?![a-z])|ethcd|etd|(?<![a-z])cid|(?<![a-z])dia(?![a-z])|(?<![a-z])ip(?![a-z])|mix"
if sys.argv[1] == "order":
    acc = sorted(set(open(sys.argv[2]).read().split())); random.Random(f"{SEED}:{sys.argv[3]}").shuffle(acc)
    print("order\taccession"); [print(i + 1, a, sep="\t") for i, a in enumerate(acc)]
    sys.exit()
picks, pdir = sys.argv[2], sys.argv[3]
sdrf = {}
for r in csv.DictReader(open(f"{pdir}/../pool_sdrf_tryp.tsv"), delimiter="\t"): sdrf.setdefault(r["accession"], set()).add(r["file"])
print("run\trole\tgroup\tprotease\taccession\tdb\tfile\tbytes\tpride_sha1\turl\tn_candidates")
for r in csv.DictReader(open(picks), delimiter="\t"):
    p, a, g, k = r["protease"], r["accession"], r["group"], int(r["files_per_slot"])
    c = {}
    for f in json.load(open(f"{pdir}/{a}.files.json")):
        n, b = f["fileName"], f["fileSizeBytes"]
        if not n.lower().endswith(".raw") or not 5e7 <= b <= 4e9 or re.search(EXCL, n, re.I): continue
        if r["files"] == "sdrf":
            if n not in sdrf.get(a, ()): continue
        elif not re.search(TOK[p], n, re.I) or (r["files"] != "token" and not re.search(r["files"], n, re.I)): continue
        url = [l["value"] for l in f["publicFileLocations"] if l["value"].startswith("ftp://")][0].replace("ftp://", "https://")
        c[n] = (b, f.get("checksum") or "-", url)
    names = sorted(c); random.Random(f"{SEED}:{g}:{p}:{a}").shuffle(names)
    slots = int(r["slots"])
    for s in range(slots):
        for j, n in enumerate(names[s::slots][:k]):   # slot s takes every slots-th file of the drawn order
            print(f"{r['pick']}.{s + 1}", j + 1, g, p, a, r["db"], n, *c[n], len(names), sep="\t")
